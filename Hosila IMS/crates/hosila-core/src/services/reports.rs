use std::collections::{BTreeMap, HashMap};

use chrono::NaiveDate;
use rusqlite::{params, types::Value as SqlValue};

use crate::db::Database;
use crate::domain::money::line_value_minor;
use crate::error::{ApiError, AppResult};
use crate::services::procurement::{format_section_label, section_sort_rank};
use crate::services::today_iso;
use crate::types::{
    ConsumptionByDeptRow, DateRangeFilter, DepartmentValuationRow, ExtraChargeDto,
    ProcurementSpendRow, StockValuationReportDto, WeeklyStockSheetReportDto,
    WeeklyStockSheetRowDto,
};

fn validate_date_pair(start_date: &str, end_date: &str) -> AppResult<(String, String)> {
    let sd = start_date.trim();
    let ed = end_date.trim();
    let s = NaiveDate::parse_from_str(sd, "%Y-%m-%d")
        .map_err(|_| ApiError::validation("start_date must be YYYY-MM-DD."))?;
    let e = NaiveDate::parse_from_str(ed, "%Y-%m-%d")
        .map_err(|_| ApiError::validation("end_date must be YYYY-MM-DD."))?;
    if e < s {
        return Err(ApiError::validation("end_date cannot be earlier than start_date."));
    }
    Ok((sd.to_string(), ed.to_string()))
}

pub fn get_stock_valuation_report(db: &Database) -> AppResult<StockValuationReportDto> {
    db.with_read(|conn| {
        let mut p_stmt = conn.prepare(
            "SELECT id.item_id, d.id, d.name, d.sort_order
             FROM item_departments id
             JOIN departments d ON d.id = id.department_id
             ORDER BY d.sort_order ASC, d.name ASC",
        )?;
        let mut primary_dept: HashMap<String, (String, String)> = HashMap::new();
        for row in p_stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
            ))
        })? {
            let (iid, did, dname) = row?;
            primary_dept.entry(iid).or_insert((did, dname));
        }

        let mut i_stmt = conn.prepare(
            "SELECT i.id, i.on_hand_milli, i.avg_cost_micro, i.cost_missing, ss.name
             FROM items i
             LEFT JOIN store_sections ss ON ss.id = i.store_section_id
             WHERE i.is_active = 1",
        )?;
        let items = i_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)? != 0,
                    r.get::<_, Option<String>>(4)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut total_value_minor: i64 = 0;
        let mut total_items: i32 = 0;
        let mut cost_missing_count: i32 = 0;

        let mut grouped: BTreeMap<(String, String, Option<String>), DepartmentValuationRow> =
            BTreeMap::new();

        for (iid, on_hand, avg_cost, cost_missing, sec_name) in items {
            let val = line_value_minor(on_hand.max(0), avg_cost)?;
            total_value_minor += val;
            total_items += 1;
            if cost_missing {
                cost_missing_count += 1;
            }

            let (did, dname) = primary_dept
                .get(&iid)
                .cloned()
                .unwrap_or_else(|| ("unassigned".to_string(), "Unassigned".to_string()));
            let key = (did.clone(), dname.clone(), sec_name.clone());
            let entry = grouped.entry(key).or_insert_with(|| DepartmentValuationRow {
                department_id: did,
                department_name: dname,
                section_name: sec_name,
                item_count: 0,
                total_value_minor: 0,
                cost_missing_count: 0,
            });
            entry.item_count += 1;
            entry.total_value_minor += val;
            if cost_missing {
                entry.cost_missing_count += 1;
            }
        }

        let mut by_department: Vec<DepartmentValuationRow> = grouped.into_values().collect();
        by_department.sort_by(|a, b| {
            let ra = section_sort_rank(&format_section_label(
                Some(&a.department_name),
                a.section_name.as_deref(),
            ));
            let rb = section_sort_rank(&format_section_label(
                Some(&b.department_name),
                b.section_name.as_deref(),
            ));
            ra.cmp(&rb)
        });

        Ok(StockValuationReportDto {
            as_of_date: today_iso(),
            total_value_minor,
            total_items,
            cost_missing_count,
            by_department,
        })
    })
}

pub fn get_consumption_report(
    db: &Database,
    filter: DateRangeFilter,
) -> AppResult<Vec<ConsumptionByDeptRow>> {
    let (start_date, end_date) = validate_date_pair(&filter.start_date, &filter.end_date)?;

    db.with_read(|conn| {
        let mut clauses = vec![
            "m.department_id IS NOT NULL".to_string(),
            "(m.type = 'issue' OR (m.type = 'reversal' AND m.doc_type = 'collection_reversal'))".to_string(),
            "m.business_date >= ?".to_string(),
            "m.business_date <= ?".to_string(),
        ];
        let mut binds: Vec<SqlValue> =
            vec![SqlValue::Text(start_date), SqlValue::Text(end_date)];

        if let Some(ref did) = filter
            .department_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("m.department_id = ?".to_string());
            binds.push(SqlValue::Text(did.to_string()));
        }

        let sql = format!(
            "SELECT m.department_id, d.name, m.item_id, i.name, bu.code,
                    SUM(-m.qty_milli) AS net_qty_milli,
                    SUM(CASE WHEN m.type = 'issue' THEN m.value_minor ELSE -m.value_minor END) AS net_val_minor
             FROM stock_movements m
             JOIN departments d ON d.id = m.department_id
             JOIN items i ON i.id = m.item_id
             JOIN units bu ON bu.id = i.base_unit_id
             WHERE {}
             GROUP BY m.department_id, d.name, m.item_id, i.name, bu.code
             HAVING net_qty_milli > 0 OR net_val_minor > 0
             ORDER BY d.sort_order ASC, d.name ASC, net_val_minor DESC, i.name ASC",
            clauses.join(" AND ")
        );

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                Ok(ConsumptionByDeptRow {
                    department_id: r.get(0)?,
                    department_name: r.get(1)?,
                    item_id: r.get(2)?,
                    item_name: r.get(3)?,
                    base_unit_code: r.get(4)?,
                    qty_milli: r.get(5)?,
                    value_minor: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn get_procurement_spend_report(
    db: &Database,
    filter: DateRangeFilter,
) -> AppResult<Vec<ProcurementSpendRow>> {
    let (start_date, end_date) = validate_date_pair(&filter.start_date, &filter.end_date)?;

    db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT r.id, r.number, r.received_at, s.name, r.source_type,
                    r.extra_charges_json, r.actual_expense_minor, r.total_minor, r.disbursement_minor, r.refunded_minor,
                    COALESCE((SELECT SUM(rl.line_total_minor) FROM receipt_lines rl WHERE rl.receipt_id = r.id), 0) AS lines_total_minor
             FROM receipts r
             LEFT JOIN suppliers s ON s.id = r.supplier_id
             WHERE r.status = 'posted'
               AND substr(r.received_at, 1, 10) >= ?1
               AND substr(r.received_at, 1, 10) <= ?2
             ORDER BY r.received_at DESC, r.number DESC",
        )?;

        let rows = stmt
            .query_map(params![start_date, end_date], |r| {
                let extra_json: String = r.get(5)?;
                let extras: Vec<ExtraChargeDto> =
                    serde_json::from_str(&extra_json).unwrap_or_default();
                let extra_charges_minor: i64 = extras.iter().map(|e| e.amount_minor).sum();
                let actual_expense_minor: Option<i64> = r.get(6)?;
                let lines_total_minor: i64 = r.get(10)?;
                let total_minor = actual_expense_minor.unwrap_or(lines_total_minor + extra_charges_minor);
                Ok(ProcurementSpendRow {
                    receipt_id: r.get(0)?,
                    receipt_number: r.get(1)?,
                    received_at: r.get(2)?,
                    supplier_name: r.get(3)?,
                    source_type: r.get(4)?,
                    lines_total_minor,
                    extra_charges_minor,
                    total_minor,
                    disbursement_minor: r.get(8)?,
                    refunded_minor: r.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn get_weekly_stock_sheet(
    db: &Database,
    start_date: &str,
    end_date: &str,
) -> AppResult<WeeklyStockSheetReportDto> {
    let (start_date, end_date) = validate_date_pair(start_date, end_date)?;

    db.with_read(|conn| {
        let mut p_stmt = conn.prepare(
            "SELECT id.item_id, d.name
             FROM item_departments id
             JOIN departments d ON d.id = id.department_id
             ORDER BY d.sort_order ASC, d.name ASC",
        )?;
        let mut primary_dept: HashMap<String, String> = HashMap::new();
        for r in p_stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))? {
            let (iid, dname) = r?;
            primary_dept.entry(iid).or_insert(dname);
        }

        let mut i_stmt = conn.prepare(
            "SELECT i.id, i.name, u.code, ss.name, i.avg_cost_micro, i.cost_missing
             FROM items i
             JOIN units u ON u.id = i.base_unit_id
             LEFT JOIN store_sections ss ON ss.id = i.store_section_id
             WHERE i.is_active = 1",
        )?;
        let items = i_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)?,
                    r.get::<_, i64>(5)? != 0,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Aggregate ledger movements per item up through end_date
        let mut m_stmt = conn.prepare(
            "SELECT item_id, type, doc_type, qty_milli, business_date
             FROM stock_movements
             WHERE business_date <= ?1",
        )?;
        let mut opening_by_item: HashMap<String, i64> = HashMap::new();
        let mut purchase_by_item: HashMap<String, i64> = HashMap::new();
        let mut closing_by_item: HashMap<String, i64> = HashMap::new();

        for row in m_stmt.query_map([&end_date], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, String>(4)?,
            ))
        })? {
            let (item_id, mtype, doc_type, qty_milli, bdate) = row?;
            *closing_by_item.entry(item_id.clone()).or_insert(0) += qty_milli;

            if bdate < start_date || (bdate == start_date && mtype == "opening") {
                *opening_by_item.entry(item_id).or_insert(0) += qty_milli;
            } else if mtype == "receipt"
                || (mtype == "reversal" && doc_type == "receipt_reversal")
            {
                *purchase_by_item.entry(item_id).or_insert(0) += qty_milli;
            }
        }

        let mut rows = Vec::with_capacity(items.len());
        let mut grand_total_minor: i64 = 0;

        for (item_id, item_name, unit_code, sec_name, avg_cost_micro, cost_missing) in items {
            let section_label = format_section_label(
                primary_dept.get(&item_id).map(String::as_str),
                sec_name.as_deref(),
            );
            let opening_milli = opening_by_item.get(&item_id).copied().unwrap_or(0);
            let purchase_milli = purchase_by_item.get(&item_id).copied().unwrap_or(0);
            let available_milli = opening_milli + purchase_milli;
            let closing_milli = closing_by_item.get(&item_id).copied().unwrap_or(0);
            let issued_milli = available_milli - closing_milli;
            let total_value_minor = line_value_minor(closing_milli.max(0), avg_cost_micro)?;
            grand_total_minor += total_value_minor;

            rows.push(WeeklyStockSheetRowDto {
                section_label,
                item_id,
                item_name,
                unit_code,
                opening_milli,
                purchase_milli,
                available_milli,
                issued_milli,
                closing_milli,
                unit_cost_micro: avg_cost_micro,
                total_value_minor,
                cost_missing,
            });
        }

        rows.sort_by(|a, b| {
            section_sort_rank(&a.section_label)
                .cmp(&section_sort_rank(&b.section_label))
                .then_with(|| a.item_name.cmp(&b.item_name))
        });

        Ok(WeeklyStockSheetReportDto {
            start_date,
            end_date,
            rows,
            grand_total_minor,
        })
    })
}
