# Hosila IMS — Gemini Frontend Handoff & Blueprint (Phases F0–F6)

> **Backend Status:** All Rust & SQLite phases **B0–B7 Complete & Verified** (28/28 tests passing, 0 compiler warnings, Windows `.exe` compiling cleanly).  
> **Your Scope:** Build the complete React 19 + TypeScript frontend in `src/` against [`bindings/bindings.ts`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/bindings/bindings.ts) and [`docs/CONTRACT.md`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/docs/CONTRACT.md). Do **not** modify `crates/hosila-core` or break existing Tauri command signatures.

---

## 1. Current Workspace Snapshot

- **Framework:** React `19.0.1`, TypeScript `5.8.2`, Vite `6.3.5`, Tauri `2` (`@tauri-apps/api ^2.9.0`).
- **Diagnostic Placeholder:** [`src/App.tsx`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/src/App.tsx) currently verifies `getSystemInfo()` and `listUnits()`. Replace it cleanly with the production application shell.
- **Icons / Branding Assets Already on Disk:**
  - App window icon & small web asset: [`public/hosila-icon.svg`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/public/hosila-icon.svg)
  - Source vector mark: [`Hosila icon lime.svg`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/Hosila%20icon%20lime.svg)
  - Full horizontal lockup: [`Hosila Branding colorised.png`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/Hosila%20Branding%20colorised.png) (copy/import into `public/` or `src/assets/` if referenced in React!)
- **Tauri Capabilities Note:** [`src-tauri/capabilities/default.json`](file:///c:/Users/User/OneDrive/Desktop/Hosila/inventory-desktop/src-tauri/capabilities/default.json) currently grants `"core:default"` only, and `@tauri-apps/plugin-dialog` is **not installed yet**. When wiring file open/save buttons for Excel imports/exports and backup restore, either:
  1. Add `tauri-plugin-dialog = "2"` (Rust + `@tauri-apps/plugin-dialog` + `"dialog:default"` permission in `capabilities/default.json`), **OR**
  2. Support `<input>` path entry as fallback alongside native OS dialogs.

### Quick Dev Launch & Verification Commands
Run inside `c:\Users\User\OneDrive\Desktop\Hosila\inventory-desktop`:
```powershell
$env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

# Install frontend libraries you add (always use pnpm, never npm)
pnpm install

# Launch desktop app with realistic seeded demo data (idempotent)
pnpm tauri dev -- -- --dev-seed

# Frontend verification
pnpm run typecheck
pnpm run build

# Full workspace verification (re-generates bindings.ts if needed)
cargo test --workspace
```

**Dev Login Credentials (`--dev-seed`):**  
`username: admin` · `password: admin123` · `PIN: 1234` (6 demo staff + 6 demo items ready immediately).

---

## 2. Visual & Interaction Design System (Mandatory Skills)

Consult both installed design skill folders in `.claude/skills/` before authoring UI components:
- [`emil-design-eng`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/emilkowalski-skills/skills/emil-design-eng/SKILL.md), [`pick-ui-library`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/emilkowalski-skills/skills/pick-ui-library/SKILL.md), and [`apple-design`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/emilkowalski-skills/skills/apple-design/SKILL.md)
- [`apple-design-dickwu`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/apple-design-dickwu/SKILL.md) (especially [`dark-mode.md`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/apple-design-dickwu/references/hig/dark-mode.md) and [`typography.md`](file:///c:/Users/User/OneDrive/Desktop/Hosila/.claude/skills/apple-design-dickwu/references/hig/typography.md))

### 2.1 Color Palette (NO De Palms Colors)
- **Light Mode (Neutral Crisp Canvas + Soft Dark Text + Hosila Green):**
  - Background / Window Canvas: `#FFFFFF` / `#F5F5F7`
  - Card / Elevated Surface: `#FFFFFF` with `1px solid #E5E5EA` hairline border
  - Primary Text: `#1D1D1F` · Secondary Text: `#6E6E73` · Muted: `#8E8E93`
  - Brand Accent (fills/focus rings): `#21C29C` (hover `#1AAE8B`)
  - Accessible Accent Text on Light: `#0D7A5F` (WCAG AA on white)
- **Dark Mode (Pure/Near-Black + Soft White Text + Hosila Green):**
  - Base Canvas: `#000000` (main canvas) · Sidebar `#09090B`
  - Cards: `#111113` · Raised Popovers / Modals: `#18181B`
  - Hairline Borders: `rgba(255, 255, 255, 0.08)` (`rgba(255, 255, 255, 0.14)` on focus/hover)
  - Primary Text: `#F5F5F7` · Secondary Text: `#A1A1AA`
  - Brand Accent (fills/indicators): `#21C29C` · Text Accent: `#34D3AA`
- **Theme Persistence:** Bind toggle (`Light | Dark | System`) via `commands.updateAppearance({ theme })` and match OS preference when `"system"`.

### 2.2 Typography & Layout Craft
- **Font:** Apple-clean modern geometric sans — bundle/load **Inter Variable** (or `@fontsource-variable/inter`) with `-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif` fallback.
- **Tabular Numbers (`tabular-nums`):** Required on ALL stock quantities, prices, valuation totals, KPI cards, and table columns (`font-variant-numeric: tabular-nums`).
- **Component Primitives & Motion:**
  - Use accessible unstyled primitives (**Radix UI Dialog / Select / Popover / DropdownMenu / Tabs / Tooltip**, `sonner` toasts, `lucide-react` icons, `tailwindcss` v4). Avoid noisy drop shadows or flashy gradients.
  - Keep transitions fast and natural (`150ms–220ms` ease-out curves like `cubic-bezier(0.22, 1, 0.36, 1)`), subtle press scale (`active:scale-[0.98]`), and honor `prefers-reduced-motion`.

---

## 3. Recommended UI Library Stack (pnpm)

Install clean Tailwind + Radix + state/routing packages inside `inventory-desktop/`:
- `tailwindcss` / `@tailwindcss/vite`
- `@radix-ui/react-dialog`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-select`, `@radix-ui/react-tabs`, `@radix-ui/react-tooltip`, `@radix-ui/react-checkbox`
- `lucide-react`, `sonner` (notifications), `@fontsource-variable/inter` (offline bundled typography)

---

## 4. Phased Frontend Roadmap (Phases F0–F6)

### Phase F0 — App Shell, Routing, Auth, Onboarding & Licence Banner
1. On boot, call `commands.getSystemInfo()`, `commands.getSettings()`, `commands.getCurrentSession()`, and `commands.getLicenseStatus()`.
2. Apply theme (`settings.appearance.theme`) and warn non-blocking if `systemInfo.is_network_path` is `true` (UNC share latency warning) or if `licenseStatus.state === "trial"` / `"trial_expired"`.
3. **First-Run Onboarding Wizard** when `systemInfo.needs_onboarding === true`:
   - Collect Business Profile (name, `₦`, `NGN`), Admin account + 4–6 digit Manager PIN, initial Departments + Store Sections (e.g., `Protein`), calls `commands.completeOnboarding`.
4. **Login Screen** (Username/Password `login`, quick Storekeeper PIN toggle `loginWithPin`).
5. **Sidebar Navigation Shell** (collapsible sidebar with Hosila mark, 7 clean sections):
   `Dashboard`, `Collect Stock`, `Inventory`, `Procurement & Restock`, `Counts & Adjustments`, `Reports`, `Settings`.

### Phase F1 — Dashboard & Activity Log
- **KPI Grid (`commands.getDashboardKpis`):** Total Inventory Value (`₦`), Active Items, Low Stock & Out-of-Stock counts, Consumed Today (`₦`), Received Today (`₦`), Outstanding Tool Returns badge, Cost-Missing warning pill (`72` items on De Palms seed until priced!).
- **Visualizations (`getConsumptionByDepartment`, `getDailyConsumptionSeries`):** Clean 14-day Consumed vs Received bar/area chart + Consumption-by-Department breakdown (SVG/CSS chart with tooltips — fast, crisp, zero clutter).
- **Live Audit Feed (`listActivityLog`):** Filterable by action category (`collection.`, `receipt.`, `import.`, `item.`, `adjustment.`, `stock_count.`), actor user, and date range, clearly displaying collector, storekeeper, quantity, and timestamps.

### Phase F2 — Inventory Catalog & UoM Configuration
- Grouped by **Department** tabs / filter pills + **Store Section** filter (showing e.g. `Kitchen / Protein` cleanly) + instant **FTS5 Search** (`listItems`).
- Quick filters: `Low Stock`, `Out of Stock`, `Cost Missing`, `Returnable Only`, `Archived`.
- **Add / Edit Item Drawer (`createItem`, `updateItem`):**
  - Multi-department checkbox list (so `Pineapple` can belong to `F&B` and `Kitchen`).
  - Optional Store Section dropdown (e.g., `Protein` collected by Kitchen staff).
  - Base unit + Display unit + Default Issue/Purchase units + Alternate `item_units` table (e.g., `1 CRATE = 30 PCS` with unusual-factor amber helper check).
  - Read-only Stock Valuation badge + `is_returnable` toggle.
- **Item Stock Card Modal (`getItemDetail`, `getItemStockCard`):** Full movement ledger (`opening`, `receipt`, `issue`, `adjustment`, `count`, `reversal`, `tool_in`, `tool_out`) and **Guarded Base Unit Rescale Wizard** (`changeItemBaseUnit`) when movements already exist (`BASE_UNIT_LOCKED`).

### Phase F3 — Collection (Stock Issue) & Returnable Items (Keyboard-First)
- **Fast Counter Workflow:**
  1. Select **Department** → dynamically filters **Collector Staff** (`listStaff({ department_id })`) AND department **Items** (`listItems({ department_id })`).
  2. Select **Storekeeper** (`listStaff({ store_staff_only: true })`).
  3. Set **`collection_date`** (defaults to today; editable so De Palms can back-date starting **`2026-11-09`** cleanly!).
  4. Add items with quick search/combobox, unit dropdown, and quantity; call `commands.validateCollection(...)` on edits so **over-issues block inline BEFORE submission** (`"Quantity is more than available for X. Only Y in stock"` with crimson `INSUFFICIENT_STOCK` badge, disabling Post button until corrected).
- **History & Reversal:** Filterable past Collections (`listCollections`) + Admin/PIN-gated Reversal modal (`reverseCollection`).
- **Returnables Tab (`listOutstandingReturns`, `recordReturn`):** Tracks issued returnable items (`out` / `partial`) and logs `returned_good_milli` + `damaged_milli`.

### Phase F4 — Procurement Planning, Excel Export/Print & Built-In Parser Confirmation Gate
- **Procurement Builder (`generateProcurementDraft`, `createProcurementList`, `updateProcurementList`):**
  - Mode selector: **Low Stock Only** | **Full Department** | **Custom Multi-Department Picker**.
  - Group lines cleanly in De Palms section order (`KITCHEN`, `PROTEIN`, `F & B`, `HOUSEKEEPING`, `MAINTENANCE`), allow assigning per-line **`buyer_name`** (e.g. `NINA`, `MARGARET` → splits extra buyer tabs in Excel!) and **`extra_charges`** (`TRANSPORT`, `BANK CHARGES`, etc.).
  - Actions: **Export `.xlsx`** (`exportProcurementXlsx`) & **Print Preview** (`renderProcurementPrintHtml` rendered in print iframe / `window.print()`).
- **Manual Carry-Over Restock (`createReceipt`):** Convert any Procurement List directly into a GRN receipt, pre-filling ordered items/units so Storekeeper only enters actual quantities & prices + Receiver + Approving Storekeeper.
- **Built-In Procurement Excel Parser & Storekeeper Confirmation Gate (`inspectProcurementWorkbook` → `parseProcurementWorkbook` → `confirmParsedRestock`):**
  1. Pick `.xlsx` file → display detected sheets from `inspectProcurementWorkbook` (`Sheet1`, `NINA'S LIST`, `MARGARET'S LIST`, etc. — badge if `_hosila_meta` present for Tier-1 round-trip).
  2. Review parsed draft table showing all 5 anomaly flags clearly as color-coded chips:
     - `AMOUNT_MISMATCH` (`qty × price ≠ amount`, e.g., Vegetable Oil `25 × 68,000` or Ketchup)
     - `AMOUNT_ONLY` (quantity blank while lump sum entered, e.g., Onion `₦10,000`)
     - `UNIT_CONVERSION_NEEDED` (`BASMATIC RICE` in `PACK` with no conversion factor)
     - `UNMATCHED_ITEM` (offer **Map to existing item** using `candidates` ranked scores OR **Create New Item**)
     - `PRICE_JUMP` (`> ±40%` cost change warning)
  3. Provide **"Remember alias for future imports"** (`save_alias`) and **"Save UoM conversion"** (`save_unit_conversion`) checkboxes per line.
  4. Require **Receiver** + **Approving Storekeeper** before enabling **Confirm & Post Restock** (`confirmParsedRestock`).
- **Goods Receipts Log (`listReceipts`, `reverseReceipt`):** Shows posted receipts, disbursement vs actual spend refund reconciliation, and PIN-gated reversal.

### Phase F5 — Stock Adjustments & Physical Stock Counts
- **Adjustments (`createAdjustment`, `listAdjustments`):** Reason selector (`wastage | spoilage | damage | expired | found | count_correction`), mandatory audit notes, inline PIN prompt when `abs_total >= require_manager_pin_above_minor` for non-Admin users.
- **Physical Stock Counts (`startStockCount`, `updateStockCountLines`, `postStockCount`, `listStockCounts`):** Create draft snapshot scoped by department/section, enter counted quantities with live variance (`+`/`-`) preview, and Post to reconcile ledger.

### Phase F6 — Financial Reports, Settings, De Palms Week 2 Importer, Backups & Licence
- **Reports (`getStockValuationReport`, `getConsumptionReport`, `getProcurementSpendReport`, `getWeeklyStockSheet`, `exportWeeklyStockSheetXlsx`):** Live tables + date-range filters + `.xlsx` export of the corrected Weekly Stock Sheet (`CLOSING × UNIT_COST`).
- **Settings Tabs (Admin):**
  1. Business Profile & Currency (`updateBusinessProfile`) + Light/Dark/System Appearance (`updateAppearance`) + Inventory Rules (`updateInventoryRules`).
  2. Departments (`Kitchen`, `F&B`, `Housekeeping`, `Maintenance`, `Store`) & Store Sections (`Protein`).
  3. Staff Directory (with Storekeeper toggle) + User Accounts / Passwords / Manager PINs.
  4. Units of Measure (`createUnit`, `updateUnit`, `deleteUnit`).
  5. **Excel Weekly Stock Seed Importer (`previewWeeklySheetImport`, `commitWeeklySheetImport`):** Dedicated De Palms Week 2 onboarding wizard (`profile: "de_palms"`, dates `2026-11-02` / `2026-11-05` prior to starting collections on **`2026-11-09`**, showing preview counts: `370` items, `72` cost-missing, `₦7,196,758.12` closing valuation before committing).
  6. **Database Integrity & Backups (`runIntegrityCheck`, `listBackups`, `createBackup`, `restoreBackup`).**
  7. **Workstation Licence (`getLicenseStatus`, `activateLicense`):** Displays PC Fingerprint (`HSLA-XXXX-XXXX-XXXX-XXXX`), 14-day trial countdown or licensed entity name, and offline `HSLA1.*` key entry.
