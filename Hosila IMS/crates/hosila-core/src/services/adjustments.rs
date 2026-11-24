use std::collections::HashMap;

use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{line_value_minor, to_base_qty_milli};
use crate::domain::numbering::next_doc_number;
use crate::domain::uom::{format_qty_milli, resolve_factor_milli};
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_operator, verify_manager_pin};
use crate::services::items::{load_item_units, load_unit_map};
use crate::services::settings::get_settings;
use crate::services::{now_rfc3339, parse_iso_date_or_today, year_from_iso_date};
use crate::types::{
    AdjustmentDto, AdjustmentLineDto, CreateAdjustmentInput, SessionUser, UserRole,
};

const VALID_REASONS: &[&str] = &[
    "wastage",
    "spoilage",
    "damage",
    "expired",
    "found",
    "count_correction",
];

pub fn create_adjustment(
    db: &Database,
    actor: &SessionUser,
    input: CreateAdjustmentInput,
) -> AppResult<AdjustmentDto> {
    require_operator(actor)?;

    let reason = input.reason.trim().to_ascii_lowercase();
    if !VALID_REASONS.contains(&reason.as_str()) {
        return Err(ApiError::validation(
            "Reason must be one of: wastage, spoilage, damage, expired, found, count_correction.",
        )
        .with_field("reason"));
    }
    let notes = input.notes.trim().to_string();
    if notes.is_empty() {
        return Err(
            ApiError::validation("Notes are required for a stock adjustment.")
                .with_field("notes"),
        );
    }
    if input.lines.is_empty() {
        return Err(
            ApiError::validation("Add at least one adjustment line.").with_field("lines"),
        );
    }

    let adj_date = parse_iso_date_or_today(input.adjustment_date.as_deref(), "adjustment_date")?;
    let year = year_from_iso_date(&adj_date);
    let settings = get_settings(db)?;
    let allow_negative = settings.inventory_rules.allow_negative_stock;
    let pin_threshold = settings.inventory_rules.require_manager_pin_above_minor;
    let now = now_rfc3339();

    struct PrepLine {
        id: String,
        item_id: String,
        item_name: String,
        unit_id: String,
        input_qty_milli: i64,
        factor_milli: i64,
        base_qty_milli: i64,
        unit_cost_micro: i64,
        value_minor: i64,
    }

    let adj_id = Uuid::now_v7().to_string();

    // First prepare and compute total absolute value to check PIN threshold before committing writes
    let (prepared, abs_total_minor) = db.with_read(|conn| {
        let unit_map = load_unit_map(conn)?;
        let mut prepared = Vec::with_capacity(input.lines.len());
        let mut abs_total: i64 = 0;
        let mut cumulative_delta: HashMap<String, (String, i64, i64, String)> = HashMap::new();

        for l in &input.lines {
            if l.delta_qty_milli == 0 {
                return Err(
                    ApiError::validation("Adjustment delta quantity cannot be zero.")
                        .with_field("lines"),
                );
            }
            if matches!(
                reason.as_str(),
                "wastage" | "spoilage" | "damage" | "expired"
            ) && l.delta_qty_milli > 0
            {
                return Err(ApiError::validation(format!(
                    "Reason '{reason}' must use negative delta quantities."
                ))
                .with_field("lines"));
            }
            if reason == "found" && l.delta_qty_milli < 0 {
                return Err(
                    ApiError::validation("Reason 'found' must use positive delta quantities.")
                        .with_field("lines"),
                );
            }

            let row: Option<(String, String, i64, i64, bool)> = conn
                .query_row(
                    "SELECT name, base_unit_id, on_hand_milli, avg_cost_micro, is_active
                     FROM items WHERE id = ?1",
                    [&l.item_id],
                    |r| {
                        Ok((
                            r.get(0)?,
                            r.get(1)?,
                            r.get(2)?,
                            r.get(3)?,
                            r.get::<_, i64>(4)? != 0,
                        ))
                    },
                )
                .optional()?;
            let (item_name, base_unit_id, on_hand_milli, avg_cost_micro, is_active) =
                row.ok_or_else(|| ApiError::not_found("Adjusted item not found."))?;
            if !is_active {
                return Err(ApiError::conflict(format!(
                    "Cannot adjust archived item '{item_name}'."
                )));
            }

            let base_unit = unit_map
                .get(&base_unit_id)
                .ok_or_else(|| ApiError::internal("Missing item base unit"))?;
            let target_unit = unit_map
                .get(&l.unit_id)
                .ok_or_else(|| ApiError::not_found("Selected unit not found."))?;
            let item_units = load_item_units(conn, &l.item_id)?;
            let factor_milli = resolve_factor_milli(base_unit, target_unit, &item_units)?;
            let abs_base = to_base_qty_milli(l.delta_qty_milli.abs(), factor_milli)?;
            let base_qty_milli = if l.delta_qty_milli < 0 {
                -abs_base
            } else {
                abs_base
            };

            let entry = cumulative_delta
                .entry(l.item_id.clone())
                .or_insert_with(|| (item_name.clone(), on_hand_milli, 0, base_unit.plural.clone()));
            entry.2 += base_qty_milli;

            let value_minor = line_value_minor(abs_base, avg_cost_micro)?;
            abs_total += value_minor;
            prepared.push(PrepLine {
                id: Uuid::now_v7().to_string(),
                item_id: l.item_id.clone(),
                item_name,
                unit_id: l.unit_id.clone(),
                input_qty_milli: l.delta_qty_milli,
                factor_milli,
                base_qty_milli,
                unit_cost_micro: avg_cost_micro,
                value_minor,
            });
        }

        if !allow_negative {
            for (item_name, on_hand_milli, net_delta, unit_plural) in cumulative_delta.values() {
                if (*on_hand_milli + *net_delta) < 0 {
                    return Err(ApiError::insufficient_stock(
                        item_name,
                        &format!("{} {}", format_qty_milli((*on_hand_milli).max(0)), unit_plural),
                        &format!("{} {}", format_qty_milli(net_delta.abs()), unit_plural),
                    ));
                }
            }
        }

        Ok((prepared, abs_total))
    })?;

    let approved_by_user_id: Option<String> = if actor.role != UserRole::Admin
        && abs_total_minor >= pin_threshold
    {
        let pin = input.manager_pin.as_deref().ok_or_else(|| {
            ApiError::forbidden(
                "Manager PIN is required when stock adjustment value meets or exceeds the approval threshold.",
            )
            .with_field("manager_pin")
        })?;
        let approval = verify_manager_pin(db, pin)?;
        Some(approval.manager_user_id)
    } else if let Some(ref pin) = input.manager_pin.as_deref().filter(|p| !p.trim().is_empty()) {
        Some(verify_manager_pin(db, pin)?.manager_user_id)
    } else {
        None
    };

    db.transaction(|tx| {
        let number = next_doc_number(tx, "adjustment", year)?;
        tx.execute(
            "INSERT INTO adjustments (
                id, number, reason, notes, posted_by_user_id, approved_by_user_id, adjustment_date, posted_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                adj_id,
                number,
                reason,
                notes,
                actor.id,
                approved_by_user_id,
                adj_date,
                now
            ],
        )?;

        for line in &prepared {
            let current_on_hand: i64 = tx.query_row(
                "SELECT on_hand_milli FROM items WHERE id = ?1",
                [&line.item_id],
                |r| r.get(0),
            )?;
            let new_bal = current_on_hand + line.base_qty_milli;
            if !allow_negative && new_bal < 0 {
                return Err(ApiError::insufficient_stock(
                    &line.item_name,
                    &format_qty_milli(current_on_hand.max(0)),
                    &format_qty_milli(line.base_qty_milli.abs()),
                ));
            }

            tx.execute(
                "INSERT INTO adjustment_lines (
                    id, adjustment_id, item_id, unit_id, input_qty_milli, factor_milli, base_qty_milli, unit_cost_micro
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    line.id,
                    adj_id,
                    line.item_id,
                    line.unit_id,
                    line.input_qty_milli,
                    line.factor_milli,
                    line.base_qty_milli,
                    line.unit_cost_micro
                ],
            )?;

            tx.execute(
                "UPDATE items SET on_hand_milli = ?1, updated_at = ?2 WHERE id = ?3",
                params![new_bal, now, line.item_id],
            )?;

            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, business_date, created_at
                 ) VALUES (?1, ?2, 'adjustment', ?3, ?4, ?5, ?6, 'adjustment', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    Uuid::now_v7().to_string(),
                    line.item_id,
                    line.base_qty_milli,
                    new_bal,
                    line.unit_cost_micro,
                    line.value_minor,
                    adj_id,
                    number,
                    line.unit_id,
                    line.input_qty_milli,
                    line.factor_milli,
                    actor.id,
                    adj_date,
                    now
                ],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "adjustment.posted",
            "adjustments",
            &adj_id,
            &format!("Posted stock adjustment {number} ({reason}, {} lines)", prepared.len()),
            serde_json::json!({
                "number": number,
                "reason": reason,
                "abs_total_minor": abs_total_minor,
            }),
        )?;

        Ok(())
    })?;

    get_adjustment(db, &adj_id)
}

fn load_adjustment_lines(conn: &Connection, adj_id: &str) -> AppResult<Vec<AdjustmentLineDto>> {
    let mut stmt = conn.prepare(
        "SELECT al.id, al.item_id, i.name, al.unit_id, u.code,
                al.input_qty_milli, al.factor_milli, al.base_qty_milli, bu.code, al.unit_cost_micro
         FROM adjustment_lines al
         JOIN items i ON i.id = al.item_id
         JOIN units u ON u.id = al.unit_id
         JOIN units bu ON bu.id = i.base_unit_id
         WHERE al.adjustment_id = ?1
         ORDER BY al.rowid ASC",
    )?;
    let rows = stmt
        .query_map([adj_id], |r| {
            let base_qty: i64 = r.get(7)?;
            let unit_cost: i64 = r.get(9)?;
            let value_minor = line_value_minor(base_qty, unit_cost).unwrap_or(0);
            Ok(AdjustmentLineDto {
                id: r.get(0)?,
                item_id: r.get(1)?,
                item_name: r.get(2)?,
                unit_id: r.get(3)?,
                unit_code: r.get(4)?,
                input_qty_milli: r.get(5)?,
                factor_milli: r.get(6)?,
                base_qty_milli: base_qty,
                base_unit_code: r.get(8)?,
                unit_cost_micro: unit_cost,
                value_minor,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn get_adjustment_conn(conn: &Connection, id: &str) -> AppResult<AdjustmentDto> {
    let row: Option<(String, String, String, String, String, Option<String>, String, String)> = conn
        .query_row(
            "SELECT a.id, a.number, a.reason, a.notes, pu.full_name, au.full_name, a.adjustment_date, a.posted_at
             FROM adjustments a
             JOIN users pu ON pu.id = a.posted_by_user_id
             LEFT JOIN users au ON au.id = a.approved_by_user_id
             WHERE a.id = ?1",
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
    let (id, number, reason, notes, posted_by_name, approved_by_name, adjustment_date, posted_at) =
        row.ok_or_else(|| ApiError::not_found("Stock adjustment not found."))?;
    let lines = load_adjustment_lines(conn, &id)?;
    let total_value_minor: i64 = lines.iter().map(|l| l.value_minor).sum();
    Ok(AdjustmentDto {
        id,
        number,
        reason,
        notes,
        posted_by_name,
        approved_by_name,
        adjustment_date,
        posted_at,
        total_value_minor,
        lines,
    })
}

pub fn get_adjustment(db: &Database, id: &str) -> AppResult<AdjustmentDto> {
    db.with_read(|conn| get_adjustment_conn(conn, id))
}

pub fn list_adjustments(db: &Database, limit: Option<i32>) -> AppResult<Vec<AdjustmentDto>> {
    let lim = limit.unwrap_or(100).clamp(1, 500);
    db.with_read(|conn| {
        let mut stmt =
            conn.prepare("SELECT id FROM adjustments ORDER BY posted_at DESC LIMIT ?1")?;
        let ids = stmt
            .query_map([i64::from(lim)], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let mut out = Vec::with_capacity(ids.len());
        for id in ids {
            out.push(get_adjustment_conn(conn, &id)?);
        }
        Ok(out)
    })
}
