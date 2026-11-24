use std::collections::HashMap;

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_operator;
use crate::services::validate_department_ids;
use crate::types::{CreateStaffInput, SessionUser, StaffDto, StaffFilter, UpdateStaffInput};

fn load_staff_departments(
    conn: &Connection,
    staff_id: &str,
) -> AppResult<(Vec<String>, Vec<String>)> {
    let mut stmt = conn.prepare(
        "SELECT d.id, d.name
         FROM staff_departments sd
         JOIN departments d ON d.id = sd.department_id
         WHERE sd.staff_id = ?1
         ORDER BY d.sort_order ASC, d.name ASC",
    )?;
    let rows = stmt
        .query_map([staff_id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let mut ids = Vec::with_capacity(rows.len());
    let mut names = Vec::with_capacity(rows.len());
    for (id, name) in rows {
        ids.push(id);
        names.push(name);
    }
    Ok((ids, names))
}

pub fn list_staff(db: &Database, filter: StaffFilter) -> AppResult<Vec<StaffDto>> {
    db.with_read(|conn| {
        let mut clauses: Vec<String> = Vec::new();
        let mut bind_params: Vec<SqlValue> = Vec::new();

        if !filter.include_inactive {
            clauses.push("s.is_active = 1".to_string());
        }
        if filter.store_staff_only {
            clauses.push("s.is_store_staff = 1".to_string());
        }
        if let Some(dept_id) = filter.department_id.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            clauses.push(
                "EXISTS (SELECT 1 FROM staff_departments sd WHERE sd.staff_id = s.id AND sd.department_id = ?)".to_string(),
            );
            bind_params.push(SqlValue::Text(dept_id.to_string()));
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };

        let sql = format!(
            "SELECT s.id, s.full_name, s.staff_code, s.phone, s.is_store_staff, s.is_active, s.created_at
             FROM staff s
             {where_sql}
             ORDER BY s.is_active DESC, s.full_name ASC"
        );

        let mut stmt = conn.prepare(&sql)?;
        let staff_rows = stmt
            .query_map(rusqlite::params_from_iter(bind_params), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, Option<String>>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, i64>(4)? != 0,
                    r.get::<_, i64>(5)? != 0,
                    r.get::<_, String>(6)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        let mut dept_stmt = conn.prepare(
            "SELECT sd.staff_id, d.id, d.name
             FROM staff_departments sd
             JOIN departments d ON d.id = sd.department_id
             ORDER BY d.sort_order ASC, d.name ASC",
        )?;
        let mut dept_map: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
        let dept_rows = dept_stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for (sid, did, dname) in dept_rows {
            let entry = dept_map.entry(sid).or_default();
            entry.0.push(did);
            entry.1.push(dname);
        }

        Ok(staff_rows
            .into_iter()
            .map(
                |(id, full_name, staff_code, phone, is_store_staff, is_active, created_at)| {
                    let (department_ids, department_names) =
                        dept_map.remove(&id).unwrap_or_default();
                    StaffDto {
                        id,
                        full_name,
                        staff_code,
                        phone,
                        is_store_staff,
                        is_active,
                        department_ids,
                        department_names,
                        created_at,
                    }
                },
            )
            .collect())
    })
}

pub fn create_staff(
    db: &Database,
    actor: &SessionUser,
    input: CreateStaffInput,
) -> AppResult<StaffDto> {
    require_operator(actor)?;
    let full_name = input.full_name.trim().to_string();
    if full_name.is_empty() {
        return Err(ApiError::validation("Staff full name is required.").with_field("full_name"));
    }
    let staff_code = input
        .staff_code
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);
    let phone = input
        .phone
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string);

    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let dept_ids = validate_department_ids(tx, &input.department_ids, false)?;
        tx.execute(
            "INSERT INTO staff (id, full_name, staff_code, phone, is_store_staff, is_active, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![
                id,
                full_name,
                staff_code,
                phone,
                if input.is_store_staff { 1 } else { 0 },
                now
            ],
        )?;

        for did in &dept_ids {
            tx.execute(
                "INSERT INTO staff_departments (staff_id, department_id) VALUES (?1, ?2)",
                params![id, did],
            )?;
        }

        let (department_ids, department_names) = load_staff_departments(tx, &id)?;
        record_activity(
            tx,
            Some(&actor.id),
            "staff.created",
            "staff",
            &id,
            &format!("Added staff member {full_name}"),
            serde_json::json!({ "is_store_staff": input.is_store_staff, "departments": department_names }),
        )?;

        Ok(StaffDto {
            id: id.clone(),
            full_name,
            staff_code,
            phone,
            is_store_staff: input.is_store_staff,
            is_active: true,
            department_ids,
            department_names,
            created_at: now.clone(),
        })
    })
}

pub fn update_staff(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateStaffInput,
) -> AppResult<StaffDto> {
    require_operator(actor)?;

    db.transaction(|tx| {
        let existing: Option<(String, Option<String>, Option<String>, bool, bool, String)> = tx
            .query_row(
                "SELECT full_name, staff_code, phone, is_store_staff, is_active, created_at
                 FROM staff WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get::<_, i64>(3)? != 0,
                        r.get::<_, i64>(4)? != 0,
                        r.get(5)?,
                    ))
                },
            )
            .optional()?;
        let (old_name, old_code, old_phone, old_store, old_active, created_at) =
            existing.ok_or_else(|| ApiError::not_found("Staff member not found."))?;

        let new_name = match input.full_name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(
                        ApiError::validation("Staff full name cannot be empty.")
                            .with_field("full_name"),
                    );
                }
                t
            }
            None => old_name,
        };
        let new_code = match input.staff_code {
            Some(c) => {
                let t = c.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            }
            None => old_code,
        };
        let new_phone = match input.phone {
            Some(p) => {
                let t = p.trim().to_string();
                if t.is_empty() { None } else { Some(t) }
            }
            None => old_phone,
        };
        let new_store = input.is_store_staff.unwrap_or(old_store);
        let new_active = input.is_active.unwrap_or(old_active);

        tx.execute(
            "UPDATE staff SET full_name = ?1, staff_code = ?2, phone = ?3, is_store_staff = ?4, is_active = ?5 WHERE id = ?6",
            params![
                new_name,
                new_code,
                new_phone,
                if new_store { 1 } else { 0 },
                if new_active { 1 } else { 0 },
                id
            ],
        )?;

        if let Some(dept_ids_raw) = input.department_ids {
            let dept_ids = validate_department_ids(tx, &dept_ids_raw, false)?;
            tx.execute("DELETE FROM staff_departments WHERE staff_id = ?1", [id])?;
            for did in dept_ids {
                tx.execute(
                    "INSERT INTO staff_departments (staff_id, department_id) VALUES (?1, ?2)",
                    params![id, did],
                )?;
            }
        }

        let (department_ids, department_names) = load_staff_departments(tx, id)?;
        record_activity(
            tx,
            Some(&actor.id),
            "staff.updated",
            "staff",
            id,
            &format!("Updated staff member {new_name}"),
            serde_json::json!({ "is_active": new_active, "is_store_staff": new_store }),
        )?;

        Ok(StaffDto {
            id: id.to_string(),
            full_name: new_name,
            staff_code: new_code,
            phone: new_phone,
            is_store_staff: new_store,
            is_active: new_active,
            department_ids,
            department_names,
            created_at,
        })
    })
}
