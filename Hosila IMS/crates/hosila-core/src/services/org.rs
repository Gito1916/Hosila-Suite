use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension, Transaction};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::require_admin;
use crate::types::{
    CreateDepartmentInput, CreateStoreSectionInput, DepartmentDto, SessionUser, StoreSectionDto,
    UpdateDepartmentInput, UpdateStoreSectionInput,
};

pub fn insert_department_tx(
    tx: &Transaction<'_>,
    input: &CreateDepartmentInput,
    now: &str,
) -> AppResult<DepartmentDto> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::validation("Department name is required.").with_field("name"));
    }

    let dup: Option<String> = tx
        .query_row(
            "SELECT id FROM departments WHERE LOWER(name) = LOWER(?1)",
            [&name],
            |r| r.get(0),
        )
        .optional()?;
    if dup.is_some() {
        return Err(
            ApiError::conflict(format!("Department '{name}' already exists.")).with_field("name"),
        );
    }

    let color = input
        .color
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or("#21C29C")
        .to_string();

    let sort_order = match input.sort_order {
        Some(o) => o,
        None => {
            let max_order: Option<i32> = tx.query_row(
                "SELECT MAX(sort_order) FROM departments",
                [],
                |r| r.get(0),
            )?;
            max_order.unwrap_or(0) + 1
        }
    };

    let id = Uuid::now_v7().to_string();
    tx.execute(
        "INSERT INTO departments (id, name, color, sort_order, is_active, created_at)
         VALUES (?1, ?2, ?3, ?4, 1, ?5)",
        params![id, name, color, sort_order, now],
    )?;

    Ok(DepartmentDto {
        id,
        name,
        color,
        sort_order,
        is_active: true,
        staff_count: 0,
        item_count: 0,
        created_at: now.to_string(),
    })
}

pub fn list_departments(db: &Database, include_inactive: bool) -> AppResult<Vec<DepartmentDto>> {
    db.with_read(|conn| {
        let sql = if include_inactive {
            "SELECT d.id, d.name, d.color, d.sort_order, d.is_active,
                    (SELECT COUNT(*) FROM staff_departments sd JOIN staff s ON s.id = sd.staff_id WHERE sd.department_id = d.id AND s.is_active = 1),
                    (SELECT COUNT(*) FROM item_departments idp JOIN items i ON i.id = idp.item_id WHERE idp.department_id = d.id AND i.is_active = 1),
                    d.created_at
             FROM departments d
             ORDER BY d.sort_order ASC, d.name ASC"
        } else {
            "SELECT d.id, d.name, d.color, d.sort_order, d.is_active,
                    (SELECT COUNT(*) FROM staff_departments sd JOIN staff s ON s.id = sd.staff_id WHERE sd.department_id = d.id AND s.is_active = 1),
                    (SELECT COUNT(*) FROM item_departments idp JOIN items i ON i.id = idp.item_id WHERE idp.department_id = d.id AND i.is_active = 1),
                    d.created_at
             FROM departments d
             WHERE d.is_active = 1
             ORDER BY d.sort_order ASC, d.name ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(DepartmentDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    color: r.get(2)?,
                    sort_order: r.get(3)?,
                    is_active: r.get::<_, i64>(4)? != 0,
                    staff_count: r.get(5)?,
                    item_count: r.get(6)?,
                    created_at: r.get(7)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn create_department(
    db: &Database,
    actor: &SessionUser,
    input: CreateDepartmentInput,
) -> AppResult<DepartmentDto> {
    require_admin(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    db.transaction(|tx| {
        let dept = insert_department_tx(tx, &input, &now)?;
        record_activity(
            tx,
            Some(&actor.id),
            "department.created",
            "departments",
            &dept.id,
            &format!("Created department {}", dept.name),
            serde_json::json!({ "name": dept.name }),
        )?;
        Ok(dept)
    })
}

pub fn update_department(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateDepartmentInput,
) -> AppResult<DepartmentDto> {
    require_admin(actor)?;
    db.transaction(|tx| {
        let existing: Option<(String, String, i32, bool, String)> = tx
            .query_row(
                "SELECT name, color, sort_order, is_active, created_at FROM departments WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get::<_, i64>(3)? != 0,
                        r.get(4)?,
                    ))
                },
            )
            .optional()?;
        let (old_name, old_color, old_order, old_active, created_at) =
            existing.ok_or_else(|| ApiError::not_found("Department not found."))?;

        let new_name = match input.name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(
                        ApiError::validation("Department name cannot be empty.").with_field("name")
                    );
                }
                let dup: Option<String> = tx
                    .query_row(
                        "SELECT id FROM departments WHERE LOWER(name) = LOWER(?1) AND id != ?2",
                        params![t, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if dup.is_some() {
                    return Err(
                        ApiError::conflict(format!("Department '{t}' already exists."))
                            .with_field("name"),
                    );
                }
                t
            }
            None => old_name,
        };

        let new_color = match input.color {
            Some(c) if !c.trim().is_empty() => c.trim().to_string(),
            _ => old_color,
        };
        let new_order = input.sort_order.unwrap_or(old_order);
        let new_active = input.is_active.unwrap_or(old_active);

        tx.execute(
            "UPDATE departments SET name = ?1, color = ?2, sort_order = ?3, is_active = ?4 WHERE id = ?5",
            params![new_name, new_color, new_order, if new_active { 1 } else { 0 }, id],
        )?;

        let staff_count: i32 = tx.query_row(
            "SELECT COUNT(*) FROM staff_departments sd JOIN staff s ON s.id = sd.staff_id WHERE sd.department_id = ?1 AND s.is_active = 1",
            [id],
            |r| r.get(0),
        )?;
        let item_count: i32 = tx.query_row(
            "SELECT COUNT(*) FROM item_departments idp JOIN items i ON i.id = idp.item_id WHERE idp.department_id = ?1 AND i.is_active = 1",
            [id],
            |r| r.get(0),
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "department.updated",
            "departments",
            id,
            &format!("Updated department {new_name}"),
            serde_json::json!({ "is_active": new_active }),
        )?;

        Ok(DepartmentDto {
            id: id.to_string(),
            name: new_name,
            color: new_color,
            sort_order: new_order,
            is_active: new_active,
            staff_count,
            item_count,
            created_at,
        })
    })
}

pub fn insert_store_section_tx(
    tx: &Transaction<'_>,
    input: &CreateStoreSectionInput,
    now: &str,
) -> AppResult<StoreSectionDto> {
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::validation("Store section name is required.").with_field("name"));
    }

    let dup: Option<String> = tx
        .query_row(
            "SELECT id FROM store_sections WHERE LOWER(name) = LOWER(?1)",
            [&name],
            |r| r.get(0),
        )
        .optional()?;
    if dup.is_some() {
        return Err(
            ApiError::conflict(format!("Store section '{name}' already exists."))
                .with_field("name"),
        );
    }

    let sort_order = match input.sort_order {
        Some(o) => o,
        None => {
            let max_order: Option<i32> = tx.query_row(
                "SELECT MAX(sort_order) FROM store_sections",
                [],
                |r| r.get(0),
            )?;
            max_order.unwrap_or(0) + 1
        }
    };

    let id = Uuid::now_v7().to_string();
    tx.execute(
        "INSERT INTO store_sections (id, name, sort_order, is_active, created_at)
         VALUES (?1, ?2, ?3, 1, ?4)",
        params![id, name, sort_order, now],
    )?;

    Ok(StoreSectionDto {
        id,
        name,
        sort_order,
        is_active: true,
        item_count: 0,
        created_at: now.to_string(),
    })
}

pub fn list_store_sections(
    db: &Database,
    include_inactive: bool,
) -> AppResult<Vec<StoreSectionDto>> {
    db.with_read(|conn| {
        let sql = if include_inactive {
            "SELECT s.id, s.name, s.sort_order, s.is_active,
                    (SELECT COUNT(*) FROM items i WHERE i.store_section_id = s.id AND i.is_active = 1),
                    s.created_at
             FROM store_sections s
             ORDER BY s.sort_order ASC, s.name ASC"
        } else {
            "SELECT s.id, s.name, s.sort_order, s.is_active,
                    (SELECT COUNT(*) FROM items i WHERE i.store_section_id = s.id AND i.is_active = 1),
                    s.created_at
             FROM store_sections s
             WHERE s.is_active = 1
             ORDER BY s.sort_order ASC, s.name ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(StoreSectionDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    sort_order: r.get(2)?,
                    is_active: r.get::<_, i64>(3)? != 0,
                    item_count: r.get(4)?,
                    created_at: r.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn create_store_section(
    db: &Database,
    actor: &SessionUser,
    input: CreateStoreSectionInput,
) -> AppResult<StoreSectionDto> {
    require_admin(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    db.transaction(|tx| {
        let section = insert_store_section_tx(tx, &input, &now)?;
        record_activity(
            tx,
            Some(&actor.id),
            "store_section.created",
            "store_sections",
            &section.id,
            &format!("Created store section {}", section.name),
            serde_json::json!({ "name": section.name }),
        )?;
        Ok(section)
    })
}

pub fn update_store_section(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateStoreSectionInput,
) -> AppResult<StoreSectionDto> {
    require_admin(actor)?;
    db.transaction(|tx| {
        let existing: Option<(String, i32, bool, String)> = tx
            .query_row(
                "SELECT name, sort_order, is_active, created_at FROM store_sections WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get::<_, i64>(2)? != 0,
                        r.get(3)?,
                    ))
                },
            )
            .optional()?;
        let (old_name, old_order, old_active, created_at) =
            existing.ok_or_else(|| ApiError::not_found("Store section not found."))?;

        let new_name = match input.name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(
                        ApiError::validation("Store section name cannot be empty.")
                            .with_field("name"),
                    );
                }
                let dup: Option<String> = tx
                    .query_row(
                        "SELECT id FROM store_sections WHERE LOWER(name) = LOWER(?1) AND id != ?2",
                        params![t, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if dup.is_some() {
                    return Err(
                        ApiError::conflict(format!("Store section '{t}' already exists."))
                            .with_field("name"),
                    );
                }
                t
            }
            None => old_name,
        };

        let new_order = input.sort_order.unwrap_or(old_order);
        let new_active = input.is_active.unwrap_or(old_active);

        tx.execute(
            "UPDATE store_sections SET name = ?1, sort_order = ?2, is_active = ?3 WHERE id = ?4",
            params![new_name, new_order, if new_active { 1 } else { 0 }, id],
        )?;

        let item_count: i32 = tx.query_row(
            "SELECT COUNT(*) FROM items WHERE store_section_id = ?1 AND is_active = 1",
            [id],
            |r| r.get(0),
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "store_section.updated",
            "store_sections",
            id,
            &format!("Updated store section {new_name}"),
            serde_json::json!({ "is_active": new_active }),
        )?;

        Ok(StoreSectionDto {
            id: id.to_string(),
            name: new_name,
            sort_order: new_order,
            is_active: new_active,
            item_count,
            created_at,
        })
    })
}
