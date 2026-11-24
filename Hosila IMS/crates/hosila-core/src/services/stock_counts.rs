use std::collections::HashSet;

use chrono::{Datelike, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{line_value_minor, MILLI_SCALE};
use crate::domain::numbering::next_doc_number;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_operator, verify_manager_pin};
use crate::services::settings::get_settings;
use crate::types::{
    SessionUser, StartStockCountInput, StockCountDto, StockCountLineDto, StockCountSummaryDto,
    UpdateStockCountLineInput, UserRole,
};

pub fn start_stock_count(
    db: &Database,
    actor: &SessionUser,
    input: StartStockCountInput,
) -> AppResult<StockCountDto> {
    require_operator(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let year = Utc::now().year();
    let count_id = Uuid::now_v7().to_string();

    let dept_filter: HashSet<String> = input
        .department_ids
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let sec_filter: HashSet<String> = input
        .store_section_ids
        .iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();

    db.transaction(|tx| {
        let mut stmt = tx.prepare(
            "SELECT i.id, i.on_hand_milli, i.store_section_id
             FROM items i
             WHERE i.is_active = 1
             ORDER BY i.name ASC",
        )?;
        let candidates = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, Option<String>>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut d_stmt = tx.prepare("SELECT item_id, department_id FROM item_departments")?;
        let mut item_depts: std::collections::HashMap<String, Vec<String>> =
            std::collections::HashMap::new();
        for row in d_stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (iid, did) = row?;
            item_depts.entry(iid).or_default().push(did);
        }

        let selected: Vec<(String, i64)> = candidates
            .into_iter()
            .filter(|(iid, _, sec_id)| {
                let dept_ok = dept_filter.is_empty()
                    || item_depts
                        .get(iid)
                        .map(|ds| ds.iter().any(|d| dept_filter.contains(d)))
                        .unwrap_or(false);
                let sec_ok = sec_filter.is_empty()
                    || sec_id
                        .as_ref()
                        .map(|s| sec_filter.contains(s))
                        .unwrap_or(false);
                dept_ok && sec_ok
            })
            .map(|(iid, on_hand, _)| (iid, on_hand))
            .collect();

        if selected.is_empty() {
            return Err(ApiError::validation(
                "No active inventory items match the selected stock count scope.",
            ));
        }

        let number = next_doc_number(tx, "stock_count", year)?;
        let scope_json = serde_json::json!({
            "department_ids": input.department_ids,
            "store_section_ids": input.store_section_ids,
        })
        .to_string();

        tx.execute(
            "INSERT INTO stock_counts (id, number, scope_json, status, started_by_user_id, started_at)
             VALUES (?1, ?2, ?3, 'draft', ?4, ?5)",
            params![count_id, number, scope_json, actor.id, now],
        )?;

        for (item_id, sys_qty) in &selected {
            tx.execute(
                "INSERT INTO stock_count_lines (id, stock_count_id, item_id, system_qty_milli)
                 VALUES (?1, ?2, ?3, ?4)",
                params![Uuid::now_v7().to_string(), count_id, item_id, sys_qty],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "stock_count.started",
            "stock_counts",
            &count_id,
            &format!("Started stock count {number} ({} items)", selected.len()),
            serde_json::json!({ "number": number, "items": selected.len() }),
        )?;

        Ok(())
    })?;

    get_stock_count(db, &count_id)
}

pub fn update_stock_count_lines(
    db: &Database,
    actor: &SessionUser,
    count_id: &str,
    updates: Vec<UpdateStockCountLineInput>,
) -> AppResult<StockCountDto> {
    require_operator(actor)?;
    if updates.is_empty() {
        return get_stock_count(db, count_id);
    }

    db.transaction(|tx| {
        let status: Option<String> = tx
            .query_row(
                "SELECT status FROM stock_counts WHERE id = ?1",
                [count_id],
                |r| r.get(0),
            )
            .optional()?;
        let status = status.ok_or_else(|| ApiError::not_found("Stock count session not found."))?;
        if status != "draft" {
            return Err(ApiError::conflict(
                "Cannot modify lines on an already posted stock count.",
            ));
        }

        for u in updates {
            let sys_qty: Option<i64> = tx
                .query_row(
                    "SELECT system_qty_milli FROM stock_count_lines WHERE id = ?1 AND stock_count_id = ?2",
                    params![u.line_id, count_id],
                    |r| r.get(0),
                )
                .optional()?;
            let sys_qty = sys_qty.ok_or_else(|| {
                ApiError::not_found(format!("Stock count line '{}' not found.", u.line_id))
            })?;

            if let Some(c) = u.counted_qty_milli {
                if c < 0 {
                    return Err(ApiError::validation("Counted quantity cannot be negative."));
                }
                let variance = c - sys_qty;
                tx.execute(
                    "UPDATE stock_count_lines SET counted_qty_milli = ?1, variance_milli = ?2 WHERE id = ?3",
                    params![c, variance, u.line_id],
                )?;
            } else {
                tx.execute(
                    "UPDATE stock_count_lines SET counted_qty_milli = NULL, variance_milli = NULL WHERE id = ?1",
                    [&u.line_id],
                )?;
            }
        }
        Ok(())
    })?;

    get_stock_count(db, count_id)
}

pub fn post_stock_count(
    db: &Database,
    actor: &SessionUser,
    count_id: &str,
    manager_pin: Option<String>,
) -> AppResult<StockCountDto> {
    require_operator(actor)?;
    let settings = get_settings(db)?;
    let pin_threshold = settings.inventory_rules.require_manager_pin_above_minor;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let today = Utc::now().format("%Y-%m-%d").to_string();

    // Pre-check status and variance PIN threshold
    let abs_variance_minor: i64 = db.with_read(|conn| {
        let status: Option<String> = conn
            .query_row(
                "SELECT status FROM stock_counts WHERE id = ?1",
                [count_id],
                |r| r.get(0),
            )
            .optional()?;
        let status = status.ok_or_else(|| ApiError::not_found("Stock count session not found."))?;
        if status != "draft" {
            return Err(ApiError::conflict("This stock count has already been posted."));
        }

        let mut stmt = conn.prepare(
            "SELECT l.counted_qty_milli, i.on_hand_milli, i.avg_cost_micro
             FROM stock_count_lines l
             JOIN items i ON i.id = l.item_id
             WHERE l.stock_count_id = ?1",
        )?;
        let rows = stmt
            .query_map([count_id], |r| {
                Ok((
                    r.get::<_, Option<i64>>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut counted_n = 0usize;
        let mut abs_val: i64 = 0;
        for (counted_opt, current_on_hand, avg_cost) in rows {
            if let Some(counted) = counted_opt {
                counted_n += 1;
                let delta = counted - current_on_hand;
                abs_val += line_value_minor(delta.abs(), avg_cost)?;
            }
        }
        if counted_n == 0 {
            return Err(ApiError::validation(
                "Enter at least one counted quantity before posting this stock count.",
            ));
        }
        Ok(abs_val)
    })?;

    if actor.role != UserRole::Admin && abs_variance_minor >= pin_threshold {
        let pin = manager_pin.as_deref().ok_or_else(|| {
            ApiError::forbidden(
                "Manager PIN is required when net stock count variance value meets or exceeds the threshold.",
            )
            .with_field("manager_pin")
        })?;
        verify_manager_pin(db, pin)?;
    }

    db.transaction(|tx| {
        let (number, status): (String, String) = tx
            .query_row(
                "SELECT number, status FROM stock_counts WHERE id = ?1",
                [count_id],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?
            .ok_or_else(|| ApiError::not_found("Stock count session not found."))?;
        if status != "draft" {
            return Err(ApiError::conflict("This stock count has already been posted."));
        }

        let mut stmt = tx.prepare(
            "SELECT l.id, l.item_id, l.counted_qty_milli, i.on_hand_milli, i.base_unit_id, i.avg_cost_micro
             FROM stock_count_lines l
             JOIN items i ON i.id = l.item_id
             WHERE l.stock_count_id = ?1",
        )?;
        let rows = stmt
            .query_map([count_id], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<i64>>(2)?,
                    r.get::<_, i64>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, i64>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let mut posted_variances = 0i32;
        for (line_id, item_id, counted_opt, current_on_hand, base_unit_id, avg_cost) in rows {
            let Some(counted) = counted_opt else {
                continue;
            };
            let delta = counted - current_on_hand;
            tx.execute(
                "UPDATE stock_count_lines SET system_qty_milli = ?1, variance_milli = ?2 WHERE id = ?3",
                params![current_on_hand, delta, line_id],
            )?;

            if delta != 0 {
                posted_variances += 1;
                let val_minor = line_value_minor(delta.abs(), avg_cost)?;
                tx.execute(
                    "UPDATE items SET on_hand_milli = ?1, updated_at = ?2 WHERE id = ?3",
                    params![counted, now, item_id],
                )?;
                tx.execute(
                    "INSERT INTO stock_movements (
                        id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                        doc_type, doc_id, doc_number,
                        input_unit_id, input_qty_milli, factor_milli,
                        actor_user_id, business_date, created_at
                     ) VALUES (?1, ?2, 'count', ?3, ?4, ?5, ?6, 'stock_count', ?7, ?8, ?9, ?3, ?10, ?11, ?12, ?13)",
                    params![
                        Uuid::now_v7().to_string(),
                        item_id,
                        delta,
                        counted,
                        avg_cost,
                        val_minor,
                        count_id,
                        number,
                        base_unit_id,
                        MILLI_SCALE,
                        actor.id,
                        today,
                        now
                    ],
                )?;
            }
        }

        tx.execute(
            "UPDATE stock_counts SET status = 'posted', posted_by_user_id = ?1, posted_at = ?2 WHERE id = ?3",
            params![actor.id, now, count_id],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "stock_count.posted",
            "stock_counts",
            count_id,
            &format!("Posted stock count {number} ({posted_variances} variance adjustments)"),
            serde_json::json!({
                "number": number,
                "variances": posted_variances,
            }),
        )?;

        Ok(())
    })?;

    get_stock_count(db, count_id)
}

pub fn get_stock_count(db: &Database, id: &str) -> AppResult<StockCountDto> {
    db.with_read(|conn| {
        let row: Option<(String, String, String, String, String, String, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT sc.id, sc.number, sc.scope_json, sc.status, su.full_name, sc.started_at,
                        pu.full_name, sc.posted_at
                 FROM stock_counts sc
                 JOIN users su ON su.id = sc.started_by_user_id
                 LEFT JOIN users pu ON pu.id = sc.posted_by_user_id
                 WHERE sc.id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                    ))
                },
            )
            .optional()?;
        let (id, number, scope_raw, status, started_by_name, started_at, posted_by_name, posted_at) =
            row.ok_or_else(|| ApiError::not_found("Stock count session not found."))?;
        let scope_val: serde_json::Value =
            serde_json::from_str(&scope_raw).unwrap_or_else(|_| serde_json::json!({}));
        let scope_department_ids: Vec<String> = scope_val
            .get("department_ids")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let scope_section_ids: Vec<String> = scope_val
            .get("store_section_ids")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();

        let mut stmt = conn.prepare(
            "SELECT l.id, l.item_id, i.name, u.code, l.system_qty_milli, l.counted_qty_milli,
                    l.variance_milli, i.avg_cost_micro
             FROM stock_count_lines l
             JOIN items i ON i.id = l.item_id
             JOIN units u ON u.id = i.base_unit_id
             WHERE l.stock_count_id = ?1
             ORDER BY i.name ASC",
        )?;
        let lines = stmt
            .query_map([&id], |r| {
                let var_opt: Option<i64> = r.get(6)?;
                let cost: i64 = r.get(7)?;
                let var_val = var_opt
                    .map(|v| line_value_minor(v, cost).unwrap_or(0))
                    .unwrap_or(0);
                Ok(StockCountLineDto {
                    id: r.get(0)?,
                    item_id: r.get(1)?,
                    item_name: r.get(2)?,
                    base_unit_code: r.get(3)?,
                    system_qty_milli: r.get(4)?,
                    counted_qty_milli: r.get(5)?,
                    variance_milli: var_opt,
                    unit_cost_micro: cost,
                    variance_value_minor: var_val,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let net_variance_value_minor: i64 = lines.iter().map(|l| l.variance_value_minor).sum();
        Ok(StockCountDto {
            id,
            number,
            status,
            scope_department_ids,
            scope_section_ids,
            started_by_name,
            started_at,
            posted_by_name,
            posted_at,
            lines,
            net_variance_value_minor,
        })
    })
}

pub fn list_stock_counts(db: &Database) -> AppResult<Vec<StockCountSummaryDto>> {
    db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT sc.id, sc.number, sc.status, su.full_name, sc.started_at, pu.full_name, sc.posted_at
             FROM stock_counts sc
             JOIN users su ON su.id = sc.started_by_user_id
             LEFT JOIN users pu ON pu.id = sc.posted_by_user_id
             ORDER BY sc.started_at DESC",
        )?;
        let headers = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut out = Vec::with_capacity(headers.len());
        for (id, number, status, started_by_name, started_at, posted_by_name, posted_at) in headers {
            let mut l_stmt = conn.prepare(
                "SELECT l.counted_qty_milli, l.variance_milli, i.avg_cost_micro
                 FROM stock_count_lines l
                 JOIN items i ON i.id = l.item_id
                 WHERE l.stock_count_id = ?1",
            )?;
            let l_rows = l_stmt
                .query_map([&id], |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, i64>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            let total_lines = l_rows.len() as i32;
            let counted_lines = l_rows.iter().filter(|r| r.0.is_some()).count() as i32;
            let net_variance_value_minor: i64 = l_rows
                .iter()
                .filter_map(|(_, var_opt, cost)| {
                    var_opt.map(|v| line_value_minor(v, *cost).unwrap_or(0))
                })
                .sum();
            out.push(StockCountSummaryDto {
                id,
                number,
                status,
                started_by_name,
                started_at,
                posted_by_name,
                posted_at,
                total_lines,
                counted_lines,
                net_variance_value_minor,
            });
        }
        Ok(out)
    })
}
