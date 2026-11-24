# Hosila IMS — Backend ↔ Frontend Contract (vFinal — Phases B0–B7)

> **Backend Owner:** `crates/hosila-core`, `src-tauri` (Complete & Verified through Phase B7)  
> **Frontend Consumer:** `src/` (Gemini — Phases F0–F6)  
> **Source of Truth TypeScript Client:** [`bindings/bindings.ts`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/bindings/bindings.ts) (84 commands auto-generated via `tauri-specta`)

---

## 1. Using Typed Commands & Return Envelopes

Import commands and DTO types directly from `../bindings/bindings` — never hand-write IPC strings or interface clones:

```ts
import {
  commands,
  type ApiError_Serialize,
  type ItemListRowDto_Serialize,
  type DashboardKpisDto,
} from "../bindings/bindings";

const res = await commands.getDashboardKpis(null);
if (res.status === "ok") {
  // res.data is DashboardKpisDto
  console.log(res.data.total_inventory_value_minor);
} else {
  // res.error is ApiError_Serialize { code, message, field, meta }
  console.error(res.error.code, res.error.message, res.error.field, res.error.meta);
}
```

### Important: `*_Deserialize` (Inputs) vs `*_Serialize` (Outputs) Split Types
Because structs with optional fields (`Option<T>`) serialize unconditionally as `T | null` on responses while accepting omitted keys (`field?: T | null`) on inputs, `tauri-specta` generates paired types:
- **Pass `*_Deserialize`** (or omit optional keys) for command **inputs** (e.g., `ItemFilter_Deserialize`, `UpdateItemInput_Deserialize`, `ActivityFeedFilter_Deserialize`).
- **Consume `*_Serialize`** on state/props for command **outputs** (e.g., `ItemListRowDto_Serialize`, `ReceiptDto_Serialize`, `ParsedProcurementDraft_Serialize`).
- Union aliases like `export type ItemFilter = ItemFilter_Serialize | ItemFilter_Deserialize` are also exported.

### Regenerating `bindings/bindings.ts`
If any Rust command or DTO changes:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
cargo test --workspace
```
Debug runs (`pnpm tauri dev`) also refresh `bindings/bindings.ts` on startup.

---

## 2. Exact Integer Scaling & Accounting Rules

No floating-point numbers are stored for stock quantities, costs, or money. The frontend must format and scale cleanly at input/display boundaries:

| Domain Concept | Scaling Factor | UI Display Format | Examples |
| --- | --- | --- | --- |
| **Stock / Line Quantities** (`*_milli`) | `× 1,000` (milli-units) | Decimals trimmed + `tabular-nums` | `2.5` → `2500`, `12` → `12000` |
| **UoM Conversion Factors** (`factor_milli`) | `× 1,000` | Ratio label (`1 PACK = 12 BTL`) | `24` → `24000`, `12.5` → `12500` |
| **Currency Totals / Lines / Prices** (`*_minor`) | `× 100` (kobo) | `₦1,500.00` + `tabular-nums` | `₦1,500.00` → `150000` |
| **Per-Base-Unit Costs** (`*_micro`) | `× 1,000,000` (micro-naira) | Divide by `1_000_000` (`₦0.00`) | `₦1,500.00/unit` → `1500000000` |

### Signed vs Unsigned Value Fields
- **`AdjustmentDto.total_value_minor`** and **`AdjustmentLineDto.value_minor`** are **signed**: wastage/spoilage losses return negative values (e.g., `-300000` for `-₦3,000.00`), while `found` gains return positive values.
- **`StockCountDto.net_variance_value_minor`** and **`StockCountLineDto.variance_value_minor`** are **signed**: shortages are negative, overages are positive.
- **Collection**, **Procurement**, and **Receipt** values (`total_minor`, `line_value_minor`) are positive totals; **`ReceiptDto.refunded_minor`** equals `disbursement_minor - actual_expense_minor` (negative if buyer spent out-of-pocket above disbursement).

---

## 3. Error Envelope & `ErrorCode` Catalog

Every failed command returns `{ status: "error", error: ApiError_Serialize }`:
```ts
type ApiError_Serialize = {
  code: ErrorCode;
  message: string;       // Plain-language message safe to render inline/toast
  field: string | null;  // Optional form field target (e.g., "password", "lines", "manager_pin")
  meta: unknown | null;  // Structured error context
};
```

Complete `ErrorCode` enum values:
- `VALIDATION_ERROR` — invalid field format, empty required notes, missing date (`YYYY-MM-DD`), or business rule constraint.
- `NOT_FOUND` — record or uploaded `.xlsx` / `.db` file path not found.
- `CONFLICT` — duplicate name/SKU/code, invalid status transition, or onboarding already completed.
- `UNAUTHORIZED` — invalid login credentials, bad manager PIN, or no active login session.
- `FORBIDDEN` — insufficient user role (`admin` vs `storekeeper` vs `viewer`) or missing Manager PIN above `require_manager_pin_above_minor`.
- `INSUFFICIENT_STOCK` — hard block preventing issuing/adjusting more than stock on hand (`meta: { item_name, available, requested }`).
- `BASE_UNIT_LOCKED` — item already has ledger movements; changing base unit must use `changeItemBaseUnit(...)` rescale wizard.
- `UNIT_CONVERSION_NEEDED` — purchase/issue unit is in another dimension or incompatible count unit without an `item_units` factor configured.
- `DATABASE_ERROR` / `IO_ERROR` — SQLite or disk error.
- `IMPORT_ERROR` — malformed/empty `.xlsx` workbook or missing expected columns.
- `LICENSE_INVALID` — invalid Ed25519 signature, malformed `HSLA1.` token, expired licence, or workstation fingerprint mismatch.
- `INTERNAL_ERROR` — unexpected internal serialization/lock issue.

---

## 4. Roles, Manager PIN & Developer Seed

### Roles (`UserRole = "admin" | "storekeeper" | "viewer"`)
- **All authenticated users (`viewer`+)**: read/export/print views (Dashboard, Inventory, Activity Log, Reports, Procurement views, Licence status check).
- **`storekeeper`+**: write operations — Items/Suppliers/Procurement/Receipts/Collections/Returns/Adjustments/Stock Counts/Parser Confirmation.
- **`admin` only**: Onboarding, User/Password/PIN management, Business Profile & Inventory Rules, Org/Staff/Units CRUD, Weekly Sheet Bulk Seed Import, Restore Database Backup, Licence Activation.
- **Manager PIN Escalation**: Non-admin operators (`storekeeper`) must supply an Admin PIN (`managerPin` / `manager_pin`) when reversing collections/receipts or posting adjustments/stock-counts whose absolute value reaches `InventoryRules.require_manager_pin_above_minor` (default `5_000_000` kobo = `₦50,000.00`).

### `--dev-seed` Credentials (for Development Launch)
When started with `--dev-seed` (`pnpm tauri dev -- -- --dev-seed`), if `users` is empty the backend seeds:
- **Username:** `admin` · **Password:** `admin123` · **Manager PIN:** `1234` · **Role:** `admin`
- **Departments:** `Kitchen`, `F&B`, `Housekeeping`, `Maintenance`, `Store` + Store Section `Protein`
- **6 Staff** (`Chef John`, `Nina Okafor`, `Musa Ibrahim`, `Chinedu Eze`, and Storekeepers `Adaeze Storekeeper`, `Tunde Balogun`)
- **6 Multi-Scenario Demo Items**: `Pineapple` (shared F&B/Kitchen), `Beef` (`Protein` section, low stock), `Bottle Water` (`BTL` + `PACK=12`), `Egg` (`PCS` + `CRATE=30`, low stock), `2 Litre Electric Kettle` (`is_returnable=true`, Maintenance), `Bollinger 007` (out of stock + `cost_missing=true`)

---

## 5. Complete Command Reference (84 Commands)

> Note: All dates use `YYYY-MM-DD`. Every session-protected command other than `getSystemInfo`, `getLicenseStatus`, onboarding/login/logout, and `updateAppearance` requires an active user session (or `storekeeper`/`admin` role).

### 5.1 System & Integrity (2)
- `getSystemInfo()` → `SystemInfo` (`needs_onboarding`, `run_mode: "installed" | "portable"`, `db_path`, `is_network_path`, `schema_version`, `user_count`, `item_count`, `unit_count`, `integrity`)
- `runIntegrityCheck()` → `IntegrityReport` (`ok`, `sqlite_quick_check`, `ledger_mismatches`, `checked_at`)

### 5.2 Auth, Onboarding, Users & Manager PIN (11)
- `completeOnboarding(input: OnboardingInput_Deserialize)` → `SessionUser` (Admin only valid when `user_count === 0`)
- `login(input: LoginInput)` → `SessionUser`
- `loginWithPin(input: PinLoginInput)` → `SessionUser` (`username` + `pin`)
- `logout()` → `null`
- `getCurrentSession()` → `SessionUser | null`
- `verifyManagerPin(pin: string)` → `ManagerApprovalDto` (`{ manager_user_id, manager_name }`)
- `listUsers()` → `UserDto[]`
- `createUser(input: CreateUserInput_Deserialize)` → `UserDto` (Admin)
- `updateUser(id: string, input: UpdateUserInput_Deserialize)` → `UserDto` (Admin; protects last active Admin)
- `resetUserPassword(id: string, newPassword: string)` → `null` (Admin)
- `setUserPin(id: string, pin: string | null)` → `null` (Admin)

### 5.3 Settings (4)
- `getSettings()` → `AllSettingsDto_Serialize` (`business_profile`, `inventory_rules`, `appearance`)
- `updateBusinessProfile(profile: BusinessProfile_Deserialize)` → `BusinessProfile_Serialize` (Admin)
- `updateInventoryRules(rules: InventoryRules)` → `InventoryRules` (Admin)
- `updateAppearance(appearance: AppearanceSettings)` → `AppearanceSettings` (`theme: "light" | "dark" | "system"`)

### 5.4 Departments, Store Sections, Staff & Units of Measure (13)
- `listDepartments(includeInactive: boolean)` → `DepartmentDto[]`
- `createDepartment(input: CreateDepartmentInput_Deserialize)` → `DepartmentDto` (Admin)
- `updateDepartment(id: string, input: UpdateDepartmentInput_Deserialize)` → `DepartmentDto` (Admin)
- `listStoreSections(includeInactive: boolean)` → `StoreSectionDto[]`
- `createStoreSection(input: CreateStoreSectionInput_Deserialize)` → `StoreSectionDto` (Admin)
- `updateStoreSection(id: string, input: UpdateStoreSectionInput_Deserialize)` → `StoreSectionDto` (Admin)
- `listStaff(filter: StaffFilter_Deserialize)` → `StaffDto_Serialize[]` (`department_id`, `store_staff_only`, `include_inactive`)
- `createStaff(input: CreateStaffInput_Deserialize)` → `StaffDto_Serialize` (Admin)
- `updateStaff(id: string, input: UpdateStaffInput_Deserialize)` → `StaffDto_Serialize` (Admin)
- `listUnits()` → `UnitDto[]` (29 seeded system units + custom units)
- `createUnit(input: CreateUnitInput)` → `UnitDto` (Admin)
- `updateUnit(id: string, input: UpdateUnitInput_Deserialize)` → `UnitDto` (Admin)
- `deleteUnit(id: string)` → `null` (Admin; system units and units in use are protected)

### 5.5 Suppliers, Items & UoM Configuration (10)
- `listSuppliers(includeInactive: boolean)` → `SupplierDto_Serialize[]`
- `createSupplier(input: CreateSupplierInput_Deserialize)` → `SupplierDto_Serialize` (`storekeeper`+)
- `updateSupplier(id: string, input: UpdateSupplierInput_Deserialize)` → `SupplierDto_Serialize` (`storekeeper`+)
- `listItems(filter: ItemFilter_Deserialize)` → `ItemListRowDto_Serialize[]` (`search` uses FTS5, `department_id`, `store_section_id`, `status: "in_stock" | "low" | "out"`, `cost_missing_only`, `returnable_only`, `include_inactive`)
- `getItemDetail(id: string)` → `ItemDetailDto_Serialize` (`item`, `aliases`, `has_movements`, `recent_movements`)
- `getItemStockCard(itemId: string, startDate: string | null, endDate: string | null, limit: number | null)` → `StockMovementDto_Serialize[]`
- `createItem(input: CreateItemInput_Deserialize)` → `ItemListRowDto_Serialize` (`storekeeper`+; auto-generates `ITM-XXXXXX` if `sku` omitted; supports multi-department & `item_units`)
- `updateItem(id: string, input: UpdateItemInput_Deserialize)` → `ItemListRowDto_Serialize` (`storekeeper`+; note explicit `clear_store_section` / `clear_supplier` flags)
- `changeItemBaseUnit(id: string, input: ChangeBaseUnitInput)` → `ItemListRowDto_Serialize` (`storekeeper`+; rescales `on_hand_milli`, `reorder_point_milli`, `par_level_milli`, `avg_cost_micro`, `last_cost_micro`, and `item_units`)
- `archiveItem(id: string)` → `null` (`storekeeper`+)

### 5.6 Collections (Stock Issuing) & Returnable Items (7)
- `validateCollection(input: CreateCollectionInput_Deserialize)` → `CollectionValidationDto_Serialize` (live dry-run per-line remaining stock & `error` string)
- `createCollection(input: CreateCollectionInput_Deserialize)` → `CollectionDto_Serialize` (`storekeeper`+; hard `INSUFFICIENT_STOCK` block unless `allow_negative_stock`, supports back-dated `collection_date` e.g. `2026-11-09`)
- `listCollections(filter: CollectionFilter_Deserialize)` → `CollectionDto_Serialize[]`
- `getCollection(id: string)` → `CollectionDto_Serialize`
- `reverseCollection(id: string, reason: string, managerPin: string | null)` → `CollectionDto_Serialize`
- `listOutstandingReturns(departmentId: string | null, staffId: string | null)` → `OutstandingReturnDto[]`
- `recordReturn(input: RecordReturnInput_Deserialize)` → `CollectionDto_Serialize` (`returned_good_milli`, `damaged_milli`, `notes`)

### 5.7 Weekly Sheet Seed Importer — Phase B4a (2)
- `previewWeeklySheetImport(options: WeeklySheetImportOptions_Deserialize)` → `WeeklySheetImportPreview_Serialize` (`profile: "de_palms" | "generic"`, auto-deduplicates `PINEAPPLE` under `de_palms`, reads `WEEK 2` / any sheet)
- `commitWeeklySheetImport(options: WeeklySheetImportOptions_Deserialize)` → `WeeklySheetImportResult` (Admin; atomically creates catalog items, `Protein` section, shared depts, opening movements, and seed GRN)

### 5.8 Procurement Lists, Export & Print (7)
- `generateProcurementDraft(input: GenerateProcurementDraftInput)` → `ProcurementDraftLineDto_Serialize[]` (`scope: "low_stock" | "full" | "custom"`, orders via De Palms ranking: `KITCHEN` → `PROTEIN` → `F & B` → `HOUSEKEEPING` → `MAINTENANCE`)
- `createProcurementList(input: CreateProcurementListInput_Deserialize)` → `ProcurementListDto_Serialize`
- `updateProcurementList(id: string, input: UpdateProcurementListInput_Deserialize)` → `ProcurementListDto_Serialize` (`status: "draft" | "finalised" | "partial" | "received" | "closed"`, optional `buyer_name`, `extra_charges`)
- `getProcurementList(id: string)` → `ProcurementListDto_Serialize`
- `listProcurementLists(statusFilter: string | null)` → `ProcurementListSummaryDto[]`
- `exportProcurementXlsx(id: string, outputPath: string)` → `string` (writes master `"Procurement List"` sheet + per-buyer sheets + hidden `_hosila_meta` + A4 print setup)
- `renderProcurementPrintHtml(id: string)` → `string` (A4 portrait HTML5 print document for `window.print()` / WebView iframe print)

### 5.9 Goods Receipts / Manual Restocking (4)
- `createReceipt(input: CreateReceiptInput_Deserialize)` → `ReceiptDto_Serialize` (posts GRN, calculates Weighted Average Cost `avg_cost_micro`, clears `cost_missing`, computes disbursement/refund, updates linked `procurement_lines.received_qty_milli`)
- `listReceipts(filter: ReceiptFilter_Deserialize)` → `ReceiptDto_Serialize[]`
- `getReceipt(id: string)` → `ReceiptDto_Serialize`
- `reverseReceipt(id: string, reason: string, managerPin: string | null)` → `ReceiptDto_Serialize`

### 5.10 Built-In Rust Procurement Parser & Confirmation Gate — Phase B5 (3)
- `inspectProcurementWorkbook(filePath: string)` → `WorkbookSheetSummary_Serialize[]` (detects tabs, `_hosila_meta`, buyers, titles)
- `parseProcurementWorkbook(filePath: string, selectedSheets: string[])` → `ParsedProcurementDraft_Serialize` (`tier: "tier1_meta" | "tier2_heuristic"`, exact → `item_aliases` → Jaro-Winkler matching, 5 anomaly flags: `AMOUNT_MISMATCH`, `AMOUNT_ONLY`, `UNIT_CONVERSION_NEEDED`, `UNMATCHED_ITEM`, `PRICE_JUMP`)
- `confirmParsedRestock(input: ConfirmParsedRestockInput_Deserialize)` → `ReceiptDto_Serialize` (Storekeeper Confirmation Gate; supports `"map" | "create_new" | "skip"`, `save_alias`, `save_unit_conversion`, and atomic GRN posting)

### 5.11 Dashboard KPIs, Charts & Activity Feed (4)
- `getDashboardKpis(date: string | null)` → `DashboardKpisDto` (`total_inventory_value_minor`, `total_active_items`, `low_stock_count`, `out_of_stock_count`, `cost_missing_count`, `consumed_today_minor`, `received_today_minor`, `outstanding_returns_count`, `open_procurement_lists_count`, `as_of_date`)
- `getConsumptionByDepartment(startDate: string, endDate: string)` → `DepartmentConsumptionPoint[]`
- `getDailyConsumptionSeries(days: number)` → `DailyConsumptionPoint[]` (`1..=90` days padded chronologically)
- `listActivityLog(filter: ActivityFeedFilter_Deserialize)` → `ActivityLogDto_Serialize[]`

### 5.12 Stock Adjustments & Physical Stock Counts (7)
- `createAdjustment(input: CreateAdjustmentInput_Deserialize)` → `AdjustmentDto_Serialize` (`reason: "wastage" | "spoilage" | "damage" | "expired" | "found" | "count_correction"`, mandatory `notes`, negative-stock check, Manager PIN check above threshold)
- `listAdjustments(limit: number | null)` → `AdjustmentDto_Serialize[]`
- `startStockCount(input: StartStockCountInput)` → `StockCountDto_Serialize`
- `updateStockCountLines(countId: string, updates: UpdateStockCountLineInput_Deserialize[])` → `StockCountDto_Serialize`
- `postStockCount(countId: string, managerPin: string | null)` → `StockCountDto_Serialize` (reconciles live `on_hand_milli` variance via `'count'` movements)
- `listStockCounts()` → `StockCountSummaryDto_Serialize[]`
- `getStockCount(id: string)` → `StockCountDto_Serialize`

### 5.13 Reports & Weekly Stock Sheet Export (5)
- `getStockValuationReport()` → `StockValuationReportDto_Serialize` (valuation breakdown by department + store section)
- `getConsumptionReport(filter: DateRangeFilter_Deserialize)` → `ConsumptionByDeptRow[]`
- `getProcurementSpendReport(filter: DateRangeFilter_Deserialize)` → `ProcurementSpendRow_Serialize[]`
- `getWeeklyStockSheet(startDate: string, endDate: string)` → `WeeklyStockSheetReportDto` (`OPENING + PURCHASE = AVAILABLE`, `AVAILABLE - ISSUED = CLOSING`, `CLOSING × UNIT_COST = TOTAL_VALUE`)
- `exportWeeklyStockSheetXlsx(startDate: string, endDate: string, outputPath: string)` → `string` (A4 landscape Excel workbook with live formulas)

### 5.14 Hot SQLite Backups & Offline Ed25519 Licence (5)
- `createBackup()` → `BackupFileDto` (hot online SQLite backup + `PRAGMA quick_check`, keeps last 30 manual backups; daily auto-backup runs automatically at startup)
- `listBackups()` → `BackupFileDto[]` (`kind: "manual" | "auto" | "pre_restore"`)
- `restoreBackup(backupPath: string)` → `IntegrityReport` (Admin; validates archive, saves `pre_restore` snapshot first, restores live DB, returns `IntegrityReport`)
- `getLicenseStatus()` → `LicenseStatusDto_Serialize` (`state: "licensed" | "trial" | "trial_expired" | "invalid"`, `machine_fingerprint`, `trial_days_remaining`, `is_read_only`, `message`)
- `activateLicense(licenseKey: string)` → `LicenseStatusDto_Serialize` (Admin; verifies `HSLA1.*` Ed25519 signature against PC fingerprint `HSLA-XXXX-XXXX-XXXX-XXXX`)
