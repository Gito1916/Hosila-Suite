use serde::{Deserialize, Serialize};
use specta::Type;

use crate::error::{ApiError, AppResult};
use crate::paths::RunMode;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct IntegrityReport {
    pub ok: bool,
    pub sqlite_quick_check: String,
    pub ledger_mismatches: i32,
    pub checked_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SystemInfo {
    pub app_version: String,
    pub run_mode: RunMode,
    pub db_path: String,
    pub is_network_path: bool,
    pub schema_version: i32,
    pub needs_onboarding: bool,
    pub user_count: i32,
    pub item_count: i32,
    pub unit_count: i32,
    pub integrity: IntegrityReport,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum UserRole {
    Admin,
    Storekeeper,
    Viewer,
}

impl UserRole {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Admin => "admin",
            Self::Storekeeper => "storekeeper",
            Self::Viewer => "viewer",
        }
    }

    pub fn parse(raw: &str) -> AppResult<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "admin" => Ok(Self::Admin),
            "storekeeper" => Ok(Self::Storekeeper),
            "viewer" => Ok(Self::Viewer),
            other => Err(ApiError::validation(format!("Invalid user role: '{other}'"))),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SessionUser {
    pub id: String,
    pub username: String,
    pub full_name: String,
    pub role: UserRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UserDto {
    pub id: String,
    pub username: String,
    pub full_name: String,
    pub role: UserRole,
    pub is_active: bool,
    pub has_pin: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateUserInput {
    pub username: String,
    pub full_name: String,
    pub password: String,
    pub pin: Option<String>,
    pub role: UserRole,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateUserInput {
    pub full_name: Option<String>,
    pub role: Option<UserRole>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LoginInput {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct PinLoginInput {
    pub username: String,
    pub pin: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ManagerApprovalDto {
    pub manager_user_id: String,
    pub manager_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BusinessProfile {
    pub name: String,
    pub legal_name: String,
    pub address: String,
    pub phone: String,
    pub email: String,
    pub currency_symbol: String,
    pub currency_code: String,
    pub date_format: String,
    pub logo_data_url: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InventoryRules {
    pub allow_negative_stock: bool,
    pub costing_method: String,
    pub require_storekeeper_pin_on_issue: bool,
    #[specta(type = specta_typescript::Number)]
    pub require_manager_pin_above_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AppearanceSettings {
    pub theme: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AllSettingsDto {
    pub business_profile: BusinessProfile,
    pub inventory_rules: InventoryRules,
    pub appearance: AppearanceSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DepartmentDto {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort_order: i32,
    pub is_active: bool,
    pub staff_count: i32,
    pub item_count: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateDepartmentInput {
    pub name: String,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateDepartmentInput {
    pub name: Option<String>,
    pub color: Option<String>,
    pub sort_order: Option<i32>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StoreSectionDto {
    pub id: String,
    pub name: String,
    pub sort_order: i32,
    pub is_active: bool,
    pub item_count: i32,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateStoreSectionInput {
    pub name: String,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateStoreSectionInput {
    pub name: Option<String>,
    pub sort_order: Option<i32>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OnboardingInput {
    pub business_profile: BusinessProfile,
    pub admin_username: String,
    pub admin_full_name: String,
    pub admin_password: String,
    pub admin_pin: Option<String>,
    pub departments: Vec<CreateDepartmentInput>,
    pub store_sections: Vec<CreateStoreSectionInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct StaffFilter {
    pub department_id: Option<String>,
    pub store_staff_only: bool,
    pub include_inactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StaffDto {
    pub id: String,
    pub full_name: String,
    pub staff_code: Option<String>,
    pub phone: Option<String>,
    pub is_store_staff: bool,
    pub is_active: bool,
    pub department_ids: Vec<String>,
    pub department_names: Vec<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateStaffInput {
    pub full_name: String,
    pub staff_code: Option<String>,
    pub phone: Option<String>,
    pub is_store_staff: bool,
    pub department_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateStaffInput {
    pub full_name: Option<String>,
    pub staff_code: Option<String>,
    pub phone: Option<String>,
    pub is_store_staff: Option<bool>,
    pub is_active: Option<bool>,
    pub department_ids: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UnitDto {
    pub id: String,
    pub code: String,
    pub name: String,
    pub plural: String,
    pub dimension: String,
    pub allows_decimals: bool,
    #[specta(type = specta_typescript::Number)]
    pub factor_to_dim_base_milli: i64,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateUnitInput {
    pub code: String,
    pub name: String,
    pub plural: String,
    pub dimension: String,
    pub allows_decimals: bool,
    #[specta(type = specta_typescript::Number)]
    pub factor_to_dim_base_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateUnitInput {
    pub name: Option<String>,
    pub plural: Option<String>,
    pub allows_decimals: Option<bool>,
    #[specta(type = specta_typescript::Number)]
    pub factor_to_dim_base_milli: Option<i64>,
}

// ── Phase B2: Suppliers, Items & UoM ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SupplierDto {
    pub id: String,
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub is_active: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateSupplierInput {
    pub name: String,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateSupplierInput {
    pub name: Option<String>,
    pub phone: Option<String>,
    pub email: Option<String>,
    pub notes: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemUnitInput {
    pub unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    pub can_purchase: bool,
    pub can_issue: bool,
    pub label_override: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemUnitDto {
    pub id: String,
    pub unit_id: String,
    pub unit_code: String,
    pub unit_name: String,
    pub unit_plural: String,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    pub can_purchase: bool,
    pub can_issue: bool,
    pub label_override: Option<String>,
    pub is_unusual_factor: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum StockStatus {
    Healthy,
    LowStock,
    OutOfStock,
}

impl StockStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Healthy => "healthy",
            Self::LowStock => "low_stock",
            Self::OutOfStock => "out_of_stock",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct ItemFilter {
    pub search: Option<String>,
    pub department_id: Option<String>,
    pub store_section_id: Option<String>,
    pub status: Option<StockStatus>,
    pub cost_missing_only: bool,
    pub returnable_only: bool,
    pub include_inactive: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemListRowDto {
    pub id: String,
    pub sku: String,
    pub name: String,
    pub description: Option<String>,
    pub base_unit_id: String,
    pub base_unit_code: String,
    pub base_unit_name: String,
    pub base_unit_plural: String,
    pub display_unit_id: String,
    pub default_issue_unit_id: String,
    pub default_purchase_unit_id: String,
    pub store_section_id: Option<String>,
    pub store_section_name: Option<String>,
    pub department_ids: Vec<String>,
    pub department_names: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub on_hand_milli: i64,
    pub display_stock: String,
    #[specta(type = specta_typescript::Number)]
    pub avg_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub last_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub stock_value_minor: i64,
    pub cost_missing: bool,
    pub is_returnable: bool,
    #[specta(type = specta_typescript::Number)]
    pub reorder_point_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub par_level_milli: i64,
    pub stock_status: StockStatus,
    pub storage_location: Option<String>,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub is_active: bool,
    pub item_units: Vec<ItemUnitDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StockMovementDto {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub movement_type: String,
    #[specta(type = specta_typescript::Number)]
    pub qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub balance_after_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub value_minor: i64,
    pub department_id: Option<String>,
    pub department_name: Option<String>,
    pub doc_type: String,
    pub doc_id: String,
    pub doc_number: String,
    pub input_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    pub actor_name: String,
    pub counterparty_staff_name: Option<String>,
    pub storekeeper_staff_name: Option<String>,
    pub business_date: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ItemDetailDto {
    pub item: ItemListRowDto,
    pub aliases: Vec<String>,
    pub has_movements: bool,
    pub recent_movements: Vec<StockMovementDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateItemInput {
    pub sku: Option<String>,
    pub name: String,
    pub description: Option<String>,
    pub base_unit_id: String,
    pub display_unit_id: Option<String>,
    pub default_issue_unit_id: Option<String>,
    pub default_purchase_unit_id: Option<String>,
    pub store_section_id: Option<String>,
    pub department_ids: Vec<String>,
    pub item_units: Vec<ItemUnitInput>,
    #[specta(type = specta_typescript::Number)]
    pub reorder_point_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub par_level_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub initial_unit_cost_micro: i64,
    pub cost_missing: bool,
    pub is_returnable: bool,
    #[specta(type = specta_typescript::Number)]
    pub opening_stock_milli: i64,
    pub opening_date: Option<String>,
    pub supplier_id: Option<String>,
    pub storage_location: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateItemInput {
    pub name: Option<String>,
    pub description: Option<String>,
    pub display_unit_id: Option<String>,
    pub default_issue_unit_id: Option<String>,
    pub default_purchase_unit_id: Option<String>,
    pub store_section_id: Option<String>,
    pub clear_store_section: Option<bool>,
    pub department_ids: Option<Vec<String>>,
    pub item_units: Option<Vec<ItemUnitInput>>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub reorder_point_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub par_level_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub unit_cost_micro: Option<i64>,
    pub cost_missing: Option<bool>,
    pub is_returnable: Option<bool>,
    pub supplier_id: Option<String>,
    pub clear_supplier: Option<bool>,
    pub storage_location: Option<String>,
    pub is_active: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ChangeBaseUnitInput {
    pub new_base_unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub conversion_factor_milli: i64,
    pub reason: String,
}

// ── Phase B3: Collections & Returns ─────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionLineInput {
    pub item_id: String,
    pub unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub quantity_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateCollectionInput {
    pub department_id: String,
    pub collector_staff_id: String,
    pub storekeeper_staff_id: String,
    pub collection_date: Option<String>,
    pub notes: Option<String>,
    #[serde(default)]
    pub storekeeper_pin: Option<String>,
    pub lines: Vec<CollectionLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionLineValidationDto {
    pub item_id: String,
    pub item_name: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub base_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub available_base_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub remaining_after_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub line_value_minor: i64,
    pub is_returnable: bool,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionValidationDto {
    pub valid: bool,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub lines: Vec<CollectionLineValidationDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionLineDto {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub unit_id: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub base_qty_milli: i64,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub line_value_minor: i64,
    pub is_returnable: bool,
    #[specta(type = specta_typescript::Number)]
    pub returned_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub damaged_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub outstanding_qty_milli: i64,
    pub return_status: String,
    pub returned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CollectionDto {
    pub id: String,
    pub number: String,
    pub department_id: String,
    pub department_name: String,
    pub collector_staff_id: String,
    pub collector_name: String,
    pub storekeeper_staff_id: String,
    pub storekeeper_name: String,
    pub created_by_name: String,
    pub collection_date: String,
    pub notes: Option<String>,
    pub status: String,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub posted_at: String,
    pub lines: Vec<CollectionLineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct CollectionFilter {
    pub department_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct OutstandingReturnDto {
    pub collection_line_id: String,
    pub collection_id: String,
    pub collection_number: String,
    pub collection_date: String,
    pub department_id: String,
    pub department_name: String,
    pub collector_staff_id: String,
    pub collector_name: String,
    pub storekeeper_name: String,
    pub item_id: String,
    pub item_name: String,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub checked_out_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub returned_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub damaged_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub outstanding_milli: i64,
    pub return_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct RecordReturnInput {
    pub collection_line_id: String,
    #[specta(type = specta_typescript::Number)]
    pub returned_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub damaged_qty_milli: i64,
    pub return_date: Option<String>,
    pub storekeeper_staff_id: String,
    pub notes: Option<String>,
}

// ── Phase B4a: Weekly-Sheet Excel Importer ──────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklySheetImportOptions {
    pub file_path: String,
    pub sheet_name: Option<String>,
    pub opening_date: String,
    pub purchase_date: String,
    pub profile: String,
    #[serde(default)]
    pub excluded_row_numbers: Option<Vec<i32>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklySheetPreviewRow {
    pub row_number: i32,
    pub department: String,
    pub store_section: Option<String>,
    pub item_name: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub opening_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub purchase_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub issued_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub closing_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub closing_value_minor: i64,
    pub cost_missing: bool,
    pub shared_departments: Vec<String>,
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklySheetImportPreview {
    pub sheet_name: String,
    pub available_sheets: Vec<String>,
    pub total_items: i32,
    pub cost_missing_count: i32,
    #[specta(type = specta_typescript::Number)]
    pub total_closing_value_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_purchase_value_minor: i64,
    pub warnings: Vec<String>,
    pub rows: Vec<WeeklySheetPreviewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklySheetImportResult {
    pub import_run_id: String,
    pub items_created: i32,
    pub items_updated: i32,
    #[specta(type = specta_typescript::Number)]
    pub total_closing_value_minor: i64,
    pub cost_missing_count: i32,
    pub warnings: Vec<String>,
}

// ── Phase B4b: Procurement & Receipts (GRN) ─────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ExtraChargeDto {
    pub label: String,
    #[specta(type = specta_typescript::Number)]
    pub amount_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct GenerateProcurementDraftInput {
    pub scope: String,
    pub department_ids: Vec<String>,
    pub custom_item_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementDraftLineDto {
    pub item_id: String,
    pub item_name: String,
    pub sku: String,
    pub section_label: String,
    pub unit_id: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub on_hand_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub par_level_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub suggested_qty_milli: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub est_unit_cost_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementLineInput {
    pub item_id: String,
    pub section_label: String,
    pub buyer_name: Option<String>,
    pub unit_id: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub ordered_qty_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub est_unit_cost_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub budget_amount_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateProcurementListInput {
    pub title: String,
    pub scope: String,
    pub department_ids: Vec<String>,
    pub extra_charges: Vec<ExtraChargeDto>,
    pub lines: Vec<ProcurementLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateProcurementListInput {
    pub title: Option<String>,
    pub status: Option<String>,
    pub extra_charges: Option<Vec<ExtraChargeDto>>,
    pub lines: Option<Vec<ProcurementLineInput>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementLineDto {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub base_unit_code: String,
    pub section_label: String,
    pub buyer_name: Option<String>,
    pub unit_id: Option<String>,
    pub unit_code: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub suggested_qty_milli: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub ordered_qty_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub est_unit_cost_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub budget_amount_minor: Option<i64>,
    #[specta(type = specta_typescript::Number)]
    pub received_qty_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementListSummaryDto {
    pub id: String,
    pub number: String,
    pub title: String,
    pub scope: String,
    pub department_ids: Vec<String>,
    pub status: String,
    pub prepared_by_name: String,
    pub line_count: i32,
    #[specta(type = specta_typescript::Number)]
    pub estimated_total_minor: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementListDto {
    pub id: String,
    pub number: String,
    pub title: String,
    pub scope: String,
    pub department_ids: Vec<String>,
    pub status: String,
    pub prepared_by_name: String,
    pub extra_charges: Vec<ExtraChargeDto>,
    pub lines: Vec<ProcurementLineDto>,
    #[specta(type = specta_typescript::Number)]
    pub estimated_total_minor: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReceiptLineInput {
    pub procurement_line_id: Option<String>,
    pub item_id: String,
    pub unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub line_total_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateReceiptInput {
    pub procurement_list_id: Option<String>,
    pub supplier_id: Option<String>,
    pub invoice_ref: Option<String>,
    pub received_by_staff_id: String,
    pub approved_by_staff_id: String,
    pub received_at: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub disbursement_minor: Option<i64>,
    pub extra_charges: Vec<ExtraChargeDto>,
    pub notes: Option<String>,
    pub lines: Vec<ReceiptLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReceiptLineDto {
    pub id: String,
    pub procurement_line_id: Option<String>,
    pub item_id: String,
    pub item_name: String,
    pub unit_id: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub base_qty_milli: i64,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub line_total_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ReceiptDto {
    pub id: String,
    pub number: String,
    pub procurement_list_id: Option<String>,
    pub supplier_id: Option<String>,
    pub supplier_name: Option<String>,
    pub invoice_ref: Option<String>,
    pub source_type: String,
    pub source_filename: Option<String>,
    pub received_by_staff_id: Option<String>,
    pub received_by_name: String,
    pub approved_by_staff_id: Option<String>,
    pub approved_by_name: String,
    pub posted_by_name: String,
    pub received_at: String,
    #[specta(type = Option<specta_typescript::Number>)]
    pub disbursement_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub actual_expense_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub refunded_minor: Option<i64>,
    pub extra_charges: Vec<ExtraChargeDto>,
    #[specta(type = specta_typescript::Number)]
    pub total_minor: i64,
    pub notes: Option<String>,
    pub status: String,
    pub created_at: String,
    pub lines: Vec<ReceiptLineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct ReceiptFilter {
    pub procurement_list_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub status: Option<String>,
    pub limit: Option<i32>,
}

// ── Phase B5: Built-In Rust Procurement List Parser ─────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WorkbookSheetSummary {
    pub name: String,
    pub row_count: i32,
    pub has_hosila_meta: bool,
    pub detected_buyer: Option<String>,
    pub detected_title: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type, PartialEq, Eq)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ParsedAnomalyCode {
    AmountMismatch,
    AmountOnly,
    UnitConversionNeeded,
    UnmatchedItem,
    PriceJump,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ParsedMatchCandidate {
    pub item_id: String,
    pub item_name: String,
    pub base_unit_code: String,
    pub score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ParsedProcurementLineDto {
    pub row_key: String,
    pub sheet_name: String,
    pub excel_row: i32,
    pub section_label: String,
    pub raw_description: String,
    pub raw_unit: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub raw_qty_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub raw_unit_price_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub raw_amount_minor: Option<i64>,
    pub match_status: String,
    pub matched_item_id: Option<String>,
    pub matched_item_name: Option<String>,
    pub matched_base_unit_id: Option<String>,
    pub matched_base_unit_code: Option<String>,
    pub resolved_unit_id: Option<String>,
    pub resolved_unit_code: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub resolved_factor_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub suggested_unit_cost_minor: Option<i64>,
    pub procurement_line_id: Option<String>,
    pub anomalies: Vec<ParsedAnomalyCode>,
    pub anomaly_messages: Vec<String>,
    pub candidates: Vec<ParsedMatchCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ParsedProcurementDraft {
    pub filename: String,
    pub tier: String,
    pub linked_procurement_list_id: Option<String>,
    pub parsed_sheets: Vec<String>,
    pub lines: Vec<ParsedProcurementLineDto>,
    pub extra_charges: Vec<ExtraChargeDto>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub disbursement_minor: Option<i64>,
    pub ready_count: i32,
    pub needs_attention_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfirmParsedLineInput {
    pub raw_description: String,
    pub action: String,
    pub item_id: Option<String>,
    pub new_item_name: Option<String>,
    pub new_item_department_id: Option<String>,
    pub unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub quantity_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub line_total_minor: i64,
    pub procurement_line_id: Option<String>,
    pub save_alias: bool,
    pub save_unit_conversion: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConfirmParsedRestockInput {
    pub filename: String,
    pub procurement_list_id: Option<String>,
    pub supplier_id: Option<String>,
    pub invoice_ref: Option<String>,
    pub received_by_staff_id: String,
    pub approved_by_staff_id: String,
    pub received_at: Option<String>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub disbursement_minor: Option<i64>,
    pub extra_charges: Vec<ExtraChargeDto>,
    pub notes: Option<String>,
    pub lines: Vec<ConfirmParsedLineInput>,
}

// ── Phase B6: Dashboard, Activity, Adjustments, Stock Counts & Reports ──────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DashboardKpisDto {
    #[specta(type = specta_typescript::Number)]
    pub total_inventory_value_minor: i64,
    pub total_active_items: i32,
    pub low_stock_count: i32,
    pub out_of_stock_count: i32,
    pub cost_missing_count: i32,
    #[specta(type = specta_typescript::Number)]
    pub consumed_today_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub received_today_minor: i64,
    pub outstanding_returns_count: i32,
    pub open_procurement_lists_count: i32,
    pub as_of_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DepartmentConsumptionPoint {
    pub department_id: String,
    pub department_name: String,
    pub department_color: String,
    #[specta(type = specta_typescript::Number)]
    pub consumed_minor: i64,
    pub issue_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DailyConsumptionPoint {
    pub date: String,
    #[specta(type = specta_typescript::Number)]
    pub consumed_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub received_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct ActivityFeedFilter {
    pub action_prefix: Option<String>,
    pub entity: Option<String>,
    pub user_id: Option<String>,
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub limit: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ActivityLogDto {
    pub id: String,
    pub at: String,
    pub user_id: Option<String>,
    pub user_name: Option<String>,
    pub action: String,
    pub entity: String,
    pub entity_id: String,
    pub summary: String,
    #[specta(type = specta_typescript::Unknown)]
    pub meta: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AdjustmentLineInput {
    pub item_id: String,
    pub unit_id: String,
    #[specta(type = specta_typescript::Number)]
    pub delta_qty_milli: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct CreateAdjustmentInput {
    pub reason: String,
    pub notes: String,
    pub adjustment_date: Option<String>,
    pub manager_pin: Option<String>,
    pub lines: Vec<AdjustmentLineInput>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AdjustmentLineDto {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub unit_id: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub input_qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub factor_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub base_qty_milli: i64,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct AdjustmentDto {
    pub id: String,
    pub number: String,
    pub reason: String,
    pub notes: String,
    pub posted_by_name: String,
    pub approved_by_name: Option<String>,
    pub adjustment_date: String,
    pub posted_at: String,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub lines: Vec<AdjustmentLineDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
pub struct StartStockCountInput {
    pub department_ids: Vec<String>,
    pub store_section_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct UpdateStockCountLineInput {
    pub line_id: String,
    #[specta(type = Option<specta_typescript::Number>)]
    pub counted_qty_milli: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StockCountLineDto {
    pub id: String,
    pub item_id: String,
    pub item_name: String,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub system_qty_milli: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub counted_qty_milli: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub variance_milli: Option<i64>,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub variance_value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StockCountSummaryDto {
    pub id: String,
    pub number: String,
    pub status: String,
    pub started_by_name: String,
    pub started_at: String,
    pub posted_by_name: Option<String>,
    pub posted_at: Option<String>,
    pub total_lines: i32,
    pub counted_lines: i32,
    #[specta(type = specta_typescript::Number)]
    pub net_variance_value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StockCountDto {
    pub id: String,
    pub number: String,
    pub status: String,
    pub scope_department_ids: Vec<String>,
    pub scope_section_ids: Vec<String>,
    pub started_by_name: String,
    pub started_at: String,
    pub posted_by_name: Option<String>,
    pub posted_at: Option<String>,
    pub lines: Vec<StockCountLineDto>,
    #[specta(type = specta_typescript::Number)]
    pub net_variance_value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DateRangeFilter {
    pub start_date: String,
    pub end_date: String,
    pub department_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DepartmentValuationRow {
    pub department_id: String,
    pub department_name: String,
    pub section_name: Option<String>,
    pub item_count: i32,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub cost_missing_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct StockValuationReportDto {
    pub as_of_date: String,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub total_items: i32,
    pub cost_missing_count: i32,
    pub by_department: Vec<DepartmentValuationRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConsumptionByDeptRow {
    pub department_id: String,
    pub department_name: String,
    pub item_id: String,
    pub item_name: String,
    pub base_unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub qty_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub value_minor: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ProcurementSpendRow {
    pub receipt_id: String,
    pub receipt_number: String,
    pub received_at: String,
    pub supplier_name: Option<String>,
    pub source_type: String,
    #[specta(type = specta_typescript::Number)]
    pub lines_total_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub extra_charges_minor: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_minor: i64,
    #[specta(type = Option<specta_typescript::Number>)]
    pub disbursement_minor: Option<i64>,
    #[specta(type = Option<specta_typescript::Number>)]
    pub refunded_minor: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklyStockSheetRowDto {
    pub section_label: String,
    pub item_id: String,
    pub item_name: String,
    pub unit_code: String,
    #[specta(type = specta_typescript::Number)]
    pub opening_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub purchase_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub available_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub issued_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub closing_milli: i64,
    #[specta(type = specta_typescript::Number)]
    pub unit_cost_micro: i64,
    #[specta(type = specta_typescript::Number)]
    pub total_value_minor: i64,
    pub cost_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct WeeklyStockSheetReportDto {
    pub start_date: String,
    pub end_date: String,
    pub rows: Vec<WeeklyStockSheetRowDto>,
    #[specta(type = specta_typescript::Number)]
    pub grand_total_minor: i64,
}

// ── Phase B7: Backups & Offline Licence ──────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct BackupFileDto {
    pub filename: String,
    pub path: String,
    #[specta(type = specta_typescript::Number)]
    pub size_bytes: i64,
    pub created_at: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct LicenseStatusDto {
    pub state: String,
    pub machine_fingerprint: String,
    pub licensed_to: Option<String>,
    pub edition: Option<String>,
    pub activated_at: Option<String>,
    pub trial_days_remaining: i32,
    pub is_read_only: bool,
    pub message: String,
}
