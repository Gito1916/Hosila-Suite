import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ChevronRight,
  Database,
  Download,
  HardDrive,
  Moon,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import type {
  AccountingJournalEntry,
  AccountingOverview,
  ClearingChargeItem,
  ClearingPaymentItem,
  DatabaseBackupRecord,
  HotelSettings,
  NightAuditRecord,
  StaffRole,
  TaxRegisterEntry,
  VoidAuditEntry,
  VoidEntityType,
} from '../types';
import {
  ACCOUNT_TYPE_LABELS,
  EVENT_TYPE_LABELS,
  STAFF_ROLE_LABELS,
} from '../utils/constants';
import { Drawer } from './Drawer';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';
import { PaginationBar } from './PaginationBar';

export type LedgerAuditSubView =
  | 'clearing'
  | 'journal'
  | 'trial_balance'
  | 'tax_register'
  | 'void_audit';

interface LedgerAndAuditTabProps {
  overview: AccountingOverview | null;
  settings: HotelSettings;
  subView: LedgerAuditSubView;
  onChangeSubView: (next: LedgerAuditSubView) => void;
  clearingMode: 'charges' | 'payments';
  onChangeClearingMode: (next: 'charges' | 'payments') => void;
}

const VOID_ENTITY_LABELS: Record<VoidEntityType, string> = {
  folio_charge: 'Folio Charge',
  folio_payment: 'Folio Payment',
  pos_order: 'POS Order',
  expense: 'Expense',
  extra_income: 'Extra Income',
};

const VOID_ROLE_LABELS: Record<string, string> = STAFF_ROLE_LABELS;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function LedgerAndAuditTab({
  overview,
  settings,
  subView,
  onChangeSubView,
  clearingMode,
  onChangeClearingMode,
}: LedgerAndAuditTabProps) {
  // Clearing view state + pagination + slide-over inspector
  const [clearingDept, setClearingDept] = useState<'all' | 'Front Desk' | 'Restaurant' | 'Other Income'>('all');
  const [clearingStatus, setClearingStatus] = useState<'all' | 'unpaid' | 'partial' | 'paid'>('all');
  const [clearingSearch, setClearingSearch] = useState('');
  const [clearingPage, setClearingPage] = useState(1);
  const [clearingPageSize, setClearingPageSize] = useState(25);
  const [inspectedCharge, setInspectedCharge] = useState<ClearingChargeItem | null>(null);
  const [inspectedPayment, setInspectedPayment] = useState<ClearingPaymentItem | null>(null);

  // Journal view state + pagination + slide-over inspector
  const [journalSearch, setJournalSearch] = useState('');
  const [eventFilter, setEventFilter] = useState<string>('all');
  const [journalPage, setJournalPage] = useState(1);
  const [journalPageSize, setJournalPageSize] = useState(25);
  const [inspectedJournal, setInspectedJournal] = useState<AccountingJournalEntry | null>(null);

  // Trial balance state
  const [showZeroAccounts, setShowZeroAccounts] = useState(false);

  // Tax register state + pagination
  const [taxSearch, setTaxSearch] = useState('');
  const [taxDeptFilter, setTaxDeptFilter] = useState<'all' | 'Accommodation' | 'Restaurant' | 'Front Desk'>('all');
  const [taxRuleFilter, setTaxRuleFilter] = useState<string>('all');
  const [taxPage, setTaxPage] = useState(1);
  const [taxPageSize, setTaxPageSize] = useState(25);

  // Void & Reversal Audit Report state + pagination + slide-over inspector
  const [voidSearch, setVoidSearch] = useState('');
  const [voidEntityFilter, setVoidEntityFilter] = useState<'all' | VoidEntityType>('all');
  const [voidStaffFilter, setVoidStaffFilter] = useState<string>('all');
  const [voidPage, setVoidPage] = useState(1);
  const [voidPageSize, setVoidPageSize] = useState(25);
  const [inspectedVoid, setInspectedVoid] = useState<VoidAuditEntry | null>(null);

  const currency = settings.currency_symbol;
  const taxEnabled = settings.tax_enabled === 1;
  const effectiveSubView: LedgerAuditSubView =
    !taxEnabled && subView === 'tax_register' ? 'clearing' : subView;

  const filteredCharges = useMemo(() => {
    if (!overview?.clearing) return [];
    const q = clearingSearch.trim().toLowerCase();
    return overview.clearing.charges.filter((c) => {
      if (clearingDept !== 'all' && c.department !== clearingDept) return false;
      if (clearingStatus !== 'all' && c.status !== clearingStatus) return false;
      if (!q) return true;
      return (
        c.reference.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q) ||
        c.party.toLowerCase().includes(q) ||
        c.allocations.some((a) => a.reference.toLowerCase().includes(q))
      );
    });
  }, [overview, clearingDept, clearingStatus, clearingSearch]);

  const filteredPayments = useMemo(() => {
    if (!overview?.clearing) return [];
    const q = clearingSearch.trim().toLowerCase();
    return overview.clearing.payments.filter((p) => {
      if (clearingDept !== 'all' && p.department !== clearingDept) return false;
      if (!q) return true;
      return (
        p.reference.toLowerCase().includes(q) ||
        p.party.toLowerCase().includes(q) ||
        p.method.toLowerCase().includes(q) ||
        p.coveredCharges.some(
          (ch) =>
            ch.reference.toLowerCase().includes(q) || ch.description.toLowerCase().includes(q)
        )
      );
    });
  }, [overview, clearingDept, clearingSearch]);

  const filteredJournals = useMemo(() => {
    if (!overview) return [];
    const q = journalSearch.trim().toLowerCase();
    return overview.journals.filter((j) => {
      if (eventFilter !== 'all') {
        if (eventFilter === 'payments') {
          if (!['folio_payment', 'deposit_received', 'deposit_transfer', 'pos_settlement'].includes(j.event_type)) {
            return false;
          }
        } else if (eventFilter === 'pos') {
          if (!['pos_sale', 'pos_open_tab', 'pos_settlement'].includes(j.event_type)) return false;
        } else if (j.event_type !== eventFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        j.voucher_no.toLowerCase().includes(q) ||
        j.reference_code.toLowerCase().includes(q) ||
        j.description.toLowerCase().includes(q) ||
        j.posted_by.toLowerCase().includes(q) ||
        j.lines.some(
          (l) =>
            l.account_code.includes(q) ||
            l.account_name.toLowerCase().includes(q)
        )
      );
    });
  }, [overview, journalSearch, eventFilter]);

  const visibleTrialBalance = useMemo(() => {
    if (!overview) return [];
    if (showZeroAccounts) return overview.trialBalance;
    return overview.trialBalance.filter(
      (r) => r.totalDebit > 0 || r.totalCredit > 0 || r.periodDebit > 0 || r.periodCredit > 0
    );
  }, [overview, showZeroAccounts]);

  const taxRuleNames = useMemo(() => {
    if (!overview?.taxRegister) return [];
    const set = new Set<string>();
    for (const r of overview.taxRegister.summary.byRule) {
      set.add(r.name);
    }
    return Array.from(set);
  }, [overview]);

  const filteredTaxEntries = useMemo(() => {
    if (!overview?.taxRegister) return [];
    const q = taxSearch.trim().toLowerCase();
    return overview.taxRegister.entries.filter((entry) => {
      if (taxDeptFilter !== 'all' && entry.department !== taxDeptFilter) return false;
      if (taxRuleFilter !== 'all' && !entry.breakdown.some((b) => b.name === taxRuleFilter)) {
        return false;
      }
      if (!q) return true;
      return (
        entry.reference.toLowerCase().includes(q) ||
        entry.description.toLowerCase().includes(q) ||
        entry.party.toLowerCase().includes(q) ||
        entry.taxLabel.toLowerCase().includes(q)
      );
    });
  }, [overview, taxDeptFilter, taxRuleFilter, taxSearch]);

  const filteredTaxTotals = useMemo(() => {
    return filteredTaxEntries.reduce(
      (acc, e) => ({
        base: acc.base + e.taxableBase,
        tax: acc.tax + e.taxAmount,
        gross: acc.gross + e.grossTotal,
      }),
      { base: 0, tax: 0, gross: 0 }
    );
  }, [filteredTaxEntries]);

  const voidStaffOptions = useMemo(() => {
    if (!overview?.voidAuditReport) return [];
    return Array.from(new Set(overview.voidAuditReport.entries.map((e) => e.voided_by))).sort();
  }, [overview]);

  const filteredVoidEntries = useMemo(() => {
    if (!overview?.voidAuditReport) return [];
    const q = voidSearch.trim().toLowerCase();
    return overview.voidAuditReport.entries.filter((entry) => {
      if (voidEntityFilter !== 'all' && entry.entity_type !== voidEntityFilter) return false;
      if (voidStaffFilter !== 'all' && entry.voided_by !== voidStaffFilter) return false;
      if (!q) return true;
      return (
        entry.description.toLowerCase().includes(q) ||
        entry.reference_code.toLowerCase().includes(q) ||
        entry.party_name.toLowerCase().includes(q) ||
        entry.void_reason.toLowerCase().includes(q) ||
        entry.voided_by.toLowerCase().includes(q) ||
        entry.void_voucher_no.toLowerCase().includes(q)
      );
    });
  }, [overview, voidEntityFilter, voidStaffFilter, voidSearch]);

  const filteredVoidTotals = useMemo(() => {
    return filteredVoidEntries.reduce(
      (acc, e) => ({
        net: acc.net + e.original_amount,
        tax: acc.tax + e.tax_amount,
        total: acc.total + e.total_amount,
      }),
      { net: 0, tax: 0, total: 0 }
    );
  }, [filteredVoidEntries]);

  useEffect(() => {
    setClearingPage(1);
  }, [clearingMode, clearingDept, clearingStatus, clearingSearch, clearingPageSize, overview?.fromDate, overview?.toDate]);

  useEffect(() => {
    setJournalPage(1);
  }, [journalSearch, eventFilter, journalPageSize, overview?.fromDate, overview?.toDate]);

  useEffect(() => {
    setTaxPage(1);
  }, [taxSearch, taxDeptFilter, taxRuleFilter, taxPageSize, overview?.fromDate, overview?.toDate]);

  useEffect(() => {
    setVoidPage(1);
  }, [voidSearch, voidEntityFilter, voidStaffFilter, voidPageSize, overview?.fromDate, overview?.toDate]);

  const paginatedCharges = useMemo(() => {
    const start = (clearingPage - 1) * clearingPageSize;
    return filteredCharges.slice(start, start + clearingPageSize);
  }, [filteredCharges, clearingPage, clearingPageSize]);

  const paginatedPayments = useMemo(() => {
    const start = (clearingPage - 1) * clearingPageSize;
    return filteredPayments.slice(start, start + clearingPageSize);
  }, [filteredPayments, clearingPage, clearingPageSize]);

  const paginatedJournals = useMemo(() => {
    const start = (journalPage - 1) * journalPageSize;
    return filteredJournals.slice(start, start + journalPageSize);
  }, [filteredJournals, journalPage, journalPageSize]);

  const paginatedTaxEntries = useMemo(() => {
    const start = (taxPage - 1) * taxPageSize;
    return filteredTaxEntries.slice(start, start + taxPageSize);
  }, [filteredTaxEntries, taxPage, taxPageSize]);

  const paginatedVoidEntries = useMemo(() => {
    const start = (voidPage - 1) * voidPageSize;
    return filteredVoidEntries.slice(start, start + voidPageSize);
  }, [filteredVoidEntries, voidPage, voidPageSize]);

  if (!overview) {
    return <div className="h-64 rounded-2xl bg-ink/[0.04]" />;
  }

  const { integrity, trialBalanceTotals, clearing, taxRegister, voidAuditReport } = overview;

  return (
    <div className="space-y-5">
      {/* Unified Integrity Bar + Sub-View Switcher */}
      <section
        className={`flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4 ${
          integrity.valid
            ? 'border-ink/10 bg-surface'
            : 'border-[#E05252]/45 bg-[#E05252]/[0.06]'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {integrity.valid ? (
            <ShieldCheck className="h-5 w-5 shrink-0 text-accent-ink" />
          ) : (
            <ShieldAlert className="h-5 w-5 shrink-0 text-danger-ink" />
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-ink">
                {integrity.valid ? 'Ledger & Audit Trail Verified' : 'Audit Discrepancy Detected'}
              </span>
              <HoverTip text="Every transaction posts a sequential double-entry voucher (JV-000001+) with a SHA-256 chain hash, and every guest payment is linked directly to the charges it clears.">
                <span
                  className={`font-mono text-xs tabular-nums ${
                    integrity.valid ? 'text-accent-ink' : 'text-danger-ink'
                  }`}
                >
                  {integrity.firstVoucher} → {integrity.lastVoucher} ({integrity.totalVouchers} vouchers)
                </span>
              </HoverTip>
            </div>
            <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/55">
              All-time Dr {currency}
              {integrity.totalDebits.toFixed(2)} = Cr {currency}
              {integrity.totalCredits.toFixed(2)} · {integrity.sequenceGaps} gaps · {integrity.chainBreaks} chain breaks
            </div>
          </div>
        </div>

        <div className="no-print flex flex-wrap items-center gap-2">
          <div className="inline-flex flex-wrap rounded-xl bg-ink/[0.05] p-1">
            <button
              type="button"
              onClick={() => onChangeSubView('clearing')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                effectiveSubView === 'clearing'
                  ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Charge Clearing
            </button>
            <button
              type="button"
              onClick={() => onChangeSubView('journal')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                effectiveSubView === 'journal'
                  ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Double-Entry Journal
            </button>
            <button
              type="button"
              onClick={() => onChangeSubView('trial_balance')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                effectiveSubView === 'trial_balance'
                  ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Trial Balance
            </button>
            {taxEnabled && (
              <button
                type="button"
                onClick={() => onChangeSubView('tax_register')}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  effectiveSubView === 'tax_register'
                    ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                Tax Register
              </button>
            )}
            <button
              type="button"
              onClick={() => onChangeSubView('void_audit')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                effectiveSubView === 'void_audit'
                  ? 'bg-canvas text-danger-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                  : voidAuditReport && voidAuditReport.summary.totalCount > 0
                    ? 'text-danger-ink/80 hover:text-danger-ink'
                    : 'text-ink/60 hover:text-ink'
              }`}
            >
              Void Audit Report
              {voidAuditReport && voidAuditReport.summary.totalCount > 0
                ? ` (${voidAuditReport.summary.totalCount})`
                : ''}
            </button>
          </div>
        </div>
      </section>

      {/* SUB-VIEW 1: CHARGE & PAYMENT CLEARING (1 Payment -> Multiple Charges Allocation) */}
      {effectiveSubView === 'clearing' && clearing && (
        <section className="space-y-4">
          {/* Clearing Controls & Summary */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-ink/[0.05] p-1">
                <button
                  type="button"
                  onClick={() => {
                    onChangeClearingMode('charges');
                    setInspectedCharge(null);
                    setInspectedPayment(null);
                  }}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    clearingMode === 'charges'
                      ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                      : 'text-ink/60 hover:text-ink'
                  }`}
                >
                  By Charge ({clearing.charges.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onChangeClearingMode('payments');
                    setInspectedCharge(null);
                    setInspectedPayment(null);
                  }}
                  className={`rounded-lg px-3 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    clearingMode === 'payments'
                      ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                      : 'text-ink/60 hover:text-ink'
                  }`}
                >
                  By Payment ({clearing.payments.length})
                </button>
              </div>

              <div className="relative w-56 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={clearingSearch}
                  onChange={(e) => setClearingSearch(e.target.value)}
                  placeholder="Search guest, ref, room..."
                  className="w-full rounded-xl border border-ink/12 bg-surface py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-ink/40"
                />
              </div>

              <select
                aria-label="Filter department"
                value={clearingDept}
                onChange={(e) => setClearingDept(e.target.value as typeof clearingDept)}
                className="rounded-xl border border-ink/12 bg-surface px-3 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All Departments</option>
                <option value="Front Desk">Front Desk</option>
                <option value="Restaurant">Restaurant</option>
                <option value="Other Income">Other Income</option>
              </select>

              {clearingMode === 'charges' && (
                <select
                  aria-label="Filter clearing status"
                  value={clearingStatus}
                  onChange={(e) => setClearingStatus(e.target.value as typeof clearingStatus)}
                  className="rounded-xl border border-ink/12 bg-surface px-3 py-1.5 text-xs font-medium text-ink"
                >
                  <option value="all">All Statuses</option>
                  <option value="unpaid">Unpaid ({clearing.summary.unpaidCount})</option>
                  <option value="partial">Partially Paid ({clearing.summary.partialCount})</option>
                  <option value="paid">Paid ({clearing.summary.paidCount})</option>
                </select>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-4 font-mono text-xs tabular-nums">
              <span className="text-ink/65">
                Cleared:{' '}
                <strong className="text-accent-ink">
                  {currency}
                  {clearing.summary.totalCleared.toFixed(2)}
                </strong>
              </span>
              {clearing.summary.totalUnpaid > 0 && (
                <span className="text-danger-ink">
                  Unpaid:{' '}
                  <strong>
                    {currency}
                    {clearing.summary.totalUnpaid.toFixed(2)}
                  </strong>
                </span>
              )}
              {clearing.summary.unallocatedDeposits > 0 && (
                <HoverTip text="Advance reservation deposits or folio credits not yet applied to posted room charges.">
                  <span className="text-ink/65">
                    Deposits Held:{' '}
                    <strong className="text-ink">
                      {currency}
                      {clearing.summary.unallocatedDeposits.toFixed(2)}
                    </strong>
                  </span>
                </HoverTip>
              )}
            </div>
          </div>

          {/* BY CHARGE TABLE */}
          {clearingMode === 'charges' && (
            <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                      <th className="py-3 pl-4 pr-2 w-8"></th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3">Department &amp; Charge</th>
                      <th className="py-3 px-3">Guest / Payer</th>
                      <th className="py-3 px-3">Status</th>
                      <th className="py-3 px-3 text-right">Charged</th>
                      <th className="py-3 px-3 text-right">Cleared</th>
                      <th className="py-3 px-4 text-right">Remaining</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/8 text-sm">
                    {paginatedCharges.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-xs text-ink/50">
                          No charges match your filter in this date window.
                        </td>
                      </tr>
                    ) : (
                      paginatedCharges.map((chg: ClearingChargeItem) => {
                        const isSelected = inspectedCharge?.id === chg.id;
                        const isUnpaid = chg.status === 'unpaid';
                        const isPartial = chg.status === 'partial';
                        return (
                          <tr
                            key={chg.id}
                            onClick={() => {
                              setInspectedPayment(null);
                              setInspectedCharge(chg);
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-[#6AD4B0]/12'
                                : isUnpaid
                                  ? 'bg-[#E05252]/[0.04] hover:bg-[#E05252]/[0.08]'
                                  : 'hover:bg-ink/[0.02]'
                            }`}
                          >
                            <td className="py-2.5 pl-4 pr-2 text-ink/45">
                              <ChevronRight className="h-3.5 w-3.5" />
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                              {chg.date}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-xs font-medium text-ink">{chg.description}</div>
                              <div className="text-[11px] text-ink/50">
                                {chg.department} · {chg.reference}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-xs text-ink/75 whitespace-nowrap">
                              {chg.party}
                            </td>
                            <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                              <span
                                className={`inline-flex items-center gap-1.5 font-medium ${
                                  isUnpaid
                                    ? 'text-danger-ink'
                                    : isPartial
                                      ? 'text-ink'
                                      : 'text-accent-ink'
                                }`}
                              >
                                <span
                                  className={`h-1.5 w-1.5 rounded-full ${
                                    isUnpaid
                                      ? 'bg-[#E05252]'
                                      : isPartial
                                        ? 'bg-ink/60'
                                        : 'bg-[#6AD4B0]'
                                  }`}
                                />
                                {isUnpaid ? 'Unpaid' : isPartial ? 'Partial' : 'Paid'}
                              </span>
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                              {currency}
                              {chg.totalAmount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-accent-ink whitespace-nowrap">
                              {chg.paidAmount > 0 ? `${currency}${chg.paidAmount.toFixed(2)}` : '—'}
                            </td>
                            <td
                              className={`py-2.5 px-4 text-right font-mono text-sm font-medium tabular-nums whitespace-nowrap ${
                                chg.remainingAmount > 0 ? 'text-danger-ink' : 'text-ink/40'
                              }`}
                            >
                              {chg.remainingAmount > 0
                                ? `${currency}${chg.remainingAmount.toFixed(2)}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={clearingPage}
                pageSize={clearingPageSize}
                totalItems={filteredCharges.length}
                onPageChange={setClearingPage}
                onPageSizeChange={setClearingPageSize}
                itemLabel="charges"
              />
            </div>
          )}

          {/* BY PAYMENT TABLE (1 Payment -> Multiple Charges Covered) */}
          {clearingMode === 'payments' && (
            <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                      <th className="py-3 pl-4 pr-2 w-8"></th>
                      <th className="py-3 px-3">Date</th>
                      <th className="py-3 px-3">Payment &amp; Method</th>
                      <th className="py-3 px-3">Guest / Payer</th>
                      <th className="py-3 px-3">Charges Covered</th>
                      <th className="py-3 px-3 text-right">Received</th>
                      <th className="py-3 px-3 text-right">Applied</th>
                      <th className="py-3 px-4 text-right">Unallocated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/8 text-sm">
                    {paginatedPayments.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="py-12 text-center text-xs text-ink/50">
                          No payments match your filter in this date window.
                        </td>
                      </tr>
                    ) : (
                      paginatedPayments.map((pay: ClearingPaymentItem) => {
                        const isSelected = inspectedPayment?.id === pay.id;
                        return (
                          <tr
                            key={pay.id}
                            onClick={() => {
                              setInspectedCharge(null);
                              setInspectedPayment(pay);
                            }}
                            className={`cursor-pointer transition-colors ${
                              isSelected ? 'bg-[#6AD4B0]/12' : 'hover:bg-ink/[0.02]'
                            }`}
                          >
                            <td className="py-2.5 pl-4 pr-2 text-ink/45">
                              <ChevronRight className="h-3.5 w-3.5" />
                            </td>
                            <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                              {pay.date}
                            </td>
                            <td className="py-2.5 px-3">
                              <div className="text-xs font-medium text-ink capitalize">
                                {pay.method} · <span className="font-mono">{pay.reference}</span>
                              </div>
                              <div className="text-[11px] text-ink/50">
                                {pay.id} · {pay.department}
                              </div>
                            </td>
                            <td className="py-2.5 px-3 text-xs text-ink/75 whitespace-nowrap">
                              {pay.party}
                            </td>
                            <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                              {pay.coveredCharges.length > 0 ? (
                                <span className="font-medium text-accent-ink">
                                  {pay.coveredCharges.length}{' '}
                                  {pay.coveredCharges.length === 1
                                    ? 'charge cleared'
                                    : 'charges cleared'}
                                </span>
                              ) : (
                                <span className="text-ink/55">Advance Deposit</span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm font-medium tabular-nums text-ink whitespace-nowrap">
                              {currency}
                              {pay.totalAmount.toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono text-sm tabular-nums text-accent-ink whitespace-nowrap">
                              {pay.allocatedAmount > 0
                                ? `${currency}${pay.allocatedAmount.toFixed(2)}`
                                : '—'}
                            </td>
                            <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink/60 whitespace-nowrap">
                              {pay.unallocatedAmount > 0
                                ? `${currency}${pay.unallocatedAmount.toFixed(2)}`
                                : '—'}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
              <PaginationBar
                page={clearingPage}
                pageSize={clearingPageSize}
                totalItems={filteredPayments.length}
                onPageChange={setClearingPage}
                onPageSizeChange={setClearingPageSize}
                itemLabel="payments"
              />
            </div>
          )}
        </section>
      )}

      {/* SUB-VIEW 2: DOUBLE-ENTRY GENERAL JOURNAL */}
      {effectiveSubView === 'journal' && (
        <section className="space-y-3">
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-64 sm:w-72">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={journalSearch}
                  onChange={(e) => setJournalSearch(e.target.value)}
                  placeholder="Search voucher #, account, ref, staff..."
                  className="w-full rounded-xl border border-ink/12 bg-surface py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-ink/40"
                />
              </div>

              <select
                aria-label="Filter journal event type"
                value={eventFilter}
                onChange={(e) => setEventFilter(e.target.value)}
                className="rounded-xl border border-ink/12 bg-surface px-3 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All Event Types</option>
                <option value="folio_charge">Folio Charges</option>
                <option value="payments">Payments &amp; Deposits</option>
                <option value="pos">Restaurant POS</option>
                <option value="extra_income">Extra Income</option>
                <option value="expense">Expenses</option>
                <option value="void_reversal">Void Reversals</option>
                <option value="night_audit_room_post">Night Audit Holdovers</option>
              </select>
            </div>

            <span className="font-mono text-xs tabular-nums text-ink/50">
              Showing {filteredJournals.length} of {overview.journals.length} vouchers
            </span>
          </div>

          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 pl-4 pr-2 w-8"></th>
                    <th className="py-3 px-3">Voucher</th>
                    <th className="py-3 px-3">Date</th>
                    <th className="py-3 px-3">Event</th>
                    <th className="py-3 px-3">Description &amp; Audit Trail</th>
                    <th className="py-3 px-4 text-right">Amount (Dr = Cr)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8 text-sm">
                  {paginatedJournals.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-xs text-ink/50">
                        No journal vouchers found for this date window and filter.
                      </td>
                    </tr>
                  ) : (
                    paginatedJournals.map((entry: AccountingJournalEntry) => {
                      const isSelected = inspectedJournal?.id === entry.id;
                      const isReversal =
                        entry.event_type === 'void_reversal' || entry.reversal_of_id !== null;
                      return (
                        <tr
                          key={entry.id}
                          onClick={() => setInspectedJournal(entry)}
                          className={`cursor-pointer transition-colors ${
                            isSelected
                              ? 'bg-[#6AD4B0]/12'
                              : isReversal
                                ? 'bg-[#E05252]/[0.04] hover:bg-[#E05252]/[0.08]'
                                : 'hover:bg-ink/[0.02]'
                          }`}
                        >
                          <td className="py-2.5 pl-4 pr-2 text-ink/45">
                            <ChevronRight className="h-3.5 w-3.5" />
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs font-semibold tabular-nums text-ink whitespace-nowrap">
                            {entry.voucher_no}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                            {entry.business_date}
                          </td>
                          <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                            <span
                              className={`inline-flex items-center gap-1.5 font-medium ${
                                isReversal ? 'text-danger-ink' : 'text-ink'
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  isReversal ? 'bg-[#E05252]' : 'bg-[#6AD4B0]'
                                }`}
                              />
                              {EVENT_TYPE_LABELS[entry.event_type] ?? entry.event_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="text-xs font-medium text-ink">{entry.description}</div>
                            <div className="text-[11px] text-ink/50">
                              {[entry.reference_code, entry.posted_by, entry.station_name]
                                .filter(Boolean)
                                .join(' · ')}
                            </div>
                          </td>
                          <td
                            className={`py-2.5 px-4 text-right font-mono text-sm font-medium tabular-nums whitespace-nowrap ${
                              isReversal ? 'text-danger-ink' : 'text-ink'
                            }`}
                          >
                            {currency}
                            {entry.total_debit.toFixed(2)}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            <PaginationBar
              page={journalPage}
              pageSize={journalPageSize}
              totalItems={filteredJournals.length}
              onPageChange={setJournalPage}
              onPageSizeChange={setJournalPageSize}
              itemLabel="vouchers"
            />
          </div>
        </section>
      )}

      {/* SUB-VIEW 3: TRIAL BALANCE & CHART OF ACCOUNTS */}
      {effectiveSubView === 'trial_balance' && (
        <section className="space-y-3">
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs text-ink/60">
              <span>Cumulative balances as of</span>
              <span className="font-mono font-semibold text-ink">{overview.toDate}</span>
              <span className="text-ink/35">·</span>
              <span
                className={`font-semibold ${
                  trialBalanceTotals.balanced ? 'text-accent-ink' : 'text-danger-ink'
                }`}
              >
                {trialBalanceTotals.balanced ? 'Books Balanced (Dr = Cr)' : 'Out of Balance'}
              </span>
            </div>

            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-ink/65">
              <input
                type="checkbox"
                checked={showZeroAccounts}
                onChange={(e) => setShowZeroAccounts(e.target.checked)}
                className="rounded border-ink/25 accent-[#6AD4B0]"
              />
              Show zero-balance accounts
            </label>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-ink/10">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                  <th className="py-3 px-4">Code</th>
                  <th className="py-3 px-4">Account &amp; Plain Meaning</th>
                  <th className="py-3 px-4">Group</th>
                  <th className="py-3 px-4 text-right">Period Activity</th>
                  <th className="py-3 px-4 text-right">Ending Debit</th>
                  <th className="py-3 px-4 text-right">Ending Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8 text-sm">
                {visibleTrialBalance.map((row) => (
                  <tr key={row.code} className="hover:bg-ink/[0.02]">
                    <td className="py-2.5 px-4 font-mono text-xs font-semibold tabular-nums text-ink/70 whitespace-nowrap">
                      {row.code}
                    </td>
                    <td className="py-2.5 px-4">
                      <div className="text-xs font-semibold text-ink">{row.name}</div>
                      <div className="text-[11px] text-ink/50">{row.plainMeaning}</div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-ink/65 whitespace-nowrap">
                      {ACCOUNT_TYPE_LABELS[row.type] ?? row.type}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink/60 whitespace-nowrap">
                      {row.periodDebit > 0 || row.periodCredit > 0
                        ? `Dr ${currency}${row.periodDebit.toFixed(0)} / Cr ${currency}${row.periodCredit.toFixed(0)}`
                        : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                      {row.endingDebit > 0 ? `${currency}${row.endingDebit.toFixed(2)}` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                      {row.endingCredit > 0 ? `${currency}${row.endingCredit.toFixed(2)}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-ink/15 bg-ink/[0.02] text-sm font-semibold text-ink">
                  <td colSpan={4} className="py-3 px-4 text-xs">
                    Trial Balance Proof{' '}
                    <span
                      className={`ml-2 font-mono ${
                        trialBalanceTotals.balanced ? 'text-accent-ink' : 'text-danger-ink'
                      }`}
                    >
                      {trialBalanceTotals.balanced ? '✓ Debits equal Credits' : '⚠ Variance detected'}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    {currency}
                    {trialBalanceTotals.totalDebits.toFixed(2)}
                  </td>
                  <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                    {currency}
                    {trialBalanceTotals.totalCredits.toFixed(2)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {/* SUB-VIEW 4: TAX REGISTER (Hidden completely when Tax is toggled OFF in Settings) */}
      {taxEnabled && effectiveSubView === 'tax_register' && taxRegister && (
        <section className="space-y-4">
          {/* Per-rule & Department Summary Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Taxable Base (Net)</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                {currency}
                {taxRegister.summary.totalTaxableBase.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45">
                {taxRegister.summary.transactionCount}{' '}
                {taxRegister.summary.transactionCount === 1 ? 'taxable record' : 'taxable records'}
              </div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Total Tax Payable (2200)</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-accent-ink">
                {currency}
                {taxRegister.summary.totalTaxCollected.toFixed(2)}
              </div>
              <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                Gross {currency}
                {taxRegister.summary.totalGross.toFixed(2)}
              </div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Accommodation Tax</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                {currency}
                {taxRegister.summary.accommodationTax.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45">Room nights &amp; holdovers</div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Restaurant &amp; Other Tax</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                {currency}
                {(taxRegister.summary.restaurantTax + taxRegister.summary.frontDeskTax).toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45">POS orders &amp; folio services</div>
            </div>
          </div>

          {taxRegister.summary.byRule.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-xs">
              <span className="font-medium text-ink/55">By Tax Rule:</span>
              {taxRegister.summary.byRule.map((r) => (
                <span key={`${r.name}-${r.rate}-${r.mode}`} className="font-mono tabular-nums text-ink">
                  <span className="font-sans font-medium text-ink/75">
                    {r.name}
                    {r.rate > 0 ? ` (${r.rate}%)` : ''}
                  </span>{' '}
                  <strong className="text-accent-ink">
                    {currency}
                    {r.taxAmount.toFixed(2)}
                  </strong>
                  <span className="text-ink/45"> · {r.count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Filter Bar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={taxSearch}
                  onChange={(e) => setTaxSearch(e.target.value)}
                  placeholder="Search invoice, guest, rule..."
                  className="w-full rounded-xl border border-ink/12 bg-canvas py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-ink/40"
                />
              </div>

              <select
                aria-label="Filter tax department"
                value={taxDeptFilter}
                onChange={(e) => setTaxDeptFilter(e.target.value as typeof taxDeptFilter)}
                className="rounded-xl border border-ink/12 bg-canvas px-3 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All Departments</option>
                <option value="Accommodation">Accommodation</option>
                <option value="Restaurant">Restaurant</option>
                <option value="Front Desk">Front Desk Services</option>
              </select>

              {taxRuleNames.length > 1 && (
                <select
                  aria-label="Filter tax rule"
                  value={taxRuleFilter}
                  onChange={(e) => setTaxRuleFilter(e.target.value)}
                  className="rounded-xl border border-ink/12 bg-canvas px-3 py-1.5 text-xs font-medium text-ink"
                >
                  <option value="all">All Tax Rules</option>
                  {taxRuleNames.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <span className="font-mono text-xs tabular-nums text-ink/50">
              Showing {filteredTaxEntries.length} of {taxRegister.entries.length} taxed records
            </span>
          </div>

          {/* Transaction-Level Tax Register Table */}
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-3">Ref &amp; Department</th>
                    <th className="py-3 px-3">Description &amp; Guest</th>
                    <th className="py-3 px-3">Tax Rule</th>
                    <th className="py-3 px-3 text-right">Taxable Base</th>
                    <th className="py-3 px-3 text-right">Tax Amount</th>
                    <th className="py-3 px-4 text-right">Gross Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8 text-sm">
                  {paginatedTaxEntries.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-xs text-ink/50">
                        No taxable transactions match your filter in this date window.
                      </td>
                    </tr>
                  ) : (
                    paginatedTaxEntries.map((entry: TaxRegisterEntry) => (
                      <tr key={entry.id} className="hover:bg-ink/[0.02]">
                        <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                          {entry.date}
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="font-mono text-xs font-semibold text-ink">
                            {entry.reference}
                          </div>
                          <div className="text-[11px] text-ink/50">{entry.department}</div>
                        </td>
                        <td className="py-2.5 px-3">
                          <div className="text-xs font-medium text-ink">{entry.description}</div>
                          <div className="text-[11px] text-ink/50">
                            {entry.party} · {entry.source}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-ink/75 whitespace-nowrap">
                          {entry.breakdown.length > 1 ? (
                            <div className="space-y-0.5">
                              {entry.breakdown.map((b, i) => (
                                <div
                                  key={`${entry.id}-b-${i}`}
                                  className="font-mono text-[11px] tabular-nums"
                                >
                                  {b.name} ({b.rate}%): {currency}
                                  {b.amount.toFixed(2)}
                                </div>
                              ))}
                            </div>
                          ) : (
                            <span>{entry.taxLabel}</span>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-xs tabular-nums text-ink/75 whitespace-nowrap">
                          {currency}
                          {entry.taxableBase.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono text-sm font-semibold tabular-nums text-accent-ink whitespace-nowrap">
                          {currency}
                          {entry.taxAmount.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                          {currency}
                          {entry.grossTotal.toFixed(2)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredTaxEntries.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-ink/15 bg-ink/[0.02] text-sm font-semibold text-ink">
                      <td colSpan={4} className="py-3 px-4 text-xs">
                        Tax Register Total ({filteredTaxEntries.length}{' '}
                        {filteredTaxEntries.length === 1 ? 'entry' : 'entries'})
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        {currency}
                        {filteredTaxTotals.base.toFixed(2)}
                      </td>
                      <td className="py-3 px-3 text-right font-mono tabular-nums text-accent-ink whitespace-nowrap">
                        {currency}
                        {filteredTaxTotals.tax.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                        {currency}
                        {filteredTaxTotals.gross.toFixed(2)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <PaginationBar
              page={taxPage}
              pageSize={taxPageSize}
              totalItems={filteredTaxEntries.length}
              onPageChange={setTaxPage}
              onPageSizeChange={setTaxPageSize}
              itemLabel="tax records"
            />
          </div>
        </section>
      )}

      {/* SUB-VIEW 5: VOID & REVERSAL AUDIT REPORT */}
      {effectiveSubView === 'void_audit' && voidAuditReport && (
        <section className="space-y-4">
          {/* 4-Card Void Audit KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div
              className={`rounded-2xl border p-4 ${
                voidAuditReport.summary.totalCount > 0
                  ? 'border-[#E05252]/35 bg-[#E05252]/[0.05]'
                  : 'border-ink/10 bg-surface'
              }`}
            >
              <div className="text-xs text-ink/55">Voided Transactions</div>
              <div
                className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                  voidAuditReport.summary.totalCount > 0 ? 'text-danger-ink' : 'text-ink'
                }`}
              >
                {voidAuditReport.summary.totalCount}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45">
                {overview.fromDate} to {overview.toDate}
              </div>
            </div>

            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Total Value Reversed</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-danger-ink">
                {currency}
                {voidAuditReport.summary.totalAmount.toFixed(2)}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45">
                Every reversal paired with a contra voucher
              </div>
            </div>

            {taxEnabled ? (
              <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                <div className="text-xs text-ink/55">Tax Reversed (2200)</div>
                <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                  {currency}
                  {voidAuditReport.summary.totalTaxReversed.toFixed(2)}
                </div>
                <div className="mt-0.5 text-[11px] text-ink/45">
                  Automatically backed out of Tax Register
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                <div className="text-xs text-ink/55">Top Voided Category</div>
                <div className="mt-1 text-base font-semibold text-ink truncate">
                  {voidAuditReport.summary.byType.length > 0
                    ? (VOID_ENTITY_LABELS[voidAuditReport.summary.byType[0].entityType as VoidEntityType] ??
                      voidAuditReport.summary.byType[0].entityType)
                    : 'None'}
                </div>
                <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                  {voidAuditReport.summary.byType.length > 0
                    ? `${voidAuditReport.summary.byType[0].count} reversals`
                    : 'Zero voids in window'}
                </div>
              </div>
            )}

            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/55">Authorized Staff Activity</div>
              <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                {voidAuditReport.summary.byStaff.length}
              </div>
              <div className="mt-0.5 text-[11px] text-ink/45 truncate">
                {voidAuditReport.summary.byStaff.length > 0
                  ? voidAuditReport.summary.byStaff
                      .slice(0, 2)
                      .map((s) => `${s.staffName} (${s.count})`)
                      .join(', ')
                  : 'Management, Accountant & Auditor only'}
              </div>
            </div>
          </div>

          {/* Breakdown Strip by Transaction Type */}
          {voidAuditReport.summary.byType.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-xs">
              <span className="font-medium text-ink/55">By Transaction Type:</span>
              {voidAuditReport.summary.byType.map((item) => (
                <span key={item.entityType} className="font-mono tabular-nums text-ink">
                  <span className="font-sans font-medium text-ink/75">
                    {VOID_ENTITY_LABELS[item.entityType as VoidEntityType] ?? item.entityType}
                  </span>{' '}
                  <strong className="text-danger-ink">
                    {currency}
                    {item.totalAmount.toFixed(2)}
                  </strong>
                  <span className="text-ink/45"> · {item.count}</span>
                </span>
              ))}
            </div>
          )}

          {/* Filter Bar */}
          <div className="no-print flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative w-56 sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={voidSearch}
                  onChange={(e) => setVoidSearch(e.target.value)}
                  placeholder="Search reason, ref, staff, voucher..."
                  className="w-full rounded-xl border border-ink/12 bg-canvas py-1.5 pl-8 pr-3 text-xs text-ink placeholder:text-ink/40"
                />
              </div>

              <select
                aria-label="Filter voided transaction type"
                value={voidEntityFilter}
                onChange={(e) => setVoidEntityFilter(e.target.value as typeof voidEntityFilter)}
                className="rounded-xl border border-ink/12 bg-canvas px-3 py-1.5 text-xs font-medium text-ink"
              >
                <option value="all">All Transaction Types</option>
                <option value="folio_charge">Folio Charges</option>
                <option value="folio_payment">Folio Payments / Refunds</option>
                <option value="pos_order">Restaurant POS Orders</option>
                <option value="expense">Operating Expenses</option>
                <option value="extra_income">Extra Income</option>
              </select>

              {voidStaffOptions.length > 1 && (
                <select
                  aria-label="Filter by staff member"
                  value={voidStaffFilter}
                  onChange={(e) => setVoidStaffFilter(e.target.value)}
                  className="rounded-xl border border-ink/12 bg-canvas px-3 py-1.5 text-xs font-medium text-ink"
                >
                  <option value="all">All Authorized Staff</option>
                  {voidStaffOptions.map((staff) => (
                    <option key={staff} value={staff}>
                      {staff}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <span className="font-mono text-xs tabular-nums text-ink/50">
              Showing {filteredVoidEntries.length} of {voidAuditReport.entries.length} void records
            </span>
          </div>

          {/* Immutable Void Audit Table */}
          <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Voided At</th>
                    <th className="py-3 px-3">Type &amp; Ref</th>
                    <th className="py-3 px-3">Description &amp; Party</th>
                    <th className="py-3 px-3">Void Reason</th>
                    <th className="py-3 px-3">Voided By</th>
                    <th className="py-3 px-3">Contra Voucher</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    <th className="no-print py-3 pr-3 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8 text-sm">
                  {paginatedVoidEntries.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-xs text-ink/50">
                        No voided or reversed transactions recorded in this date window.
                      </td>
                    </tr>
                  ) : (
                    paginatedVoidEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        onClick={() => setInspectedVoid(entry)}
                        className="cursor-pointer hover:bg-ink/[0.02] transition-colors"
                      >
                        <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                          <div>{entry.created_at.slice(0, 10)}</div>
                          <div className="text-[10px] text-ink/45">
                            {entry.created_at.slice(11, 16)} UTC
                          </div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="text-xs font-semibold text-danger-ink">
                            {VOID_ENTITY_LABELS[entry.entity_type]}
                          </div>
                          <div className="font-mono text-[11px] text-ink/55">
                            {entry.reference_code || `#${entry.entity_id}`}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[220px]">
                          <div className="text-xs font-medium text-ink truncate">
                            {entry.description}
                          </div>
                          <div className="text-[11px] text-ink/50 truncate">
                            {[entry.party_name, entry.department].filter(Boolean).join(' · ')}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 max-w-[220px]">
                          <div className="text-xs text-ink/85 break-words">{entry.void_reason}</div>
                        </td>
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          <div className="text-xs font-medium text-ink">{entry.voided_by}</div>
                          <div className="text-[11px] text-ink/50">
                            {VOID_ROLE_LABELS[entry.voided_by_role] ?? entry.voided_by_role}
                          </div>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-xs tabular-nums text-ink/70 whitespace-nowrap">
                          {entry.void_voucher_no || '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-sm font-semibold tabular-nums text-danger-ink whitespace-nowrap">
                          <div>
                            {currency}
                            {entry.total_amount.toFixed(2)}
                          </div>
                          {taxEnabled && entry.tax_amount > 0 && (
                            <div className="text-[10px] font-normal text-ink/45">
                              tax {currency}
                              {entry.tax_amount.toFixed(2)}
                            </div>
                          )}
                        </td>
                        <td className="no-print py-2.5 pr-3 text-right text-ink/35">
                          <ChevronRight className="h-4 w-4 inline-block" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                {filteredVoidEntries.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-ink/15 bg-ink/[0.02] text-sm font-semibold text-ink">
                      <td colSpan={6} className="py-3 px-4 text-xs">
                        Total Reversed ({filteredVoidEntries.length}{' '}
                        {filteredVoidEntries.length === 1 ? 'record' : 'records'})
                        {taxEnabled && filteredVoidTotals.tax > 0
                          ? ` · incl. ${currency}${filteredVoidTotals.tax.toFixed(2)} tax`
                          : ''}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums text-danger-ink whitespace-nowrap">
                        {currency}
                        {filteredVoidTotals.total.toFixed(2)}
                      </td>
                      <td className="no-print" />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <PaginationBar
              page={voidPage}
              pageSize={voidPageSize}
              totalItems={filteredVoidEntries.length}
              onPageChange={setVoidPage}
              onPageSizeChange={setVoidPageSize}
              itemLabel="void records"
            />
          </div>
        </section>
      )}

      {/* SLIDE-OVER DRAWER: INSPECT CHARGE CLEARING ALLOCATIONS */}
      <Drawer
        open={inspectedCharge !== null}
        onClose={() => setInspectedCharge(null)}
        title={inspectedCharge ? inspectedCharge.description : 'Charge Details'}
        subtitle={
          inspectedCharge
            ? `${inspectedCharge.department} · ${inspectedCharge.reference} · ${inspectedCharge.date}`
            : undefined
        }
        widthClass="max-w-md"
      >
        {inspectedCharge && (
          <div className="space-y-5">
            <div className="rounded-xl border border-ink/10 bg-canvas p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink/55">Guest / Payer</span>
                <span className="font-medium text-ink">{inspectedCharge.party}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Status</span>
                <span
                  className={`font-semibold capitalize ${
                    inspectedCharge.status === 'unpaid'
                      ? 'text-danger-ink'
                      : inspectedCharge.status === 'paid'
                        ? 'text-accent-ink'
                        : 'text-ink'
                  }`}
                >
                  {inspectedCharge.status}
                </span>
              </div>
              <div className="flex justify-between border-t border-ink/8 pt-2">
                <span className="text-ink/55">Total Charged</span>
                <span className="font-mono font-semibold tabular-nums text-ink">
                  {currency}
                  {inspectedCharge.totalAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Amount Cleared</span>
                <span className="font-mono font-semibold tabular-nums text-accent-ink">
                  {currency}
                  {inspectedCharge.paidAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Remaining Balance</span>
                <span
                  className={`font-mono font-semibold tabular-nums ${
                    inspectedCharge.remainingAmount > 0 ? 'text-danger-ink' : 'text-ink/45'
                  }`}
                >
                  {currency}
                  {inspectedCharge.remainingAmount.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-ink">
                Linked Payments Clearing This Charge ({inspectedCharge.allocations.length})
              </div>
              {inspectedCharge.allocations.length === 0 ? (
                <div className="rounded-xl border border-[#E05252]/30 bg-[#E05252]/[0.05] p-4 text-xs text-danger-ink">
                  No payment has been applied to this charge yet.
                </div>
              ) : (
                <div className="divide-y divide-ink/8 rounded-xl border border-ink/10 bg-canvas">
                  {inspectedCharge.allocations.map((alloc, idx) => (
                    <div
                      key={`${alloc.paymentId}-${idx}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-mono font-semibold text-ink">{alloc.paymentId}</div>
                        <div className="text-[11px] text-ink/55 capitalize">
                          {alloc.method} · {alloc.reference}
                        </div>
                        <div className="font-mono text-[11px] text-ink/45">
                          {alloc.recordedAt.slice(0, 16).replace('T', ' ')}
                        </div>
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-accent-ink shrink-0">
                        {currency}
                        {alloc.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* SLIDE-OVER DRAWER: INSPECT PAYMENT ALLOCATIONS */}
      <Drawer
        open={inspectedPayment !== null}
        onClose={() => setInspectedPayment(null)}
        title={inspectedPayment ? `Payment ${inspectedPayment.id}` : 'Payment Details'}
        subtitle={
          inspectedPayment
            ? `${inspectedPayment.party} · ${inspectedPayment.date}`
            : undefined
        }
        widthClass="max-w-md"
      >
        {inspectedPayment && (
          <div className="space-y-5">
            <div className="rounded-xl border border-ink/10 bg-canvas p-4 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink/55">Method &amp; Ref</span>
                <span className="font-medium capitalize text-ink">
                  {inspectedPayment.method} · <span className="font-mono">{inspectedPayment.reference}</span>
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Department</span>
                <span className="text-ink">{inspectedPayment.department}</span>
              </div>
              <div className="flex justify-between border-t border-ink/8 pt-2">
                <span className="text-ink/55">Total Received</span>
                <span className="font-mono font-semibold tabular-nums text-ink">
                  {currency}
                  {inspectedPayment.totalAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Applied to Charges</span>
                <span className="font-mono font-semibold tabular-nums text-accent-ink">
                  {currency}
                  {inspectedPayment.allocatedAmount.toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink/55">Unallocated / Advance</span>
                <span className="font-mono tabular-nums text-ink/70">
                  {currency}
                  {inspectedPayment.unallocatedAmount.toFixed(2)}
                </span>
              </div>
            </div>

            <div className="space-y-2.5">
              <div className="text-xs font-semibold text-ink">
                Charges Cleared by This Payment ({inspectedPayment.coveredCharges.length})
              </div>
              {inspectedPayment.coveredCharges.length === 0 ? (
                <div className="rounded-xl border border-ink/10 bg-canvas p-4 text-xs text-ink/60">
                  Held as an Advance Guest Deposit (Account 2100) until room or service charges are posted.
                </div>
              ) : (
                <div className="divide-y divide-ink/8 rounded-xl border border-ink/10 bg-canvas">
                  {inspectedPayment.coveredCharges.map((cov, idx) => (
                    <div
                      key={`${cov.chargeId}-${idx}`}
                      className="flex items-center justify-between gap-3 px-4 py-3 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-ink">{cov.description}</div>
                        <div className="text-[11px] text-ink/50">
                          <span className="font-mono">{cov.chargeId}</span> · {cov.department}
                        </div>
                      </div>
                      <span className="font-mono text-sm font-semibold tabular-nums text-accent-ink shrink-0">
                        {currency}
                        {cov.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* SLIDE-OVER DRAWER: INSPECT DOUBLE-ENTRY JOURNAL VOUCHER */}
      <Drawer
        open={inspectedJournal !== null}
        onClose={() => setInspectedJournal(null)}
        title={inspectedJournal ? `Voucher ${inspectedJournal.voucher_no}` : 'Journal Voucher'}
        subtitle={
          inspectedJournal
            ? `${EVENT_TYPE_LABELS[inspectedJournal.event_type] ?? inspectedJournal.event_type} · ${inspectedJournal.business_date}`
            : undefined
        }
        widthClass="max-w-xl"
      >
        {inspectedJournal && (
          <div className="space-y-5">
            <div className="rounded-xl border border-ink/10 bg-canvas p-4 space-y-2 text-xs">
              <div className="font-medium text-sm text-ink">{inspectedJournal.description}</div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-ink/8">
                <div>
                  <span className="text-ink/50">Reference:</span>{' '}
                  <span className="font-mono text-ink">{inspectedJournal.reference_code || '—'}</span>
                </div>
                <div>
                  <span className="text-ink/50">Posted By:</span>{' '}
                  <span className="text-ink">{inspectedJournal.posted_by}</span>
                </div>
                <div>
                  <span className="text-ink/50">Workstation:</span>{' '}
                  <span className="text-ink">{inspectedJournal.station_name || '—'}</span>
                </div>
                <div>
                  <span className="text-ink/50">Source:</span>{' '}
                  <span className="font-mono text-ink">
                    {inspectedJournal.source_table}
                    {inspectedJournal.source_id ? `#${inspectedJournal.source_id}` : ''}
                  </span>
                </div>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-ink/10 bg-canvas">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink/8 bg-ink/[0.02] text-[11px] font-medium text-ink/55">
                    <th className="py-2.5 px-3">Account</th>
                    <th className="py-2.5 px-3">Memo</th>
                    <th className="py-2.5 px-3 text-right">Debit</th>
                    <th className="py-2.5 px-3 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {inspectedJournal.lines.map((line) => (
                    <tr key={line.id}>
                      <td className="py-2.5 px-3">
                        <div className="font-medium text-ink">
                          <span className="font-mono text-ink/55 mr-1.5">{line.account_code}</span>
                          {line.account_name}
                        </div>
                        <div className="text-[10px] capitalize text-ink/45">{line.account_type}</div>
                      </td>
                      <td className="py-2.5 px-3 text-ink/65">{line.memo || '—'}</td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-ink whitespace-nowrap">
                        {line.debit > 0 ? `${currency}${line.debit.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-accent-ink whitespace-nowrap">
                        {line.credit > 0 ? `${currency}${line.credit.toFixed(2)}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-ink/12 bg-ink/[0.02] font-mono font-semibold text-ink">
                    <td colSpan={2} className="py-2.5 px-3 font-sans text-xs">
                      Balanced Totals (Dr = Cr)
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      {currency}
                      {inspectedJournal.total_debit.toFixed(2)}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-accent-ink">
                      {currency}
                      {inspectedJournal.total_credit.toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-3 font-mono text-[11px] text-ink/55 space-y-1 break-all">
              <div>Timestamp: {inspectedJournal.created_at.slice(0, 19).replace('T', ' ')} UTC</div>
              <div>SHA-256 Chain Hash: {inspectedJournal.entry_hash}</div>
            </div>
          </div>
        )}
      </Drawer>

      {/* SLIDE-OVER DRAWER: INSPECT IMMUTABLE VOID AUDIT ENTRY */}
      <Drawer
        open={inspectedVoid !== null}
        onClose={() => setInspectedVoid(null)}
        title={
          inspectedVoid
            ? `Void Record · ${VOID_ENTITY_LABELS[inspectedVoid.entity_type]}`
            : 'Void Audit Detail'
        }
        subtitle={
          inspectedVoid
            ? `${inspectedVoid.reference_code || `#${inspectedVoid.entity_id}`} · ${inspectedVoid.created_at.slice(0, 10)}`
            : undefined
        }
        widthClass="max-w-md"
      >
        {inspectedVoid && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E05252]/30 bg-[#E05252]/[0.05] p-4 space-y-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-danger-ink">
                {VOID_ENTITY_LABELS[inspectedVoid.entity_type]} Reversed
              </div>
              <div className="text-sm font-semibold text-ink">{inspectedVoid.description}</div>
              {inspectedVoid.party_name && (
                <div className="text-xs text-ink/65">
                  {inspectedVoid.party_name} · {inspectedVoid.department}
                </div>
              )}
              <div className="pt-2 border-t border-[#E05252]/20 space-y-1 text-xs">
                <div className="flex justify-between text-ink/65">
                  <span>Net Reversed</span>
                  <span className="font-mono tabular-nums text-ink">
                    {currency}
                    {inspectedVoid.original_amount.toFixed(2)}
                  </span>
                </div>
                {taxEnabled && inspectedVoid.tax_amount > 0 && (
                  <div className="flex justify-between text-ink/65">
                    <span>Tax Reversed</span>
                    <span className="font-mono tabular-nums text-ink">
                      {currency}
                      {inspectedVoid.tax_amount.toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between font-semibold text-danger-ink pt-1">
                  <span>Total Voided</span>
                  <span className="font-mono tabular-nums">
                    {currency}
                    {inspectedVoid.total_amount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-ink/10 bg-canvas p-4 space-y-2.5 text-xs">
              <div>
                <div className="text-[11px] font-medium uppercase tracking-wider text-ink/45">
                  Documented Void Reason
                </div>
                <div className="mt-1 text-sm text-ink leading-relaxed">
                  {inspectedVoid.void_reason}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2.5 border-t border-ink/8">
                <div>
                  <div className="text-ink/50">Authorized By</div>
                  <div className="font-medium text-ink">{inspectedVoid.voided_by}</div>
                </div>
                <div>
                  <div className="text-ink/50">Staff Role</div>
                  <div className="font-medium text-ink">
                    {VOID_ROLE_LABELS[inspectedVoid.voided_by_role] ?? inspectedVoid.voided_by_role}
                  </div>
                </div>
                <div>
                  <div className="text-ink/50">Workstation</div>
                  <div className="text-ink">{inspectedVoid.station_name || '—'}</div>
                </div>
                <div>
                  <div className="text-ink/50">Contra Voucher</div>
                  <div className="font-mono font-semibold text-ink">
                    {inspectedVoid.void_voucher_no || '—'}
                  </div>
                </div>
                <div className="col-span-2">
                  <div className="text-ink/50">Timestamp (UTC)</div>
                  <div className="font-mono text-ink">
                    {inspectedVoid.created_at.slice(0, 19).replace('T', ' ')} UTC
                  </div>
                </div>
              </div>
            </div>

            {inspectedVoid.void_voucher_no &&
              overview.journals.some((j) => j.voucher_no === inspectedVoid.void_voucher_no) && (
                <button
                  type="button"
                  onClick={() => {
                    const match = overview.journals.find(
                      (j) => j.voucher_no === inspectedVoid.void_voucher_no
                    );
                    if (match) {
                      setInspectedVoid(null);
                      setInspectedJournal(match);
                    }
                  }}
                  className="w-full rounded-xl border border-ink/15 bg-surface px-4 py-2.5 text-xs font-semibold text-ink hover:bg-ink/[0.04] transition-colors"
                >
                  Inspect Contra Journal Entry ({inspectedVoid.void_voucher_no}) →
                </button>
              )}
          </div>
        )}
      </Drawer>
    </div>
  );
}

// ---------------- TAB 4: NIGHT AUDIT & BACKUPS ----------------

interface NightAuditBackupsTabProps {
  overview: AccountingOverview | null;
  settings: HotelSettings;
  userRole: StaffRole;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
  onRefreshAccounting: () => void;
}

export function NightAuditBackupsTab({
  overview,
  settings,
  userRole,
  authFetch,
  mutate,
  onRefreshAccounting,
}: NightAuditBackupsTabProps) {
  const [auditModalOpen, setAuditModalOpen] = useState(false);
  const [auditNotes, setAuditNotes] = useState('');
  const [runningAudit, setRunningAudit] = useState(false);
  const [creatingBackup, setCreatingBackup] = useState(false);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
  const [expandedAuditId, setExpandedAuditId] = useState<number | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<DatabaseBackupRecord | null>(null);
  const [restoreConfirmText, setRestoreConfirmText] = useState('');
  const [restoring, setRestoring] = useState(false);

  const currency = settings.currency_symbol;
  const canRestoreBackup = userRole === 'management';
  const canRunAuditOrBackup = userRole === 'management' || userRole === 'accountant';

  async function handleConfirmRestore(e: React.FormEvent) {
    e.preventDefault();
    if (!restoreTarget || restoreConfirmText.trim().toUpperCase() !== 'RESTORE') return;
    setRestoring(true);
    try {
      const res = await mutate<{ ok?: boolean }>(
        `/api/backups/${restoreTarget.id}/restore`,
        'POST',
        { confirm: 'RESTORE' },
        `Database restored from ${restoreTarget.filename} (safety snapshot saved first)`
      );
      if (res) {
        setRestoreTarget(null);
        setRestoreConfirmText('');
        onRefreshAccounting();
      }
    } finally {
      setRestoring(false);
    }
  }

  async function handleRunNightAudit(e: React.FormEvent) {
    e.preventDefault();
    setRunningAudit(true);
    try {
      const res = await mutate<{
        audit?: NightAuditRecord;
        nextBusinessDate?: string;
        backup?: DatabaseBackupRecord | null;
      }>(
        '/api/night-audit/run',
        'POST',
        { notes: auditNotes.trim() },
        'Night Audit completed and business date rolled forward'
      );
      if (res) {
        setAuditModalOpen(false);
        setAuditNotes('');
        onRefreshAccounting();
      }
    } finally {
      setRunningAudit(false);
    }
  }

  async function handleCreateManualBackup() {
    setCreatingBackup(true);
    try {
      const res = await mutate<{ backup?: DatabaseBackupRecord }>(
        '/api/backups/create',
        'POST',
        {},
        'Local database backup created and verified'
      );
      if (res) {
        onRefreshAccounting();
      }
    } finally {
      setCreatingBackup(false);
    }
  }

  async function handleDownloadBackup(backup: DatabaseBackupRecord) {
    setDownloadingId(backup.id);
    try {
      const res = await authFetch(`/api/backups/${backup.id}/download`);
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backup.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  }

  if (!overview) {
    return <div className="h-64 rounded-2xl bg-ink/[0.04]" />;
  }

  const { readiness, nightAudits, backups } = overview;
  const latestBackup = backups[0] ?? null;

  return (
    <div className="space-y-6">
      {/* Top Row: Business Date & Readiness + Backup Health */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 rounded-2xl border border-ink/10 p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#6AD4B0]/15 text-accent-ink">
                <Moon className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink">
                  Business Date · <span className="font-mono">{readiness.businessDate}</span>
                </div>
                <div className="text-xs text-ink/55">
                  {settings.night_audit_enabled === 1
                    ? `Auto Night Audit at ${settings.night_audit_time || '02:00'} daily`
                    : 'Auto Night Audit disabled (Settings → Hotel Profile)'}
                </div>
              </div>
            </div>

            {canRunAuditOrBackup ? (
              <HoverTip
                text={
                  readiness.alreadyAudited
                    ? 'This business date has already been audited.'
                    : 'Close the current business date, post holdover room charges, lock daily financial totals, roll the date forward, and trigger automatic backup.'
                }
              >
                <button
                  type="button"
                  disabled={readiness.alreadyAudited}
                  onClick={() => setAuditModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45 transition-colors whitespace-nowrap"
                >
                  <Moon className="h-3.5 w-3.5" />
                  {readiness.alreadyAudited ? 'Date Audited' : 'Run Night Audit'}
                </button>
              </HoverTip>
            ) : (
              <span className="rounded-lg border border-ink/12 bg-ink/[0.03] px-2.5 py-1 text-[11px] font-medium text-ink/55">
                Audit Read-Only
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-ink/10 p-3">
              <div className="text-[11px] text-ink/55">In-House Rooms</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {readiness.inHouseCount}
              </div>
            </div>

            <HoverTip
              text="Checked-in guests whose departure date is today or earlier. Running Night Audit automatically extends their stay by 1 night and posts the room charge + tax."
              className="block w-full"
            >
              <div
                className={`h-full rounded-xl border p-3 ${
                  readiness.holdoverCount > 0
                    ? 'border-[#E05252]/40 bg-[#E05252]/[0.06]'
                    : 'border-ink/10'
                }`}
              >
                <div className={`text-[11px] ${readiness.holdoverCount > 0 ? 'text-danger-ink' : 'text-ink/55'}`}>
                  Holdovers to Roll
                </div>
                <div
                  className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                    readiness.holdoverCount > 0 ? 'text-danger-ink' : 'text-ink'
                  }`}
                >
                  {readiness.holdoverCount}
                </div>
              </div>
            </HoverTip>

            <HoverTip
              text="Unpaid dine-in restaurant tabs still open. Settle them in Restaurant → Order History before audit or carry them into Restaurant Receivable (1120)."
              className="block w-full"
            >
              <div
                className={`h-full rounded-xl border p-3 ${
                  readiness.unpaidPosCount > 0
                    ? 'border-[#E05252]/40 bg-[#E05252]/[0.06]'
                    : 'border-ink/10'
                }`}
              >
                <div className={`text-[11px] ${readiness.unpaidPosCount > 0 ? 'text-danger-ink' : 'text-ink/55'}`}>
                  Unpaid POS Tabs
                </div>
                <div
                  className={`mt-1 font-mono text-base font-semibold tabular-nums ${
                    readiness.unpaidPosCount > 0 ? 'text-danger-ink' : 'text-ink'
                  }`}
                >
                  {readiness.unpaidPosCount}{' '}
                  <span className="text-xs font-normal">
                    ({currency}
                    {readiness.unpaidPosTotal.toFixed(0)})
                  </span>
                </div>
              </div>
            </HoverTip>

            <div className="rounded-xl border border-ink/10 p-3">
              <div className="text-[11px] text-ink/55">Arrivals / Shifts</div>
              <div className="mt-1 font-mono text-base font-semibold tabular-nums text-ink">
                {readiness.overdueArrivalsCount} / {readiness.openShiftsCount}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-2xl border border-ink/10 p-5 flex flex-col justify-between gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-ink/[0.05] text-ink">
                <HardDrive className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-semibold text-ink">Database Backups</div>
                <div className="text-xs text-ink/55">
                  {settings.auto_backup_after_audit !== 0
                    ? `Auto backup after Night Audit · Keep ${settings.backup_retention_count || 30} copies`
                    : 'Manual backups only (Settings → Hotel Profile)'}
                </div>
              </div>
            </div>

            {canRunAuditOrBackup && (
              <HoverTip text="Creates a safe online SQLite backup right now without interrupting connected Front Desk or Restaurant workstations.">
                <button
                  type="button"
                  disabled={creatingBackup}
                  onClick={handleCreateManualBackup}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-45 whitespace-nowrap"
                >
                  <Database className="h-3.5 w-3.5" />
                  {creatingBackup ? 'Backing Up...' : 'Backup Now'}
                </button>
              </HoverTip>
            )}
          </div>

          <div className="rounded-xl border border-ink/8 bg-ink/[0.02] px-4 py-3 text-xs">
            {latestBackup ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-mono font-medium text-ink truncate">{latestBackup.filename}</div>
                  <div className="mt-0.5 text-[11px] text-ink/55">
                    {latestBackup.created_at.slice(0, 16).replace('T', ' ')} UTC · {formatBytes(latestBackup.size_bytes)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={downloadingId === latestBackup.id}
                  onClick={() => handleDownloadBackup(latestBackup)}
                  className="inline-flex items-center gap-1 rounded-lg border border-ink/15 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-ink/[0.04]"
                >
                  <Download className="h-3 w-3" />
                  {downloadingId === latestBackup.id ? 'Saving...' : 'Download'}
                </button>
              </div>
            ) : (
              <span className="text-ink/50">
                No backups created yet. Run Night Audit or click Backup Now.
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Night Audit History Table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Night Audit History ({nightAudits.length})
          </h2>
          <span className="text-xs text-ink/50">Immutable end-of-day snapshots</span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-ink/10">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                <th className="py-3 px-4">Audit #</th>
                <th className="py-3 px-4">Business Date</th>
                <th className="py-3 px-4">Run By</th>
                <th className="py-3 px-4 text-right">Occupancy</th>
                <th className="py-3 px-4 text-right">Day Revenue</th>
                <th className="py-3 px-4 text-right">Collected</th>
                <th className="py-3 px-4 text-right">Expenses</th>
                <th className="py-3 px-4">Status</th>
                <th className="py-3 px-4">Backup</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8 text-sm">
              {nightAudits.length === 0 ? (
                <tr>
                  <td colSpan={9} className="py-10 text-center text-xs text-ink/50">
                    No Night Audits recorded yet. Run your first Night Audit above or wait for the scheduled time.
                  </td>
                </tr>
              ) : (
                nightAudits.map((na) => {
                  const dayRevenue = na.room_revenue + na.restaurant_revenue + na.other_revenue;
                  const isOpen = expandedAuditId === na.id;
                  return (
                    <Fragment key={na.id}>
                      <tr
                        onClick={() => setExpandedAuditId(isOpen ? null : na.id)}
                        className="cursor-pointer hover:bg-ink/[0.02]"
                      >
                        <td className="py-2.5 px-4 font-mono text-xs font-semibold tabular-nums text-ink whitespace-nowrap">
                          {na.audit_number}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink whitespace-nowrap">
                          {na.business_date}
                        </td>
                        <td className="py-2.5 px-4 text-xs text-ink/70 whitespace-nowrap">
                          <span className="capitalize font-medium text-ink">{na.trigger_type}</span> · {na.triggered_by}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink whitespace-nowrap">
                          {na.rooms_occupied}/{na.total_rooms} ({na.occupancy_pct.toFixed(0)}%)
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink whitespace-nowrap">
                          {currency}
                          {dayRevenue.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-accent-ink whitespace-nowrap">
                          {currency}
                          {na.payments_collected.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-danger-ink whitespace-nowrap">
                          {na.expenses_total > 0 ? `−${currency}${na.expenses_total.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-medium ${
                              na.balanced === 1 ? 'text-accent-ink' : 'text-danger-ink'
                            }`}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {na.balanced === 1 ? 'Balanced' : 'Review'}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-ink/60 whitespace-nowrap">
                          {na.backup_filename ? 'Saved' : '—'}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className="bg-ink/[0.02]">
                          <td colSpan={9} className="px-5 py-3 text-xs text-ink/70">
                            <div className="flex flex-wrap gap-x-6 gap-y-1.5 font-mono text-[11px] tabular-nums">
                              <span>Rooms: {currency}{na.room_revenue.toFixed(2)}</span>
                              <span>Restaurant: {currency}{na.restaurant_revenue.toFixed(2)}</span>
                              <span>Other: {currency}{na.other_revenue.toFixed(2)}</span>
                              {settings.tax_enabled === 1 && (
                                <span>
                                  Tax: {currency}
                                  {na.tax_collected.toFixed(2)}
                                </span>
                              )}
                              <span>Holdovers Rolled: {na.holdover_nights_posted}</span>
                              <span>Open Folio Bal: {currency}{na.outstanding_guest_balance.toFixed(2)}</span>
                              <span>Vouchers: {na.journal_count}</span>
                            </div>
                            {na.notes && (
                              <div className="mt-1.5 text-xs text-ink">Note: {na.notes}</div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Database Backups Table */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Saved Database Backups ({backups.length})
          </h2>
          <span className="text-xs text-ink/50">Stored locally on server · SHA-256 verified</span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-ink/10">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                <th className="py-3 px-4">Backup File</th>
                <th className="py-3 px-4">Business Date</th>
                <th className="py-3 px-4">Trigger</th>
                <th className="py-3 px-4 text-right">Size</th>
                <th className="py-3 px-4">SHA-256</th>
                <th className="py-3 px-4">Created (UTC)</th>
                <th className="no-print py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8 text-sm">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-ink/50">
                    No backup files saved yet.
                  </td>
                </tr>
              ) : (
                backups.map((bk) => (
                  <tr key={bk.id} className="hover:bg-ink/[0.02]">
                    <td className="py-2.5 px-4 font-mono text-xs font-medium text-ink whitespace-nowrap">
                      {bk.filename}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink/70 whitespace-nowrap">
                      {bk.business_date}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-ink/70 whitespace-nowrap">
                      {bk.trigger_type === 'night_audit'
                        ? 'After Night Audit'
                        : bk.trigger_type === 'pre_restore'
                          ? 'Pre-Restore Snapshot'
                          : 'Manual'}{' '}
                      · {bk.triggered_by}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink/70 whitespace-nowrap">
                      {formatBytes(bk.size_bytes)}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-ink/50 whitespace-nowrap">
                      {bk.sha256.slice(0, 14)}…
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                      {bk.created_at.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="no-print py-2.5 px-4 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          disabled={downloadingId === bk.id}
                          onClick={() => handleDownloadBackup(bk)}
                          className="inline-flex items-center gap-1 rounded-lg border border-ink/15 px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/[0.05] disabled:opacity-45"
                        >
                          <Download className="h-3 w-3" />
                          {downloadingId === bk.id ? 'Saving...' : '.db'}
                        </button>
                        {canRestoreBackup && (
                          <HoverTip text="Management only: verify SHA-256 checksum, save a pre-restore safety snapshot, and restore the database to this backup.">
                            <button
                              type="button"
                              onClick={() => {
                                setRestoreTarget(bk);
                                setRestoreConfirmText('');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#E05252]/35 px-2.5 py-1 text-xs font-medium text-danger-ink hover:bg-[#E05252]/[0.08]"
                            >
                              <RotateCcw className="h-3 w-3" />
                              Restore
                            </button>
                          </HoverTip>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Run Night Audit Modal */}
      <Modal
        open={auditModalOpen}
        onClose={() => setAuditModalOpen(false)}
        title={`Run Night Audit · ${readiness.businessDate}`}
        subtitle="Closes the active business day, verifies Trial Balance, and advances the hotel date."
      >
        <form onSubmit={handleRunNightAudit} className="space-y-4">
          <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4 space-y-2 text-xs">
            <div className="flex justify-between">
              <span className="text-ink/65">In-House Rooms</span>
              <span className="font-mono font-semibold text-ink">{readiness.inHouseCount}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/65">Holdover Stays to Extend (+1 night)</span>
              <span
                className={`font-mono font-semibold ${
                  readiness.holdoverCount > 0 ? 'text-danger-ink' : 'text-ink'
                }`}
              >
                {readiness.holdoverCount}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink/65">Open Unpaid POS Tabs</span>
              <span
                className={`font-mono font-semibold ${
                  readiness.unpaidPosCount > 0 ? 'text-danger-ink' : 'text-ink'
                }`}
              >
                {readiness.unpaidPosCount} ({currency}
                {readiness.unpaidPosTotal.toFixed(2)})
              </span>
            </div>
            <div className="flex justify-between border-t border-ink/10 pt-2">
              <span className="text-ink/65">Post-Audit Database Backup</span>
              <span className="font-semibold text-accent-ink">
                {settings.auto_backup_after_audit !== 0 ? 'Automatic (.db)' : 'Manual Only'}
              </span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Audit Notes (Optional)
            </label>
            <textarea
              rows={2}
              value={auditNotes}
              onChange={(e) => setAuditNotes(e.target.value)}
              placeholder="Cash drawer reconciliation notes, late check-outs, or exceptions..."
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAuditModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={runningAudit}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {runningAudit ? 'Running Audit...' : 'Confirm & Close Day'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Safeguarded Restore Backup Modal (Management Only) */}
      <Modal
        open={restoreTarget !== null}
        onClose={() => !restoring && setRestoreTarget(null)}
        title="Restore Database from Backup"
        subtitle="Management safeguard: a pre-restore safety snapshot of the live database is saved automatically before switching."
      >
        {restoreTarget && (
          <form onSubmit={handleConfirmRestore} className="space-y-4">
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.06] p-4 space-y-1.5 text-xs">
              <div className="font-mono font-semibold text-ink">{restoreTarget.filename}</div>
              <div className="text-ink/65">
                Business Date: <span className="font-mono">{restoreTarget.business_date}</span> · Size:{' '}
                <span className="font-mono">{formatBytes(restoreTarget.size_bytes)}</span>
              </div>
              <div className="font-mono text-[11px] text-ink/50">
                SHA-256: {restoreTarget.sha256.slice(0, 24)}…
              </div>
              <p className="pt-1.5 text-danger-ink font-medium">
                All connected workstations will immediately refresh to this backup point. The live database will first be preserved as a Pre-Restore Snapshot.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Type <span className="font-mono font-semibold text-ink">RESTORE</span> to confirm *
              </label>
              <input
                type="text"
                required
                value={restoreConfirmText}
                onChange={(e) => setRestoreConfirmText(e.target.value)}
                placeholder="RESTORE"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-ink/35"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={restoring}
                onClick={() => setRestoreTarget(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={restoring || restoreConfirmText.trim().toUpperCase() !== 'RESTORE'}
                className="rounded-xl bg-[#E05252] px-5 py-2 text-sm font-semibold text-white hover:bg-[#E05252]/90 disabled:opacity-45"
              >
                {restoring ? 'Restoring...' : 'Verify & Restore Backup'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
