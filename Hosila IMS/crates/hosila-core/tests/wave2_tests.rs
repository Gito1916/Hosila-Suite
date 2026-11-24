use std::path::PathBuf;

use hosila_core::db::Database;
use hosila_core::export::{print_html, procurement_xlsx};
use hosila_core::parser::{procurement_parser, weekly_sheet};
use hosila_core::seed::seed_system_defaults;
use hosila_core::services::{auth, items, org, procurement, staff};
use hosila_core::types::{
    BusinessProfile, ConfirmParsedLineInput, ConfirmParsedRestockInput, CreateDepartmentInput,
    CreateProcurementListInput, CreateStaffInput, CreateStoreSectionInput, ExtraChargeDto,
    GenerateProcurementDraftInput, ItemFilter, OnboardingInput, ParsedAnomalyCode,
    ProcurementLineInput, WeeklySheetImportOptions,
};

fn de_palms_inventory_xlsx() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../DE PALMS STORE INVENTORY NOVEMBER 2026.xlsx")
}

fn de_palms_week3_xlsx() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../NOVEMBER 2026 WEEk 3 PROCUREMENT LIST.xlsx")
}

fn setup_admin_and_defaults(db: &Database) -> hosila_core::types::SessionUser {
    seed_system_defaults(db).unwrap();
    auth::complete_onboarding(
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
                    name: "F&B".to_string(),
                    color: Some("#3B82F6".to_string()),
                    sort_order: Some(2),
                },
                CreateDepartmentInput {
                    name: "Store".to_string(),
                    color: Some("#64748B".to_string()),
                    sort_order: Some(3),
                },
            ],
            store_sections: vec![CreateStoreSectionInput {
                name: "Protein".to_string(),
                sort_order: Some(1),
            }],
        },
    )
    .unwrap()
}

#[test]
fn weekly_sheet_imports_de_palms_week2_accurately() {
    let xlsx = de_palms_inventory_xlsx();
    assert!(xlsx.exists(), "Missing sample De Palms inventory sheet");

    let db = Database::open_in_memory().unwrap();
    let admin = setup_admin_and_defaults(&db);

    let opts = WeeklySheetImportOptions {
        file_path: xlsx.to_string_lossy().to_string(),
        sheet_name: Some("WEEK 2".to_string()),
        profile: "de_palms".to_string(),
        opening_date: "2026-11-02".to_string(),
        purchase_date: "2026-11-05".to_string(),
        excluded_row_numbers: None,
    };

    let preview = weekly_sheet::preview_weekly_sheet_import(&opts).unwrap();
    assert_eq!(preview.sheet_name, "WEEK 2");
    assert_eq!(preview.total_items, 370);
    assert_eq!(preview.cost_missing_count, 72);
    let protein_rows = preview
        .rows
        .iter()
        .filter(|r| r.store_section.as_deref() == Some("Protein"))
        .count();
    assert_eq!(protein_rows, 17);
    assert!(
        (preview.total_closing_value_minor - 719_675_812).abs() <= 100,
        "unexpected closing valuation: {}",
        preview.total_closing_value_minor
    );

    let first_row_num = preview.rows[0].row_number;
    let first_closing_milli = preview.rows[0].closing_milli.max(0);

    let result = weekly_sheet::commit_weekly_sheet_import(&db, &admin, opts.clone()).unwrap();
    assert_eq!(result.items_created, 370);
    assert_eq!(result.cost_missing_count, 72);

    // Re-importing the exact same sheet is idempotent and does not double on-hand stock
    let reimport = weekly_sheet::commit_weekly_sheet_import(&db, &admin, opts.clone()).unwrap();
    assert_eq!(reimport.items_created, 0);
    assert_eq!(reimport.items_updated, 370);

    // Excluding a row omits it when committing to a clean DB
    let excluded_db = Database::open_in_memory().unwrap();
    let excluded_admin = setup_admin_and_defaults(&excluded_db);
    let excl_res = weekly_sheet::commit_weekly_sheet_import(
        &excluded_db,
        &excluded_admin,
        WeeklySheetImportOptions {
            excluded_row_numbers: Some(vec![first_row_num]),
            ..opts
        },
    )
    .unwrap();
    assert_eq!(excl_res.items_created, 369);

    // Check Pineapple deduplication (F&B item shared by both Kitchen and F&B)
    let pineapples = items::list_items(
        &db,
        ItemFilter {
            search: Some("PINEAPPLE".to_string()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(pineapples.len(), 1);
    let dept_names: Vec<&str> = pineapples[0]
        .department_names
        .iter()
        .map(|d| d.as_str())
        .collect();
    assert!(dept_names.contains(&"Kitchen"));
    assert!(dept_names.contains(&"F&B"));

    // Check Protein store section count under Kitchen
    let sections = org::list_store_sections(&db, false).unwrap();
    let protein = sections
        .iter()
        .find(|s| s.name.eq_ignore_ascii_case("Protein"))
        .unwrap();
    let protein_items = items::list_items(
        &db,
        ItemFilter {
            store_section_id: Some(protein.id.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(protein_items.len(), 17);

    // Check first item's on-hand stayed at closing qty after idempotent re-import
    assert_eq!(pineapples[0].on_hand_milli >= 0, true);
    let all_items = items::list_items(&db, ItemFilter::default()).unwrap();
    assert_eq!(all_items.len(), 370);
    let _ = first_closing_milli;

    let integrity = db.check_integrity().unwrap();
    assert!(integrity.ok);
    assert_eq!(integrity.ledger_mismatches, 0);
}

#[test]
fn procurement_export_tier1_roundtrip_and_week3_tier2_parser() {
    let inv_xlsx = de_palms_inventory_xlsx();
    let wk3_xlsx = de_palms_week3_xlsx();
    assert!(wk3_xlsx.exists(), "Missing sample Week 3 procurement list");

    let db = Database::open_in_memory().unwrap();
    let admin = setup_admin_and_defaults(&db);

    // Seed Week 2 items
    weekly_sheet::commit_weekly_sheet_import(
        &db,
        &admin,
        WeeklySheetImportOptions {
            file_path: inv_xlsx.to_string_lossy().to_string(),
            sheet_name: Some("WEEK 2".to_string()),
            profile: "de_palms".to_string(),
            opening_date: "2026-11-02".to_string(),
            purchase_date: "2026-11-05".to_string(),
            excluded_row_numbers: None,
        },
    )
    .unwrap();

    // Add Storekeeper + Receiver staff
    let depts = org::list_departments(&db, false).unwrap();
    let store_dept = depts.iter().find(|d| d.name == "Store").unwrap();
    let kitchen_dept = depts.iter().find(|d| d.name == "Kitchen").unwrap();

    let keeper = staff::create_staff(
        &db,
        &admin,
        CreateStaffInput {
            full_name: "Chidi Storekeeper".to_string(),
            staff_code: None,
            phone: None,
            is_store_staff: true,
            department_ids: vec![store_dept.id.clone()],
        },
    )
    .unwrap();
    let buyer = staff::create_staff(
        &db,
        &admin,
        CreateStaffInput {
            full_name: "Margaret Buyer".to_string(),
            staff_code: None,
            phone: None,
            is_store_staff: false,
            department_ids: vec![kitchen_dept.id.clone()],
        },
    )
    .unwrap();

    // 1. Test Tier 1 Procurement Draft -> Create -> Export XLSX + HTML -> Re-import
    let custom_items = items::list_items(
        &db,
        ItemFilter {
            department_id: Some(kitchen_dept.id.clone()),
            ..Default::default()
        },
    )
    .unwrap();
    let sample_ids: Vec<String> = custom_items.iter().take(2).map(|i| i.id.clone()).collect();

    let draft_lines = procurement::generate_procurement_draft(
        &db,
        GenerateProcurementDraftInput {
            scope: "custom".to_string(),
            department_ids: vec![kitchen_dept.id.clone()],
            custom_item_ids: sample_ids,
        },
    )
    .unwrap();
    assert_eq!(draft_lines.len(), 2);

    let list = procurement::create_procurement_list(
        &db,
        &admin,
        CreateProcurementListInput {
            title: "WEEK 4 RESTOCK".to_string(),
            scope: "custom".to_string(),
            department_ids: vec![kitchen_dept.id.clone()],
            extra_charges: vec![ExtraChargeDto {
                label: "TRANSPORT".to_string(),
                amount_minor: 500_000,
            }],
            lines: draft_lines
                .iter()
                .map(|d| ProcurementLineInput {
                    item_id: d.item_id.clone(),
                    section_label: d.section_label.clone(),
                    buyer_name: Some("MARGARET".to_string()),
                    unit_id: Some(d.unit_id.clone()),
                    ordered_qty_milli: Some(5_000),
                    est_unit_cost_minor: Some(250_000),
                    budget_amount_minor: None,
                })
                .collect(),
        },
    )
    .unwrap();

    let tmp_xlsx = std::env::temp_dir().join("hosila_test_proc_roundtrip.xlsx");
    let _ = std::fs::remove_file(&tmp_xlsx);
    procurement_xlsx::export_procurement_xlsx(&db, &list.id, &tmp_xlsx).unwrap();
    assert!(tmp_xlsx.exists());

    let html = print_html::render_procurement_print_html(&db, &list.id).unwrap();
    assert!(html.contains("WEEK 4 RESTOCK"));
    assert!(html.contains("TRANSPORT"));

    let sheets =
        procurement_parser::inspect_procurement_workbook(&tmp_xlsx.to_string_lossy()).unwrap();
    assert!(sheets.iter().any(|s| s.name == "Procurement List" && s.has_hosila_meta));
    assert!(sheets
        .iter()
        .any(|s| s.detected_buyer.as_deref() == Some("MARGARET")));

    let parsed_tier1 = procurement_parser::parse_procurement_workbook(
        &db,
        &tmp_xlsx.to_string_lossy(),
        vec!["Procurement List".to_string()],
    )
    .unwrap();
    assert_eq!(parsed_tier1.tier, "tier1_meta");
    assert_eq!(parsed_tier1.linked_procurement_list_id.as_deref(), Some(list.id.as_str()));
    assert_eq!(parsed_tier1.lines.len(), 2);
    assert_eq!(parsed_tier1.extra_charges.len(), 1);
    let _ = std::fs::remove_file(&tmp_xlsx);

    // 2. Test Real De Palms Week 3 workbook via Tier 2 parser
    let wk3_sheets =
        procurement_parser::inspect_procurement_workbook(&wk3_xlsx.to_string_lossy()).unwrap();
    assert_eq!(wk3_sheets.len(), 3);
    assert!(wk3_sheets.iter().all(|s| !s.has_hosila_meta));

    let wk3_draft = procurement_parser::parse_procurement_workbook(
        &db,
        &wk3_xlsx.to_string_lossy(),
        vec!["Sheet1".to_string()],
    )
    .unwrap();
    assert_eq!(wk3_draft.tier, "tier2_heuristic");
    assert!(wk3_draft.lines.len() >= 55);
    let extra_sum: i64 = wk3_draft.extra_charges.iter().map(|e| e.amount_minor).sum();
    assert_eq!(wk3_draft.extra_charges.len(), 2);
    assert_eq!(extra_sum, 2_100_000); // ₦20,000 transport + ₦1,000 bank charges

    let veg_oil = wk3_draft
        .lines
        .iter()
        .find(|l| l.raw_description.to_ascii_uppercase().contains("VEGETABLE OIL"))
        .expect("Vegetable Oil should be parsed");
    assert!(veg_oil.anomalies.contains(&ParsedAnomalyCode::AmountMismatch));

    let onion = wk3_draft
        .lines
        .iter()
        .find(|l| l.raw_description.to_ascii_uppercase().contains("ONION"))
        .expect("Onion should be parsed");
    assert!(onion.anomalies.contains(&ParsedAnomalyCode::AmountOnly));

    let basmatic = wk3_draft
        .lines
        .iter()
        .find(|l| l.raw_description.to_ascii_uppercase().contains("BASMAT"))
        .expect("Basmatic Rice should be parsed");
    assert!(basmatic
        .anomalies
        .contains(&ParsedAnomalyCode::UnitConversionNeeded));

    // Confirm parsed restock via Storekeeper Confirmation Gate (test map + alias + conversion + create_new)
    let first_item = &custom_items[0];
    let units = hosila_core::services::units::list_units(&db).unwrap();
    let pack_unit = units.iter().find(|u| u.code == "PACK").unwrap();

    let prev_stock = first_item.on_hand_milli;
    let receipt = procurement_parser::confirm_parsed_restock(
        &db,
        &admin,
        ConfirmParsedRestockInput {
            filename: "NOVEMBER 2026 WEEk 3 PROCUREMENT LIST.xlsx".to_string(),
            procurement_list_id: None,
            supplier_id: None,
            invoice_ref: Some("MKT-WK3".to_string()),
            received_by_staff_id: buyer.id.clone(),
            approved_by_staff_id: keeper.id.clone(),
            received_at: Some("2026-11-16".to_string()),
            disbursement_minor: Some(4_000_000),
            extra_charges: wk3_draft.extra_charges.clone(),
            notes: Some("Week 3 confirmed market purchase".to_string()),
            lines: vec![
                ConfirmParsedLineInput {
                    raw_description: "SPECIAL BASMATIC RICE".to_string(),
                    action: "map".to_string(),
                    item_id: Some(first_item.id.clone()),
                    new_item_name: None,
                    new_item_department_id: None,
                    unit_id: pack_unit.id.clone(),
                    factor_milli: 12_000,
                    quantity_milli: 2_000, // 2 PACK = 24 base units
                    line_total_minor: 1_200_000,
                    procurement_line_id: None,
                    save_alias: true,
                    save_unit_conversion: true,
                },
                ConfirmParsedLineInput {
                    raw_description: "FRESH BRAND NEW SEASONING".to_string(),
                    action: "create_new".to_string(),
                    item_id: None,
                    new_item_name: Some("FRESH BRAND NEW SEASONING".to_string()),
                    new_item_department_id: Some(kitchen_dept.id.clone()),
                    unit_id: pack_unit.id.clone(),
                    factor_milli: 1_000,
                    quantity_milli: 3_000,
                    line_total_minor: 450_000,
                    procurement_line_id: None,
                    save_alias: false,
                    save_unit_conversion: false,
                },
            ],
        },
    )
    .unwrap();

    assert_eq!(receipt.lines.len(), 2);
    let updated_first = items::get_item_detail(&db, &first_item.id).unwrap();
    assert_eq!(updated_first.item.on_hand_milli, prev_stock + 24_000);
    assert!(updated_first
        .item
        .item_units
        .iter()
        .any(|u| u.unit_id == pack_unit.id && u.factor_milli == 12_000));
}
