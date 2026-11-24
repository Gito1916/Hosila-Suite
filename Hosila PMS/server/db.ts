import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateTransactionTax,
  domainForChargeCategory,
  roundMoneyValue,
  type TaxAppliesTo,
  type TaxMode,
} from './tax.ts';
import {
  computeNights,
  formatDateOffsetLocal,
  getServerLocalIsoDate,
  roundMoney,
} from './utils.ts';

export { computeNights, roundMoney };

export type StaffRole = 'management' | 'accountant' | 'auditor' | 'front_desk' | 'restaurant';

export interface TaxRuleRow {
  id: number;
  name: string;
  rate: number;
  mode: TaxMode;
  applies_to: TaxAppliesTo;
  enabled: number;
  sort_order: number;
  created_at: string;
}

export interface HotelSettings {
  hotel_name: string;
  hotel_tagline: string;
  hotel_address: string;
  hotel_phone: string;
  hotel_email: string;
  hotel_website: string;
  hotel_logo_url: string;
  check_in_time: string;
  check_out_time: string;
  tax_id: string;
  currency_symbol: string;
  tax_enabled: number;
  tax_name: string;
  tax_rate: number;
  tax_mode: TaxMode;
  tax_applies_to: TaxAppliesTo;
  tax_rules: TaxRuleRow[];
  pos_enabled: number;
  email_enabled: number;
  email_on_reservation: number;
  email_on_checkin: number;
  email_on_checkout: number;
  resend_from_email: string;
  resend_key_configured: boolean;
  resend_key_source: 'settings' | 'env' | 'none';
  business_date: string;
  night_audit_enabled: number;
  night_audit_time: string;
  auto_backup_after_audit: number;
  backup_retention_count: number;
  last_night_audit_date: string;
  last_night_audit_at: string;
}

export interface EmailTemplateRow {
  event_type: 'reservation' | 'checkin' | 'checkout';
  subject: string;
  headline: string;
  intro_text: string;
  body_text: string;
  closing_text: string;
  show_logo: number;
  show_stay_details: number;
  show_folio_summary: number;
  show_contact_footer: number;
}

export interface StaffUserRow {
  id: number;
  full_name: string;
  username: string;
  role: StaffRole;
  password_hash: string;
  active: number;
  created_at: string;
}

export interface PublicStaffUser {
  id: number;
  full_name: string;
  username: string;
  role: StaffRole;
  active: number;
  created_at: string;
}

export interface ShiftRow {
  id: number;
  user_id: number;
  user_name: string;
  user_role: StaffRole;
  station_name: string;
  opened_at: string;
  closed_at: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash?: number | null;
  cash_variance?: number | null;
  notes: string;
  status: 'open' | 'closed';
}

export type AppCategoryKind = 'expense' | 'extra_income' | 'menu' | 'void_reason';

export interface AppCategoryRow {
  id: number;
  kind: AppCategoryKind;
  name: string;
  account_code: string;
  sort_order: number;
  active: number;
  created_at: string;
}

export interface StaffSessionRow {
  token: string;
  user_id: number;
  full_name: string;
  username: string;
  role: StaffRole;
  shift_id: number;
  shift_opened_at: string;
  station_name: string;
  created_at: string;
  expires_at: string;
}

export interface ExpenseRow {
  id: number;
  expense_date: string;
  category: string;
  description: string;
  vendor: string;
  payment_method: 'cash' | 'card' | 'bank_transfer' | 'corporate';
  reference: string;
  amount: number;
  recorded_by: string;
  created_at: string;
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
  shift_id?: number | null;
}

export interface ExtraIncomeRow {
  id: number;
  income_date: string;
  category: string;
  description: string;
  payer: string;
  payment_method: 'cash' | 'card' | 'bank_transfer' | 'corporate';
  reference: string;
  amount: number;
  recorded_by: string;
  created_at: string;
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
  shift_id?: number | null;
}

export interface RoomRow {
  id: number;
  room_number: string;
  floor: number;
  room_type: string;
  nightly_rate: number;
  capacity: number;
  housekeeping_status: 'clean' | 'dirty' | 'inspecting' | 'maintenance';
  notes: string;
}

export interface GuestRow {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  id_number: string;
  company: string;
  notes: string;
  created_at: string;
}

export interface StayRow {
  id: number;
  confirmation_code: string;
  guest_id: number;
  room_id: number | null;
  requested_room_type: string;
  check_in_date: string;
  check_out_date: string;
  actual_check_in: string | null;
  actual_check_out: string | null;
  nightly_rate: number;
  adults: number;
  status: 'reserved' | 'checked_in' | 'checked_out' | 'cancelled';
  notes: string;
  estimated_subtotal: number;
  estimated_tax: number;
  estimated_total: number;
  tax_label: string;
  tax_mode: TaxMode;
  tax_breakdown_json: string;
  deferred_settlement?: number;
  deferred_reason?: string;
  deferred_due_date?: string;
  deferred_authorized_by?: string;
  created_at: string;
}

export interface FolioChargeRow {
  id: number;
  stay_id: number;
  category: 'room' | 'restaurant_pos' | 'restaurant_manual' | 'service' | 'tax_adjustment';
  description: string;
  reference_code: string;
  quantity: number;
  unit_price: number;
  amount: number;
  tax_amount: number;
  total_amount: number;
  tax_label: string;
  tax_breakdown_json: string;
  posted_by_station: string;
  posted_at: string;
  voided: number;
  void_reason: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
  billing_split?: 'personal' | 'company';
}

export interface FolioPaymentRow {
  id: number;
  stay_id: number;
  amount: number;
  method: 'cash' | 'card' | 'bank_transfer' | 'corporate';
  reference: string;
  recorded_by_station: string;
  recorded_at: string;
  kind?: 'payment' | 'refund';
  billing_split?: 'personal' | 'company';
  shift_id?: number | null;
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
}

export interface MenuItemRow {
  id: number;
  name: string;
  category: string;
  price: number;
  available: number;
  description: string;
}

export interface PosOrderRow {
  id: number;
  order_number: string;
  stay_id: number | null;
  room_number: string;
  guest_name: string;
  dining_type: 'dine_in' | 'room_service' | 'takeaway';
  table_number: string;
  items_json: string;
  subtotal: number;
  tax_amount: number;
  total_amount: number;
  tax_breakdown_json: string;
  settlement: 'folio' | 'cash' | 'card' | 'bank_transfer' | 'unpaid';
  payment_status: 'paid' | 'unpaid';
  payment_reference: string;
  paid_at: string | null;
  status: 'open' | 'preparing' | 'served' | 'closed';
  notes: string;
  station_name: string;
  created_at: string;
  shift_id?: number | null;
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
}

export interface EmailLogRow {
  id: number;
  stay_id: number | null;
  event_type: 'reservation' | 'checkin' | 'checkout' | 'manual';
  recipient_email: string;
  recipient_name: string;
  subject: string;
  body_text: string;
  body_html?: string;
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  provider_id: string;
  error_message: string;
  created_at: string;
  sent_at: string | null;
}

export const DATA_DIR = process.env.HOSILA_DATA_DIR
  ? path.resolve(process.env.HOSILA_DATA_DIR)
  : path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export const DB_FILE_PATH = path.join(DATA_DIR, 'hotel.db');

export let db = new Database(DB_FILE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

export function closeDatabaseGracefully(): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Ignore checkpoint errors during shutdown
  }
  try {
    db.close();
  } catch {
    // Already closed
  }
}

/**
 * Safely closes the active SQLite handle, replaces the database file from a verified
 * backup snapshot, removes stale WAL/SHM sidecars, reopens the connection, and re-runs
 * schema migrations. ES module live bindings ensure all importers immediately use the new `db`.
 */
export function replaceDatabaseFromFile(verifiedBackupPath: string): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch {
    // Ignore checkpoint errors before closing
  }
  db.close();

  const walPath = `${DB_FILE_PATH}-wal`;
  const shmPath = `${DB_FILE_PATH}-shm`;
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

  fs.copyFileSync(verifiedBackupPath, DB_FILE_PATH);

  db = new Database(DB_FILE_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  initDatabase();
}

function ensureSettingsColumns(): void {
  const cols = db.prepare('PRAGMA table_info(settings)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('hotel_tagline')) {
    db.exec("ALTER TABLE settings ADD COLUMN hotel_tagline TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('hotel_email')) {
    db.exec("ALTER TABLE settings ADD COLUMN hotel_email TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('hotel_website')) {
    db.exec("ALTER TABLE settings ADD COLUMN hotel_website TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('hotel_logo_url')) {
    db.exec("ALTER TABLE settings ADD COLUMN hotel_logo_url TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('check_in_time')) {
    db.exec("ALTER TABLE settings ADD COLUMN check_in_time TEXT NOT NULL DEFAULT '14:00'");
  }
  if (!names.has('check_out_time')) {
    db.exec("ALTER TABLE settings ADD COLUMN check_out_time TEXT NOT NULL DEFAULT '11:00'");
  }
  if (!names.has('tax_id')) {
    db.exec("ALTER TABLE settings ADD COLUMN tax_id TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('tax_enabled')) {
    db.exec('ALTER TABLE settings ADD COLUMN tax_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!names.has('tax_name')) {
    db.exec("ALTER TABLE settings ADD COLUMN tax_name TEXT NOT NULL DEFAULT 'VAT'");
  }
  if (!names.has('tax_mode')) {
    db.exec("ALTER TABLE settings ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'exclusive'");
  }
  if (!names.has('tax_applies_to')) {
    db.exec("ALTER TABLE settings ADD COLUMN tax_applies_to TEXT NOT NULL DEFAULT 'both'");
  }
  if (!names.has('email_enabled')) {
    db.exec('ALTER TABLE settings ADD COLUMN email_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!names.has('resend_api_key')) {
    db.exec("ALTER TABLE settings ADD COLUMN resend_api_key TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('resend_from_email')) {
    db.exec("ALTER TABLE settings ADD COLUMN resend_from_email TEXT NOT NULL DEFAULT ''");
  }
  const todayIso = getServerLocalIsoDate();
  if (!names.has('business_date')) {
    db.exec(`ALTER TABLE settings ADD COLUMN business_date TEXT NOT NULL DEFAULT '${todayIso}'`);
  }
  if (!names.has('night_audit_enabled')) {
    db.exec('ALTER TABLE settings ADD COLUMN night_audit_enabled INTEGER NOT NULL DEFAULT 1');
  }
  if (!names.has('night_audit_time')) {
    db.exec("ALTER TABLE settings ADD COLUMN night_audit_time TEXT NOT NULL DEFAULT '02:00'");
  }
  if (!names.has('auto_backup_after_audit')) {
    db.exec('ALTER TABLE settings ADD COLUMN auto_backup_after_audit INTEGER NOT NULL DEFAULT 1');
  }
  if (!names.has('backup_retention_count')) {
    db.exec('ALTER TABLE settings ADD COLUMN backup_retention_count INTEGER NOT NULL DEFAULT 30');
  }
  if (!names.has('last_night_audit_date')) {
    db.exec("ALTER TABLE settings ADD COLUMN last_night_audit_date TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('last_night_audit_at')) {
    db.exec("ALTER TABLE settings ADD COLUMN last_night_audit_at TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('currency_migrated_ngn')) {
    db.exec('ALTER TABLE settings ADD COLUMN currency_migrated_ngn INTEGER NOT NULL DEFAULT 0');
    db.prepare(
      "UPDATE settings SET currency_symbol = '₦', currency_migrated_ngn = 1 WHERE id = 1 AND currency_symbol = '$'"
    ).run();
    db.prepare('UPDATE settings SET currency_migrated_ngn = 1 WHERE id = 1').run();
  }
}

function ensureFolioChargesColumns(): void {
  const cols = db.prepare('PRAGMA table_info(folio_charges)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('tax_amount')) {
    db.exec('ALTER TABLE folio_charges ADD COLUMN tax_amount REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('total_amount')) {
    db.exec('ALTER TABLE folio_charges ADD COLUMN total_amount REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('tax_label')) {
    db.exec("ALTER TABLE folio_charges ADD COLUMN tax_label TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('tax_breakdown_json')) {
    db.exec("ALTER TABLE folio_charges ADD COLUMN tax_breakdown_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!names.has('billing_split')) {
    db.exec("ALTER TABLE folio_charges ADD COLUMN billing_split TEXT NOT NULL DEFAULT 'personal'");
  }
  if (!names.has('voided_by')) {
    db.exec("ALTER TABLE folio_charges ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_by_role')) {
    db.exec("ALTER TABLE folio_charges ADD COLUMN voided_by_role TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_at')) {
    db.exec('ALTER TABLE folio_charges ADD COLUMN voided_at TEXT');
  }
}

function ensureFolioPaymentsColumns(): void {
  const cols = db.prepare('PRAGMA table_info(folio_payments)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('kind')) {
    db.exec("ALTER TABLE folio_payments ADD COLUMN kind TEXT NOT NULL DEFAULT 'payment'");
  }
  if (!names.has('billing_split')) {
    db.exec("ALTER TABLE folio_payments ADD COLUMN billing_split TEXT NOT NULL DEFAULT 'personal'");
  }
  if (!names.has('shift_id')) {
    db.exec('ALTER TABLE folio_payments ADD COLUMN shift_id INTEGER');
  }
  if (!names.has('voided')) {
    db.exec('ALTER TABLE folio_payments ADD COLUMN voided INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('void_reason')) {
    db.exec("ALTER TABLE folio_payments ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_by')) {
    db.exec("ALTER TABLE folio_payments ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_by_role')) {
    db.exec("ALTER TABLE folio_payments ADD COLUMN voided_by_role TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_at')) {
    db.exec('ALTER TABLE folio_payments ADD COLUMN voided_at TEXT');
  }
}

function ensurePosOrdersColumns(): void {
  const cols = db.prepare('PRAGMA table_info(pos_orders)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('tax_breakdown_json')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN tax_breakdown_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!names.has('payment_status')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'paid'");
  }
  if (!names.has('payment_reference')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN payment_reference TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('paid_at')) {
    db.exec('ALTER TABLE pos_orders ADD COLUMN paid_at TEXT');
  }
  if (!names.has('shift_id')) {
    db.exec('ALTER TABLE pos_orders ADD COLUMN shift_id INTEGER');
  }
  if (!names.has('voided')) {
    db.exec('ALTER TABLE pos_orders ADD COLUMN voided INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('void_reason')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_by')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_by_role')) {
    db.exec("ALTER TABLE pos_orders ADD COLUMN voided_by_role TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('voided_at')) {
    db.exec('ALTER TABLE pos_orders ADD COLUMN voided_at TEXT');
  }
}

function ensureShiftsAndFinanceColumns(): void {
  const shiftCols = db.prepare('PRAGMA table_info(shifts)').all() as Array<{ name: string }>;
  const shiftNames = new Set(shiftCols.map((c) => c.name));
  if (!shiftNames.has('expected_cash')) {
    db.exec('ALTER TABLE shifts ADD COLUMN expected_cash REAL');
  }
  if (!shiftNames.has('cash_variance')) {
    db.exec('ALTER TABLE shifts ADD COLUMN cash_variance REAL');
  }

  for (const table of ['expenses', 'extra_income'] as const) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('shift_id')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN shift_id INTEGER`);
    }
    if (!names.has('voided')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN voided INTEGER NOT NULL DEFAULT 0`);
    }
    if (!names.has('void_reason')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN void_reason TEXT NOT NULL DEFAULT ''`);
    }
    if (!names.has('voided_by')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN voided_by TEXT NOT NULL DEFAULT ''`);
    }
    if (!names.has('voided_by_role')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN voided_by_role TEXT NOT NULL DEFAULT ''`);
    }
    if (!names.has('voided_at')) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN voided_at TEXT`);
    }
  }
}

function ensureStaysSchema(): void {
  const cols = db.prepare('PRAGMA table_info(stays)').all() as Array<{ name: string; notnull: number }>;
  const roomCol = cols.find((c) => c.name === 'room_id');
  const names = new Set(cols.map((c) => c.name));

  // If room_id is NOT NULL from older schema, rebuild stays table so unassigned reservations (room_id = NULL) work
  if (roomCol && roomCol.notnull === 1) {
    db.pragma('foreign_keys = OFF');
    const migrate = db.transaction(() => {
      db.exec(`
        CREATE TABLE stays_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          confirmation_code TEXT NOT NULL UNIQUE,
          guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
          room_id INTEGER REFERENCES rooms(id) ON DELETE RESTRICT,
          requested_room_type TEXT NOT NULL DEFAULT '',
          check_in_date TEXT NOT NULL,
          check_out_date TEXT NOT NULL,
          actual_check_in TEXT,
          actual_check_out TEXT,
          nightly_rate REAL NOT NULL,
          adults INTEGER NOT NULL DEFAULT 1,
          status TEXT NOT NULL DEFAULT 'reserved',
          notes TEXT NOT NULL DEFAULT '',
          estimated_subtotal REAL NOT NULL DEFAULT 0,
          estimated_tax REAL NOT NULL DEFAULT 0,
          estimated_total REAL NOT NULL DEFAULT 0,
          tax_label TEXT NOT NULL DEFAULT '',
          tax_mode TEXT NOT NULL DEFAULT 'exclusive',
          created_at TEXT NOT NULL
        );

        INSERT INTO stays_new (
          id, confirmation_code, guest_id, room_id, requested_room_type,
          check_in_date, check_out_date, actual_check_in, actual_check_out,
          nightly_rate, adults, status, notes, created_at
        )
        SELECT
          s.id, s.confirmation_code, s.guest_id, s.room_id, COALESCE(r.room_type, ''),
          s.check_in_date, s.check_out_date, s.actual_check_in, s.actual_check_out,
          s.nightly_rate, s.adults, s.status, s.notes, s.created_at
        FROM stays s
        LEFT JOIN rooms r ON r.id = s.room_id;

        DROP TABLE stays;
        ALTER TABLE stays_new RENAME TO stays;
        CREATE INDEX IF NOT EXISTS idx_stays_status ON stays(status);
        CREATE INDEX IF NOT EXISTS idx_stays_dates ON stays(check_in_date, check_out_date);
      `);
    });
    migrate();
    db.pragma('foreign_keys = ON');
    return;
  }

  if (!names.has('requested_room_type')) {
    db.exec("ALTER TABLE stays ADD COLUMN requested_room_type TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('estimated_subtotal')) {
    db.exec('ALTER TABLE stays ADD COLUMN estimated_subtotal REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('estimated_tax')) {
    db.exec('ALTER TABLE stays ADD COLUMN estimated_tax REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('estimated_total')) {
    db.exec('ALTER TABLE stays ADD COLUMN estimated_total REAL NOT NULL DEFAULT 0');
  }
  if (!names.has('tax_label')) {
    db.exec("ALTER TABLE stays ADD COLUMN tax_label TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('tax_mode')) {
    db.exec("ALTER TABLE stays ADD COLUMN tax_mode TEXT NOT NULL DEFAULT 'exclusive'");
  }
  if (!names.has('tax_breakdown_json')) {
    db.exec("ALTER TABLE stays ADD COLUMN tax_breakdown_json TEXT NOT NULL DEFAULT '[]'");
  }
  if (!names.has('deferred_settlement')) {
    db.exec('ALTER TABLE stays ADD COLUMN deferred_settlement INTEGER NOT NULL DEFAULT 0');
  }
  if (!names.has('deferred_reason')) {
    db.exec("ALTER TABLE stays ADD COLUMN deferred_reason TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('deferred_due_date')) {
    db.exec("ALTER TABLE stays ADD COLUMN deferred_due_date TEXT NOT NULL DEFAULT ''");
  }
  if (!names.has('deferred_authorized_by')) {
    db.exec("ALTER TABLE stays ADD COLUMN deferred_authorized_by TEXT NOT NULL DEFAULT ''");
  }
}

function backfillTaxColumns(): void {
  const settings = getSettings();

  // Backfill legacy folio_charges where total_amount is still 0
  const legacyCharges = db
    .prepare('SELECT id, category, amount FROM folio_charges WHERE total_amount = 0 AND amount > 0')
    .all() as Array<{ id: number; category: string; amount: number }>;

  if (legacyCharges.length > 0) {
    const upd = db.prepare(
      'UPDATE folio_charges SET amount = ?, tax_amount = ?, total_amount = ?, tax_label = ? WHERE id = ?'
    );
    const tx = db.transaction(() => {
      for (const ch of legacyCharges) {
        const calc = calculateTransactionTax(ch.amount, domainForChargeCategory(ch.category), settings);
        upd.run(
          calc.netAmount,
          calc.taxAmount,
          calc.totalAmount,
          calc.applicable ? `${calc.taxName} (${calc.taxRate}%)` : '',
          ch.id
        );
      }
    });
    tx();
  }

  // Backfill reservations missing estimated_total
  const legacyStays = db
    .prepare(
      `SELECT s.id, s.check_in_date, s.check_out_date, s.nightly_rate, s.requested_room_type, r.room_type AS joined_room_type
       FROM stays s
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE s.estimated_total = 0`
    )
    .all() as Array<{
    id: number;
    check_in_date: string;
    check_out_date: string;
    nightly_rate: number;
    requested_room_type: string;
    joined_room_type: string | null;
  }>;

  if (legacyStays.length > 0) {
    const updStay = db.prepare(
      `UPDATE stays
       SET requested_room_type = ?, estimated_subtotal = ?, estimated_tax = ?, estimated_total = ?, tax_label = ?, tax_mode = ?
       WHERE id = ?`
    );
    const tx = db.transaction(() => {
      for (const s of legacyStays) {
        const nights = computeNights(s.check_in_date, s.check_out_date);
        const calc = calculateTransactionTax(nights * s.nightly_rate, 'accommodation', settings);
        updStay.run(
          s.requested_room_type || s.joined_room_type || '',
          calc.netAmount,
          calc.taxAmount,
          calc.totalAmount,
          calc.applicable ? `${calc.taxName} (${calc.taxRate}%)` : '',
          calc.taxMode,
          s.id
        );
      }
    });
    tx();
  }
}

function ensureEmailLogsColumns(): void {
  const cols = db.prepare('PRAGMA table_info(email_logs)').all() as Array<{ name: string }>;
  const names = new Set(cols.map((c) => c.name));
  if (!names.has('body_html')) {
    db.exec("ALTER TABLE email_logs ADD COLUMN body_html TEXT NOT NULL DEFAULT ''");
  }
}

export function initDatabase(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      description TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      hotel_name TEXT NOT NULL DEFAULT '',
      hotel_tagline TEXT NOT NULL DEFAULT '',
      hotel_address TEXT NOT NULL DEFAULT '',
      hotel_phone TEXT NOT NULL DEFAULT '',
      hotel_email TEXT NOT NULL DEFAULT '',
      hotel_website TEXT NOT NULL DEFAULT '',
      hotel_logo_url TEXT NOT NULL DEFAULT '',
      check_in_time TEXT NOT NULL DEFAULT '14:00',
      check_out_time TEXT NOT NULL DEFAULT '11:00',
      tax_id TEXT NOT NULL DEFAULT '',
      currency_symbol TEXT NOT NULL DEFAULT '₦',
      tax_enabled INTEGER NOT NULL DEFAULT 1,
      tax_name TEXT NOT NULL DEFAULT 'VAT',
      tax_rate REAL NOT NULL DEFAULT 7.5,
      tax_mode TEXT NOT NULL DEFAULT 'exclusive',
      tax_applies_to TEXT NOT NULL DEFAULT 'both',
      pos_enabled INTEGER NOT NULL DEFAULT 1,
      email_enabled INTEGER NOT NULL DEFAULT 1,
      email_on_reservation INTEGER NOT NULL DEFAULT 1,
      email_on_checkin INTEGER NOT NULL DEFAULT 1,
      email_on_checkout INTEGER NOT NULL DEFAULT 1,
      resend_api_key TEXT NOT NULL DEFAULT '',
      resend_from_email TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tax_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      rate REAL NOT NULL,
      mode TEXT NOT NULL DEFAULT 'exclusive',
      applies_to TEXT NOT NULL DEFAULT 'both',
      enabled INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_templates (
      event_type TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      headline TEXT NOT NULL,
      intro_text TEXT NOT NULL,
      body_text TEXT NOT NULL,
      closing_text TEXT NOT NULL,
      show_logo INTEGER NOT NULL DEFAULT 1,
      show_stay_details INTEGER NOT NULL DEFAULT 1,
      show_folio_summary INTEGER NOT NULL DEFAULT 1,
      show_contact_footer INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS staff_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL UNIQUE,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS shifts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      station_name TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      closed_at TEXT,
      opening_cash REAL NOT NULL DEFAULT 0,
      closing_cash REAL,
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      expense_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      vendor TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
      reference TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      recorded_by TEXT NOT NULL DEFAULT 'Management',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extra_income (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      income_date TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      payer TEXT NOT NULL DEFAULT '',
      payment_method TEXT NOT NULL DEFAULT 'bank_transfer',
      reference TEXT NOT NULL DEFAULT '',
      amount REAL NOT NULL,
      recorded_by TEXT NOT NULL DEFAULT 'Management',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number TEXT NOT NULL UNIQUE,
      floor INTEGER NOT NULL,
      room_type TEXT NOT NULL,
      nightly_rate REAL NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 2,
      housekeeping_status TEXT NOT NULL DEFAULT 'clean',
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS guests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      email TEXT NOT NULL DEFAULT '',
      phone TEXT NOT NULL DEFAULT '',
      id_number TEXT NOT NULL DEFAULT '',
      company TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stays (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      confirmation_code TEXT NOT NULL UNIQUE,
      guest_id INTEGER NOT NULL REFERENCES guests(id) ON DELETE RESTRICT,
      room_id INTEGER REFERENCES rooms(id) ON DELETE RESTRICT,
      requested_room_type TEXT NOT NULL DEFAULT '',
      check_in_date TEXT NOT NULL,
      check_out_date TEXT NOT NULL,
      actual_check_in TEXT,
      actual_check_out TEXT,
      nightly_rate REAL NOT NULL,
      adults INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'reserved',
      notes TEXT NOT NULL DEFAULT '',
      estimated_subtotal REAL NOT NULL DEFAULT 0,
      estimated_tax REAL NOT NULL DEFAULT 0,
      estimated_total REAL NOT NULL DEFAULT 0,
      tax_label TEXT NOT NULL DEFAULT '',
      tax_mode TEXT NOT NULL DEFAULT 'exclusive',
      deferred_settlement INTEGER NOT NULL DEFAULT 0,
      deferred_reason TEXT NOT NULL DEFAULT '',
      deferred_due_date TEXT NOT NULL DEFAULT '',
      deferred_authorized_by TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS folio_charges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      description TEXT NOT NULL,
      reference_code TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1,
      unit_price REAL NOT NULL,
      amount REAL NOT NULL,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      tax_label TEXT NOT NULL DEFAULT '',
      posted_by_station TEXT NOT NULL DEFAULT 'Front Desk',
      posted_at TEXT NOT NULL,
      voided INTEGER NOT NULL DEFAULT 0,
      void_reason TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS folio_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
      amount REAL NOT NULL,
      method TEXT NOT NULL DEFAULT 'card',
      reference TEXT NOT NULL DEFAULT '',
      recorded_by_station TEXT NOT NULL DEFAULT 'Front Desk',
      recorded_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price REAL NOT NULL,
      available INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS pos_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      stay_id INTEGER REFERENCES stays(id) ON DELETE SET NULL,
      room_number TEXT NOT NULL DEFAULT '',
      guest_name TEXT NOT NULL DEFAULT 'Walk-In Guest',
      dining_type TEXT NOT NULL DEFAULT 'dine_in',
      table_number TEXT NOT NULL DEFAULT '',
      items_json TEXT NOT NULL,
      subtotal REAL NOT NULL,
      tax_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      tax_breakdown_json TEXT NOT NULL DEFAULT '[]',
      settlement TEXT NOT NULL DEFAULT 'folio',
      payment_status TEXT NOT NULL DEFAULT 'paid',
      payment_reference TEXT NOT NULL DEFAULT '',
      paid_at TEXT,
      status TEXT NOT NULL DEFAULT 'served',
      notes TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL DEFAULT 'Restaurant POS',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS email_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stay_id INTEGER REFERENCES stays(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      recipient_email TEXT NOT NULL,
      recipient_name TEXT NOT NULL,
      subject TEXT NOT NULL,
      body_text TEXT NOT NULL,
      body_html TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      provider_id TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      sent_at TEXT
    );

    CREATE TABLE IF NOT EXISTS staff_sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES staff_users(id) ON DELETE CASCADE,
      full_name TEXT NOT NULL,
      username TEXT NOT NULL,
      role TEXT NOT NULL,
      shift_id INTEGER NOT NULL,
      shift_opened_at TEXT NOT NULL,
      station_name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sequences (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('expense', 'extra_income', 'menu', 'void_reason')),
      name TEXT NOT NULL,
      account_code TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      UNIQUE(kind, name)
    );

    CREATE INDEX IF NOT EXISTS idx_stays_status ON stays(status);
    CREATE INDEX IF NOT EXISTS idx_stays_dates ON stays(check_in_date, check_out_date);
    CREATE INDEX IF NOT EXISTS idx_folio_charges_stay ON folio_charges(stay_id);
    CREATE INDEX IF NOT EXISTS idx_folio_payments_stay ON folio_payments(stay_id);
    CREATE INDEX IF NOT EXISTS idx_pos_orders_created ON pos_orders(created_at);
    CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(expense_date);
    CREATE INDEX IF NOT EXISTS idx_extra_income_date ON extra_income(income_date);
    CREATE INDEX IF NOT EXISTS idx_staff_sessions_user ON staff_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_staff_sessions_expires ON staff_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_app_categories_kind ON app_categories(kind, active, sort_order);
  `);

  ensureSettingsColumns();
  ensureFolioChargesColumns();
  ensureFolioPaymentsColumns();
  ensurePosOrdersColumns();
  ensureShiftsAndFinanceColumns();
  ensureEmailLogsColumns();
  ensureStaysSchema();

  const existingSettings = db.prepare('SELECT id FROM settings WHERE id = 1').get();
  if (!existingSettings) {
    db.prepare(`
      INSERT INTO settings (
        id, hotel_name, hotel_tagline, hotel_address, hotel_phone, hotel_email, hotel_website, hotel_logo_url,
        check_in_time, check_out_time, tax_id, currency_symbol, tax_enabled, tax_name, tax_rate, tax_mode, tax_applies_to,
        pos_enabled, email_enabled, email_on_reservation, email_on_checkin, email_on_checkout, resend_api_key, resend_from_email
      )
      VALUES (
        1, '', '', '', '', '', '', '',
        '14:00', '11:00', '', '₦', 1, 'VAT', 7.5, 'exclusive', 'both', 1, 1, 1, 1, 1, '', ''
      )
    `).run();
  }

  seedInitialTaxRules();
  seedDefaultEmailTemplates();
  seedInitialCategoriesIfEmpty();
  backfillTaxColumns();

  db.prepare(
    `INSERT OR IGNORE INTO schema_migrations (version, description, applied_at)
     VALUES (?, ?, ?)`
  ).run('1.0.0', 'Baseline Hosila PMS production schema and additive column sync', new Date().toISOString());
}

function seedInitialTaxRules(): void {
  const count = (db.prepare('SELECT COUNT(*) as count FROM tax_rules').get() as { count: number }).count;
  if (count > 0) return;

  const row = db
    .prepare('SELECT tax_name, tax_rate, tax_mode, tax_applies_to FROM settings WHERE id = 1')
    .get() as { tax_name: string; tax_rate: number; tax_mode: string; tax_applies_to: string } | undefined;

  if (row && row.tax_rate > 0) {
    db.prepare(
      `INSERT INTO tax_rules (name, rate, mode, applies_to, enabled, sort_order, created_at)
       VALUES (?, ?, ?, ?, 1, 0, ?)`
    ).run(
      row.tax_name || 'VAT',
      row.tax_rate,
      row.tax_mode === 'inclusive' ? 'inclusive' : 'exclusive',
      ['accommodation', 'restaurant', 'both'].includes(row.tax_applies_to) ? row.tax_applies_to : 'both',
      new Date().toISOString()
    );
  }
}

function seedDefaultEmailTemplates(): void {
  const count = (db.prepare('SELECT COUNT(*) as count FROM email_templates').get() as { count: number }).count;
  if (count >= 3) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO email_templates
      (event_type, subject, headline, intro_text, body_text, closing_text, show_logo, show_stay_details, show_folio_summary, show_contact_footer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insert.run(
    'reservation',
    'Reservation Confirmed · {{confirmation_code}} — {{hotel_name}}',
    'Your Reservation Is Confirmed',
    'Dear {{guest_name}}, thank you for choosing {{hotel_name}}. We are pleased to confirm your upcoming stay with us.',
    'Standard check-in begins at {{check_in_time}} and check-out is at {{check_out_time}}. Early check-in and airport transfers may be arranged through our front desk prior to arrival. Please present a valid photo ID at check-in.',
    'We look forward to welcoming you soon. Should your travel plans change, simply reply to this email or call our reception desk.',
    1,
    1,
    0,
    1
  );

  insert.run(
    'checkin',
    'Welcome to {{hotel_name}} · Room {{room_number}}',
    'Welcome, {{guest_name}}',
    'You are now checked in to Room {{room_number}} at {{hotel_name}}. We hope you settle in comfortably.',
    'Complimentary Wi-Fi is available throughout the property. Standard check-out is at {{check_out_time}}. Breakfast is served daily from 7:00 AM to 10:30 AM in the dining room, and room service is available by dialing 0 from your room telephone.',
    'Please reach out to the front desk anytime if there is anything we can prepare to make your stay more enjoyable.',
    1,
    1,
    1,
    1
  );

  insert.run(
    'checkout',
    'Checkout Receipt · {{confirmation_code}} — {{hotel_name}}',
    'Thank You for Staying With Us',
    'Dear {{guest_name}}, your checkout from Room {{room_number}} is complete. Please find your itemized guest folio statement below for your records.',
    'We appreciate the opportunity to host you at {{hotel_name}}. If you require an additional corporate invoice copy or have any questions regarding your statement, our accounts desk is happy to assist.',
    'Safe travels, and we hope to welcome you back on your next visit.',
    1,
    1,
    1,
    1
  );
}

function seedInitialCategoriesIfEmpty(): void {
  const nowIso = new Date().toISOString();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO app_categories (kind, name, account_code, sort_order, active, created_at)
    VALUES (?, ?, ?, ?, 1, ?)
  `);

  const count = (db.prepare('SELECT COUNT(*) as count FROM app_categories').get() as { count: number }).count;
  if (count === 0) {
    const defaults: Array<[AppCategoryKind, string, string, number]> = [
      // Expense categories
      ['expense', 'Utilities', '5100', 1],
      ['expense', 'Housekeeping & Supplies', '5200', 2],
      ['expense', 'Kitchen & F&B', '5300', 3],
      ['expense', 'Maintenance', '5400', 4],
      ['expense', 'Payroll', '5500', 5],
      ['expense', 'Marketing', '5600', 6],
      ['expense', 'Other', '5900', 7],
      // Extra income categories
      ['extra_income', 'Conference & Hall Hire', '4400', 1],
      ['extra_income', 'Events & Banquets', '4400', 2],
      ['extra_income', 'Parking & Transfers', '4400', 3],
      ['extra_income', 'Spa & Wellness', '4400', 4],
      ['extra_income', 'Commissions & Tours', '4400', 5],
      ['extra_income', 'Other Income', '4400', 6],
      // Menu categories
      ['menu', 'Breakfast', '', 1],
      ['menu', 'Mains', '', 2],
      ['menu', 'Beverages', '', 3],
      ['menu', 'Desserts', '', 4],
      ['menu', 'Room Service', '', 5],
      // Void reason presets
      ['void_reason', 'Duplicate entry', '', 1],
      ['void_reason', 'Wrong amount posted', '', 2],
      ['void_reason', 'Posted to wrong room/guest', '', 3],
      ['void_reason', 'Guest cancellation', '', 4],
      ['void_reason', 'Order/kitchen error', '', 5],
    ];
    for (const [kind, name, code, order] of defaults) {
      insert.run(kind, name, code, order, nowIso);
    }
  }

  // Sync any existing categories from operational tables so pre-existing records always have matching DB catalog entries
  const existingMenuCats = db.prepare(`SELECT DISTINCT category FROM menu_items WHERE TRIM(category) != ''`).all() as Array<{ category: string }>;
  for (const row of existingMenuCats) {
    insert.run('menu', row.category, '', 99, nowIso);
  }
  const existingExpCats = db.prepare(`SELECT DISTINCT category FROM expenses WHERE TRIM(category) != ''`).all() as Array<{ category: string }>;
  for (const row of existingExpCats) {
    insert.run('expense', row.category, '5900', 99, nowIso);
  }
  const existingIncCats = db.prepare(`SELECT DISTINCT category FROM extra_income WHERE TRIM(category) != ''`).all() as Array<{ category: string }>;
  for (const row of existingIncCats) {
    insert.run('extra_income', row.category, '4400', 99, nowIso);
  }
}

export function getAppCategories(kind?: AppCategoryKind): AppCategoryRow[] {
  if (kind) {
    return db
      .prepare('SELECT * FROM app_categories WHERE kind = ? AND active = 1 ORDER BY sort_order ASC, name ASC')
      .all(kind) as AppCategoryRow[];
  }
  return db
    .prepare('SELECT * FROM app_categories WHERE active = 1 ORDER BY kind ASC, sort_order ASC, name ASC')
    .all() as AppCategoryRow[];
}

export function upsertAppCategory(kind: AppCategoryKind, name: string, accountCode = ''): AppCategoryRow {
  const cleanName = name.trim().slice(0, 64);
  const existing = db
    .prepare('SELECT * FROM app_categories WHERE kind = ? AND LOWER(name) = LOWER(?)')
    .get(kind, cleanName) as AppCategoryRow | undefined;
  if (existing) {
    if (existing.active !== 1) {
      db.prepare('UPDATE app_categories SET active = 1 WHERE id = ?').run(existing.id);
      return { ...existing, active: 1 };
    }
    return existing;
  }
  const maxSort = (
    db.prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM app_categories WHERE kind = ?').get(kind) as { m: number }
  ).m;
  const info = db
    .prepare(
      `INSERT INTO app_categories (kind, name, account_code, sort_order, active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`
    )
    .run(kind, cleanName, accountCode, maxSort + 1, new Date().toISOString());
  return db.prepare('SELECT * FROM app_categories WHERE id = ?').get(Number(info.lastInsertRowid)) as AppCategoryRow;
}

export function getNextSequenceValue(name: string, floorValue: number): number {
  const row = db.prepare('SELECT value FROM sequences WHERE name = ?').get(name) as { value: number } | undefined;
  const next = Math.max(floorValue, row?.value ?? 0) + 1;
  db.prepare(
    `INSERT INTO sequences (name, value) VALUES (?, ?)
     ON CONFLICT(name) DO UPDATE SET value = excluded.value`
  ).run(name, next);
  return next;
}

export function saveStaffSession(row: StaffSessionRow): void {
  db.prepare(
    `INSERT INTO staff_sessions (token, user_id, full_name, username, role, shift_id, shift_opened_at, station_name, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    row.token,
    row.user_id,
    row.full_name,
    row.username,
    row.role,
    row.shift_id,
    row.shift_opened_at,
    row.station_name,
    row.created_at,
    row.expires_at
  );
}

export function getStaffSessionByToken(token: string): StaffSessionRow | undefined {
  return db.prepare('SELECT * FROM staff_sessions WHERE token = ?').get(token) as StaffSessionRow | undefined;
}

export function touchStaffSessionExpiry(token: string, newExpiresAt: string): void {
  db.prepare('UPDATE staff_sessions SET expires_at = ? WHERE token = ?').run(newExpiresAt, token);
}

export function deleteStaffSessionByToken(token: string): void {
  db.prepare('DELETE FROM staff_sessions WHERE token = ?').run(token);
}

export function deleteStaffSessionsForUser(userId: number): void {
  db.prepare('DELETE FROM staff_sessions WHERE user_id = ?').run(userId);
}

export function updateStaffSessionsRole(userId: number, role: StaffRole): void {
  db.prepare('UPDATE staff_sessions SET role = ? WHERE user_id = ?').run(role, userId);
}

export function pruneExpiredStaffSessions(): void {
  db.prepare('DELETE FROM staff_sessions WHERE expires_at <= ?').run(new Date().toISOString());
}

export function getTaxRules(): TaxRuleRow[] {
  return db.prepare('SELECT * FROM tax_rules ORDER BY sort_order ASC, id ASC').all() as TaxRuleRow[];
}

export function syncLegacyTaxSettingsFromRules(): void {
  const rules = getTaxRules();
  const activeRules = rules.filter((r) => r.enabled === 1 && r.rate > 0);
  if (activeRules.length === 0) return;
  const primary = activeRules[0];
  const combinedRate = roundMoneyValue(activeRules.reduce((s, r) => s + r.rate, 0));
  const combinedName = activeRules.length === 1 ? primary.name : 'Taxes';
  db.prepare('UPDATE settings SET tax_name = ?, tax_rate = ?, tax_mode = ?, tax_applies_to = ? WHERE id = 1').run(
    combinedName,
    combinedRate,
    primary.mode,
    primary.applies_to
  );
}

// Server-only helper — NEVER exposed to client API responses
export function getEmailProviderSecrets(): {
  apiKey: string;
  fromEmail: string;
  source: 'settings' | 'env' | 'none';
} {
  const row = db
    .prepare('SELECT resend_api_key, resend_from_email FROM settings WHERE id = 1')
    .get() as { resend_api_key?: string; resend_from_email?: string } | undefined;

  const settingsKey = (row?.resend_api_key ?? '').trim();
  const envKey = (process.env.RESEND_API_KEY ?? '').trim();
  const validEnvKey = envKey && envKey !== 'MY_RESEND_API_KEY' ? envKey : '';

  const apiKey = settingsKey || validEnvKey;
  const source: 'settings' | 'env' | 'none' = settingsKey ? 'settings' : validEnvKey ? 'env' : 'none';

  const settingsFrom = (row?.resend_from_email ?? '').trim();
  const envFrom = (process.env.RESEND_FROM_EMAIL ?? '').trim();
  const fromEmail = settingsFrom || envFrom;

  return { apiKey, fromEmail, source };
}

export function getSettings(): HotelSettings {
  const row = db
    .prepare(
      `SELECT hotel_name, hotel_tagline, hotel_address, hotel_phone, hotel_email, hotel_website, hotel_logo_url,
              check_in_time, check_out_time, tax_id, currency_symbol,
              tax_enabled, tax_name, tax_rate, tax_mode, tax_applies_to,
              pos_enabled, email_enabled, email_on_reservation, email_on_checkin, email_on_checkout,
              resend_from_email,
              business_date, night_audit_enabled, night_audit_time, auto_backup_after_audit,
              backup_retention_count, last_night_audit_date, last_night_audit_at
       FROM settings WHERE id = 1`
    )
    .get() as Omit<HotelSettings, 'tax_rules' | 'resend_key_configured' | 'resend_key_source'>;

  const taxRules = getTaxRules();
  const secrets = getEmailProviderSecrets();

  return {
    ...row,
    tax_rules: taxRules,
    resend_key_configured: secrets.apiKey.length > 0,
    resend_key_source: secrets.source,
  };
}

export function getEmailTemplates(): EmailTemplateRow[] {
  return db.prepare('SELECT * FROM email_templates ORDER BY event_type ASC').all() as EmailTemplateRow[];
}

export function getPublicStaffUsers(): PublicStaffUser[] {
  return db
    .prepare('SELECT id, full_name, username, role, active, created_at FROM staff_users ORDER BY role ASC, full_name ASC')
    .all() as PublicStaffUser[];
}

export interface StayWithDetails extends StayRow {
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  room_number: string;
  room_type: string;
  floor: number;
  charges_subtotal: number;
  tax_amount: number;
  total_billed: number;
  total_paid: number;
  balance_due: number;
  company_billed: number;
  company_paid: number;
  company_balance: number;
  personal_billed: number;
  personal_paid: number;
  personal_balance: number;
}

const STAY_DETAILS_SELECT = `
  SELECT
    s.*,
    g.full_name AS guest_name,
    g.email AS guest_email,
    g.phone AS guest_phone,
    COALESCE(r.room_number, '') AS room_number,
    COALESCE(r.room_type, s.requested_room_type, '') AS room_type,
    COALESCE(r.floor, 0) AS floor,
    (SELECT COUNT(*) FROM folio_charges fc WHERE fc.stay_id = s.id AND fc.voided = 0) AS charge_count,
    COALESCE((SELECT SUM(amount) FROM folio_charges fc WHERE fc.stay_id = s.id AND fc.voided = 0), 0) AS posted_subtotal,
    COALESCE((SELECT SUM(tax_amount) FROM folio_charges fc WHERE fc.stay_id = s.id AND fc.voided = 0), 0) AS posted_tax,
    COALESCE((SELECT SUM(total_amount) FROM folio_charges fc WHERE fc.stay_id = s.id AND fc.voided = 0), 0) AS posted_total,
    COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -fp.amount ELSE fp.amount END) FROM folio_payments fp WHERE fp.stay_id = s.id AND COALESCE(fp.voided, 0) = 0), 0) AS total_paid,
    COALESCE((SELECT SUM(total_amount) FROM folio_charges fc WHERE fc.stay_id = s.id AND fc.voided = 0 AND fc.billing_split = 'company'), 0) AS company_billed,
    COALESCE((SELECT SUM(CASE WHEN fp.kind = 'refund' THEN -fp.amount ELSE fp.amount END) FROM folio_payments fp WHERE fp.stay_id = s.id AND COALESCE(fp.voided, 0) = 0 AND fp.billing_split = 'company'), 0) AS company_paid
  FROM stays s
  JOIN guests g ON g.id = s.guest_id
  LEFT JOIN rooms r ON r.id = s.room_id
`;

type RawStayDetailsRow = StayRow & {
  guest_name: string;
  guest_email: string;
  guest_phone: string;
  room_number: string;
  room_type: string;
  floor: number;
  charge_count: number;
  posted_subtotal: number;
  posted_tax: number;
  posted_total: number;
  total_paid: number;
  company_billed: number;
  company_paid: number;
};

function hydrateStayDetailsRow(s: RawStayDetailsRow): StayWithDetails {
  const useEstimated = s.status === 'reserved' && s.charge_count === 0;
  const subtotal = roundMoney(useEstimated ? s.estimated_subtotal : s.posted_subtotal);
  const taxAmount = roundMoney(useEstimated ? s.estimated_tax : s.posted_tax);
  const totalBilled = roundMoney(useEstimated ? s.estimated_total : s.posted_total);
  const totalPaid = roundMoney(s.total_paid);
  const balanceDue = roundMoney(totalBilled - totalPaid);
  const companyBilled = roundMoney(useEstimated ? 0 : s.company_billed);
  const companyPaid = roundMoney(s.company_paid);
  const companyBalance = roundMoney(companyBilled - companyPaid);
  const personalBilled = roundMoney(totalBilled - companyBilled);
  const personalPaid = roundMoney(totalPaid - companyPaid);
  const personalBalance = roundMoney(personalBilled - personalPaid);

  return {
    ...s,
    room_number: s.room_number || 'Unassigned',
    room_type: s.room_type || s.requested_room_type || '',
    charges_subtotal: subtotal,
    tax_amount: taxAmount,
    total_billed: totalBilled,
    total_paid: totalPaid,
    balance_due: balanceDue,
    company_billed: companyBilled,
    company_paid: companyPaid,
    company_balance: companyBalance,
    personal_billed: personalBilled,
    personal_paid: personalPaid,
    personal_balance: personalBalance,
  };
}

export function getStayDetailsList(): StayWithDetails[] {
  const stays = db
    .prepare(
      `
      ${STAY_DETAILS_SELECT}
      ORDER BY
        CASE s.status
          WHEN 'checked_in' THEN 1
          WHEN 'reserved' THEN 2
          WHEN 'checked_out' THEN 3
          ELSE 4
        END,
        s.check_in_date ASC,
        s.id DESC
    `
    )
    .all() as RawStayDetailsRow[];

  return stays.map(hydrateStayDetailsRow);
}

export function getStayById(stayId: number): StayWithDetails | undefined {
  const row = db.prepare(`${STAY_DETAILS_SELECT} WHERE s.id = ?`).get(stayId) as RawStayDetailsRow | undefined;
  return row ? hydrateStayDetailsRow(row) : undefined;
}

export function getFullBootstrapState(role: StaffRole) {
  const canAccessSettings = role === 'management' || role === 'accountant';
  const canAccessFinance = role === 'management' || role === 'accountant' || role === 'auditor';
  const isRestaurantOnly = role === 'restaurant';
  const settings = getSettings();
  const menuItems = db.prepare('SELECT * FROM menu_items ORDER BY category ASC, name ASC').all() as MenuItemRow[];
  const posOrders = db.prepare('SELECT * FROM pos_orders ORDER BY created_at DESC, id DESC LIMIT 100').all() as PosOrderRow[];
  const allCategories = getAppCategories();

  if (isRestaurantOnly) {
    // Strictly scope restaurant staff to POS + read-only in-house room picker (no guest PII, no balances, no rooms/folios)
    const inHouseRoomPicker = getStayDetailsList()
      .filter((s) => s.status === 'checked_in')
      .map((s) => ({
        ...s,
        guest_email: '',
        guest_phone: '',
        notes: '',
        nightly_rate: 0,
        estimated_subtotal: 0,
        estimated_tax: 0,
        estimated_total: 0,
        charges_subtotal: 0,
        tax_amount: 0,
        total_billed: 0,
        total_paid: 0,
        balance_due: 0,
        company_billed: 0,
        company_paid: 0,
        company_balance: 0,
        personal_billed: 0,
        personal_paid: 0,
        personal_balance: 0,
      }));

    return {
      settings,
      rooms: [],
      guests: [],
      stays: inHouseRoomPicker,
      charges: [],
      payments: [],
      menuItems,
      posOrders,
      emailLogs: [],
      emailTemplates: [],
      expenses: [],
      extraIncome: [],
      staffUsers: [],
      recentShifts: [],
      categories: allCategories.filter((c) => c.kind === 'menu' || c.kind === 'void_reason'),
    };
  }

  const rooms = db.prepare('SELECT * FROM rooms ORDER BY floor ASC, room_number ASC').all() as RoomRow[];
  const guests = db
    .prepare(
      `
      SELECT
        g.*,
        (SELECT COUNT(*) FROM stays s WHERE s.guest_id = g.id AND s.status != 'cancelled') AS stay_count,
        COALESCE((
          SELECT SUM(fc.total_amount)
          FROM folio_charges fc
          JOIN stays s ON s.id = fc.stay_id
          WHERE s.guest_id = g.id AND fc.voided = 0
        ), 0) AS lifetime_spend
      FROM guests g
      ORDER BY g.full_name ASC
    `
    )
    .all();
  const stays = getStayDetailsList();
  const charges = db.prepare('SELECT * FROM folio_charges ORDER BY posted_at DESC, id DESC').all() as FolioChargeRow[];
  const payments = db.prepare('SELECT * FROM folio_payments ORDER BY recorded_at DESC, id DESC').all() as FolioPaymentRow[];
  const emailLogs = canAccessSettings
    ? (db.prepare('SELECT * FROM email_logs ORDER BY created_at DESC, id DESC LIMIT 50').all() as EmailLogRow[])
    : [];
  const emailTemplates = canAccessSettings ? getEmailTemplates() : [];
  const expenses = canAccessFinance
    ? (db.prepare('SELECT * FROM expenses ORDER BY expense_date DESC, id DESC LIMIT 200').all() as ExpenseRow[])
    : [];
  const extraIncome = canAccessFinance
    ? (db.prepare('SELECT * FROM extra_income ORDER BY income_date DESC, id DESC LIMIT 200').all() as ExtraIncomeRow[])
    : [];
  const staffUsers = canAccessSettings ? getPublicStaffUsers() : [];
  const recentShifts = canAccessFinance
    ? (db.prepare('SELECT * FROM shifts ORDER BY opened_at DESC LIMIT 30').all() as ShiftRow[])
    : [];

  return {
    settings,
    rooms,
    guests,
    stays,
    charges,
    payments,
    menuItems,
    posOrders,
    emailLogs,
    emailTemplates,
    expenses,
    extraIncome,
    staffUsers,
    recentShifts,
    categories: allCategories,
  };
}

export function computeReports(fromDate: string, toDate: string) {
  const rooms = db.prepare('SELECT * FROM rooms ORDER BY room_number ASC').all() as RoomRow[];
  const totalRooms = Math.max(rooms.length, 1);

  const start = new Date(`${fromDate}T12:00:00Z`);
  const end = new Date(`${toDate}T12:00:00Z`);
  const days: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < 366) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  if (days.length === 0) {
    days.push(formatDateOffsetLocal(0));
  }

  const stays = db
    .prepare(
      `
      SELECT s.*, COALESCE(r.room_type, s.requested_room_type) AS room_type, COALESCE(r.room_number, '') AS room_number
      FROM stays s
      LEFT JOIN rooms r ON r.id = s.room_id
      WHERE s.status IN ('checked_in', 'checked_out', 'reserved')
    `
    )
    .all() as Array<StayRow & { room_type: string; room_number: string }>;

  const chargesWithContext = db
    .prepare(
      `
      SELECT fc.*, s.confirmation_code, g.full_name AS guest_name,
             COALESCE(r.room_number, 'Unassigned') AS room_number,
             COALESCE(r.room_type, s.requested_room_type, '') AS room_type
      FROM folio_charges fc
      JOIN stays s ON s.id = fc.stay_id
      JOIN guests g ON g.id = s.guest_id
      LEFT JOIN rooms r ON r.id = s.room_id
      WHERE fc.voided = 0
        AND substr(fc.posted_at, 1, 10) >= ?
        AND substr(fc.posted_at, 1, 10) <= ?
    `
    )
    .all(days[0], days[days.length - 1]) as Array<
    FolioChargeRow & { confirmation_code: string; guest_name: string; room_number: string; room_type: string }
  >;

  const walkInOrders = db
    .prepare(
      `
      SELECT * FROM pos_orders
      WHERE settlement != 'folio'
        AND COALESCE(voided, 0) = 0
        AND substr(created_at, 1, 10) >= ?
        AND substr(created_at, 1, 10) <= ?
    `
    )
    .all(days[0], days[days.length - 1]) as PosOrderRow[];

  const paymentsWithContext = db
    .prepare(
      `
      SELECT fp.*, s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
      FROM folio_payments fp
      JOIN stays s ON s.id = fp.stay_id
      JOIN guests g ON g.id = s.guest_id
      LEFT JOIN rooms r ON r.id = s.room_id
      WHERE COALESCE(fp.voided, 0) = 0
        AND substr(fp.recorded_at, 1, 10) >= ?
        AND substr(fp.recorded_at, 1, 10) <= ?
    `
    )
    .all(days[0], days[days.length - 1]) as Array<
    FolioPaymentRow & { confirmation_code: string; guest_name: string; room_number: string }
  >;

  const periodExpenses = db
    .prepare(
      `
      SELECT * FROM expenses
      WHERE expense_date >= ? AND expense_date <= ?
      ORDER BY expense_date DESC, id DESC
    `
    )
    .all(days[0], days[days.length - 1]) as ExpenseRow[];

  const periodExtraIncome = db
    .prepare(
      `
      SELECT * FROM extra_income
      WHERE income_date >= ? AND income_date <= ?
      ORDER BY income_date DESC, id DESC
    `
    )
    .all(days[0], days[days.length - 1]) as ExtraIncomeRow[];

  const activePeriodExpenses = periodExpenses.filter((e) => !e.voided);
  const activePeriodExtraIncome = periodExtraIncome.filter((e) => !e.voided);

  let totalOccupiedRoomNights = 0;
  const dailySeries = days.map((day) => {
    const occupiedRoomsForDay = new Set<number>();
    for (const s of stays) {
      if (s.status === 'cancelled' || s.room_id === null) continue;
      if ((s.status === 'checked_in' || s.status === 'checked_out') && s.check_in_date <= day && s.check_out_date > day) {
        occupiedRoomsForDay.add(s.room_id);
      }
    }
    const occupiedCount = occupiedRoomsForDay.size;
    totalOccupiedRoomNights += occupiedCount;
    const occupancyPct = roundMoney((occupiedCount / totalRooms) * 100);

    let roomRev = 0;
    let restaurantRev = 0;
    let serviceRev = 0;
    let otherRev = 0;
    let dayExpenses = 0;

    for (const c of chargesWithContext) {
      if (c.posted_at.slice(0, 10) === day) {
        if (c.category === 'room') roomRev += c.amount;
        else if (c.category === 'restaurant_pos' || c.category === 'restaurant_manual') restaurantRev += c.amount;
        else serviceRev += c.amount;
      }
    }
    for (const o of walkInOrders) {
      if (o.created_at.slice(0, 10) === day) {
        restaurantRev += o.subtotal;
      }
    }
    for (const ei of activePeriodExtraIncome) {
      if (ei.income_date === day) {
        otherRev += ei.amount;
      }
    }
    for (const exp of activePeriodExpenses) {
      if (exp.expense_date === day) {
        dayExpenses += exp.amount;
      }
    }

    return {
      date: day,
      label: day.slice(5),
      occupiedRooms: occupiedCount,
      availableRooms: totalRooms - occupiedCount,
      occupancyPct,
      roomRevenue: roundMoney(roomRev),
      restaurantRevenue: roundMoney(restaurantRev),
      serviceRevenue: roundMoney(serviceRev),
      otherIncome: roundMoney(otherRev),
      totalRevenue: roundMoney(roomRev + restaurantRev + serviceRev + otherRev),
      expenses: roundMoney(dayExpenses),
    };
  });

  const roomRevenueTotal = roundMoney(dailySeries.reduce((sum, d) => sum + d.roomRevenue, 0));
  const restaurantPosRevenue = roundMoney(
    chargesWithContext.filter((c) => c.category === 'restaurant_pos').reduce((s, c) => s + c.amount, 0) +
      walkInOrders.reduce((s, o) => s + o.subtotal, 0)
  );
  const restaurantManualRevenue = roundMoney(
    chargesWithContext.filter((c) => c.category === 'restaurant_manual').reduce((s, c) => s + c.amount, 0)
  );
  const restaurantRevenueTotal = roundMoney(restaurantPosRevenue + restaurantManualRevenue);
  const serviceRevenueTotal = roundMoney(dailySeries.reduce((sum, d) => sum + d.serviceRevenue, 0));
  const frontDeskRevenueTotal = roundMoney(roomRevenueTotal + serviceRevenueTotal);
  const otherIncomeTotal = roundMoney(activePeriodExtraIncome.reduce((sum, ei) => sum + ei.amount, 0));

  const grossRevenue = roundMoney(frontDeskRevenueTotal + restaurantRevenueTotal + otherIncomeTotal);
  const totalExpenses = roundMoney(activePeriodExpenses.reduce((sum, e) => sum + e.amount, 0));
  const netOperatingIncome = roundMoney(grossRevenue - totalExpenses);

  const accommodationTaxCollected = roundMoney(
    chargesWithContext.filter((c) => c.category === 'room').reduce((s, c) => s + c.tax_amount, 0)
  );
  const restaurantTaxCollected = roundMoney(
    chargesWithContext
      .filter((c) => c.category === 'restaurant_pos' || c.category === 'restaurant_manual')
      .reduce((s, c) => s + c.tax_amount, 0) +
      walkInOrders.reduce((s, o) => s + o.tax_amount, 0)
  );
  const taxCollected = roundMoney(accommodationTaxCollected + restaurantTaxCollected);

  const paidWalkInOrders = walkInOrders.filter((o) => o.payment_status !== 'unpaid');

  const paymentsCollected = roundMoney(
    paymentsWithContext.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0) +
      paidWalkInOrders.reduce((s, o) => s + o.total_amount, 0) +
      otherIncomeTotal
  );

  const totalAvailableRoomNights = totalRooms * days.length;
  const averageOccupancyPct =
    totalAvailableRoomNights > 0 ? roundMoney((totalOccupiedRoomNights / totalAvailableRoomNights) * 100) : 0;
  const adr = totalOccupiedRoomNights > 0 ? roundMoney(roomRevenueTotal / totalOccupiedRoomNights) : 0;
  const revpar = totalAvailableRoomNights > 0 ? roundMoney(roomRevenueTotal / totalAvailableRoomNights) : 0;

  const allStays = getStayDetailsList();
  const outstandingBalance = roundMoney(
    allStays.filter((s) => s.status !== 'cancelled' && s.balance_due > 0).reduce((s, st) => s + st.balance_due, 0)
  );
  const unpaidPosSnapshot = db
    .prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total FROM pos_orders WHERE payment_status = 'unpaid' AND COALESCE(voided, 0) = 0")
    .get() as { cnt: number; total: number };
  const unpaidPosTabsCount = unpaidPosSnapshot.cnt;
  const unpaidPosTabsTotal = roundMoney(unpaidPosSnapshot.total);

  const departmentRevenue: Array<{ department: 'Front Desk' | 'Restaurant' | 'Other Income'; revenue: number; sharePct: number }> = [
    {
      department: 'Front Desk',
      revenue: frontDeskRevenueTotal,
      sharePct: grossRevenue > 0 ? roundMoney((frontDeskRevenueTotal / grossRevenue) * 100) : 0,
    },
    {
      department: 'Restaurant',
      revenue: restaurantRevenueTotal,
      sharePct: grossRevenue > 0 ? roundMoney((restaurantRevenueTotal / grossRevenue) * 100) : 0,
    },
    {
      department: 'Other Income',
      revenue: otherIncomeTotal,
      sharePct: grossRevenue > 0 ? roundMoney((otherIncomeTotal / grossRevenue) * 100) : 0,
    },
  ];

  const roomTypesMap = new Map<
    string,
    { roomType: string; inventory: number; nightsSold: number; availableNights: number; revenue: number }
  >();
  for (const r of rooms) {
    const existing = roomTypesMap.get(r.room_type) ?? {
      roomType: r.room_type,
      inventory: 0,
      nightsSold: 0,
      availableNights: 0,
      revenue: 0,
    };
    existing.inventory += 1;
    existing.availableNights += days.length;
    roomTypesMap.set(r.room_type, existing);
  }

  for (const day of days) {
    for (const s of stays) {
      if ((s.status === 'checked_in' || s.status === 'checked_out') && s.check_in_date <= day && s.check_out_date > day) {
        const entry = roomTypesMap.get(s.room_type);
        if (entry) {
          entry.nightsSold += 1;
        }
      }
    }
  }

  // Reconcile room type revenue directly from posted net room charges (matches P&L roomRevenueTotal)
  for (const c of chargesWithContext) {
    if (c.category !== 'room') continue;
    const typeKey = c.room_type || 'Other';
    let entry = roomTypesMap.get(typeKey);
    if (!entry) {
      entry = {
        roomType: typeKey,
        inventory: 0,
        nightsSold: 0,
        availableNights: 0,
        revenue: 0,
      };
      roomTypesMap.set(typeKey, entry);
    }
    entry.revenue = roundMoney(entry.revenue + c.amount);
  }

  const roomTypeBreakdown = Array.from(roomTypesMap.values()).map((entry) => ({
    ...entry,
    occupancyPct: entry.availableNights > 0 ? roundMoney((entry.nightsSold / entry.availableNights) * 100) : 0,
    adr: entry.nightsSold > 0 ? roundMoney(entry.revenue / entry.nightsSold) : 0,
  }));

  const paymentBreakdown: Record<string, number> = {
    card: 0,
    cash: 0,
    bank_transfer: 0,
    corporate: 0,
  };
  for (const p of paymentsWithContext) {
    const signed = p.kind === 'refund' ? -p.amount : p.amount;
    paymentBreakdown[p.method] = roundMoney((paymentBreakdown[p.method] ?? 0) + signed);
  }
  for (const o of paidWalkInOrders) {
    if (o.settlement === 'cash' || o.settlement === 'card' || o.settlement === 'bank_transfer') {
      paymentBreakdown[o.settlement] = roundMoney((paymentBreakdown[o.settlement] ?? 0) + o.total_amount);
    }
  }
  for (const ei of activePeriodExtraIncome) {
    paymentBreakdown[ei.payment_method] = roundMoney((paymentBreakdown[ei.payment_method] ?? 0) + ei.amount);
  }

  const expenseByCategory: Record<string, number> = {};
  for (const exp of activePeriodExpenses) {
    expenseByCategory[exp.category] = roundMoney((expenseByCategory[exp.category] ?? 0) + exp.amount);
  }

  // Aggregate collected taxes per individual tax rule name
  const taxRuleMap = new Map<string, number>();
  const addBreakdown = (jsonStr: string | undefined, fallbackLabel: string, fallbackAmount: number) => {
    if (fallbackAmount <= 0) return;
    let parsed: Array<{ name?: string; amount?: number }> = [];
    if (jsonStr) {
      try {
        const raw = JSON.parse(jsonStr);
        if (Array.isArray(raw)) parsed = raw;
      } catch {
        parsed = [];
      }
    }
    if (parsed.length > 0) {
      for (const item of parsed) {
        const name = String(item.name || 'Tax').trim();
        const amt = Number(item.amount) || 0;
        if (amt > 0) {
          taxRuleMap.set(name, roundMoney((taxRuleMap.get(name) ?? 0) + amt));
        }
      }
    } else {
      const cleanName = fallbackLabel.replace(/\s*\([^)]*\)\s*/g, '').trim() || 'Tax';
      taxRuleMap.set(cleanName, roundMoney((taxRuleMap.get(cleanName) ?? 0) + fallbackAmount));
    }
  };

  for (const c of chargesWithContext) {
    addBreakdown(c.tax_breakdown_json, c.tax_label || 'Tax', c.tax_amount);
  }
  for (const o of walkInOrders) {
    addBreakdown(o.tax_breakdown_json, 'Restaurant Tax', o.tax_amount);
  }

  const taxByRule = Array.from(taxRuleMap.entries())
    .map(([name, amount]) => ({ name, amount }))
    .sort((a, b) => b.amount - a.amount);

  return {
    fromDate: days[0],
    toDate: days[days.length - 1],
    daysCount: days.length,
    totalRooms,
    kpis: {
      grossRevenue,
      frontDeskRevenueTotal,
      roomRevenueTotal,
      restaurantRevenueTotal,
      restaurantPosRevenue,
      restaurantManualRevenue,
      serviceRevenueTotal,
      otherIncomeTotal,
      totalExpenses,
      netOperatingIncome,
      taxCollected,
      accommodationTaxCollected,
      restaurantTaxCollected,
      paymentsCollected,
      outstandingBalance,
      unpaidPosTabsCount,
      unpaidPosTabsTotal,
      averageOccupancyPct,
      totalOccupiedRoomNights,
      totalAvailableRoomNights,
      adr,
      revpar,
    },
    taxByRule,
    departmentRevenue,
    dailySeries,
    roomTypeBreakdown,
    paymentBreakdown,
    expenseByCategory,
    expenses: periodExpenses,
    extraIncome: periodExtraIncome,
  };
}
