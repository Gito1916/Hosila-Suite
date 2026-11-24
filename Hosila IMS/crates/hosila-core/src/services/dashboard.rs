use std::collections::HashMap;

use chrono::{Duration, NaiveDate, Utc};
use rusqlite::{params, types::Value as SqlValue};

use crate::db::Database;
use crate::domain::money::line_value_minor;
use crate::error::{ApiError, AppResult};
use crate::services::parse_iso_date_or_today;
use crate::types::{
    ActivityFeedFilter, ActivityLogDto, DailyConsumptionPoint, DashboardKpisDto,
    DepartmentConsumptionPoint,
};

pub fn get_dashboard_kpis(
    db: &Database,
    date_opt: Option<String>,
) -> AppResult<DashboardKpisDto> {
    let as_of_date = parse_iso_date_or_today(date_opt.as_deref(), "date")?;

    db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT on_hand_milli, avg_cost_micro, reorder_point_milli, cost_missing
             FROM items
             WHERE is_active = 1",
        )?;
        let rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, i64>(1)?,
                    r.get::<_, i64>(2)?,
                    r.get::<_, i64>(3)? != 0,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut total_inventory_value_minor: i64 = 0;
        let mut low_stock_count: i32 = 0;
        let mut out_of_stock_count: i32 = 0;
        let mut cost_missing_count: i32 = 0;

        for (on_hand, avg_cost, reorder_point, cost_missing) in &rows {
            total_inventory_value_minor += line_value_minor((*on_hand).max(0), *avg_cost)?;
            if *cost_missing {
                cost_missing_count += 1;
            }
            if *on_hand <= 0 {
                out_of_stock_count += 1;
            } else if *reorder_point > 0 && *on_hand <= *reorder_point {
                low_stock_count += 1;
            }
        }

        let (consumed_today_minor, received_today_minor): (i64, i64) = conn.query_row(
            "SELECT
                COALESCE(SUM(CASE
                    WHEN type = 'issue' THEN value_minor
                    WHEN type = 'reversal' AND doc_type = 'collection_reversal' THEN -value_minor
                    ELSE 0
                END), 0),
                COALESCE(SUM(CASE
                    WHEN type = 'receipt' THEN value_minor
                    WHEN type = 'reversal' AND doc_type = 'receipt_reversal' THEN -value_minor
                    ELSE 0
                END), 0)
             FROM stock_movements
             WHERE business_date = ?1",
            [&as_of_date],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;

        let outstanding_returns_count: i32 = conn.query_row(
            "SELECT COUNT(*)
             FROM collection_lines cl
             JOIN collections c ON c.id = cl.collection_id
             WHERE c.status = 'posted'
               AND cl.is_returnable = 1
               AND cl.return_status IN ('out', 'partial')",
            [],
            |r| r.get(0),
        )?;

        let open_procurement_lists_count: i32 = conn.query_row(
            "SELECT COUNT(*)
             FROM procurement_lists
             WHERE status IN ('draft', 'finalised', 'partial')",
            [],
            |r| r.get(0),
        )?;

        Ok(DashboardKpisDto {
            total_inventory_value_minor,
            total_active_items: rows.len() as i32,
            low_stock_count,
            out_of_stock_count,
            cost_missing_count,
            consumed_today_minor,
            received_today_minor,
            outstanding_returns_count,
            open_procurement_lists_count,
            as_of_date,
        })
    })
}

pub fn get_consumption_by_department(
    db: &Database,
    start_date: &str,
    end_date: &str,
) -> AppResult<Vec<DepartmentConsumptionPoint>> {
    NaiveDate::parse_from_str(start_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::validation("start_date must be YYYY-MM-DD."))?;
    NaiveDate::parse_from_str(end_date.trim(), "%Y-%m-%d")
        .map_err(|_| ApiError::validation("end_date must be YYYY-MM-DD."))?;

    db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT d.id, d.name, d.color,
                    COALESCE(SUM(CASE
                        WHEN m.type = 'issue' THEN m.value_minor
                        WHEN m.type = 'reversal' AND m.doc_type = 'collection_reversal' THEN -m.value_minor
                        ELSE 0
                    END), 0) AS consumed_minor,
                    COUNT(DISTINCT CASE WHEN m.type = 'issue' THEN m.doc_id END) AS issue_count
             FROM departments d
             LEFT JOIN stock_movements m
               ON m.department_id = d.id
              AND m.business_date >= ?1
              AND m.business_date <= ?2
              AND (m.type = 'issue' OR (m.type = 'reversal' AND m.doc_type = 'collection_reversal'))
             WHERE d.is_active = 1
             GROUP BY d.id, d.name, d.color, d.sort_order
             ORDER BY consumed_minor DESC, d.sort_order ASC, d.name ASC",
        )?;

        let rows = stmt
            .query_map(params![start_date.trim(), end_date.trim()], |r| {
                Ok(DepartmentConsumptionPoint {
                    department_id: r.get(0)?,
                    department_name: r.get(1)?,
                    department_color: r.get(2)?,
                    consumed_minor: r.get(3)?,
                    issue_count: r.get(4)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn get_daily_consumption_series(
    db: &Database,
    days: i32,
) -> AppResult<Vec<DailyConsumptionPoint>> {
    get_daily_consumption_series_as_of(db, days, None)
}

pub fn get_daily_consumption_series_as_of(
    db: &Database,
    days: i32,
    as_of_date: Option<&str>,
) -> AppResult<Vec<DailyConsumptionPoint>> {
    let span = days.clamp(1, 90);
    let end = match as_of_date.map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => NaiveDate::parse_from_str(s, "%Y-%m-%d")
            .map_err(|_| ApiError::validation("Date must be formatted as YYYY-MM-DD."))?,
        None => Utc::now().date_naive(),
    };
    let start = end - Duration::days(i64::from(span - 1));
    let start_str = start.format("%Y-%m-%d").to_string();
    let end_str = end.format("%Y-%m-%d").to_string();

    let by_date: HashMap<String, (i64, i64)> = db.with_read(|conn| {
        let mut stmt = conn.prepare(
            "SELECT business_date,
                    COALESCE(SUM(CASE
                        WHEN type = 'issue' THEN value_minor
                        WHEN type = 'reversal' AND doc_type = 'collection_reversal' THEN -value_minor
                        ELSE 0
                    END), 0) AS consumed_minor,
                    COALESCE(SUM(CASE
                        WHEN type = 'receipt' THEN value_minor
                        WHEN type = 'reversal' AND doc_type = 'receipt_reversal' THEN -value_minor
                        ELSE 0
                    END), 0) AS received_minor
             FROM stock_movements
             WHERE business_date >= ?1 AND business_date <= ?2
             GROUP BY business_date",
        )?;
        let rows = stmt
            .query_map(params![start_str, end_str], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?),
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows.into_iter().collect())
    })?;

    let mut out = Vec::with_capacity(span as usize);
    for offset in 0..span {
        let day = (start + Duration::days(i64::from(offset)))
            .format("%Y-%m-%d")
            .to_string();
        let (consumed_minor, received_minor) = by_date.get(&day).copied().unwrap_or((0, 0));
        out.push(DailyConsumptionPoint {
            date: day,
            consumed_minor,
            received_minor,
        });
    }
    Ok(out)
}

pub fn list_activity_log(
    db: &Database,
    filter: ActivityFeedFilter,
) -> AppResult<Vec<ActivityLogDto>> {
    db.with_read(|conn| {
        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<SqlValue> = Vec::new();

        if let Some(prefix) = filter
            .action_prefix
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("a.action LIKE ?".to_string());
            binds.push(SqlValue::Text(format!("{prefix}%")));
        }
        if let Some(entity) = filter
            .entity
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("a.entity = ?".to_string());
            binds.push(SqlValue::Text(entity.to_string()));
        }
        if let Some(uid) = filter
            .user_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("a.user_id = ?".to_string());
            binds.push(SqlValue::Text(uid.to_string()));
        }
        if let Some(sd) = filter
            .start_date
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("substr(a.at, 1, 10) >= ?".to_string());
            binds.push(SqlValue::Text(sd.to_string()));
        }
        if let Some(ed) = filter
            .end_date
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
        {
            clauses.push("substr(a.at, 1, 10) <= ?".to_string());
            binds.push(SqlValue::Text(ed.to_string()));
        }

        let limit = filter.limit.unwrap_or(100).clamp(1, 500);
        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };

        let sql = format!(
            "SELECT a.id, a.at, a.user_id, u.full_name, a.action, a.entity, a.entity_id, a.summary, a.meta_json
             FROM activity_log a
             LEFT JOIN users u ON u.id = a.user_id
             {where_sql}
             ORDER BY a.at DESC
             LIMIT ?"
        );
        binds.push(SqlValue::Integer(i64::from(limit)));

        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                let meta_raw: String = r.get(8)?;
                let meta = serde_json::from_str(&meta_raw).unwrap_or_else(|_| serde_json::json!({}));
                Ok(ActivityLogDto {
                    id: r.get(0)?,
                    at: r.get(1)?,
                    user_id: r.get(2)?,
                    user_name: r.get(3)?,
                    action: r.get(4)?,
                    entity: r.get(5)?,
                    entity_id: r.get(6)?,
                    summary: r.get(7)?,
                    meta,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;

        Ok(rows)
    })
}
