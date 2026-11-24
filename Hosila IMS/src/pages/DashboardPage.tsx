import { useCallback, useEffect, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowRightLeft,
  ArrowUpRight,
  Package,
  RefreshCw,
  RotateCcw,
  ShoppingCart,
  Wallet,
} from 'lucide-react';
import {
  commands,
  type ActivityLogDto_Serialize,
  type DailyConsumptionPoint,
  type DashboardKpisDto,
  type DepartmentConsumptionPoint,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { StatCard } from '../components/ui/StatCard';
import {
  cn,
  daysAgoIso,
  formatDateShort,
  formatDateTime,
  formatMinor,
  todayIso,
} from '../lib/format';

const ACTIVITY_FILTERS = [
  { id: '', label: 'All Activity' },
  { id: 'collection.', label: 'Collections' },
  { id: 'receipt.', label: 'Receipts' },
  { id: 'import.', label: 'Imports' },
  { id: 'item.', label: 'Catalog' },
  { id: 'adjustment.', label: 'Adjustments' },
];

function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const parts = isoDate.slice(0, 10).split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return daysAgoIso(-deltaDays);
  }
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + deltaDays);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function DashboardPage() {
  const { currencySymbol, setActiveRoute, navigateToInventoryWithFilter } = useApp();
  const [asOfDate, setAsOfDate] = useState(todayIso());
  const [kpis, setKpis] = useState<DashboardKpisDto | null>(null);
  const [deptSeries, setDeptSeries] = useState<DepartmentConsumptionPoint[]>([]);
  const [dailySeries, setDailySeries] = useState<DailyConsumptionPoint[]>([]);
  const [activity, setActivity] = useState<ActivityLogDto_Serialize[]>([]);
  const [activityPrefix, setActivityPrefix] = useState('');
  const [loading, setLoading] = useState(true);
  const [hoveredDay, setHoveredDay] = useState<DailyConsumptionPoint | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [kRes, dRes, sRes, aRes] = await Promise.all([
        commands.getDashboardKpis(asOfDate),
        commands.getConsumptionByDepartment(shiftIsoDate(asOfDate, -6), asOfDate),
        commands.getDailyConsumptionSeries(14, asOfDate),
        commands.listActivityLog({
          action_prefix: activityPrefix || null,
          limit: 40,
        }),
      ]);
      if (kRes.status === 'ok') setKpis(kRes.data);
      if (dRes.status === 'ok') setDeptSeries(dRes.data);
      if (sRes.status === 'ok') setDailySeries(sRes.data);
      if (aRes.status === 'ok') setActivity(aRes.data);
    } finally {
      setLoading(false);
    }
  }, [asOfDate, activityPrefix]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const maxDailyVal = Math.max(
    1,
    ...dailySeries.flatMap((d) => [d.consumed_minor, d.received_minor])
  );
  const maxDeptVal = Math.max(1, ...deptSeries.map((d) => d.consumed_minor));

  return (
    <div className="space-y-5">
      {/* Page Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Dashboard</h1>
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="h-9 rounded-xl border border-ink/15 bg-canvas px-3 text-xs font-mono tabular-nums text-ink"
          />
          <Button
            variant="secondary"
            size="icon"
            onClick={loadData}
            tooltip="Refresh dashboard KPIs, charts, and activity log."
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
          <Button
            variant="secondary"
            onClick={() => setActiveRoute('procurement')}
            tooltip="Open Procurement Lists and Excel Restock parser."
          >
            <ShoppingCart className="h-4 w-4" />
            Procurement
          </Button>
          <Button
            variant="primary"
            onClick={() => setActiveRoute('collect')}
            tooltip="Open Stock Collection to issue items to a department."
          >
            <ArrowRightLeft className="h-4 w-4" />
            Collect Stock
          </Button>
        </div>
      </div>

      {/* Primary KPI Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Inventory Value"
          value={kpis ? formatMinor(kpis.total_inventory_value_minor, currencySymbol) : '—'}
          sublabel={kpis ? `${kpis.total_active_items} active catalog items` : 'Loading...'}
          icon={<Wallet className="h-4 w-4" />}
          tone="accent"
          onClick={() => navigateToInventoryWithFilter('')}
        />
        <StatCard
          label={`Consumed (${formatDateShort(asOfDate)})`}
          value={kpis ? formatMinor(kpis.consumed_today_minor, currencySymbol) : '—'}
          sublabel="Net department issues"
          icon={<ArrowUpRight className="h-4 w-4" />}
          onClick={() => setActiveRoute('collect')}
        />
        <StatCard
          label={`Restocked (${formatDateShort(asOfDate)})`}
          value={kpis ? formatMinor(kpis.received_today_minor, currencySymbol) : '—'}
          sublabel="Posted goods receipts"
          icon={<ArrowDownLeft className="h-4 w-4" />}
          onClick={() => setActiveRoute('procurement')}
        />
        <StatCard
          label="Low & Out of Stock"
          value={kpis ? `${kpis.low_stock_count + kpis.out_of_stock_count}` : '—'}
          sublabel={
            kpis
              ? `${kpis.low_stock_count} low · ${kpis.out_of_stock_count} out of stock`
              : 'Loading...'
          }
          icon={<Package className="h-4 w-4" />}
          tone={
            kpis && kpis.out_of_stock_count > 0
              ? 'danger'
              : kpis && kpis.low_stock_count > 0
                ? 'warning'
                : 'default'
          }
          onClick={() =>
            navigateToInventoryWithFilter(
              kpis && kpis.out_of_stock_count > 0 && kpis.low_stock_count === 0
                ? 'out_of_stock'
                : 'low_stock'
            )
          }
        />
      </div>

      {/* Attention Pills Strip */}
      {kpis &&
        (kpis.cost_missing_count > 0 ||
          kpis.outstanding_returns_count > 0 ||
          kpis.open_procurement_lists_count > 0) && (
          <div className="flex flex-wrap items-center gap-2.5">
            {kpis.cost_missing_count > 0 && (
              <button
                type="button"
                onClick={() => navigateToInventoryWithFilter('cost_missing')}
                className="inline-flex items-center gap-2 rounded-xl border border-[#E05252]/30 bg-[#E05252]/[0.07] px-3 py-1.5 text-xs font-medium text-danger-ink cursor-pointer hover:opacity-90 transition-opacity"
              >
                <AlertCircle className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">{kpis.cost_missing_count}</span> items missing unit
                cost
              </button>
            )}
            {kpis.outstanding_returns_count > 0 && (
              <button
                type="button"
                onClick={() => setActiveRoute('collect')}
                className="inline-flex items-center gap-2 rounded-xl border border-[#6AD4B0]/40 bg-[#6AD4B0]/14 px-3 py-1.5 text-xs font-medium text-accent-ink cursor-pointer hover:opacity-90 transition-opacity"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">{kpis.outstanding_returns_count}</span> returnable
                items currently out
              </button>
            )}
            {kpis.open_procurement_lists_count > 0 && (
              <button
                type="button"
                onClick={() => setActiveRoute('procurement')}
                className="inline-flex items-center gap-2 rounded-xl border border-ink/12 bg-surface px-3 py-1.5 text-xs font-medium text-ink/65 cursor-pointer hover:border-ink/20 transition-colors"
              >
                <ShoppingCart className="h-3.5 w-3.5" />
                <span className="font-mono tabular-nums">{kpis.open_procurement_lists_count}</span> open
                procurement list{kpis.open_procurement_lists_count === 1 ? '' : 's'}
              </button>
            )}
          </div>
        )}

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 14-day Consumed vs Received */}
        <div className="lg:col-span-2 rounded-2xl border border-ink/10 bg-surface p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-ink">
              14-Day Stock Flow
            </h2>
            <div className="flex items-center gap-4 text-xs text-ink/60">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-[#6AD4B0]" />
                Received
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-xs bg-ink/40" />
                Consumed
              </span>
            </div>
          </div>

          <div className="h-[180px] flex items-end gap-1.5 pt-3 pb-1">
            {dailySeries.map((pt) => {
              const recH = Math.max(
                pt.received_minor > 0 ? 4 : 0,
                Math.round((pt.received_minor / maxDailyVal) * 136)
              );
              const conH = Math.max(
                pt.consumed_minor > 0 ? 4 : 0,
                Math.round((pt.consumed_minor / maxDailyVal) * 136)
              );
              return (
                <div
                  key={pt.date}
                  onMouseEnter={() => setHoveredDay(pt)}
                  onMouseLeave={() => setHoveredDay(null)}
                  className="flex-1 flex flex-col items-center gap-1.5 group cursor-default"
                >
                  <div className="h-[140px] w-full flex items-end justify-center gap-[3px] rounded-md px-0.5 group-hover:bg-ink/[0.04] transition-colors">
                    <div
                      style={{ height: `${recH}px` }}
                      className="w-2.5 rounded-t bg-[#6AD4B0] transition-all duration-200"
                    />
                    <div
                      style={{ height: `${conH}px` }}
                      className="w-2.5 rounded-t bg-ink/40 transition-all duration-200"
                    />
                  </div>
                  <span className="text-[10.5px] text-ink/50 font-mono tabular-nums">
                    {pt.date.slice(8, 10)}
                  </span>
                </div>
              );
            })}
          </div>

          {hoveredDay && (
            <div className="mt-2 pt-2 border-t border-ink/10 flex items-center justify-between text-xs text-ink/65 font-mono tabular-nums">
              <span className="font-sans font-medium text-ink">
                {formatDateShort(hoveredDay.date)}
              </span>
              <div className="flex items-center gap-4">
                <span>
                  Received:{' '}
                  <strong className="text-accent-ink">
                    {formatMinor(hoveredDay.received_minor, currencySymbol)}
                  </strong>
                </span>
                <span>
                  Consumed:{' '}
                  <strong className="text-ink">
                    {formatMinor(hoveredDay.consumed_minor, currencySymbol)}
                  </strong>
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Consumption by Department (Last 7 Days) */}
        <div className="rounded-2xl border border-ink/10 bg-surface p-4 flex flex-col">
          <div className="mb-3">
            <h2 className="text-sm font-semibold text-ink">
              7-Day Department Usage
            </h2>
          </div>
          <div className="space-y-3 flex-1">
            {deptSeries.length === 0 ? (
              <p className="text-xs text-ink/50 py-8 text-center">
                No department collections recorded in the last 7 days.
              </p>
            ) : (
              deptSeries.map((d) => {
                const pct = Math.round((d.consumed_minor / maxDeptVal) * 100);
                return (
                  <div key={d.department_id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium flex items-center gap-2 truncate text-ink">
                        <span className="h-2 w-2 rounded-full shrink-0 bg-[#6AD4B0]" />
                        {d.department_name}
                      </span>
                      <span className="font-mono tabular-nums font-medium text-ink">
                        {formatMinor(d.consumed_minor, currencySymbol)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-ink/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[#6AD4B0] transition-all duration-300"
                        style={{
                          width: `${Math.max(d.consumed_minor > 0 ? 4 : 0, pct)}%`,
                        }}
                      />
                    </div>
                    <div className="text-[11px] text-ink/50 font-mono tabular-nums">
                      {d.issue_count} issue{d.issue_count === 1 ? '' : 's'}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* Live Audit Activity Feed */}
      <div className="rounded-2xl border border-ink/10 bg-surface overflow-hidden">
        <div className="px-4 py-3 border-b border-ink/10 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-accent-ink" />
            <h2 className="text-sm font-semibold text-ink">Recent Activity Log</h2>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {ACTIVITY_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setActivityPrefix(f.id)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer',
                  activityPrefix === f.id
                    ? 'bg-[#6AD4B0]/14 text-accent-ink'
                    : 'text-ink/60 hover:bg-ink/[0.04]'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-ink/8">
          {activity.length === 0 ? (
            <div className="px-5 py-8 text-center text-xs text-ink/50">
              No activity entries match this filter yet.
            </div>
          ) : (
            activity.map((entry) => (
              <div
                key={entry.id}
                className="px-4 py-2.5 flex items-center justify-between gap-4 hover:bg-ink/[0.03] transition-colors"
              >
                <div className="min-w-0 flex items-center gap-3">
                  <Badge
                    tone={
                      entry.action.startsWith('collection')
                        ? 'info'
                        : entry.action.startsWith('receipt') || entry.action.startsWith('import')
                          ? 'accent'
                          : entry.action.includes('reversed') || entry.action.startsWith('adjustment')
                            ? 'danger'
                            : 'neutral'
                    }
                  >
                    {entry.action}
                  </Badge>
                  <span className="text-xs text-ink truncate">
                    {entry.summary}
                  </span>
                </div>
                <div className="shrink-0 flex items-center gap-3 text-[11.5px] text-ink/50 font-mono tabular-nums">
                  {entry.user_name && <span className="font-sans">{entry.user_name}</span>}
                  <span>{formatDateTime(entry.at)}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
