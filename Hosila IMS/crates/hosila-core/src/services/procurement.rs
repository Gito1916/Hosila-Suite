use std::collections::{HashMap, HashSet};

use chrono::{Datelike, SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{round_div_half_even, suggested_order_units_ceil, MILLI_SCALE};
use crate::domain::numbering::next_doc_number;
use crate::domain::uom::resolve_factor_milli;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_operator;
use crate::services::items::{load_item_units, load_unit_map};
use crate::types::{
    CreateProcurementListInput, ExtraChargeDto, GenerateProcurementDraftInput,
    ProcurementDraftLineDto, ProcurementLineDto, ProcurementLineInput, ProcurementListDto,
    ProcurementListSummaryDto, SessionUser, UpdateProcurementListInput,
};

const VALID_SCOPES: &[&str] = &["low_stock", "full", "custom"];
const VALID_STATUSES: &[&str] = &["draft", "finalised", "partial", "received", "closed"];

pub fn format_section_label(dept_name: Option<&str>, section_name: Option<&str>) -> String {
    if let Some(sec) = section_name.map(str::trim).filter(|s| !s.is_empty()) {
        return sec.to_ascii_uppercase();
    }
    let dept = dept_name.unwrap_or("GENERAL").trim();
    if dept.eq_ignore_ascii_case("F&B") || dept.eq_ignore_ascii_case("F & B") {
        "F & B".to_string()
    } else {
        dept.to_ascii_uppercase()
    }
}

pub fn section_sort_rank(label: &str) -> (usize, String) {
    let u = label.trim().to_ascii_uppercase();
    let rank = match u.as_str() {
        "KITCHEN" => 0,
        "PROTEIN" => 1,
        "F & B" | "F&B" => 2,
        "HOUSEKEEPING" | "HOUSE KEEPING" => 3,
        "MAINTENANCE" => 4,
        _ => 10,
    };
    (rank, u)
}

fn estimate_line_total_minor(
    ordered_qty_milli: Option<i64>,
    est_unit_cost_minor: Option<i64>,
    budget_amount_minor: Option<i64>,
) -> i64 {
    if let (Some(qty), Some(cost)) = (ordered_qty_milli, est_unit_cost_minor) {
        return round_div_half_even((qty as i128) * (cost as i128), MILLI_SCALE as i128) as i64;
    }
    budget_amount_minor.unwrap_or(0)
}

pub fn generate_procurement_draft(
    db: &Database,
    input: GenerateProcurementDraftInput,
) -> AppResult<Vec<ProcurementDraftLineDto>> {
    let scope = input.scope.trim().to_ascii_lowercase();
    if !VALID_SCOPES.contains(&scope.as_str()) {
        return Err(
            ApiError::validation("Scope must be 'low_stock', 'full', or 'custom'.")
                .with_field("scope"),
        );
    }

    db.with_read(|conn| {
        let unit_map = load_unit_map(conn)?;
        let selected_dept_set: HashSet<String> = input
            .department_ids
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        let custom_set: HashSet<String> = input
            .custom_item_ids
            .iter()
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();

        if scope != "custom" && selected_dept_set.is_empty() {
            return Err(
                ApiError::validation("Select at least one department.")
                    .with_field("department_ids"),
            );
        }
        if scope == "custom" && custom_set.is_empty() {
            return Err(
                ApiError::validation("Select at least one item for a custom procurement list.")
                    .with_field("custom_item_ids"),
            );
        }

        // Load item -> departments map
        let mut dept_map: HashMap<String, Vec<(String, String)>> = HashMap::new();
        {
            let mut d_stmt = conn.prepare(
                "SELECT idp.item_id, d.id, d.name
                 FROM item_departments idp
                 JOIN departments d ON d.id = idp.department_id
                 ORDER BY d.sort_order ASC, d.name ASC",
            )?;
            let d_rows = d_stmt
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (iid, did, dname) in d_rows {
                dept_map.entry(iid).or_default().push((did, dname));
            }
        }

        let mut stmt = conn.prepare(
            "SELECT i.id, i.sku, i.name, i.base_unit_id, i.default_purchase_unit_id,
                    ss.name, i.on_hand_milli, i.reorder_point_milli, i.par_level_milli,
                    i.avg_cost_micro, i.last_cost_micro
             FROM items i
             LEFT JOIN store_sections ss ON ss.id = i.store_section_id
             WHERE i.is_active = 1
             ORDER BY i.name ASC",
        )?;

        let items = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i64>(6)?,
                    r.get::<_, i64>(7)?,
                    r.get::<_, i64>(8)?,
                    r.get::<_, i64>(9)?,
                    r.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut draft = Vec::new();
        for (
            item_id,
            sku,
            item_name,
            base_unit_id,
            purchase_unit_id,
            section_name,
            on_hand_milli,
            reorder_point_milli,
            par_level_milli,
            avg_cost_micro,
            last_cost_micro,
        ) in items
        {
            let item_depts = dept_map.get(&item_id).cloned().unwrap_or_default();
            let matching_dept_name = if scope == "custom" {
                if !custom_set.contains(&item_id) {
                    continue;
                }
                item_depts.first().map(|(_, n)| n.clone())
            } else {
                let first_match = item_depts
                    .iter()
                    .find(|(did, _)| selected_dept_set.contains(did))
                    .map(|(_, n)| n.clone());
                let Some(m_name) = first_match else {
                    continue;
                };
                if scope == "low_stock"
                    && !(on_hand_milli <= 0
                        || (reorder_point_milli > 0 && on_hand_milli <= reorder_point_milli))
                {
                    continue;
                }
                Some(m_name)
            };

            let base_unit = unit_map
                .get(&base_unit_id)
                .ok_or_else(|| ApiError::internal("Missing base unit"))?;
            let purch_unit = unit_map.get(&purchase_unit_id).unwrap_or(base_unit);
            let item_units = load_item_units(conn, &item_id)?;
            let factor_milli =
                resolve_factor_milli(base_unit, purch_unit, &item_units).unwrap_or(MILLI_SCALE);

            let deficit = (par_level_milli - on_hand_milli).max(0);
            let suggested_qty_milli = suggested_order_units_ceil(deficit, factor_milli)?;

            let ref_cost_micro = if last_cost_micro > 0 {
                last_cost_micro
            } else {
                avg_cost_micro
            };
            let est_unit_cost_minor = if ref_cost_micro > 0 {
                Some(
                    round_div_half_even(
                        (ref_cost_micro as i128) * (factor_milli as i128),
                        10_000_000,
                    ) as i64,
                )
            } else {
                None
            };

            let section_label =
                format_section_label(matching_dept_name.as_deref(), section_name.as_deref());

            draft.push(ProcurementDraftLineDto {
                item_id,
                item_name,
                sku,
                section_label,
                unit_id: purch_unit.id.clone(),
                unit_code: purch_unit.code.clone(),
                factor_milli,
                on_hand_milli,
                par_level_milli,
                suggested_qty_milli,
                est_unit_cost_minor,
            });
        }

        draft.sort_by(|a, b| {
            section_sort_rank(&a.section_label)
                .cmp(&section_sort_rank(&b.section_label))
                .then_with(|| a.item_name.cmp(&b.item_name))
        });

        Ok(draft)
    })
}

fn insert_procurement_lines_tx(
    tx: &rusqlite::Transaction<'_>,
    list_id: &str,
    lines: &[ProcurementLineInput],
) -> AppResult<()> {
    if lines.is_empty() {
        return Err(
            ApiError::validation("Procurement list must include at least one line.")
                .with_field("lines"),
        );
    }
    let unit_map = load_unit_map(tx)?;

    for line in lines {
        let item_row: Option<(String, String, i64, i64)> = tx
            .query_row(
                "SELECT base_unit_id, default_purchase_unit_id, on_hand_milli, par_level_milli
                 FROM items WHERE id = ?1",
                [&line.item_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
            )
            .optional()?;
        let (base_unit_id, default_purch_unit_id, on_hand_milli, par_level_milli) =
            item_row.ok_or_else(|| ApiError::not_found("Procurement line item not found."))?;

        let target_unit_id = line
            .unit_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(&default_purch_unit_id)
            .to_string();

        let base_unit = unit_map
            .get(&base_unit_id)
            .ok_or_else(|| ApiError::internal("Missing base unit"))?;
        let target_unit = unit_map
            .get(&target_unit_id)
            .ok_or_else(|| ApiError::not_found("Procurement line unit not found."))?;
        let item_units = load_item_units(tx, &line.item_id)?;
        let factor_milli = resolve_factor_milli(base_unit, target_unit, &item_units)?;

        let deficit = (par_level_milli - on_hand_milli).max(0);
        let suggested = suggested_order_units_ceil(deficit, factor_milli)?;

        let section = line.section_label.trim();
        let section_label = if section.is_empty() {
            "GENERAL".to_string()
        } else {
            section.to_ascii_uppercase()
        };
        let buyer_name = line
            .buyer_name
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        tx.execute(
            "INSERT INTO procurement_lines (
                id, list_id, item_id, section_label, buyer_name, unit_id, factor_milli,
                suggested_qty_milli, ordered_qty_milli, est_unit_cost_minor, budget_amount_minor, received_qty_milli
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0)",
            params![
                Uuid::now_v7().to_string(),
                list_id,
                line.item_id,
                section_label,
                buyer_name,
                target_unit_id,
                factor_milli,
                suggested,
                line.ordered_qty_milli,
                line.est_unit_cost_minor,
                line.budget_amount_minor
            ],
        )?;
    }

    Ok(())
}

pub fn create_procurement_list(
    db: &Database,
    actor: &SessionUser,
    input: CreateProcurementListInput,
) -> AppResult<ProcurementListDto> {
    require_operator(actor)?;
    let title = input.title.trim().to_string();
    if title.is_empty() {
        return Err(ApiError::validation("Procurement list title is required.").with_field("title"));
    }
    let scope = input.scope.trim().to_ascii_lowercase();
    if !VALID_SCOPES.contains(&scope.as_str()) {
        return Err(
            ApiError::validation("Scope must be 'low_stock', 'full', or 'custom'.")
                .with_field("scope"),
        );
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let year = Utc::now().year();
    let list_id = Uuid::now_v7().to_string();

    db.transaction(|tx| {
        let number = next_doc_number(tx, "procurement_list", year)?;
        let dept_ids_json = serde_json::to_string(&input.department_ids)?;
        let extra_json = serde_json::to_string(&input.extra_charges)?;

        tx.execute(
            "INSERT INTO procurement_lists (
                id, number, title, scope, department_ids_json, status, prepared_by_user_id, extra_charges_json, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 'draft', ?6, ?7, ?8, ?8)",
            params![
                list_id,
                number,
                title,
                scope,
                dept_ids_json,
                actor.id,
                extra_json,
                now
            ],
        )?;

        insert_procurement_lines_tx(tx, &list_id, &input.lines)?;

        record_activity(
            tx,
            Some(&actor.id),
            "procurement.created",
            "procurement_lists",
            &list_id,
            &format!("Prepared procurement list {number} ({title})"),
            serde_json::json!({ "number": number, "line_count": input.lines.len() }),
        )?;

        Ok(())
    })?;

    get_procurement_list(db, &list_id)
}

pub fn update_procurement_list(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateProcurementListInput,
) -> AppResult<ProcurementListDto> {
    require_operator(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let existing: Option<(String, String, String)> = tx
            .query_row(
                "SELECT title, status, extra_charges_json FROM procurement_lists WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (old_title, old_status, old_extra) =
            existing.ok_or_else(|| ApiError::not_found("Procurement list not found."))?;

        if matches!(old_status.as_str(), "received" | "closed") && input.lines.is_some() {
            return Err(ApiError::conflict(
                "Cannot edit lines on a completed/closed procurement list.",
            ));
        }

        let new_title = match input.title {
            Some(t) => {
                let c = t.trim().to_string();
                if c.is_empty() {
                    return Err(
                        ApiError::validation("Procurement list title cannot be empty.")
                            .with_field("title"),
                    );
                }
                c
            }
            None => old_title,
        };
        let new_status = match input.status {
            Some(s) => {
                let c = s.trim().to_ascii_lowercase();
                if !VALID_STATUSES.contains(&c.as_str()) {
                    return Err(
                        ApiError::validation(format!("Invalid procurement status '{c}'."))
                            .with_field("status"),
                    );
                }
                c
            }
            None => old_status,
        };
        let new_extra_json = match input.extra_charges {
            Some(ec) => serde_json::to_string(&ec)?,
            None => old_extra,
        };

        tx.execute(
            "UPDATE procurement_lists SET title = ?1, status = ?2, extra_charges_json = ?3, updated_at = ?4 WHERE id = ?5",
            params![new_title, new_status, new_extra_json, now, id],
        )?;

        if let Some(lines) = input.lines {
            tx.execute("DELETE FROM procurement_lines WHERE list_id = ?1", [id])?;
            insert_procurement_lines_tx(tx, id, &lines)?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "procurement.updated",
            "procurement_lists",
            id,
            &format!("Updated procurement list {new_title} ({new_status})"),
            serde_json::json!({ "status": new_status }),
        )?;

        Ok(())
    })?;

    get_procurement_list(db, id)
}

pub fn get_procurement_list(db: &Database, id: &str) -> AppResult<ProcurementListDto> {
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
        )> = conn
            .query_row(
                "SELECT pl.id, pl.number, pl.title, pl.scope, pl.department_ids_json,
                        pl.status, u.full_name, pl.extra_charges_json, pl.created_at, pl.updated_at
                 FROM procurement_lists pl
                 JOIN users u ON u.id = pl.prepared_by_user_id
                 WHERE pl.id = ?1",
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
                    ))
                },
            )
            .optional()?;

        let (
            pid,
            number,
            title,
            scope,
            dept_json,
            status,
            prepared_by_name,
            extra_json,
            created_at,
            updated_at,
        ) = row.ok_or_else(|| ApiError::not_found("Procurement list not found."))?;

        let department_ids: Vec<String> = serde_json::from_str(&dept_json).unwrap_or_default();
        let extra_charges: Vec<ExtraChargeDto> =
            serde_json::from_str(&extra_json).unwrap_or_default();

        let mut stmt = conn.prepare(
            "SELECT l.id, l.item_id, i.name, bu.code, l.section_label, l.buyer_name,
                    l.unit_id, u.code, l.factor_milli, l.suggested_qty_milli,
                    l.ordered_qty_milli, l.est_unit_cost_minor, l.budget_amount_minor, l.received_qty_milli
             FROM procurement_lines l
             JOIN items i ON i.id = l.item_id
             JOIN units bu ON bu.id = i.base_unit_id
             LEFT JOIN units u ON u.id = l.unit_id
             WHERE l.list_id = ?1
             ORDER BY i.name ASC",
        )?;
        let mut lines = stmt
            .query_map([&pid], |r| {
                Ok(ProcurementLineDto {
                    id: r.get(0)?,
                    item_id: r.get(1)?,
                    item_name: r.get(2)?,
                    base_unit_code: r.get(3)?,
                    section_label: r.get(4)?,
                    buyer_name: r.get(5)?,
                    unit_id: r.get(6)?,
                    unit_code: r.get(7)?,
                    factor_milli: r.get(8)?,
                    suggested_qty_milli: r.get(9)?,
                    ordered_qty_milli: r.get(10)?,
                    est_unit_cost_minor: r.get(11)?,
                    budget_amount_minor: r.get(12)?,
                    received_qty_milli: r.get(13)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        lines.sort_by(|a, b| {
            section_sort_rank(&a.section_label)
                .cmp(&section_sort_rank(&b.section_label))
                .then_with(|| a.item_name.cmp(&b.item_name))
        });

        let lines_total: i64 = lines
            .iter()
            .map(|l| {
                estimate_line_total_minor(
                    l.ordered_qty_milli,
                    l.est_unit_cost_minor,
                    l.budget_amount_minor,
                )
            })
            .sum();
        let extras_total: i64 = extra_charges.iter().map(|e| e.amount_minor).sum();

        Ok(ProcurementListDto {
            id: pid,
            number,
            title,
            scope,
            department_ids,
            status,
            prepared_by_name,
            extra_charges,
            lines,
            estimated_total_minor: lines_total + extras_total,
            created_at,
            updated_at,
        })
    })
}

pub fn list_procurement_lists(
    db: &Database,
    status_filter: Option<String>,
) -> AppResult<Vec<ProcurementListSummaryDto>> {
    db.with_read(|conn| {
        let clean_status = status_filter
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToString::to_string);

        let mut stmt = conn.prepare(
            "SELECT pl.id, pl.number, pl.title, pl.scope, pl.department_ids_json,
                    pl.status, u.full_name, pl.extra_charges_json, pl.created_at, pl.updated_at
             FROM procurement_lists pl
             JOIN users u ON u.id = pl.prepared_by_user_id
             ORDER BY pl.created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |r| {
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
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut out = Vec::new();
        for (id, number, title, scope, dept_json, status, prep_name, extra_json, created_at, updated_at) in rows {
            if let Some(ref sf) = clean_status {
                if sf != &status {
                    continue;
                }
            }
            let department_ids: Vec<String> = serde_json::from_str(&dept_json).unwrap_or_default();
            let extra_charges: Vec<ExtraChargeDto> =
                serde_json::from_str(&extra_json).unwrap_or_default();

            let mut l_stmt = conn.prepare(
                "SELECT ordered_qty_milli, est_unit_cost_minor, budget_amount_minor
                 FROM procurement_lines WHERE list_id = ?1",
            )?;
            let l_rows = l_stmt
                .query_map([&id], |r| {
                    Ok((
                        r.get::<_, Option<i64>>(0)?,
                        r.get::<_, Option<i64>>(1)?,
                        r.get::<_, Option<i64>>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;

            let line_count = l_rows.len() as i32;
            let lines_total: i64 = l_rows
                .into_iter()
                .map(|(q, c, b)| estimate_line_total_minor(q, c, b))
                .sum();
            let extras_total: i64 = extra_charges.iter().map(|e| e.amount_minor).sum();

            out.push(ProcurementListSummaryDto {
                id,
                number,
                title,
                scope,
                department_ids,
                status,
                prepared_by_name: prep_name,
                line_count,
                estimated_total_minor: lines_total + extras_total,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    })
}
