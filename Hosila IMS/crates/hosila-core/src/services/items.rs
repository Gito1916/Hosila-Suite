use std::collections::{HashMap, HashSet};

use chrono::{SecondsFormat, Utc};
use rusqlite::{params, types::Value as SqlValue, Connection, OptionalExtension, Transaction};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::{line_value_minor, round_div_half_even, MILLI_SCALE};
use crate::domain::numbering::next_doc_number;
use crate::domain::uom::{
    classify_stock_status, format_stock_display, is_unusual_conversion_factor, resolve_factor_milli,
};
use crate::error::{ApiError, AppResult};
use crate::services::activity::record_activity;
use crate::services::auth::{require_admin, require_operator};
use crate::services::units::list_units_conn;
use crate::services::{clean_opt, now_rfc3339, today_iso, validate_department_ids};
use crate::types::{
    ChangeBaseUnitInput, CreateItemInput, CreateSupplierInput, ItemDetailDto, ItemFilter,
    ItemListRowDto, ItemUnitDto, ItemUnitInput, SessionUser, StockMovementDto, SupplierDto,
    UnitDto, UpdateItemInput, UpdateSupplierInput,
};

// ── Suppliers ───────────────────────────────────────────────────────────────

pub fn list_suppliers(db: &Database, include_inactive: bool) -> AppResult<Vec<SupplierDto>> {
    db.with_read(|conn| {
        let sql = if include_inactive {
            "SELECT id, name, phone, email, notes, is_active, created_at FROM suppliers ORDER BY is_active DESC, name ASC"
        } else {
            "SELECT id, name, phone, email, notes, is_active, created_at FROM suppliers WHERE is_active = 1 ORDER BY name ASC"
        };
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt
            .query_map([], |r| {
                Ok(SupplierDto {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    phone: r.get(2)?,
                    email: r.get(3)?,
                    notes: r.get(4)?,
                    is_active: r.get::<_, i64>(5)? != 0,
                    created_at: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    })
}

pub fn create_supplier(
    db: &Database,
    actor: &SessionUser,
    input: CreateSupplierInput,
) -> AppResult<SupplierDto> {
    require_operator(actor)?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::validation("Supplier name is required.").with_field("name"));
    }
    let phone = clean_opt(input.phone);
    let email = clean_opt(input.email);
    let notes = clean_opt(input.notes);
    let id = Uuid::now_v7().to_string();
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let dup: Option<String> = tx
            .query_row(
                "SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?1)",
                [&name],
                |r| r.get(0),
            )
            .optional()?;
        if dup.is_some() {
            return Err(
                ApiError::conflict(format!("Supplier '{name}' already exists."))
                    .with_field("name"),
            );
        }

        tx.execute(
            "INSERT INTO suppliers (id, name, phone, email, notes, is_active, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6)",
            params![id, name, phone, email, notes, now],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "supplier.created",
            "suppliers",
            &id,
            &format!("Added supplier {name}"),
            serde_json::json!({}),
        )?;

        Ok(SupplierDto {
            id,
            name,
            phone,
            email,
            notes,
            is_active: true,
            created_at: now,
        })
    })
}

pub fn update_supplier(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateSupplierInput,
) -> AppResult<SupplierDto> {
    require_operator(actor)?;
    db.transaction(|tx| {
        let existing: Option<(String, Option<String>, Option<String>, Option<String>, bool, String)> =
            tx.query_row(
                "SELECT name, phone, email, notes, is_active, created_at FROM suppliers WHERE id = ?1",
                [id],
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
            )
            .optional()?;
        let (old_name, old_phone, old_email, old_notes, old_active, created_at) =
            existing.ok_or_else(|| ApiError::not_found("Supplier not found."))?;

        let new_name = match input.name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(
                        ApiError::validation("Supplier name cannot be empty.").with_field("name")
                    );
                }
                let dup: Option<String> = tx
                    .query_row(
                        "SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?1) AND id != ?2",
                        params![t, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if dup.is_some() {
                    return Err(
                        ApiError::conflict(format!("Supplier '{t}' already exists."))
                            .with_field("name"),
                    );
                }
                t
            }
            None => old_name,
        };
        let new_phone = match input.phone {
            Some(v) => clean_opt(Some(v)),
            None => old_phone,
        };
        let new_email = match input.email {
            Some(v) => clean_opt(Some(v)),
            None => old_email,
        };
        let new_notes = match input.notes {
            Some(v) => clean_opt(Some(v)),
            None => old_notes,
        };
        let new_active = input.is_active.unwrap_or(old_active);

        tx.execute(
            "UPDATE suppliers SET name = ?1, phone = ?2, email = ?3, notes = ?4, is_active = ?5 WHERE id = ?6",
            params![
                new_name,
                new_phone,
                new_email,
                new_notes,
                if new_active { 1 } else { 0 },
                id
            ],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "supplier.updated",
            "suppliers",
            id,
            &format!("Updated supplier {new_name}"),
            serde_json::json!({ "is_active": new_active }),
        )?;

        Ok(SupplierDto {
            id: id.to_string(),
            name: new_name,
            phone: new_phone,
            email: new_email,
            notes: new_notes,
            is_active: new_active,
            created_at,
        })
    })
}

// ── Helpers ─────────────────────────────────────────────────────────────────

pub fn load_unit_map(conn: &Connection) -> AppResult<HashMap<String, UnitDto>> {
    Ok(list_units_conn(conn)?
        .into_iter()
        .map(|u| (u.id.clone(), u))
        .collect())
}

pub fn refresh_item_fts(tx: &Transaction<'_>, item_id: &str) -> AppResult<()> {
    let row: Option<(String, String)> = tx
        .query_row(
            "SELECT name, sku FROM items WHERE id = ?1",
            [item_id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    let Some((name, sku)) = row else {
        return Ok(());
    };

    let mut stmt = tx.prepare("SELECT alias_normalized FROM item_aliases WHERE item_id = ?1")?;
    let aliases = stmt
        .query_map([item_id], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?
        .join(" ");

    tx.execute("DELETE FROM items_fts WHERE item_id = ?1", [item_id])?;
    tx.execute(
        "INSERT INTO items_fts (item_id, name, sku, aliases) VALUES (?1, ?2, ?3, ?4)",
        params![item_id, name, sku, aliases],
    )?;
    Ok(())
}

fn validate_and_replace_item_units(
    tx: &Transaction<'_>,
    item_id: &str,
    base_unit_id: &str,
    units: &[ItemUnitInput],
) -> AppResult<()> {
    tx.execute("DELETE FROM item_units WHERE item_id = ?1", [item_id])?;
    let mut seen = HashSet::new();
    for u in units {
        let uid = u.unit_id.trim().to_string();
        if uid.is_empty() || uid == base_unit_id || !seen.insert(uid.clone()) {
            continue;
        }
        let exists: Option<String> = tx
            .query_row("SELECT id FROM units WHERE id = ?1", [&uid], |r| r.get(0))
            .optional()?;
        if exists.is_none() {
            return Err(
                ApiError::not_found(format!("Unit '{uid}' does not exist."))
                    .with_field("item_units"),
            );
        }
        if u.factor_milli <= 0 {
            return Err(
                ApiError::validation("Item unit conversion factor must be greater than zero.")
                    .with_field("item_units"),
            );
        }
        let label_override = clean_opt(u.label_override.clone());
        tx.execute(
            "INSERT INTO item_units (id, item_id, unit_id, factor_milli, can_purchase, can_issue, label_override)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                Uuid::now_v7().to_string(),
                item_id,
                uid,
                u.factor_milli,
                if u.can_purchase { 1 } else { 0 },
                if u.can_issue { 1 } else { 0 },
                label_override
            ],
        )?;
    }
    Ok(())
}

fn build_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split(|c: char| !c.is_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| format!("{s}*"))
        .collect();
    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

pub fn next_auto_sku(tx: &Transaction<'_>) -> AppResult<String> {
    tx.execute(
        "INSERT OR IGNORE INTO doc_sequences (doc_type, prefix, next_value) VALUES ('item_sku', 'ITM', 1)",
        [],
    )?;
    loop {
        let seq: i64 = tx.query_row(
            "SELECT next_value FROM doc_sequences WHERE doc_type = 'item_sku'",
            [],
            |r| r.get(0),
        )?;
        tx.execute(
            "UPDATE doc_sequences SET next_value = next_value + 1 WHERE doc_type = 'item_sku'",
            [],
        )?;
        let candidate = format!("ITM-{seq:06}");
        let dup: Option<String> = tx
            .query_row(
                "SELECT id FROM items WHERE UPPER(sku) = UPPER(?1)",
                [&candidate],
                |r| r.get(0),
            )
            .optional()?;
        if dup.is_none() {
            return Ok(candidate);
        }
    }
}

pub fn load_item_units(conn: &Connection, item_id: &str) -> AppResult<Vec<ItemUnitDto>> {
    let mut stmt = conn.prepare(
        "SELECT iu.id, iu.unit_id, u.code, u.name, u.plural, u.dimension, iu.factor_milli,
                iu.can_purchase, iu.can_issue, iu.label_override
         FROM item_units iu
         JOIN units u ON u.id = iu.unit_id
         WHERE iu.item_id = ?1
         ORDER BY iu.factor_milli ASC, u.name ASC",
    )?;
    let rows = stmt
        .query_map([item_id], |r| {
            let dim: String = r.get(5)?;
            let factor: i64 = r.get(6)?;
            Ok(ItemUnitDto {
                id: r.get(0)?,
                unit_id: r.get(1)?,
                unit_code: r.get(2)?,
                unit_name: r.get(3)?,
                unit_plural: r.get(4)?,
                factor_milli: factor,
                can_purchase: r.get::<_, i64>(7)? != 0,
                can_issue: r.get::<_, i64>(8)? != 0,
                label_override: r.get(9)?,
                is_unusual_factor: is_unusual_conversion_factor(&dim, factor),
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

fn load_item_row_conn(conn: &Connection, item_id: &str) -> AppResult<ItemListRowDto> {
    let units_map = load_unit_map(conn)?;
    let row: Option<(
        String,
        String,
        String,
        Option<String>,
        String,
        String,
        String,
        String,
        Option<String>,
        Option<String>,
        i64,
        i64,
        i64,
        bool,
        bool,
        i64,
        i64,
        Option<String>,
        Option<String>,
        Option<String>,
        bool,
    )> = conn
        .query_row(
            "SELECT i.id, i.sku, i.name, i.description,
                    i.base_unit_id, i.display_unit_id, i.default_issue_unit_id, i.default_purchase_unit_id,
                    i.store_section_id, ss.name,
                    i.on_hand_milli, i.avg_cost_micro, i.last_cost_micro, i.cost_missing, i.is_returnable,
                    i.reorder_point_milli, i.par_level_milli, i.storage_location, i.supplier_id, sup.name, i.is_active
             FROM items i
             LEFT JOIN store_sections ss ON ss.id = i.store_section_id
             LEFT JOIN suppliers sup ON sup.id = i.supplier_id
             WHERE i.id = ?1",
            [item_id],
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
                    r.get::<_, i64>(13)? != 0,
                    r.get::<_, i64>(14)? != 0,
                    r.get(15)?,
                    r.get(16)?,
                    r.get(17)?,
                    r.get(18)?,
                    r.get(19)?,
                    r.get::<_, i64>(20)? != 0,
                ))
            },
        )
        .optional()?;

    let (
        id,
        sku,
        name,
        description,
        base_unit_id,
        display_unit_id,
        default_issue_unit_id,
        default_purchase_unit_id,
        store_section_id,
        store_section_name,
        on_hand_milli,
        avg_cost_micro,
        last_cost_micro,
        cost_missing,
        is_returnable,
        reorder_point_milli,
        par_level_milli,
        storage_location,
        supplier_id,
        supplier_name,
        is_active,
    ) = row.ok_or_else(|| ApiError::not_found("Inventory item not found."))?;

    let mut d_stmt = conn.prepare(
        "SELECT d.id, d.name
         FROM item_departments idp
         JOIN departments d ON d.id = idp.department_id
         WHERE idp.item_id = ?1
         ORDER BY d.sort_order ASC, d.name ASC",
    )?;
    let depts = d_stmt
        .query_map([&id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
        .collect::<Result<Vec<_>, _>>()?;
    let department_ids: Vec<String> = depts.iter().map(|(did, _)| did.clone()).collect();
    let department_names: Vec<String> = depts.into_iter().map(|(_, dn)| dn).collect();

    let item_units = load_item_units(conn, &id)?;
    let base_unit = units_map
        .get(&base_unit_id)
        .ok_or_else(|| ApiError::internal("Missing base unit reference"))?;
    let display_unit = units_map.get(&display_unit_id).unwrap_or(base_unit);

    let display_stock = format_stock_display(on_hand_milli, base_unit, display_unit, &item_units);
    let stock_value_minor = line_value_minor(on_hand_milli.max(0), avg_cost_micro)?;
    let stock_status = classify_stock_status(on_hand_milli, reorder_point_milli);

    Ok(ItemListRowDto {
        id,
        sku,
        name,
        description,
        base_unit_id,
        base_unit_code: base_unit.code.clone(),
        base_unit_name: base_unit.name.clone(),
        base_unit_plural: base_unit.plural.clone(),
        display_unit_id,
        default_issue_unit_id,
        default_purchase_unit_id,
        store_section_id,
        store_section_name,
        department_ids,
        department_names,
        on_hand_milli,
        display_stock,
        avg_cost_micro,
        last_cost_micro,
        stock_value_minor,
        cost_missing,
        is_returnable,
        reorder_point_milli,
        par_level_milli,
        stock_status,
        storage_location,
        supplier_id,
        supplier_name,
        is_active,
        item_units,
    })
}

// ── Public Service Functions ────────────────────────────────────────────────

pub fn list_items(db: &Database, filter: ItemFilter) -> AppResult<Vec<ItemListRowDto>> {
    db.with_read(|conn| {
        let units_map = load_unit_map(conn)?;

        let mut clauses: Vec<String> = Vec::new();
        let mut binds: Vec<SqlValue> = Vec::new();

        if !filter.include_inactive {
            clauses.push("i.is_active = 1".to_string());
        }
        if filter.cost_missing_only {
            clauses.push("i.cost_missing = 1".to_string());
        }
        if filter.returnable_only {
            clauses.push("i.is_returnable = 1".to_string());
        }
        if let Some(dept_id) = clean_opt(filter.department_id.clone()) {
            clauses.push(
                "EXISTS (SELECT 1 FROM item_departments idp WHERE idp.item_id = i.id AND idp.department_id = ?)".to_string(),
            );
            binds.push(SqlValue::Text(dept_id));
        }
        if let Some(sec_id) = clean_opt(filter.store_section_id.clone()) {
            clauses.push("i.store_section_id = ?".to_string());
            binds.push(SqlValue::Text(sec_id));
        }
        if let Some(search_raw) = clean_opt(filter.search.clone()) {
            if let Some(fts_expr) = build_fts_query(&search_raw) {
                let like_pattern = format!("%{}%", search_raw.to_lowercase());
                clauses.push(
                    "(EXISTS (SELECT 1 FROM items_fts f WHERE f.item_id = i.id AND items_fts MATCH ?) OR LOWER(i.name) LIKE ? OR LOWER(i.sku) LIKE ?)".to_string(),
                );
                binds.push(SqlValue::Text(fts_expr));
                binds.push(SqlValue::Text(like_pattern.clone()));
                binds.push(SqlValue::Text(like_pattern));
            } else {
                let like_pattern = format!("%{}%", search_raw.to_lowercase());
                clauses.push("(LOWER(i.name) LIKE ? OR LOWER(i.sku) LIKE ?)".to_string());
                binds.push(SqlValue::Text(like_pattern.clone()));
                binds.push(SqlValue::Text(like_pattern));
            }
        }

        let where_sql = if clauses.is_empty() {
            String::new()
        } else {
            format!("WHERE {}", clauses.join(" AND "))
        };

        let sql = format!(
            "SELECT i.id, i.sku, i.name, i.description,
                    i.base_unit_id, i.display_unit_id, i.default_issue_unit_id, i.default_purchase_unit_id,
                    i.store_section_id, ss.name,
                    i.on_hand_milli, i.avg_cost_micro, i.last_cost_micro, i.cost_missing, i.is_returnable,
                    i.reorder_point_milli, i.par_level_milli, i.storage_location, i.supplier_id, sup.name, i.is_active
             FROM items i
             LEFT JOIN store_sections ss ON ss.id = i.store_section_id
             LEFT JOIN suppliers sup ON sup.id = i.supplier_id
             {where_sql}
             ORDER BY i.name ASC"
        );

        let mut stmt = conn.prepare(&sql)?;
        let item_rows = stmt
            .query_map(rusqlite::params_from_iter(binds), |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, String>(4)?,
                    r.get::<_, String>(5)?,
                    r.get::<_, String>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, Option<String>>(8)?,
                    r.get::<_, Option<String>>(9)?,
                    r.get::<_, i64>(10)?,
                    r.get::<_, i64>(11)?,
                    r.get::<_, i64>(12)?,
                    r.get::<_, i64>(13)? != 0,
                    r.get::<_, i64>(14)? != 0,
                    r.get::<_, i64>(15)?,
                    r.get::<_, i64>(16)?,
                    r.get::<_, Option<String>>(17)?,
                    r.get::<_, Option<String>>(18)?,
                    r.get::<_, Option<String>>(19)?,
                    r.get::<_, i64>(20)? != 0,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;

        // Bulk load departments & item_units to avoid N+1 queries over hundreds of items
        let mut dept_map: HashMap<String, (Vec<String>, Vec<String>)> = HashMap::new();
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
                let entry = dept_map.entry(iid).or_default();
                entry.0.push(did);
                entry.1.push(dname);
            }
        }

        let mut iu_map: HashMap<String, Vec<ItemUnitDto>> = HashMap::new();
        {
            let mut u_stmt = conn.prepare(
                "SELECT iu.item_id, iu.id, iu.unit_id, u.code, u.name, u.plural, u.dimension,
                        iu.factor_milli, iu.can_purchase, iu.can_issue, iu.label_override
                 FROM item_units iu
                 JOIN units u ON u.id = iu.unit_id
                 ORDER BY iu.factor_milli ASC, u.name ASC",
            )?;
            let u_rows = u_stmt
                .query_map([], |r| {
                    let dim: String = r.get(6)?;
                    let factor: i64 = r.get(7)?;
                    Ok((
                        r.get::<_, String>(0)?,
                        ItemUnitDto {
                            id: r.get(1)?,
                            unit_id: r.get(2)?,
                            unit_code: r.get(3)?,
                            unit_name: r.get(4)?,
                            unit_plural: r.get(5)?,
                            factor_milli: factor,
                            can_purchase: r.get::<_, i64>(8)? != 0,
                            can_issue: r.get::<_, i64>(9)? != 0,
                            label_override: r.get(10)?,
                            is_unusual_factor: is_unusual_conversion_factor(&dim, factor),
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            for (iid, dto) in u_rows {
                iu_map.entry(iid).or_default().push(dto);
            }
        }

        let status_filter = filter.status;
        let mut results = Vec::with_capacity(item_rows.len());

        for (
            id,
            sku,
            name,
            description,
            base_unit_id,
            display_unit_id,
            default_issue_unit_id,
            default_purchase_unit_id,
            store_section_id,
            store_section_name,
            on_hand_milli,
            avg_cost_micro,
            last_cost_micro,
            cost_missing,
            is_returnable,
            reorder_point_milli,
            par_level_milli,
            storage_location,
            supplier_id,
            supplier_name,
            is_active,
        ) in item_rows
        {
            let stock_status = classify_stock_status(on_hand_milli, reorder_point_milli);
            if let Some(sf) = status_filter {
                if sf != stock_status {
                    continue;
                }
            }

            let base_unit = units_map
                .get(&base_unit_id)
                .ok_or_else(|| ApiError::internal("Missing base unit reference"))?;
            let display_unit = units_map.get(&display_unit_id).unwrap_or(base_unit);
            let item_units = iu_map.remove(&id).unwrap_or_default();
            let (department_ids, department_names) = dept_map.remove(&id).unwrap_or_default();
            let display_stock =
                format_stock_display(on_hand_milli, base_unit, display_unit, &item_units);
            let stock_value_minor = line_value_minor(on_hand_milli.max(0), avg_cost_micro)?;

            results.push(ItemListRowDto {
                id,
                sku,
                name,
                description,
                base_unit_id,
                base_unit_code: base_unit.code.clone(),
                base_unit_name: base_unit.name.clone(),
                base_unit_plural: base_unit.plural.clone(),
                display_unit_id,
                default_issue_unit_id,
                default_purchase_unit_id,
                store_section_id,
                store_section_name,
                department_ids,
                department_names,
                on_hand_milli,
                display_stock,
                avg_cost_micro,
                last_cost_micro,
                stock_value_minor,
                cost_missing,
                is_returnable,
                reorder_point_milli,
                par_level_milli,
                stock_status,
                storage_location,
                supplier_id,
                supplier_name,
                is_active,
                item_units,
            });
        }

        Ok(results)
    })
}

pub fn get_item_detail(db: &Database, item_id: &str) -> AppResult<ItemDetailDto> {
    db.with_read(|conn| {
        let item = load_item_row_conn(conn, item_id)?;
        let mut a_stmt = conn.prepare(
            "SELECT alias_normalized FROM item_aliases WHERE item_id = ?1 ORDER BY alias_normalized ASC",
        )?;
        let aliases = a_stmt
            .query_map([item_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;

        let mov_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM stock_movements WHERE item_id = ?1",
            [item_id],
            |r| r.get(0),
        )?;

        let recent_movements = query_movements_conn(conn, Some(item_id), None, None, 50)?;
        Ok(ItemDetailDto {
            item,
            aliases,
            has_movements: mov_count > 0,
            recent_movements,
        })
    })
}

pub fn get_item_stock_card(
    db: &Database,
    item_id: &str,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i32>,
) -> AppResult<Vec<StockMovementDto>> {
    db.with_read(|conn| {
        let exists: Option<String> = conn
            .query_row("SELECT id FROM items WHERE id = ?1", [item_id], |r| r.get(0))
            .optional()?;
        if exists.is_none() {
            return Err(ApiError::not_found("Inventory item not found."));
        }
        query_movements_conn(
            conn,
            Some(item_id),
            start_date.as_deref(),
            end_date.as_deref(),
            limit.unwrap_or(200).clamp(1, 1000),
        )
    })
}

pub fn query_movements_conn(
    conn: &Connection,
    item_id: Option<&str>,
    start_date: Option<&str>,
    end_date: Option<&str>,
    limit: i32,
) -> AppResult<Vec<StockMovementDto>> {
    let mut clauses = Vec::new();
    let mut binds: Vec<SqlValue> = Vec::new();

    if let Some(iid) = item_id {
        clauses.push("m.item_id = ?".to_string());
        binds.push(SqlValue::Text(iid.to_string()));
    }
    if let Some(sd) = start_date.map(str::trim).filter(|s| !s.is_empty()) {
        clauses.push("m.business_date >= ?".to_string());
        binds.push(SqlValue::Text(sd.to_string()));
    }
    if let Some(ed) = end_date.map(str::trim).filter(|s| !s.is_empty()) {
        clauses.push("m.business_date <= ?".to_string());
        binds.push(SqlValue::Text(ed.to_string()));
    }
    let where_sql = if clauses.is_empty() {
        String::new()
    } else {
        format!("WHERE {}", clauses.join(" AND "))
    };

    binds.push(SqlValue::Integer(i64::from(limit)));
    let sql = format!(
        "SELECT m.id, m.item_id, i.name, m.type, m.qty_milli, m.balance_after_milli,
                m.unit_cost_micro, m.value_minor, m.department_id, d.name,
                m.doc_type, m.doc_id, m.doc_number, u.code, m.input_qty_milli, m.factor_milli,
                usr.full_name, cp.full_name, sk.full_name, m.business_date, m.created_at
         FROM stock_movements m
         JOIN items i ON i.id = m.item_id
         JOIN units u ON u.id = m.input_unit_id
         JOIN users usr ON usr.id = m.actor_user_id
         LEFT JOIN departments d ON d.id = m.department_id
         LEFT JOIN staff cp ON cp.id = m.counterparty_staff_id
         LEFT JOIN staff sk ON sk.id = m.storekeeper_staff_id
         {where_sql}
         ORDER BY m.business_date DESC, m.created_at DESC
         LIMIT ?"
    );

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(binds), |r| {
            Ok(StockMovementDto {
                id: r.get(0)?,
                item_id: r.get(1)?,
                item_name: r.get(2)?,
                movement_type: r.get(3)?,
                qty_milli: r.get(4)?,
                balance_after_milli: r.get(5)?,
                unit_cost_micro: r.get(6)?,
                value_minor: r.get(7)?,
                department_id: r.get(8)?,
                department_name: r.get(9)?,
                doc_type: r.get(10)?,
                doc_id: r.get(11)?,
                doc_number: r.get(12)?,
                input_unit_code: r.get(13)?,
                input_qty_milli: r.get(14)?,
                factor_milli: r.get(15)?,
                actor_name: r.get(16)?,
                counterparty_staff_name: r.get(17)?,
                storekeeper_staff_name: r.get(18)?,
                business_date: r.get(19)?,
                created_at: r.get(20)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

pub fn create_item(
    db: &Database,
    actor: &SessionUser,
    input: CreateItemInput,
) -> AppResult<ItemListRowDto> {
    require_operator(actor)?;
    let name = input.name.trim().to_string();
    if name.is_empty() {
        return Err(ApiError::validation("Item name is required.").with_field("name"));
    }
    if input.reorder_point_milli < 0 || input.par_level_milli < 0 {
        return Err(ApiError::validation("Stock thresholds cannot be negative."));
    }
    if input.initial_unit_cost_micro < 0 {
        return Err(
            ApiError::validation("Unit cost cannot be negative.")
                .with_field("initial_unit_cost_micro"),
        );
    }
    if input.opening_stock_milli < 0 {
        return Err(
            ApiError::validation("Opening stock cannot be negative.")
                .with_field("opening_stock_milli"),
        );
    }

    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let opening_date = clean_opt(input.opening_date)
        .unwrap_or_else(|| Utc::now().format("%Y-%m-%d").to_string());
    let description = clean_opt(input.description);
    let storage_location = clean_opt(input.storage_location);
    let store_section_id = clean_opt(input.store_section_id);
    let supplier_id = clean_opt(input.supplier_id);

    db.transaction(|tx| {
        let base_exists: Option<String> = tx
            .query_row(
                "SELECT id FROM units WHERE id = ?1",
                [&input.base_unit_id],
                |r| r.get(0),
            )
            .optional()?;
        if base_exists.is_none() {
            return Err(ApiError::not_found("Base unit not found.").with_field("base_unit_id"));
        }

        if let Some(ref sec_id) = store_section_id {
            let sec_exists: Option<String> = tx
                .query_row(
                    "SELECT id FROM store_sections WHERE id = ?1",
                    [sec_id],
                    |r| r.get(0),
                )
                .optional()?;
            if sec_exists.is_none() {
                return Err(
                    ApiError::not_found("Store section not found.").with_field("store_section_id")
                );
            }
        }

        if let Some(ref sup_id) = supplier_id {
            let sup_exists: Option<String> = tx
                .query_row("SELECT id FROM suppliers WHERE id = ?1", [sup_id], |r| r.get(0))
                .optional()?;
            if sup_exists.is_none() {
                return Err(ApiError::not_found("Supplier not found.").with_field("supplier_id"));
            }
        }

        let dept_ids = validate_department_ids(tx, &input.department_ids, true)?;

        let dup_name: Option<String> = tx
            .query_row(
                "SELECT id FROM items WHERE LOWER(name) = LOWER(?1) AND is_active = 1",
                [&name],
                |r| r.get(0),
            )
            .optional()?;
        if dup_name.is_some() {
            return Err(
                ApiError::conflict(format!("An active item named '{name}' already exists."))
                    .with_field("name"),
            );
        }

        let sku = match clean_opt(input.sku) {
            Some(s) => {
                let upper = s.to_uppercase();
                let dup_sku: Option<String> = tx
                    .query_row(
                        "SELECT id FROM items WHERE UPPER(sku) = UPPER(?1)",
                        [&upper],
                        |r| r.get(0),
                    )
                    .optional()?;
                if dup_sku.is_some() {
                    return Err(
                        ApiError::conflict(format!("SKU '{upper}' is already in use."))
                            .with_field("sku"),
                    );
                }
                upper
            }
            None => next_auto_sku(tx)?,
        };

        let display_unit_id = clean_opt(input.display_unit_id)
            .unwrap_or_else(|| input.base_unit_id.clone());
        let issue_unit_id = clean_opt(input.default_issue_unit_id)
            .unwrap_or_else(|| input.base_unit_id.clone());
        let purchase_unit_id = clean_opt(input.default_purchase_unit_id)
            .unwrap_or_else(|| input.base_unit_id.clone());

        let item_id = Uuid::now_v7().to_string();
        let cost_missing = input.cost_missing || input.initial_unit_cost_micro == 0;

        tx.execute(
            "INSERT INTO items (
                id, sku, name, description, base_unit_id, display_unit_id,
                default_issue_unit_id, default_purchase_unit_id, store_section_id,
                on_hand_milli, avg_cost_micro, last_cost_micro, cost_missing, is_returnable,
                reorder_point_milli, par_level_milli, supplier_id, storage_location,
                is_active, created_at, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?13, ?14, ?15, ?16, ?17, 1, ?18, ?18)",
            params![
                item_id,
                sku,
                name,
                description,
                input.base_unit_id,
                display_unit_id,
                issue_unit_id,
                purchase_unit_id,
                store_section_id,
                input.opening_stock_milli,
                input.initial_unit_cost_micro,
                if cost_missing { 1 } else { 0 },
                if input.is_returnable { 1 } else { 0 },
                input.reorder_point_milli,
                input.par_level_milli,
                supplier_id,
                storage_location,
                now
            ],
        )?;

        for did in dept_ids {
            tx.execute(
                "INSERT INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                params![item_id, did],
            )?;
        }

        validate_and_replace_item_units(tx, &item_id, &input.base_unit_id, &input.item_units)?;
        refresh_item_fts(tx, &item_id)?;

        // Validate that display/issue/purchase units actually resolve against the item's units
        let unit_map = load_unit_map(tx)?;
        let item_units_saved = load_item_units(tx, &item_id)?;
        let base_unit = unit_map
            .get(&input.base_unit_id)
            .ok_or_else(|| ApiError::not_found("Base unit not found."))?;
        for check_uid in [&display_unit_id, &issue_unit_id, &purchase_unit_id] {
            let target = unit_map
                .get(check_uid)
                .ok_or_else(|| ApiError::not_found("Selected item unit was not found."))?;
            resolve_factor_milli(base_unit, target, &item_units_saved)?;
        }

        if input.opening_stock_milli > 0 {
            let doc_num = next_doc_number(tx, "adjustment", Utc::now().format("%Y").to_string().parse().unwrap_or(2026))
                .unwrap_or_else(|_| format!("OPEN-{sku}"));
            let value_minor = line_value_minor(input.opening_stock_milli, input.initial_unit_cost_micro)?;
            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    doc_type, doc_id, doc_number, input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, business_date, created_at
                ) VALUES (?1, ?2, 'opening', ?3, ?3, ?4, ?5, 'opening', ?2, ?6, ?7, ?3, 1000, ?8, ?9, ?10)",
                params![
                    Uuid::now_v7().to_string(),
                    item_id,
                    input.opening_stock_milli,
                    input.initial_unit_cost_micro,
                    value_minor,
                    doc_num,
                    input.base_unit_id,
                    actor.id,
                    opening_date,
                    now
                ],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "item.created",
            "items",
            &item_id,
            &format!("Created item {name} ({sku})"),
            serde_json::json!({ "sku": sku, "opening_stock_milli": input.opening_stock_milli }),
        )?;

        load_item_row_conn(tx, &item_id)
    })
}

pub fn update_item(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: UpdateItemInput,
) -> AppResult<ItemListRowDto> {
    require_operator(actor)?;
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    db.transaction(|tx| {
        let existing: Option<(
            String,
            Option<String>,
            String,
            String,
            String,
            String,
            Option<String>,
            i64,
            i64,
            bool,
            bool,
            i64,
            i64,
            Option<String>,
            Option<String>,
            bool,
        )> = tx
            .query_row(
                "SELECT name, description, base_unit_id, display_unit_id, default_issue_unit_id,
                        default_purchase_unit_id, store_section_id, avg_cost_micro, last_cost_micro,
                        cost_missing, is_returnable, reorder_point_milli, par_level_milli,
                        supplier_id, storage_location, is_active
                 FROM items WHERE id = ?1",
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
                        r.get::<_, i64>(9)? != 0,
                        r.get::<_, i64>(10)? != 0,
                        r.get(11)?,
                        r.get(12)?,
                        r.get(13)?,
                        r.get(14)?,
                        r.get::<_, i64>(15)? != 0,
                    ))
                },
            )
            .optional()?;

        let (
            old_name,
            old_desc,
            base_unit_id,
            old_disp,
            old_issue,
            old_purch,
            old_sec,
            old_avg_cost,
            old_last_cost,
            old_cost_missing,
            old_returnable,
            old_reorder,
            old_par,
            old_sup,
            old_loc,
            old_active,
        ) = existing.ok_or_else(|| ApiError::not_found("Inventory item not found."))?;

        let new_name = match input.name {
            Some(n) => {
                let t = n.trim().to_string();
                if t.is_empty() {
                    return Err(ApiError::validation("Item name cannot be empty.").with_field("name"));
                }
                let dup: Option<String> = tx
                    .query_row(
                        "SELECT id FROM items WHERE LOWER(name) = LOWER(?1) AND is_active = 1 AND id != ?2",
                        params![t, id],
                        |r| r.get(0),
                    )
                    .optional()?;
                if dup.is_some() {
                    return Err(
                        ApiError::conflict(format!("An active item named '{t}' already exists."))
                            .with_field("name"),
                    );
                }
                t
            }
            None => old_name,
        };

        let new_desc = match input.description {
            Some(d) => clean_opt(Some(d)),
            None => old_desc,
        };
        let new_loc = match input.storage_location {
            Some(l) => clean_opt(Some(l)),
            None => old_loc,
        };
        let new_sec = if input.clear_store_section.unwrap_or(false) {
            None
        } else {
            match input.store_section_id {
                Some(s) => clean_opt(Some(s)),
                None => old_sec,
            }
        };
        if let Some(ref sid) = new_sec {
            let exists: Option<String> = tx
                .query_row("SELECT id FROM store_sections WHERE id = ?1", [sid], |r| r.get(0))
                .optional()?;
            if exists.is_none() {
                return Err(
                    ApiError::not_found("Store section not found.").with_field("store_section_id")
                );
            }
        }

        let new_sup = if input.clear_supplier.unwrap_or(false) {
            None
        } else {
            match input.supplier_id {
                Some(s) => clean_opt(Some(s)),
                None => old_sup,
            }
        };
        if let Some(ref sup_id) = new_sup {
            let exists: Option<String> = tx
                .query_row("SELECT id FROM suppliers WHERE id = ?1", [sup_id], |r| r.get(0))
                .optional()?;
            if exists.is_none() {
                return Err(ApiError::not_found("Supplier not found.").with_field("supplier_id"));
            }
        }

        let new_reorder = input.reorder_point_milli.unwrap_or(old_reorder);
        let new_par = input.par_level_milli.unwrap_or(old_par);
        if new_reorder < 0 || new_par < 0 {
            return Err(ApiError::validation("Stock thresholds cannot be negative."));
        }

        let (new_avg_cost, new_last_cost, new_cost_missing) = match input.unit_cost_micro {
            Some(c) => {
                if c < 0 {
                    return Err(
                        ApiError::validation("Unit cost cannot be negative.")
                            .with_field("unit_cost_micro"),
                    );
                }
                if !old_cost_missing && c != old_avg_cost {
                    require_admin(actor)?;
                }
                (c, c, input.cost_missing.unwrap_or(c == 0))
            }
            None => (
                old_avg_cost,
                old_last_cost,
                input.cost_missing.unwrap_or(old_cost_missing),
            ),
        };

        let new_disp = clean_opt(input.display_unit_id).unwrap_or(old_disp);
        let new_issue = clean_opt(input.default_issue_unit_id).unwrap_or(old_issue);
        let new_purch = clean_opt(input.default_purchase_unit_id).unwrap_or(old_purch);
        let new_returnable = input.is_returnable.unwrap_or(old_returnable);
        let new_active = input.is_active.unwrap_or(old_active);

        if let Some(dept_ids_raw) = input.department_ids {
            let dept_ids = validate_department_ids(tx, &dept_ids_raw, true)?;
            tx.execute("DELETE FROM item_departments WHERE item_id = ?1", [id])?;
            for did in dept_ids {
                tx.execute(
                    "INSERT INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                    params![id, did],
                )?;
            }
        }

        if let Some(units_in) = input.item_units {
            validate_and_replace_item_units(tx, id, &base_unit_id, &units_in)?;
        }

        let unit_map = load_unit_map(tx)?;
        let item_units_saved = load_item_units(tx, id)?;
        let base_unit = unit_map
            .get(&base_unit_id)
            .ok_or_else(|| ApiError::internal("Missing base unit reference"))?;
        for check_uid in [&new_disp, &new_issue, &new_purch] {
            let target = unit_map
                .get(check_uid)
                .ok_or_else(|| ApiError::not_found("Selected item unit was not found."))?;
            resolve_factor_milli(base_unit, target, &item_units_saved)?;
        }

        tx.execute(
            "UPDATE items SET
                name = ?1, description = ?2, display_unit_id = ?3,
                default_issue_unit_id = ?4, default_purchase_unit_id = ?5,
                store_section_id = ?6, avg_cost_micro = ?7, last_cost_micro = ?8,
                cost_missing = ?9, is_returnable = ?10, reorder_point_milli = ?11,
                par_level_milli = ?12, supplier_id = ?13, storage_location = ?14,
                is_active = ?15, updated_at = ?16
             WHERE id = ?17",
            params![
                new_name,
                new_desc,
                new_disp,
                new_issue,
                new_purch,
                new_sec,
                new_avg_cost,
                new_last_cost,
                if new_cost_missing { 1 } else { 0 },
                if new_returnable { 1 } else { 0 },
                new_reorder,
                new_par,
                new_sup,
                new_loc,
                if new_active { 1 } else { 0 },
                now,
                id
            ],
        )?;

        refresh_item_fts(tx, id)?;
        record_activity(
            tx,
            Some(&actor.id),
            "item.updated",
            "items",
            id,
            &format!("Updated item {new_name}"),
            serde_json::json!({ "is_active": new_active }),
        )?;

        load_item_row_conn(tx, id)
    })
}

/// Guarded Admin wizard to change an item's base unit after movements exist, atomically
/// rescaling on-hand stock, thresholds, unit costs, and item conversions while keeping the ledger balanced.
pub fn change_item_base_unit(
    db: &Database,
    actor: &SessionUser,
    id: &str,
    input: ChangeBaseUnitInput,
) -> AppResult<ItemListRowDto> {
    require_admin(actor)?;
    if input.conversion_factor_milli <= 0 {
        return Err(
            ApiError::validation("Conversion factor must be greater than zero.")
                .with_field("conversion_factor_milli"),
        );
    }
    let reason = input.reason.trim().to_string();
    if reason.is_empty() {
        return Err(
            ApiError::validation("Please provide a reason for changing the base unit.")
                .with_field("reason"),
        );
    }
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let today = Utc::now().format("%Y-%m-%d").to_string();

    db.transaction(|tx| {
        let new_unit_exists: Option<String> = tx
            .query_row(
                "SELECT id FROM units WHERE id = ?1",
                [&input.new_base_unit_id],
                |r| r.get(0),
            )
            .optional()?;
        if new_unit_exists.is_none() {
            return Err(
                ApiError::not_found("New base unit not found.").with_field("new_base_unit_id")
            );
        }

        let row: Option<(String, String, String, String, String, i64, i64, i64, i64, i64)> = tx
            .query_row(
                "SELECT name, base_unit_id, display_unit_id, default_issue_unit_id, default_purchase_unit_id,
                        on_hand_milli, avg_cost_micro, last_cost_micro, reorder_point_milli, par_level_milli
                 FROM items WHERE id = ?1",
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
            name,
            old_base_id,
            old_disp_id,
            old_issue_id,
            old_purch_id,
            old_on_hand,
            old_avg_cost,
            old_last_cost,
            old_reorder,
            old_par,
        ) = row.ok_or_else(|| ApiError::not_found("Inventory item not found."))?;

        if old_base_id == input.new_base_unit_id {
            return Err(ApiError::validation("Item already uses this base unit."));
        }

        let f = input.conversion_factor_milli as i128;
        let m = MILLI_SCALE as i128;

        let new_on_hand = round_div_half_even((old_on_hand as i128) * f, m) as i64;
        let new_reorder = round_div_half_even((old_reorder as i128) * f, m) as i64;
        let new_par = round_div_half_even((old_par as i128) * f, m) as i64;
        let new_avg_cost = round_div_half_even((old_avg_cost as i128) * m, f) as i64;
        let new_last_cost = round_div_half_even((old_last_cost as i128) * m, f) as i64;

        // Rescale existing item_units; drop any row matching new_base_unit_id
        tx.execute(
            "DELETE FROM item_units WHERE item_id = ?1 AND unit_id = ?2",
            params![id, input.new_base_unit_id],
        )?;
        let existing_iu: Vec<(String, i64)> = {
            let mut stmt = tx.prepare("SELECT id, factor_milli FROM item_units WHERE item_id = ?1")?;
            let rows = stmt
                .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };
        for (iu_id, old_factor) in existing_iu {
            let rescaled = round_div_half_even((old_factor as i128) * f, m).max(1) as i64;
            tx.execute(
                "UPDATE item_units SET factor_milli = ?1 WHERE id = ?2",
                params![rescaled, iu_id],
            )?;
        }

        let new_disp = if old_disp_id == old_base_id {
            input.new_base_unit_id.clone()
        } else {
            old_disp_id
        };
        let new_issue = if old_issue_id == old_base_id {
            input.new_base_unit_id.clone()
        } else {
            old_issue_id
        };
        let new_purch = if old_purch_id == old_base_id {
            input.new_base_unit_id.clone()
        } else {
            old_purch_id
        };

        tx.execute(
            "UPDATE items SET
                base_unit_id = ?1, display_unit_id = ?2, default_issue_unit_id = ?3,
                default_purchase_unit_id = ?4, on_hand_milli = ?5,
                avg_cost_micro = ?6, last_cost_micro = ?7,
                reorder_point_milli = ?8, par_level_milli = ?9, updated_at = ?10
             WHERE id = ?11",
            params![
                input.new_base_unit_id,
                new_disp,
                new_issue,
                new_purch,
                new_on_hand,
                new_avg_cost,
                new_last_cost,
                new_reorder,
                new_par,
                now,
                id
            ],
        )?;

        // Rescale historical stock movements in-place so ledger balances stay exact without
        // distorting weekly stock sheet consumption/issued figures.
        let movements: Vec<(String, i64, i64, String, i64, i64)> = {
            let mut m_stmt = tx.prepare(
                "SELECT id, qty_milli, unit_cost_micro, input_unit_id, input_qty_milli, factor_milli
                 FROM stock_movements
                 WHERE item_id = ?1
                 ORDER BY created_at ASC, rowid ASC",
            )?;
            let rows = m_stmt
                .query_map([id], |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            rows
        };

        if !movements.is_empty() {
            let mut rescaled_rows: Vec<(String, i64, i64, String, i64, i64)> =
                Vec::with_capacity(movements.len());
            let mut sum_qty: i64 = 0;

            for (mid, old_qty, old_cost, old_input_unit_id, old_input_qty, old_factor) in movements
            {
                let new_qty = round_div_half_even((old_qty as i128) * f, m) as i64;
                let new_cost = round_div_half_even((old_cost as i128) * m, f) as i64;
                let (new_input_unit_id, new_input_qty, new_factor) =
                    if old_input_unit_id == old_base_id {
                        (input.new_base_unit_id.clone(), new_qty, MILLI_SCALE)
                    } else if old_input_unit_id == input.new_base_unit_id {
                        (input.new_base_unit_id.clone(), new_qty, MILLI_SCALE)
                    } else {
                        let rf = round_div_half_even((old_factor as i128) * f, m).max(1) as i64;
                        (old_input_unit_id, old_input_qty, rf)
                    };
                sum_qty += new_qty;
                rescaled_rows.push((
                    mid,
                    new_qty,
                    new_cost,
                    new_input_unit_id,
                    new_input_qty,
                    new_factor,
                ));
            }

            let rounding_diff = new_on_hand - sum_qty;
            if rounding_diff != 0 {
                if let Some(last) = rescaled_rows.last_mut() {
                    last.1 += rounding_diff;
                    if last.3 == input.new_base_unit_id {
                        last.4 = last.1;
                    }
                }
            }

            let mut running_balance: i64 = 0;
            for (mid, qty, cost, in_unit, in_qty, fac) in rescaled_rows {
                running_balance += qty;
                tx.execute(
                    "UPDATE stock_movements
                     SET qty_milli = ?1,
                         balance_after_milli = ?2,
                         unit_cost_micro = ?3,
                         input_unit_id = ?4,
                         input_qty_milli = ?5,
                         factor_milli = ?6
                     WHERE id = ?7",
                    params![qty, running_balance, cost, in_unit, in_qty, fac, mid],
                )?;
            }
        } else if new_on_hand != 0 {
            tx.execute(
                "INSERT INTO stock_movements (
                    id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                    doc_type, doc_id, doc_number, input_unit_id, input_qty_milli, factor_milli,
                    actor_user_id, business_date, created_at
                ) VALUES (?1, ?2, 'opening', ?3, ?3, ?4, 0, 'base_unit_change', ?2, 'UOM-RESCALE', ?5, ?3, 1000, ?6, ?7, ?8)",
                params![
                    Uuid::now_v7().to_string(),
                    id,
                    new_on_hand,
                    new_avg_cost,
                    input.new_base_unit_id,
                    actor.id,
                    today,
                    now
                ],
            )?;
        }

        record_activity(
            tx,
            Some(&actor.id),
            "item.base_unit_changed",
            "items",
            id,
            &format!("Rescaled base unit for {name} (factor {}) — {reason}", input.conversion_factor_milli),
            serde_json::json!({
                "old_base_unit_id": old_base_id,
                "new_base_unit_id": input.new_base_unit_id,
                "factor_milli": input.conversion_factor_milli,
                "reason": reason,
            }),
        )?;

        load_item_row_conn(tx, id)
    })
}

pub fn archive_item(db: &Database, actor: &SessionUser, id: &str) -> AppResult<()> {
    require_operator(actor)?;
    let now = now_rfc3339();
    db.transaction(|tx| {
        let name: Option<String> = tx
            .query_row("SELECT name FROM items WHERE id = ?1", [id], |r| r.get(0))
            .optional()?;
        let name = name.ok_or_else(|| ApiError::not_found("Inventory item not found."))?;

        tx.execute(
            "UPDATE items SET is_active = 0, updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "item.archived",
            "items",
            id,
            &format!("Archived item {name}"),
            serde_json::json!({}),
        )?;
        Ok(())
    })
}

/// Atomically clears all inventory items, stock movements, collections, procurement lists,
/// receipts, adjustments, and stock counts while preserving company settings, departments,
/// store sections, staff, units, suppliers, user accounts, and license state. Admin-only.
pub fn clear_inventory(db: &Database, actor: &SessionUser) -> AppResult<i32> {
    require_admin(actor)?;
    let _now = today_iso();
    db.transaction(|tx| {
        let count: i32 = tx.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0))?;

        tx.execute_batch(
            "DELETE FROM stock_movements;
             DELETE FROM stock_count_lines;
             DELETE FROM stock_counts;
             DELETE FROM adjustment_lines;
             DELETE FROM adjustments;
             DELETE FROM receipt_lines;
             DELETE FROM receipts;
             DELETE FROM procurement_lines;
             DELETE FROM procurement_lists;
             DELETE FROM collection_lines;
             DELETE FROM collections;
             DELETE FROM item_aliases;
             DELETE FROM item_units;
             DELETE FROM item_departments;
             DELETE FROM items_fts;
             DELETE FROM items;
             DELETE FROM import_runs;
             DELETE FROM doc_sequences;",
        )?;

        record_activity(
            tx,
            Some(&actor.id),
            "inventory.cleared",
            "items",
            "all",
            &format!("Cleared all inventory ({count} items) while preserving organization & users"),
            serde_json::json!({ "cleared_items": count }),
        )?;

        Ok(count)
    })
}
