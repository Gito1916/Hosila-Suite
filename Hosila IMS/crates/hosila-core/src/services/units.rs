use chrono::{SecondsFormat, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_admin, require_operator};
use crate::types::{CreateUnitInput, SessionUser, UnitDto, UpdateUnitInput};

const VALID_DIMENSIONS: &[&str] = &["count", "mass", "volume", "length"];

pub fn list_units_conn(conn: &Connection) -> AppResult<Vec<UnitDto>> {
    let mut stmt = conn.prepare(
        "SELECT id, code, name, plural, dimension, allows_decimals, factor_to_dim_base_milli, is_system
         FROM units
         ORDER BY dimension ASC, factor_to_dim_base_milli ASC, name ASC",
    )?;
    let units = stmt
        .query_map([], |row| {
            Ok(UnitDto {
                id: row.get(0)?,
                code: row.get(1)?,
                name: row.get(2)?,
                plural: row.get(3)?,
                dimension: row.get(4)?,
                allows_decimals: row.get::<_, i64>(5)? != 0,
                factor_to_dim_base_milli: row.get(6)?,
                is_system: row.get::<_, i64>(7)? != 0,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(units)
}

pub fn list_units(db: &Database) -> AppResult<Vec<UnitDto>> {
    db.with_read(list_units_conn)
}

pub fn create_unit(
    db: &Database,
    actor: &SessionUser,
    input: CreateUnitInput,
) -> AppResult<UnitDto> {
    require_operator(actor)?;

    let code = input.code.trim().to_uppercase();
    let name = input.name.trim().to_string();
    let plural = input.plural.trim().to_string();
    let dimension = input.dimension.trim().to_ascii_lowercase();

    if code.is_empty() {
        return Err(ApiError::validation("Unit code is required.").with_field("code"));
    }
    if name.is_empty() {
        return Err(ApiError::validation("Unit name is required.").with_field("name"));
    }
    if plural.is_empty() {
        return Err(ApiError::validation("Plural unit name is required.").with_field("plural"));
    }
    if !VALID_DIMENSIONS.contains(&dimension.as_str()) {
        return Err(
            ApiError::validation("Dimension must be one of: count, mass, volume, length.")
                .with_field("dimension"),
        );
    }
    if input.factor_to_dim_base_milli <= 0 {
        return Err(
            ApiError::validation("Conversion factor must be greater than zero.")
                .with_field("factor_to_dim_base_milli"),
        );
    }

    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let dup: Option<String> = tx
            .query_row(
                "SELECT id FROM units WHERE UPPER(code) = UPPER(?1)",
                [&code],
                |r| r.get(0),
            )
            .optional()?;
        if dup.is_some() {
            return Err(
                ApiError::conflict(format!("Unit code '{code}' already exists."))
                    .with_field("code"),
            );
        }

        tx.execute(
            "INSERT INTO units (id, code, name, plural, dimension, allows_decimals, factor_to_dim_base_milli, is_system, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, ?8)",
            params![
                id,
                code,
                name,
                plural,
                dimension,
                if input.allows_decimals { 1 } else { 0 },
                input.factor_to_dim_base_milli,
                now
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "unit.created",
            "units",
            &id,
            &format!("Created unit {code} ({name})"),
            serde_json::json!({ "dimension": dimension }),
        )?;

        Ok(UnitDto {
            id: id.clone(),
            code,
            name,
            plural,
            dimension,
            allows_decimals: input.allows_decimals,
            factor_to_dim_base_milli: input.factor_to_dim_base_milli,
            is_system: false,
        })
    })
}

pub fn update_unit(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateUnitInput,
) -> AppResult<UnitDto> {
    require_operator(actor)?;

    db.transaction(|tx| {
        let existing: Option<(String, String, String, String, bool, i64, bool)> = tx
            .query_row(
                "SELECT code, name, plural, dimension, allows_decimals, factor_to_dim_base_milli, is_system
                 FROM units WHERE id = ?1",
                [id],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get::<_, i64>(4)? != 0,
                        r.get(5)?,
                        r.get::<_, i64>(6)? != 0,
                    ))
                },
            )
            .optional()?;

        let (code, old_name, old_plural, dimension, old_decimals, old_factor, is_system) =
            existing.ok_or_else(|| ApiError::not_found("Unit of measure not found."))?;

        let new_name = match input.name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(ApiError::validation("Unit name cannot be empty.").with_field("name"));
                }
                t
            }
            None => old_name,
        };
        let new_plural = match input.plural {
            Some(p) => {
                let t = p.trim().to_string();
                if t.is_empty() {
                    return Err(ApiError::validation("Plural name cannot be empty.").with_field("plural"));
                }
                t
            }
            None => old_plural,
        };
        let new_decimals = input.allows_decimals.unwrap_or(old_decimals);
        let new_factor = match input.factor_to_dim_base_milli {
            Some(f) => {
                if f <= 0 {
                    return Err(
                        ApiError::validation("Conversion factor must be greater than zero.")
                            .with_field("factor_to_dim_base_milli"),
                    );
                }
                if is_system && f != old_factor {
                    return Err(ApiError::conflict(format!(
                        "Cannot modify conversion factor for system unit '{code}'."
                    )));
                }
                f
            }
            None => old_factor,
        };

        tx.execute(
            "UPDATE units SET name = ?1, plural = ?2, allows_decimals = ?3, factor_to_dim_base_milli = ?4 WHERE id = ?5",
            params![
                new_name,
                new_plural,
                if new_decimals { 1 } else { 0 },
                new_factor,
                id
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "unit.updated",
            "units",
            id,
            &format!("Updated unit {code}"),
            serde_json::json!({}),
        )?;

        Ok(UnitDto {
            id: id.to_string(),
            code,
            name: new_name,
            plural: new_plural,
            dimension,
            allows_decimals: new_decimals,
            factor_to_dim_base_milli: new_factor,
            is_system,
        })
    })
}

pub fn delete_unit(db: &Database, actor: &SessionUser, id: &str) -> AppResult<()> {
    require_admin(actor)?;

    db.transaction(|tx| {
        let existing: Option<(String, bool)> = tx
            .query_row(
                "SELECT code, is_system FROM units WHERE id = ?1",
                [id],
                |r| Ok((r.get(0)?, r.get::<_, i64>(1)? != 0)),
            )
            .optional()?;
        let (code, is_system) =
            existing.ok_or_else(|| ApiError::not_found("Unit of measure not found."))?;

        if is_system {
            return Err(ApiError::conflict(format!(
                "System unit '{code}' cannot be deleted."
            )));
        }

        let in_use_count: i64 = tx.query_row(
            "SELECT
                (SELECT COUNT(*) FROM items WHERE base_unit_id = ?1 OR display_unit_id = ?1 OR default_issue_unit_id = ?1 OR default_purchase_unit_id = ?1)
              + (SELECT COUNT(*) FROM item_units WHERE unit_id = ?1)
              + (SELECT COUNT(*) FROM collection_lines WHERE unit_id = ?1)
              + (SELECT COUNT(*) FROM procurement_lines WHERE unit_id = ?1)
              + (SELECT COUNT(*) FROM receipt_lines WHERE unit_id = ?1)
              + (SELECT COUNT(*) FROM adjustment_lines WHERE unit_id = ?1)
              + (SELECT COUNT(*) FROM stock_movements WHERE input_unit_id = ?1)",
            [id],
            |r| r.get(0),
        )?;

        if in_use_count > 0 {
            return Err(ApiError::conflict(format!(
                "Cannot delete unit '{code}' because it is referenced by existing items or records."
            )));
        }

        tx.execute("DELETE FROM units WHERE id = ?1", [id])?;
        record_activity(
            tx,
            Some(&actor.id),
            "unit.deleted",
            "units",
            id,
            &format!("Deleted unit {code}"),
            serde_json::json!({}),
        )?;

        Ok(())
    })
}
