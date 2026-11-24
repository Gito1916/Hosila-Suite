use chrono::{SecondsFormat, Utc};
use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use crate::db::Database;
use crate::domain::money::line_value_minor;
use crate::error::AppResult;

struct SystemUnitDef {
    code: &'static str,
    name: &'static str,
    plural: &'static str,
    dimension: &'static str,
    allows_decimals: bool,
    factor_to_dim_base_milli: i64,
}

const SYSTEM_UNITS: &[SystemUnitDef] = &[
    // Count units (23)
    SystemUnitDef { code: "PCS", name: "Piece", plural: "Pieces", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "BTL", name: "Bottle", plural: "Bottles", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "CAN", name: "Can", plural: "Cans", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "TIN", name: "Tin", plural: "Tins", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "SACHET", name: "Sachet", plural: "Sachets", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "ROLL", name: "Roll", plural: "Rolls", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "LOAF", name: "Loaf", plural: "Loaves", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "REAM", name: "Ream", plural: "Reams", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "CUBE", name: "Cube", plural: "Cubes", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "DOZEN", name: "Dozen", plural: "Dozens", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 12_000 },
    SystemUnitDef { code: "PACK", name: "Pack", plural: "Packs", dimension: "count", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "CRATE", name: "Crate", plural: "Crates", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "CARTON", name: "Carton", plural: "Cartons", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "BAG", name: "Bag", plural: "Bags", dimension: "count", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "PORTION", name: "Portion", plural: "Portions", dimension: "count", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "PAINT", name: "Paint", plural: "Paints", dimension: "count", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "CUP", name: "Cup", plural: "Cups", dimension: "count", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "HEAD", name: "Head", plural: "Heads", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "BALL", name: "Ball", plural: "Balls", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "BASKET", name: "Basket", plural: "Baskets", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "PLASTIC", name: "Plastic", plural: "Plastics", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "TUBER", name: "Tuber", plural: "Tubers", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "WHOLE", name: "Whole", plural: "Wholes", dimension: "count", allows_decimals: false, factor_to_dim_base_milli: 1_000 },
    // Mass units (2)
    SystemUnitDef { code: "G", name: "Gram", plural: "Grams", dimension: "mass", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "KG", name: "Kilogram", plural: "Kilograms", dimension: "mass", allows_decimals: true, factor_to_dim_base_milli: 1_000_000 },
    // Volume units (2)
    SystemUnitDef { code: "ML", name: "Millilitre", plural: "Millilitres", dimension: "volume", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "L", name: "Litre", plural: "Litres", dimension: "volume", allows_decimals: true, factor_to_dim_base_milli: 1_000_000 },
    // Length units (2)
    SystemUnitDef { code: "CM", name: "Centimetre", plural: "Centimetres", dimension: "length", allows_decimals: true, factor_to_dim_base_milli: 1_000 },
    SystemUnitDef { code: "M", name: "Metre", plural: "Metres", dimension: "length", allows_decimals: true, factor_to_dim_base_milli: 100_000 },
];

const DOC_SEQUENCES: &[(&str, &str)] = &[
    ("collection", "COL"),
    ("return", "RET"),
    ("procurement_list", "PRL"),
    ("receipt", "GRN"),
    ("adjustment", "ADJ"),
    ("stock_count", "CNT"),
];

pub fn seed_system_defaults(db: &Database) -> AppResult<()> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    db.transaction(|tx| {
        for u in SYSTEM_UNITS {
            let id = Uuid::now_v7().to_string();
            tx.execute(
                "INSERT OR IGNORE INTO units (
                    id, code, name, plural, dimension, allows_decimals, factor_to_dim_base_milli, is_system, created_at
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8)",
                params![
                    id,
                    u.code,
                    u.name,
                    u.plural,
                    u.dimension,
                    if u.allows_decimals { 1 } else { 0 },
                    u.factor_to_dim_base_milli,
                    now
                ],
            )?;
        }

        for &(doc_type, prefix) in DOC_SEQUENCES {
            tx.execute(
                "INSERT OR IGNORE INTO doc_sequences (doc_type, prefix, next_value) VALUES (?1, ?2, 1)",
                params![doc_type, prefix],
            )?;
        }

        let default_settings = [
            (
                "business_profile",
                serde_json::json!({
                    "name": "My Store",
                    "legal_name": "",
                    "address": "",
                    "phone": "",
                    "email": "",
                    "currency_symbol": "₦",
                    "currency_code": "NGN",
                    "date_format": "DD MMM YYYY"
                }),
            ),
            (
                "inventory_rules",
                serde_json::json!({
                    "allow_negative_stock": false,
                    "costing_method": "wac",
                    "require_storekeeper_pin_on_issue": false,
                    "require_manager_pin_above_minor": 5000000
                }),
            ),
            (
                "appearance",
                serde_json::json!({
                    "theme": "system"
                }),
            ),
        ];

        for (key, val) in default_settings {
            tx.execute(
                "INSERT OR IGNORE INTO settings (key, value_json, updated_at) VALUES (?1, ?2, ?3)",
                params![key, val.to_string(), now],
            )?;
        }

        Ok(())
    })
}

/// Seeds realistic multi-department demo data when launched with `--dev-seed` (or in tests).
/// Idempotent: skips if demo items or users already exist.
pub fn seed_dev_demo(db: &Database) -> AppResult<()> {
    let now = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);
    let business_date = Utc::now().format("%Y-%m-%d").to_string();

    db.transaction(|tx| {
        let user_exists: i64 = tx.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0))?;
        if user_exists > 0 {
            return Ok(());
        }

        let admin_id = Uuid::now_v7().to_string();
        let pw_hash = crate::services::auth::hash_secret("admin123")?;
        let pin_hash = crate::services::auth::hash_secret("1234")?;
        tx.execute(
            "INSERT INTO users (id, username, full_name, password_hash, pin_hash, role, is_active, created_at, updated_at)
             VALUES (?1, 'admin', 'Demo Admin', ?2, ?3, 'admin', 1, ?4, ?4)",
            params![admin_id, pw_hash, pin_hash, now],
        )?;

        let depts = [
            ("Kitchen", "#21C29C", 1),
            ("F&B", "#3B82F6", 2),
            ("Housekeeping", "#F59E0B", 3),
            ("Maintenance", "#8B5CF6", 4),
            ("Store", "#64748B", 5),
        ];
        let mut dept_ids = std::collections::HashMap::new();
        for (name, color, order) in depts {
            let id = Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO departments (id, name, color, sort_order, is_active, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![id, name, color, order, now],
            )?;
            dept_ids.insert(name, id);
        }

        let protein_section_id = Uuid::now_v7().to_string();
        tx.execute(
            "INSERT INTO store_sections (id, name, sort_order, is_active, created_at)
             VALUES (?1, 'Protein', 1, 1, ?2)",
            params![protein_section_id, now],
        )?;

        let staff_defs = [
            ("Chef John", "STF-001", false, vec!["Kitchen"]),
            ("Nina Okafor", "STF-002", false, vec!["F&B"]),
            ("Musa Ibrahim", "STF-003", false, vec!["Housekeeping"]),
            ("Chinedu Eze", "STF-004", false, vec!["Maintenance"]),
            ("Adaeze Storekeeper", "STF-005", true, vec!["Store"]),
            ("Tunde Balogun", "STF-006", true, vec!["Store"]),
        ];
        for (name, code, is_store, s_depts) in staff_defs {
            let sid = Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO staff (id, full_name, staff_code, is_store_staff, is_active, created_at)
                 VALUES (?1, ?2, ?3, ?4, 1, ?5)",
                params![sid, name, code, if is_store { 1 } else { 0 }, now],
            )?;
            for dname in s_depts {
                if let Some(did) = dept_ids.get(dname) {
                    tx.execute(
                        "INSERT INTO staff_departments (staff_id, department_id) VALUES (?1, ?2)",
                        params![sid, did],
                    )?;
                }
            }
        }

        let unit_id = |code: &str| -> AppResult<String> {
            tx.query_row("SELECT id FROM units WHERE code = ?1", [code], |r| r.get(0))
                .map_err(Into::into)
        };

        let u_pcs = unit_id("PCS")?;
        let u_btl = unit_id("BTL")?;
        let u_pack = unit_id("PACK")?;
        let u_crate = unit_id("CRATE")?;
        let u_portion = unit_id("PORTION")?;

        struct DemoItem<'a> {
            sku: &'a str,
            name: &'a str,
            base_u: &'a str,
            purchase_u: &'a str,
            depts: &'a [&'a str],
            section: Option<&'a str>,
            on_hand_milli: i64,
            cost_micro: i64,
            cost_missing: bool,
            is_returnable: bool,
            reorder_milli: i64,
            par_milli: i64,
            extra_unit: Option<(&'a str, i64, bool, bool)>,
        }

        let demo_items = [
            DemoItem {
                sku: "DEMO-001",
                name: "Pineapple",
                base_u: &u_pcs,
                purchase_u: &u_pcs,
                depts: &["F&B", "Kitchen"],
                section: None,
                on_hand_milli: 12_000,
                cost_micro: 1_500_000_000,
                cost_missing: false,
                is_returnable: false,
                reorder_milli: 5_000,
                par_milli: 20_000,
                extra_unit: None,
            },
            DemoItem {
                sku: "DEMO-002",
                name: "Beef",
                base_u: &u_portion,
                purchase_u: &u_portion,
                depts: &["Kitchen"],
                section: Some(&protein_section_id),
                on_hand_milli: 4_000, // low stock
                cost_micro: 2_500_000_000,
                cost_missing: false,
                is_returnable: false,
                reorder_milli: 10_000,
                par_milli: 30_000,
                extra_unit: None,
            },
            DemoItem {
                sku: "DEMO-003",
                name: "Bottle Water",
                base_u: &u_btl,
                purchase_u: &u_pack,
                depts: &["F&B", "Kitchen"],
                section: None,
                on_hand_milli: 396_000,
                cost_micro: 150_000_000,
                cost_missing: false,
                is_returnable: false,
                reorder_milli: 120_000,
                par_milli: 480_000,
                extra_unit: Some((&u_pack, 12_000, true, true)),
            },
            DemoItem {
                sku: "DEMO-004",
                name: "Egg",
                base_u: &u_pcs,
                purchase_u: &u_crate,
                depts: &["Kitchen"],
                section: None,
                on_hand_milli: 60_000, // 2 crates
                cost_micro: 206_666_667,
                cost_missing: false,
                is_returnable: false,
                reorder_milli: 90_000, // low stock
                par_milli: 210_000,
                extra_unit: Some((&u_crate, 30_000, true, true)),
            },
            DemoItem {
                sku: "DEMO-005",
                name: "2 Litre Electric Kettle",
                base_u: &u_pcs,
                purchase_u: &u_pcs,
                depts: &["Maintenance"],
                section: None,
                on_hand_milli: 2_000,
                cost_micro: 18_000_000_000,
                cost_missing: false,
                is_returnable: true,
                reorder_milli: 1_000,
                par_milli: 4_000,
                extra_unit: None,
            },
            DemoItem {
                sku: "DEMO-006",
                name: "Bollinger 007",
                base_u: &u_btl,
                purchase_u: &u_btl,
                depts: &["F&B"],
                section: None,
                on_hand_milli: 0, // out of stock + cost missing
                cost_micro: 0,
                cost_missing: true,
                is_returnable: false,
                reorder_milli: 2_000,
                par_milli: 6_000,
                extra_unit: None,
            },
        ];

        for item in demo_items {
            let exists: Option<String> = tx
                .query_row("SELECT id FROM items WHERE sku = ?1", [item.sku], |r| r.get(0))
                .optional()?;
            if exists.is_some() {
                continue;
            }

            let item_id = Uuid::now_v7().to_string();
            tx.execute(
                "INSERT INTO items (
                    id, sku, name, base_unit_id, display_unit_id, default_issue_unit_id, default_purchase_unit_id,
                    store_section_id, on_hand_milli, avg_cost_micro, last_cost_micro, cost_missing,
                    is_returnable, reorder_point_milli, par_level_milli, is_active, created_at, updated_at
                ) VALUES (?1, ?2, ?3, ?4, ?4, ?4, ?5, ?6, ?7, ?8, ?8, ?9, ?10, ?11, ?12, 1, ?13, ?13)",
                params![
                    item_id,
                    item.sku,
                    item.name,
                    item.base_u,
                    item.purchase_u,
                    item.section,
                    item.on_hand_milli,
                    item.cost_micro,
                    if item.cost_missing { 1 } else { 0 },
                    if item.is_returnable { 1 } else { 0 },
                    item.reorder_milli,
                    item.par_milli,
                    now
                ],
            )?;

            for dname in item.depts {
                if let Some(did) = dept_ids.get(dname) {
                    tx.execute(
                        "INSERT INTO item_departments (item_id, department_id) VALUES (?1, ?2)",
                        params![item_id, did],
                    )?;
                }
            }

            if let Some((eu_id, factor_milli, can_p, can_i)) = item.extra_unit {
                tx.execute(
                    "INSERT INTO item_units (id, item_id, unit_id, factor_milli, can_purchase, can_issue)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![
                        Uuid::now_v7().to_string(),
                        item_id,
                        eu_id,
                        factor_milli,
                        if can_p { 1 } else { 0 },
                        if can_i { 1 } else { 0 }
                    ],
                )?;
            }

            tx.execute(
                "INSERT INTO items_fts (item_id, name, sku, aliases) VALUES (?1, ?2, ?3, '')",
                params![item_id, item.name, item.sku],
            )?;

            if item.on_hand_milli > 0 {
                let val_minor = line_value_minor(item.on_hand_milli, item.cost_micro)?;
                tx.execute(
                    "INSERT INTO stock_movements (
                        id, item_id, type, qty_milli, balance_after_milli, unit_cost_micro, value_minor,
                        doc_type, doc_id, doc_number, input_unit_id, input_qty_milli, factor_milli,
                        actor_user_id, business_date, created_at
                    ) VALUES (?1, ?2, 'opening', ?3, ?3, ?4, ?5, 'seed', 'dev-seed', 'SEED-DEV', ?6, ?3, 1000, ?7, ?8, ?9)",
                    params![
                        Uuid::now_v7().to_string(),
                        item_id,
                        item.on_hand_milli,
                        item.cost_micro,
                        val_minor,
                        item.base_u,
                        admin_id,
                        business_date,
                        now
                    ],
                )?;
            }
        }

        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn system_defaults_and_dev_demo_are_idempotent_and_ledger_consistent() {
        let db = Database::open_in_memory().unwrap();

        seed_system_defaults(&db).unwrap();
        seed_system_defaults(&db).unwrap();

        let unit_count: i64 = db
            .with_read(|c| c.query_row("SELECT COUNT(*) FROM units", [], |r| r.get(0)).map_err(Into::into))
            .unwrap();
        assert_eq!(unit_count, 29);

        seed_dev_demo(&db).unwrap();
        seed_dev_demo(&db).unwrap();

        let item_count: i64 = db
            .with_read(|c| c.query_row("SELECT COUNT(*) FROM items", [], |r| r.get(0)).map_err(Into::into))
            .unwrap();
        assert_eq!(item_count, 6);

        let report = db.check_integrity().unwrap();
        assert!(report.ok);
        assert_eq!(report.ledger_mismatches, 0);
    }
}
