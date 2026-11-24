import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Clock, Download, Plus, Printer, RotateCcw } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  AccountingOverview,
  AppCategory,
  Expense,
  ExtraIncome,
  HotelSettings,
  ReportSummary,
  StaffRole,
  Stay,
} from '../types';
import { ACCOUNT_TYPE_LABELS, EVENT_TYPE_LABELS, isoDateDaysAgo } from '../utils/constants';
import { getLocalTodayIso, validateDateRange, validateTransactionDate } from '../utils/dateValidation';
import { exportToExcelXlsx } from '../utils/excelExport';
import {
  LedgerAndAuditTab,
  NightAuditBackupsTab,
  type LedgerAuditSubView,
} from './AccountingAuditTabs';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';
import { VoidConfirmModal, type VoidTargetSummary } from './VoidConfirmModal';

interface FinanceViewProps {
  settings: HotelSettings;
  stays: Stay[];
  categories: AppCategory[];
  userRole: StaffRole;
  lastSyncAt: string | null;
  onOpenFolio: (stayId: number) => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
  isDark: boolean;
}

export function FinanceView({
  settings,
  stays,
  categories,
  userRole,
  lastSyncAt,
  onOpenFolio,
  authFetch,
  mutate,
  isDark,
}: FinanceViewProps) {
  const unpaidCheckouts = useMemo(
    () =>
      stays
        .filter((s) => s.status === 'checked_out' && s.balance_due > 0.01)
        .sort((a, b) => b.check_out_date.localeCompare(a.check_out_date)),
    [stays]
  );
  const unpaidCheckoutsTotal = useMemo(
    () => Math.round(unpaidCheckouts.reduce((sum, s) => sum + s.balance_due, 0) * 100) / 100,
    [unpaidCheckouts]
  );

  const todayIso = getLocalTodayIso();
  const [fromDate, setFromDate] = useState(isoDateDaysAgo(29));
  const [toDate, setToDate] = useState(todayIso);
  const [report, setReport] = useState<ReportSummary | null>(null);
  const [accounting, setAccounting] = useState<AccountingOverview | null>(null);
  const [accountingRefreshTick, setAccountingRefreshTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'ledger_audit' | 'expenses' | 'night_audit'
  >('overview');
  const [ledgerSubView, setLedgerSubView] = useState<LedgerAuditSubView>('clearing');
  const [clearingMode, setClearingMode] = useState<'charges' | 'payments'>('charges');

  const expenseCategories = useMemo(
    () =>
      categories
        .filter((c) => c.kind === 'expense' && c.active === 1)
        .map((c) => c.name),
    [categories]
  );

  const extraIncomeCategories = useMemo(
    () =>
      categories
        .filter((c) => c.kind === 'extra_income' && c.active === 1)
        .map((c) => c.name),
    [categories]
  );

  const voidReasonPresets = useMemo(
    () =>
      categories
        .filter((c) => c.kind === 'void_reason' && c.active === 1)
        .map((c) => c.name),
    [categories]
  );

  // Expense recording modal state
  const [expenseModalOpen, setExpenseModalOpen] = useState(false);
  const [expDate, setExpDate] = useState(todayIso);
  const [expCategory, setExpCategory] = useState<string>('');
  const [expDescription, setExpDescription] = useState('');
  const [expVendor, setExpVendor] = useState('');
  const [expMethod, setExpMethod] = useState<Expense['payment_method']>('bank_transfer');
  const [expRef, setExpRef] = useState('');
  const [expAmount, setExpAmount] = useState('');

  // Extra income recording modal state
  const [incomeModalOpen, setIncomeModalOpen] = useState(false);
  const [incDate, setIncDate] = useState(todayIso);
  const [incCategory, setIncCategory] = useState<string>('');
  const [incDescription, setIncDescription] = useState('');
  const [incPayer, setIncPayer] = useState('');
  const [incMethod, setIncMethod] = useState<ExtraIncome['payment_method']>('bank_transfer');
  const [incRef, setIncRef] = useState('');
  const [incAmount, setIncAmount] = useState('');

  useEffect(() => {
    if (!expCategory && expenseCategories.length > 0) {
      setExpCategory(expenseCategories[0]);
    }
  }, [expCategory, expenseCategories]);

  useEffect(() => {
    if (!incCategory && extraIncomeCategories.length > 0) {
      setIncCategory(extraIncomeCategories[0]);
    }
  }, [incCategory, extraIncomeCategories]);

  const canRecordEntries = userRole === 'management' || userRole === 'accountant';
  const canVoid =
    userRole === 'management' || userRole === 'accountant' || userRole === 'auditor';

  // Immutable void / reversal modal state
  const [voidTarget, setVoidTarget] = useState<{
    kind: 'expense' | 'extra_income';
    id: number;
    summary: VoidTargetSummary;
  } | null>(null);

  const [submitting, setSubmitting] = useState(false);

  const dateRangeError = validateDateRange(fromDate, toDate, { maxDays: 366 });
  const expDateError = validateTransactionDate(expDate, 'Expense date');
  const incDateError = validateTransactionDate(incDate, 'Income date');

  // If Tax is toggled OFF in Settings while viewing Tax Register, switch back to Charge Clearing
  useEffect(() => {
    if (settings.tax_enabled === 0 && ledgerSubView === 'tax_register') {
      setLedgerSubView('clearing');
    }
  }, [settings.tax_enabled, ledgerSubView]);

  useEffect(() => {
    if (dateRangeError) return;
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const qs = `from=${encodeURIComponent(fromDate)}&to=${encodeURIComponent(toDate)}`;
        const [repRes, acctRes] = await Promise.all([
          authFetch(`/api/reports/summary?${qs}`),
          authFetch(`/api/accounting/overview?${qs}`),
        ]);
        const repData = await repRes.json();
        if (!repRes.ok) throw new Error(repData.error ?? 'Failed to load financial report');
        const acctData = acctRes.ok ? await acctRes.json() : null;
        if (active) {
          setReport(repData as ReportSummary);
          if (acctData) setAccounting(acctData as AccountingOverview);
          setError(null);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Unable to load financial report');
      } finally {
        if (active) setLoading(false);
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [fromDate, toDate, dateRangeError, lastSyncAt, accountingRefreshTick, authFetch]);

  function applyPreset(days: number) {
    setFromDate(isoDateDaysAgo(days - 1));
    setToDate(getLocalTodayIso());
  }

  async function handleRecordExpense(e: React.FormEvent) {
    e.preventDefault();
    if (expDateError) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        '/api/expenses',
        'POST',
        {
          expense_date: expDate,
          category: expCategory,
          description: expDescription,
          vendor: expVendor,
          payment_method: expMethod,
          reference: expRef,
          amount: Number(expAmount),
        },
        'Expense recorded in Finance ledger'
      );
      if (ok) {
        setExpenseModalOpen(false);
        setExpDescription('');
        setExpVendor('');
        setExpRef('');
        setExpAmount('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordExtraIncome(e: React.FormEvent) {
    e.preventDefault();
    if (incDateError) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        '/api/extra-income',
        'POST',
        {
          income_date: incDate,
          category: incCategory,
          description: incDescription,
          payer: incPayer,
          payment_method: incMethod,
          reference: incRef,
          amount: Number(incAmount),
        },
        'Extra income recorded in Finance ledger'
      );
      if (ok) {
        setIncomeModalOpen(false);
        setIncDescription('');
        setIncPayer('');
        setIncRef('');
        setIncAmount('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  function openVoidModal(
    kind: 'expense' | 'extra_income',
    id: number,
    description: string,
    amount: number,
    reference?: string,
    party?: string
  ) {
    if (!canVoid) return;
    setVoidTarget({
      kind,
      id,
      summary: {
        entityLabel: kind === 'expense' ? 'Operating Expense' : 'Extra Income',
        title: description,
        reference: reference || undefined,
        party: party || undefined,
        amount,
        currency: settings.currency_symbol,
        warningNote:
          kind === 'expense'
            ? 'Reversing this expense posts a balanced contra voucher in the General Journal and restores Net Operating Income.'
            : 'Reversing this extra income posts a balanced contra voucher in the General Journal and updates department totals.',
      },
    });
  }

  async function handleConfirmVoid(reason: string) {
    if (!voidTarget) return;
    setSubmitting(true);
    try {
      const endpoint =
        voidTarget.kind === 'expense'
          ? `/api/expenses/${voidTarget.id}`
          : `/api/extra-income/${voidTarget.id}`;
      const ok = await mutate(
        endpoint,
        'DELETE',
        { reason, confirmed: true },
        voidTarget.kind === 'expense'
          ? 'Expense reversed with contra journal voucher'
          : 'Extra income reversed with contra journal voucher'
      );
      if (ok) {
        setVoidTarget(null);
        setAccountingRefreshTick((t) => t + 1);
      }
    } finally {
      setSubmitting(false);
    }
  }

  const currency = settings.currency_symbol;
  const activeTaxRules = (settings.tax_rules ?? []).filter((r) => r.enabled === 1 && r.rate > 0);
  const taxKpiLabel =
    activeTaxRules.length > 1
      ? 'Taxes Collected'
      : activeTaxRules.length === 1
        ? `${activeTaxRules[0].name} Collected`
        : `${settings.tax_name || 'Tax'} Collected`;

  // Strictly hide all tax KPIs and UI whenever Tax is toggled OFF in Settings
  const showTaxMetric = settings.tax_enabled === 1;
  const hasUnpaidPosTabs = Boolean(report && report.kpis.unpaidPosTabsCount > 0);
  const kpiCount = 5 + (showTaxMetric ? 1 : 0) + (hasUnpaidPosTabs ? 1 : 0);

  function getActiveExportTooltip(): string {
    if (activeTab === 'expenses') {
      return 'Export the Expenses ledger for the selected date range as an Excel (.xlsx) file.';
    }
    if (activeTab === 'night_audit') {
      return 'Export the Night Audit history log as an Excel (.xlsx) file.';
    }
    if (activeTab === 'ledger_audit') {
      if (ledgerSubView === 'clearing') {
        return clearingMode === 'charges'
          ? 'Export the Charge Clearing table (charges and linked payments) as an Excel (.xlsx) file.'
          : 'Export the Payment Allocations table (payments and covered charges) as an Excel (.xlsx) file.';
      }
      if (ledgerSubView === 'journal') {
        return 'Export the Double-Entry General Journal vouchers for this date range as an Excel (.xlsx) file.';
      }
      if (ledgerSubView === 'trial_balance') {
        return 'Export the Trial Balance as of the selected end date as an Excel (.xlsx) file.';
      }
      if (ledgerSubView === 'void_audit') {
        return 'Export the immutable Void & Reversal Audit Report (reasons, staff, roles, and contra vouchers) as an Excel (.xlsx) file.';
      }
      return 'Export the transaction-level Tax Register for filing and reconciliation as an Excel (.xlsx) file.';
    }
    return 'Export the Daily Financial & Occupancy summary for the selected date range as an Excel (.xlsx) file.';
  }

  function exportFinanceExcel() {
    if (!report || dateRangeError) return;

    if (activeTab === 'expenses') {
      exportToExcelXlsx(
        `hosila-expenses-${report.fromDate}-to-${report.toDate}.xlsx`,
        'Expenses',
        ['Date', 'Category', 'Description', 'Vendor', 'Method', 'Reference', 'Recorded By', 'Amount', 'Status'],
        report.expenses.map((ex) => [
          ex.expense_date,
          ex.category,
          ex.description,
          ex.vendor,
          ex.payment_method.replace('_', ' '),
          ex.reference,
          ex.recorded_by,
          Number(ex.amount.toFixed(2)),
          ex.voided === 1 ? `Reversed (${ex.void_reason || ''})` : 'Active',
        ]),
        `${settings.hotel_name} — Expense Ledger (${report.fromDate} to ${report.toDate})`
      );
      return;
    }

    if (activeTab === 'night_audit' && accounting) {
      exportToExcelXlsx(
        `hosila-night-audits-${report.fromDate}-to-${report.toDate}.xlsx`,
        'Night Audits',
        [
          'Audit #',
          'Business Date',
          'Trigger',
          'Closed By',
          'Occupied Rooms',
          'Occupancy %',
          'Room Revenue',
          'Restaurant Revenue',
          'Other Revenue',
          ...(showTaxMetric ? ['Tax Collected'] : []),
          'Payments Collected',
          'Expenses',
          'Vouchers',
          'Backup File',
        ],
        accounting.nightAudits.map((na) => [
          na.audit_number,
          na.business_date,
          na.trigger_type === 'auto' ? 'Automatic' : 'Manual',
          na.triggered_by,
          `${na.rooms_occupied}/${na.total_rooms}`,
          Number(na.occupancy_pct.toFixed(1)),
          Number(na.room_revenue.toFixed(2)),
          Number(na.restaurant_revenue.toFixed(2)),
          Number(na.other_revenue.toFixed(2)),
          ...(showTaxMetric ? [Number(na.tax_collected.toFixed(2))] : []),
          Number(na.payments_collected.toFixed(2)),
          Number(na.expenses_total.toFixed(2)),
          na.journal_count,
          na.backup_filename || 'None',
        ]),
        `${settings.hotel_name} — Night Audit History`
      );
      return;
    }

    if (activeTab === 'ledger_audit' && accounting) {
      if (ledgerSubView === 'clearing') {
        if (clearingMode === 'charges') {
          exportToExcelXlsx(
            `hosila-charge-clearing-${accounting.fromDate}-to-${accounting.toDate}.xlsx`,
            'Charge Clearing',
            ['Date', 'Ref', 'Department', 'Description', 'Guest / Payer', 'Total Charge', 'Cleared', 'Remaining', 'Status', 'Cleared By'],
            accounting.clearing.charges.map((c) => [
              c.date,
              c.reference,
              c.department,
              c.description,
              c.party,
              Number(c.totalAmount.toFixed(2)),
              Number(c.paidAmount.toFixed(2)),
              Number(c.remainingAmount.toFixed(2)),
              c.status.toUpperCase(),
              c.allocations.map((a) => `${a.method} (${a.reference}: ${currency}${a.amount.toFixed(2)})`).join('; ') || 'Unpaid',
            ]),
            `${settings.hotel_name} — Charge Clearing (${accounting.fromDate} to ${accounting.toDate})`
          );
        } else {
          exportToExcelXlsx(
            `hosila-payment-allocations-${accounting.fromDate}-to-${accounting.toDate}.xlsx`,
            'Payment Allocations',
            ['Date', 'Method', 'Ref', 'Guest / Payer', 'Total Payment', 'Applied to Charges', 'Advance / Unallocated', 'Charges Cleared'],
            accounting.clearing.payments.map((p) => [
              p.date,
              p.method,
              p.reference,
              p.party,
              Number(p.totalAmount.toFixed(2)),
              Number(p.allocatedAmount.toFixed(2)),
              Number(p.unallocatedAmount.toFixed(2)),
              p.coveredCharges.map((ch) => `${ch.description} (${currency}${ch.amount.toFixed(2)})`).join('; ') || 'Advance Deposit',
            ]),
            `${settings.hotel_name} — Payment Allocations (${accounting.fromDate} to ${accounting.toDate})`
          );
        }
        return;
      }

      if (ledgerSubView === 'journal') {
        const rows: Array<Array<string | number>> = [];
        for (const j of accounting.journals) {
          for (const line of j.lines) {
            rows.push([
              j.voucher_no,
              j.business_date,
              EVENT_TYPE_LABELS[j.event_type] ?? j.event_type,
              j.reference_code,
              line.account_code,
              line.account_name,
              j.description,
              line.memo,
              Number(line.debit.toFixed(2)),
              Number(line.credit.toFixed(2)),
              j.posted_by,
              j.entry_hash.slice(0, 12),
            ]);
          }
        }
        exportToExcelXlsx(
          `hosila-general-journal-${accounting.fromDate}-to-${accounting.toDate}.xlsx`,
          'General Journal',
          [
            'Voucher #',
            'Business Date',
            'Event',
            'Ref',
            'Account Code',
            'Account Name',
            'Description',
            'Line Memo',
            'Debit',
            'Credit',
            'Posted By',
            'Hash Stamp',
          ],
          rows,
          `${settings.hotel_name} — Double-Entry General Journal (${accounting.fromDate} to ${accounting.toDate})`
        );
        return;
      }

      if (ledgerSubView === 'trial_balance') {
        exportToExcelXlsx(
          `hosila-trial-balance-as-of-${accounting.toDate}.xlsx`,
          'Trial Balance',
          [
            'Account Code',
            'Account Name',
            'Group',
            'Meaning',
            'Period Debit',
            'Period Credit',
            'Ending Debit',
            'Ending Credit',
          ],
          accounting.trialBalance.map((r) => [
            r.code,
            r.name,
            ACCOUNT_TYPE_LABELS[r.type] ?? r.type,
            r.plainMeaning,
            Number(r.periodDebit.toFixed(2)),
            Number(r.periodCredit.toFixed(2)),
            Number(r.endingDebit.toFixed(2)),
            Number(r.endingCredit.toFixed(2)),
          ]),
          `${settings.hotel_name} — Trial Balance as of ${accounting.toDate}`
        );
        return;
      }

      if (ledgerSubView === 'tax_register' && showTaxMetric && accounting.taxRegister) {
        exportToExcelXlsx(
          `hosila-tax-register-${accounting.fromDate}-to-${accounting.toDate}.xlsx`,
          'Tax Register',
          [
            'Date',
            'Ref / Invoice',
            'Department',
            'Source',
            'Description',
            'Guest / Order',
            'Tax Rule',
            'Taxable Base',
            'Tax Amount',
            'Gross Total',
          ],
          accounting.taxRegister.entries.map((e) => [
            e.date,
            e.reference,
            e.department,
            e.source,
            e.description,
            e.party,
            e.taxLabel,
            Number(e.taxableBase.toFixed(2)),
            Number(e.taxAmount.toFixed(2)),
            Number(e.grossTotal.toFixed(2)),
          ]),
          `${settings.hotel_name} — Tax Register (${accounting.fromDate} to ${accounting.toDate})`
        );
        return;
      }

      if (ledgerSubView === 'void_audit' && accounting.voidAuditReport) {
        exportToExcelXlsx(
          `hosila-void-audit-report-${accounting.fromDate}-to-${accounting.toDate}.xlsx`,
          'Void Audit Report',
          [
            'Voided At (UTC)',
            'Date',
            'Transaction Type',
            'Reference',
            'Description',
            'Guest / Party',
            'Department',
            'Net Amount',
            ...(showTaxMetric ? ['Tax Reversed'] : []),
            'Total Voided',
            'Void Reason',
            'Voided By',
            'Role',
            'Workstation',
            'Contra Voucher',
          ],
          accounting.voidAuditReport.entries.map((v) => [
            v.created_at.slice(0, 19).replace('T', ' '),
            v.created_at.slice(0, 10),
            v.entity_type.replace('_', ' ').toUpperCase(),
            v.reference_code || `#${v.entity_id}`,
            v.description,
            v.party_name || '—',
            v.department,
            Number(v.original_amount.toFixed(2)),
            ...(showTaxMetric ? [Number(v.tax_amount.toFixed(2))] : []),
            Number(v.total_amount.toFixed(2)),
            v.void_reason,
            v.voided_by,
            v.voided_by_role,
            v.station_name || '—',
            v.void_voucher_no || '—',
          ]),
          `${settings.hotel_name} — Void & Reversal Audit Report (${accounting.fromDate} to ${accounting.toDate})`
        );
        return;
      }
    }

    exportToExcelXlsx(
      `hosila-finance-overview-${report.fromDate}-to-${report.toDate}.xlsx`,
      'Financial & Occupancy',
      [
        'Date',
        'Occupied Rooms',
        'Available Rooms',
        'Occupancy %',
        'Room Revenue',
        'Restaurant Revenue',
        'Service Revenue',
        'Other Income',
        'Total Revenue',
        'Expenses',
      ],
      report.dailySeries.map((d) => [
        d.date,
        d.occupiedRooms,
        d.availableRooms,
        Number(d.occupancyPct.toFixed(1)),
        Number(d.roomRevenue.toFixed(2)),
        Number(d.restaurantRevenue.toFixed(2)),
        Number(d.serviceRevenue.toFixed(2)),
        Number(d.otherIncome.toFixed(2)),
        Number(d.totalRevenue.toFixed(2)),
        Number(d.expenses.toFixed(2)),
      ]),
      `${settings.hotel_name} — Financial & Occupancy Summary (${report.fromDate} to ${report.toDate})`
    );
  }

  // Theme-aware Recharts colors
  const chartInk = isDark ? '#F2F2F7' : '#1D1D1F';
  const chartSurface = isDark ? '#1C1C1F' : '#FFFFFF';
  const chartBorder = isDark ? 'rgba(242,242,247,0.16)' : 'rgba(29,29,31,0.14)';

  return (
    <div className="flex flex-1 min-h-0 flex-col print-full">
      {/* FIXED TOP TAB SELECTOR HEADER */}
      <div className="no-print shrink-0 bg-canvas border-b border-ink/10 px-4 pt-4 md:px-5 md:pt-5 lg:px-7 lg:pt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="overflow-x-auto no-scrollbar">
            <div role="tablist" aria-label="Finance sections" className="flex items-center gap-5 sm:gap-6 min-w-max">
              {(
                [
                  ['overview', 'Overview & Departments'],
                  ['ledger_audit', 'Ledger & Audit'],
                  ['expenses', 'Expenses'],
                  ['night_audit', 'Night Audit & Backups'],
                ] as const
              ).map(([id, label]) => {
                const active = activeTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveTab(id)}
                    className={`relative pb-3 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                      active ? 'text-ink font-semibold' : 'text-ink/55 hover:text-ink'
                    }`}
                  >
                    {label}
                    {active && (
                      <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-[#6AD4B0]" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {canRecordEntries && (
            <div className="flex items-center gap-2 pb-2.5 shrink-0">
              <HoverTip text="Log non-folio income such as conference halls, events, parking, or spa services into Finance and the General Journal.">
                <button
                  type="button"
                  onClick={() => {
                    setIncDate(getLocalTodayIso());
                    setIncomeModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-3.5 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Record Extra Income
                </button>
              </HoverTip>
              <HoverTip text="Record an operating expense to update the Expense Ledger, Trial Balance, and Net Operating Income.">
                <button
                  type="button"
                  onClick={() => {
                    setExpDate(getLocalTodayIso());
                    setExpenseModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.05] transition-colors whitespace-nowrap shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Record Expense
                </button>
              </HoverTip>
            </div>
          )}
        </div>
      </div>

      {/* SCROLLABLE CONTENT BELOW TAB HEADER */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-5 lg:px-7 space-y-6">
        {/* Print-Only Masthead */}
        <div className="hidden print-only border-b border-ink/15 pb-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              {settings.hotel_logo_url && (
                <img
                  src={settings.hotel_logo_url}
                  alt={settings.hotel_name}
                  className="mb-2 max-h-10 object-contain"
                />
              )}
              <div className="text-lg font-semibold text-ink">{settings.hotel_name}</div>
              <div className="text-xs text-ink/60">
                Financial &amp; Occupancy Statement · {fromDate} to {toDate}
                {settings.tax_id ? ` · Tax ID: ${settings.tax_id}` : ''}
              </div>
            </div>
            <div className="text-right font-mono text-xs text-ink/55">
              Printed {getLocalTodayIso()}
            </div>
          </div>
        </div>

        {/* Date Filter & Unified Export/Print Row */}
        <div className="no-print space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div className="inline-flex rounded-xl bg-ink/[0.05] p-1">
                {[
                  [7, '7 Days'],
                  [14, '14 Days'],
                  [30, '30 Days'],
                ].map(([days, label]) => {
                  const isActive =
                    toDate === getLocalTodayIso() && fromDate === isoDateDaysAgo(Number(days) - 1);
                  return (
                    <button
                      key={String(days)}
                      type="button"
                      onClick={() => applyPreset(Number(days))}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]'
                          : 'text-ink/70 hover:bg-canvas/70 hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2 text-xs text-ink/60">
                <input
                  type="date"
                  aria-label="Report start date"
                  max={toDate || undefined}
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  className={`rounded-xl border bg-canvas px-3 py-1.5 font-mono text-xs tabular-nums text-ink ${
                    dateRangeError ? 'border-[#E05252]' : 'border-ink/15'
                  }`}
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Report end date"
                  min={fromDate || undefined}
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  className={`rounded-xl border bg-canvas px-3 py-1.5 font-mono text-xs tabular-nums text-ink ${
                    dateRangeError ? 'border-[#E05252]' : 'border-ink/15'
                  }`}
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <HoverTip text={getActiveExportTooltip()}>
                <button
                  type="button"
                  onClick={exportFinanceExcel}
                  disabled={!report || Boolean(dateRangeError)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.05] disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Excel (.xlsx)
                </button>
              </HoverTip>
              <HoverTip text="Print the active Finance view with your hotel masthead and Powered by Hosila footer.">
                <button
                  type="button"
                  onClick={() => window.print()}
                  disabled={Boolean(dateRangeError)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.05] disabled:opacity-40 whitespace-nowrap shrink-0"
                >
                  <Printer className="h-3.5 w-3.5" />
                  Print Report
                </button>
              </HoverTip>
            </div>
          </div>

          {dateRangeError && (
            <div className="rounded-xl border border-[#E05252]/40 bg-[#E05252]/[0.06] px-3.5 py-2 text-xs font-medium text-danger-ink">
              {dateRangeError}
            </div>
          )}
        </div>

        {error && !dateRangeError && (
          <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.06] p-4 text-sm text-danger-ink">
            {error}
          </div>
        )}

        {loading && !report ? (
          <div className="space-y-4">
            <div className="h-24 rounded-2xl bg-ink/[0.04]" />
            <div className="h-72 rounded-2xl bg-ink/[0.04]" />
          </div>
        ) : report ? (
          <>
            {/* TAB 1: OVERVIEW & DEPARTMENTS (KPI strip lives exclusively here) */}
            {activeTab === 'overview' && (
              <div className="space-y-8">
                {/* KPI Strip — only shown on Overview & Departments */}
                <section
                  className={`grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 ${
                    kpiCount >= 7 ? 'xl:grid-cols-7' : kpiCount === 6 ? 'xl:grid-cols-6' : 'xl:grid-cols-5'
                  } gap-3`}
                >
                  <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                    <div className="text-xs text-ink/55">Total Revenue</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                      {currency}
                      {report.kpis.grossRevenue.toFixed(2)}
                    </div>
                    <div className="mt-0.5 text-[11px] text-ink/45">{report.daysCount} days net</div>
                  </div>

                  {showTaxMetric && (
                    <HoverTip
                      text="Total tax collected across accommodation and restaurant transactions during the selected date range."
                      className="block w-full"
                    >
                      <div className="h-full rounded-2xl border border-ink/10 bg-surface p-4">
                        <div className="text-xs text-ink/55 truncate" title={taxKpiLabel}>
                          {taxKpiLabel}
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                          {currency}
                          {report.kpis.taxCollected.toFixed(2)}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                          Rm {currency}
                          {report.kpis.accommodationTaxCollected.toFixed(0)} · Rest {currency}
                          {report.kpis.restaurantTaxCollected.toFixed(0)}
                        </div>
                      </div>
                    </HoverTip>
                  )}

                  <div className="rounded-2xl border border-[#E05252]/30 bg-surface p-4">
                    <div className="text-xs text-danger-ink">Recorded Expenses</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-danger-ink">
                      {currency}
                      {report.kpis.totalExpenses.toFixed(2)}
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                      {report.expenses.filter((e) => !e.voided).length}{' '}
                      {report.expenses.filter((e) => !e.voided).length === 1 ? 'entry' : 'entries'}
                    </div>
                    {report.kpis.totalExpenses > 0 && (
                      <div className="mt-1.5 h-1 w-10 rounded-full bg-[#E05252]" />
                    )}
                  </div>

                  <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                    <div className="text-xs text-ink/55">Net Operating Income</div>
                    <div
                      className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                        report.kpis.netOperatingIncome < 0 ? 'text-danger-ink' : 'text-ink'
                      }`}
                    >
                      {currency}
                      {report.kpis.netOperatingIncome.toFixed(2)}
                    </div>
                    <div
                      className={`mt-1.5 h-1 w-10 rounded-full ${
                        report.kpis.netOperatingIncome < 0 ? 'bg-[#E05252]' : 'bg-[#6AD4B0]'
                      }`}
                    />
                  </div>

                  <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                    <div className="text-xs text-ink/55">Avg Occupancy</div>
                    <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-ink">
                      {report.kpis.averageOccupancyPct.toFixed(1)}%
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                      ADR {currency}
                      {report.kpis.adr.toFixed(0)} · RevPAR {currency}
                      {report.kpis.revpar.toFixed(0)}
                    </div>
                  </div>

                  <HoverTip
                    text="Live unpaid balance owed across all non-cancelled guest folios (Guest Ledger 1100), regardless of the selected report date range."
                    className="block w-full"
                  >
                    <div className="h-full rounded-2xl border border-ink/10 bg-surface p-4">
                      <div className="text-xs text-ink/55">Open Folio Balances</div>
                      <div
                        className={`mt-1 font-mono text-lg font-semibold tabular-nums ${
                          report.kpis.outstandingBalance > 0 ? 'text-danger-ink' : 'text-ink'
                        }`}
                      >
                        {currency}
                        {report.kpis.outstandingBalance.toFixed(2)}
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/45">
                        Collected {currency}
                        {report.kpis.paymentsCollected.toFixed(0)}
                      </div>
                    </div>
                  </HoverTip>

                  {hasUnpaidPosTabs && (
                    <HoverTip
                      text="Live total of open unpaid dine-in restaurant orders awaiting payment (Restaurant Receivable 1120)."
                      className="block w-full"
                    >
                      <div className="h-full rounded-2xl border border-[#E05252]/55 bg-[#E05252]/[0.07] p-4">
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-semibold text-danger-ink">Unpaid POS Tabs</span>
                          <span className="h-2 w-2 rounded-full bg-[#E05252] shrink-0" />
                        </div>
                        <div className="mt-1 font-mono text-lg font-semibold tabular-nums text-danger-ink">
                          {currency}
                          {report.kpis.unpaidPosTabsTotal.toFixed(2)}
                        </div>
                        <div className="mt-0.5 font-mono text-[11px] tabular-nums text-danger-ink/80">
                          {report.kpis.unpaidPosTabsCount}{' '}
                          {report.kpis.unpaidPosTabsCount === 1 ? 'open tab' : 'open tabs'}
                        </div>
                      </div>
                    </HoverTip>
                  )}
                </section>

                {/* Unpaid Check-Outs (Settle Later / City Ledger) */}
                {unpaidCheckouts.length > 0 && (
                  <section className="rounded-2xl border border-[#E05252]/35 bg-surface p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#E05252]/12 text-danger-ink">
                          <Clock className="h-4 w-4" />
                        </span>
                        <div>
                          <h2 className="text-sm font-semibold text-ink">
                            Unpaid Check-Outs · Settle Later (City Ledger)
                          </h2>
                          <p className="text-xs text-ink/55">
                            Checked-out stays carrying an open balance awaiting delayed payment or complimentary waiver.
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-base font-semibold tabular-nums text-danger-ink">
                          {currency}
                          {unpaidCheckoutsTotal.toFixed(2)}
                        </div>
                        <div className="text-[11px] text-ink/50">
                          {unpaidCheckouts.length}{' '}
                          {unpaidCheckouts.length === 1 ? 'open account' : 'open accounts'}
                        </div>
                      </div>
                    </div>

                    <div className="overflow-x-auto border-t border-ink/10">
                      <table className="w-full text-left border-collapse">
                        <thead>
                          <tr className="border-b border-ink/10 text-xs font-medium text-ink/50">
                            <th className="py-2.5 pr-3">Guest &amp; Folio</th>
                            <th className="py-2.5 px-3">Checked Out</th>
                            <th className="py-2.5 px-3">Reason / Guarantor</th>
                            <th className="py-2.5 px-3">Authorized By</th>
                            <th className="py-2.5 px-3">Due Date</th>
                            <th className="py-2.5 px-3 text-right">Balance Due</th>
                            <th className="no-print py-2.5 pl-3 text-right">Action</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-ink/8 text-sm">
                          {unpaidCheckouts.map((stay) => (
                            <tr key={stay.id} className="hover:bg-ink/[0.02]">
                              <td className="py-3 pr-3">
                                <div className="font-medium text-ink">{stay.guest_name}</div>
                                <div className="font-mono text-[11px] text-ink/50">
                                  Room {stay.room_number} · {stay.confirmation_code}
                                </div>
                              </td>
                              <td className="py-3 px-3 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                                {stay.check_out_date}
                              </td>
                              <td className="py-3 px-3 text-xs text-ink/75 max-w-xs">
                                {stay.deferred_reason || '—'}
                              </td>
                              <td className="py-3 px-3 text-xs text-ink/65 whitespace-nowrap">
                                {stay.deferred_authorized_by || '—'}
                              </td>
                              <td className="py-3 px-3 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                                {stay.deferred_due_date || 'Open'}
                              </td>
                              <td className="py-3 px-3 text-right font-mono text-sm font-semibold tabular-nums text-danger-ink whitespace-nowrap">
                                {currency}
                                {stay.balance_due.toFixed(2)}
                              </td>
                              <td className="no-print py-3 pl-3 text-right whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => onOpenFolio(stay.id)}
                                  className="inline-flex items-center gap-1 rounded-lg bg-[#6AD4B0] px-3 py-1.5 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
                                >
                                  Open Folio &amp; Settle
                                  <ArrowUpRight className="h-3.5 w-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {/* Revenue by Department Strip (Front Desk, Restaurant, Other Income) */}
                <section className="rounded-2xl border border-ink/10 bg-surface p-5 space-y-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h2 className="text-sm font-semibold text-ink">Revenue by Department</h2>
                    <span className="font-mono text-xs tabular-nums text-ink/55">
                      Total {currency}
                      {report.kpis.grossRevenue.toFixed(2)}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {report.departmentRevenue.map((dept, idx) => (
                      <div
                        key={dept.department}
                        className="rounded-xl border border-ink/10 bg-canvas p-4 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-ink/65">{dept.department}</span>
                          <span className="font-mono text-xs tabular-nums text-ink/50">
                            {dept.sharePct.toFixed(1)}%
                          </span>
                        </div>
                        <div className="font-mono text-xl font-semibold tabular-nums text-ink">
                          {currency}
                          {dept.revenue.toFixed(2)}
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-ink/8 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${
                              idx === 0 ? 'bg-[#6AD4B0]' : idx === 1 ? 'bg-ink' : 'bg-ink/45'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, dept.sharePct))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Charts Row */}
                <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <div className="rounded-2xl border border-ink/10 bg-surface p-6">
                    <div className="flex items-baseline justify-between mb-6">
                      <h2 className="text-sm font-semibold text-ink">Daily Revenue vs. Expenses</h2>
                      <div className="flex items-center gap-4 text-xs text-ink/65">
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#6AD4B0]" />
                          Revenue
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#E05252]" />
                          Expenses
                        </span>
                      </div>
                    </div>
                    <div className="h-60 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={report.dailySeries} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={chartInk} strokeOpacity={0.08} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: chartInk, fillOpacity: 0.55, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                            axisLine={{ stroke: chartInk, strokeOpacity: 0.12 }}
                            tickLine={false}
                          />
                          <YAxis
                            tick={{ fill: chartInk, fillOpacity: 0.55, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                            axisLine={false}
                            tickLine={false}
                            width={56}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: chartSurface,
                              borderColor: chartBorder,
                              borderRadius: '12px',
                              fontSize: '12px',
                              color: chartInk,
                            }}
                          />
                          <Bar dataKey="totalRevenue" name="Revenue" fill="#6AD4B0" radius={[4, 4, 0, 0]} />
                          <Bar dataKey="expenses" name="Expenses" fill="#E05252" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-ink/10 bg-surface p-6">
                    <div className="flex items-baseline justify-between mb-6">
                      <h2 className="text-sm font-semibold text-ink">Room Occupancy Analysis</h2>
                      <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                        Avg {report.kpis.averageOccupancyPct.toFixed(1)}%
                      </span>
                    </div>
                    <div className="h-60 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={report.dailySeries} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                          <CartesianGrid stroke={chartInk} strokeOpacity={0.08} vertical={false} />
                          <XAxis
                            dataKey="label"
                            tick={{ fill: chartInk, fillOpacity: 0.55, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                            axisLine={{ stroke: chartInk, strokeOpacity: 0.12 }}
                            tickLine={false}
                          />
                          <YAxis
                            domain={[0, 100]}
                            unit="%"
                            tick={{ fill: chartInk, fillOpacity: 0.55, fontSize: 11, fontFamily: 'IBM Plex Mono' }}
                            axisLine={false}
                            tickLine={false}
                            width={44}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: chartSurface,
                              borderColor: chartBorder,
                              borderRadius: '12px',
                              fontSize: '12px',
                              color: chartInk,
                            }}
                          />
                          <Line
                            type="monotone"
                            dataKey="occupancyPct"
                            name="Occupancy %"
                            stroke="#6AD4B0"
                            strokeWidth={2.5}
                            dot={{ r: 3.5, fill: '#6AD4B0', strokeWidth: 0 }}
                            activeDot={{ r: 5, fill: chartInk }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </section>

                {/* Bottom Tables: Room Type Performance + P&L / Tax Summary */}
                <section className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                  <div className="lg:col-span-7 space-y-6">
                    <div className="space-y-3">
                      <h2 className="text-sm font-semibold text-ink">Occupancy &amp; Rate by Room Type</h2>
                      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                              <th className="py-3 px-4">Room Category</th>
                              <th className="py-3 px-4 text-right">Rooms</th>
                              <th className="py-3 px-4 text-right">Nights</th>
                              <th className="py-3 px-4 text-right">Occupancy</th>
                              <th className="py-3 px-4 text-right">ADR</th>
                              <th className="py-3 px-4 text-right">Revenue</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink/8 text-sm">
                            {report.roomTypeBreakdown.map((row) => (
                              <tr key={row.roomType}>
                                <td className="py-3 px-4 font-medium text-ink">{row.roomType}</td>
                                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-ink/70">
                                  {row.inventory}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-ink/70">
                                  {row.nightsSold}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-xs font-semibold tabular-nums text-ink">
                                  {row.occupancyPct.toFixed(1)}%
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-ink/75">
                                  {currency}
                                  {row.adr.toFixed(2)}
                                </td>
                                <td className="py-3 px-4 text-right font-mono text-sm tabular-nums text-ink">
                                  {currency}
                                  {row.revenue.toFixed(2)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    {/* Recorded Extra / Other Income Table */}
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-ink">
                          Recorded Other Income ({report.extraIncome.length})
                        </h2>
                        <span className="font-mono text-xs tabular-nums text-ink/55">
                          {currency}
                          {report.kpis.otherIncomeTotal.toFixed(2)}
                        </span>
                      </div>
                      <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface">
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                              <th className="py-2.5 px-4">Date</th>
                              <th className="py-2.5 px-4">Category</th>
                              <th className="py-2.5 px-4">Description &amp; Payer</th>
                              <th className="py-2.5 px-4 text-right">Amount</th>
                              <th className="no-print py-2.5 px-3 w-10"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-ink/8 text-sm">
                            {report.extraIncome.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-8 text-center text-xs text-ink/45">
                                  No extra income recorded in this date window.
                                </td>
                              </tr>
                            ) : (
                              report.extraIncome.map((inc) => {
                                const isVoided = inc.voided === 1;
                                return (
                                  <tr
                                    key={inc.id}
                                    className={isVoided ? 'bg-[#E05252]/[0.05] opacity-75' : 'hover:bg-ink/[0.02]'}
                                  >
                                    <td className="py-2.5 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                                      {inc.income_date}
                                    </td>
                                    <td className="py-2.5 px-4 text-xs font-medium text-ink whitespace-nowrap">
                                      {inc.category}
                                    </td>
                                    <td className="py-2.5 px-4">
                                      <div className={`text-xs font-medium text-ink ${isVoided ? 'line-through' : ''}`}>
                                        {inc.description}
                                      </div>
                                      <div className="text-[11px] text-ink/50">
                                        {[inc.payer, inc.reference].filter(Boolean).join(' · ') || '—'}
                                        {isVoided && (
                                          <span className="ml-2 font-semibold text-danger-ink">
                                            Reversed{inc.void_reason ? ` (${inc.void_reason})` : ''}
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                    <td
                                      className={`py-2.5 px-4 text-right font-mono text-sm tabular-nums whitespace-nowrap ${
                                        isVoided ? 'line-through text-danger-ink' : 'text-ink'
                                      }`}
                                    >
                                      {currency}
                                      {inc.amount.toFixed(2)}
                                    </td>
                                    <td className="no-print py-2.5 px-3 text-right">
                                      {canVoid && !isVoided && (
                                        <HoverTip text="Post an audit-safe void reversal entry instead of silently deleting this record.">
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openVoidModal(
                                                'extra_income',
                                                inc.id,
                                                inc.description,
                                                inc.amount,
                                                inc.reference,
                                                inc.payer
                                              )
                                            }
                                            aria-label={`Reverse ${inc.description}`}
                                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                                          >
                                            <RotateCcw className="h-3.5 w-3.5" />
                                          </button>
                                        </HoverTip>
                                      )}
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>

                  <div className="lg:col-span-5 space-y-3">
                    <h2 className="text-sm font-semibold text-ink">
                      {showTaxMetric ? 'Profit, Department & Tax Summary' : 'Profit & Department Summary'}
                    </h2>
                    <div className="rounded-2xl border border-ink/10 bg-surface p-5 space-y-5">
                      <dl className="space-y-2.5 text-sm">
                        <div className="flex justify-between">
                          <dt className="text-ink/65">Front Desk (Rooms &amp; Services)</dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {currency}
                            {report.kpis.frontDeskRevenueTotal.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between text-xs pl-3">
                          <dt className="text-ink/45">Rooms Division</dt>
                          <dd className="font-mono tabular-nums text-ink/65">
                            {currency}
                            {report.kpis.roomRevenueTotal.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between text-xs pl-3">
                          <dt className="text-ink/45">Ancillary Services</dt>
                          <dd className="font-mono tabular-nums text-ink/65">
                            {currency}
                            {report.kpis.serviceRevenueTotal.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-ink/65">Restaurant (POS + Manual)</dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {currency}
                            {report.kpis.restaurantRevenueTotal.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between">
                          <dt className="text-ink/65">Other Income</dt>
                          <dd className="font-mono tabular-nums text-ink">
                            {currency}
                            {report.kpis.otherIncomeTotal.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between border-t border-ink/10 pt-2.5 text-danger-ink">
                          <dt>Total Operating Expenses</dt>
                          <dd className="font-mono tabular-nums font-medium">
                            −{currency}
                            {report.kpis.totalExpenses.toFixed(2)}
                          </dd>
                        </div>
                        <div className="flex justify-between border-t border-ink/10 pt-2.5 font-semibold text-ink">
                          <dt>Net Operating Income</dt>
                          <dd
                            className={`font-mono tabular-nums ${
                              report.kpis.netOperatingIncome < 0 ? 'text-danger-ink' : 'text-ink'
                            }`}
                          >
                            {currency}
                            {report.kpis.netOperatingIncome.toFixed(2)}
                          </dd>
                        </div>
                      </dl>

                      {showTaxMetric && (
                        <div className="border-t border-ink/10 pt-4 space-y-2">
                          <div className="flex items-center justify-between text-xs font-semibold text-ink">
                            <span>{taxKpiLabel} Summary</span>
                            <button
                              type="button"
                              onClick={() => {
                                setActiveTab('ledger_audit');
                                setLedgerSubView('tax_register');
                              }}
                              className="no-print text-[11px] font-medium text-accent-ink hover:underline"
                            >
                              Open Tax Register →
                            </button>
                          </div>
                          {report.taxByRule && report.taxByRule.length > 0 && (
                            <div className="space-y-1 pb-1">
                              {report.taxByRule.map((rule) => (
                                <div key={rule.name} className="flex justify-between text-xs">
                                  <span className="text-ink/75">{rule.name}</span>
                                  <span className="font-mono tabular-nums text-ink">
                                    {currency}
                                    {rule.amount.toFixed(2)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex justify-between text-xs">
                            <span className="text-ink/55">Accommodation Share</span>
                            <span className="font-mono tabular-nums text-ink/75">
                              {currency}
                              {report.kpis.accommodationTaxCollected.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-ink/55">Restaurant Share</span>
                            <span className="font-mono tabular-nums text-ink/75">
                              {currency}
                              {report.kpis.restaurantTaxCollected.toFixed(2)}
                            </span>
                          </div>
                          <div className="flex justify-between border-t border-ink/8 pt-2 text-xs font-semibold text-ink">
                            <span>Total Tax Liability</span>
                            <span className="font-mono tabular-nums">
                              {currency}
                              {report.kpis.taxCollected.toFixed(2)}
                            </span>
                          </div>
                        </div>
                      )}

                      <div className="border-t border-ink/10 pt-4 space-y-2">
                        <div className="text-xs font-medium text-ink/55">Collections by Payment Method</div>
                        {Object.entries(report.paymentBreakdown).map(([method, amount]) => (
                          <div key={method} className="flex justify-between text-xs">
                            <span className="capitalize text-ink/70">{method.replace('_', ' ')}</span>
                            <span className="font-mono tabular-nums text-ink">
                              {currency}
                              {amount.toFixed(2)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {/* TAB 2: UNIFIED LEDGER & AUDIT (Charge Clearing, Double-Entry Journal, Trial Balance, Tax Register) */}
            {activeTab === 'ledger_audit' && (
              <LedgerAndAuditTab
                overview={accounting}
                settings={settings}
                subView={ledgerSubView}
                onChangeSubView={setLedgerSubView}
                clearingMode={clearingMode}
                onChangeClearingMode={setClearingMode}
              />
            )}

            {/* TAB 3: EXPENSE LEDGER */}
            {activeTab === 'expenses' && (
              <section className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                <div className="lg:col-span-8 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-ink">
                      Recorded Operating Expenses ({report.expenses.length})
                    </h2>
                    <span className="font-mono text-xs tabular-nums text-ink/55">
                      {report.fromDate} to {report.toDate}
                    </span>
                  </div>

                  <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                          <th className="py-3 px-4">Date</th>
                          <th className="py-3 px-4">Category</th>
                          <th className="py-3 px-4">Description &amp; Vendor</th>
                          <th className="py-3 px-4">Method</th>
                          <th className="py-3 px-4 text-right">Amount</th>
                          <th className="no-print py-3 px-4 w-10"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink/8 text-sm">
                        {report.expenses.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-12 text-center text-xs text-ink/50">
                              No expenses recorded for this date window. Click &ldquo;Record Expense&rdquo; to log one.
                            </td>
                          </tr>
                        ) : (
                          report.expenses.map((exp) => {
                            const isVoided = exp.voided === 1;
                            return (
                              <tr
                                key={exp.id}
                                className={isVoided ? 'bg-[#E05252]/[0.05] opacity-75' : 'hover:bg-ink/[0.02]'}
                              >
                                <td className="py-3 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                                  {exp.expense_date}
                                </td>
                                <td className="py-3 px-4 text-xs font-medium text-ink whitespace-nowrap">
                                  {exp.category}
                                </td>
                                <td className="py-3 px-4">
                                  <div className={`text-sm text-ink ${isVoided ? 'line-through' : ''}`}>
                                    {exp.description}
                                  </div>
                                  <div className="text-xs text-ink/50">
                                    {[exp.vendor, exp.reference, `By ${exp.recorded_by}`].filter(Boolean).join(' · ')}
                                    {isVoided && (
                                      <span className="ml-2 font-semibold text-danger-ink">
                                        Reversed{exp.void_reason ? ` (${exp.void_reason})` : ''}
                                        {exp.voided_by ? ` · ${exp.voided_by}` : ''}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4 text-xs capitalize text-ink/65 whitespace-nowrap">
                                  {exp.payment_method.replace('_', ' ')}
                                </td>
                                <td
                                  className={`py-3 px-4 text-right font-mono text-sm font-medium tabular-nums text-danger-ink whitespace-nowrap ${
                                    isVoided ? 'line-through opacity-65' : ''
                                  }`}
                                >
                                  −{currency}
                                  {exp.amount.toFixed(2)}
                                </td>
                                <td className="no-print py-3 px-4 text-right">
                                  {canVoid && !isVoided && (
                                    <HoverTip text="Post an audit-safe void reversal entry instead of silently deleting this expense.">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openVoidModal(
                                            'expense',
                                            exp.id,
                                            exp.description,
                                            exp.amount,
                                            exp.reference,
                                            exp.vendor
                                          )
                                        }
                                        aria-label={`Reverse ${exp.description}`}
                                        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                      </button>
                                    </HoverTip>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="lg:col-span-4 space-y-3">
                  <h2 className="text-sm font-semibold text-ink">Expenses by Category</h2>
                  <div className="rounded-2xl border border-[#E05252]/25 bg-surface p-5 space-y-3">
                    {Object.keys(report.expenseByCategory).length === 0 ? (
                      <p className="text-xs text-ink/50">No categorized expenses in this date range.</p>
                    ) : (
                      Object.entries(report.expenseByCategory)
                        .sort((a, b) => b[1] - a[1])
                        .map(([cat, amount]) => (
                          <div key={cat} className="flex justify-between text-sm">
                            <span className="text-ink/70">{cat}</span>
                            <span className="font-mono tabular-nums text-danger-ink">
                              {currency}
                              {amount.toFixed(2)}
                            </span>
                          </div>
                        ))
                    )}
                    <div className="flex justify-between border-t border-[#E05252]/20 pt-3 text-sm font-semibold text-danger-ink">
                      <span>Total Period Expenses</span>
                      <span className="font-mono tabular-nums">
                        {currency}
                        {report.kpis.totalExpenses.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* TAB 4: NIGHT AUDIT & AUTOMATIC BACKUPS */}
            {activeTab === 'night_audit' && (
              <NightAuditBackupsTab
                overview={accounting}
                settings={settings}
                userRole={userRole}
                authFetch={authFetch}
                mutate={mutate}
                onRefreshAccounting={() => setAccountingRefreshTick((t) => t + 1)}
              />
            )}

            {/* Print-Only Footer */}
            <div className="hidden print-only pt-6 mt-6 border-t border-ink/15 text-xs text-ink/55 flex justify-between">
              <span>
                {settings.hotel_name} · {settings.hotel_address} · {settings.hotel_phone}
              </span>
              <span>Powered by Hosila</span>
            </div>
          </>
        ) : null}
      </div>

      {/* Record Extra Income Modal */}
      <Modal
        open={incomeModalOpen}
        onClose={() => setIncomeModalOpen(false)}
        title="Record Extra Income"
      >
        <form onSubmit={handleRecordExtraIncome} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Date *</label>
              <input
                type="date"
                required
                max={todayIso}
                value={incDate}
                onChange={(e) => setIncDate(e.target.value)}
                className={`w-full rounded-xl border bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink ${
                  incDateError ? 'border-[#E05252]' : 'border-ink/15'
                }`}
              />
              {incDateError && <p className="mt-1 text-[11px] text-danger-ink">{incDateError}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Category *</label>
              <input
                type="text"
                required
                list="extra-income-categories-datalist"
                value={incCategory}
                onChange={(e) => setIncCategory(e.target.value)}
                placeholder="Choose or type category..."
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
              />
              <datalist id="extra-income-categories-datalist">
                {extraIncomeCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Description *</label>
            <input
              type="text"
              required
              value={incDescription}
              onChange={(e) => setIncDescription(e.target.value)}
              placeholder="e.g. Boardroom half-day rental or Pool day pass"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Payer / Client</label>
              <input
                type="text"
                value={incPayer}
                onChange={(e) => setIncPayer(e.target.value)}
                placeholder="Company or guest name"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Amount ({currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={incAmount}
                onChange={(e) => setIncAmount(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Payment Method</label>
              <select
                value={incMethod}
                onChange={(e) => setIncMethod(e.target.value as ExtraIncome['payment_method'])}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="corporate">Corporate Account</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Receipt / Ref #</label>
              <input
                type="text"
                value={incRef}
                onChange={(e) => setIncRef(e.target.value)}
                placeholder="INC-2026-01"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-ink/40"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setIncomeModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(incDateError)}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Extra Income'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Expense Modal */}
      <Modal
        open={expenseModalOpen}
        onClose={() => setExpenseModalOpen(false)}
        title="Record Operating Expense"
      >
        <form onSubmit={handleRecordExpense} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Expense Date *</label>
              <input
                type="date"
                required
                max={todayIso}
                value={expDate}
                onChange={(e) => setExpDate(e.target.value)}
                className={`w-full rounded-xl border bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink ${
                  expDateError ? 'border-[#E05252]' : 'border-ink/15'
                }`}
              />
              {expDateError && <p className="mt-1 text-[11px] text-danger-ink">{expDateError}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Category *</label>
              <input
                type="text"
                required
                list="expense-categories-datalist"
                value={expCategory}
                onChange={(e) => setExpCategory(e.target.value)}
                placeholder="Choose or type category..."
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
              />
              <datalist id="expense-categories-datalist">
                {expenseCategories.map((cat) => (
                  <option key={cat} value={cat} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Description *</label>
            <input
              type="text"
              required
              value={expDescription}
              onChange={(e) => setExpDescription(e.target.value)}
              placeholder="e.g. Monthly laundry supply invoice or generator diesel"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Vendor / Payee</label>
              <input
                type="text"
                value={expVendor}
                onChange={(e) => setExpVendor(e.target.value)}
                placeholder="Supplier name"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Amount ({currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={expAmount}
                onChange={(e) => setExpAmount(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Payment Method</label>
              <select
                value={expMethod}
                onChange={(e) => setExpMethod(e.target.value as Expense['payment_method'])}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="bank_transfer">Bank Transfer</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="corporate">Corporate Account</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Invoice / Receipt #</label>
              <input
                type="text"
                value={expRef}
                onChange={(e) => setExpRef(e.target.value)}
                placeholder="INV-2026-01"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink placeholder:text-ink/40"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setExpenseModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || Boolean(expDateError)}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Save Expense'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Immutable Void / Reversal Confirmation Modal */}
      <VoidConfirmModal
        open={Boolean(voidTarget)}
        target={voidTarget?.summary ?? null}
        reasonPresets={voidReasonPresets}
        submitting={submitting}
        onClose={() => !submitting && setVoidTarget(null)}
        onConfirm={handleConfirmVoid}
      />
    </div>
  );
}
