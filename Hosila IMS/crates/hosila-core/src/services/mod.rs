pub mod activity;
pub mod adjustments;
pub mod auth;
pub mod collections;
pub mod dashboard;
pub mod items;
pub mod org;
pub mod procurement;
pub mod receipts;
pub mod reports;
pub mod settings;
pub mod staff;
pub mod stock_counts;
pub mod units;

use std::collections::HashSet;

use chrono::{Datelike, NaiveDate, SecondsFormat, Utc};
use rusqlite::{OptionalExtension, Transaction};

use crate::error::{ApiError, AppResult};

pub(crate) fn clean_opt(v: Option<String>) -> Option<String> {
    v.and_then(|s| {
        let t = s.trim();
        if t.is_empty() {
            None
        } else {
            Some(t.to_string())
        }
    })
}

pub(crate) fn clean_opt_str(v: Option<&str>) -> Option<String> {
    v.map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToString::to_string)
}

pub(crate) fn now_rfc3339() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}

pub(crate) fn today_iso() -> String {
    Utc::now().format("%Y-%m-%d").to_string()
}

pub(crate) fn parse_iso_date_or_today(raw: Option<&str>, field: &'static str) -> AppResult<String> {
    match raw.map(str::trim).filter(|s| !s.is_empty()) {
        None => Ok(today_iso()),
        Some(s) => {
            NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| ApiError::validation("Date must be formatted as YYYY-MM-DD.").with_field(field))?;
            Ok(s.to_string())
        }
    }
}

pub(crate) fn year_from_iso_date(date_str: &str) -> i32 {
    NaiveDate::parse_from_str(date_str, "%Y-%m-%d")
        .map(|d| d.year())
        .unwrap_or_else(|_| Utc::now().year())
}

pub(crate) fn validate_department_ids(
    tx: &Transaction<'_>,
    ids: &[String],
    require_non_empty: bool,
) -> AppResult<Vec<String>> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for raw in ids {
        let id = raw.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        let exists: Option<String> = tx
            .query_row("SELECT id FROM departments WHERE id = ?1", [&id], |r| r.get(0))
            .optional()?;
        if exists.is_none() {
            return Err(
                ApiError::not_found(format!("Department '{id}' does not exist."))
                    .with_field("department_ids"),
            );
        }
        out.push(id);
    }
    if require_non_empty && out.is_empty() {
        return Err(
            ApiError::validation("Select at least one department for this item.")
                .with_field("department_ids"),
        );
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use crate::db::Database;
    use crate::error::ErrorCode;
    use crate::seed::seed_system_defaults;
    use crate::services::{auth, collections, items, org, settings, staff, units};
    use crate::types::{
        AppearanceSettings, BusinessProfile, ChangeBaseUnitInput, CollectionFilter,
        CollectionLineInput, CreateCollectionInput, CreateDepartmentInput, CreateItemInput,
        CreateStaffInput, CreateStoreSectionInput, CreateUnitInput, CreateUserInput,
        InventoryRules, ItemFilter, ItemUnitInput, LoginInput, OnboardingInput, PinLoginInput,
        RecordReturnInput, StaffFilter, UpdateDepartmentInput, UpdateItemInput, UpdateStaffInput,
        UpdateStoreSectionInput, UpdateUnitInput, UpdateUserInput, UserRole,
    };

    fn sample_onboarding() -> OnboardingInput {
        OnboardingInput {
            business_profile: BusinessProfile {
                name: "De Palms Hotel".to_string(),
                legal_name: "De Palms Hotel Ltd".to_string(),
                address: "12 Marina Rd".to_string(),
                phone: "0800-000-0000".to_string(),
                email: "store@depalms.example".to_string(),
                currency_symbol: "₦".to_string(),
                currency_code: "NGN".to_string(),
                date_format: "DD MMM YYYY".to_string(),
                logo_data_url: None,
            },
            admin_username: "tunde".to_string(),
            admin_full_name: "Tunde Manager".to_string(),
            admin_password: "secret123".to_string(),
            admin_pin: Some("4321".to_string()),
            departments: vec![
                CreateDepartmentInput {
                    name: "Kitchen".to_string(),
                    color: None,
                    sort_order: None,
                },
                CreateDepartmentInput {
                    name: "F&B".to_string(),
                    color: Some("#3B82F6".to_string()),
                    sort_order: None,
                },
                CreateDepartmentInput {
                    name: "Store".to_string(),
                    color: Some("#64748B".to_string()),
                    sort_order: None,
                },
            ],
            store_sections: vec![CreateStoreSectionInput {
                name: "Protein".to_string(),
                sort_order: None,
            }],
        }
    }

    #[test]
    fn onboarding_and_authentication_work_end_to_end() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();

        let admin = auth::complete_onboarding(&db, sample_onboarding()).unwrap();
        assert_eq!(admin.role, UserRole::Admin);
        assert_eq!(admin.username, "tunde");

        let err = auth::complete_onboarding(&db, sample_onboarding()).unwrap_err();
        assert_eq!(err.code, ErrorCode::Conflict);

        let all_settings = settings::get_settings(&db).unwrap();
        assert_eq!(all_settings.business_profile.name, "De Palms Hotel");

        let logged_in = auth::authenticate_password(
            &db,
            LoginInput {
                username: "TUNDE".to_string(),
                password: "secret123".to_string(),
            },
        )
        .unwrap();
        assert_eq!(logged_in.id, admin.id);

        let bad_pw = auth::authenticate_password(
            &db,
            LoginInput {
                username: "tunde".to_string(),
                password: "wrong".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(bad_pw.code, ErrorCode::Unauthorized);

        let pin_session = auth::authenticate_pin(
            &db,
            PinLoginInput {
                username: "tunde".to_string(),
                pin: "4321".to_string(),
            },
        )
        .unwrap();
        assert_eq!(pin_session.id, admin.id);

        let mgr = auth::verify_manager_pin(&db, "4321").unwrap();
        assert_eq!(mgr.manager_user_id, admin.id);
        assert_eq!(
            auth::verify_manager_pin(&db, "9999").unwrap_err().code,
            ErrorCode::Unauthorized
        );
    }

    #[test]
    fn rbac_and_last_admin_protection_enforced() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();
        let admin = auth::complete_onboarding(&db, sample_onboarding()).unwrap();

        let err = auth::update_user(
            &db,
            &admin,
            &admin.id,
            UpdateUserInput {
                full_name: None,
                role: Some(UserRole::Storekeeper),
                is_active: None,
            },
        )
        .unwrap_err();
        assert_eq!(err.code, ErrorCode::Conflict);

        let err2 = auth::update_user(
            &db,
            &admin,
            &admin.id,
            UpdateUserInput {
                full_name: None,
                role: None,
                is_active: Some(false),
            },
        )
        .unwrap_err();
        assert_eq!(err2.code, ErrorCode::Conflict);

        let sk = auth::create_user(
            &db,
            &admin,
            CreateUserInput {
                username: "ada".to_string(),
                full_name: "Ada Storekeeper".to_string(),
                password: "password1".to_string(),
                pin: Some("1111".to_string()),
                role: UserRole::Storekeeper,
            },
        )
        .unwrap();
        let sk_session = auth::authenticate_password(
            &db,
            LoginInput {
                username: "ada".to_string(),
                password: "password1".to_string(),
            },
        )
        .unwrap();

        let viewer = auth::create_user(
            &db,
            &admin,
            CreateUserInput {
                username: "auditor".to_string(),
                full_name: "Audit Viewer".to_string(),
                password: "password2".to_string(),
                pin: None,
                role: UserRole::Viewer,
            },
        )
        .unwrap();
        let viewer_session = auth::authenticate_password(
            &db,
            LoginInput {
                username: "auditor".to_string(),
                password: "password2".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            auth::create_user(
                &db,
                &sk_session,
                CreateUserInput {
                    username: "x".to_string(),
                    full_name: "X".to_string(),
                    password: "password1".to_string(),
                    pin: None,
                    role: UserRole::Viewer,
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Forbidden
        );
        assert_eq!(
            org::create_department(
                &db,
                &sk_session,
                CreateDepartmentInput {
                    name: "Spa".to_string(),
                    color: None,
                    sort_order: None,
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Forbidden
        );

        assert_eq!(
            staff::create_staff(
                &db,
                &viewer_session,
                CreateStaffInput {
                    full_name: "Someone".to_string(),
                    staff_code: None,
                    phone: None,
                    is_store_staff: false,
                    department_ids: vec![],
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Forbidden
        );

        auth::update_user(
            &db,
            &admin,
            &viewer.id,
            UpdateUserInput {
                full_name: None,
                role: None,
                is_active: Some(false),
            },
        )
        .unwrap();
        let login_inactive = auth::authenticate_password(
            &db,
            LoginInput {
                username: "auditor".to_string(),
                password: "password2".to_string(),
            },
        )
        .unwrap_err();
        assert_eq!(login_inactive.code, ErrorCode::Unauthorized);

        auth::reset_user_password(&db, &sk_session, &sk.id, "newpass123").unwrap();
        auth::set_user_pin(&db, &sk_session, &sk.id, Some("2222".to_string())).unwrap();
        assert_eq!(
            auth::authenticate_pin(
                &db,
                PinLoginInput {
                    username: "ada".to_string(),
                    pin: "2222".to_string(),
                },
            )
            .unwrap()
            .id,
            sk.id
        );
    }

    #[test]
    fn org_staff_units_and_settings_crud_work() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();
        let admin = auth::complete_onboarding(&db, sample_onboarding()).unwrap();

        let mut s = settings::get_settings(&db).unwrap();
        s.business_profile.address = "99 Victoria Island".to_string();
        let bp = settings::update_business_profile(&db, &admin, s.business_profile).unwrap();
        assert_eq!(bp.address, "99 Victoria Island");

        let rules = settings::update_inventory_rules(
            &db,
            &admin,
            InventoryRules {
                allow_negative_stock: false,
                costing_method: "wac".to_string(),
                require_storekeeper_pin_on_issue: true,
                require_manager_pin_above_minor: 10_000_000,
            },
        )
        .unwrap();
        assert!(rules.require_storekeeper_pin_on_issue);

        let app = settings::update_appearance(
            &db,
            AppearanceSettings {
                theme: "dark".to_string(),
            },
        )
        .unwrap();
        assert_eq!(app.theme, "dark");

        let depts = org::list_departments(&db, false).unwrap();
        assert_eq!(depts.len(), 3);
        let kitchen = depts.iter().find(|d| d.name == "Kitchen").unwrap();
        let store_dept = depts.iter().find(|d| d.name == "Store").unwrap();

        assert_eq!(
            org::create_department(
                &db,
                &admin,
                CreateDepartmentInput {
                    name: "kitchen".to_string(),
                    color: None,
                    sort_order: None,
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Conflict
        );

        let hk = org::create_department(
            &db,
            &admin,
            CreateDepartmentInput {
                name: "Housekeeping".to_string(),
                color: Some("#F59E0B".to_string()),
                sort_order: None,
            },
        )
        .unwrap();
        let hk_updated = org::update_department(
            &db,
            &admin,
            &hk.id,
            UpdateDepartmentInput {
                name: Some("House Keeping".to_string()),
                color: None,
                sort_order: None,
                is_active: None,
            },
        )
        .unwrap();
        assert_eq!(hk_updated.name, "House Keeping");

        let sections = org::list_store_sections(&db, false).unwrap();
        assert_eq!(sections.len(), 1);
        let sec = org::update_store_section(
            &db,
            &admin,
            &sections[0].id,
            UpdateStoreSectionInput {
                name: Some("Protein & Butcher".to_string()),
                sort_order: None,
                is_active: None,
            },
        )
        .unwrap();
        assert_eq!(sec.name, "Protein & Butcher");

        let chef = staff::create_staff(
            &db,
            &admin,
            CreateStaffInput {
                full_name: "Chef John".to_string(),
                staff_code: Some("STF-10".to_string()),
                phone: None,
                is_store_staff: false,
                department_ids: vec![kitchen.id.clone(), hk.id.clone()],
            },
        )
        .unwrap();
        assert_eq!(chef.department_ids.len(), 2);

        let keeper = staff::create_staff(
            &db,
            &admin,
            CreateStaffInput {
                full_name: "Ada Storekeeper".to_string(),
                staff_code: None,
                phone: None,
                is_store_staff: true,
                department_ids: vec![store_dept.id.clone()],
            },
        )
        .unwrap();

        let kitchen_staff = staff::list_staff(
            &db,
            StaffFilter {
                department_id: Some(kitchen.id.clone()),
                store_staff_only: false,
                include_inactive: false,
            },
        )
        .unwrap();
        assert_eq!(kitchen_staff.len(), 1);
        assert_eq!(kitchen_staff[0].id, chef.id);

        let store_staff = staff::list_staff(
            &db,
            StaffFilter {
                department_id: None,
                store_staff_only: true,
                include_inactive: false,
            },
        )
        .unwrap();
        assert_eq!(store_staff.len(), 1);
        assert_eq!(store_staff[0].id, keeper.id);

        let updated_chef = staff::update_staff(
            &db,
            &admin,
            &chef.id,
            UpdateStaffInput {
                full_name: None,
                staff_code: None,
                phone: Some("08012345678".to_string()),
                is_store_staff: None,
                is_active: None,
                department_ids: Some(vec![kitchen.id.clone()]),
            },
        )
        .unwrap();
        assert_eq!(updated_chef.department_ids.len(), 1);
        assert_eq!(updated_chef.phone.as_deref(), Some("08012345678"));

        let all_units = units::list_units(&db).unwrap();
        let kg = all_units.iter().find(|u| u.code == "KG").unwrap();
        assert_eq!(
            units::delete_unit(&db, &admin, &kg.id).unwrap_err().code,
            ErrorCode::Conflict
        );
        assert_eq!(
            units::update_unit(
                &db,
                &admin,
                &kg.id,
                UpdateUnitInput {
                    name: None,
                    plural: None,
                    allows_decimals: None,
                    factor_to_dim_base_milli: Some(500),
                },
            )
            .unwrap_err()
            .code,
            ErrorCode::Conflict
        );

        let custom = units::create_unit(
            &db,
            &admin,
            CreateUnitInput {
                code: "keg".to_string(),
                name: "Keg".to_string(),
                plural: "Kegs".to_string(),
                dimension: "volume".to_string(),
                allows_decimals: false,
                factor_to_dim_base_milli: 25_000_000,
            },
        )
        .unwrap();
        assert_eq!(custom.code, "KEG");
        assert!(!custom.is_system);

        let custom_u = units::update_unit(
            &db,
            &admin,
            &custom.id,
            UpdateUnitInput {
                name: Some("Jerrycan".to_string()),
                plural: Some("Jerrycans".to_string()),
                allows_decimals: Some(true),
                factor_to_dim_base_milli: Some(25_000_000),
            },
        )
        .unwrap();
        assert_eq!(custom_u.name, "Jerrycan");

        units::delete_unit(&db, &admin, &custom.id).unwrap();
    }

    #[test]
    fn items_uom_fts_and_base_unit_rescale_work_with_ledger_integrity() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();
        let admin = auth::complete_onboarding(&db, sample_onboarding()).unwrap();

        let depts = org::list_departments(&db, false).unwrap();
        let kitchen = depts.iter().find(|d| d.name == "Kitchen").unwrap();
        let fnb = depts.iter().find(|d| d.name == "F&B").unwrap();
        let sections = org::list_store_sections(&db, false).unwrap();
        let protein = &sections[0];

        let all_units = units::list_units(&db).unwrap();
        let u_btl = all_units.iter().find(|u| u.code == "BTL").unwrap();
        let u_pack = all_units.iter().find(|u| u.code == "PACK").unwrap();
        let u_kg = all_units.iter().find(|u| u.code == "KG").unwrap();
        let u_g = all_units.iter().find(|u| u.code == "G").unwrap();

        let water = items::create_item(
            &db,
            &admin,
            CreateItemInput {
                sku: None,
                name: "Eva Bottle Water 75cl".to_string(),
                description: None,
                base_unit_id: u_btl.id.clone(),
                display_unit_id: Some(u_pack.id.clone()),
                default_issue_unit_id: Some(u_pack.id.clone()),
                default_purchase_unit_id: Some(u_pack.id.clone()),
                store_section_id: None,
                department_ids: vec![fnb.id.clone(), kitchen.id.clone()],
                item_units: vec![ItemUnitInput {
                    unit_id: u_pack.id.clone(),
                    factor_milli: 12_000,
                    can_purchase: true,
                    can_issue: true,
                    label_override: None,
                }],
                reorder_point_milli: 24_000,
                par_level_milli: 120_000,
                initial_unit_cost_micro: 150_000_000,
                cost_missing: false,
                is_returnable: false,
                opening_stock_milli: 28_000, // 2 Packs + 4 Bottles
                opening_date: Some("2026-11-09".to_string()),
                supplier_id: None,
                storage_location: Some("Rack A1".to_string()),
            },
        )
        .unwrap();

        assert_eq!(water.sku, "ITM-000001");
        assert_eq!(water.display_stock, "2 Packs + 4 Bottles");
        assert_eq!(water.department_names, vec!["Kitchen", "F&B"]);
        assert_eq!(water.stock_value_minor, 420_000); // 28 * 150 = 4,200.00 = 420,000 kobo

        // FTS5 search finds water
        let found = items::list_items(
            &db,
            ItemFilter {
                search: Some("eva".to_string()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(found.len(), 1);

        // Protein section item
        let beef = items::create_item(
            &db,
            &admin,
            CreateItemInput {
                sku: None,
                name: "Beef Fillet".to_string(),
                description: None,
                base_unit_id: u_kg.id.clone(),
                display_unit_id: None,
                default_issue_unit_id: None,
                default_purchase_unit_id: None,
                store_section_id: Some(protein.id.clone()),
                department_ids: vec![kitchen.id.clone()],
                item_units: vec![],
                reorder_point_milli: 5_000,
                par_level_milli: 20_000,
                initial_unit_cost_micro: 7_500_000_000,
                cost_missing: false,
                is_returnable: false,
                opening_stock_milli: 10_000, // 10 KG
                opening_date: Some("2026-11-09".to_string()),
                supplier_id: None,
                storage_location: None,
            },
        )
        .unwrap();
        assert_eq!(beef.store_section_name.as_deref(), Some("Protein"));

        // Admin rescales Beef base unit from KG -> G (factor 1000 -> 1_000_000 milli)
        let beef_g = items::change_item_base_unit(
            &db,
            &admin,
            &beef.id,
            ChangeBaseUnitInput {
                new_base_unit_id: u_g.id.clone(),
                conversion_factor_milli: 1_000_000,
                reason: "Issue in grams for kitchen portions".to_string(),
            },
        )
        .unwrap();
        assert_eq!(beef_g.on_hand_milli, 10_000_000); // 10,000 g
        assert_eq!(beef_g.avg_cost_micro, 7_500_000); // 7.50 / g
        assert_eq!(beef_g.stock_value_minor, 7_500_000); // still NGN 75,000

        // Update item + archive
        let updated = items::update_item(
            &db,
            &admin,
            &water.id,
            UpdateItemInput {
                name: None,
                description: Some("Chilled table water".to_string()),
                display_unit_id: None,
                default_issue_unit_id: None,
                default_purchase_unit_id: None,
                store_section_id: None,
                clear_store_section: None,
                department_ids: None,
                item_units: None,
                reorder_point_milli: Some(36_000),
                par_level_milli: None,
                unit_cost_micro: None,
                cost_missing: None,
                is_returnable: None,
                supplier_id: None,
                clear_supplier: None,
                storage_location: None,
                is_active: None,
            },
        )
        .unwrap();
        assert_eq!(updated.stock_status, crate::types::StockStatus::LowStock);

        assert!(db.check_integrity().unwrap().ok);
    }

    #[test]
    fn collections_overdraw_block_reversal_and_returnable_flow_work() {
        let db = Database::open_in_memory().unwrap();
        seed_system_defaults(&db).unwrap();
        let admin = auth::complete_onboarding(&db, sample_onboarding()).unwrap();

        let depts = org::list_departments(&db, false).unwrap();
        let kitchen = depts.iter().find(|d| d.name == "Kitchen").unwrap();
        let store = depts.iter().find(|d| d.name == "Store").unwrap();

        let chef = staff::create_staff(
            &db,
            &admin,
            CreateStaffInput {
                full_name: "Chef John".to_string(),
                staff_code: None,
                phone: None,
                is_store_staff: false,
                department_ids: vec![kitchen.id.clone()],
            },
        )
        .unwrap();
        let keeper = staff::create_staff(
            &db,
            &admin,
            CreateStaffInput {
                full_name: "Ada Storekeeper".to_string(),
                staff_code: None,
                phone: None,
                is_store_staff: true,
                department_ids: vec![store.id.clone()],
            },
        )
        .unwrap();

        let all_units = units::list_units(&db).unwrap();
        let u_btl = all_units.iter().find(|u| u.code == "BTL").unwrap();
        let u_pack = all_units.iter().find(|u| u.code == "PACK").unwrap();
        let u_pcs = all_units.iter().find(|u| u.code == "PCS").unwrap();

        let coke = items::create_item(
            &db,
            &admin,
            CreateItemInput {
                sku: None,
                name: "Coca-Cola".to_string(),
                description: None,
                base_unit_id: u_btl.id.clone(),
                display_unit_id: Some(u_pack.id.clone()),
                default_issue_unit_id: Some(u_pack.id.clone()),
                default_purchase_unit_id: Some(u_pack.id.clone()),
                store_section_id: None,
                department_ids: vec![kitchen.id.clone()],
                item_units: vec![ItemUnitInput {
                    unit_id: u_pack.id.clone(),
                    factor_milli: 24_000,
                    can_purchase: true,
                    can_issue: true,
                    label_override: Some("Crate".to_string()),
                }],
                reorder_point_milli: 24_000,
                par_level_milli: 96_000,
                initial_unit_cost_micro: 300_000_000,
                cost_missing: false,
                is_returnable: false,
                opening_stock_milli: 48_000, // 48 bottles = 2 packs
                opening_date: Some("2026-11-09".to_string()),
                supplier_id: None,
                storage_location: None,
            },
        )
        .unwrap();

        let kettle = items::create_item(
            &db,
            &admin,
            CreateItemInput {
                sku: None,
                name: "Electric Kettle".to_string(),
                description: None,
                base_unit_id: u_pcs.id.clone(),
                display_unit_id: None,
                default_issue_unit_id: None,
                default_purchase_unit_id: None,
                store_section_id: None,
                department_ids: vec![kitchen.id.clone()],
                item_units: vec![],
                reorder_point_milli: 1_000,
                par_level_milli: 5_000,
                initial_unit_cost_micro: 18_000_000_000,
                cost_missing: false,
                is_returnable: true,
                opening_stock_milli: 4_000,
                opening_date: Some("2026-11-09".to_string()),
                supplier_id: None,
                storage_location: None,
            },
        )
        .unwrap();

        // Duplicate lines summing to 60 bottles (> 48 available) must be blocked
        let validation = collections::validate_collection(
            &db,
            CreateCollectionInput {
                department_id: kitchen.id.clone(),
                collector_staff_id: chef.id.clone(),
                storekeeper_staff_id: keeper.id.clone(),
                collection_date: Some("2026-11-10".to_string()),
                notes: None,
                storekeeper_pin: None,
                lines: vec![
                    CollectionLineInput {
                        item_id: coke.id.clone(),
                        unit_id: u_pack.id.clone(),
                        quantity_milli: 2_000,
                    },
                    CollectionLineInput {
                        item_id: coke.id.clone(),
                        unit_id: u_btl.id.clone(),
                        quantity_milli: 12_000,
                    },
                ],
            },
        )
        .unwrap();
        assert!(!validation.valid);
        assert!(validation.lines[0].error.as_ref().unwrap().contains("Only 48 bottles in stock"));

        let overdraw = collections::create_collection(
            &db,
            &admin,
            CreateCollectionInput {
                department_id: kitchen.id.clone(),
                collector_staff_id: chef.id.clone(),
                storekeeper_staff_id: keeper.id.clone(),
                collection_date: Some("2026-11-10".to_string()),
                notes: None,
                storekeeper_pin: None,
                lines: vec![CollectionLineInput {
                    item_id: coke.id.clone(),
                    unit_id: u_pack.id.clone(),
                    quantity_milli: 3_000,
                }],
            },
        )
        .unwrap_err();
        assert_eq!(overdraw.code, ErrorCode::InsufficientStock);

        // Valid back-dated collection (1 pack Coke + 3 kettles)
        let col = collections::create_collection(
            &db,
            &admin,
            CreateCollectionInput {
                department_id: kitchen.id.clone(),
                collector_staff_id: chef.id.clone(),
                storekeeper_staff_id: keeper.id.clone(),
                collection_date: Some("2026-11-10".to_string()),
                notes: Some("Week 2 issue".to_string()),
                storekeeper_pin: None,
                lines: vec![
                    CollectionLineInput {
                        item_id: coke.id.clone(),
                        unit_id: u_pack.id.clone(),
                        quantity_milli: 1_000, // 24 bottles
                    },
                    CollectionLineInput {
                        item_id: kettle.id.clone(),
                        unit_id: u_pcs.id.clone(),
                        quantity_milli: 3_000, // 3 returnable kettles
                    },
                ],
            },
        )
        .unwrap();
        assert_eq!(col.number, "COL-2026-000001");
        assert_eq!(col.collection_date, "2026-11-10");

        let coke_after = items::get_item_detail(&db, &coke.id).unwrap();
        assert_eq!(coke_after.item.on_hand_milli, 24_000);

        let kettle_line = col.lines.iter().find(|l| l.item_id == kettle.id).unwrap();
        assert_eq!(kettle_line.outstanding_qty_milli, 3_000);

        // Outstanding returns lists 3 kettles
        let open_ret = collections::list_outstanding_returns(&db, None, None).unwrap();
        assert_eq!(open_ret.len(), 1);
        assert_eq!(open_ret[0].outstanding_milli, 3_000);

        // Partial return: 2 ok, 1 damaged
        collections::record_return(
            &db,
            &admin,
            RecordReturnInput {
                collection_line_id: kettle_line.id.clone(),
                returned_qty_milli: 2_000,
                damaged_qty_milli: 1_000,
                return_date: Some("2026-11-12".to_string()),
                storekeeper_staff_id: keeper.id.clone(),
                notes: Some("One handle cracked".to_string()),
            },
        )
        .unwrap();

        assert!(collections::list_outstanding_returns(&db, None, None).unwrap().is_empty());
        let kettle_after = items::get_item_detail(&db, &kettle.id).unwrap();
        assert_eq!(kettle_after.item.on_hand_milli, 3_000); // 4 - 3 + 2 returned = 3

        // Separate coke-only collection + reversal
        let col2 = collections::create_collection(
            &db,
            &admin,
            CreateCollectionInput {
                department_id: kitchen.id.clone(),
                collector_staff_id: chef.id.clone(),
                storekeeper_staff_id: keeper.id.clone(),
                collection_date: Some("2026-11-11".to_string()),
                notes: None,
                storekeeper_pin: None,
                lines: vec![CollectionLineInput {
                    item_id: coke.id.clone(),
                    unit_id: u_btl.id.clone(),
                    quantity_milli: 4_000,
                }],
            },
        )
        .unwrap();
        assert_eq!(items::get_item_detail(&db, &coke.id).unwrap().item.on_hand_milli, 20_000);

        collections::reverse_collection(&db, &admin, &col2.id, "Wrong dept".to_string(), None).unwrap();
        assert_eq!(items::get_item_detail(&db, &coke.id).unwrap().item.on_hand_milli, 24_000);

        let all_cols = collections::list_collections(&db, CollectionFilter::default()).unwrap();
        assert_eq!(all_cols.len(), 2);

        let integrity = db.check_integrity().unwrap();
        assert!(integrity.ok);
        assert_eq!(integrity.ledger_mismatches, 0);
    }
}
