use std::collections::HashMap;

use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension, Transaction};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::costing::recalculate_wac_micro;
use crate::domain::money::{derive_unit_cost_micro, round_div_half_even, to_base_qty_milli};
use crate::domain::numbering::next_doc_number;
use crate::domain::uom::{format_qty_milli, resolve_factor_milli};
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_operator, verify_manager_pin};
use crate::services::items::{load_item_units, load_unit_map};
use crate::services::settings::get_settings;
use crate::services::{
    clean_opt_str, now_rfc3339, parse_iso_date_or_today, today_iso, year_from_iso_date,
};
use crate::types::{
    CreateReceiptInput, ExtraChargeDto, ReceiptDto, ReceiptFilter, ReceiptLineDto,
    ReceiptLineInput, SessionUser, UserRole,
};

#[allow(clippy::too_many_arguments)]
pub fn post_receipt_tx(
    tx: &Transaction<'_>,
    actor: &SessionUser,
    source_type: &str,
    source_filename: Option<&str>,
    procurement_list_id: Option<&str>,
    supplier_id: Option<&str>,
    invoice_ref: Option<&str>,
    received_by_staff_id: &str,
    approved_by_staff_id: &str,
    received_at: Option<&str>,
    disbursement_minor: Option<i64>,
    extra_charges: &[ExtraChargeDto],
    notes: Option<&str>,
    lines: &[ReceiptLineInput],
) -> AppResult<String> {
    if lines.is_empty() {
        return Err(ApiError::validation("Add at least one received item line.").with_field("lines"));
    }

    let rec_date = parse_iso_date_or_today(received_at, "received_at")?;
    let year = year_from_iso_date(&rec_date);
    let now = now_rfc3339();

    let rec_staff: Option<(String, bool)> = tx
        .query_row(
            "SELECT full_name, is_active FROM staff WHERE id = ?1",
            [received_by_staff_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
        )
        .optional()?;
    let (rec_staff_name, rec_active) = rec_staff.ok_or_else(|| {
        ApiError::not_found("Receiving staff member not found.")
            .with_field("received_by_staff_id")
    })?;
    if !rec_active {
        return Err(ApiError::conflict("Selected receiving staff member is inactive.")
            .with_field("received_by_staff_id"));
    }

    let app_staff: Option<(String, bool, bool)> = tx
        .query_row(
            "SELECT full_name, is_store_staff, is_active FROM staff WHERE id = ?1",
            [approved_by_staff_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0, r.get::<_, i64>(2)? != 0)),
        )
        .optional()?;
    let (app_staff_name, app_is_store, app_active) = app_staff.ok_or_else(|| {
        ApiError::not_found("Approving storekeeper not found.")
            .with_field("approved_by_staff_id")
    })?;
    if !app_active || !app_is_store {
        return Err(
            ApiError::validation("Approving staff must be active Store Staff.")
                .with_field("approved_by_staff_id"),
        );
    }

    if let Some(sup_id) = supplier_id {
        let sup_ok: Option<String> = tx
            .query_row("SELECT id FROM suppliers WHERE id = ?1", [sup_id], |r| r.get(0))
            .optional()?;
        if sup_ok.is_none() {
            return Err(ApiError::not_found("Supplier not found.").with_field("supplier_id"));
        }
    }

    let unit_map = load_unit_map(tx)?;
    let receipt_id = Uuid::now_v7().to_string();
    let grn_num = next_doc_number(tx, "receipt", year)?;

    let mut lines_total_minor: i64 = 0;
    struct PreparedReceiptLine {
        id: String,
        procurement_line_id: Option<String>,
        item_id: String,
        unit_id: String,
        input_qty_milli: i64,
        factor_milli: i64,
        base_qty_milli: i64,
        unit_cost_minor: i64,
        line_total_minor: i64,
        base_unit_cost_micro: i64,
    }
    let mut prepared = Vec::with_capacity(lines.len());

    for line in lines {
        if line.input_qty_milli <= 0 {
            return Err(
                ApiError::validation("Received quantity must be greater than zero.")
                    .with_field("lines"),
            );
        }
        if line.unit_cost_minor < 0 || line.line_total_minor < 0 {
            return Err(ApiError::validation("Receipt costs cannot be negative.").with_field("lines"));
        }

        let item_row: Option<(String, bool)> = tx
            .query_row(
                "SELECT base_unit_id, is_active FROM items WHERE id = ?1",
                [&line.item_id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .optional()?;
        let (base_unit_id, is_active) =
            item_row.ok_or_else(|| ApiError::not_found("Received item was not found."))?;
        if !is_active {
            return Err(ApiError::conflict("Cannot receive stock into an archived item."));
        }

        let base_unit = unit_map
            .get(&base_unit_id)
            .ok_or_else(|| ApiError::internal("Missing base unit"))?;
        let target_unit = unit_map
            .get(&line.unit_id)
            .ok_or_else(|| ApiError::not_found("Received unit of measure not found."))?;
        let item_units = load_item_units(tx, &line.item_id)?;
        let factor_milli = resolve_factor_milli(base_unit, target_unit, &item_units)?;
        let base_qty_milli = to_base_qty_milli(line.input_qty_milli, factor_milli)?;
        let base_unit_cost_micro = derive_unit_cost_micro(line.line_total_minor, base_qty_milli)?;

        lines_total_minor += line.line_total_minor;
        prepared.push(PreparedReceiptLine {
            id: Uuid::now_v7().to_string(),
            procurement_line_id: line.procurement_line_id.clone(),
            item_id: line.item_id.clone(),
            unit_id: line.unit_id.clone(),
            input_qty_milli: line.input_qty_milli,
            factor_milli,
            base_qty_milli,
            unit_cost_minor: line.unit_cost_minor,
            line_total_minor: line.line_total_minor,
            base_unit_cost_micro,
        });
    }

    let extras_total_minor: i64 = extra_charges.iter().map(|e| e.amount_minor).sum();
    let actual_expense_minor = lines_total_minor + extras_total_minor;
    let refunded_minor = disbursement_minor.map(|d| d - actual_expense_minor);
    let extra_json = serde_json::to_string(extra_charges)?;

    tx.execute(
        "INSERT INTO receipts (
            id, number, procurement_list_id, supplier_id, invoice_ref,
            source_type, source_filename,
            received_by_staff_id, received_by_name_snapshot,
            approved_by_staff_id, approved_by_name_snapshot, posted_by_user_id,
            received_at, disbursement_minor, actual_expense_minor, refunded_minor,
            extra_charges_json, total_minor, notes, status, created_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, 'posted', ?20)",
        params![
            receipt_id,
            grn_num,
            procurement_list_id,
            supplier_id,
            invoice_ref,
            source_type,
            source_filename,
            received_by_staff_id,
            rec_staff_name,
            approved_by_staff_id,
            app_staff_name,
            actor.id,
            rec_date,
            disbursement_minor,
            actual_expense_minor,
            refunded_minor,
            extra_json,
            lines_total_minor,
            notes,
            now
        ],
    )?;

    for p in &prepared {
        tx.execute(
            "INSERT INTO receipt_lines (
                id, receipt_id, procurement_line_id, item_id, unit_id,
                input_qty_milli, factor_milli, base_qty_milli, unit_cost_minor, line_total_minor
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                p.id,
                receipt_id,
                p.procurement_line_id,
                p.item_id,
                p.unit_id,
                p.input_qty_milli,
                p.factor_milli,
                p.base_qty_milli,
                p.unit_cost_minor,
                p.line_total_minor
            ],
        )?;

        let (cur_on_hand, cur_avg_cost, cur_last_cost, cur_cost_missing): (i64, i64, i64, bool) = tx.query_row(
            "SELECT on_hand_milli, avg_cost_micro, last_cost_micro, cost_missing FROM items WHERE id = ?1",
            [&p.item_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, i64>(3)? != 0)),
        )?;

        let (new_avg_cost, new_last_cost, new_cost_missing) = if p.base_unit_cost_micro > 0 {
            let wac = recalculate_wac_micro(
                cur_on_hand,
                cur_avg_cost,
                p.base_qty_milli,
                p.base_unit_cost_micro,
            )?;
            (wac, p.base_unit_cost_micro, false)
        } else {
            (cur_avg_cost, cur_last_cost, cur_cost_missing)
        };

        let new_balance: i64 = tx.query_row(
            "UPDATE items
             SET on_hand_milli = on_hand_milli + ?1,
                 avg_cost_micro = ?2,
                 last_cost_micro = ?3,
                 cost_missing = ?4,
                 updated_at = ?5
             WHERE id = ?6
             RETURNING on_hand_milli",
            params![
                p.base_qty_milli,
                new_avg_cost,
                new_last_cost,
                if new_cost_missing { 1 } else { 0 },
                now,
                p.item_id
            ],
            |r| r.get(0),
        )?;

        tx.execute(
            "INSERT INTO stock_movements (
                id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                doc_type, doc_id, doc_number,
                input_unit_id, input_qty_milli, factor_milli,
                actor_user_id, counterparty_staff_id, storekeeper_staff_id,
                business_date, created_at
             ) VALUES (?1, ?2, 'receipt', ?3, ?4, ?5, ?6, 'receipt', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
            params![
                Uuid::now_v7().to_string(),
                p.item_id,
                p.base_qty_milli,
                new_balance,
                p.base_unit_cost_micro,
                p.line_total_minor,
                receipt_id,
                grn_num,
                p.unit_id,
                p.input_qty_milli,
                p.factor_milli,
                actor.id,
                received_by_staff_id,
                approved_by_staff_id,
                rec_date,
                now
            ],
        )?;

        if let Some(ref pl_id) = p.procurement_line_id {
            tx.execute(
                "UPDATE procurement_lines SET received_qty_milli = received_qty_milli + ?1 WHERE id = ?2",
                params![p.input_qty_milli, pl_id],
            )?;
        }
    }

    if let Some(list_id) = procurement_list_id {
        let pending_lines: i64 = tx.query_row(
            "SELECT COUNT(*) FROM procurement_lines
             WHERE list_id = ?1
               AND COALESCE(ordered_qty_milli, 0) > 0
               AND received_qty_milli < COALESCE(ordered_qty_milli, 0)",
            [list_id],
            |r| r.get(0),
        )?;
        let new_list_status = if pending_lines == 0 {
            "received"
        } else {
            "partial"
        };
        tx.execute(
            "UPDATE procurement_lists SET status = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_list_status, now, list_id],
        )?;
    }

    record_activity(
        tx,
        Some(&actor.id),
        "receipt.posted",
        "receipts",
        &receipt_id,
        &format!(
            "Restock {grn_num} received by {rec_staff_name}, approved by {app_staff_name} ({} items)",
            prepared.len()
        ),
        serde_json::json!({
            "number": grn_num,
            "source_type": source_type,
            "total_minor": lines_total_minor,
            "actual_expense_minor": actual_expense_minor,
        }),
    )?;

    Ok(receipt_id)
}

pub fn create_receipt(
    db: &Database,
    actor: &SessionUser,
    input: CreateReceiptInput,
) -> AppResult<ReceiptDto> {
    require_operator(actor)?;
    let invoice_ref = input
        .invoice_ref
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let notes = input
        .notes
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);

    let receipt_id = db.transaction(|tx| {
        post_receipt_tx(
            tx,
            actor,
            "manual",
            None,
            input.procurement_list_id.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            input.supplier_id.as_deref().map(str::trim).filter(|s| !s.is_empty()),
            invoice_ref.as_deref(),
            &input.received_by_staff_id,
            &input.approved_by_staff_id,
            input.received_at.as_deref(),
            input.disbursement_minor,
            &input.extra_charges,
            notes.as_deref(),
            &input.lines,
        )
    })?;

    get_receipt(db, &receipt_id)
}

fn load_receipt_lines(conn: &Connection, receipt_id: &str) -> AppResult<Vec<ReceiptLineDto>> {
    let mut stmt = conn.prepare(
        "SELECT rl.id, rl.procurement_line_id, rl.item_id, i.name, rl.unit_id, u.code,
                rl.input_qty_milli, rl.factor_milli, rl.base_qty_milli, bu.code,
                rl.unit_cost_minor, rl.line_total_minor
         FROM receipt_lines rl
         JOIN items i ON i.id = rl.item_id
         JOIN units u ON u.id = rl.unit_id
         JOIN units bu ON bu.id = i.base_unit_id
         WHERE rl.receipt_id = ?1
         ORDER BY i.name ASC",
    )?;
    let rows = stmt
        .query_map([receipt_id], |r| {
            Ok(ReceiptLineDto {
                id: r.get(0)?,
                procurement_line_id: r.get(1)?,
                item_id: r.get(2)?,
                item_name: r.get(3)?,
                unit_id: r.get(4)?,
                unit_code: r.get(5)?,
                input_qty_milli: r.get(6)?,
                factor_milli: r.get(7)?,
                base_qty_milli: r.get(8)?,
                base_unit_code: r.get(9)?,
                unit_cost_minor: r.get(10)?,
                line_total_minor: r.get(11)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn get_receipt(db: &Database, id: &str) -> AppResult<ReceiptDto> {
    db.with_read(|conn| get_receipt_conn(conn, id))
}

pub fn list_receipts(db: &Database, filter: ReceiptFilter) -> AppResult<Vec<ReceiptDto>> {
    db.with_read(|conn| {
        let mut clauses = Vec::new();
        let mut binds: Vec<SqlValue> = Vec::new();

        if let Some(pid) = clean_opt_str(filter.procurement_list_id.as_deref()) {
            clauses.push("r.procurement_list_id = ?".to_string());
            binds.push(SqlValue::Text(pid));
        }
        if let Some(sd) = clean_opt_str(filter.start_date.as_deref()) {
            clauses.push("r.received_at >= ?".to_string());
            binds.push(SqlValue::Text(sd));
        }
        if let Some(ed) = clean_opt_str(filter.end_date.as_deref()) {
            clauses.push("r.received_at <= ?".to_string());
            binds.push(SqlValue::Text(ed));
        }
        if let Some(st) = clean_opt_str(filter.status.as_deref()) {
            clauses.push("r.status = ?".to_string());
            binds.push(SqlValue::Text(st));
        }
        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };
        let limit = i64::from(filter.limit.unwrap_or(100).clamp(1, 500));
        binds.push(SqlValue::Integer(limit));

        let sql = format!(
            "SELECT r.id, r.number, r.procurement_list_id, r.supplier_id, sup.name, r.invoice_ref,
                    r.source_type, r.source_filename, r.received_by_staff_id, r.received_by_name_snapshot,
                    r.approved_by_staff_id, r.approved_by_name_snapshot, u.full_name,
                    r.received_at, r.disbursement_minor, r.actual_expense_minor, r.refunded_minor,
                    r.extra_charges_json, r.total_minor, r.notes, r.status, r.created_at
             FROM receipts r
             JOIN users u ON u.id = r.posted_by_user_id
             LEFT JOIN suppliers sup ON sup.id = r.supplier_id
             {where_sql}
             ORDER BY r.received_at DESC, r.created_at DESC
             LIMIT ?"
        );
        let mut stmt = conn.prepare(&sql)?;
        let headers = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, Option<String>>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, String>(9)?,
                    r.get::<_, Option<String>>(10)?,
                    r.get::<_, String>(11)?,
                    r.get::<_, String>(12)?,
                    r.get::<_, String>(13)?,
                    r.get::<_, Option<i64>>(14)?,
                    r.get::<_, Option<i64>>(15)?,
                    r.get::<_, Option<i64>>(16)?,
                    r.get::<_, String>(17)?,
                    r.get::<_, i64>(18)?,
                    r.get::<_, Option<String>>(19)?,
                    r.get::<_, String>(20)?,
                    r.get::<_, String>(21)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let mut lines_by_receipt: HashMap<String, Vec<ReceiptLineDto>> = HashMap::new();
        if !headers.is_empty() {
            let placeholders = vec!["?"; headers.len()].join(", ");
            let line_sql = format!(
                "SELECT rl.receipt_id, rl.id, rl.procurement_line_id, rl.item_id, i.name, rl.unit_id, u.code,
                        rl.input_qty_milli, rl.factor_milli, rl.base_qty_milli, bu.code,
                        rl.unit_cost_minor, rl.line_total_minor
                 FROM receipt_lines rl
                 JOIN items i ON i.id = rl.item_id
                 JOIN units u ON u.id = rl.unit_id
                 JOIN units bu ON bu.id = i.base_unit_id
                 WHERE rl.receipt_id IN ({placeholders})
                 ORDER BY i.name ASC"
            );
            let mut l_stmt = conn.prepare(&line_sql)?;
            let id_binds: Vec<SqlValue> = headers.iter().map(|h| SqlValue::Text(h.0.clone())).collect();
            let l_rows = l_stmt
                .query_map(rusqlite::params_from_iter(id_binds), |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        ReceiptLineDto {
                            id: r.get(1)?,
                            procurement_line_id: r.get(2)?,
                            item_id: r.get(3)?,
                            item_name: r.get(4)?,
                            unit_id: r.get(5)?,
                            unit_code: r.get(6)?,
                            input_qty_milli: r.get(7)?,
                            factor_milli: r.get(8)?,
                            base_qty_milli: r.get(9)?,
                            base_unit_code: r.get(10)?,
                            unit_cost_minor: r.get(11)?,
                            line_total_minor: r.get(12)?,
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (rid, dto) in l_rows {
                lines_by_receipt.entry(rid).or_default().push(dto);
            }
        }

        let mut out = Vec::with_capacity(headers.len());
        for (
            rid,
            number,
            procurement_list_id,
            supplier_id,
            supplier_name,
            invoice_ref,
            source_type,
            source_filename,
            received_by_staff_id,
            received_by_name,
            approved_by_staff_id,
            approved_by_name,
            posted_by_name,
            received_at,
            disbursement_minor,
            actual_expense_minor,
            refunded_minor,
            extra_json,
            total_minor,
            notes,
            status,
            created_at,
        ) in headers
        {
            let extra_charges: Vec<ExtraChargeDto> =
                serde_json::from_str(&extra_json).unwrap_or_default();
            let lines = lines_by_receipt.remove(&rid).unwrap_or_default();
            out.push(ReceiptDto {
                id: rid,
                number,
                procurement_list_id,
                supplier_id,
                supplier_name,
                invoice_ref,
                source_type,
                source_filename,
                received_by_staff_id,
                received_by_name,
                approved_by_staff_id,
                approved_by_name,
                posted_by_name,
                received_at,
                disbursement_minor,
                actual_expense_minor,
                refunded_minor,
                extra_charges,
                total_minor,
                notes,
                status,
                created_at,
                lines,
            });
        }
        Ok(out)
    })
}

fn get_receipt_conn(conn: &Connection, id: &str) -> AppResult<ReceiptDto> {
    let row: Option<(
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        Option<String>,
        String,
        Option<String>,
        String,
        String,
        String,
        Option<i64>,
        Option<i64>,
        Option<i64>,
        String,
        i64,
        Option<String>,
        String,
        String,
    )> = conn
        .query_row(
            "SELECT r.id, r.number, r.procurement_list_id, r.supplier_id, sup.name, r.invoice_ref,
                    r.source_type, r.source_filename, r.received_by_staff_id, r.received_by_name_snapshot,
                    r.approved_by_staff_id, r.approved_by_name_snapshot, u.full_name,
                    r.received_at, r.disbursement_minor, r.actual_expense_minor, r.refunded_minor,
                    r.extra_charges_json, r.total_minor, r.notes, r.status, r.created_at
             FROM receipts r
             JOIN users u ON u.id = r.posted_by_user_id
             LEFT JOIN suppliers sup ON sup.id = r.supplier_id
             WHERE r.id = ?1",
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
                    r.get(13)?,
                    r.get(14)?,
                    r.get(15)?,
                    r.get(16)?,
                    r.get(17)?,
                    r.get(18)?,
                    r.get(19)?,
                    r.get(20)?,
                    r.get(21)?,
                ))
            },
        )
        .optional()?;

    let (
        rid,
        number,
        procurement_list_id,
        supplier_id,
        supplier_name,
        invoice_ref,
        source_type,
        source_filename,
        received_by_staff_id,
        received_by_name,
        approved_by_staff_id,
        approved_by_name,
        posted_by_name,
        received_at,
        disbursement_minor,
        actual_expense_minor,
        refunded_minor,
        extra_json,
        total_minor,
        notes,
        status,
        created_at,
    ) = row.ok_or_else(|| ApiError::not_found("Restock receipt not found."))?;
    let extra_charges: Vec<ExtraChargeDto> = serde_json::from_str(&extra_json).unwrap_or_default();
    let lines = load_receipt_lines(conn, &rid)?;

    Ok(ReceiptDto {
        id: rid,
        number,
        procurement_list_id,
        supplier_id,
        supplier_name,
        invoice_ref,
        source_type,
        source_filename,
        received_by_staff_id,
        received_by_name,
        approved_by_staff_id,
        approved_by_name,
        posted_by_name,
        received_at,
        disbursement_minor,
        actual_expense_minor,
        refunded_minor,
        extra_charges,
        total_minor,
        notes,
        status,
        created_at,
        lines,
    })
}

pub fn reverse_receipt(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    reason: String,
    manager_pin: Option<String>,
) -> AppResult<ReceiptDto> {
    require_operator(actor)?;
    let clean_reason = reason.trim().to_string();
    if clean_reason.is_empty() {
        return Err(
            ApiError::validation("A reason is required to reverse a restock receipt.")
                .with_field("reason"),
        );
    }
    if actor.role != UserRole::Admin {
        let pin = manager_pin.as_deref().ok_or_else(|| {
            ApiError::forbidden("Manager PIN is required to reverse a receipt.")
        })?;
        verify_manager_pin(db, pin)?;
    }

    let settings = get_settings(db)?;
    let allow_negative = settings.inventory_rules.allow_negative_stock;
    let now = now_rfc3339();
    let today = today_iso();

    db.transaction(|tx| {
        let row: Option<(String, String, Option<String>)> = tx
            .query_row(
                "SELECT number, status, procurement_list_id FROM receipts WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .optional()?;
        let (number, status, proc_list_id) =
            row.ok_or_else(|| ApiError::not_found("Restock receipt not found."))?;
        if status == "reversed" {
            return Err(ApiError::conflict("This restock receipt is already reversed."));
        }

        let lines = load_receipt_lines(tx, id)?;
        for l in lines {
            let (item_name, cur_on_hand, cur_avg_cost, cur_last_cost, cur_cost_missing, unit_plural): (
                String,
                i64,
                i64,
                i64,
                bool,
                String,
            ) = tx.query_row(
                "SELECT i.name, i.on_hand_milli, i.avg_cost_micro, i.last_cost_micro, i.cost_missing, u.plural
                 FROM items i
                 JOIN units u ON u.id = i.base_unit_id
                 WHERE i.id = ?1",
                [&l.item_id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get(5)?,
                    ))
                },
            )?;

            if !allow_negative && cur_on_hand < l.base_qty_milli {
                return Err(ApiError::insufficient_stock(
                    &item_name,
                    &format!("{} {}", format_qty_milli(cur_on_hand.max(0)), unit_plural.to_lowercase()),
                    &format!("{} {}", format_qty_milli(l.base_qty_milli), unit_plural.to_lowercase()),
                ));
            }

            let receipt_unit_cost_micro = if l.base_qty_milli > 0 && l.line_total_minor > 0 {
                derive_unit_cost_micro(l.line_total_minor, l.base_qty_milli)?
            } else {
                0
            };
            let new_bal = cur_on_hand - l.base_qty_milli;

            let (new_avg_cost, new_last_cost, new_cost_missing) = if receipt_unit_cost_micro > 0 {
                let prior_cost: Option<i64> = tx
                    .query_row(
                        "SELECT unit_cost_micro FROM stock_movements
                         WHERE item_id = ?1 AND unit_cost_micro > 0 AND doc_id != ?2 AND type IN ('opening', 'receipt')
                         ORDER BY created_at DESC, rowid DESC LIMIT 1",
                        params![l.item_id, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if new_bal > 0 {
                    let rem_val = (cur_on_hand as i128) * (cur_avg_cost as i128)
                        - (l.base_qty_milli as i128) * (receipt_unit_cost_micro as i128);
                    if rem_val > 0 {
                        let avg = round_div_half_even(rem_val, new_bal as i128) as i64;
                        (avg, prior_cost.unwrap_or(avg), false)
                    } else if let Some(pc) = prior_cost {
                        (pc, pc, false)
                    } else {
                        (0, 0, true)
                    }
                } else if let Some(pc) = prior_cost {
                    (pc, pc, false)
                } else {
                    (0, 0, true)
                }
            } else {
                (cur_avg_cost, cur_last_cost, cur_cost_missing)
            };

            tx.execute(
                "UPDATE items
                 SET on_hand_milli = ?1,
                     avg_cost_micro = ?2,
                     last_cost_micro = ?3,
                     cost_missing = ?4,
                     updated_at = ?5
                 WHERE id = ?6",
                params![
                    new_bal,
                    new_avg_cost,
                    new_last_cost,
                    if new_cost_missing { 1 } else { 0 },
                    now,
                    l.item_id
                ],
            )?;

            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    doc_type, doc_id, doc_number,
                    input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, business_date, created_at
                ) VALUES (?1, ?2, 'reversal', ?3, ?4, ?5, ?6, 'receipt_reversal', ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    Uuid::now_v7().to_string(),
                    l.item_id,
                    -l.base_qty_milli,
                    new_bal,
                    if receipt_unit_cost_micro > 0 {
                        receipt_unit_cost_micro
                    } else {
                        cur_avg_cost
                    },
                    l.line_total_minor,
                    id,
                    format!("REV-{number}"),
                    l.unit_id,
                    l.input_qty_milli,
                    l.factor_milli,
                    actor.id,
                    today,
                    now
                ],
            )?;

            if let Some(ref pl_id) = l.procurement_line_id {
                tx.execute(
                    "UPDATE procurement_lines
                     SET received_qty_milli = MAX(0, received_qty_milli - ?1)
                     WHERE id = ?2",
                    params![l.input_qty_milli, pl_id],
                )?;
            }
        }

        tx.execute("UPDATE receipts SET status = 'reversed' WHERE id = ?1", [id])?;
        if let Some(list_id) = proc_list_id {
            let any_received: i64 = tx.query_row(
                "SELECT COUNT(*) FROM procurement_lines WHERE list_id = ?1 AND received_qty_milli > 0",
                [&list_id],
                |r| r.get(0),
            )?;
            let next_status = if any_received > 0 { "partial" } else { "finalised" };
            tx.execute(
                "UPDATE procurement_lists SET status = ?1, updated_at = ?2 WHERE id = ?3",
                params![next_status, now, list_id],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "receipt.reversed",
            "receipts",
            id,
            &format!("Reversed receipt {number} — {clean_reason}"),
            serde_json::json!({ "number": number, "reason": clean_reason }),
        )?;

        Ok(())
    })?;

    get_receipt(db, id)
}
