-- Hosila IMS v1 initial SQLite schema
-- Quantities stored in INTEGER milli-units (x1,000)
-- Money stored in INTEGER minor currency units / kobo (x100)
-- Unit costs stored in INTEGER micro-currency units (x1,000,000)

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    full_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    pin_hash TEXT,
    role TEXT NOT NULL CHECK(role IN ('admin', 'storekeeper', 'viewer')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#21C29C',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS store_sections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff (
    id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    staff_code TEXT,
    phone TEXT,
    is_store_staff INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS staff_departments (
    staff_id TEXT NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    PRIMARY KEY (staff_id, department_id)
);

CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    plural TEXT NOT NULL,
    dimension TEXT NOT NULL CHECK(dimension IN ('count', 'mass', 'volume', 'length')),
    allows_decimals INTEGER NOT NULL DEFAULT 0,
    factor_to_dim_base_milli INTEGER NOT NULL CHECK(factor_to_dim_base_milli > 0),
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    phone TEXT,
    email TEXT,
    notes TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS items (
    id TEXT PRIMARY KEY,
    sku TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    description TEXT,
    base_unit_id TEXT NOT NULL REFERENCES units(id),
    display_unit_id TEXT NOT NULL REFERENCES units(id),
    default_issue_unit_id TEXT NOT NULL REFERENCES units(id),
    default_purchase_unit_id TEXT NOT NULL REFERENCES units(id),
    store_section_id TEXT REFERENCES store_sections(id),
    on_hand_milli INTEGER NOT NULL DEFAULT 0,
    avg_cost_micro INTEGER NOT NULL DEFAULT 0,
    last_cost_micro INTEGER NOT NULL DEFAULT 0,
    cost_missing INTEGER NOT NULL DEFAULT 0,
    is_returnable INTEGER NOT NULL DEFAULT 0,
    reorder_point_milli INTEGER NOT NULL DEFAULT 0,
    par_level_milli INTEGER NOT NULL DEFAULT 0,
    supplier_id TEXT REFERENCES suppliers(id),
    storage_location TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS item_departments (
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    department_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    PRIMARY KEY (item_id, department_id)
);

CREATE TABLE IF NOT EXISTS item_units (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    unit_id TEXT NOT NULL REFERENCES units(id),
    factor_milli INTEGER NOT NULL CHECK(factor_milli > 0),
    can_purchase INTEGER NOT NULL DEFAULT 1,
    can_issue INTEGER NOT NULL DEFAULT 1,
    label_override TEXT,
    UNIQUE(item_id, unit_id)
);

CREATE TABLE IF NOT EXISTS item_aliases (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    alias_normalized TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
    item_id UNINDEXED,
    name,
    sku,
    aliases
);

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    department_id TEXT NOT NULL REFERENCES departments(id),
    collector_staff_id TEXT NOT NULL REFERENCES staff(id),
    collector_name_snapshot TEXT NOT NULL,
    storekeeper_staff_id TEXT NOT NULL REFERENCES staff(id),
    storekeeper_name_snapshot TEXT NOT NULL,
    created_by_user_id TEXT NOT NULL REFERENCES users(id),
    collection_date TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'reversed')),
    posted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_lines (
    id TEXT PRIMARY KEY,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    input_qty_milli INTEGER NOT NULL CHECK(input_qty_milli > 0),
    factor_milli INTEGER NOT NULL CHECK(factor_milli > 0),
    base_qty_milli INTEGER NOT NULL CHECK(base_qty_milli > 0),
    unit_cost_micro INTEGER NOT NULL DEFAULT 0,
    line_value_minor INTEGER NOT NULL DEFAULT 0,
    is_returnable INTEGER NOT NULL DEFAULT 0,
    returned_qty_milli INTEGER NOT NULL DEFAULT 0,
    damaged_qty_milli INTEGER NOT NULL DEFAULT 0,
    return_status TEXT NOT NULL DEFAULT 'na' CHECK(return_status IN ('na', 'out', 'partial', 'returned')),
    returned_at TEXT
);

CREATE TABLE IF NOT EXISTS procurement_lists (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    scope TEXT NOT NULL CHECK(scope IN ('low_stock', 'full', 'custom')),
    department_ids_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'finalised', 'partial', 'received', 'closed')),
    prepared_by_user_id TEXT NOT NULL REFERENCES users(id),
    extra_charges_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS procurement_lines (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL REFERENCES procurement_lists(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    section_label TEXT NOT NULL,
    buyer_name TEXT,
    unit_id TEXT REFERENCES units(id),
    factor_milli INTEGER NOT NULL DEFAULT 1000,
    suggested_qty_milli INTEGER NOT NULL DEFAULT 0,
    ordered_qty_milli INTEGER,
    est_unit_cost_minor INTEGER,
    budget_amount_minor INTEGER,
    received_qty_milli INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS receipts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    procurement_list_id TEXT REFERENCES procurement_lists(id),
    supplier_id TEXT REFERENCES suppliers(id),
    invoice_ref TEXT,
    source_type TEXT NOT NULL DEFAULT 'manual' CHECK(source_type IN ('manual', 'parsed_excel', 'seed')),
    source_filename TEXT,
    received_by_staff_id TEXT REFERENCES staff(id),
    received_by_name_snapshot TEXT NOT NULL,
    approved_by_staff_id TEXT REFERENCES staff(id),
    approved_by_name_snapshot TEXT NOT NULL,
    posted_by_user_id TEXT NOT NULL REFERENCES users(id),
    received_at TEXT NOT NULL,
    disbursement_minor INTEGER,
    actual_expense_minor INTEGER,
    refunded_minor INTEGER,
    extra_charges_json TEXT NOT NULL DEFAULT '[]',
    total_minor INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'posted' CHECK(status IN ('posted', 'reversed')),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS receipt_lines (
    id TEXT PRIMARY KEY,
    receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE,
    procurement_line_id TEXT REFERENCES procurement_lines(id),
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    input_qty_milli INTEGER NOT NULL CHECK(input_qty_milli > 0),
    factor_milli INTEGER NOT NULL CHECK(factor_milli > 0),
    base_qty_milli INTEGER NOT NULL CHECK(base_qty_milli > 0),
    unit_cost_minor INTEGER NOT NULL DEFAULT 0,
    line_total_minor INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS adjustments (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL CHECK(reason IN ('wastage', 'spoilage', 'damage', 'expired', 'found', 'count_correction')),
    notes TEXT NOT NULL,
    posted_by_user_id TEXT NOT NULL REFERENCES users(id),
    approved_by_user_id TEXT REFERENCES users(id),
    adjustment_date TEXT NOT NULL,
    posted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS adjustment_lines (
    id TEXT PRIMARY KEY,
    adjustment_id TEXT NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    unit_id TEXT NOT NULL REFERENCES units(id),
    input_qty_milli INTEGER NOT NULL,
    factor_milli INTEGER NOT NULL CHECK(factor_milli > 0),
    base_qty_milli INTEGER NOT NULL,
    unit_cost_micro INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stock_counts (
    id TEXT PRIMARY KEY,
    number TEXT NOT NULL UNIQUE,
    scope_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'posted')),
    started_by_user_id TEXT NOT NULL REFERENCES users(id),
    started_at TEXT NOT NULL,
    posted_by_user_id TEXT REFERENCES users(id),
    posted_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_count_lines (
    id TEXT PRIMARY KEY,
    stock_count_id TEXT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES items(id),
    system_qty_milli INTEGER NOT NULL,
    counted_qty_milli INTEGER,
    variance_milli INTEGER
);

CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES items(id),
    type TEXT NOT NULL CHECK(type IN ('opening', 'issue', 'receipt', 'adjustment', 'count', 'reversal', 'tool_out', 'tool_in')),
    qty_milli INTEGER NOT NULL,
    balance_after_milli INTEGER NOT NULL,
    unit_cost_micro INTEGER NOT NULL DEFAULT 0,
    value_minor INTEGER NOT NULL DEFAULT 0,
    department_id TEXT REFERENCES departments(id),
    doc_type TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    doc_number TEXT NOT NULL,
    input_unit_id TEXT NOT NULL REFERENCES units(id),
    input_qty_milli INTEGER NOT NULL,
    factor_milli INTEGER NOT NULL CHECK(factor_milli > 0),
    actor_user_id TEXT NOT NULL REFERENCES users(id),
    counterparty_staff_id TEXT REFERENCES staff(id),
    storekeeper_staff_id TEXT REFERENCES staff(id),
    business_date TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS activity_log (
    id TEXT PRIMARY KEY,
    at TEXT NOT NULL,
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    meta_json TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS import_runs (
    id TEXT PRIMARY KEY,
    profile TEXT NOT NULL,
    filename TEXT NOT NULL,
    items_created INTEGER NOT NULL DEFAULT 0,
    items_updated INTEGER NOT NULL DEFAULT 0,
    warnings_json TEXT NOT NULL DEFAULT '[]',
    imported_by_user_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_sequences (
    doc_type TEXT PRIMARY KEY,
    prefix TEXT NOT NULL,
    next_value INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS license (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    payload_json TEXT NOT NULL,
    signature_b64 TEXT NOT NULL,
    activated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_active ON items(is_active, name);
CREATE INDEX IF NOT EXISTS idx_items_section ON items(store_section_id);
CREATE INDEX IF NOT EXISTS idx_item_departments_dept ON item_departments(department_id);
CREATE INDEX IF NOT EXISTS idx_collections_date ON collections(collection_date, status);
CREATE INDEX IF NOT EXISTS idx_collection_lines_return ON collection_lines(is_returnable, return_status);
CREATE INDEX IF NOT EXISTS idx_movements_item_created ON stock_movements(item_id, created_at);
CREATE INDEX IF NOT EXISTS idx_movements_dept_date ON stock_movements(department_id, business_date);
CREATE INDEX IF NOT EXISTS idx_movements_type_date ON stock_movements(type, business_date);
CREATE INDEX IF NOT EXISTS idx_activity_at ON activity_log(at DESC);
