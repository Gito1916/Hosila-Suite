import { useCallback, useEffect, useState } from 'react';
import {
  BarChart3,
  Download,
  FileSpreadsheet,
  RefreshCw,
  ShoppingBag,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type ConsumptionByDeptRow,
  type ProcurementSpendRow_Serialize,
  type StockValuationReportDto_Serialize,
  type WeeklyStockSheetReportDto,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { EmptyState } from '../components/ui/StatCard';
import {
  cn,
  daysAgoIso,
  formatDateShort,
  formatMicroUnitCost,
  formatMilli,
  formatMinor,
  todayIso,
} from '../lib/format';

type ReportTab = 'weekly' | 'valuation' | 'consumption' | 'spend';

export function ReportsPage() {
  const { departments, currencySymbol } = useApp();
  const [tab, setTab] = useState<ReportTab>('weekly');
  const [startDate, setStartDate] = useState(daysAgoIso(6));
  const [endDate, setEndDate] = useState(todayIso());
  const [deptId, setDeptId] = useState('');
  const [loading, setLoading] = useState(false);

  const [weekly, setWeekly] = useState<WeeklyStockSheetReportDto | null>(null);
  const [valuation, setValuation] = useState<StockValuationReportDto_Serialize | null>(null);
  const [consumption, setConsumption] = useState<ConsumptionByDeptRow[]>([]);
  const [spend, setSpend] = useState<ProcurementSpendRow_Serialize[]>([]);

  const [exportOpen, setExportOpen] = useState(false);
  const [exportPath, setExportPath] = useState(
    `Downloads\\Hosila-Weekly-Stock-Sheet-${todayIso()}.xlsx`
  );
  const [exporting, setExporting] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'weekly') {
        const res = await commands.getWeeklyStockSheet(startDate, endDate);
        if (res.status === 'ok') setWeekly(res.data);
        else toast.error(res.error.message);
      } else if (tab === 'valuation') {
        const res = await commands.getStockValuationReport();
        if (res.status === 'ok') setValuation(res.data);
        else toast.error(res.error.message);
      } else if (tab === 'consumption') {
        const res = await commands.getConsumptionReport({
          start_date: startDate,
          end_date: endDate,
          department_id: deptId || null,
        });
        if (res.status === 'ok') setConsumption(res.data);
        else toast.error(res.error.message);
      } else if (tab === 'spend') {
        const res = await commands.getProcurementSpendReport({
          start_date: startDate,
          end_date: endDate,
          department_id: null,
        });
        if (res.status === 'ok') setSpend(res.data);
        else toast.error(res.error.message);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, startDate, endDate, deptId]);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  async function handleExportWeekly(e: React.FormEvent) {
    e.preventDefault();
    if (!exportPath.trim()) return;
    setExporting(true);
    try {
      const res = await commands.exportWeeklyStockSheetXlsx(
        startDate,
        endDate,
        exportPath.trim()
      );
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Exported weekly stock sheet to ${res.data}`);
      setExportOpen(false);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">Reports</h1>

        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex-wrap">
          {(
            [
              { id: 'weekly', label: 'Weekly Stock Sheet', icon: FileSpreadsheet },
              { id: 'valuation', label: 'Valuation', icon: Wallet },
              { id: 'consumption', label: 'Consumption', icon: TrendingDown },
              { id: 'spend', label: 'Procurement Spend', icon: ShoppingBag },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer',
                  tab === t.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5">
        <div className="flex flex-wrap items-center gap-2.5">
          {tab !== 'valuation' && (
            <>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-[155px] tabular-nums"
              />
              <span className="text-[12px] text-[var(--text-muted)]">to</span>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-[155px] tabular-nums"
              />
            </>
          )}
          {tab === 'consumption' && (
            <Select
              value={deptId}
              onChange={(e) => setDeptId(e.target.value)}
              className="w-[180px]"
            >
              <option value="">All Departments</option>
              {departments
                .filter((d) => d.name.toLowerCase() !== 'store')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
            </Select>
          )}
          <Button
            variant="secondary"
            size="icon"
            onClick={loadReport}
            tooltip="Refresh the current report for the selected date range."
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        {tab === 'weekly' && (
          <Button
            variant="primary"
            onClick={() => setExportOpen(true)}
            tooltip="Export the Weekly Stock Sheet to an A4 landscape Excel (.xlsx) workbook with live formulas."
          >
            <Download className="h-4 w-4" />
            Export Weekly Excel (.xlsx)
          </Button>
        )}
      </div>

      {/* TAB 1: WEEKLY STOCK SHEET */}
      {tab === 'weekly' && weekly && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
          <div className="px-5 py-3 border-b border-[var(--border-subtle)] flex items-center justify-between text-[12.5px]">
            <span className="text-[var(--text-secondary)]">
              Period: <strong className="text-[var(--text-primary)]">{formatDateShort(weekly.start_date)}</strong> –{' '}
              <strong className="text-[var(--text-primary)]">{formatDateShort(weekly.end_date)}</strong> ({weekly.rows.length} items)
            </span>
            <span className="tabular-nums">
              Grand Total Closing Value:{' '}
              <strong className="text-[var(--accent-text)] text-[14.5px]">
                {formatMinor(weekly.grand_total_minor, currencySymbol)}
              </strong>
            </span>
          </div>
          <div className="overflow-x-auto max-h-[540px] overflow-y-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead className="sticky top-0 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[10.5px] uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="py-2.5 px-3">Section</th>
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-2">Unit</th>
                  <th className="py-2.5 px-2 text-right">Opening</th>
                  <th className="py-2.5 px-2 text-right">Purchase</th>
                  <th className="py-2.5 px-2 text-right">Available</th>
                  <th className="py-2.5 px-2 text-right">Issued</th>
                  <th className="py-2.5 px-2 text-right">Closing</th>
                  <th className="py-2.5 px-2 text-right">Unit Cost</th>
                  <th className="py-2.5 px-3 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {weekly.rows.map((r) => (
                  <tr key={r.item_id} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2 px-3">
                      <Badge tone="neutral">{r.section_label}</Badge>
                    </td>
                    <td className="py-2 px-3 font-medium">{r.item_name}</td>
                    <td className="py-2 px-2 text-[var(--text-muted)]">{r.unit_code}</td>
                    <td className="py-2 px-2 text-right">{formatMilli(r.opening_milli)}</td>
                    <td className="py-2 px-2 text-right text-[var(--accent-text)]">
                      {formatMilli(r.purchase_milli)}
                    </td>
                    <td className="py-2 px-2 text-right">{formatMilli(r.available_milli)}</td>
                    <td className="py-2 px-2 text-right">{formatMilli(r.issued_milli)}</td>
                    <td className="py-2 px-2 text-right font-semibold">
                      {formatMilli(r.closing_milli)}
                    </td>
                    <td className="py-2 px-2 text-right text-[var(--text-secondary)]">
                      {r.cost_missing
                        ? '—'
                        : formatMicroUnitCost(r.unit_cost_micro, currencySymbol)}
                    </td>
                    <td className="py-2 px-3 text-right font-medium">
                      {formatMinor(r.total_value_minor, currencySymbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 2: VALUATION */}
      {tab === 'valuation' && valuation && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/60">Total Valuation</div>
              <div className="font-mono text-xl font-semibold tabular-nums text-accent-ink mt-1">
                {formatMinor(valuation.total_value_minor, currencySymbol)}
              </div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/60">Active Items</div>
              <div className="font-mono text-xl font-semibold tabular-nums text-ink mt-1">
                {valuation.total_items}
              </div>
            </div>
            <div className="rounded-2xl border border-ink/10 bg-surface p-4">
              <div className="text-xs text-ink/60">Items Missing Cost</div>
              <div className="font-mono text-xl font-semibold tabular-nums text-danger-ink mt-1">
                {valuation.cost_missing_count}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Department / Section</th>
                  <th className="py-2.5 px-3 text-right">Items</th>
                  <th className="py-2.5 px-3 text-right">Missing Cost</th>
                  <th className="py-2.5 px-4 text-right">Valuation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {valuation.by_department.map((d, i) => (
                  <tr key={i} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 px-4 font-medium">
                      {d.department_name}
                      {d.section_name && (
                        <Badge tone="info" className="ml-2">
                          {d.section_name}
                        </Badge>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">{d.item_count}</td>
                    <td className="py-2.5 px-3 text-right">
                      {d.cost_missing_count > 0 ? (
                        <Badge tone="warning">{d.cost_missing_count}</Badge>
                      ) : (
                        '0'
                      )}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold">
                      {formatMinor(d.total_value_minor, currencySymbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: CONSUMPTION */}
      {tab === 'consumption' &&
        (consumption.length === 0 ? (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="No consumption in selected range"
            description="Stock issues posted during this period will be summarized here by department and item."
          />
        ) : (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Department</th>
                  <th className="py-2.5 px-3">Item</th>
                  <th className="py-2.5 px-3 text-right">Quantity Issued</th>
                  <th className="py-2.5 px-4 text-right">Total Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {consumption.map((c) => (
                  <tr key={`${c.department_id}-${c.item_id}`} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 px-4">
                      <Badge tone="neutral">{c.department_name}</Badge>
                    </td>
                    <td className="py-2.5 px-3 font-medium">{c.item_name}</td>
                    <td className="py-2.5 px-3 text-right">
                      {formatMilli(c.qty_milli)} {c.base_unit_code}
                    </td>
                    <td className="py-2.5 px-4 text-right font-semibold">
                      {formatMinor(c.value_minor, currencySymbol)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* TAB 4: PROCUREMENT SPEND */}
      {tab === 'spend' &&
        (spend.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag className="h-5 w-5" />}
            title="No restock spend in selected range"
            description="Posted goods receipts and Excel procurement restocks appear here."
          />
        ) : (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Receipt #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Source</th>
                  <th className="py-2.5 px-3 text-right">Items Total</th>
                  <th className="py-2.5 px-3 text-right">Extra Charges</th>
                  <th className="py-2.5 px-3 text-right">Grand Total</th>
                  <th className="py-2.5 px-4 text-right">Refund</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {spend.map((s) => (
                  <tr key={s.receipt_id} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 px-4 font-medium">{s.receipt_number}</td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                      {formatDateShort(s.received_at)}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge tone="neutral">{s.source_type}</Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {formatMinor(s.lines_total_minor, currencySymbol)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {formatMinor(s.extra_charges_minor, currencySymbol)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold">
                      {formatMinor(s.total_minor, currencySymbol)}
                    </td>
                    <td className="py-2.5 px-4 text-right text-[var(--text-secondary)]">
                      {s.refunded_minor != null
                        ? formatMinor(s.refunded_minor, currencySymbol, true)
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Export Weekly Stock Sheet Modal */}
      <Modal
        open={exportOpen}
        onOpenChange={setExportOpen}
        title="Export Weekly Stock Sheet (.xlsx)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={exporting}
              onClick={handleExportWeekly}
              tooltip="Write the Weekly Stock Sheet Excel workbook to the output path."
            >
              <Download className="h-4 w-4" />
              Export Excel
            </Button>
          </>
        }
      >
        <form onSubmit={handleExportWeekly}>
          <Field label="Output File Path" required>
            <Input
              autoFocus
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
