import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  db,
  DB_FILE_PATH,
  getSettings,
  getStayDetailsList,
  replaceDatabaseFromFile,
  roundMoney,
  type ExpenseRow,
  type ExtraIncomeRow,
  type FolioChargeRow,
  type FolioPaymentRow,
  type PosOrderRow,
  type StayRow,
} from './db.ts';
import { calculateTransactionTax } from './tax.ts';

export type AccountType = 'asset' | 'liability' | 'revenue' | 'expense';

export interface ChartAccount {
  code: string;
  name: string;
  type: AccountType;
  normalBalance: 'debit' | 'credit';
  plainMeaning: string;
}

/**
 * Standard Hotel Chart of Accounts (USALI-aligned)
 * Designed to be compliant with GAAP double-entry bookkeeping
 * while staying intuitive for entry-level accountants, auditors, and hotel owners.
 */
export const CHART_OF_ACCOUNTS: ChartAccount[] = [
  // Assets (1000s) — Debit increases, Credit decreases
  {
    code: '1010',
    name: 'Cash on Hand',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Physical cash collected at Front Desk or Restaurant drawer',
  },
  {
    code: '1020',
    name: 'Card Settlement Clearing',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Credit & debit card payments awaiting bank settlement',
  },
  {
    code: '1030',
    name: 'Bank Account (Transfers)',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Direct bank transfers received or paid out',
  },
  {
    code: '1100',
    name: 'Guest Ledger (In-House Receivable)',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Unpaid balances owed by checked-in or checked-out guests',
  },
  {
    code: '1120',
    name: 'Restaurant Open Tabs Receivable',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Unpaid dine-in restaurant orders awaiting payment',
  },
  {
    code: '1150',
    name: 'City Ledger (Corporate Accounts)',
    type: 'asset',
    normalBalance: 'debit',
    plainMeaning: 'Balances billed to corporate or direct-bill accounts',
  },

  // Liabilities (2000s) — Credit increases, Debit decreases
  {
    code: '2100',
    name: 'Advance Guest Deposits',
    type: 'liability',
    normalBalance: 'credit',
    plainMeaning: 'Reservation deposits held before the guest checks in',
  },
  {
    code: '2200',
    name: 'Taxes Payable',
    type: 'liability',
    normalBalance: 'credit',
    plainMeaning: 'VAT, sales, or occupancy taxes collected for tax authorities',
  },

  // Revenue (4000s) — Credit increases, Debit decreases
  {
    code: '4100',
    name: 'Rooms Revenue',
    type: 'revenue',
    normalBalance: 'credit',
    plainMeaning: 'Net accommodation room charges (excluding tax)',
  },
  {
    code: '4200',
    name: 'Restaurant & Dining Revenue',
    type: 'revenue',
    normalBalance: 'credit',
    plainMeaning: 'Net food & beverage sales from POS and manual folio dining',
  },
  {
    code: '4300',
    name: 'Guest Services Revenue',
    type: 'revenue',
    normalBalance: 'credit',
    plainMeaning: 'Laundry, minibar, transfers, and ancillary guest services',
  },
  {
    code: '4400',
    name: 'Other Operating Income',
    type: 'revenue',
    normalBalance: 'credit',
    plainMeaning: 'Conference halls, events, parking, spa, and extra income',
  },

  // Operating Expenses (5000s) — Debit increases, Credit decreases
  {
    code: '5100',
    name: 'Utilities Expense',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Electricity, water, internet, and municipal utilities',
  },
  {
    code: '5200',
    name: 'Housekeeping & Supplies',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Linens, laundry care, toiletries, and cleaning stock',
  },
  {
    code: '5300',
    name: 'Kitchen & F&B Supplies',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Food ingredients, beverages, and kitchen consumables',
  },
  {
    code: '5400',
    name: 'Maintenance & Repairs',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'HVAC, plumbing, electrical, and property upkeep',
  },
  {
    code: '5500',
    name: 'Payroll & Staff Expense',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Staff wages, allowances, and shift compensation',
  },
  {
    code: '5600',
    name: 'Marketing & Promotion',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Advertising, signage, and booking promotions',
  },
  {
    code: '5900',
    name: 'General & Administrative Expense',
    type: 'expense',
    normalBalance: 'debit',
    plainMeaning: 'Office supplies, licenses, and other operating costs',
  },
];

const ACCOUNT_MAP = new Map<string, ChartAccount>(CHART_OF_ACCOUNTS.map((a) => [a.code, a]));

export function getAccountByCode(code: string): ChartAccount {
  return (
    ACCOUNT_MAP.get(code) ?? {
      code,
      name: 'General Account',
      type: 'expense',
      normalBalance: 'debit',
      plainMeaning: 'Hotel operating account',
    }
  );
}

export function paymentMethodToAccountCode(method: string): string {
  switch (method) {
    case 'cash':
      return '1010';
    case 'card':
      return '1020';
    case 'bank_transfer':
      return '1030';
    case 'corporate':
      return '1150';
    default:
      return '1020';
  }
}

export function chargeCategoryToRevenueAccountCode(category: string): string {
  if (category === 'room') return '4100';
  if (category === 'restaurant_pos' || category === 'restaurant_manual') return '4200';
  return '4300';
}

export function expenseCategoryToAccountCode(category: string): string {
  try {
    const row = db
      .prepare("SELECT account_code FROM app_categories WHERE kind = 'expense' AND LOWER(name) = LOWER(?) LIMIT 1")
      .get(category) as { account_code?: string } | undefined;
    if (row?.account_code && ACCOUNT_MAP.has(row.account_code)) {
      return row.account_code;
    }
  } catch {
    // Fallback if table not initialized yet
  }
  switch (category) {
    case 'Utilities':
      return '5100';
    case 'Housekeeping & Supplies':
      return '5200';
    case 'Kitchen & F&B':
      return '5300';
    case 'Maintenance':
      return '5400';
    case 'Payroll':
      return '5500';
    case 'Marketing':
      return '5600';
    default:
      return '5900';
  }
}

export const BACKUPS_DIR = path.resolve(path.dirname(DB_FILE_PATH), 'backups');

function ensureBackupsDir(): void {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

export function getLocalIsoDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getLocalHHMM(date = new Date()): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function addDaysIso(isoDate: string, deltaDays: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  memo?: string;
}

export interface JournalEntryInput {
  businessDate?: string;
  eventType: string;
  sourceTable: string;
  sourceId: number | null;
  referenceCode: string;
  description: string;
  postedBy: string;
  stationName: string;
  reversalOfId?: number | null;
  createdAt?: string;
  lines: JournalLineInput[];
}

export interface AccountingJournalRow {
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
}

export interface AccountingJournalLineRow {
  id: number;
  journal_id: number;
  account_code: string;
  account_name: string;
  account_type: AccountType;
  debit: number;
  credit: number;
  memo: string;
}

export interface NightAuditRow {
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

export interface DatabaseBackupRow {
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

function computeEntryHash(params: {
  voucherNo: string;
  businessDate: string;
  eventType: string;
  sourceTable: string;
  sourceId: number | null;
  referenceCode: string;
  description: string;
  postedBy: string;
  totalDebit: number;
  totalCredit: number;
  reversalOfId: number | null;
  prevHash: string;
  lines: Array<{ account_code: string; debit: number; credit: number }>;
}): string {
  const canonical = JSON.stringify({
    v: params.voucherNo,
    d: params.businessDate,
    e: params.eventType,
    st: params.sourceTable,
    si: params.sourceId ?? 0,
    r: params.referenceCode,
    desc: params.description,
    by: params.postedBy,
    dr: params.totalDebit.toFixed(2),
    cr: params.totalCredit.toFixed(2),
    rev: params.reversalOfId ?? 0,
    prev: params.prevHash,
    l: params.lines.map((l) => `${l.account_code}:${l.debit.toFixed(2)}:${l.credit.toFixed(2)}`),
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

export function getActiveBusinessDate(): string {
  const row = db.prepare('SELECT business_date FROM settings WHERE id = 1').get() as
    | { business_date?: string }
    | undefined;
  return row?.business_date && /^\d{4}-\d{2}-\d{2}$/.test(row.business_date)
    ? row.business_date
    : getLocalIsoDate();
}

/**
 * Posts a strictly balanced double-entry journal voucher with sequential numbering
 * and tamper-evident SHA-256 hash chaining.
 */
export function postJournalEntry(input: JournalEntryInput): number {
  const normalizedLines = input.lines
    .map((line) => {
      const account = getAccountByCode(line.accountCode);
      const debit = roundMoney(Math.max(0, Number(line.debit ?? 0)));
      const credit = roundMoney(Math.max(0, Number(line.credit ?? 0)));
      return {
        account_code: account.code,
        account_name: account.name,
        account_type: account.type,
        debit,
        credit,
        memo: (line.memo ?? '').trim().slice(0, 180),
      };
    })
    .filter((l) => l.debit > 0 || l.credit > 0);

  if (normalizedLines.length < 2) {
    throw new Error('Double-entry accounting requires at least two non-zero journal lines');
  }

  const totalDebit = roundMoney(normalizedLines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = roundMoney(normalizedLines.reduce((s, l) => s + l.credit, 0));

  if (totalDebit <= 0 || Math.abs(totalDebit - totalCredit) >= 0.005) {
    throw new Error(
      `Unbalanced journal entry rejected (Debits ${totalDebit.toFixed(2)} != Credits ${totalCredit.toFixed(2)})`
    );
  }

  const lastRow = db
    .prepare('SELECT id, entry_hash FROM accounting_journals ORDER BY id DESC LIMIT 1')
    .get() as { id: number; entry_hash: string } | undefined;

  const nextSeq = (lastRow?.id ?? 0) + 1;
  const voucherNo = `JV-${String(nextSeq).padStart(6, '0')}`;
  const prevHash = lastRow?.entry_hash ?? 'GENESIS';
  const businessDate = input.businessDate || getActiveBusinessDate();
  const createdAt = input.createdAt || new Date().toISOString();
  const referenceCode = (input.referenceCode || voucherNo).trim().slice(0, 80);
  const description = input.description.trim().slice(0, 240);
  const postedBy = (input.postedBy || 'System').trim().slice(0, 80);
  const stationName = (input.stationName || 'Server').trim().slice(0, 64);

  const entryHash = computeEntryHash({
    voucherNo,
    businessDate,
    eventType: input.eventType,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    referenceCode,
    description,
    postedBy,
    totalDebit,
    totalCredit,
    reversalOfId: input.reversalOfId ?? null,
    prevHash,
    lines: normalizedLines,
  });

  const info = db
    .prepare(
      `INSERT INTO accounting_journals (
        voucher_no, business_date, event_type, source_table, source_id, reference_code,
        description, posted_by, station_name, total_debit, total_credit,
        reversal_of_id, prev_hash, entry_hash, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      voucherNo,
      businessDate,
      input.eventType,
      input.sourceTable,
      input.sourceId,
      referenceCode,
      description,
      postedBy,
      stationName,
      totalDebit,
      totalCredit,
      input.reversalOfId ?? null,
      prevHash,
      entryHash,
      createdAt
    );

  const journalId = Number(info.lastInsertRowid);
  const insertLine = db.prepare(
    `INSERT INTO accounting_journal_lines (journal_id, account_code, account_name, account_type, debit, credit, memo)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  for (const line of normalizedLines) {
    insertLine.run(
      journalId,
      line.account_code,
      line.account_name,
      line.account_type,
      line.debit,
      line.credit,
      line.memo
    );
  }

  return journalId;
}

// ---------------- DOMAIN-SPECIFIC DOUBLE-ENTRY HELPERS ----------------

export function recordFolioChargeJournal(params: {
  chargeId: number;
  category: string;
  description: string;
  referenceCode: string;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
  eventType?: string;
}): number {
  const revCode = chargeCategoryToRevenueAccountCode(params.category);
  const lines: JournalLineInput[] = [
    { accountCode: '1100', debit: params.totalAmount, memo: 'Charge billed to guest folio' },
    { accountCode: revCode, credit: params.netAmount, memo: params.description },
  ];
  if (params.taxAmount > 0) {
    lines.push({ accountCode: '2200', credit: params.taxAmount, memo: 'Tax collected on folio charge' });
  }
  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: params.eventType ?? 'folio_charge',
    sourceTable: 'folio_charges',
    sourceId: params.chargeId,
    referenceCode: params.referenceCode,
    description: params.description,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines,
  });
}

export function recordFolioChargeVoidJournal(params: {
  chargeId: number;
  category: string;
  description: string;
  referenceCode: string;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  reason: string;
  postedBy: string;
  stationName: string;
}): number {
  const original = db
    .prepare(
      "SELECT id FROM accounting_journals WHERE source_table = 'folio_charges' AND source_id = ? AND reversal_of_id IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(params.chargeId) as { id: number } | undefined;

  const revCode = chargeCategoryToRevenueAccountCode(params.category);
  const isCreditNote = params.totalAmount < 0;
  const absNet = roundMoney(Math.abs(params.netAmount));
  const absTax = roundMoney(Math.abs(params.taxAmount));
  const absTotal = roundMoney(Math.abs(params.totalAmount));
  const lines: JournalLineInput[] = isCreditNote
    ? [
        {
          accountCode: '1100',
          debit: absTotal,
          memo: `Void credit note on guest folio (${params.reason})`,
        },
        { accountCode: revCode, credit: absNet, memo: `Reversal of credit note: ${params.reason}` },
        ...(absTax > 0
          ? [{ accountCode: '2200', credit: absTax, memo: 'Tax credit restored on voided credit note' }]
          : []),
      ]
    : [
        { accountCode: revCode, debit: absNet, memo: `Reversal: ${params.reason}` },
        ...(absTax > 0
          ? [{ accountCode: '2200', debit: absTax, memo: 'Tax reversed on voided charge' }]
          : []),
        {
          accountCode: '1100',
          credit: absTotal,
          memo: `Credit guest folio (${params.reason})`,
        },
      ];

  return postJournalEntry({
    eventType: 'void_reversal',
    sourceTable: 'folio_charges',
    sourceId: params.chargeId,
    referenceCode: params.referenceCode,
    description: `Void Reversal — ${params.description} (${params.reason})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    reversalOfId: original?.id ?? null,
    lines,
  });
}

export function getJournalVoucherNo(journalId: number | null | undefined): string {
  if (!journalId) return '';
  const row = db
    .prepare('SELECT voucher_no FROM accounting_journals WHERE id = ?')
    .get(journalId) as { voucher_no: string } | undefined;
  return row?.voucher_no ?? '';
}

export function recordFolioPaymentVoidJournal(params: {
  paymentId: number;
  stayStatus: string;
  kind: 'payment' | 'refund';
  amount: number;
  method: string;
  reference: string;
  confirmationCode: string;
  guestName: string;
  reason: string;
  postedBy: string;
  stationName: string;
}): number {
  const original = db
    .prepare(
      "SELECT id FROM accounting_journals WHERE source_table = 'folio_payments' AND source_id = ? AND reversal_of_id IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(params.paymentId) as { id: number } | undefined;

  const assetCode = paymentMethodToAccountCode(params.method);
  const isAdvanceDeposit = params.stayStatus === 'reserved';
  const folioAccount = isAdvanceDeposit ? '2100' : '1100';
  const absAmount = roundMoney(Math.abs(params.amount));

  // If voiding a payment: Dr Folio/Deposit, Cr Cash/Bank/Card. If voiding a refund: Dr Cash/Bank/Card, Cr Folio/Deposit.
  const lines: JournalLineInput[] =
    params.kind === 'refund'
      ? [
          {
            accountCode: assetCode,
            debit: absAmount,
            memo: `Voided refund returned to ${params.method.replace('_', ' ')} (${params.reason})`,
          },
          {
            accountCode: folioAccount,
            credit: absAmount,
            memo: `Reversed guest refund (${params.reason})`,
          },
        ]
      : [
          {
            accountCode: folioAccount,
            debit: absAmount,
            memo: isAdvanceDeposit
              ? `Reversed advance deposit (${params.reason})`
              : `Reversed folio payment (${params.reason})`,
          },
          {
            accountCode: assetCode,
            credit: absAmount,
            memo: `Voided ${params.method.replace('_', ' ')} receipt (${params.reason})`,
          },
        ];

  return postJournalEntry({
    eventType: 'void_reversal',
    sourceTable: 'folio_payments',
    sourceId: params.paymentId,
    referenceCode: params.reference || params.confirmationCode,
    description: `Void Reversal — ${params.kind === 'refund' ? 'Guest Refund' : 'Folio Payment'} (${params.guestName} · ${params.reason})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    reversalOfId: original?.id ?? null,
    lines,
  });
}

export function recordPosOrderVoidJournal(params: {
  orderId: number;
  orderNumber: string;
  guestName: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  settlement: string;
  paymentStatus: string;
  reason: string;
  postedBy: string;
  stationName: string;
}): number | null {
  // Folio-posted orders reverse through their linked folio_charges row to avoid double-reversing revenue
  if (params.settlement === 'folio') return null;

  const original = db
    .prepare(
      "SELECT id FROM accounting_journals WHERE source_table = 'pos_orders' AND source_id = ? AND reversal_of_id IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(params.orderId) as { id: number } | undefined;

  const creditAccount =
    params.paymentStatus === 'unpaid' ? '1120' : paymentMethodToAccountCode(params.settlement);

  const absSub = roundMoney(Math.abs(params.subtotal));
  const absTax = roundMoney(Math.abs(params.taxAmount));
  const absTotal = roundMoney(Math.abs(params.totalAmount));

  const lines: JournalLineInput[] = [
    {
      accountCode: '4200',
      debit: absSub,
      memo: `Reversed POS order ${params.orderNumber} (${params.reason})`,
    },
  ];
  if (absTax > 0) {
    lines.push({
      accountCode: '2200',
      debit: absTax,
      memo: `Reversed restaurant tax on ${params.orderNumber}`,
    });
  }
  lines.push({
    accountCode: creditAccount,
    credit: absTotal,
    memo:
      params.paymentStatus === 'unpaid'
        ? `Cancelled unpaid restaurant tab (${params.reason})`
        : `Reversed ${params.settlement.replace('_', ' ')} POS receipt (${params.reason})`,
  });

  return postJournalEntry({
    eventType: 'void_reversal',
    sourceTable: 'pos_orders',
    sourceId: params.orderId,
    referenceCode: params.orderNumber,
    description: `Void Reversal — Restaurant Order ${params.orderNumber} (${params.guestName} · ${params.reason})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    reversalOfId: original?.id ?? null,
    lines,
  });
}

export type VoidEntityType =
  | 'folio_charge'
  | 'folio_payment'
  | 'pos_order'
  | 'expense'
  | 'extra_income';

export interface VoidAuditLogRow {
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

export function recordVoidAuditLog(params: {
  entityType: VoidEntityType;
  entityId: number;
  referenceCode: string;
  description: string;
  partyName: string;
  department: string;
  originalAmount: number;
  taxAmount: number;
  totalAmount: number;
  voidReason: string;
  voidedBy: string;
  voidedByRole: string;
  stationName: string;
  voidJournalId?: number | null;
  voidVoucherNo?: string;
  createdAt?: string;
}): number {
  const voucherNo =
    params.voidVoucherNo || (params.voidJournalId ? getJournalVoucherNo(params.voidJournalId) : '');
  const nowIso = params.createdAt ?? new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO void_audit_logs (
        entity_type, entity_id, reference_code, description, party_name, department,
        original_amount, tax_amount, total_amount, void_reason,
        voided_by, voided_by_role, station_name, void_voucher_no, void_journal_id, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      params.entityType,
      params.entityId,
      params.referenceCode.slice(0, 80),
      params.description.slice(0, 220),
      params.partyName.slice(0, 120),
      params.department.slice(0, 60),
      roundMoney(params.originalAmount),
      roundMoney(params.taxAmount),
      roundMoney(params.totalAmount),
      params.voidReason.slice(0, 200),
      params.voidedBy.slice(0, 80),
      params.voidedByRole.slice(0, 40),
      params.stationName.slice(0, 80),
      voucherNo.slice(0, 40),
      params.voidJournalId ?? null,
      nowIso
    );

  return Number(info.lastInsertRowid);
}

export function recordFolioPaymentJournal(params: {
  paymentId: number;
  stayStatus: string;
  amount: number;
  method: string;
  reference: string;
  confirmationCode: string;
  guestName: string;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number {
  const assetCode = paymentMethodToAccountCode(params.method);
  const isAdvanceDeposit = params.stayStatus === 'reserved';
  const creditAccount = isAdvanceDeposit ? '2100' : '1100';

  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: isAdvanceDeposit ? 'reservation_deposit' : 'folio_payment',
    sourceTable: 'folio_payments',
    sourceId: params.paymentId,
    referenceCode: params.reference || params.confirmationCode,
    description: isAdvanceDeposit
      ? `Advance Reservation Deposit — ${params.guestName} (${params.confirmationCode})`
      : `Guest Folio Payment — ${params.guestName} (${params.confirmationCode})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      { accountCode: assetCode, debit: params.amount, memo: `Payment received via ${params.method.replace('_', ' ')}` },
      {
        accountCode: creditAccount,
        credit: params.amount,
        memo: isAdvanceDeposit ? 'Held as unearned reservation deposit' : 'Applied to guest folio balance',
      },
    ],
  });
}

export function recordFolioRefundJournal(params: {
  paymentId: number;
  stayStatus: string;
  amount: number;
  method: string;
  reference: string;
  reason: string;
  confirmationCode: string;
  guestName: string;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number {
  const assetCode = paymentMethodToAccountCode(params.method);
  const isAdvanceDeposit = params.stayStatus === 'reserved';
  const debitAccount = isAdvanceDeposit ? '2100' : '1100';

  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: 'guest_refund',
    sourceTable: 'folio_payments',
    sourceId: params.paymentId,
    referenceCode: params.reference || params.confirmationCode,
    description: `Guest Refund — ${params.guestName} (${params.confirmationCode})${params.reason ? `: ${params.reason}` : ''}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      {
        accountCode: debitAccount,
        debit: params.amount,
        memo: isAdvanceDeposit
          ? `Refund of advance deposit (${params.reason || 'Guest refund'})`
          : `Refund issued to guest folio (${params.reason || 'Overpayment / adjustment'})`,
      },
      {
        accountCode: assetCode,
        credit: params.amount,
        memo: `Refund disbursed via ${params.method.replace('_', ' ')}`,
      },
    ],
  });
}

export function recordFolioCreditNoteJournal(params: {
  chargeId: number;
  category: string;
  description: string;
  referenceCode: string;
  netAmount: number;
  taxAmount: number;
  totalAmount: number;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number {
  const revCode = chargeCategoryToRevenueAccountCode(params.category);
  const absNet = roundMoney(Math.abs(params.netAmount));
  const absTax = roundMoney(Math.abs(params.taxAmount));
  const absTotal = roundMoney(Math.abs(params.totalAmount));
  const lines: JournalLineInput[] = [
    { accountCode: revCode, debit: absNet, memo: `Credit Note: ${params.description}` },
  ];
  if (absTax > 0) {
    lines.push({ accountCode: '2200', debit: absTax, memo: 'Tax credit reversed on credit note' });
  }
  lines.push({
    accountCode: '1100',
    credit: absTotal,
    memo: 'Credit note applied to guest folio',
  });

  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: 'credit_note',
    sourceTable: 'folio_charges',
    sourceId: params.chargeId,
    referenceCode: params.referenceCode,
    description: `Credit Note — ${params.description}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines,
  });
}

export function recordDepositTransferToGuestLedger(params: {
  stayId: number;
  confirmationCode: string;
  guestName: string;
  depositTotal: number;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number | null {
  const amt = roundMoney(params.depositTotal);
  if (amt <= 0) return null;
  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: 'deposit_transfer',
    sourceTable: 'stays',
    sourceId: params.stayId,
    referenceCode: params.confirmationCode,
    description: `Transfer Reservation Deposit to Guest Folio at Check-In — ${params.guestName}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      { accountCode: '2100', debit: amt, memo: 'Release advance deposit upon check-in' },
      { accountCode: '1100', credit: amt, memo: 'Apply deposit credit to guest folio' },
    ],
  });
}

export function recordPosOrderJournal(params: {
  orderId: number;
  orderNumber: string;
  diningType: string;
  guestName: string;
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  settlement: string;
  paymentStatus: string;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number | null {
  // Room Service / Folio-posted orders already post their accounting entry via folio_charges (avoid double counting!)
  if (params.settlement === 'folio') return null;

  const debitAccount =
    params.paymentStatus === 'unpaid' ? '1120' : paymentMethodToAccountCode(params.settlement);

  const lines: JournalLineInput[] = [
    {
      accountCode: debitAccount,
      debit: params.totalAmount,
      memo:
        params.paymentStatus === 'unpaid'
          ? 'Open restaurant tab awaiting payment'
          : `POS sale paid via ${params.settlement.replace('_', ' ')}`,
    },
    {
      accountCode: '4200',
      credit: params.subtotal,
      memo: `Restaurant ${params.diningType.replace('_', ' ')} order`,
    },
  ];
  if (params.taxAmount > 0) {
    lines.push({ accountCode: '2200', credit: params.taxAmount, memo: 'Restaurant tax collected' });
  }

  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: params.paymentStatus === 'unpaid' ? 'pos_open_tab' : 'pos_sale',
    sourceTable: 'pos_orders',
    sourceId: params.orderId,
    referenceCode: params.orderNumber,
    description: `Restaurant ${params.orderNumber} — ${params.guestName} (${params.paymentStatus === 'unpaid' ? 'Unpaid Tab' : params.settlement.replace('_', ' ')})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines,
  });
}

export function recordPosTabSettlementJournal(params: {
  orderId: number;
  orderNumber: string;
  guestName: string;
  totalAmount: number;
  settlement: string;
  postedBy: string;
  stationName: string;
  businessDate?: string;
  createdAt?: string;
}): number {
  const debitAccount = params.settlement === 'folio' ? '1100' : paymentMethodToAccountCode(params.settlement);

  return postJournalEntry({
    businessDate: params.businessDate,
    eventType: 'pos_settlement',
    sourceTable: 'pos_orders',
    sourceId: params.orderId,
    referenceCode: params.orderNumber,
    description:
      params.settlement === 'folio'
        ? `Transfer Open Tab ${params.orderNumber} to Guest Folio — ${params.guestName}`
        : `Settle Restaurant Tab ${params.orderNumber} via ${params.settlement.replace('_', ' ')}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      {
        accountCode: debitAccount,
        debit: params.totalAmount,
        memo:
          params.settlement === 'folio'
            ? 'Transferred to Guest Folio receivable'
            : `Collected via ${params.settlement.replace('_', ' ')}`,
      },
      {
        accountCode: '1120',
        credit: params.totalAmount,
        memo: 'Cleared open restaurant tab receivable',
      },
    ],
  });
}

export function recordExtraIncomeJournal(params: {
  incomeId: number;
  incomeDate: string;
  category: string;
  description: string;
  payer: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  postedBy: string;
  stationName: string;
  createdAt?: string;
}): number {
  const assetCode = paymentMethodToAccountCode(params.paymentMethod);
  return postJournalEntry({
    businessDate: params.incomeDate,
    eventType: 'extra_income',
    sourceTable: 'extra_income',
    sourceId: params.incomeId,
    referenceCode: params.reference || `INC-${params.incomeId}`,
    description: `${params.category} — ${params.description}${params.payer ? ` (${params.payer})` : ''}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      { accountCode: assetCode, debit: params.amount, memo: `Received via ${params.paymentMethod.replace('_', ' ')}` },
      { accountCode: '4400', credit: params.amount, memo: params.category },
    ],
  });
}

export function recordExtraIncomeVoidJournal(params: {
  incomeId: number;
  category: string;
  description: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  reason: string;
  postedBy: string;
  stationName: string;
}): number {
  const original = db
    .prepare(
      "SELECT id FROM accounting_journals WHERE source_table = 'extra_income' AND source_id = ? AND reversal_of_id IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(params.incomeId) as { id: number } | undefined;

  const assetCode = paymentMethodToAccountCode(params.paymentMethod);
  return postJournalEntry({
    eventType: 'void_reversal',
    sourceTable: 'extra_income',
    sourceId: params.incomeId,
    referenceCode: params.reference || `INC-${params.incomeId}`,
    description: `Void Reversal — ${params.category}: ${params.description} (${params.reason})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    reversalOfId: original?.id ?? null,
    lines: [
      { accountCode: '4400', debit: params.amount, memo: `Reversed extra income (${params.reason})` },
      { accountCode: assetCode, credit: params.amount, memo: 'Reversed receipt account' },
    ],
  });
}

export function recordExpenseJournal(params: {
  expenseId: number;
  expenseDate: string;
  category: string;
  description: string;
  vendor: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  postedBy: string;
  stationName: string;
  createdAt?: string;
}): number {
  const expCode = expenseCategoryToAccountCode(params.category);
  const assetCode = paymentMethodToAccountCode(params.paymentMethod);
  return postJournalEntry({
    businessDate: params.expenseDate,
    eventType: 'expense',
    sourceTable: 'expenses',
    sourceId: params.expenseId,
    referenceCode: params.reference || `EXP-${params.expenseId}`,
    description: `${params.category} — ${params.description}${params.vendor ? ` (${params.vendor})` : ''}`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    createdAt: params.createdAt,
    lines: [
      { accountCode: expCode, debit: params.amount, memo: params.category },
      { accountCode: assetCode, credit: params.amount, memo: `Paid via ${params.paymentMethod.replace('_', ' ')}` },
    ],
  });
}

export function recordExpenseVoidJournal(params: {
  expenseId: number;
  category: string;
  description: string;
  paymentMethod: string;
  reference: string;
  amount: number;
  reason: string;
  postedBy: string;
  stationName: string;
}): number {
  const original = db
    .prepare(
      "SELECT id FROM accounting_journals WHERE source_table = 'expenses' AND source_id = ? AND reversal_of_id IS NULL ORDER BY id DESC LIMIT 1"
    )
    .get(params.expenseId) as { id: number } | undefined;

  const expCode = expenseCategoryToAccountCode(params.category);
  const assetCode = paymentMethodToAccountCode(params.paymentMethod);
  return postJournalEntry({
    eventType: 'void_reversal',
    sourceTable: 'expenses',
    sourceId: params.expenseId,
    referenceCode: params.reference || `EXP-${params.expenseId}`,
    description: `Void Reversal — ${params.category}: ${params.description} (${params.reason})`,
    postedBy: params.postedBy,
    stationName: params.stationName,
    reversalOfId: original?.id ?? null,
    lines: [
      { accountCode: assetCode, debit: params.amount, memo: 'Reversed expense payment source' },
      { accountCode: expCode, credit: params.amount, memo: `Reversed expense (${params.reason})` },
    ],
  });
}

// ---------------- SCHEMA & INITIAL BACKFILL ----------------

export function initAccountingTables(): void {
  ensureBackupsDir();

  db.exec(`
    CREATE TABLE IF NOT EXISTS accounting_journals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voucher_no TEXT NOT NULL UNIQUE,
      business_date TEXT NOT NULL,
      event_type TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_id INTEGER,
      reference_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL,
      posted_by TEXT NOT NULL DEFAULT 'System',
      station_name TEXT NOT NULL DEFAULT 'Server',
      total_debit REAL NOT NULL,
      total_credit REAL NOT NULL,
      reversal_of_id INTEGER REFERENCES accounting_journals(id) ON DELETE RESTRICT,
      prev_hash TEXT NOT NULL,
      entry_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS accounting_journal_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      journal_id INTEGER NOT NULL REFERENCES accounting_journals(id) ON DELETE RESTRICT,
      account_code TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_type TEXT NOT NULL,
      debit REAL NOT NULL DEFAULT 0,
      credit REAL NOT NULL DEFAULT 0,
      memo TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS night_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_number TEXT NOT NULL UNIQUE,
      business_date TEXT NOT NULL UNIQUE,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      triggered_by TEXT NOT NULL DEFAULT 'System',
      rooms_occupied INTEGER NOT NULL DEFAULT 0,
      total_rooms INTEGER NOT NULL DEFAULT 0,
      occupancy_pct REAL NOT NULL DEFAULT 0,
      holdover_nights_posted INTEGER NOT NULL DEFAULT 0,
      room_revenue REAL NOT NULL DEFAULT 0,
      restaurant_revenue REAL NOT NULL DEFAULT 0,
      other_revenue REAL NOT NULL DEFAULT 0,
      tax_collected REAL NOT NULL DEFAULT 0,
      payments_collected REAL NOT NULL DEFAULT 0,
      expenses_total REAL NOT NULL DEFAULT 0,
      unpaid_pos_total REAL NOT NULL DEFAULT 0,
      outstanding_guest_balance REAL NOT NULL DEFAULT 0,
      pending_arrivals_count INTEGER NOT NULL DEFAULT 0,
      open_shifts_count INTEGER NOT NULL DEFAULT 0,
      journal_count INTEGER NOT NULL DEFAULT 0,
      total_debits REAL NOT NULL DEFAULT 0,
      total_credits REAL NOT NULL DEFAULT 0,
      balanced INTEGER NOT NULL DEFAULT 1,
      backup_id INTEGER,
      backup_filename TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS database_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      filename TEXT NOT NULL UNIQUE,
      trigger_type TEXT NOT NULL DEFAULT 'manual',
      triggered_by TEXT NOT NULL DEFAULT 'System',
      business_date TEXT NOT NULL DEFAULT '',
      night_audit_id INTEGER,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      sha256 TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stay_id INTEGER NOT NULL REFERENCES stays(id) ON DELETE CASCADE,
      payment_id INTEGER NOT NULL REFERENCES folio_payments(id) ON DELETE CASCADE,
      charge_id INTEGER NOT NULL REFERENCES folio_charges(id) ON DELETE CASCADE,
      allocated_amount REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS void_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      reference_code TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      party_name TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      original_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      void_reason TEXT NOT NULL,
      voided_by TEXT NOT NULL,
      voided_by_role TEXT NOT NULL DEFAULT '',
      station_name TEXT NOT NULL DEFAULT '',
      void_voucher_no TEXT NOT NULL DEFAULT '',
      void_journal_id INTEGER,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_journals_business_date ON accounting_journals(business_date);
    CREATE INDEX IF NOT EXISTS idx_journals_source ON accounting_journals(source_table, source_id);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_journal ON accounting_journal_lines(journal_id);
    CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON accounting_journal_lines(account_code);
    CREATE INDEX IF NOT EXISTS idx_allocations_stay ON payment_allocations(stay_id);
    CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations(payment_id);
    CREATE INDEX IF NOT EXISTS idx_allocations_charge ON payment_allocations(charge_id);
    CREATE INDEX IF NOT EXISTS idx_void_audit_created ON void_audit_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_void_audit_entity ON void_audit_logs(entity_type, entity_id);
  `);

  // Night Audit, Backup, and soft-void settings/finance columns are migrated in server/db.ts (initDatabase).
  resetAuditIntegrityCache();

  // Backfill existing operational records into double-entry journals on first upgrade
  const journalCount = (
    db.prepare('SELECT COUNT(*) as count FROM accounting_journals').get() as { count: number }
  ).count;

  if (journalCount === 0) {
    backfillExistingTransactionsToJournals();
  }

  // Ensure any pre-existing voided operational records appear in void_audit_logs
  backfillVoidAuditLogs();

  // Ensure every stay has up-to-date payment-to-charge allocations persisted
  reconcileAllStayAllocations();
}

function backfillVoidAuditLogs(): void {
  const existsStmt = db.prepare(
    'SELECT 1 FROM void_audit_logs WHERE entity_type = ? AND entity_id = ? LIMIT 1'
  );
  const findRevJournal = db.prepare(
    `SELECT id, voucher_no, posted_by, station_name, created_at
     FROM accounting_journals
     WHERE source_table = ? AND source_id = ? AND event_type = 'void_reversal'
     ORDER BY id DESC LIMIT 1`
  );

  const voidedCharges = db
    .prepare(
      `SELECT fc.*, s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_charges fc
       JOIN stays s ON s.id = fc.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE fc.voided = 1`
    )
    .all() as Array<
    FolioChargeRow & { confirmation_code: string; guest_name: string; room_number: string }
  >;

  for (const ch of voidedCharges) {
    if (existsStmt.get('folio_charge', ch.id)) continue;
    const rev = findRevJournal.get('folio_charges', ch.id) as
      | { id: number; voucher_no: string; posted_by: string; station_name: string; created_at: string }
      | undefined;
    recordVoidAuditLog({
      entityType: 'folio_charge',
      entityId: ch.id,
      referenceCode: ch.reference_code || ch.confirmation_code,
      description: ch.description,
      partyName: `${ch.guest_name} (Rm ${ch.room_number})`,
      department:
        ch.category === 'restaurant_pos' || ch.category === 'restaurant_manual'
          ? 'Restaurant'
          : 'Front Desk',
      originalAmount: ch.amount,
      taxAmount: ch.tax_amount,
      totalAmount: ch.total_amount || ch.amount + ch.tax_amount,
      voidReason: ch.void_reason || 'Voided charge',
      voidedBy: ch.voided_by || rev?.posted_by || 'System',
      voidedByRole: ch.voided_by_role || '',
      stationName: rev?.station_name || ch.posted_by_station || 'System',
      voidJournalId: rev?.id ?? null,
      voidVoucherNo: rev?.voucher_no ?? '',
      createdAt: ch.voided_at || rev?.created_at || ch.posted_at,
    });
  }

  const voidedExpenses = db
    .prepare('SELECT * FROM expenses WHERE COALESCE(voided, 0) = 1')
    .all() as ExpenseRow[];

  for (const exp of voidedExpenses) {
    if (existsStmt.get('expense', exp.id)) continue;
    const rev = findRevJournal.get('expenses', exp.id) as
      | { id: number; voucher_no: string; posted_by: string; station_name: string; created_at: string }
      | undefined;
    recordVoidAuditLog({
      entityType: 'expense',
      entityId: exp.id,
      referenceCode: exp.reference || `EXP-${exp.id}`,
      description: `${exp.category} — ${exp.description}`,
      partyName: exp.vendor || 'Supplier',
      department: exp.category,
      originalAmount: exp.amount,
      taxAmount: 0,
      totalAmount: exp.amount,
      voidReason: exp.void_reason || 'Reversed expense',
      voidedBy: exp.voided_by || rev?.posted_by || 'System',
      voidedByRole: exp.voided_by_role || '',
      stationName: rev?.station_name || 'Finance',
      voidJournalId: rev?.id ?? null,
      voidVoucherNo: rev?.voucher_no ?? '',
      createdAt: exp.voided_at || rev?.created_at || exp.created_at,
    });
  }

  const voidedIncome = db
    .prepare('SELECT * FROM extra_income WHERE COALESCE(voided, 0) = 1')
    .all() as ExtraIncomeRow[];

  for (const inc of voidedIncome) {
    if (existsStmt.get('extra_income', inc.id)) continue;
    const rev = findRevJournal.get('extra_income', inc.id) as
      | { id: number; voucher_no: string; posted_by: string; station_name: string; created_at: string }
      | undefined;
    recordVoidAuditLog({
      entityType: 'extra_income',
      entityId: inc.id,
      referenceCode: inc.reference || `INC-${inc.id}`,
      description: `${inc.category} — ${inc.description}`,
      partyName: inc.payer || 'Direct Client',
      department: 'Other Income',
      originalAmount: inc.amount,
      taxAmount: 0,
      totalAmount: inc.amount,
      voidReason: inc.void_reason || 'Reversed extra income',
      voidedBy: inc.voided_by || rev?.posted_by || 'System',
      voidedByRole: inc.voided_by_role || '',
      stationName: rev?.station_name || 'Finance',
      voidJournalId: rev?.id ?? null,
      voidVoucherNo: rev?.voucher_no ?? '',
      createdAt: inc.voided_at || rev?.created_at || inc.created_at,
    });
  }
}

/**
 * Deterministically links folio payments to the exact folio charges they clear (oldest unpaid charge first / FIFO).
 * One lump-sum payment automatically links to all charges it covers, while deposits taken before charges exist
 * stay unallocated until room charges are posted at check-in.
 */
export function reconcileStayAllocations(stayId: number): void {
  const charges = db
    .prepare(
      `SELECT id, total_amount, posted_at
       FROM folio_charges
       WHERE stay_id = ? AND voided = 0 AND total_amount > 0
       ORDER BY posted_at ASC, id ASC`
    )
    .all(stayId) as Array<{ id: number; total_amount: number; posted_at: string }>;

  const creditNoteTotal = Math.abs(
    (
      db
        .prepare(
          `SELECT COALESCE(SUM(total_amount), 0) AS total
           FROM folio_charges
           WHERE stay_id = ? AND voided = 0 AND total_amount < 0`
        )
        .get(stayId) as { total: number }
    ).total
  );

  const payments = db
    .prepare(
      `SELECT id, amount, recorded_at, COALESCE(kind, 'payment') AS kind
       FROM folio_payments
       WHERE stay_id = ? AND amount > 0 AND COALESCE(voided, 0) = 0
       ORDER BY recorded_at ASC, id ASC`
    )
    .all(stayId) as Array<{ id: number; amount: number; recorded_at: string; kind: string }>;

  db.prepare('DELETE FROM payment_allocations WHERE stay_id = ?').run(stayId);

  if (charges.length === 0 || payments.length === 0) return;

  const positivePayments = payments.filter((p) => p.kind !== 'refund');
  const totalRefunded = roundMoney(
    payments.filter((p) => p.kind === 'refund').reduce((s, p) => s + p.amount, 0)
  );
  const totalPositivePaid = roundMoney(positivePayments.reduce((s, p) => s + p.amount, 0));
  let netAvailableToAllocate = Math.max(0, roundMoney(totalPositivePaid - totalRefunded));

  if (netAvailableToAllocate <= 0.004) return;

  const insertStmt = db.prepare(
    `INSERT INTO payment_allocations (stay_id, payment_id, charge_id, allocated_amount, created_at)
     VALUES (?, ?, ?, ?, ?)`
  );

  // Reduce positive charges by any posted credit notes (from latest charge backwards) so credit notes clear charges first
  const chargeRemaining = charges.map((c) => ({
    id: c.id,
    remaining: roundMoney(c.total_amount),
  }));

  let creditPool = roundMoney(creditNoteTotal);
  for (let i = chargeRemaining.length - 1; i >= 0 && creditPool > 0.004; i -= 1) {
    const appliedCredit = roundMoney(Math.min(creditPool, chargeRemaining[i].remaining));
    chargeRemaining[i].remaining = roundMoney(chargeRemaining[i].remaining - appliedCredit);
    creditPool = roundMoney(creditPool - appliedCredit);
  }

  let cIdx = 0;
  for (const pay of positivePayments) {
    if (netAvailableToAllocate <= 0.004) break;
    let payLeft = roundMoney(Math.min(pay.amount, netAvailableToAllocate));
    while (payLeft > 0.004 && cIdx < chargeRemaining.length) {
      const target = chargeRemaining[cIdx];
      if (target.remaining <= 0.004) {
        cIdx += 1;
        continue;
      }
      const applied = roundMoney(Math.min(payLeft, target.remaining));
      if (applied > 0) {
        insertStmt.run(stayId, pay.id, target.id, applied, pay.recorded_at);
        payLeft = roundMoney(payLeft - applied);
        netAvailableToAllocate = roundMoney(netAvailableToAllocate - applied);
        target.remaining = roundMoney(target.remaining - applied);
      }
      if (target.remaining <= 0.004) {
        cIdx += 1;
      }
    }
  }
}

export function reconcileAllStayAllocations(): void {
  const stayRows = db
    .prepare(
      `SELECT DISTINCT stay_id FROM folio_charges
       UNION
       SELECT DISTINCT stay_id FROM folio_payments`
    )
    .all() as Array<{ stay_id: number }>;

  const tx = db.transaction(() => {
    for (const row of stayRows) {
      reconcileStayAllocations(row.stay_id);
    }
  });
  tx();
}

function backfillExistingTransactionsToJournals(): void {
  type BackfillEvent = { sortTs: string; run: () => void };
  const events: BackfillEvent[] = [];

  const charges = db
    .prepare(
      `SELECT fc.*, s.confirmation_code, g.full_name AS guest_name
       FROM folio_charges fc
       JOIN stays s ON s.id = fc.stay_id
       JOIN guests g ON g.id = s.guest_id
       WHERE fc.voided = 0 AND fc.total_amount > 0`
    )
    .all() as Array<FolioChargeRow & { confirmation_code: string; guest_name: string }>;

  for (const ch of charges) {
    events.push({
      sortTs: ch.posted_at,
      run: () => {
        recordFolioChargeJournal({
          chargeId: ch.id,
          category: ch.category,
          description: ch.description,
          referenceCode: ch.reference_code || ch.confirmation_code,
          netAmount: ch.amount,
          taxAmount: ch.tax_amount,
          totalAmount: ch.total_amount,
          postedBy: ch.posted_by_station || 'Front Desk',
          stationName: ch.posted_by_station || 'Front Desk',
          businessDate: ch.posted_at.slice(0, 10),
          createdAt: ch.posted_at,
        });
      },
    });
  }

  const payments = db
    .prepare(
      `SELECT fp.*, s.status AS stay_status, s.confirmation_code, g.full_name AS guest_name
       FROM folio_payments fp
       JOIN stays s ON s.id = fp.stay_id
       JOIN guests g ON g.id = s.guest_id
       WHERE fp.amount > 0`
    )
    .all() as Array<
    FolioPaymentRow & { stay_status: string; confirmation_code: string; guest_name: string }
  >;

  for (const pay of payments) {
    events.push({
      sortTs: pay.recorded_at,
      run: () => {
        recordFolioPaymentJournal({
          paymentId: pay.id,
          stayStatus: pay.stay_status,
          amount: pay.amount,
          method: pay.method,
          reference: pay.reference,
          confirmationCode: pay.confirmation_code,
          guestName: pay.guest_name,
          postedBy: pay.recorded_by_station || 'Front Desk',
          stationName: pay.recorded_by_station || 'Front Desk',
          businessDate: pay.recorded_at.slice(0, 10),
          createdAt: pay.recorded_at,
        });
      },
    });
  }

  const walkInOrders = db
    .prepare("SELECT * FROM pos_orders WHERE settlement != 'folio' AND total_amount > 0")
    .all() as PosOrderRow[];

  for (const ord of walkInOrders) {
    events.push({
      sortTs: ord.created_at,
      run: () => {
        recordPosOrderJournal({
          orderId: ord.id,
          orderNumber: ord.order_number,
          diningType: ord.dining_type,
          guestName: ord.guest_name,
          subtotal: ord.subtotal,
          taxAmount: ord.tax_amount,
          totalAmount: ord.total_amount,
          settlement: ord.settlement,
          paymentStatus: ord.payment_status,
          postedBy: ord.station_name || 'Restaurant POS',
          stationName: ord.station_name || 'Restaurant POS',
          businessDate: ord.created_at.slice(0, 10),
          createdAt: ord.created_at,
        });
      },
    });
  }

  const extraIncomes = db
    .prepare('SELECT * FROM extra_income WHERE voided = 0 AND amount > 0')
    .all() as ExtraIncomeRow[];

  for (const ei of extraIncomes) {
    events.push({
      sortTs: ei.created_at,
      run: () => {
        recordExtraIncomeJournal({
          incomeId: ei.id,
          incomeDate: ei.income_date,
          category: ei.category,
          description: ei.description,
          payer: ei.payer,
          paymentMethod: ei.payment_method,
          reference: ei.reference,
          amount: ei.amount,
          postedBy: ei.recorded_by || 'Management',
          stationName: 'Management Office',
          createdAt: ei.created_at,
        });
      },
    });
  }

  const expenses = db
    .prepare('SELECT * FROM expenses WHERE voided = 0 AND amount > 0')
    .all() as ExpenseRow[];

  for (const exp of expenses) {
    events.push({
      sortTs: exp.created_at,
      run: () => {
        recordExpenseJournal({
          expenseId: exp.id,
          expenseDate: exp.expense_date,
          category: exp.category,
          description: exp.description,
          vendor: exp.vendor,
          paymentMethod: exp.payment_method,
          reference: exp.reference,
          amount: exp.amount,
          postedBy: exp.recorded_by || 'Management',
          stationName: 'Management Office',
          createdAt: exp.created_at,
        });
      },
    });
  }

  events.sort((a, b) => a.sortTs.localeCompare(b.sortTs));

  const tx = db.transaction(() => {
    for (const ev of events) {
      ev.run();
    }
  });
  tx();
}

// ---------------- AUDIT INTEGRITY VERIFICATION ----------------

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

interface AuditIntegrityCheckpoint {
  lastJournalId: number;
  lastEntryHash: string;
  expectedSeq: number;
  totalVouchers: number;
  firstVoucher: string;
  lastVoucher: string;
  unbalancedCount: number;
  chainBreaks: number;
  sequenceGaps: number;
  totalDebits: number;
  totalCredits: number;
}

let auditIntegrityCache: AuditIntegrityCheckpoint | null = null;

export function resetAuditIntegrityCache(): void {
  auditIntegrityCache = null;
}

export function verifyAuditTrailIntegrity(): AuditIntegritySummary {
  const stats = db
    .prepare('SELECT COUNT(*) AS cnt, COALESCE(MAX(id), 0) AS max_id FROM accounting_journals')
    .get() as { cnt: number; max_id: number };

  // Fast path: cache hit when no new journals have been appended since last verification
  if (
    auditIntegrityCache &&
    stats.cnt === auditIntegrityCache.totalVouchers &&
    stats.max_id === auditIntegrityCache.lastJournalId
  ) {
    if (stats.cnt === 0) {
      return {
        valid: true,
        totalVouchers: 0,
        firstVoucher: '—',
        lastVoucher: '—',
        unbalancedCount: 0,
        chainBreaks: 0,
        sequenceGaps: 0,
        totalDebits: 0,
        totalCredits: 0,
        checkedAt: new Date().toISOString(),
      };
    }
    const tail = db
      .prepare('SELECT entry_hash FROM accounting_journals WHERE id = ?')
      .get(auditIntegrityCache.lastJournalId) as { entry_hash: string } | undefined;
    if (tail && tail.entry_hash === auditIntegrityCache.lastEntryHash) {
      const c = auditIntegrityCache;
      return {
        valid:
          c.unbalancedCount === 0 &&
          c.chainBreaks === 0 &&
          c.sequenceGaps === 0 &&
          Math.abs(c.totalDebits - c.totalCredits) < 0.005,
        totalVouchers: c.totalVouchers,
        firstVoucher: c.firstVoucher,
        lastVoucher: c.lastVoucher,
        unbalancedCount: c.unbalancedCount,
        chainBreaks: c.chainBreaks,
        sequenceGaps: c.sequenceGaps,
        totalDebits: c.totalDebits,
        totalCredits: c.totalCredits,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  // Incremental delta verification when only new rows were appended
  let canUseDelta = false;
  if (
    auditIntegrityCache &&
    auditIntegrityCache.lastJournalId > 0 &&
    stats.cnt > auditIntegrityCache.totalVouchers &&
    stats.max_id > auditIntegrityCache.lastJournalId
  ) {
    const checkpointRow = db
      .prepare('SELECT entry_hash FROM accounting_journals WHERE id = ?')
      .get(auditIntegrityCache.lastJournalId) as { entry_hash: string } | undefined;
    if (checkpointRow && checkpointRow.entry_hash === auditIntegrityCache.lastEntryHash) {
      canUseDelta = true;
    }
  }

  const startAfterId = canUseDelta ? auditIntegrityCache!.lastJournalId : 0;
  const journals = db
    .prepare('SELECT * FROM accounting_journals WHERE id > ? ORDER BY id ASC')
    .all(startAfterId) as AccountingJournalRow[];

  const allLines = db
    .prepare('SELECT * FROM accounting_journal_lines WHERE journal_id > ? ORDER BY journal_id ASC, id ASC')
    .all(startAfterId) as AccountingJournalLineRow[];

  const linesByJournal = new Map<number, AccountingJournalLineRow[]>();
  for (const line of allLines) {
    const bucket = linesByJournal.get(line.journal_id) ?? [];
    bucket.push(line);
    linesByJournal.set(line.journal_id, bucket);
  }

  let prevHash = canUseDelta ? auditIntegrityCache!.lastEntryHash : 'GENESIS';
  let expectedSeq = canUseDelta ? auditIntegrityCache!.expectedSeq : 1;
  let unbalancedCount = canUseDelta ? auditIntegrityCache!.unbalancedCount : 0;
  let chainBreaks = canUseDelta ? auditIntegrityCache!.chainBreaks : 0;
  let sequenceGaps = canUseDelta ? auditIntegrityCache!.sequenceGaps : 0;
  let totalDebits = canUseDelta ? auditIntegrityCache!.totalDebits : 0;
  let totalCredits = canUseDelta ? auditIntegrityCache!.totalCredits : 0;
  let totalVouchers = canUseDelta ? auditIntegrityCache!.totalVouchers : 0;
  let firstVoucher = canUseDelta ? auditIntegrityCache!.firstVoucher : '—';
  let lastVoucher = canUseDelta ? auditIntegrityCache!.lastVoucher : '—';
  let lastJournalId = canUseDelta ? auditIntegrityCache!.lastJournalId : 0;

  for (const j of journals) {
    if (totalVouchers === 0) firstVoucher = j.voucher_no;
    lastVoucher = j.voucher_no;
    lastJournalId = j.id;
    totalVouchers += 1;

    const expectedVoucher = `JV-${String(expectedSeq).padStart(6, '0')}`;
    if (j.voucher_no !== expectedVoucher) {
      sequenceGaps += 1;
    }
    expectedSeq += 1;

    const lines = linesByJournal.get(j.id) ?? [];
    const lineDebit = roundMoney(lines.reduce((s, l) => s + l.debit, 0));
    const lineCredit = roundMoney(lines.reduce((s, l) => s + l.credit, 0));

    totalDebits = roundMoney(totalDebits + lineDebit);
    totalCredits = roundMoney(totalCredits + lineCredit);

    if (
      Math.abs(j.total_debit - j.total_credit) >= 0.005 ||
      Math.abs(lineDebit - lineCredit) >= 0.005 ||
      Math.abs(j.total_debit - lineDebit) >= 0.005
    ) {
      unbalancedCount += 1;
    }

    const recomputedHash = computeEntryHash({
      voucherNo: j.voucher_no,
      businessDate: j.business_date,
      eventType: j.event_type,
      sourceTable: j.source_table,
      sourceId: j.source_id,
      referenceCode: j.reference_code,
      description: j.description,
      postedBy: j.posted_by,
      totalDebit: j.total_debit,
      totalCredit: j.total_credit,
      reversalOfId: j.reversal_of_id,
      prevHash: j.prev_hash,
      lines: lines.map((l) => ({ account_code: l.account_code, debit: l.debit, credit: l.credit })),
    });

    if (j.prev_hash !== prevHash || recomputedHash !== j.entry_hash) {
      chainBreaks += 1;
    }
    prevHash = j.entry_hash;
  }

  auditIntegrityCache = {
    lastJournalId,
    lastEntryHash: prevHash,
    expectedSeq,
    totalVouchers,
    firstVoucher,
    lastVoucher,
    unbalancedCount,
    chainBreaks,
    sequenceGaps,
    totalDebits,
    totalCredits,
  };

  const valid =
    unbalancedCount === 0 &&
    chainBreaks === 0 &&
    sequenceGaps === 0 &&
    Math.abs(totalDebits - totalCredits) < 0.005;

  return {
    valid,
    totalVouchers,
    firstVoucher,
    lastVoucher,
    unbalancedCount,
    chainBreaks,
    sequenceGaps,
    totalDebits,
    totalCredits,
    checkedAt: new Date().toISOString(),
  };
}

// ---------------- PRE-AUDIT READINESS & OVERVIEW ----------------

export function getNightAuditReadiness(businessDate: string) {
  const stays = getStayDetailsList();
  const inHouseStays = stays.filter((s) => s.status === 'checked_in');
  const holdoverStays = inHouseStays.filter((s) => s.check_out_date <= businessDate);
  const overdueArrivals = stays.filter(
    (s) => s.status === 'reserved' && s.check_in_date <= businessDate
  );

  const unpaidOrders = db
    .prepare(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(total_amount), 0) as total FROM pos_orders WHERE payment_status = 'unpaid' AND COALESCE(voided, 0) = 0"
    )
    .get() as { cnt: number; total: number };

  const openShifts = (
    db.prepare("SELECT COUNT(*) as cnt FROM shifts WHERE status = 'open'").get() as { cnt: number }
  ).cnt;

  const alreadyAudited = Boolean(
    db.prepare('SELECT id FROM night_audits WHERE business_date = ?').get(businessDate)
  );

  return {
    businessDate,
    alreadyAudited,
    inHouseCount: inHouseStays.length,
    holdoverCount: holdoverStays.length,
    overdueArrivalsCount: overdueArrivals.length,
    unpaidPosCount: unpaidOrders.cnt,
    unpaidPosTotal: roundMoney(unpaidOrders.total),
    openShiftsCount: openShifts,
  };
}

export function getAccountingOverview(fromDate: string, toDate: string) {
  const settings = getSettings();
  const businessDate = settings.business_date || getLocalIsoDate();

  // Trial Balance across ALL accounts (cumulative up to toDate so Assets & Liabilities balance properly)
  const cumulativeRows = db
    .prepare(
      `SELECT l.account_code,
              COALESCE(SUM(l.debit), 0) AS total_debit,
              COALESCE(SUM(l.credit), 0) AS total_credit
       FROM accounting_journal_lines l
       JOIN accounting_journals j ON j.id = l.journal_id
       WHERE j.business_date <= ?
       GROUP BY l.account_code`
    )
    .all(toDate) as Array<{ account_code: string; total_debit: number; total_credit: number }>;

  const periodRows = db
    .prepare(
      `SELECT l.account_code,
              COALESCE(SUM(l.debit), 0) AS period_debit,
              COALESCE(SUM(l.credit), 0) AS period_credit
       FROM accounting_journal_lines l
       JOIN accounting_journals j ON j.id = l.journal_id
       WHERE j.business_date >= ? AND j.business_date <= ?
       GROUP BY l.account_code`
    )
    .all(fromDate, toDate) as Array<{ account_code: string; period_debit: number; period_credit: number }>;

  const cumMap = new Map(cumulativeRows.map((r) => [r.account_code, r]));
  const perMap = new Map(periodRows.map((r) => [r.account_code, r]));

  const trialBalance = CHART_OF_ACCOUNTS.map((acct) => {
    const cum = cumMap.get(acct.code);
    const per = perMap.get(acct.code);
    const totalDebit = roundMoney(cum?.total_debit ?? 0);
    const totalCredit = roundMoney(cum?.total_credit ?? 0);
    const periodDebit = roundMoney(per?.period_debit ?? 0);
    const periodCredit = roundMoney(per?.period_credit ?? 0);
    const netBalance =
      acct.normalBalance === 'debit'
        ? roundMoney(totalDebit - totalCredit)
        : roundMoney(totalCredit - totalDebit);
    const endingDebit = totalDebit > totalCredit ? roundMoney(totalDebit - totalCredit) : 0;
    const endingCredit = totalCredit > totalDebit ? roundMoney(totalCredit - totalDebit) : 0;

    return {
      code: acct.code,
      name: acct.name,
      type: acct.type,
      normalBalance: acct.normalBalance,
      plainMeaning: acct.plainMeaning,
      periodDebit,
      periodCredit,
      totalDebit,
      totalCredit,
      netBalance,
      endingDebit,
      endingCredit,
    };
  });

  const tbTotalDebits = roundMoney(trialBalance.reduce((s, r) => s + r.endingDebit, 0));
  const tbTotalCredits = roundMoney(trialBalance.reduce((s, r) => s + r.endingCredit, 0));

  // Journals within selected window (latest first)
  const journals = db
    .prepare(
      `SELECT * FROM accounting_journals
       WHERE business_date >= ? AND business_date <= ?
       ORDER BY id DESC
       LIMIT 250`
    )
    .all(fromDate, toDate) as AccountingJournalRow[];

  const journalIds = journals.map((j) => j.id);
  const linesByJournal = new Map<number, AccountingJournalLineRow[]>();
  if (journalIds.length > 0) {
    const placeholders = journalIds.map(() => '?').join(',');
    const lines = db
      .prepare(
        `SELECT * FROM accounting_journal_lines
         WHERE journal_id IN (${placeholders})
         ORDER BY id ASC`
      )
      .all(...journalIds) as AccountingJournalLineRow[];

    for (const l of lines) {
      const arr = linesByJournal.get(l.journal_id) ?? [];
      arr.push(l);
      linesByJournal.set(l.journal_id, arr);
    }
  }

  const journalWithLines = journals.map((j) => ({
    ...j,
    lines: linesByJournal.get(j.id) ?? [],
  }));

  const integrity = verifyAuditTrailIntegrity();
  const nightAudits = db
    .prepare('SELECT * FROM night_audits ORDER BY business_date DESC, id DESC LIMIT 60')
    .all() as NightAuditRow[];

  const backups = db
    .prepare('SELECT * FROM database_backups ORDER BY created_at DESC, id DESC LIMIT 60')
    .all() as DatabaseBackupRow[];

  const readiness = getNightAuditReadiness(businessDate);
  const clearing = buildChargePaymentClearing(fromDate, toDate);
  const taxRegister = buildTaxRegister(fromDate, toDate);
  const voidAuditReport = buildVoidAuditReport(fromDate, toDate);

  return {
    fromDate,
    toDate,
    businessDate,
    integrity,
    trialBalance,
    trialBalanceTotals: {
      totalDebits: tbTotalDebits,
      totalCredits: tbTotalCredits,
      balanced: Math.abs(tbTotalDebits - tbTotalCredits) < 0.005,
    },
    journals: journalWithLines,
    clearing,
    taxRegister,
    voidAuditReport,
    nightAudits,
    backups,
    readiness,
  };
}

export function buildVoidAuditReport(fromDate: string, toDate: string) {
  const entries = db
    .prepare(
      `SELECT * FROM void_audit_logs
       WHERE substr(created_at, 1, 10) >= ?
         AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(fromDate, toDate) as VoidAuditLogRow[];

  const byTypeMap = new Map<string, { entityType: string; count: number; totalAmount: number }>();
  const byStaffMap = new Map<
    string,
    { staffName: string; role: string; count: number; totalAmount: number }
  >();

  let totalAmount = 0;
  let totalTaxReversed = 0;

  for (const row of entries) {
    const absTotal = roundMoney(Math.abs(row.total_amount));
    const absTax = roundMoney(Math.abs(row.tax_amount));
    totalAmount = roundMoney(totalAmount + absTotal);
    totalTaxReversed = roundMoney(totalTaxReversed + absTax);

    const typeRec = byTypeMap.get(row.entity_type) ?? {
      entityType: row.entity_type,
      count: 0,
      totalAmount: 0,
    };
    typeRec.count += 1;
    typeRec.totalAmount = roundMoney(typeRec.totalAmount + absTotal);
    byTypeMap.set(row.entity_type, typeRec);

    const staffKey = `${row.voided_by}|${row.voided_by_role}`;
    const staffRec = byStaffMap.get(staffKey) ?? {
      staffName: row.voided_by || 'Unknown',
      role: row.voided_by_role || '',
      count: 0,
      totalAmount: 0,
    };
    staffRec.count += 1;
    staffRec.totalAmount = roundMoney(staffRec.totalAmount + absTotal);
    byStaffMap.set(staffKey, staffRec);
  }

  return {
    entries,
    summary: {
      totalCount: entries.length,
      totalAmount,
      totalTaxReversed,
      byType: Array.from(byTypeMap.values()).sort((a, b) => b.totalAmount - a.totalAmount),
      byStaff: Array.from(byStaffMap.values()).sort((a, b) => b.count - a.count),
    },
  };
}

function buildChargePaymentClearing(fromDate: string, toDate: string) {
  // 1. Active folio charges in date range with their exact allocated payments
  const folioCharges = db
    .prepare(
      `SELECT fc.id, fc.stay_id, fc.category, fc.description, fc.reference_code,
              fc.amount, fc.tax_amount, fc.total_amount, fc.posted_at,
              s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_charges fc
       JOIN stays s ON s.id = fc.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE fc.voided = 0
         AND substr(fc.posted_at, 1, 10) >= ?
         AND substr(fc.posted_at, 1, 10) <= ?
       ORDER BY fc.posted_at DESC, fc.id DESC`
    )
    .all(fromDate, toDate) as Array<{
    id: number;
    stay_id: number;
    category: string;
    description: string;
    reference_code: string;
    amount: number;
    tax_amount: number;
    total_amount: number;
    posted_at: string;
    confirmation_code: string;
    guest_name: string;
    room_number: string;
  }>;

  const chargeIds = folioCharges.map((c) => c.id);
  const allocsByCharge = new Map<
    number,
    Array<{
      paymentId: string;
      method: string;
      reference: string;
      recordedAt: string;
      amount: number;
    }>
  >();

  if (chargeIds.length > 0) {
    const placeholders = chargeIds.map(() => '?').join(',');
    const allocRows = db
      .prepare(
        `SELECT pa.charge_id, pa.payment_id, pa.allocated_amount,
                fp.method, fp.reference, fp.recorded_at
         FROM payment_allocations pa
         JOIN folio_payments fp ON fp.id = pa.payment_id
         WHERE pa.charge_id IN (${placeholders})
         ORDER BY fp.recorded_at ASC, pa.id ASC`
      )
      .all(...chargeIds) as Array<{
      charge_id: number;
      payment_id: number;
      allocated_amount: number;
      method: string;
      reference: string;
      recorded_at: string;
    }>;

    for (const row of allocRows) {
      const list = allocsByCharge.get(row.charge_id) ?? [];
      list.push({
        paymentId: `PAY-${row.payment_id}`,
        method: row.method.replace('_', ' '),
        reference: row.reference || `PAY-${row.payment_id}`,
        recordedAt: row.recorded_at,
        amount: roundMoney(row.allocated_amount),
      });
      allocsByCharge.set(row.charge_id, list);
    }
  }

  type ClearingChargeItem = {
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
    allocations: Array<{
      paymentId: string;
      method: string;
      reference: string;
      recordedAt: string;
      amount: number;
    }>;
  };

  type ClearingPaymentItem = {
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
    coveredCharges: Array<{
      chargeId: string;
      reference: string;
      description: string;
      department: 'Front Desk' | 'Restaurant' | 'Other Income';
      amount: number;
    }>;
  };

  const charges: ClearingChargeItem[] = [];
  const payments: ClearingPaymentItem[] = [];

  for (const c of folioCharges) {
    const dept: 'Front Desk' | 'Restaurant' =
      c.category === 'restaurant_pos' || c.category === 'restaurant_manual' ? 'Restaurant' : 'Front Desk';
    const allocs = allocsByCharge.get(c.id) ?? [];
    const isCreditNote = c.total_amount < 0;
    const paidAmount = isCreditNote ? roundMoney(c.total_amount) : roundMoney(allocs.reduce((s, a) => s + a.amount, 0));
    const remainingAmount = isCreditNote ? 0 : Math.max(0, roundMoney(c.total_amount - paidAmount));
    const status: 'paid' | 'partial' | 'unpaid' = isCreditNote
      ? 'paid'
      : remainingAmount < 0.01
        ? 'paid'
        : paidAmount > 0.004
          ? 'partial'
          : 'unpaid';

    charges.push({
      id: `CHG-${c.id}`,
      date: c.posted_at.slice(0, 10),
      timestamp: c.posted_at,
      department: dept,
      reference: c.reference_code || c.confirmation_code,
      description: c.description,
      party: `${c.guest_name} (Rm ${c.room_number})`,
      totalAmount: roundMoney(c.total_amount),
      paidAmount,
      remainingAmount,
      status,
      allocations: allocs,
    });
  }

  // 2. Non-folio Restaurant POS orders in date range
  const walkInOrders = db
    .prepare(
      `SELECT * FROM pos_orders
       WHERE settlement != 'folio'
         AND COALESCE(voided, 0) = 0
         AND substr(created_at, 1, 10) >= ?
         AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(fromDate, toDate) as PosOrderRow[];

  for (const o of walkInOrders) {
    const isPaid = o.payment_status !== 'unpaid';
    const paidTs = o.paid_at || o.created_at;
    const desc = `Restaurant Order (${o.dining_type.replace('_', ' ')})${o.table_number ? ` · ${o.table_number}` : ''}`;
    const party = o.guest_name || 'Dine-In Guest';
    charges.push({
      id: `POS-${o.id}`,
      date: o.created_at.slice(0, 10),
      timestamp: o.created_at,
      department: 'Restaurant',
      reference: o.order_number,
      description: desc,
      party,
      totalAmount: roundMoney(o.total_amount),
      paidAmount: isPaid ? roundMoney(o.total_amount) : 0,
      remainingAmount: isPaid ? 0 : roundMoney(o.total_amount),
      status: isPaid ? 'paid' : 'unpaid',
      allocations: isPaid
        ? [
            {
              paymentId: `POS-PAY-${o.id}`,
              method: o.settlement.replace('_', ' '),
              reference: o.payment_reference || o.order_number,
              recordedAt: paidTs,
              amount: roundMoney(o.total_amount),
            },
          ]
        : [],
    });

    if (isPaid) {
      payments.push({
        id: `POS-PAY-${o.id}`,
        date: paidTs.slice(0, 10),
        timestamp: paidTs,
        department: 'Restaurant',
        method: o.settlement.replace('_', ' '),
        reference: o.payment_reference || o.order_number,
        party,
        totalAmount: roundMoney(o.total_amount),
        allocatedAmount: roundMoney(o.total_amount),
        unallocatedAmount: 0,
        coveredCharges: [
          {
            chargeId: `POS-${o.id}`,
            reference: o.order_number,
            description: desc,
            department: 'Restaurant',
            amount: roundMoney(o.total_amount),
          },
        ],
      });
    }
  }

  // 3. Active Extra Income receipts in date range (direct instant clearing)
  const extraIncomes = db
    .prepare(
      `SELECT * FROM extra_income
       WHERE voided = 0
         AND income_date >= ?
         AND income_date <= ?
       ORDER BY income_date DESC, id DESC`
    )
    .all(fromDate, toDate) as ExtraIncomeRow[];

  for (const ei of extraIncomes) {
    const ref = ei.reference || `INC-${ei.id}`;
    const desc = `${ei.category} — ${ei.description}`;
    const party = ei.payer || 'Direct Client';
    charges.push({
      id: `INC-${ei.id}`,
      date: ei.income_date,
      timestamp: ei.created_at,
      department: 'Other Income',
      reference: ref,
      description: desc,
      party,
      totalAmount: roundMoney(ei.amount),
      paidAmount: roundMoney(ei.amount),
      remainingAmount: 0,
      status: 'paid',
      allocations: [
        {
          paymentId: `INC-PAY-${ei.id}`,
          method: ei.payment_method.replace('_', ' '),
          reference: ref,
          recordedAt: ei.created_at,
          amount: roundMoney(ei.amount),
        },
      ],
    });

    payments.push({
      id: `INC-PAY-${ei.id}`,
      date: ei.income_date,
      timestamp: ei.created_at,
      department: 'Other Income',
      method: ei.payment_method.replace('_', ' '),
      reference: ref,
      party,
      totalAmount: roundMoney(ei.amount),
      allocatedAmount: roundMoney(ei.amount),
      unallocatedAmount: 0,
      coveredCharges: [
        {
          chargeId: `INC-${ei.id}`,
          reference: ref,
          description: desc,
          department: 'Other Income',
          amount: roundMoney(ei.amount),
        },
      ],
    });
  }

  // 4. Folio payments & refunds in date range with every charge each payment cleared
  const folioPayments = db
    .prepare(
      `SELECT fp.id, fp.stay_id, fp.amount, fp.method, fp.reference, fp.recorded_at,
              COALESCE(fp.kind, 'payment') AS kind,
              s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_payments fp
       JOIN stays s ON s.id = fp.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE COALESCE(fp.voided, 0) = 0
         AND substr(fp.recorded_at, 1, 10) >= ?
         AND substr(fp.recorded_at, 1, 10) <= ?
       ORDER BY fp.recorded_at DESC, fp.id DESC`
    )
    .all(fromDate, toDate) as Array<{
    id: number;
    stay_id: number;
    amount: number;
    method: string;
    reference: string;
    recorded_at: string;
    kind: string;
    confirmation_code: string;
    guest_name: string;
    room_number: string;
  }>;

  const paymentIds = folioPayments.map((p) => p.id);
  const coveredByPayment = new Map<
    number,
    Array<{
      chargeId: string;
      reference: string;
      description: string;
      department: 'Front Desk' | 'Restaurant';
      amount: number;
    }>
  >();

  if (paymentIds.length > 0) {
    const placeholders = paymentIds.map(() => '?').join(',');
    const covRows = db
      .prepare(
        `SELECT pa.payment_id, pa.charge_id, pa.allocated_amount,
                fc.category, fc.description, fc.reference_code
         FROM payment_allocations pa
         JOIN folio_charges fc ON fc.id = pa.charge_id
         WHERE pa.payment_id IN (${placeholders})
         ORDER BY fc.posted_at ASC, pa.id ASC`
      )
      .all(...paymentIds) as Array<{
      payment_id: number;
      charge_id: number;
      allocated_amount: number;
      category: string;
      description: string;
      reference_code: string;
    }>;

    for (const row of covRows) {
      const list = coveredByPayment.get(row.payment_id) ?? [];
      list.push({
        chargeId: `CHG-${row.charge_id}`,
        reference: row.reference_code || `CHG-${row.charge_id}`,
        description: row.description,
        department:
          row.category === 'restaurant_pos' || row.category === 'restaurant_manual'
            ? 'Restaurant'
            : 'Front Desk',
        amount: roundMoney(row.allocated_amount),
      });
      coveredByPayment.set(row.payment_id, list);
    }
  }

  for (const p of folioPayments) {
    const isRefund = p.kind === 'refund';
    const covered = isRefund ? [] : (coveredByPayment.get(p.id) ?? []);
    const allocatedAmount = isRefund ? 0 : roundMoney(covered.reduce((s, c) => s + c.amount, 0));
    const unallocatedAmount = isRefund ? 0 : Math.max(0, roundMoney(p.amount - allocatedAmount));
    payments.push({
      id: isRefund ? `REF-${p.id}` : `PAY-${p.id}`,
      date: p.recorded_at.slice(0, 10),
      timestamp: p.recorded_at,
      department: 'Front Desk',
      method: isRefund ? `Refund (${p.method.replace('_', ' ')})` : p.method.replace('_', ' '),
      reference: p.reference || p.confirmation_code,
      party: `${p.guest_name} (Rm ${p.room_number})`,
      totalAmount: isRefund ? roundMoney(-p.amount) : roundMoney(p.amount),
      allocatedAmount,
      unallocatedAmount,
      coveredCharges: covered,
    });
  }

  charges.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  payments.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const totalCharged = roundMoney(charges.reduce((s, c) => s + c.totalAmount, 0));
  const totalCleared = roundMoney(charges.reduce((s, c) => s + c.paidAmount, 0));
  const totalUnpaid = roundMoney(charges.reduce((s, c) => s + c.remainingAmount, 0));
  const unallocatedDeposits = roundMoney(payments.reduce((s, p) => s + p.unallocatedAmount, 0));

  return {
    charges,
    payments,
    summary: {
      totalCharged,
      totalCleared,
      totalUnpaid,
      unallocatedDeposits,
      paidCount: charges.filter((c) => c.status === 'paid').length,
      partialCount: charges.filter((c) => c.status === 'partial').length,
      unpaidCount: charges.filter((c) => c.status === 'unpaid').length,
    },
  };
}

function parseTaxBreakdownJson(
  rawJson: string | null | undefined,
  fallbackLabel: string,
  fallbackTaxAmount: number
): Array<{ name: string; rate: number; mode: string; amount: number }> {
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .filter((item) => item && Number(item.amount) > 0)
          .map((item) => ({
            name: String(item.name || 'Tax'),
            rate: Number(item.rate || 0),
            mode: String(item.mode || 'exclusive'),
            amount: roundMoney(Number(item.amount || 0)),
          }));
      }
    } catch {
      // Fallback below
    }
  }
  if (fallbackTaxAmount > 0) {
    const rateMatch = fallbackLabel.match(/(\d+(?:\.\d+)?)%/);
    const cleanName = fallbackLabel.replace(/\s*\([^)]*\)\s*/g, '').trim() || 'Tax';
    return [
      {
        name: cleanName,
        rate: rateMatch ? Number(rateMatch[1]) : 0,
        mode: fallbackLabel.toLowerCase().includes('incl') ? 'inclusive' : 'exclusive',
        amount: roundMoney(fallbackTaxAmount),
      },
    ];
  }
  return [];
}

function buildTaxRegister(fromDate: string, toDate: string) {
  const entries: Array<{
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
    breakdown: Array<{ name: string; rate: number; mode: string; amount: number }>;
  }> = [];

  // 1. Taxed non-voided folio charges (includes room nights, services, and folio-posted restaurant orders)
  const folioRows = db
    .prepare(
      `SELECT fc.id, fc.category, fc.description, fc.reference_code,
              fc.amount, fc.tax_amount, fc.total_amount, fc.tax_label, fc.tax_breakdown_json, fc.posted_at,
              s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_charges fc
       JOIN stays s ON s.id = fc.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE fc.voided = 0
         AND fc.tax_amount > 0
         AND substr(fc.posted_at, 1, 10) >= ?
         AND substr(fc.posted_at, 1, 10) <= ?
       ORDER BY fc.posted_at DESC, fc.id DESC`
    )
    .all(fromDate, toDate) as Array<{
    id: number;
    category: string;
    description: string;
    reference_code: string;
    amount: number;
    tax_amount: number;
    total_amount: number;
    tax_label: string;
    tax_breakdown_json: string;
    posted_at: string;
    confirmation_code: string;
    guest_name: string;
    room_number: string;
  }>;

  for (const ch of folioRows) {
    const department: 'Accommodation' | 'Restaurant' | 'Front Desk' =
      ch.category === 'room'
        ? 'Accommodation'
        : ch.category === 'restaurant_pos' || ch.category === 'restaurant_manual'
          ? 'Restaurant'
          : 'Front Desk';
    const breakdown = parseTaxBreakdownJson(ch.tax_breakdown_json, ch.tax_label || 'Tax', ch.tax_amount);
    const label =
      ch.tax_label ||
      breakdown.map((b) => `${b.name}${b.rate > 0 ? ` (${b.rate}%)` : ''}`).join(' + ') ||
      'Tax';

    entries.push({
      id: `TAX-CHG-${ch.id}`,
      date: ch.posted_at.slice(0, 10),
      timestamp: ch.posted_at,
      source: 'Folio Charge',
      department,
      reference: ch.reference_code || ch.confirmation_code,
      description: ch.description,
      party: `${ch.guest_name} (Rm ${ch.room_number})`,
      taxLabel: label,
      taxableBase: roundMoney(ch.amount),
      taxAmount: roundMoney(ch.tax_amount),
      grossTotal: roundMoney(ch.total_amount || ch.amount + ch.tax_amount),
      breakdown,
    });
  }

  // 2. Taxed non-folio Restaurant POS orders (walk-in / dine-in; excludes 'folio' so nothing is double-counted)
  const posRows = db
    .prepare(
      `SELECT id, order_number, dining_type, guest_name, table_number,
              subtotal, tax_amount, total_amount, tax_breakdown_json, created_at
       FROM pos_orders
       WHERE settlement != 'folio'
         AND COALESCE(voided, 0) = 0
         AND tax_amount > 0
         AND substr(created_at, 1, 10) >= ?
         AND substr(created_at, 1, 10) <= ?
       ORDER BY created_at DESC, id DESC`
    )
    .all(fromDate, toDate) as Array<{
    id: number;
    order_number: string;
    dining_type: string;
    guest_name: string;
    table_number: string;
    subtotal: number;
    tax_amount: number;
    total_amount: number;
    tax_breakdown_json: string;
    created_at: string;
  }>;

  for (const o of posRows) {
    const breakdown = parseTaxBreakdownJson(o.tax_breakdown_json, 'Tax', o.tax_amount);
    const label =
      breakdown.map((b) => `${b.name}${b.rate > 0 ? ` (${b.rate}%)` : ''}`).join(' + ') || 'Tax';
    const party = o.guest_name || (o.table_number ? `Table ${o.table_number}` : 'Walk-in Guest');

    entries.push({
      id: `TAX-POS-${o.id}`,
      date: o.created_at.slice(0, 10),
      timestamp: o.created_at,
      source: 'Restaurant POS',
      department: 'Restaurant',
      reference: o.order_number,
      description: `${o.dining_type === 'room_service' ? 'Room Service' : 'Dine-In'} Order ${o.order_number}`,
      party,
      taxLabel: label,
      taxableBase: roundMoney(o.subtotal),
      taxAmount: roundMoney(o.tax_amount),
      grossTotal: roundMoney(o.total_amount || o.subtotal + o.tax_amount),
      breakdown,
    });
  }

  entries.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const ruleMap = new Map<
    string,
    { name: string; rate: number; mode: string; taxableBase: number; taxAmount: number; count: number }
  >();

  let totalTaxableBase = 0;
  let totalTaxCollected = 0;
  let totalGross = 0;
  let accommodationTax = 0;
  let restaurantTax = 0;
  let frontDeskTax = 0;

  for (const e of entries) {
    totalTaxableBase = roundMoney(totalTaxableBase + e.taxableBase);
    totalTaxCollected = roundMoney(totalTaxCollected + e.taxAmount);
    totalGross = roundMoney(totalGross + e.grossTotal);

    if (e.department === 'Accommodation') {
      accommodationTax = roundMoney(accommodationTax + e.taxAmount);
    } else if (e.department === 'Restaurant') {
      restaurantTax = roundMoney(restaurantTax + e.taxAmount);
    } else {
      frontDeskTax = roundMoney(frontDeskTax + e.taxAmount);
    }

    for (const b of e.breakdown) {
      const key = `${b.name}|${b.rate}|${b.mode}`;
      const existing = ruleMap.get(key) ?? {
        name: b.name,
        rate: b.rate,
        mode: b.mode,
        taxableBase: 0,
        taxAmount: 0,
        count: 0,
      };
      existing.taxableBase = roundMoney(existing.taxableBase + e.taxableBase);
      existing.taxAmount = roundMoney(existing.taxAmount + b.amount);
      existing.count += 1;
      ruleMap.set(key, existing);
    }
  }

  return {
    entries,
    summary: {
      totalTaxableBase,
      totalTaxCollected,
      totalGross,
      accommodationTax,
      restaurantTax,
      frontDeskTax,
      transactionCount: entries.length,
      byRule: Array.from(ruleMap.values()).sort((a, b) => b.taxAmount - a.taxAmount),
    },
  };
}

// ---------------- BACKUP ENGINE (ONLINE SAFE SQLITE BACKUP) ----------------

function pruneOldBackups(retentionCount: number): void {
  const keep = Math.max(3, Math.min(365, retentionCount || 30));
  const all = db
    .prepare('SELECT id, filename FROM database_backups ORDER BY created_at DESC, id DESC')
    .all() as Array<{ id: number; filename: string }>;

  if (all.length <= keep) return;

  const toRemove = all.slice(keep);
  for (const row of toRemove) {
    const safePath = resolveBackupPath(row.filename);
    if (safePath && fs.existsSync(safePath)) {
      try {
        fs.unlinkSync(safePath);
      } catch {
        // Ignore filesystem unlink errors during pruning
      }
    }
    db.prepare('DELETE FROM database_backups WHERE id = ?').run(row.id);
  }
}

export function resolveBackupPath(filename: string): string | null {
  if (!/^[a-zA-Z0-9._-]+\.db$/.test(filename)) return null;
  const resolved = path.resolve(BACKUPS_DIR, filename);
  if (!resolved.startsWith(BACKUPS_DIR + path.sep)) return null;
  return resolved;
}

export async function createDatabaseBackup(params: {
  triggerType: 'night_audit' | 'manual' | 'pre_restore';
  triggeredBy: string;
  businessDate: string;
  nightAuditId?: number | null;
}): Promise<DatabaseBackupRow> {
  ensureBackupsDir();
  const settings = getSettings();
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const prefix =
    params.triggerType === 'night_audit'
      ? 'hosila-audit'
      : params.triggerType === 'pre_restore'
        ? 'hosila-prerestore'
        : 'hosila-manual';
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(params.businessDate)
    ? params.businessDate
    : getLocalIsoDate();
  const filename = `${prefix}-${safeDate}-${ts}.db`;
  const destPath = resolveBackupPath(filename);
  if (!destPath) {
    throw new Error('Failed to generate safe backup path');
  }

  // Uses SQLite's native online backup API — safe while live workstations are connected
  await db.backup(destPath);

  // Verify the newly created backup snapshot passes SQLite integrity_check
  let verifyConn: Database.Database | null = null;
  try {
    verifyConn = new Database(destPath, { readonly: true });
    const check = verifyConn.pragma('integrity_check') as Array<{ integrity_check?: string }>;
    const ok = check.length > 0 && check.every((r) => r.integrity_check === 'ok');
    if (!ok) {
      throw new Error('Backup integrity check failed');
    }
  } finally {
    verifyConn?.close();
  }

  // Optional off-PC backup mirror (e.g. USB drive or LAN shared folder via HOSILA_BACKUP_MIRROR_DIR)
  const mirrorDir = process.env.HOSILA_BACKUP_MIRROR_DIR?.trim();
  if (mirrorDir) {
    try {
      const resolvedMirror = path.resolve(mirrorDir);
      if (!fs.existsSync(resolvedMirror)) {
        fs.mkdirSync(resolvedMirror, { recursive: true });
      }
      fs.copyFileSync(destPath, path.join(resolvedMirror, filename));
    } catch (err) {
      console.warn('Secondary off-PC backup mirror failed (primary local backup succeeded):', err);
    }
  }

  const stat = fs.statSync(destPath);
  const hash = crypto.createHash('sha256').update(fs.readFileSync(destPath)).digest('hex');
  const nowIso = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO database_backups (filename, trigger_type, triggered_by, business_date, night_audit_id, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      filename,
      params.triggerType,
      params.triggeredBy.slice(0, 80),
      safeDate,
      params.nightAuditId ?? null,
      stat.size,
      hash,
      nowIso
    );

  const backupId = Number(info.lastInsertRowid);
  pruneOldBackups(settings.backup_retention_count);

  return db.prepare('SELECT * FROM database_backups WHERE id = ?').get(backupId) as DatabaseBackupRow;
}

/**
 * Safeguarded Management-only restore from an existing verified backup snapshot.
 * 1. Confines path to BACKUPS_DIR and checks file existence + SHA-256 checksum.
 * 2. Validates SQLite integrity and required core tables in read-only mode.
 * 3. Takes an automatic pre-restore safety snapshot of the current live database.
 * 4. Atomically closes, swaps, reopens, and migrates the restored database.
 * 5. Preserves the pre-restore safety snapshot metadata inside the restored DB so rollback is always one click away.
 */
export async function restoreDatabaseFromBackup(
  backupId: number,
  restoredBy: string
): Promise<{ restoredBackup: DatabaseBackupRow; safetySnapshot: DatabaseBackupRow }> {
  if (nightAuditLock) {
    throw new Error('Cannot restore while Night Audit is running. Please try again shortly.');
  }
  nightAuditLock = true;

  try {
    const targetRow = db
      .prepare('SELECT * FROM database_backups WHERE id = ?')
      .get(backupId) as DatabaseBackupRow | undefined;

    if (!targetRow) {
      throw new Error('Backup record not found');
    }

    const resolvedPath = resolveBackupPath(targetRow.filename);
    if (!resolvedPath || !fs.existsSync(resolvedPath)) {
      throw new Error('Backup file is missing on disk');
    }

    // Verify SHA-256 checksum if stored
    const actualHash = crypto.createHash('sha256').update(fs.readFileSync(resolvedPath)).digest('hex');
    if (targetRow.sha256 && actualHash !== targetRow.sha256) {
      throw new Error('Backup file failed SHA-256 integrity verification and cannot be restored');
    }

    // Validate SQLite file health and core tables in read-only mode before modifying live DB
    let probe: Database.Database | null = null;
    try {
      probe = new Database(resolvedPath, { readonly: true, fileMustExist: true });
      const checkRow = probe.prepare('PRAGMA quick_check').get() as Record<string, string> | undefined;
      const checkVal = checkRow ? Object.values(checkRow)[0] : '';
      if (checkVal !== 'ok') {
        throw new Error('Backup SQLite integrity check failed');
      }
      const tables = probe
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map((t) => t.name));
      for (const required of ['settings', 'rooms', 'stays', 'staff_users']) {
        if (!tableNames.has(required)) {
          throw new Error(`Backup file is missing required table: ${required}`);
        }
      }
    } finally {
      if (probe) {
        try {
          probe.close();
        } catch {
          // Ignore close errors
        }
      }
    }

    // Create automatic pre-restore safety snapshot before swapping live database
    const currentSettings = getSettings();
    const safetySnapshot = await createDatabaseBackup({
      triggerType: 'pre_restore',
      triggeredBy: `Pre-Restore Safety (${restoredBy})`,
      businessDate: currentSettings.business_date || getLocalIsoDate(),
    });

    // Perform safe live DB swap + schema migration + accounting init
    replaceDatabaseFromFile(resolvedPath);
    resetAuditIntegrityCache();
    initAccountingTables();

    // Record the pre-restore safety snapshot inside the restored database so management can always roll back
    db.prepare(
      `INSERT OR IGNORE INTO database_backups (filename, trigger_type, triggered_by, business_date, night_audit_id, size_bytes, sha256, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      safetySnapshot.filename,
      safetySnapshot.trigger_type,
      safetySnapshot.triggered_by,
      safetySnapshot.business_date,
      null,
      safetySnapshot.size_bytes,
      safetySnapshot.sha256,
      safetySnapshot.created_at
    );

    return { restoredBackup: targetRow, safetySnapshot };
  } finally {
    nightAuditLock = false;
  }
}

// ---------------- NIGHT AUDIT AUTOMATION ENGINE ----------------

let nightAuditLock = false;

export async function runNightAudit(params: {
  triggerType: 'auto' | 'manual';
  triggeredBy: string;
  notes?: string;
}): Promise<{ audit: NightAuditRow; backup: DatabaseBackupRow | null; nextBusinessDate: string }> {
  if (nightAuditLock) {
    throw new Error('Night Audit is already running. Please wait a moment.');
  }
  nightAuditLock = true;

  try {
    const settings = getSettings();
    const businessDate = settings.business_date || getLocalIsoDate();

    const existing = db
      .prepare('SELECT id FROM night_audits WHERE business_date = ?')
      .get(businessDate) as { id: number } | undefined;
    if (existing) {
      throw new Error(`Night Audit for business date ${businessDate} has already been completed.`);
    }

    const nowIso = new Date().toISOString();
    const nextBusinessDate = addDaysIso(businessDate, 1);

    const auditId = db.transaction(() => {
      // 1. Check all in-house stays; if any guest is holding over past check_out_date, extend 1 night & post room charge + journal
      const checkedInStays = db
        .prepare(
          `SELECT s.*, r.room_number, r.room_type
           FROM stays s
           LEFT JOIN rooms r ON r.id = s.room_id
           WHERE s.status = 'checked_in'`
        )
        .all() as Array<StayRow & { room_number: string | null; room_type: string | null }>;

      let holdoverNightsPosted = 0;

      for (const stay of checkedInStays) {
        if (stay.check_out_date <= businessDate) {
          const newCheckOut = addDaysIso(businessDate, 1);
          const taxCalc = calculateTransactionTax(stay.nightly_rate, 'accommodation', settings);
          const taxLabel = taxCalc.applicable ? taxCalc.taxLabel : '';
          const taxBreakdownJson = JSON.stringify(taxCalc.breakdown);
          const roomNum = stay.room_number || 'Unassigned';
          const roomType = stay.room_type || stay.requested_room_type || 'Room';

          db.prepare('UPDATE stays SET check_out_date = ? WHERE id = ?').run(newCheckOut, stay.id);

          const chgInfo = db
            .prepare(
              `INSERT INTO folio_charges (
                stay_id, category, description, reference_code, quantity, unit_price,
                amount, tax_amount, total_amount, tax_label, tax_breakdown_json, posted_by_station, posted_at
              )
              VALUES (?, 'room', ?, ?, 1, ?, ?, ?, ?, ?, ?, 'Night Audit', ?)`
            )
            .run(
              stay.id,
              `Room ${roomNum} — ${roomType} (Night Audit Holdover ${businessDate})`,
              `NA-${businessDate}`,
              stay.nightly_rate,
              taxCalc.netAmount,
              taxCalc.taxAmount,
              taxCalc.totalAmount,
              taxLabel,
              taxBreakdownJson,
              nowIso
            );

          recordFolioChargeJournal({
            chargeId: Number(chgInfo.lastInsertRowid),
            category: 'room',
            description: `Night Audit Room Posting — Room ${roomNum} (${businessDate})`,
            referenceCode: `NA-${businessDate}`,
            netAmount: taxCalc.netAmount,
            taxAmount: taxCalc.taxAmount,
            totalAmount: taxCalc.totalAmount,
            postedBy: params.triggeredBy,
            stationName: 'Night Audit',
            businessDate,
            createdAt: nowIso,
            eventType: 'night_audit_room_post',
          });

          reconcileStayAllocations(stay.id);
          holdoverNightsPosted += 1;
        }
      }

      // 2. Capture immutable daily financial & operational snapshot for this business date
      const totalRooms = Math.max(
        1,
        (db.prepare('SELECT COUNT(*) as cnt FROM rooms').get() as { cnt: number }).cnt
      );
      const roomsOccupied = checkedInStays.length;
      const occupancyPct = roundMoney((roomsOccupied / totalRooms) * 100);

      const dayJournals = db
        .prepare('SELECT * FROM accounting_journals WHERE business_date = ?')
        .all(businessDate) as AccountingJournalRow[];

      const dayLines = db
        .prepare(
          `SELECT l.* FROM accounting_journal_lines l
           JOIN accounting_journals j ON j.id = l.journal_id
           WHERE j.business_date = ?`
        )
        .all(businessDate) as AccountingJournalLineRow[];

      const roomRevenue = roundMoney(
        dayLines
          .filter((l) => l.account_code === '4100')
          .reduce((s, l) => s + l.credit - l.debit, 0)
      );
      const restaurantRevenue = roundMoney(
        dayLines
          .filter((l) => l.account_code === '4200')
          .reduce((s, l) => s + l.credit - l.debit, 0)
      );
      const otherRevenue = roundMoney(
        dayLines
          .filter((l) => l.account_code === '4300' || l.account_code === '4400')
          .reduce((s, l) => s + l.credit - l.debit, 0)
      );
      const taxCollected = roundMoney(
        dayLines
          .filter((l) => l.account_code === '2200')
          .reduce((s, l) => s + l.credit - l.debit, 0)
      );
      const paymentsCollected = roundMoney(
        dayLines
          .filter((l) => ['1010', '1020', '1030', '1150'].includes(l.account_code))
          .reduce((s, l) => s + l.debit, 0)
      );
      const expensesTotal = roundMoney(
        dayLines
          .filter((l) => l.account_type === 'expense')
          .reduce((s, l) => s + l.debit - l.credit, 0)
      );

      const unpaidPosTotal = roundMoney(
        (
          db
            .prepare(
              "SELECT COALESCE(SUM(total_amount), 0) as total FROM pos_orders WHERE payment_status = 'unpaid' AND COALESCE(voided, 0) = 0"
            )
            .get() as { total: number }
        ).total
      );

      const allStays = getStayDetailsList();
      const outstandingGuestBalance = roundMoney(
        allStays
          .filter((s) => s.status !== 'cancelled' && s.balance_due > 0)
          .reduce((s, st) => s + st.balance_due, 0)
      );
      const pendingArrivalsCount = allStays.filter(
        (s) => s.status === 'reserved' && s.check_in_date <= businessDate
      ).length;
      const openShiftsCount = (
        db.prepare("SELECT COUNT(*) as cnt FROM shifts WHERE status = 'open'").get() as { cnt: number }
      ).cnt;

      const totalDebits = roundMoney(dayLines.reduce((s, l) => s + l.debit, 0));
      const totalCredits = roundMoney(dayLines.reduce((s, l) => s + l.credit, 0));
      const integrity = verifyAuditTrailIntegrity();
      const balanced = integrity.valid && Math.abs(totalDebits - totalCredits) < 0.005 ? 1 : 0;

      const auditNumber = `NA-${businessDate.replace(/-/g, '')}`;
      const insertAudit = db
        .prepare(
          `INSERT INTO night_audits (
            audit_number, business_date, trigger_type, triggered_by,
            rooms_occupied, total_rooms, occupancy_pct, holdover_nights_posted,
            room_revenue, restaurant_revenue, other_revenue, tax_collected,
            payments_collected, expenses_total, unpaid_pos_total, outstanding_guest_balance,
            pending_arrivals_count, open_shifts_count, journal_count,
            total_debits, total_credits, balanced, backup_id, backup_filename, notes, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', ?, ?)`
        )
        .run(
          auditNumber,
          businessDate,
          params.triggerType,
          params.triggeredBy.slice(0, 80),
          roomsOccupied,
          totalRooms,
          occupancyPct,
          holdoverNightsPosted,
          roomRevenue,
          restaurantRevenue,
          otherRevenue,
          taxCollected,
          paymentsCollected,
          expensesTotal,
          unpaidPosTotal,
          outstandingGuestBalance,
          pendingArrivalsCount,
          openShiftsCount,
          dayJournals.length,
          totalDebits,
          totalCredits,
          balanced,
          (params.notes ?? '').trim().slice(0, 300),
          nowIso
        );

      // 3. Roll hotel business date forward by 1 day
      db.prepare(
        `UPDATE settings
         SET business_date = ?, last_night_audit_date = ?, last_night_audit_at = ?
         WHERE id = 1`
      ).run(nextBusinessDate, businessDate, nowIso);

      return Number(insertAudit.lastInsertRowid);
    })();

    // 4. Automatic database backup immediately after Night Audit (outside SQLite write tx)
    let backup: DatabaseBackupRow | null = null;
    if (settings.auto_backup_after_audit === 1) {
      backup = await createDatabaseBackup({
        triggerType: 'night_audit',
        triggeredBy: params.triggerType === 'auto' ? 'Auto Night Audit' : params.triggeredBy,
        businessDate,
        nightAuditId: auditId,
      });

      db.prepare('UPDATE night_audits SET backup_id = ?, backup_filename = ? WHERE id = ?').run(
        backup.id,
        backup.filename,
        auditId
      );
    }

    const audit = db.prepare('SELECT * FROM night_audits WHERE id = ?').get(auditId) as NightAuditRow;
    return { audit, backup, nextBusinessDate };
  } finally {
    nightAuditLock = false;
  }
}

/**
 * Evaluates whether the automated Night Audit should execute right now.
 * Uses real hospitality business-day cutoff logic:
 * - Early-morning audit time (00:00–05:59): closes `business_date` once calendar date > `business_date` and local time >= `night_audit_time`.
 * - Late-evening audit time (06:00–23:59): closes `business_date` once calendar date === `business_date` and local time >= `night_audit_time` (or if calendar date > `business_date`).
 */
export async function checkScheduledNightAudit(): Promise<boolean> {
  if (nightAuditLock) return false;
  const settings = getSettings();
  if (settings.night_audit_enabled !== 1) return false;

  const businessDate = settings.business_date || getLocalIsoDate();
  const auditTime = /^\d{2}:\d{2}$/.test(settings.night_audit_time) ? settings.night_audit_time : '02:00';
  const auditHour = Number(auditTime.slice(0, 2));

  const now = new Date();
  const today = getLocalIsoDate(now);
  const currentHHMM = getLocalHHMM(now);

  let isDue = false;
  if (auditHour < 6) {
    // Early-morning audit (e.g. 02:00) closes previous calendar day
    const nextDay = addDaysIso(businessDate, 1);
    if (today > nextDay) {
      isDue = true;
    } else if (today === nextDay && currentHHMM >= auditTime) {
      isDue = true;
    }
  } else {
    // Same-evening audit (e.g. 23:30) closes current business date
    if (today > businessDate) {
      isDue = true;
    } else if (today === businessDate && currentHHMM >= auditTime) {
      isDue = true;
    }
  }

  if (!isDue) return false;

  const alreadyRan = db
    .prepare('SELECT id FROM night_audits WHERE business_date = ?')
    .get(businessDate);
  if (alreadyRan) return false;

  await runNightAudit({
    triggerType: 'auto',
    triggeredBy: 'Automatic Night Audit Scheduler',
    notes: `Automated close at scheduled time ${auditTime}`,
  });
  return true;
}
