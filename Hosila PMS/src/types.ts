export type WorkstationRole = 'Front Desk' | 'Restaurant POS' | 'Management Office';

export type StaffRole = 'management' | 'accountant' | 'auditor' | 'front_desk' | 'restaurant';

export type NavSection = 'front_desk' | 'pos' | 'finance' | 'settings';

export type FrontDeskTab = 'dashboard' | 'room_board' | 'reservations' | 'directory';

export type TaxMode = 'exclusive' | 'inclusive';
export type TaxAppliesTo = 'accommodation' | 'restaurant' | 'both';

export interface TaxRule {
  id: number;
  name: string;
  rate: number;
  mode: TaxMode;
  applies_to: TaxAppliesTo;
  enabled: number;
  sort_order: number;
  created_at?: string;
}

export interface TaxBreakdownItem {
  id?: number;
  name: string;
  rate: number;
  mode: TaxMode;
  amount: number;
}

export interface AuthSession {
  token: string;
  userId: number;
  fullName: string;
  username: string;
  role: StaffRole;
  shiftId: number;
  shiftOpenedAt: string;
}

export interface LicenseStatus {
  status: 'unlicensed' | 'trial' | 'active' | 'grace' | 'expired';
  mode: 'unlicensed' | 'trial' | 'commercial' | 'master';
  machineId: string;
  licenseId: string | null;
  hotelName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  readOnly: boolean;
  trialAvailable: boolean;
  message: string;
}

export interface AuthStatusResponse {
  needsSetup: boolean;
  hotelName: string;
  hotelLogoUrl: string;
  license?: LicenseStatus;
  staffDirectory: Array<{
    username: string;
    full_name: string;
    role: StaffRole;
  }>;
}

export interface StaffUser {
  id: number;
  full_name: string;
  username: string;
  role: StaffRole;
  active: number;
  created_at: string;
}

export interface ShiftRecord {
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

export interface ShiftSummary {
  shiftId: number;
  openedAt?: string;
  openingCash: number;
  cashFolioPayments: number;
  cashPosSales: number;
  cashExtraIncome: number;
  cashExpenses: number;
  cashRefunds: number;
  expectedCash: number;
  cardCollected: number;
  bankTransferCollected: number;
  corporateBilled: number;
  transactionCount: number;
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
  tax_rules: TaxRule[];
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

export interface EmailTemplate {
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

export type AppCategoryKind = 'expense' | 'extra_income' | 'menu' | 'void_reason';

export interface AppCategory {
  id: number;
  kind: AppCategoryKind;
  name: string;
  account_code: string;
  sort_order: number;
  active: number;
  created_at: string;
}

export interface Expense {
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
}

export interface ExtraIncome {
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
}

export interface Room {
  id: number;
  room_number: string;
  floor: number;
  room_type: string;
  nightly_rate: number;
  capacity: number;
  housekeeping_status: 'clean' | 'dirty' | 'inspecting' | 'maintenance';
  notes: string;
}

export interface Guest {
  id: number;
  full_name: string;
  email: string;
  phone: string;
  id_number: string;
  company: string;
  notes: string;
  created_at: string;
  stay_count: number;
  lifetime_spend: number;
}

export interface Stay {
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
  tax_breakdown_json?: string;
  deferred_settlement?: number;
  deferred_reason?: string;
  deferred_due_date?: string;
  deferred_authorized_by?: string;
  created_at: string;
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
  company_billed?: number;
  company_paid?: number;
  company_balance?: number;
  personal_billed?: number;
  personal_paid?: number;
  personal_balance?: number;
}

export interface FolioCharge {
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
  tax_breakdown_json?: string;
  posted_by_station: string;
  posted_at: string;
  voided: number;
  void_reason: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
  billing_split?: 'personal' | 'company';
}

export interface FolioPayment {
  id: number;
  stay_id: number;
  amount: number;
  method: 'cash' | 'card' | 'bank_transfer' | 'corporate';
  reference: string;
  recorded_by_station: string;
  recorded_at: string;
  kind?: 'payment' | 'refund';
  billing_split?: 'personal' | 'company';
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
}

export interface SplitPaymentLeg {
  amount: string;
  method: 'card' | 'cash' | 'bank_transfer' | 'corporate';
  reference: string;
  billing_split: 'personal' | 'company';
}

export interface MenuItem {
  id: number;
  name: string;
  category: string;
  price: number;
  available: number;
  description: string;
}

export interface PosOrderItem {
  name: string;
  qty: number;
  price: number;
}

export interface PosOrder {
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
  tax_breakdown_json?: string;
  settlement: 'folio' | 'cash' | 'card' | 'bank_transfer' | 'unpaid';
  payment_status: 'paid' | 'unpaid';
  payment_reference?: string;
  paid_at?: string | null;
  status: 'open' | 'preparing' | 'served' | 'closed';
  notes: string;
  station_name: string;
  created_at: string;
  voided?: number;
  void_reason?: string;
  voided_by?: string;
  voided_by_role?: string;
  voided_at?: string | null;
}

export interface EmailLog {
  id: number;
  stay_id: number | null;
  event_type: 'reservation' | 'checkin' | 'checkout' | 'manual';
  recipient_email: string;
  recipient_name: string;
  subject: string;
  body_text: string;
  status: 'sent' | 'queued' | 'skipped' | 'failed';
  provider_id: string;
  error_message: string;
  created_at: string;
  sent_at: string | null;
}

export interface ConnectedStation {
  id: string;
  stationName: string;
  role: WorkstationRole;
  userRole: StaffRole | null;
  userName: string;
  ip: string;
  connectedAt: string;
}

export interface NetworkInfo {
  hostname: string;
  port: number;
  lanUrls: string[];
  localUrl: string;
  databaseFile: string;
  resendConfigured: boolean;
  emailEnabled: boolean;
  connectedStations: ConnectedStation[];
}

export interface HotelState {
  settings: HotelSettings;
  rooms: Room[];
  guests: Guest[];
  stays: Stay[];
  charges: FolioCharge[];
  payments: FolioPayment[];
  menuItems: MenuItem[];
  posOrders: PosOrder[];
  emailLogs: EmailLog[];
  emailTemplates: EmailTemplate[];
  expenses: Expense[];
  extraIncome: ExtraIncome[];
  staffUsers: StaffUser[];
  recentShifts: ShiftRecord[];
  categories: AppCategory[];
}

export interface ReportSummary {
  fromDate: string;
  toDate: string;
  daysCount: number;
  totalRooms: number;
  kpis: {
    grossRevenue: number;
    frontDeskRevenueTotal: number;
    roomRevenueTotal: number;
    restaurantRevenueTotal: number;
    restaurantPosRevenue: number;
    restaurantManualRevenue: number;
    serviceRevenueTotal: number;
    otherIncomeTotal: number;
    totalExpenses: number;
    netOperatingIncome: number;
    taxCollected: number;
    accommodationTaxCollected: number;
    restaurantTaxCollected: number;
    paymentsCollected: number;
    outstandingBalance: number;
    unpaidPosTabsCount: number;
    unpaidPosTabsTotal: number;
    averageOccupancyPct: number;
    totalOccupiedRoomNights: number;
    totalAvailableRoomNights: number;
    adr: number;
    revpar: number;
  };
  taxByRule: Array<{
    name: string;
    amount: number;
  }>;
  departmentRevenue: Array<{
    department: 'Front Desk' | 'Restaurant' | 'Other Income';
    revenue: number;
    sharePct: number;
  }>;
  dailySeries: Array<{
    date: string;
    label: string;
    occupiedRooms: number;
    availableRooms: number;
    occupancyPct: number;
    roomRevenue: number;
    restaurantRevenue: number;
    serviceRevenue: number;
    otherIncome: number;
    totalRevenue: number;
    expenses: number;
  }>;
  roomTypeBreakdown: Array<{
    roomType: string;
    inventory: number;
    nightsSold: number;
    availableNights: number;
    revenue: number;
    occupancyPct: number;
    adr: number;
  }>;
  paymentBreakdown: Record<string, number>;
  expenseByCategory: Record<string, number>;
  expenses: Expense[];
  extraIncome: ExtraIncome[];
}

export type AccountType = 'asset' | 'liability' | 'revenue' | 'expense';

export interface TrialBalanceRow {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: 'debit' | 'credit';
  plainMeaning: string;
  periodDebit: number;
  periodCredit: number;
  totalDebit: number;
  totalCredit: number;
  netBalance: number;
  endingDebit: number;
  endingCredit: number;
}

export interface AccountingJournalLine {
  id: number;
  journal_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  debit: number;
  credit: number;
  memo: string;
}

export interface AccountingJournalEntry {
  id: number;
  voucher_no: string;
  business_date: string;
  event_type: string;
  source_table: string;
  source_id: number | null;
  reference_code: string;
  description: string;
  posted_by: string;
  station_name: string;
  total_debit: number;
  total_credit: number;
  reversal_of_id: number | null;
  prev_hash: string;
  entry_hash: string;
  created_at: string;
  lines: AccountingJournalLine[];
}

export interface AuditIntegritySummary {
  valid: boolean;
  totalVouchers: number;
  firstVoucher: string;
  lastVoucher: string;
  unbalancedCount: number;
  chainBreaks: number;
  sequenceGaps: number;
  totalDebits: number;
  totalCredits: number;
  checkedAt: string;
}

export interface NightAuditRecord {
  id: number;
  audit_number: string;
  business_date: string;
  trigger_type: 'auto' | 'manual';
  triggered_by: string;
  rooms_occupied: number;
  total_rooms: number;
  occupancy_pct: number;
  holdover_nights_posted: number;
  room_revenue: number;
  restaurant_revenue: number;
  other_revenue: number;
  tax_collected: number;
  payments_collected: number;
  expenses_total: number;
  unpaid_pos_total: number;
  outstanding_guest_balance: number;
  pending_arrivals_count: number;
  open_shifts_count: number;
  journal_count: number;
  total_debits: number;
  total_credits: number;
  balanced: number;
  backup_id: number | null;
  backup_filename: string;
  notes: string;
  created_at: string;
}

export interface DatabaseBackupRecord {
  id: number;
  filename: string;
  trigger_type: 'night_audit' | 'manual' | 'pre_restore';
  triggered_by: string;
  business_date: string;
  night_audit_id: number | null;
  size_bytes: number;
  sha256: string;
  created_at: string;
}

export interface NightAuditReadiness {
  businessDate: string;
  alreadyAudited: boolean;
  inHouseCount: number;
  holdoverCount: number;
  overdueArrivalsCount: number;
  unpaidPosCount: number;
  unpaidPosTotal: number;
  openShiftsCount: number;
}

export interface ClearingChargeAllocation {
  paymentId: string;
  method: string;
  reference: string;
  recordedAt: string;
  amount: number;
}

export interface ClearingChargeItem {
  id: string;
  date: string;
  timestamp: string;
  department: 'Front Desk' | 'Restaurant' | 'Other Income';
  reference: string;
  description: string;
  party: string;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: 'paid' | 'partial' | 'unpaid';
  allocations: ClearingChargeAllocation[];
}

export interface ClearingCoveredCharge {
  chargeId: string;
  reference: string;
  description: string;
  department: 'Front Desk' | 'Restaurant' | 'Other Income';
  amount: number;
}

export interface ClearingPaymentItem {
  id: string;
  date: string;
  timestamp: string;
  department: 'Front Desk' | 'Restaurant' | 'Other Income';
  method: string;
  reference: string;
  party: string;
  totalAmount: number;
  allocatedAmount: number;
  unallocatedAmount: number;
  coveredCharges: ClearingCoveredCharge[];
}

export interface ChargePaymentClearing {
  charges: ClearingChargeItem[];
  payments: ClearingPaymentItem[];
  summary: {
    totalCharged: number;
    totalCleared: number;
    totalUnpaid: number;
    unallocatedDeposits: number;
    paidCount: number;
    partialCount: number;
    unpaidCount: number;
  };
}

export interface TaxRegisterBreakdownItem {
  name: string;
  rate: number;
  mode: string;
  amount: number;
}

export interface TaxRegisterEntry {
  id: string;
  date: string;
  timestamp: string;
  source: 'Folio Charge' | 'Restaurant POS';
  department: 'Accommodation' | 'Restaurant' | 'Front Desk';
  reference: string;
  description: string;
  party: string;
  taxLabel: string;
  taxableBase: number;
  taxAmount: number;
  grossTotal: number;
  breakdown: TaxRegisterBreakdownItem[];
}

export interface TaxRegisterRuleSummary {
  name: string;
  rate: number;
  mode: string;
  taxableBase: number;
  taxAmount: number;
  count: number;
}

export interface TaxRegisterData {
  entries: TaxRegisterEntry[];
  summary: {
    totalTaxableBase: number;
    totalTaxCollected: number;
    totalGross: number;
    accommodationTax: number;
    restaurantTax: number;
    frontDeskTax: number;
    transactionCount: number;
    byRule: TaxRegisterRuleSummary[];
  };
}

export type VoidEntityType =
  | 'folio_charge'
  | 'folio_payment'
  | 'pos_order'
  | 'expense'
  | 'extra_income';

export interface VoidAuditEntry {
  id: number;
  entity_type: VoidEntityType;
  entity_id: number;
  reference_code: string;
  description: string;
  party_name: string;
  department: string;
  original_amount: number;
  tax_amount: number;
  total_amount: number;
  void_reason: string;
  voided_by: string;
  voided_by_role: string;
  station_name: string;
  void_voucher_no: string;
  void_journal_id: number | null;
  created_at: string;
}

export interface VoidAuditReportData {
  entries: VoidAuditEntry[];
  summary: {
    totalCount: number;
    totalAmount: number;
    totalTaxReversed: number;
    byType: Array<{ entityType: string; count: number; totalAmount: number }>;
    byStaff: Array<{ staffName: string; role: string; count: number; totalAmount: number }>;
  };
}

export interface AccountingOverview {
  fromDate: string;
  toDate: string;
  businessDate: string;
  integrity: AuditIntegritySummary;
  trialBalance: TrialBalanceRow[];
  trialBalanceTotals: {
    totalDebits: number;
    totalCredits: number;
    balanced: boolean;
  };
  journals: AccountingJournalEntry[];
  clearing: ChargePaymentClearing;
  taxRegister: TaxRegisterData;
  voidAuditReport?: VoidAuditReportData;
  nightAudits: NightAuditRecord[];
  backups: DatabaseBackupRecord[];
  readiness: NightAuditReadiness;
}

export interface PaginatedPosOrdersResponse {
  orders: PosOrder[];
  total: number;
  page: number;
  pageSize: number;
  unpaidCount: number;
  unpaidTotal: number;
  paidCount: number;
  voidedCount?: number;
}

export interface PaginatedGuestsResponse {
  guests: Guest[];
  total: number;
  page: number;
  pageSize: number;
}
