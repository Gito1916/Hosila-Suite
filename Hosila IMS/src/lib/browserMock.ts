// Browser-only Tauri IPC fallback: active ONLY when opened in a regular browser
// (Chrome/Edge at http://127.0.0.1:1420) outside the Tauri WebView2 desktop shell.
// Inside the real Tauri desktop window, window.__TAURI_INTERNALS__ already exists
// and this file is a complete no-op.

import { daysAgoIso, formatMilli, todayIso } from './format';

interface MockItemUnit {
  id: string;
  unit_id: string;
  unit_code: string;
  unit_name: string;
  unit_plural: string;
  factor_milli: number;
  can_purchase: boolean;
  can_issue: boolean;
  label_override: string | null;
  is_unusual_factor: boolean;
}

interface MockItem {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  base_unit_id: string;
  base_unit_code: string;
  base_unit_name: string;
  base_unit_plural: string;
  display_unit_id: string;
  default_issue_unit_id: string;
  default_purchase_unit_id: string;
  store_section_id: string | null;
  store_section_name: string | null;
  department_ids: string[];
  department_names: string[];
  stock_milli: number;
  on_hand_milli: number;
  display_stock: string;
  avg_cost_micro: number;
  last_cost_micro: number;
  stock_value_minor: number;
  cost_missing: boolean;
  is_returnable: boolean;
  reorder_point_milli: number;
  par_level_milli: number;
  stock_status: 'healthy' | 'low_stock' | 'out_of_stock';
  storage_location: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  is_active: boolean;
  item_units: MockItemUnit[];
}

export function installBrowserPreviewFallbackIfNeeded() {
  if (typeof window === 'undefined') return;
  const w = window as unknown as {
    __TAURI_INTERNALS__?: {
      invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
      transformCallback?: (cb: unknown) => number;
    };
  };

  if (w.__TAURI_INTERNALS__ && typeof w.__TAURI_INTERNALS__.invoke === 'function') {
    return; // Running inside real Tauri desktop window — use real Rust + SQLite backend!
  }

  const today = todayIso();
  let needsOnboarding = true;
  let currentSession: Record<string, unknown> | null = null;

  let appearance = { theme: 'light' };
  let businessProfile = {
    name: '',
    legal_name: '',
    address: '',
    phone: '',
    email: '',
    currency_symbol: '₦',
    currency_code: 'NGN',
    date_format: 'DD MMM YYYY',
    logo_data_url: null as string | null,
  };
  let inventoryRules = {
    allow_negative_stock: false,
    costing_method: 'wac',
    require_storekeeper_pin_on_issue: false,
    require_manager_pin_above_minor: 5_000_000,
  };

  let departments: {
    id: string;
    name: string;
    color: string;
    sort_order: number;
    is_active: boolean;
    staff_count: number;
    item_count: number;
    created_at: string;
  }[] = [];

  let storeSections: {
    id: string;
    name: string;
    sort_order: number;
    is_active: boolean;
    item_count: number;
    created_at: string;
  }[] = [];

  const units = [
    { id: 'u-pcs', code: 'PCS', name: 'Piece', plural: 'Pieces', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-portion', code: 'PORTION', name: 'Portion', plural: 'Portions', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-kg', code: 'KG', name: 'Kilogram', plural: 'Kilograms', dimension: 'mass', allows_decimals: true, factor_to_dim_base_milli: 1000000, is_system: true },
    { id: 'u-g', code: 'G', name: 'Gram', plural: 'Grams', dimension: 'mass', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-btl', code: 'BTL', name: 'Bottle', plural: 'Bottles', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-pack', code: 'PACK', name: 'Pack', plural: 'Packs', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-crate', code: 'CRATE', name: 'Crate', plural: 'Crates', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-bag', code: 'BAG', name: 'Bag', plural: 'Bags', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-ctn', code: 'CTN', name: 'Carton', plural: 'Cartons', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-roll', code: 'ROLL', name: 'Roll', plural: 'Rolls', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-tin', code: 'TIN', name: 'Tin', plural: 'Tins', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
    { id: 'u-cup', code: 'CUP', name: 'Cup', plural: 'Cups', dimension: 'volume', allows_decimals: true, factor_to_dim_base_milli: 250000, is_system: true },
    { id: 'u-l', code: 'L', name: 'Litre', plural: 'Litres', dimension: 'volume', allows_decimals: true, factor_to_dim_base_milli: 1000000, is_system: true },
  ];

  let users: {
    id: string;
    username: string;
    full_name: string;
    role: string;
    is_active: boolean;
    has_pin: boolean;
    created_at: string;
    updated_at: string;
  }[] = [];

  let staff: {
    id: string;
    full_name: string;
    staff_code: string | null;
    phone: string | null;
    is_store_staff: boolean;
    is_active: boolean;
    department_ids: string[];
    department_names: string[];
    created_at: string;
  }[] = [];

  let items: MockItem[] = [];

  function computeDisplayStock(
    baseUnitId: string,
    displayUnitId: string,
    stockMilli: number,
    itemUnits: MockItemUnit[]
  ): string {
    const baseU = units.find((u) => u.id === baseUnitId) ?? units[0];
    const conv = itemUnits.find((iu) => iu.unit_id === displayUnitId);
    if (conv && conv.unit_id !== baseUnitId && conv.factor_milli > 0) {
      const stockInDisplay = Number((stockMilli / conv.factor_milli).toFixed(2));
      return `${stockInDisplay} ${conv.unit_code} (${formatMilli(stockMilli)} ${baseU.code})`;
    }
    return `${formatMilli(stockMilli)} ${baseU.code}`;
  }

  // Sample rows returned when previewing an Excel sheet in browser-only fallback mode
  // (Inside the real Hosila IMS desktop app, the Rust Excel engine parses the real .xlsx file from disk)
  function buildBrowserPreviewRows() {
    return [
      {
        section_raw: 'PROTEIN',
        department_name: departments[0]?.name ?? 'Kitchen',
        store_section_name: storeSections[0]?.name ?? 'Protein',
        item_name: 'Goat Meat',
        unit_raw: 'KG',
        resolved_unit_code: 'KG',
        opening_milli: 12_000,
        purchase_milli: 8_000,
        available_milli: 20_000,
        issued_milli: 5_000,
        closing_milli: 15_000,
        unit_cost_micro: 6_500_000_000,
        total_value_minor: 9_750_000,
        cost_missing: false,
        shared_with_departments: [departments[0]?.name ?? 'Kitchen'],
        warning: null,
      },
      {
        section_raw: 'PROTEIN',
        department_name: departments[0]?.name ?? 'Kitchen',
        store_section_name: storeSections[0]?.name ?? 'Protein',
        item_name: 'Chicken Breast',
        unit_raw: 'KG',
        resolved_unit_code: 'KG',
        opening_milli: 10_000,
        purchase_milli: 10_000,
        available_milli: 20_000,
        issued_milli: 4_000,
        closing_milli: 16_000,
        unit_cost_micro: 5_800_000_000,
        total_value_minor: 9_280_000,
        cost_missing: false,
        shared_with_departments: [departments[0]?.name ?? 'Kitchen'],
        warning: null,
      },
      {
        section_raw: 'KITCHEN',
        department_name: departments[0]?.name ?? 'Kitchen',
        store_section_name: null,
        item_name: 'Basmati Rice (50kg)',
        unit_raw: 'BAG',
        resolved_unit_code: 'BAG',
        opening_milli: 10_000,
        purchase_milli: 4_000,
        available_milli: 14_000,
        issued_milli: 2_000,
        closing_milli: 12_000,
        unit_cost_micro: 68_000_000_000,
        total_value_minor: 81_600_000,
        cost_missing: false,
        shared_with_departments: [departments[0]?.name ?? 'Kitchen'],
        warning: null,
      },
      {
        section_raw: 'F&B',
        department_name: departments[1]?.name ?? 'F&B',
        store_section_name: null,
        item_name: 'Bottle Water (75cl)',
        unit_raw: 'PACK',
        resolved_unit_code: 'PACK',
        opening_milli: 25_000,
        purchase_milli: 15_000,
        available_milli: 40_000,
        issued_milli: 7_000,
        closing_milli: 33_000,
        unit_cost_micro: 1_800_000_000,
        total_value_minor: 5_940_000,
        cost_missing: false,
        shared_with_departments: [
          departments[1]?.name ?? 'F&B',
          departments[0]?.name ?? 'Kitchen',
        ],
        warning: null,
      },
    ];
  }

  w.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
      switch (cmd) {
        case 'get_system_info':
          return {
            app_version: '0.2.3',
            run_mode: 'installed',
            db_path: 'data\\hosila.db',
            is_network_path: false,
            schema_version: 1,
            needs_onboarding: needsOnboarding,
            user_count: users.length,
            item_count: items.filter((i) => i.is_active).length,
            unit_count: units.length,
            integrity: {
              ok: true,
              sqlite_quick_check: 'ok',
              ledger_mismatches: 0,
              checked_at: new Date().toISOString(),
            },
          };
        case 'complete_onboarding': {
          const input = args.input as {
            business_profile: {
              name: string;
              legal_name: string;
              address: string;
              phone: string;
              email: string;
              currency_symbol: string;
              currency_code: string;
              date_format: string;
              logo_data_url: string | null;
            };
            admin_username: string;
            admin_full_name: string;
            admin_pin: string | null;
            departments: { name: string; color: string | null; sort_order: number | null }[];
            store_sections: { name: string; sort_order: number | null }[];
          };
          businessProfile = {
            ...businessProfile,
            ...input.business_profile,
            currency_symbol: input.business_profile.currency_symbol || '₦',
            currency_code: input.business_profile.currency_code || 'NGN',
          };
          const palette = ['#6AD4B0', '#1D1D1F', '#1E8665', '#52525B', '#8E8E93', '#A1A1AA'];
          departments = input.departments.map((d, idx) => ({
            id: `dept-${idx + 1}`,
            name: d.name,
            color: d.color || palette[idx % palette.length],
            sort_order: d.sort_order ?? idx + 1,
            is_active: true,
            staff_count: 1,
            item_count: 0,
            created_at: today,
          }));
          storeSections = input.store_sections.map((s, idx) => ({
            id: `sec-${idx + 1}`,
            name: s.name,
            sort_order: s.sort_order ?? idx + 1,
            is_active: true,
            item_count: 0,
            created_at: today,
          }));
          const adminUser = {
            id: 'usr-admin',
            username: input.admin_username,
            full_name: input.admin_full_name,
            role: 'admin',
            is_active: true,
            has_pin: Boolean(input.admin_pin),
            created_at: today,
            updated_at: today,
          };
          users = [adminUser];
          staff = [
            {
              id: 'st-admin',
              full_name: input.admin_full_name,
              staff_code: 'STF-001',
              phone: input.business_profile.phone || null,
              is_store_staff: true,
              is_active: true,
              department_ids: departments.map((d) => d.id),
              department_names: departments.map((d) => d.name),
              created_at: today,
            },
          ];
          currentSession = {
            id: adminUser.id,
            username: adminUser.username,
            full_name: adminUser.full_name,
            role: adminUser.role,
          };
          needsOnboarding = false;
          return currentSession;
        }
        case 'run_integrity_check':
          return {
            ok: true,
            sqlite_quick_check: 'ok',
            ledger_mismatches: 0,
            checked_at: new Date().toISOString(),
          };
        case 'get_settings':
          return {
            business_profile: businessProfile,
            inventory_rules: inventoryRules,
            appearance,
          };
        case 'update_appearance':
          appearance = (args.appearance as { theme: string }) ?? appearance;
          return appearance;
        case 'update_business_profile':
          businessProfile = { ...businessProfile, ...(args.profile as object) };
          return businessProfile;
        case 'update_inventory_rules':
          inventoryRules = { ...inventoryRules, ...(args.rules as object) };
          return inventoryRules;
        case 'get_current_session':
          return currentSession;
        case 'login':
        case 'login_with_pin':
          currentSession = users[0] ?? {
            id: 'usr-admin',
            username: 'admin',
            full_name: 'Administrator',
            role: 'admin',
          };
          return currentSession;
        case 'logout':
          currentSession = null;
          return null;
        case 'get_license_status':
          return {
            state: 'trial',
            machine_fingerprint: 'HSLA-7EF5-7360-C633',
            licensed_to: businessProfile.name || null,
            edition: 'Commercial Pro',
            activated_at: null,
            trial_days_remaining: 14,
            is_read_only: false,
            message: '14-day full-feature evaluation active.',
          };
        case 'list_departments':
          return departments;
        case 'list_store_sections':
          return storeSections;
        case 'list_units':
          return units;
        case 'list_suppliers':
          return [];
        case 'list_staff':
          return staff;
        case 'list_users':
          return users;
        case 'list_items': {
          const filter = (args.filter as {
            search?: string | null;
            department_id?: string | null;
            store_section_id?: string | null;
            status?: string | null;
            cost_missing_only?: boolean;
            returnable_only?: boolean;
            include_inactive?: boolean;
          }) || {};
          return items.filter((it) => {
            if (!filter.include_inactive && !it.is_active) return false;
            if (filter.department_id && !it.department_ids.includes(filter.department_id)) return false;
            if (filter.store_section_id && it.store_section_id !== filter.store_section_id) return false;
            if (filter.status && it.stock_status !== filter.status) return false;
            if (filter.cost_missing_only && !it.cost_missing) return false;
            if (filter.returnable_only && !it.is_returnable) return false;
            if (filter.search) {
              const q = filter.search.toLowerCase();
              if (!it.name.toLowerCase().includes(q) && !it.sku.toLowerCase().includes(q)) return false;
            }
            return true;
          });
        }
        case 'create_item': {
          const input = args.input as {
            sku: string | null;
            name: string;
            description: string | null;
            base_unit_id: string;
            display_unit_id: string | null;
            default_issue_unit_id: string | null;
            default_purchase_unit_id: string | null;
            store_section_id: string | null;
            department_ids: string[];
            item_units: {
              unit_id: string;
              factor_milli: number;
              can_purchase: boolean;
              can_issue: boolean;
              label_override: string | null;
            }[];
            reorder_point_milli: number;
            par_level_milli: number;
            initial_unit_cost_micro: number;
            cost_missing: boolean;
            is_returnable: boolean;
            opening_stock_milli: number;
            storage_location: string | null;
          };
          const baseU = units.find((u) => u.id === input.base_unit_id) ?? units[0];
          const sec = storeSections.find((s) => s.id === input.store_section_id);
          const itemUnits: MockItemUnit[] = (input.item_units || []).map((iu, idx) => {
            const u = units.find((x) => x.id === iu.unit_id) ?? baseU;
            return {
              id: `iu-${Date.now()}-${idx}`,
              unit_id: u.id,
              unit_code: u.code,
              unit_name: u.name,
              unit_plural: u.plural,
              factor_milli: iu.factor_milli,
              can_purchase: iu.can_purchase,
              can_issue: iu.can_issue,
              label_override: iu.label_override,
              is_unusual_factor: false,
            };
          });
          const stockMilli = input.opening_stock_milli || 0;
          const displayUnitId = input.display_unit_id || baseU.id;
          const valMinor = input.cost_missing
            ? 0
            : Math.round((stockMilli * input.initial_unit_cost_micro) / 10_000_000);
          const newItem: MockItem = {
            id: `itm-${Date.now()}-${items.length + 1}`,
            sku: input.sku || `ITM-${String(items.length + 1).padStart(4, '0')}`,
            name: input.name,
            description: input.description,
            base_unit_id: baseU.id,
            base_unit_code: baseU.code,
            base_unit_name: baseU.name,
            base_unit_plural: baseU.plural,
            display_unit_id: displayUnitId,
            default_issue_unit_id: input.default_issue_unit_id || baseU.id,
            default_purchase_unit_id: input.default_purchase_unit_id || baseU.id,
            store_section_id: sec?.id ?? null,
            store_section_name: sec?.name ?? null,
            department_ids: input.department_ids,
            department_names: departments
              .filter((d) => input.department_ids.includes(d.id))
              .map((d) => d.name),
            stock_milli: stockMilli,
            on_hand_milli: stockMilli,
            display_stock: computeDisplayStock(baseU.id, displayUnitId, stockMilli, itemUnits),
            avg_cost_micro: input.initial_unit_cost_micro,
            last_cost_micro: input.initial_unit_cost_micro,
            stock_value_minor: valMinor,
            cost_missing: input.cost_missing,
            is_returnable: input.is_returnable,
            reorder_point_milli: input.reorder_point_milli,
            par_level_milli: input.par_level_milli,
            stock_status:
              stockMilli <= 0
                ? 'out_of_stock'
                : stockMilli <= input.reorder_point_milli
                  ? 'low_stock'
                  : 'healthy',
            storage_location: input.storage_location,
            supplier_id: null,
            supplier_name: null,
            is_active: true,
            item_units: itemUnits,
          };
          items = [...items, newItem];
          return newItem;
        }
        case 'update_item': {
          const id = args.id as string;
          const input = args.input as {
            name?: string | null;
            display_unit_id?: string | null;
            default_issue_unit_id?: string | null;
            default_purchase_unit_id?: string | null;
            store_section_id?: string | null;
            clear_store_section?: boolean;
            department_ids?: string[] | null;
            item_units?: {
              unit_id: string;
              factor_milli: number;
              can_purchase: boolean;
              can_issue: boolean;
              label_override: string | null;
            }[] | null;
            unit_cost_micro?: number | null;
            cost_missing?: boolean | null;
            is_active?: boolean | null;
          };
          items = items.map((it) => {
            if (it.id !== id) return it;
            const nextItemUnits: MockItemUnit[] = input.item_units
              ? input.item_units.map((iu, idx) => {
                const u = units.find((x) => x.id === iu.unit_id) ?? units[0];
                return {
                  id: `iu-${idx}`,
                  unit_id: u.id,
                  unit_code: u.code,
                  unit_name: u.name,
                  unit_plural: u.plural,
                  factor_milli: iu.factor_milli,
                  can_purchase: iu.can_purchase,
                  can_issue: iu.can_issue,
                  label_override: iu.label_override,
                  is_unusual_factor: false,
                };
              })
              : it.item_units;
            const nextDisplayUnitId = input.display_unit_id ?? it.display_unit_id;
            const nextCostMicro = input.unit_cost_micro ?? it.avg_cost_micro;
            const nextCostMissing = input.cost_missing ?? it.cost_missing;
            const nextDeptIds = input.department_ids ?? it.department_ids;
            const sec = input.clear_store_section
              ? null
              : storeSections.find((s) => s.id === (input.store_section_id ?? it.store_section_id));
            return {
              ...it,
              name: input.name ?? it.name,
              display_unit_id: nextDisplayUnitId,
              default_issue_unit_id: input.default_issue_unit_id ?? it.default_issue_unit_id,
              default_purchase_unit_id:
                input.default_purchase_unit_id ?? it.default_purchase_unit_id,
              store_section_id: sec?.id ?? null,
              store_section_name: sec?.name ?? null,
              department_ids: nextDeptIds,
              department_names: departments
                .filter((d) => nextDeptIds.includes(d.id))
                .map((d) => d.name),
              item_units: nextItemUnits,
              avg_cost_micro: nextCostMicro,
              last_cost_micro: nextCostMicro,
              cost_missing: nextCostMissing,
              stock_value_minor: nextCostMissing
                ? 0
                : Math.round((it.stock_milli * nextCostMicro) / 10_000_000),
              display_stock: computeDisplayStock(
                it.base_unit_id,
                nextDisplayUnitId,
                it.stock_milli,
                nextItemUnits
              ),
              is_active: input.is_active ?? it.is_active,
            };
          });
          return items.find((i) => i.id === id) ?? items[0];
        }
        case 'change_item_base_unit': {
          const id = args.id as string;
          const input = args.input as {
            new_base_unit_id: string;
            conversion_factor_milli: number;
          };
          const newU = units.find((u) => u.id === input.new_base_unit_id) ?? units[0];
          const factor = Math.max(input.conversion_factor_milli / 1000, 0.001);
          items = items.map((it) => {
            if (it.id !== id) return it;
            const newStockMilli = Math.round(it.stock_milli * factor);
            const newCostMicro = Math.round(it.avg_cost_micro / factor);
            return {
              ...it,
              base_unit_id: newU.id,
              base_unit_code: newU.code,
              base_unit_name: newU.name,
              base_unit_plural: newU.plural,
              stock_milli: newStockMilli,
              on_hand_milli: newStockMilli,
              avg_cost_micro: newCostMicro,
              last_cost_micro: newCostMicro,
              display_stock: computeDisplayStock(
                newU.id,
                it.display_unit_id,
                newStockMilli,
                it.item_units
              ),
            };
          });
          return items.find((i) => i.id === id) ?? items[0];
        }
        case 'archive_item': {
          const id = args.id as string;
          items = items.map((it) => (it.id === id ? { ...it, is_active: false } : it));
          return null;
        }
        case 'clear_inventory': {
          const count = items.length;
          items = [];
          return count;
        }
        case 'preview_weekly_sheet_import': {
          const rows = buildBrowserPreviewRows();
          return {
            file_path: (args.input as { file_path: string })?.file_path ?? 'Inventory.xlsx',
            sheet_name: 'WEEK 2',
            total_items: rows.length,
            cost_missing_count: 0,
            total_closing_value_minor: rows.reduce((a, r) => a + r.total_value_minor, 0),
            section_counts: [
              { section: 'PROTEIN', count: 2 },
              { section: 'KITCHEN', count: 1 },
              { section: 'F&B', count: 1 },
            ],
            rows,
            warnings: [],
          };
        }
        case 'commit_weekly_sheet_import': {
          const rows = buildBrowserPreviewRows();
          items = rows.map((r, idx) => {
            const u = units.find((x) => x.code === r.resolved_unit_code) ?? units[0];
            const dept =
              departments.find((d) => d.name.toLowerCase() === r.department_name.toLowerCase()) ??
              departments[0];
            const sec = storeSections.find(
              (s) => s.name.toLowerCase() === (r.store_section_name ?? '').toLowerCase()
            );
            return {
              id: `itm-imp-${idx + 1}`,
              sku: `ITM-${String(idx + 1).padStart(4, '0')}`,
              name: r.item_name,
              description: null,
              base_unit_id: u.id,
              base_unit_code: u.code,
              base_unit_name: u.name,
              base_unit_plural: u.plural,
              display_unit_id: u.id,
              default_issue_unit_id: u.id,
              default_purchase_unit_id: u.id,
              store_section_id: sec?.id ?? null,
              store_section_name: sec?.name ?? null,
              department_ids: dept ? [dept.id] : [],
              department_names: dept ? [dept.name] : [],
              stock_milli: r.closing_milli,
              on_hand_milli: r.closing_milli,
              display_stock: `${formatMilli(r.closing_milli)} ${u.code}`,
              avg_cost_micro: r.unit_cost_micro,
              last_cost_micro: r.unit_cost_micro,
              stock_value_minor: r.total_value_minor,
              cost_missing: r.cost_missing,
              is_returnable: false,
              reorder_point_milli: 0,
              par_level_milli: 0,
              stock_status: r.closing_milli > 0 ? 'healthy' : 'out_of_stock',
              storage_location: null,
              supplier_id: null,
              supplier_name: null,
              is_active: true,
              item_units: [],
            };
          });
          return {
            import_run_id: `imp-${Date.now()}`,
            items_created: items.length,
            items_updated: 0,
            opening_movements: items.length,
            purchase_movements: 0,
            issue_movements: 0,
            cost_missing_count: 0,
            total_closing_value_minor: items.reduce((a, i) => a + i.stock_value_minor, 0),
          };
        }
        case 'get_item_detail': {
          const id = args.id as string;
          const found = items.find((i) => i.id === id) ?? items[0];
          return {
            item: found,
            aliases: [],
            has_movements: true,
            recent_movements: [],
          };
        }
        case 'get_item_stock_card':
          return [];
        case 'get_dashboard_kpis': {
          const active = items.filter((i) => i.is_active);
          return {
            total_inventory_value_minor: active.reduce((a, i) => a + i.stock_value_minor, 0),
            total_active_items: active.length,
            low_stock_count: active.filter((i) => i.stock_status === 'low_stock').length,
            out_of_stock_count: active.filter((i) => i.stock_status === 'out_of_stock').length,
            cost_missing_count: active.filter((i) => i.cost_missing).length,
            consumed_today_minor: 0,
            received_today_minor: 0,
            outstanding_returns_count: 0,
            open_procurement_lists_count: 0,
            as_of_date: today,
          };
        }
        case 'get_consumption_by_department':
          return [];
        case 'get_daily_consumption_series': {
          const daysCount = Number(args.days) || 14;
          const anchorStr = (args.asOfDate as string | null) || today;
          const anchor = new Date(`${anchorStr.slice(0, 10)}T00:00:00`);
          const base = Number.isNaN(anchor.getTime()) ? new Date() : anchor;
          return Array.from({ length: daysCount }, (_, idx) => {
            const d = new Date(base);
            d.setDate(d.getDate() - (daysCount - 1 - idx));
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return {
              date: `${y}-${m}-${day}`,
              consumed_minor: 0,
              received_minor: 0,
            };
          });
        }
        case 'list_activity_log':
          return [];
        case 'list_collections':
          return [];
        case 'list_outstanding_returns':
          return [];
        case 'list_procurement_lists':
          return [];
        case 'list_receipts':
          return [];
        case 'list_adjustments':
          return [];
        case 'list_stock_counts':
          return [];
        case 'get_weekly_stock_sheet': {
          const active = items.filter((i) => i.is_active);
          return {
            start_date: daysAgoIso(6),
            end_date: today,
            grand_total_minor: active.reduce((a, i) => a + i.stock_value_minor, 0),
            rows: active.map((it) => ({
              section_label: it.store_section_name
                ? it.store_section_name.toUpperCase()
                : (it.department_names[0] || 'KITCHEN').toUpperCase(),
              item_id: it.id,
              item_name: it.name,
              unit_code: it.base_unit_code,
              opening_milli: it.on_hand_milli,
              purchase_milli: 0,
              available_milli: it.on_hand_milli,
              issued_milli: 0,
              closing_milli: it.on_hand_milli,
              unit_cost_micro: it.avg_cost_micro,
              total_value_minor: it.stock_value_minor,
              cost_missing: it.cost_missing,
            })),
          };
        }
        case 'get_stock_valuation_report': {
          const active = items.filter((i) => i.is_active);
          return {
            as_of_date: today,
            total_value_minor: active.reduce((a, i) => a + i.stock_value_minor, 0),
            total_items: active.length,
            cost_missing_count: active.filter((i) => i.cost_missing).length,
            by_department: departments
              .filter((d) => d.name.toLowerCase() !== 'store')
              .map((d) => {
                const dItems = active.filter((i) => i.department_ids.includes(d.id));
                return {
                  department_id: d.id,
                  department_name: d.name,
                  section_name: null,
                  item_count: dItems.length,
                  total_value_minor: dItems.reduce((a, i) => a + i.stock_value_minor, 0),
                  cost_missing_count: dItems.filter((i) => i.cost_missing).length,
                };
              }),
          };
        }
        case 'get_consumption_report':
          return [];
        case 'get_procurement_spend_report':
          return [];
        case 'export_weekly_stock_sheet_xlsx':
          return (args.outputPath as string) || 'Downloads\\Hosila-Inventory.xlsx';
        case 'export_backup_file':
          return (args.outputPath as string) || 'Downloads\\Hosila-Backup.db';
        case 'create_backup':
          return {
            filename: 'hosila_clean_baseline.db',
            path: '__HOSILA_BROWSER_CLEAR__',
            size_bytes: 122880,
            created_at: new Date().toISOString(),
            kind: 'manual',
          };
        case 'restore_backup':
          items = [];
          return {
            ok: true,
            sqlite_quick_check: 'ok',
            ledger_mismatches: 0,
            checked_at: new Date().toISOString(),
          };
        case 'list_backups':
          return [];
        default:
          return null;
      }
    },
  };
}
