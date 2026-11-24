use std::collections::HashMap;

use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{line_value_minor, to_base_qty_milli, MILLI_SCALE};
use crate::domain::numbering::next_doc_number;
use crate::domain::uom::{format_qty_milli, resolve_factor_milli};
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_operator, verify_manager_pin, verify_storekeeper_pin};
use crate::services::items::{load_item_units, load_unit_map};
use crate::services::settings::get_settings;
use crate::services::{
    clean_opt_str, now_rfc3339, parse_iso_date_or_today, today_iso, year_from_iso_date,
};
use crate::types::{
    CollectionDto, CollectionFilter, CollectionLineDto, CollectionLineValidationDto,
    CollectionValidationDto, CreateCollectionInput, OutstandingReturnDto, RecordReturnInput,
    SessionUser, UserRole,
};

struct LinePrep {
    item_id: String,
    item_name: String,
    unit_id: String,
    unit_code: String,
    base_unit_plural: String,
    input_qty_milli: i64,
    factor_milli: i64,
    base_qty_milli: i64,
    available_base_milli: i64,
    unit_cost_micro: i64,
    line_value_minor: i64,
    is_returnable: bool,
    assigned_to_dept: bool,
}

fn prepare_collection_lines(
    conn: &Connection,
    department_id: &str,
    lines: &[crate::types::CollectionLineInput],
) -> AppResult<Vec<LinePrep>> {
    if lines.is_empty() {
        return Err(ApiError::validation("Add at least one item to collect.").with_field("lines"));
    }
    let unit_map = load_unit_map(conn)?;
    let mut preps = Vec::with_capacity(lines.len());

    for line in lines {
        if line.quantity_milli <= 0 {
            return Err(
                ApiError::validation("Collection quantity must be greater than zero.")
                    .with_field("lines"),
            );
        }

        let item_row: Option<(String, String, i64, i64, bool, bool)> = conn
            .query_row(
                "SELECT name, base_unit_id, on_hand_milli, avg_cost_micro, is_returnable, is_active
                 FROM items WHERE id = ?1",
                [&line.item_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get::<_, i64>(5)? != 0,
                    ))
                },
            )
            .optional()?;

        let (item_name, base_unit_id, on_hand_milli, avg_cost_micro, is_returnable, is_active) =
            item_row.ok_or_else(|| ApiError::not_found("Selected inventory item was not found."))?;
        if !is_active {
            return Err(ApiError::conflict(format!(
                "Item '{item_name}' is archived and cannot be collected."
            )));
        }

        let assigned: Option<String> = conn
            .query_row(
                "SELECT item_id FROM item_departments WHERE item_id = ?1 AND department_id = ?2",
                params![line.item_id, department_id],
                |r| r.get(0),
            )
            .optional()?;

        let base_unit = unit_map
            .get(&base_unit_id)
            .ok_or_else(|| ApiError::internal("Missing base unit"))?;
        let target_unit = unit_map
            .get(&line.unit_id)
            .ok_or_else(|| ApiError::not_found("Selected unit of measure was not found."))?;
        let item_units = load_item_units(conn, &line.item_id)?;

        let factor_milli = resolve_factor_milli(base_unit, target_unit, &item_units)?;
        let base_qty_milli = to_base_qty_milli(line.quantity_milli, factor_milli)?;
        let value_minor = line_value_minor(base_qty_milli, avg_cost_micro)?;

        preps.push(LinePrep {
            item_id: line.item_id.clone(),
            item_name,
            unit_id: target_unit.id.clone(),
            unit_code: target_unit.code.clone(),
            base_unit_plural: base_unit.plural.clone(),
            input_qty_milli: line.quantity_milli,
            factor_milli,
            base_qty_milli,
            available_base_milli: on_hand_milli,
            unit_cost_micro: avg_cost_micro,
            line_value_minor: value_minor,
            is_returnable,
            assigned_to_dept: assigned.is_some(),
        });
    }

    Ok(preps)
}

pub fn validate_collection(
    db: &Database,
    input: CreateCollectionInput,
) -> AppResult<CollectionValidationDto> {
    let settings = get_settings(db)?;
    let allow_negative = settings.inventory_rules.allow_negative_stock;

    db.with_read(|conn| {
        let dept_ok: Option<bool> = conn
            .query_row(
                "SELECT is_active FROM departments WHERE id = ?1",
                [&input.department_id],
                |r| Ok(r.get::<_, i64>(0)? != 0),
            )
            .optional()?;
        match dept_ok {
            None => return Err(ApiError::not_found("Department not found.").with_field("department_id")),
            Some(false) => {
                return Err(ApiError::conflict("Selected department is inactive.")
                    .with_field("department_id"));
            }
            Some(true) => {}
        }

        let preps = prepare_collection_lines(conn, &input.department_id, &input.lines)?;

        // Track cumulative requested qty per item so duplicate rows on one voucher cannot overdraw
        let mut cumulative_by_item: HashMap<String, i64> = HashMap::new();
        for p in &preps {
            *cumulative_by_item.entry(p.item_id.clone()).or_insert(0) += p.base_qty_milli;
        }

        let mut total_value_minor: i64 = 0;
        let mut all_valid = true;
        let mut out_lines = Vec::with_capacity(preps.len());

        for p in preps {
            total_value_minor += p.line_value_minor;
            let total_req_for_item = *cumulative_by_item.get(&p.item_id).unwrap_or(&p.base_qty_milli);
            let remaining = p.available_base_milli - total_req_for_item;

            let err_msg = if !p.assigned_to_dept {
                all_valid = false;
                Some(format!(
                    "{} is not assigned to the selected department.",
                    p.item_name
                ))
            } else if !allow_negative && total_req_for_item > p.available_base_milli {
                all_valid = false;
                let avail_str = format!(
                    "{} {}",
                    format_qty_milli(p.available_base_milli.max(0)),
                    p.base_unit_plural.to_lowercase()
                );
                Some(format!(
                    "Quantity is more than available for {}. Only {} in stock.",
                    p.item_name, avail_str
                ))
            } else {
                None
            };

            out_lines.push(CollectionLineValidationDto {
                item_id: p.item_id,
                item_name: p.item_name,
                unit_code: p.unit_code,
                input_qty_milli: p.input_qty_milli,
                factor_milli: p.factor_milli,
                base_qty_milli: p.base_qty_milli,
                available_base_milli: p.available_base_milli,
                remaining_after_milli: remaining,
                unit_cost_micro: p.unit_cost_micro,
                line_value_minor: p.line_value_minor,
                is_returnable: p.is_returnable,
                error: err_msg,
            });
        }

        Ok(CollectionValidationDto {
            valid: all_valid,
            total_value_minor,
            lines: out_lines,
        })
    })
}

pub fn create_collection(
    db: &Database,
    actor: &SessionUser,
    input: CreateCollectionInput,
) -> AppResult<CollectionDto> {
    require_operator(actor)?;
    let collection_date = parse_iso_date_or_today(input.collection_date.as_deref(), "collection_date")?;
    let year = year_from_iso_date(&collection_date);
    let settings = get_settings(db)?;
    let allow_negative = settings.inventory_rules.allow_negative_stock;
    if settings.inventory_rules.require_storekeeper_pin_on_issue && actor.role != UserRole::Admin {
        let pin = input.storekeeper_pin.as_deref().ok_or_else(|| {
            ApiError::forbidden("Storekeeper PIN is required to issue stock.")
                .with_field("storekeeper_pin")
        })?;
        verify_storekeeper_pin(db, pin)?;
    }
    let notes = clean_opt_str(input.notes.as_deref());
    let now = now_rfc3339();

    let col_id = db.transaction(|tx| {
        let dept_row: Option<(String, bool)> = tx
            .query_row(
                "SELECT name, is_active FROM departments WHERE id = ?1",
                [&input.department_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .optional()?;
        let (dept_name, dept_active) = dept_row
            .ok_or_else(|| ApiError::not_found("Department not found.").with_field("department_id"))?;
        if !dept_active {
            return Err(ApiError::conflict("Selected department is inactive.").with_field("department_id"));
        }

        let collector_row: Option<(String, bool)> = tx
            .query_row(
                "SELECT full_name, is_active FROM staff WHERE id = ?1",
                [&input.collector_staff_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .optional()?;
        let (collector_name, collector_active) = collector_row
            .ok_or_else(|| ApiError::not_found("Collector staff member not found.").with_field("collector_staff_id"))?;
        if !collector_active {
            return Err(ApiError::conflict("Selected collector is inactive.").with_field("collector_staff_id"));
        }

        let keeper_row: Option<(String, bool, bool)> = tx
            .query_row(
                "SELECT full_name, is_store_staff, is_active FROM staff WHERE id = ?1",
                [&input.storekeeper_staff_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0)),
            )
            .optional()?;
        let (keeper_name, is_store_staff, keeper_active) = keeper_row
            .ok_or_else(|| ApiError::not_found("Storekeeper staff member not found.").with_field("storekeeper_staff_id"))?;
        if !keeper_active {
            return Err(ApiError::conflict("Selected storekeeper is inactive.").with_field("storekeeper_staff_id"));
        }
        if !is_store_staff {
            return Err(ApiError::validation("Selected approver must be marked as Store Staff.").with_field("storekeeper_staff_id"));
        }

        let preps = prepare_collection_lines(tx, &input.department_id, &input.lines)?;

        // Aggregate per-item quantities to catch duplicate lines exceeding available stock
        let mut total_by_item: HashMap<String, i64> = HashMap::new();
        for p in &preps {
            if !p.assigned_to_dept {
                return Err(ApiError::validation(format!(
                    "{} is not assigned to department '{dept_name}'.",
                    p.item_name
                )));
            }
            *total_by_item.entry(p.item_id.clone()).or_insert(0) += p.base_qty_milli;
        }
        if !allow_negative {
            for p in &preps {
                let total_req = total_by_item[&p.item_id];
                if total_req > p.available_base_milli {
                    let avail = format!(
                        "{} {}",
                        format_qty_milli(p.available_base_milli.max(0)),
                        p.base_unit_plural.to_lowercase()
                    );
                    let req = format!(
                        "{} {}",
                        format_qty_milli(total_req),
                        p.base_unit_plural.to_lowercase()
                    );
                    return Err(ApiError::insufficient_stock(&p.item_name, &avail, &req));
                }
            }
        }

        let col_id = Uuid::now_v7().to_string();
        let voucher_number = next_doc_number(tx, "collection", year)?;

        tx.execute(
            "INSERT INTO collections (
                id, number, department_id, collector_staff_id, collector_name_snapshot,
                storekeeper_staff_id, storekeeper_name_snapshot, created_by_user_id,
                collection_date, notes, status, posted_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 'posted', ?11)",
            params![
                col_id,
                voucher_number,
                input.department_id,
                input.collector_staff_id,
                collector_name,
                input.storekeeper_staff_id,
                keeper_name,
                actor.id,
                collection_date,
                notes,
                now
            ],
        )?;

        let mut summary_parts = Vec::new();
        for p in preps {
            let line_id = Uuid::now_v7().to_string();
            let ret_status = if p.is_returnable { "out" } else { "na" };

            let new_balance: i64 = tx.query_row(
                "UPDATE items SET on_hand_milli = on_hand_milli - ?1, updated_at = ?2 WHERE id = ?3 RETURNING on_hand_milli",
                params![p.base_qty_milli, now, p.item_id],
                |r| r.get(0),
            )?;

            tx.execute(
                "INSERT INTO collection_lines (
                    id, collection_id, item_id, unit_id, input_qty_milli, factor_milli,
                    base_qty_milli, unit_cost_micro, line_value_minor, is_returnable,
                    returned_qty_milli, damaged_qty_milli, return_status
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0, 0, ?11)",
                params![
                    line_id,
                    col_id,
                    p.item_id,
                    p.unit_id,
                    p.input_qty_milli,
                    p.factor_milli,
                    p.base_qty_milli,
                    p.unit_cost_micro,
                    p.line_value_minor,
                    if p.is_returnable { 1 } else { 0 },
                    ret_status
                ],
            )?;

            let move_type = if p.is_returnable { "tool_out" } else { "issue" };
            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    department_id, doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, counterparty_staff_id, storekeeper_staff_id,
                    business_date, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'collection', ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    Uuid::now_v7().to_string(),
                    p.item_id,
                    move_type,
                    -p.base_qty_milli,
                    new_balance,
                    p.unit_cost_micro,
                    p.line_value_minor,
                    input.department_id,
                    col_id,
                    voucher_number,
                    p.unit_id,
                    p.input_qty_milli,
                    p.factor_milli,
                    actor.id,
                    input.collector_staff_id,
                    input.storekeeper_staff_id,
                    collection_date,
                    now
                ],
            )?;

            summary_parts.push(format!(
                "{} {} {}",
                format_qty_milli(p.input_qty_milli),
                p.unit_code,
                p.item_name
            ));
        }

        let summary_items = if summary_parts.len() <= 3 {
            summary_parts.join(", ")
        } else {
            format!(
                "{}, {} (+{} more)",
                summary_parts[0],
                summary_parts[1],
                summary_parts.len() - 2
            )
        };
        record_activity(
            tx,
            Some(&actor.id),
            "collection.posted",
            "collections",
            &col_id,
            &format!("{collector_name} ({dept_name}) collected {summary_items} · Approved by {keeper_name}"),
            serde_json::json!({
                "number": voucher_number,
                "department": dept_name,
                "collection_date": collection_date,
            }),
        )?;

        Ok(col_id)
    })?;

    get_collection(db, &col_id)
}

fn load_collection_lines(conn: &Connection, collection_id: &str) -> AppResult<Vec<CollectionLineDto>> {
    let mut stmt = conn.prepare(
        "SELECT cl.id, cl.item_id, i.name, cl.unit_id, u.code, cl.input_qty_milli, cl.factor_milli,
                cl.base_qty_milli, bu.code, cl.unit_cost_micro, cl.line_value_minor, cl.is_returnable,
                cl.returned_qty_milli, cl.damaged_qty_milli, cl.return_status, cl.returned_at
         FROM collection_lines cl
         JOIN items i ON i.id = cl.item_id
         JOIN units u ON u.id = cl.unit_id
         JOIN units bu ON bu.id = i.base_unit_id
         WHERE cl.collection_id = ?1
         ORDER BY i.name ASC",
    )?;
    let rows = stmt
        .query_map([collection_id], |r| {
            let base_qty: i64 = r.get(7)?;
            let returned_qty: i64 = r.get(12)?;
            let damaged_qty: i64 = r.get(13)?;
            let is_returnable = r.get::<_, i64>(11)? != 0;
            let outstanding = if is_returnable {
                (base_qty - returned_qty - damaged_qty).max(0)
            } else {
                0
            };
            Ok(CollectionLineDto {
                id: r.get(0)?,
                item_id: r.get(1)?,
                item_name: r.get(2)?,
                unit_id: r.get(3)?,
                unit_code: r.get(4)?,
                input_qty_milli: r.get(5)?,
                factor_milli: r.get(6)?,
                base_qty_milli: base_qty,
                base_unit_code: r.get(8)?,
                unit_cost_micro: r.get(9)?,
                line_value_minor: r.get(10)?,
                is_returnable,
                returned_qty_milli: returned_qty,
                damaged_qty_milli: damaged_qty,
                outstanding_qty_milli: outstanding,
                return_status: r.get(14)?,
                returned_at: r.get(15)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_collection(db: &Database, id: &str) -> AppResult<CollectionDto> {
    db.with_read(|conn| {
        let row: Option<(
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            Option<String>,
            String,
            String,
        )> = conn
            .query_row(
                "SELECT c.id, c.number, c.department_id, d.name, c.collector_staff_id, c.collector_name_snapshot,
                        c.storekeeper_staff_id, c.storekeeper_name_snapshot, u.full_name,
                        c.collection_date, c.notes, c.status, c.posted_at
                 FROM collections c
                 JOIN departments d ON d.id = c.department_id
                 JOIN users u ON u.id = c.created_by_user_id
                 WHERE c.id = ?1",
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
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                        r.get(12)?,
                    ))
                },
            )
            .optional()?;

        let (
            cid,
            number,
            department_id,
            department_name,
            collector_staff_id,
            collector_name,
            storekeeper_staff_id,
            storekeeper_name,
            created_by_name,
            collection_date,
            notes,
            status,
            posted_at,
        ) = row.ok_or_else(|| ApiError::not_found("Collection voucher not found."))?;

        let lines = load_collection_lines(conn, &cid)?;
        let total_value_minor = lines.iter().map(|l| l.line_value_minor).sum();

        Ok(CollectionDto {
            id: cid,
            number,
            department_id,
            department_name,
            collector_staff_id,
            collector_name,
            storekeeper_staff_id,
            storekeeper_name,
            created_by_name,
            collection_date,
            notes,
            status,
            total_value_minor,
            posted_at,
            lines,
        })
    })
}

pub fn list_collections(db: &Database, filter: CollectionFilter) -> AppResult<Vec<CollectionDto>> {
    db.with_read(|conn| {
        let mut clauses = Vec::new();
        let mut binds: Vec<SqlValue> = Vec::new();

        if let Some(d) = filter.department_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.department_id = ?".to_string());
            binds.push(SqlValue::Text(d.to_string()));
        }
        if let Some(sd) = filter.start_date.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.collection_date >= ?".to_string());
            binds.push(SqlValue::Text(sd.to_string()));
        }
        if let Some(ed) = filter.end_date.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.collection_date <= ?".to_string());
            binds.push(SqlValue::Text(ed.to_string()));
        }
        if let Some(st) = filter.status.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.status = ?".to_string());
            binds.push(SqlValue::Text(st.to_string()));
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };
        let limit = i64::from(filter.limit.unwrap_or(100).clamp(1, 500));
        binds.push(SqlValue::Integer(limit));

        let sql = format!(
            "SELECT c.id, c.number, c.department_id, d.name, c.collector_staff_id, c.collector_name_snapshot,
                    c.storekeeper_staff_id, c.storekeeper_name_snapshot, u.full_name,
                    c.collection_date, c.notes, c.status, c.posted_at
             FROM collections c
             JOIN departments d ON d.id = c.department_id
             JOIN users u ON u.id = c.created_by_user_id
             {where_sql}
             ORDER BY c.collection_date DESC, c.posted_at DESC
             LIMIT ?"
        );

        let mut stmt = conn.prepare(&sql)?;
        let headers = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, Option<String>>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, String>(12)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut lines_by_col: HashMap<String, Vec<CollectionLineDto>> = HashMap::new();
        if !headers.is_empty() {
            let placeholders = vec!["?"; headers.len()].join(", ");
            let line_sql = format!(
                "SELECT cl.collection_id, cl.id, cl.item_id, i.name, cl.unit_id, u.code, cl.input_qty_milli,
                        cl.factor_milli, cl.base_qty_milli, bu.code, cl.unit_cost_micro, cl.line_value_minor,
                        cl.is_returnable, cl.returned_qty_milli, cl.damaged_qty_milli, cl.return_status, cl.returned_at
                 FROM collection_lines cl
                 JOIN items i ON i.id = cl.item_id
                 JOIN units u ON u.id = cl.unit_id
                 JOIN units bu ON bu.id = i.base_unit_id
                 WHERE cl.collection_id IN ({placeholders})
                 ORDER BY i.name ASC"
            );
            let mut l_stmt = conn.prepare(&line_sql)?;
            let id_binds: Vec<SqlValue> = headers.iter().map(|h| SqlValue::Text(h.0.clone())).collect();
            let l_rows = l_stmt
                .query_map(rusqlite::params_from_iter(id_binds), |r| {
                    let base_qty: i64 = r.get(8)?;
                    let returned_qty: i64 = r.get(13)?;
                    let damaged_qty: i64 = r.get(14)?;
                    let is_returnable = r.get::<_, i64>(12)? != 0;
                    let outstanding = if is_returnable {
                        (base_qty - returned_qty - damaged_qty).max(0)
                    } else {
                        0
                    };
                    Ok((
                        r.get::<_, String>(0)?,
                        CollectionLineDto {
                            id: r.get(1)?,
                            item_id: r.get(2)?,
                            item_name: r.get(3)?,
                            unit_id: r.get(4)?,
                            unit_code: r.get(5)?,
                            input_qty_milli: r.get(6)?,
                            factor_milli: r.get(7)?,
                            base_qty_milli: base_qty,
                            base_unit_code: r.get(9)?,
                            unit_cost_micro: r.get(10)?,
                            line_value_minor: r.get(11)?,
                            is_returnable,
                            returned_qty_milli: returned_qty,
                            damaged_qty_milli: damaged_qty,
                            outstanding_qty_milli: outstanding,
                            return_status: r.get(15)?,
                            returned_at: r.get(16)?,
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (cid, dto) in l_rows {
                lines_by_col.entry(cid).or_default().push(dto);
            }
        }

        let mut out = Vec::with_capacity(headers.len());
        for (
            id,
            number,
            department_id,
            department_name,
            collector_staff_id,
            collector_name,
            storekeeper_staff_id,
            storekeeper_name,
            created_by_name,
            collection_date,
            notes,
            status,
            posted_at,
        ) in headers
        {
            let lines = lines_by_col.remove(&id).unwrap_or_default();
            let total_value_minor = lines.iter().map(|l| l.line_value_minor).sum();
            out.push(CollectionDto {
                id,
                number,
                department_id,
                department_name,
                collector_staff_id,
                collector_name,
                storekeeper_staff_id,
                storekeeper_name,
                created_by_name,
                collection_date,
                notes,
                status,
                total_value_minor,
                posted_at,
                lines,
            });
        }
        Ok(out)
    })
}

pub fn reverse_collection(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    reason: String,
    manager_pin: Option<String>,
) -> AppResult<CollectionDto> {
    require_operator(actor)?;
    let clean_reason = reason.trim().to_string();
    if clean_reason.is_empty() {
        return Err(ApiError::validation("A reason is required to reverse a collection.").with_field("reason"));
    }
    if actor.role != UserRole::Admin {
        let pin = manager_pin.as_deref().ok_or_else(|| {
            ApiError::forbidden("Manager PIN is required for non-admin users to reverse a collection.")
        })?;
        verify_manager_pin(db, pin)?;
    }

    let now = now_rfc3339();
    let today = today_iso();

    db.transaction(|tx| {
        let row: Option<(String, String, String, String, String)> = tx
            .query_row(
                "SELECT number, status, department_id, collector_staff_id, storekeeper_staff_id
                 FROM collections WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;
        let (number, status, dept_id, collector_id, keeper_id) =
            row.ok_or_else(|| ApiError::not_found("Collection voucher not found."))?;
        if status == "reversed" {
            return Err(ApiError::conflict("This collection has already been reversed."));
        }

        let lines = load_collection_lines(tx, id)?;
        for l in &lines {
            if l.returned_qty_milli > 0 || l.damaged_qty_milli > 0 {
                return Err(ApiError::conflict(
                    "Cannot reverse a collection after returnable items have already been checked back in.",
                ));
            }
        }

        for l in lines {
            let new_balance: i64 = tx.query_row(
                "UPDATE items SET on_hand_milli = on_hand_milli + ?1, updated_at = ?2 WHERE id = ?3 RETURNING on_hand_milli",
                params![l.base_qty_milli, now, l.item_id],
                |r| r.get(0),
            )?;

            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    department_id, doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, counterparty_staff_id, storekeeper_staff_id,
                    business_date, created_at
                ) VALUES (?1, ?2, 'reversal', ?3, ?4, ?5, ?6, ?7, 'collection_reversal', ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17)",
                params![
                    Uuid::now_v7().to_string(),
                    l.item_id,
                    l.base_qty_milli,
                    new_balance,
                    l.unit_cost_micro,
                    l.line_value_minor,
                    dept_id,
                    id,
                    format!("REV-{number}"),
                    l.unit_id,
                    l.input_qty_milli,
                    l.factor_milli,
                    actor.id,
                    collector_id,
                    keeper_id,
                    today,
                    now
                ],
            )?;
        }

        tx.execute(
            "UPDATE collections SET status = 'reversed' WHERE id = ?1",
            [id],
        )?;
        tx.execute(
            "UPDATE collection_lines SET return_status = 'returned', returned_at = ?1 WHERE collection_id = ?2 AND is_returnable = 1",
            params![now, id],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "collection.reversed",
            "collections",
            id,
            &format!("Reversed collection {number} — {clean_reason}"),
            serde_json::json!({ "number": number, "reason": clean_reason }),
        )?;

        Ok(())
    })?;

    get_collection(db, id)
}

pub fn list_outstanding_returns(
    db: &Database,
    department_id: Option<String>,
    staff_id: Option<String>,
) -> AppResult<Vec<OutstandingReturnDto>> {
    db.with_read(|conn| {
        let mut clauses = vec![
            "c.status = 'posted'".to_string(),
            "cl.is_returnable = 1".to_string(),
            "cl.return_status IN ('out', 'partial')".to_string(),
        ];
        let mut binds: Vec<SqlValue> = Vec::new();

        if let Some(d) = department_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.department_id = ?".to_string());
            binds.push(SqlValue::Text(d.to_string()));
        }
        if let Some(s) = staff_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push("c.collector_staff_id = ?".to_string());
            binds.push(SqlValue::Text(s.to_string()));
        }

        let sql = format!(
            "SELECT cl.id, c.id, c.number, c.collection_date, c.department_id, d.name,
                    c.collector_staff_id, c.collector_name_snapshot, c.storekeeper_name_snapshot,
                    cl.item_id, i.name, bu.code, cl.base_qty_milli,
                    cl.returned_qty_milli, cl.damaged_qty_milli, cl.return_status
             FROM collection_lines cl
             JOIN collections c ON c.id = cl.collection_id
             JOIN departments d ON d.id = c.department_id
             JOIN items i ON i.id = cl.item_id
             JOIN units bu ON bu.id = i.base_unit_id
             WHERE {}
             ORDER BY c.collection_date ASC, c.posted_at ASC",
            clauses.join(" AND ")
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                let checked_out: i64 = r.get(12)?;
                let returned: i64 = r.get(13)?;
                let damaged: i64 = r.get(14)?;
                Ok(OutstandingReturnDto {
                    collection_line_id: r.get(0)?,
                    collection_id: r.get(1)?,
                    collection_number: r.get(2)?,
                    collection_date: r.get(3)?,
                    department_id: r.get(4)?,
                    department_name: r.get(5)?,
                    collector_staff_id: r.get(6)?,
                    collector_name: r.get(7)?,
                    storekeeper_name: r.get(8)?,
                    item_id: r.get(9)?,
                    item_name: r.get(10)?,
                    base_unit_code: r.get(11)?,
                    checked_out_milli: checked_out,
                    returned_milli: returned,
                    damaged_milli: damaged,
                    outstanding_milli: (checked_out - returned - damaged).max(0),
                    return_status: r.get(15)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn record_return(
    db: &Database,
    actor: &SessionUser,
    input: RecordReturnInput,
) -> AppResult<CollectionDto> {
    require_operator(actor)?;
    if input.returned_qty_milli < 0 || input.damaged_qty_milli < 0 {
        return Err(ApiError::validation("Return quantities cannot be negative."));
    }
    let total_processed = input.returned_qty_milli + input.damaged_qty_milli;
    if total_processed <= 0 {
        return Err(ApiError::validation(
            "Enter a returned or damaged quantity greater than zero.",
        ));
    }

    let return_date = parse_iso_date_or_today(input.return_date.as_deref(), "return_date")?;
    let year = year_from_iso_date(&return_date);
    let now = now_rfc3339();
    let notes = clean_opt_str(input.notes.as_deref());

    let col_id = db.transaction(|tx| {
        let keeper_row: Option<(String, bool, bool)> = tx
            .query_row(
                "SELECT full_name, is_store_staff, is_active FROM staff WHERE id = ?1",
                [&input.storekeeper_staff_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0)),
            )
            .optional()?;
        let (keeper_name, is_store_staff, keeper_active) = keeper_row
            .ok_or_else(|| ApiError::not_found("Storekeeper staff member not found.").with_field("storekeeper_staff_id"))?;
        if !keeper_active || !is_store_staff {
            return Err(ApiError::validation("Selected approver must be active Store Staff.").with_field("storekeeper_staff_id"));
        }

        let line_row: Option<(
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            String,
            i64,
            i64,
            i64,
            bool,
        )> = tx
            .query_row(
                "SELECT cl.collection_id, c.number, c.status, c.department_id, c.collector_staff_id, c.collector_name_snapshot,
                        cl.item_id, i.name, i.base_unit_id, cl.base_qty_milli, cl.returned_qty_milli, cl.damaged_qty_milli, cl.is_returnable
                 FROM collection_lines cl
                 JOIN collections c ON c.id = cl.collection_id
                 JOIN items i ON i.id = cl.item_id
                 WHERE cl.id = ?1",
                [&input.collection_line_id],
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
                        r.get(8)?,
                        r.get(9)?,
                        r.get(10)?,
                        r.get(11)?,
                        r.get::<_, i64>(12)? != 0,
                    ))
                },
            )
            .optional()?;

        let (
            col_id,
            col_number,
            col_status,
            dept_id,
            collector_id,
            collector_name,
            item_id,
            item_name,
            base_unit_id,
            checked_out_milli,
            old_returned,
            old_damaged,
            is_returnable,
        ) = line_row.ok_or_else(|| ApiError::not_found("Checked-out item line not found."))?;

        if col_status != "posted" {
            return Err(ApiError::conflict("Cannot record return on a reversed collection."));
        }
        if !is_returnable {
            return Err(ApiError::validation("This item is not marked as returnable."));
        }

        let outstanding = checked_out_milli - old_returned - old_damaged;
        if total_processed > outstanding {
            return Err(ApiError::validation(format!(
                "Return + damaged quantity ({}) exceeds outstanding quantity ({}).",
                format_qty_milli(total_processed),
                format_qty_milli(outstanding.max(0))
            )));
        }

        let new_returned = old_returned + input.returned_qty_milli;
        let new_damaged = old_damaged + input.damaged_qty_milli;
        let new_status = if new_returned + new_damaged >= checked_out_milli {
            "returned"
        } else {
            "partial"
        };

        tx.execute(
            "UPDATE collection_lines
             SET returned_qty_milli = ?1, damaged_qty_milli = ?2, return_status = ?3, returned_at = ?4
             WHERE id = ?5",
            params![new_returned, new_damaged, new_status, now, input.collection_line_id],
        )?;

        let avg_cost_micro: i64 = tx.query_row(
            "SELECT avg_cost_micro FROM items WHERE id = ?1",
            [&item_id],
            |r| r.get(0),
        )?;

        if total_processed > 0 {
            let ret_num = next_doc_number(tx, "return", year)?;
            let new_balance: i64 = tx.query_row(
                "UPDATE items SET on_hand_milli = on_hand_milli + ?1, updated_at = ?2 WHERE id = ?3 RETURNING on_hand_milli",
                params![total_processed, now, item_id],
                |r| r.get(0),
            )?;
            let val_minor = line_value_minor(total_processed, avg_cost_micro)?;

            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    department_id, doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, counterparty_staff_id, storekeeper_staff_id,
                    business_date, created_at
                ) VALUES (?1, ?2, 'tool_in', ?3, ?4, ?5, ?6, ?7, 'return', ?8, ?9, ?10, ?3, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    Uuid::now_v7().to_string(),
                    item_id,
                    total_processed,
                    new_balance,
                    avg_cost_micro,
                    val_minor,
                    dept_id,
                    input.collection_line_id,
                    ret_num,
                    base_unit_id,
                    MILLI_SCALE,
                    actor.id,
                    collector_id,
                    input.storekeeper_staff_id,
                    return_date,
                    now
                ],
            )?;
        }

        if input.damaged_qty_milli > 0 {
            let adj_id = Uuid::now_v7().to_string();
            let adj_num = next_doc_number(tx, "adjustment", year)?;
            let adj_notes = notes
                .clone()
                .unwrap_or_else(|| format!("Damaged on return from {col_number} ({collector_name})"));
            let new_balance: i64 = tx.query_row(
                "UPDATE items SET on_hand_milli = on_hand_milli - ?1, updated_at = ?2 WHERE id = ?3 RETURNING on_hand_milli",
                params![input.damaged_qty_milli, now, item_id],
                |r| r.get(0),
            )?;
            let dmg_val_minor = line_value_minor(input.damaged_qty_milli, avg_cost_micro)?;
            tx.execute(
                "INSERT INTO adjustments (id, number, reason, notes, posted_by_user_id, adjustment_date, posted_at)
                 VALUES (?1, ?2, 'damage', ?3, ?4, ?5, ?6)",
                params![adj_id, adj_num, adj_notes, actor.id, return_date, now],
            )?;
            tx.execute(
                "INSERT INTO adjustment_lines (id, adjustment_id, item_id, unit_id, input_qty_milli, factor_milli, base_qty_milli, unit_cost_micro)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?5, ?7)",
                params![
                    Uuid::now_v7().to_string(),
                    adj_id,
                    item_id,
                    base_unit_id,
                    -input.damaged_qty_milli,
                    MILLI_SCALE,
                    avg_cost_micro
                ],
            )?;
            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    department_id, doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, counterparty_staff_id, storekeeper_staff_id,
                    business_date, created_at
                ) VALUES (?1, ?2, 'adjustment', ?3, ?4, ?5, ?6, ?7, 'adjustment', ?8, ?9, ?10, ?3, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    Uuid::now_v7().to_string(),
                    item_id,
                    -input.damaged_qty_milli,
                    new_balance,
                    avg_cost_micro,
                    dmg_val_minor,
                    dept_id,
                    adj_id,
                    adj_num,
                    base_unit_id,
                    MILLI_SCALE,
                    actor.id,
                    collector_id,
                    input.storekeeper_staff_id,
                    return_date,
                    now
                ],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "return.recorded",
            "collections",
            &col_id,
            &format!(
                "Return logged for {item_name} from {collector_name} ({col_number}): {} returned, {} damaged · Verified by {keeper_name}",
                format_qty_milli(input.returned_qty_milli),
                format_qty_milli(input.damaged_qty_milli),
            ),
            serde_json::json!({
                "collection_number": col_number,
                "returned_qty_milli": input.returned_qty_milli,
                "damaged_qty_milli": input.damaged_qty_milli,
            }),
        )?;

        Ok(col_id)
    })?;

    get_collection(db, &col_id)
}
