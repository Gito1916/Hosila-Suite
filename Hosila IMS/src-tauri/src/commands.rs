use std::path::{Path, PathBuf};

use tauri::State;

use hosila_core::db::backup;
use hosila_core::error::ApiError;
use hosila_core::export::{print_html, procurement_xlsx, stock_sheet_xlsx};
use hosila_core::license;
use hosila_core::parser::{procurement_parser, weekly_sheet};
use hosila_core::services::{
    adjustments, auth, collections, dashboard, items, org, procurement, receipts, reports,
    settings, staff, stock_counts, units,
};
use hosila_core::types::{
    ActivityFeedFilter, ActivityLogDto, AdjustmentDto, AllSettingsDto, AppearanceSettings,
    BackupFileDto, BusinessProfile, ChangeBaseUnitInput, CollectionDto, CollectionFilter,
    CollectionValidationDto, ConfirmParsedRestockInput, ConsumptionByDeptRow,
    CreateAdjustmentInput, CreateCollectionInput, CreateDepartmentInput, CreateItemInput,
    CreateProcurementListInput, CreateReceiptInput, CreateStaffInput, CreateStoreSectionInput,
    CreateSupplierInput, CreateUnitInput, CreateUserInput, DailyConsumptionPoint,
    DashboardKpisDto, DateRangeFilter, DepartmentConsumptionPoint, DepartmentDto,
    GenerateProcurementDraftInput, IntegrityReport, InventoryRules, ItemDetailDto, ItemFilter,
    ItemListRowDto, LicenseStatusDto, LoginInput, ManagerApprovalDto, OnboardingInput,
    OutstandingReturnDto, ParsedProcurementDraft, PinLoginInput, ProcurementDraftLineDto,
    ProcurementListDto, ProcurementListSummaryDto, ProcurementSpendRow, ReceiptDto, ReceiptFilter,
    RecordReturnInput, SessionUser, StaffDto, StaffFilter, StartStockCountInput, StockCountDto,
    StockCountSummaryDto, StockMovementDto, StockValuationReportDto, StoreSectionDto,
    SupplierDto, SystemInfo, UnitDto, UpdateDepartmentInput, UpdateItemInput,
    UpdateProcurementListInput, UpdateStaffInput, UpdateStockCountLineInput,
    UpdateStoreSectionInput, UpdateSupplierInput, UpdateUnitInput, UpdateUserInput, UserDto,
    WeeklySheetImportOptions, WeeklySheetImportPreview, WeeklySheetImportResult,
    WeeklyStockSheetReportDto, WorkbookSheetSummary,
};

use crate::AppState;

fn decode_base64_payload(input: &str) -> Result<Vec<u8>, ApiError> {
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    let cleaned: String = input.chars().filter(|c| !c.is_ascii_whitespace()).collect();
    STANDARD
        .decode(cleaned.as_bytes())
        .map_err(|_| ApiError::validation("Invalid base64 payload in uploaded file."))
}

fn resolve_input_excel_path(state: &AppState, raw_path: &str) -> Result<String, ApiError> {
    let trimmed = raw_path.trim();
    if let Some(rest) = trimmed
        .strip_prefix("data:excel/base64,")
        .or_else(|| trimmed.strip_prefix("data:backup/base64,"))
    {
        let (raw_name, b64_data) = rest.split_once(":::").ok_or_else(|| {
            ApiError::validation("Malformed uploaded Excel file payload.")
        })?;
        let safe_name: String = Path::new(raw_name)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("uploaded_workbook.xlsx")
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || matches!(c, ' ' | '.' | '-' | '_' | '(' | ')') {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let file_name = if safe_name.trim().is_empty() {
            "uploaded_workbook.xlsx".to_string()
        } else {
            safe_name
        };
        let bytes = decode_base64_payload(b64_data)?;
        let uploads_dir = state.paths.data_dir.join("uploads");
        std::fs::create_dir_all(&uploads_dir).map_err(|e| {
            ApiError::internal(format!("Could not create uploads directory: {e}"))
        })?;
        let staged_path = uploads_dir.join(file_name);
        std::fs::write(&staged_path, &bytes).map_err(|e| {
            ApiError::internal(format!("Could not stage uploaded Excel file: {e}"))
        })?;
        return Ok(staged_path.to_string_lossy().into_owned());
    }

    let direct = Path::new(trimmed);
    if direct.exists() {
        return Ok(trimmed.to_string());
    }

    let in_uploads = state.paths.data_dir.join("uploads").join(trimmed);
    if in_uploads.exists() {
        return Ok(in_uploads.to_string_lossy().into_owned());
    }

    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let base = PathBuf::from(user_profile);
        for sub in ["Downloads", "Desktop", "Documents"] {
            let candidate = base.join(sub).join(trimmed);
            if candidate.exists() {
                return Ok(candidate.to_string_lossy().into_owned());
            }
        }
    }

    Ok(trimmed.to_string())
}

fn resolve_output_excel_path(state: &AppState, raw_output: &str) -> PathBuf {
    let trimmed = raw_output.trim();
    let p = Path::new(trimmed);
    let resolved = if p.is_absolute() {
        PathBuf::from(trimmed)
    } else if let Some(rest) = trimmed
        .strip_prefix("Downloads\\")
        .or_else(|| trimmed.strip_prefix("Downloads/"))
    {
        if let Some(user_profile) = std::env::var_os("USERPROFILE") {
            PathBuf::from(user_profile).join("Downloads").join(rest)
        } else {
            state.paths.data_dir.join("exports").join(rest)
        }
    } else if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        PathBuf::from(user_profile).join("Downloads").join(trimmed)
    } else {
        state.paths.data_dir.join("exports").join(trimmed)
    };
    if let Some(parent) = resolved.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    resolved
}

// ── System ──────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_system_info(state: State<'_, AppState>) -> Result<SystemInfo, ApiError> {
    hosila_core::get_system_info(
        &state.db,
        &state.paths,
        env!("CARGO_PKG_VERSION"),
        state.initial_integrity.clone(),
    )
}

#[tauri::command]
#[specta::specta]
pub fn run_integrity_check(state: State<'_, AppState>) -> Result<IntegrityReport, ApiError> {
    state.db.check_integrity()
}

// ── Auth & Onboarding ───────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn complete_onboarding(
    state: State<'_, AppState>,
    input: OnboardingInput,
) -> Result<SessionUser, ApiError> {
    let session = auth::complete_onboarding(&state.db, input)?;
    state.set_session(Some(session.clone()))?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub fn login(state: State<'_, AppState>, input: LoginInput) -> Result<SessionUser, ApiError> {
    let session = auth::authenticate_password(&state.db, input)?;
    state.set_session(Some(session.clone()))?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub fn login_with_pin(
    state: State<'_, AppState>,
    input: PinLoginInput,
) -> Result<SessionUser, ApiError> {
    let session = auth::authenticate_pin(&state.db, input)?;
    state.set_session(Some(session.clone()))?;
    Ok(session)
}

#[tauri::command]
#[specta::specta]
pub fn logout(state: State<'_, AppState>) -> Result<(), ApiError> {
    state.set_session(None)
}

#[tauri::command]
#[specta::specta]
pub fn get_current_session(state: State<'_, AppState>) -> Result<Option<SessionUser>, ApiError> {
    state.current_session()
}

#[tauri::command]
#[specta::specta]
pub fn verify_manager_pin(
    state: State<'_, AppState>,
    pin: String,
) -> Result<ManagerApprovalDto, ApiError> {
    let _actor = state.require_session()?;
    auth::verify_manager_pin(&state.db, &pin)
}

// ── Users ───────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_users(state: State<'_, AppState>) -> Result<Vec<UserDto>, ApiError> {
    let _actor = state.require_session()?;
    auth::list_users(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn create_user(
    state: State<'_, AppState>,
    input: CreateUserInput,
) -> Result<UserDto, ApiError> {
    let actor = state.require_write_session()?;
    auth::create_user(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_user(
    state: State<'_, AppState>,
    id: String,
    input: UpdateUserInput,
) -> Result<UserDto, ApiError> {
    let actor = state.require_write_session()?;
    let updated = auth::update_user(&state.db, &actor, &id, input)?;
    if updated.id == actor.id {
        state.set_session(Some(SessionUser {
            id: updated.id.clone(),
            username: updated.username.clone(),
            full_name: updated.full_name.clone(),
            role: updated.role,
        }))?;
    }
    Ok(updated)
}

#[tauri::command]
#[specta::specta]
pub fn reset_user_password(
    state: State<'_, AppState>,
    id: String,
    new_password: String,
) -> Result<(), ApiError> {
    let actor = state.require_write_session()?;
    auth::reset_user_password(&state.db, &actor, &id, &new_password)
}

#[tauri::command]
#[specta::specta]
pub fn set_user_pin(
    state: State<'_, AppState>,
    id: String,
    pin: Option<String>,
) -> Result<(), ApiError> {
    let actor = state.require_write_session()?;
    auth::set_user_pin(&state.db, &actor, &id, pin)
}

// ── Settings ────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_settings(state: State<'_, AppState>) -> Result<AllSettingsDto, ApiError> {
    settings::get_settings(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn update_business_profile(
    state: State<'_, AppState>,
    profile: BusinessProfile,
) -> Result<BusinessProfile, ApiError> {
    let actor = state.require_write_session()?;
    settings::update_business_profile(&state.db, &actor, profile)
}

#[tauri::command]
#[specta::specta]
pub fn update_inventory_rules(
    state: State<'_, AppState>,
    rules: InventoryRules,
) -> Result<InventoryRules, ApiError> {
    let actor = state.require_write_session()?;
    settings::update_inventory_rules(&state.db, &actor, rules)
}

#[tauri::command]
#[specta::specta]
pub fn update_appearance(
    state: State<'_, AppState>,
    appearance: AppearanceSettings,
) -> Result<AppearanceSettings, ApiError> {
    settings::update_appearance(&state.db, appearance)
}

// ── Departments & Store Sections ────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_departments(
    state: State<'_, AppState>,
    include_inactive: bool,
) -> Result<Vec<DepartmentDto>, ApiError> {
    let _actor = state.require_session()?;
    org::list_departments(&state.db, include_inactive)
}

#[tauri::command]
#[specta::specta]
pub fn create_department(
    state: State<'_, AppState>,
    input: CreateDepartmentInput,
) -> Result<DepartmentDto, ApiError> {
    let actor = state.require_write_session()?;
    org::create_department(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_department(
    state: State<'_, AppState>,
    id: String,
    input: UpdateDepartmentInput,
) -> Result<DepartmentDto, ApiError> {
    let actor = state.require_write_session()?;
    org::update_department(&state.db, &actor, &id, input)
}

#[tauri::command]
#[specta::specta]
pub fn list_store_sections(
    state: State<'_, AppState>,
    include_inactive: bool,
) -> Result<Vec<StoreSectionDto>, ApiError> {
    let _actor = state.require_session()?;
    org::list_store_sections(&state.db, include_inactive)
}

#[tauri::command]
#[specta::specta]
pub fn create_store_section(
    state: State<'_, AppState>,
    input: CreateStoreSectionInput,
) -> Result<StoreSectionDto, ApiError> {
    let actor = state.require_write_session()?;
    org::create_store_section(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_store_section(
    state: State<'_, AppState>,
    id: String,
    input: UpdateStoreSectionInput,
) -> Result<StoreSectionDto, ApiError> {
    let actor = state.require_write_session()?;
    org::update_store_section(&state.db, &actor, &id, input)
}

// ── Staff ───────────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_staff(
    state: State<'_, AppState>,
    filter: StaffFilter,
) -> Result<Vec<StaffDto>, ApiError> {
    let _actor = state.require_session()?;
    staff::list_staff(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn create_staff(
    state: State<'_, AppState>,
    input: CreateStaffInput,
) -> Result<StaffDto, ApiError> {
    let actor = state.require_write_session()?;
    staff::create_staff(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_staff(
    state: State<'_, AppState>,
    id: String,
    input: UpdateStaffInput,
) -> Result<StaffDto, ApiError> {
    let actor = state.require_write_session()?;
    staff::update_staff(&state.db, &actor, &id, input)
}

// ── Units of Measure ────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_units(state: State<'_, AppState>) -> Result<Vec<UnitDto>, ApiError> {
    hosila_core::list_units(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn create_unit(
    state: State<'_, AppState>,
    input: CreateUnitInput,
) -> Result<UnitDto, ApiError> {
    let actor = state.require_write_session()?;
    units::create_unit(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_unit(
    state: State<'_, AppState>,
    id: String,
    input: UpdateUnitInput,
) -> Result<UnitDto, ApiError> {
    let actor = state.require_write_session()?;
    units::update_unit(&state.db, &actor, &id, input)
}

#[tauri::command]
#[specta::specta]
pub fn delete_unit(state: State<'_, AppState>, id: String) -> Result<(), ApiError> {
    let actor = state.require_write_session()?;
    units::delete_unit(&state.db, &actor, &id)
}

// ── Suppliers ───────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_suppliers(
    state: State<'_, AppState>,
    include_inactive: bool,
) -> Result<Vec<SupplierDto>, ApiError> {
    let _actor = state.require_session()?;
    items::list_suppliers(&state.db, include_inactive)
}

#[tauri::command]
#[specta::specta]
pub fn create_supplier(
    state: State<'_, AppState>,
    input: CreateSupplierInput,
) -> Result<SupplierDto, ApiError> {
    let actor = state.require_write_session()?;
    items::create_supplier(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_supplier(
    state: State<'_, AppState>,
    id: String,
    input: UpdateSupplierInput,
) -> Result<SupplierDto, ApiError> {
    let actor = state.require_write_session()?;
    items::update_supplier(&state.db, &actor, &id, input)
}

// ── Items & UoM ─────────────────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn list_items(
    state: State<'_, AppState>,
    filter: ItemFilter,
) -> Result<Vec<ItemListRowDto>, ApiError> {
    let _actor = state.require_session()?;
    items::list_items(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn get_item_detail(
    state: State<'_, AppState>,
    id: String,
) -> Result<ItemDetailDto, ApiError> {
    let _actor = state.require_session()?;
    items::get_item_detail(&state.db, &id)
}

#[tauri::command]
#[specta::specta]
pub fn get_item_stock_card(
    state: State<'_, AppState>,
    item_id: String,
    start_date: Option<String>,
    end_date: Option<String>,
    limit: Option<i32>,
) -> Result<Vec<StockMovementDto>, ApiError> {
    let _actor = state.require_session()?;
    items::get_item_stock_card(&state.db, &item_id, start_date, end_date, limit)
}

#[tauri::command]
#[specta::specta]
pub fn create_item(
    state: State<'_, AppState>,
    input: CreateItemInput,
) -> Result<ItemListRowDto, ApiError> {
    let actor = state.require_write_session()?;
    items::create_item(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_item(
    state: State<'_, AppState>,
    id: String,
    input: UpdateItemInput,
) -> Result<ItemListRowDto, ApiError> {
    let actor = state.require_write_session()?;
    items::update_item(&state.db, &actor, &id, input)
}

#[tauri::command]
#[specta::specta]
pub fn change_item_base_unit(
    state: State<'_, AppState>,
    id: String,
    input: ChangeBaseUnitInput,
) -> Result<ItemListRowDto, ApiError> {
    let actor = state.require_write_session()?;
    items::change_item_base_unit(&state.db, &actor, &id, input)
}

#[tauri::command]
#[specta::specta]
pub fn archive_item(state: State<'_, AppState>, id: String) -> Result<(), ApiError> {
    let actor = state.require_write_session()?;
    items::archive_item(&state.db, &actor, &id)
}

#[tauri::command]
#[specta::specta]
pub fn clear_inventory(state: State<'_, AppState>) -> Result<i32, ApiError> {
    let actor = state.require_write_session()?;
    auth::require_admin(&actor)?;
    let _ = backup::create_backup(&state.db, &state.paths.backups_dir, "pre_clear", 10);
    items::clear_inventory(&state.db, &actor)
}

// ── Collections & Returns ───────────────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn validate_collection(
    state: State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<CollectionValidationDto, ApiError> {
    let _actor = state.require_session()?;
    collections::validate_collection(&state.db, input)
}

#[tauri::command]
#[specta::specta]
pub fn create_collection(
    state: State<'_, AppState>,
    input: CreateCollectionInput,
) -> Result<CollectionDto, ApiError> {
    let actor = state.require_write_session()?;
    collections::create_collection(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn list_collections(
    state: State<'_, AppState>,
    filter: CollectionFilter,
) -> Result<Vec<CollectionDto>, ApiError> {
    let _actor = state.require_session()?;
    collections::list_collections(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn get_collection(
    state: State<'_, AppState>,
    id: String,
) -> Result<CollectionDto, ApiError> {
    let _actor = state.require_session()?;
    collections::get_collection(&state.db, &id)
}

#[tauri::command]
#[specta::specta]
pub fn reverse_collection(
    state: State<'_, AppState>,
    id: String,
    reason: String,
    manager_pin: Option<String>,
) -> Result<CollectionDto, ApiError> {
    let actor = state.require_write_session()?;
    collections::reverse_collection(&state.db, &actor, &id, reason, manager_pin)
}

#[tauri::command]
#[specta::specta]
pub fn list_outstanding_returns(
    state: State<'_, AppState>,
    department_id: Option<String>,
    staff_id: Option<String>,
) -> Result<Vec<OutstandingReturnDto>, ApiError> {
    let _actor = state.require_session()?;
    collections::list_outstanding_returns(&state.db, department_id, staff_id)
}

#[tauri::command]
#[specta::specta]
pub fn record_return(
    state: State<'_, AppState>,
    input: RecordReturnInput,
) -> Result<CollectionDto, ApiError> {
    let actor = state.require_write_session()?;
    collections::record_return(&state.db, &actor, input)
}

// ── Weekly Sheet Importer (Phase B4a) ────────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn preview_weekly_sheet_import(
    state: State<'_, AppState>,
    mut options: WeeklySheetImportOptions,
) -> Result<WeeklySheetImportPreview, ApiError> {
    let _actor = state.require_session()?;
    options.file_path = resolve_input_excel_path(&state, &options.file_path)?;
    weekly_sheet::preview_weekly_sheet_import(&options)
}

#[tauri::command]
#[specta::specta]
pub fn commit_weekly_sheet_import(
    state: State<'_, AppState>,
    mut options: WeeklySheetImportOptions,
) -> Result<WeeklySheetImportResult, ApiError> {
    let actor = state.require_write_session()?;
    options.file_path = resolve_input_excel_path(&state, &options.file_path)?;
    weekly_sheet::commit_weekly_sheet_import(&state.db, &actor, options)
}

// ── Procurement, Export & Goods Receipts (Phase B4b) ─────────────────────────

#[tauri::command]
#[specta::specta]
pub fn generate_procurement_draft(
    state: State<'_, AppState>,
    input: GenerateProcurementDraftInput,
) -> Result<Vec<ProcurementDraftLineDto>, ApiError> {
    let _actor = state.require_session()?;
    procurement::generate_procurement_draft(&state.db, input)
}

#[tauri::command]
#[specta::specta]
pub fn create_procurement_list(
    state: State<'_, AppState>,
    input: CreateProcurementListInput,
) -> Result<ProcurementListDto, ApiError> {
    let actor = state.require_write_session()?;
    procurement::create_procurement_list(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_procurement_list(
    state: State<'_, AppState>,
    id: String,
    input: UpdateProcurementListInput,
) -> Result<ProcurementListDto, ApiError> {
    let actor = state.require_write_session()?;
    procurement::update_procurement_list(&state.db, &actor, &id, input)
}

#[tauri::command]
#[specta::specta]
pub fn get_procurement_list(
    state: State<'_, AppState>,
    id: String,
) -> Result<ProcurementListDto, ApiError> {
    let _actor = state.require_session()?;
    procurement::get_procurement_list(&state.db, &id)
}

#[tauri::command]
#[specta::specta]
pub fn list_procurement_lists(
    state: State<'_, AppState>,
    status_filter: Option<String>,
) -> Result<Vec<ProcurementListSummaryDto>, ApiError> {
    let _actor = state.require_session()?;
    procurement::list_procurement_lists(&state.db, status_filter)
}

#[tauri::command]
#[specta::specta]
pub fn export_procurement_xlsx(
    state: State<'_, AppState>,
    id: String,
    output_path: String,
) -> Result<String, ApiError> {
    let actor = state.require_session()?;
    auth::require_operator(&actor)?;
    let resolved = resolve_output_excel_path(&state, &output_path);
    procurement_xlsx::export_procurement_xlsx(&state.db, &id, &resolved)
}

#[tauri::command]
#[specta::specta]
pub fn render_procurement_print_html(
    state: State<'_, AppState>,
    id: String,
) -> Result<String, ApiError> {
    let _actor = state.require_session()?;
    print_html::render_procurement_print_html(&state.db, &id)
}

#[tauri::command]
#[specta::specta]
pub fn create_receipt(
    state: State<'_, AppState>,
    input: CreateReceiptInput,
) -> Result<ReceiptDto, ApiError> {
    let actor = state.require_write_session()?;
    receipts::create_receipt(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn list_receipts(
    state: State<'_, AppState>,
    filter: ReceiptFilter,
) -> Result<Vec<ReceiptDto>, ApiError> {
    let _actor = state.require_session()?;
    receipts::list_receipts(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn get_receipt(
    state: State<'_, AppState>,
    id: String,
) -> Result<ReceiptDto, ApiError> {
    let _actor = state.require_session()?;
    receipts::get_receipt(&state.db, &id)
}

#[tauri::command]
#[specta::specta]
pub fn reverse_receipt(
    state: State<'_, AppState>,
    id: String,
    reason: String,
    manager_pin: Option<String>,
) -> Result<ReceiptDto, ApiError> {
    let actor = state.require_write_session()?;
    receipts::reverse_receipt(&state.db, &actor, &id, reason, manager_pin)
}

// ── Built-in Procurement List Parser (Phase B5) ──────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn inspect_procurement_workbook(
    state: State<'_, AppState>,
    file_path: String,
) -> Result<Vec<WorkbookSheetSummary>, ApiError> {
    let _actor = state.require_session()?;
    let resolved = resolve_input_excel_path(&state, &file_path)?;
    procurement_parser::inspect_procurement_workbook(&resolved)
}

#[tauri::command]
#[specta::specta]
pub fn parse_procurement_workbook(
    state: State<'_, AppState>,
    file_path: String,
    selected_sheets: Vec<String>,
) -> Result<ParsedProcurementDraft, ApiError> {
    let _actor = state.require_session()?;
    let resolved = resolve_input_excel_path(&state, &file_path)?;
    procurement_parser::parse_procurement_workbook(&state.db, &resolved, selected_sheets)
}

#[tauri::command]
#[specta::specta]
pub fn confirm_parsed_restock(
    state: State<'_, AppState>,
    input: ConfirmParsedRestockInput,
) -> Result<ReceiptDto, ApiError> {
    let actor = state.require_write_session()?;
    procurement_parser::confirm_parsed_restock(&state.db, &actor, input)
}

// ── Dashboard & Activity Feed (Phase B6) ─────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_dashboard_kpis(
    state: State<'_, AppState>,
    date: Option<String>,
) -> Result<DashboardKpisDto, ApiError> {
    let _actor = state.require_session()?;
    dashboard::get_dashboard_kpis(&state.db, date)
}

#[tauri::command]
#[specta::specta]
pub fn get_consumption_by_department(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<Vec<DepartmentConsumptionPoint>, ApiError> {
    let _actor = state.require_session()?;
    dashboard::get_consumption_by_department(&state.db, &start_date, &end_date)
}

#[tauri::command]
#[specta::specta]
pub fn get_daily_consumption_series(
    state: State<'_, AppState>,
    days: i32,
    as_of_date: Option<String>,
) -> Result<Vec<DailyConsumptionPoint>, ApiError> {
    let _actor = state.require_session()?;
    dashboard::get_daily_consumption_series_as_of(&state.db, days, as_of_date.as_deref())
}

#[tauri::command]
#[specta::specta]
pub fn list_activity_log(
    state: State<'_, AppState>,
    filter: ActivityFeedFilter,
) -> Result<Vec<ActivityLogDto>, ApiError> {
    let _actor = state.require_session()?;
    dashboard::list_activity_log(&state.db, filter)
}

// ── Stock Adjustments & Stock Counts (Phase B6) ──────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn create_adjustment(
    state: State<'_, AppState>,
    input: CreateAdjustmentInput,
) -> Result<AdjustmentDto, ApiError> {
    let actor = state.require_write_session()?;
    adjustments::create_adjustment(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn list_adjustments(
    state: State<'_, AppState>,
    limit: Option<i32>,
) -> Result<Vec<AdjustmentDto>, ApiError> {
    let _actor = state.require_session()?;
    adjustments::list_adjustments(&state.db, limit)
}

#[tauri::command]
#[specta::specta]
pub fn start_stock_count(
    state: State<'_, AppState>,
    input: StartStockCountInput,
) -> Result<StockCountDto, ApiError> {
    let actor = state.require_write_session()?;
    stock_counts::start_stock_count(&state.db, &actor, input)
}

#[tauri::command]
#[specta::specta]
pub fn update_stock_count_lines(
    state: State<'_, AppState>,
    count_id: String,
    updates: Vec<UpdateStockCountLineInput>,
) -> Result<StockCountDto, ApiError> {
    let actor = state.require_write_session()?;
    stock_counts::update_stock_count_lines(&state.db, &actor, &count_id, updates)
}

#[tauri::command]
#[specta::specta]
pub fn post_stock_count(
    state: State<'_, AppState>,
    count_id: String,
    manager_pin: Option<String>,
) -> Result<StockCountDto, ApiError> {
    let actor = state.require_write_session()?;
    stock_counts::post_stock_count(&state.db, &actor, &count_id, manager_pin)
}

#[tauri::command]
#[specta::specta]
pub fn list_stock_counts(
    state: State<'_, AppState>,
) -> Result<Vec<StockCountSummaryDto>, ApiError> {
    let _actor = state.require_session()?;
    stock_counts::list_stock_counts(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn get_stock_count(
    state: State<'_, AppState>,
    id: String,
) -> Result<StockCountDto, ApiError> {
    let _actor = state.require_session()?;
    stock_counts::get_stock_count(&state.db, &id)
}

// ── Financial & Stock Reports (Phase B6) ─────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn get_stock_valuation_report(
    state: State<'_, AppState>,
) -> Result<StockValuationReportDto, ApiError> {
    let _actor = state.require_session()?;
    reports::get_stock_valuation_report(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn get_consumption_report(
    state: State<'_, AppState>,
    filter: DateRangeFilter,
) -> Result<Vec<ConsumptionByDeptRow>, ApiError> {
    let _actor = state.require_session()?;
    reports::get_consumption_report(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn get_procurement_spend_report(
    state: State<'_, AppState>,
    filter: DateRangeFilter,
) -> Result<Vec<ProcurementSpendRow>, ApiError> {
    let _actor = state.require_session()?;
    reports::get_procurement_spend_report(&state.db, filter)
}

#[tauri::command]
#[specta::specta]
pub fn get_weekly_stock_sheet(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
) -> Result<WeeklyStockSheetReportDto, ApiError> {
    let _actor = state.require_session()?;
    reports::get_weekly_stock_sheet(&state.db, &start_date, &end_date)
}

#[tauri::command]
#[specta::specta]
pub fn export_weekly_stock_sheet_xlsx(
    state: State<'_, AppState>,
    start_date: String,
    end_date: String,
    output_path: String,
) -> Result<String, ApiError> {
    let actor = state.require_session()?;
    auth::require_operator(&actor)?;
    let resolved = resolve_output_excel_path(&state, &output_path);
    stock_sheet_xlsx::export_weekly_stock_sheet_xlsx(
        &state.db,
        &start_date,
        &end_date,
        &resolved,
    )
}

// ── Backups & Offline Licence (Phase B7) ─────────────────────────────────────

#[tauri::command]
#[specta::specta]
pub fn create_backup(state: State<'_, AppState>) -> Result<BackupFileDto, ApiError> {
    let actor = state.require_session()?;
    auth::require_operator(&actor)?;
    backup::create_backup(&state.db, &state.paths.backups_dir, "manual", 30)
}

#[tauri::command]
#[specta::specta]
pub fn list_backups(state: State<'_, AppState>) -> Result<Vec<BackupFileDto>, ApiError> {
    let _actor = state.require_session()?;
    backup::list_backups(&state.paths.backups_dir)
}

#[tauri::command]
#[specta::specta]
pub fn restore_backup(
    state: State<'_, AppState>,
    backup_path: String,
) -> Result<IntegrityReport, ApiError> {
    let resolved_str = resolve_input_excel_path(&state, &backup_path)?;
    let resolved = Path::new(&resolved_str);

    let report = if let Some(actor) = state.current_session()? {
        let rep = backup::restore_backup(&state.db, &state.paths.backups_dir, &actor, resolved)?;
        // If restored database no longer contains the currently logged-in user, clear session so Login appears cleanly
        let still_exists: i64 = state
            .db
            .with_read(|conn| {
                conn.query_row(
                    "SELECT COUNT(*) FROM users WHERE id = ?1 AND is_active = 1",
                    [&actor.id],
                    |r| r.get(0),
                )
                .map_err(Into::into)
            })
            .unwrap_or(0);
        if still_exists == 0 {
            let _ = state.set_session(None);
        }
        rep
    } else {
        backup::restore_backup_for_onboarding(&state.db, &state.paths.backups_dir, resolved)?
    };

    state.invalidate_license_cache();
    Ok(report)
}

#[tauri::command]
#[specta::specta]
pub fn export_backup_file(
    state: State<'_, AppState>,
    output_path: String,
) -> Result<String, ApiError> {
    let actor = state.require_session()?;
    auth::require_operator(&actor)?;
    let created = backup::create_backup(&state.db, &state.paths.backups_dir, "manual", 30)?;
    let dest = resolve_output_excel_path(&state, &output_path);
    std::fs::copy(&created.path, &dest).map_err(|e| {
        ApiError::internal(format!(
            "Failed to copy backup file to {}: {e}",
            dest.display()
        ))
    })?;
    Ok(dest.to_string_lossy().into_owned())
}

#[tauri::command]
#[specta::specta]
pub fn get_license_status(state: State<'_, AppState>) -> Result<LicenseStatusDto, ApiError> {
    license::get_license_status(&state.db)
}

#[tauri::command]
#[specta::specta]
pub fn activate_license(
    state: State<'_, AppState>,
    license_key: String,
) -> Result<LicenseStatusDto, ApiError> {
    let actor = state.require_session()?;
    let status = license::activate_license(&state.db, &actor, &license_key)?;
    state.invalidate_license_cache();
    Ok(status)
}
