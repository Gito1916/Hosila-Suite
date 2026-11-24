use chrono::{Duration, SecondsFormat, Utc};
use ed25519_dalek::SigningKey;
use rusqlite::params;
use tempfile::tempdir;

use hosila_core::db::{backup, Database};
use hosila_core::error::ErrorCode;
use hosila_core::export::stock_sheet_xlsx;
use hosila_core::license::{
    activate_license_with_key, get_license_status_with_key, machine_fingerprint,
    require_writable_license_with_key, sign_license_payload,
    verify_license_key_with_verifying_key, LicensePayload,
};
use hosila_core::seed::seed_system_defaults;
use hosila_core::services::{
    adjustments, auth, collections, dashboard, items, org, procurement, receipts, reports,
    settings, staff, stock_counts, units,
};
use hosila_core::types::{
    ActivityFeedFilter, AdjustmentLineInput, BusinessProfile, CollectionLineInput,
    CreateAdjustmentInput, CreateCollectionInput, CreateDepartmentInput, CreateItemInput,
    CreateProcurementListInput, CreateReceiptInput, CreateStaffInput, CreateUserInput,
    DateRangeFilter, InventoryRules, ItemFilter, OnboardingInput, ProcurementLineInput,
    ReceiptLineInput, SessionUser, StartStockCountInput, UpdateStockCountLineInput, UserRole,
};

fn setup_env(db: &Database) -> (SessionUser, SessionUser, String, String, String, String, String, String) {
    seed_system_defaults(db).unwrap();
    let admin = auth::complete_onboarding(
        db,
        OnboardingInput {
            business_profile: BusinessProfile {
                name: "De Palms Hotel".to_string(),
                legal_name: "De Palms Hotel Ltd".to_string(),
                address: String::new(),
                phone: String::new(),
                email: String::new(),
                currency_symbol: "₦".to_string(),
                currency_code: "NGN".to_string(),
                date_format: "DD MMM YYYY".to_string(),
                logo_data_url: None,
            },
            admin_username: "admin".to_string(),
            admin_full_name: "Admin Manager".to_string(),
            admin_password: "password123".to_string(),
            admin_pin: Some("1234".to_string()),
            departments: vec![
                CreateDepartmentInput {
                    name: "Kitchen".to_string(),
                    color: Some("#21C29C".to_string()),
                    sort_order: Some(1),
                },
                CreateDepartmentInput {
                    name: "Store".to_string(),
                    color: Some("#64748B".to_string()),
                    sort_order: Some(2),
                },
            ],
            store_sections: vec![],
        },
    )
    .unwrap();

    let operator = auth::create_user(
        db,
        &admin,
        CreateUserInput {
            username: "store1".to_string(),
            full_name: "Ada Storekeeper".to_string(),
            password: "password123".to_string(),
            pin: Some("5678".to_string()),
            role: UserRole::Storekeeper,
        },
    )
    .unwrap();
    let op_session = SessionUser {
        id: operator.id,
        username: operator.username,
        full_name: operator.full_name,
        role: operator.role,
    };

    let depts = org::list_departments(db, false).unwrap();
    let kitchen_id = depts.iter().find(|d| d.name == "Kitchen").unwrap().id.clone();
    let store_id = depts.iter().find(|d| d.name == "Store").unwrap().id.clone();

    let collector = staff::create_staff(
        db,
        &admin,
        CreateStaffInput {
            full_name: "Chef Bola".to_string(),
            staff_code: None,
            phone: None,
            is_store_staff: false,
            department_ids: vec![kitchen_id.clone()],
        },
    )
    .unwrap();
    let keeper = staff::create_staff(
        db,
        &admin,
        CreateStaffInput {
            full_name: "Ada Keeper".to_string(),
            staff_code: None,
            phone: None,
            is_store_staff: true,
            department_ids: vec![store_id],
        },
    )
    .unwrap();

    let all_units = units::list_units(db).unwrap();
    let pcs_id = all_units.iter().find(|u| u.code == "PCS").unwrap().id.clone();

    let rice = items::create_item(
        db,
        &admin,
        CreateItemInput {
            sku: None,
            name: "Basmati Rice".to_string(),
            description: None,
            base_unit_id: pcs_id.clone(),
            display_unit_id: None,
            default_issue_unit_id: None,
            default_purchase_unit_id: None,
            store_section_id: None,
            department_ids: vec![kitchen_id.clone()],
            item_units: vec![],
            reorder_point_milli: 5_000,
            par_level_milli: 20_000,
            initial_unit_cost_micro: 1_500_000_000, // ₦1,500 per unit
            cost_missing: false,
            is_returnable: false,
            opening_stock_milli: 20_000,
            opening_date: Some("2026-11-15".to_string()),
            supplier_id: None,
            storage_location: None,
        },
    )
    .unwrap();

    (
        admin,
        op_session,
        kitchen_id,
        collector.id,
        keeper.id,
        rice.id,
        pcs_id,
        "2026-11-16".to_string(),
    )
}

#[test]
fn dashboard_adjustments_counts_reports_and_stock_sheet_xlsx_work() {
    let db = Database::open_in_memory().unwrap();
    let (admin, operator, kitchen_id, collector_id, keeper_id, rice_id, pcs_id, biz_date) =
        setup_env(&db);

    // Lower Manager PIN threshold so we can test Operator PIN gating cleanly
    settings::update_inventory_rules(
        &db,
        &admin,
        InventoryRules {
            allow_negative_stock: false,
            costing_method: "wac".to_string(),
            require_storekeeper_pin_on_issue: false,
            require_manager_pin_above_minor: 200_000,
        },
    )
    .unwrap();

    // Receipt + Collection on biz_date
    receipts::create_receipt(
        &db,
        &admin,
        CreateReceiptInput {
            procurement_list_id: None,
            supplier_id: None,
            invoice_ref: Some("INV-100".to_string()),
            received_by_staff_id: collector_id.clone(),
            approved_by_staff_id: keeper_id.clone(),
            received_at: Some(biz_date.clone()),
            disbursement_minor: None,
            extra_charges: vec![],
            notes: None,
            lines: vec![ReceiptLineInput {
                procurement_line_id: None,
                item_id: rice_id.clone(),
                unit_id: pcs_id.clone(),
                input_qty_milli: 10_000,
                unit_cost_minor: 150_000,
                line_total_minor: 1_500_000,
            }],
        },
    )
    .unwrap();

    collections::create_collection(
        &db,
        &admin,
        CreateCollectionInput {
            department_id: kitchen_id.clone(),
            collector_staff_id: collector_id.clone(),
            storekeeper_staff_id: keeper_id.clone(),
            collection_date: Some(biz_date.clone()),
            notes: Some("Dinner prep".to_string()),
            storekeeper_pin: None,
            lines: vec![CollectionLineInput {
                item_id: rice_id.clone(),
                unit_id: pcs_id.clone(),
                quantity_milli: 4_000,
            }],
        },
    )
    .unwrap();

    // Dashboard KPIs
    let kpis = dashboard::get_dashboard_kpis(&db, Some(biz_date.clone())).unwrap();
    assert_eq!(kpis.total_active_items, 1);
    assert_eq!(kpis.received_today_minor, 1_500_000);
    assert_eq!(kpis.consumed_today_minor, 600_000);
    assert_eq!(kpis.total_inventory_value_minor, 3_900_000); // 26 * ₦1,500

    let dept_pts = dashboard::get_consumption_by_department(&db, &biz_date, &biz_date).unwrap();
    assert_eq!(dept_pts[0].consumed_minor, 600_000);
    let series = dashboard::get_daily_consumption_series(&db, 7).unwrap();
    assert_eq!(series.len(), 7);
    let feed = dashboard::list_activity_log(
        &db,
        ActivityFeedFilter {
            action_prefix: Some("collection.".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(feed.len(), 1);

    // Stock Adjustments: Operator without PIN >= threshold fails Forbidden
    let pin_err = adjustments::create_adjustment(
        &db,
        &operator,
        CreateAdjustmentInput {
            reason: "spoilage".to_string(),
            notes: "Torn bag".to_string(),
            adjustment_date: Some(biz_date.clone()),
            manager_pin: None,
            lines: vec![AdjustmentLineInput {
                item_id: rice_id.clone(),
                unit_id: pcs_id.clone(),
                delta_qty_milli: -2_000, // ₦3,000 > ₦2,000 threshold
            }],
        },
    )
    .unwrap_err();
    assert_eq!(pin_err.code, ErrorCode::Forbidden);

    // Operator WITH valid Admin PIN succeeds (26 -> 24)
    let adj = adjustments::create_adjustment(
        &db,
        &operator,
        CreateAdjustmentInput {
            reason: "spoilage".to_string(),
            notes: "Water damaged bag".to_string(),
            adjustment_date: Some(biz_date.clone()),
            manager_pin: Some("1234".to_string()),
            lines: vec![AdjustmentLineInput {
                item_id: rice_id.clone(),
                unit_id: pcs_id.clone(),
                delta_qty_milli: -2_000,
            }],
        },
    )
    .unwrap();
    assert_eq!(adj.total_value_minor, -300_000);
    assert_eq!(adjustments::list_adjustments(&db, None).unwrap().len(), 1);

    // Stock Count cycle: 24 -> counted 21 -> net variance -3 (-₦4,500)
    let count =
        stock_counts::start_stock_count(&db, &admin, StartStockCountInput::default()).unwrap();
    assert_eq!(count.lines.len(), 1);
    assert_eq!(count.lines[0].system_qty_milli, 24_000);

    let updated = stock_counts::update_stock_count_lines(
        &db,
        &admin,
        &count.id,
        vec![UpdateStockCountLineInput {
            line_id: count.lines[0].id.clone(),
            counted_qty_milli: Some(21_000),
        }],
    )
    .unwrap();
    assert_eq!(updated.lines[0].variance_milli, Some(-3_000));

    let posted = stock_counts::post_stock_count(&db, &admin, &count.id, None).unwrap();
    assert_eq!(posted.status, "posted");
    assert_eq!(posted.net_variance_value_minor, -450_000);
    assert_eq!(items::get_item_detail(&db, &rice_id).unwrap().item.on_hand_milli, 21_000);
    assert!(db.check_integrity().unwrap().ok);
    assert_eq!(stock_counts::list_stock_counts(&db).unwrap().len(), 1);

    // Reports & Weekly Stock Sheet Export
    let val_rep = reports::get_stock_valuation_report(&db).unwrap();
    assert_eq!(val_rep.total_value_minor, 3_150_000); // 21 * ₦1,500

    let cons_rep = reports::get_consumption_report(
        &db,
        DateRangeFilter {
            start_date: biz_date.clone(),
            end_date: biz_date.clone(),
            department_id: Some(kitchen_id),
        },
    )
    .unwrap();
    assert_eq!(cons_rep[0].qty_milli, 4_000);

    let spend_rep = reports::get_procurement_spend_report(
        &db,
        DateRangeFilter {
            start_date: biz_date.clone(),
            end_date: biz_date.clone(),
            department_id: None,
        },
    )
    .unwrap();
    assert_eq!(spend_rep.len(), 1);

    let today = Utc::now().format("%Y-%m-%d").to_string();
    let sheet_rep = reports::get_weekly_stock_sheet(&db, "2026-11-01", &today.max(biz_date)).unwrap();
    assert_eq!(sheet_rep.grand_total_minor, 3_150_000);

    let out_xlsx = std::env::temp_dir().join("hosila_test_weekly_stock_sheet.xlsx");
    let _ = std::fs::remove_file(&out_xlsx);
    stock_sheet_xlsx::export_weekly_stock_sheet_xlsx(
        &db,
        "2026-11-01",
        &Utc::now().format("%Y-%m-%d").to_string().max("2026-11-30".to_string()),
        &out_xlsx,
    )
    .unwrap();
    assert!(out_xlsx.exists());
    let _ = std::fs::remove_file(&out_xlsx);
}

#[test]
fn sqlite_online_backup_and_restore_roundtrip() {
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("hosila.db");
    let backups_dir = dir.path().join("backups");

    let db = Database::open_file(&db_path).unwrap();
    let (admin, _op, kitchen_id, _col, _keep, _rice_id, pcs_id, _) = setup_env(&db);

    // 1. Capture manual backup with 1 item
    let snap = backup::create_backup(&db, &backups_dir, "manual", 10).unwrap();
    assert_eq!(snap.kind, "manual");
    assert!(snap.size_bytes > 0);
    assert_eq!(backup::list_backups(&backups_dir).unwrap().len(), 1);

    // Trigger daily auto-backup idempotently
    assert!(backup::auto_backup_if_due(&db, &backups_dir).unwrap().is_some());
    assert!(backup::auto_backup_if_due(&db, &backups_dir).unwrap().is_none());

    // 2. Mutate database after snapshot
    items::create_item(
        &db,
        &admin,
        CreateItemInput {
            sku: None,
            name: "Extra Temp Item".to_string(),
            description: None,
            base_unit_id: pcs_id,
            display_unit_id: None,
            default_issue_unit_id: None,
            default_purchase_unit_id: None,
            store_section_id: None,
            department_ids: vec![kitchen_id],
            item_units: vec![],
            reorder_point_milli: 0,
            par_level_milli: 0,
            initial_unit_cost_micro: 0,
            cost_missing: true,
            is_returnable: false,
            opening_stock_milli: 0,
            opening_date: None,
            supplier_id: None,
            storage_location: None,
        },
    )
    .unwrap();
    assert_eq!(
        items::list_items(&db, Default::default()).unwrap().len(),
        2
    );

    // 3. Restore snapshot as Admin and verify pre_restore safety copy + rollback to 1 item
    let report = backup::restore_backup(
        &db,
        &backups_dir,
        &admin,
        std::path::Path::new(&snap.path),
    )
    .unwrap();
    assert!(report.ok);
    assert_eq!(
        items::list_items(&db, Default::default()).unwrap().len(),
        1
    );
    let listed = backup::list_backups(&backups_dir).unwrap();
    assert!(listed.iter().any(|b| b.kind == "pre_restore"));
}

#[test]
fn trial_and_ed25519_offline_license_verification_work() {
    let db = Database::open_in_memory().unwrap();
    let (admin, ..) = setup_env(&db);

    let signing_key = SigningKey::from_bytes(&[7u8; 32]);
    let verifying_key = signing_key.verifying_key();

    // 1. Fresh DB gets 14-day trial
    let trial = get_license_status_with_key(&db, &verifying_key).unwrap();
    assert_eq!(trial.state, "trial");
    assert_eq!(trial.trial_days_remaining, 14);
    assert!(!trial.is_read_only);
    assert!(trial.machine_fingerprint.starts_with("HSLA-"));

    // 2. Expired trial flips is_read_only = true
    let expired_ts = (Utc::now() - Duration::days(20))
        .to_rfc3339_opts(SecondsFormat::Secs, true);
    let expired_json = serde_json::to_string(&expired_ts).unwrap();
    db.transaction(|tx| {
        tx.execute(
            "UPDATE settings SET value_json = ?1 WHERE key = 'trial_started_at'",
            params![expired_json],
        )?;
        Ok(())
    })
    .unwrap();
    let expired = get_license_status_with_key(&db, &verifying_key).unwrap();
    assert_eq!(expired.state, "trial_expired");
    assert_eq!(expired.trial_days_remaining, 0);
    assert!(expired.is_read_only);

    // 3. Key signed for another machine must fail
    let wrong_key = sign_license_payload(
        &signing_key,
        &LicensePayload {
            v: 1,
            id: "IMS-2026-000001".to_string(),
            product: Some("hosila-ims".to_string()),
            license_type: "commercial".to_string(),
            machine_id: "HSLA-0000-0000-0000".to_string(),
            hotel_name: "Wrong Hotel".to_string(),
            issued_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            expires_at: None,
        },
    )
    .unwrap();
    let fp = machine_fingerprint();
    let mismatch_err =
        verify_license_key_with_verifying_key(&wrong_key, &verifying_key, &fp).unwrap_err();
    assert_eq!(mismatch_err.code, ErrorCode::LicenseInvalid);

    // 3b. Commercial key for hosila-pms must be rejected by hosila-ims
    let pms_key = sign_license_payload(
        &signing_key,
        &LicensePayload {
            v: 1,
            id: "PMS-2026-000002".to_string(),
            product: Some("hosila-pms".to_string()),
            license_type: "commercial".to_string(),
            machine_id: fp.clone(),
            hotel_name: "Hosila Grand Hotel".to_string(),
            issued_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            expires_at: None,
        },
    )
    .unwrap();
    let prod_err =
        verify_license_key_with_verifying_key(&pms_key, &verifying_key, &fp).unwrap_err();
    assert_eq!(prod_err.code, ErrorCode::LicenseInvalid);

    // 4. Valid signed HSL1 commercial key for hosila-ims activates cleanly
    let valid_key = sign_license_payload(
        &signing_key,
        &LicensePayload {
            v: 1,
            id: "IMS-2026-8F2A1B".to_string(),
            product: Some("hosila-ims".to_string()),
            license_type: "commercial".to_string(),
            machine_id: fp,
            hotel_name: "Hosila Grand Hotel".to_string(),
            issued_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            expires_at: None,
        },
    )
    .unwrap();
    let activated = activate_license_with_key(&db, &admin, &valid_key, &verifying_key).unwrap();
    assert_eq!(activated.state, "licensed");
    assert_eq!(activated.licensed_to.as_deref(), Some("Hosila Grand Hotel"));
    assert!(!activated.is_read_only);
    require_writable_license_with_key(&db, &verifying_key).unwrap();
}

#[test]
fn clear_inventory_removes_items_and_ledger_while_keeping_org() {
    let db = Database::open_in_memory().unwrap();
    let (admin, operator, kitchen_id, collector_id, keeper_id, rice_id, pcs_id, _biz_date) =
        setup_env(&db);

    // Non-admin cannot clear inventory
    let forbidden = items::clear_inventory(&db, &operator).unwrap_err();
    assert_eq!(forbidden.code, ErrorCode::Forbidden);

    receipts::create_receipt(
        &db,
        &admin,
        CreateReceiptInput {
            procurement_list_id: None,
            supplier_id: None,
            invoice_ref: Some("INV-CLR".to_string()),
            received_by_staff_id: collector_id,
            approved_by_staff_id: keeper_id,
            received_at: Some("2026-11-10".to_string()),
            disbursement_minor: None,
            extra_charges: vec![],
            notes: None,
            lines: vec![ReceiptLineInput {
                procurement_line_id: None,
                item_id: rice_id,
                unit_id: pcs_id,
                input_qty_milli: 5_000,
                unit_cost_minor: 100_000,
                line_total_minor: 500_000,
            }],
        },
    )
    .unwrap();

    let cleared_count = items::clear_inventory(&db, &admin).unwrap();
    assert!(cleared_count >= 1);
    assert!(items::list_items(&db, ItemFilter::default()).unwrap().is_empty());
    assert!(!org::list_departments(&db, false).unwrap().is_empty());
    let _ = kitchen_id;
    let integrity = db.check_integrity().unwrap();
    assert!(integrity.ok);
    assert_eq!(integrity.ledger_mismatches, 0);
}

#[test]
fn receipt_reversal_reverts_wac_and_blocks_negative_stock() {
    let db = Database::open_in_memory().unwrap();
    let (admin, _operator, kitchen_id, collector_id, keeper_id, _rice_id, pcs_id, _biz_date) =
        setup_env(&db);

    let oil = items::create_item(
        &db,
        &admin,
        CreateItemInput {
            sku: None,
            name: "Cooking Oil".to_string(),
            description: None,
            base_unit_id: pcs_id.clone(),
            display_unit_id: None,
            default_issue_unit_id: None,
            default_purchase_unit_id: None,
            store_section_id: None,
            department_ids: vec![kitchen_id.clone()],
            item_units: vec![],
            reorder_point_milli: 2_000,
            par_level_milli: 10_000,
            initial_unit_cost_micro: 0,
            cost_missing: true,
            is_returnable: false,
            opening_stock_milli: 0,
            opening_date: Some("2026-11-10".to_string()),
            supplier_id: None,
            storage_location: None,
        },
    )
    .unwrap();

    let pl = procurement::create_procurement_list(
        &db,
        &admin,
        CreateProcurementListInput {
            title: "Weekly Oil".to_string(),
            scope: "custom".to_string(),
            department_ids: vec![kitchen_id.clone()],
            extra_charges: vec![],
            lines: vec![ProcurementLineInput {
                item_id: oil.id.clone(),
                section_label: "KITCHEN".to_string(),
                buyer_name: None,
                unit_id: Some(pcs_id.clone()),
                ordered_qty_milli: Some(10_000),
                est_unit_cost_minor: Some(200_000),
                budget_amount_minor: None,
            }],
        },
    )
    .unwrap();
    let pl_line_id = pl.lines[0].id.clone();

    // Oil starts at 0 stock and cost_missing = true; receive 10 at 200k minor
    let r1 = receipts::create_receipt(
        &db,
        &admin,
        CreateReceiptInput {
            procurement_list_id: Some(pl.id.clone()),
            supplier_id: None,
            invoice_ref: Some("R1".to_string()),
            received_by_staff_id: collector_id.clone(),
            approved_by_staff_id: keeper_id.clone(),
            received_at: Some("2026-11-10".to_string()),
            disbursement_minor: None,
            extra_charges: vec![],
            notes: None,
            lines: vec![ReceiptLineInput {
                procurement_line_id: Some(pl_line_id),
                item_id: oil.id.clone(),
                unit_id: pcs_id.clone(),
                input_qty_milli: 10_000,
                unit_cost_minor: 200_000,
                line_total_minor: 2_000_000,
            }],
        },
    )
    .unwrap();
    let pl_after = procurement::get_procurement_list(&db, &pl.id).unwrap();
    assert_eq!(pl_after.status, "received");

    // Issue 6 PCS so reversing r1 (-10) would violate allow_negative_stock = false
    collections::create_collection(
        &db,
        &admin,
        CreateCollectionInput {
            department_id: kitchen_id,
            collector_staff_id: collector_id,
            storekeeper_staff_id: keeper_id,
            collection_date: Some("2026-11-10".to_string()),
            notes: None,
            storekeeper_pin: None,
            lines: vec![CollectionLineInput {
                item_id: oil.id.clone(),
                unit_id: pcs_id.clone(),
                quantity_milli: 6_000,
            }],
        },
    )
    .unwrap();

    let neg_err =
        receipts::reverse_receipt(&db, &admin, &r1.id, "Mistake".to_string(), Some("1234".to_string()))
            .unwrap_err();
    assert_eq!(neg_err.code, ErrorCode::InsufficientStock);

    // Adjust back +6 then reverse and verify WAC & procurement status revert
    adjustments::create_adjustment(
        &db,
        &admin,
        CreateAdjustmentInput {
            reason: "count_correction".to_string(),
            notes: "Restore before reversing receipt".to_string(),
            adjustment_date: Some("2026-11-10".to_string()),
            manager_pin: Some("1234".to_string()),
            lines: vec![AdjustmentLineInput {
                item_id: oil.id.clone(),
                unit_id: pcs_id,
                delta_qty_milli: 6_000,
            }],
        },
    )
    .unwrap();

    let reversed =
        receipts::reverse_receipt(&db, &admin, &r1.id, "Duplicate entry".to_string(), Some("1234".to_string()))
            .unwrap();
    assert_eq!(reversed.status, "reversed");

    let pl_reverted = procurement::get_procurement_list(&db, &pl.id).unwrap();
    assert_eq!(pl_reverted.status, "finalised");

    let oil_detail = items::get_item_detail(&db, &oil.id).unwrap();
    assert_eq!(oil_detail.item.avg_cost_micro, 0);
    assert!(oil_detail.item.cost_missing);
    assert!(db.check_integrity().unwrap().ok);
}

#[test]
fn writable_license_guard_blocks_expired_trial() {
    let db = Database::open_in_memory().unwrap();
    let (_admin, _, _, _, _, _, _, _) = setup_env(&db);
    let signing_key = SigningKey::from_bytes(&[9u8; 32]);
    let verifying_key = signing_key.verifying_key();

    // Active 14-day trial permits writes
    require_writable_license_with_key(&db, &verifying_key).unwrap();

    // Backdate trial start by 20 days
    let old_start = (Utc::now() - Duration::days(20)).to_rfc3339_opts(SecondsFormat::Secs, true);
    let old_json = serde_json::to_string(&old_start).unwrap();
    db.transaction(|tx| {
        tx.execute(
            "UPDATE settings SET value_json = ?1 WHERE key = 'trial_started_at'",
            params![old_json],
        )?;
        Ok(())
    })
    .unwrap();

    let err = require_writable_license_with_key(&db, &verifying_key).unwrap_err();
    assert_eq!(err.code, ErrorCode::Forbidden);
}
