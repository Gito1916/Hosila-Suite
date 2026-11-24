import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ClipboardCheck,
  Plus,
  Save,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type AdjustmentDto_Serialize,
  type ItemListRowDto_Serialize,
  type StockCountDto_Serialize,
  type StockCountSummaryDto_Serialize,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { PinModal } from '../components/ui/PinModal';
import { EmptyState } from '../components/ui/StatCard';
import {
  cn,
  formatDateShort,
  formatMilli,
  formatMinor,
  parseQtyToMilli,
  todayIso,
} from '../lib/format';
import { getCompatibleUnits } from '../lib/domain';

const ADJUSTMENT_REASONS = [
  { id: 'spoilage', label: 'Spoilage (Loss)', sign: -1 },
  { id: 'wastage', label: 'Wastage (Loss)', sign: -1 },
  { id: 'damage', label: 'Damage (Loss)', sign: -1 },
  { id: 'expired', label: 'Expired (Loss)', sign: -1 },
  { id: 'found', label: 'Found Stock (Gain)', sign: 1 },
  { id: 'count_correction', label: 'Count Correction (+/-)', sign: 0 },
];

export function CountsAdjustmentsPage() {
  const { departments, units, currencySymbol, canWrite, isAdmin } = useApp();
  const [tab, setTab] = useState<'adjustments' | 'counts'>('adjustments');

  const [catalog, setCatalog] = useState<ItemListRowDto_Serialize[]>([]);

  // Adjustments state
  const [adjustments, setAdjustments] = useState<AdjustmentDto_Serialize[]>([]);
  const [adjOpen, setAdjOpen] = useState(false);
  const [adjReason, setAdjReason] = useState('spoilage');
  const [adjDate, setAdjDate] = useState(todayIso());
  const [adjNotes, setAdjNotes] = useState('');
  const [adjLines, setAdjLines] = useState<
    { item_id: string; unit_id: string; qty_str: string }[]
  >([]);
  const [adjSaving, setAdjSaving] = useState(false);
  const [pinFor, setPinFor] = useState<'adjustment' | 'count' | null>(null);

  // Stock Counts state
  const [counts, setCounts] = useState<StockCountSummaryDto_Serialize[]>([]);
  const [activeCount, setActiveCount] = useState<StockCountDto_Serialize | null>(null);
  const [countedEdits, setCountedEdits] = useState<Record<string, string>>({});
  const [startDeptId, setStartDeptId] = useState('');
  const [savingCount, setSavingCount] = useState(false);

  const loadAll = useCallback(async () => {
    const [catRes, adjRes, cntRes] = await Promise.all([
      commands.listItems({
        cost_missing_only: false,
        returnable_only: false,
        include_inactive: false,
      }),
      commands.listAdjustments(60),
      commands.listStockCounts(),
    ]);
    if (catRes.status === 'ok') setCatalog(catRes.data);
    if (adjRes.status === 'ok') setAdjustments(adjRes.data);
    if (cntRes.status === 'ok') setCounts(cntRes.data);
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  function buildCountLineUpdates(
    count: StockCountDto_Serialize,
    edits: Record<string, string>
  ) {
    return count.lines.map((l) => ({
      line_id: l.id,
      counted_qty_milli: edits[l.id]?.trim() ? parseQtyToMilli(edits[l.id]) : null,
    }));
  }

  async function submitAdjustment(managerPin: string | null): Promise<boolean> {
    const reasonMeta = ADJUSTMENT_REASONS.find((r) => r.id === adjReason);
    const lines = adjLines
      .filter((l) => l.item_id && parseQtyToMilli(l.qty_str) !== 0)
      .map((l) => {
        const raw = parseQtyToMilli(l.qty_str);
        const delta =
          reasonMeta?.sign === -1
            ? -Math.abs(raw)
            : reasonMeta?.sign === 1
              ? Math.abs(raw)
              : raw;
        return {
          item_id: l.item_id,
          unit_id: l.unit_id,
          delta_qty_milli: delta,
        };
      });

    if (!adjNotes.trim() || lines.length === 0) {
      toast.error('Provide audit notes and at least one item line.');
      return false;
    }

    setAdjSaving(true);
    try {
      const res = await commands.createAdjustment({
        reason: adjReason,
        notes: adjNotes.trim(),
        adjustment_date: adjDate,
        manager_pin: managerPin,
        lines,
      });
      if (res.status === 'error') {
        if (res.error.code === 'FORBIDDEN' && !isAdmin && !managerPin) {
          setPinFor('adjustment');
          return false;
        }
        toast.error(res.error.message);
        return false;
      }
      toast.success(`Posted stock adjustment ${res.data.number}`);
      setAdjOpen(false);
      setAdjLines([]);
      setAdjNotes('');
      await loadAll();
      return true;
    } finally {
      setAdjSaving(false);
    }
  }

  async function handleStartCount() {
    const res = await commands.startStockCount({
      department_ids: startDeptId ? [startDeptId] : [],
      store_section_ids: [],
    });
    if (res.status === 'error') {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Started stock count ${res.data.number}`);
    openCountSession(res.data);
    await loadAll();
  }

  function openCountSession(sc: StockCountDto_Serialize) {
    setActiveCount(sc);
    const map: Record<string, string> = {};
    for (const l of sc.lines) {
      map[l.id] = l.counted_qty_milli != null ? String(l.counted_qty_milli / 1000) : '';
    }
    setCountedEdits(map);
  }

  async function handleSelectCount(id: string) {
    const res = await commands.getStockCount(id);
    if (res.status === 'ok') openCountSession(res.data);
  }

  async function handleSaveCountDraft() {
    if (!activeCount) return;
    setSavingCount(true);
    try {
      const updates = buildCountLineUpdates(activeCount, countedEdits);
      const res = await commands.updateStockCountLines(activeCount.id, updates);
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      openCountSession(res.data);
      toast.success('Saved physical count progress');
      await loadAll();
    } finally {
      setSavingCount(false);
    }
  }

  async function submitPostCount(managerPin: string | null): Promise<boolean> {
    if (!activeCount) return false;
    setSavingCount(true);
    try {
      const updates = buildCountLineUpdates(activeCount, countedEdits);
      const updRes = await commands.updateStockCountLines(activeCount.id, updates);
      if (updRes.status === 'error') {
        toast.error(updRes.error.message);
        return false;
      }
      const res = await commands.postStockCount(activeCount.id, managerPin);
      if (res.status === 'error') {
        if (res.error.code === 'FORBIDDEN' && !isAdmin && !managerPin) {
          setPinFor('count');
          return false;
        }
        toast.error(res.error.message);
        return false;
      }
      openCountSession(res.data);
      toast.success(`Posted ${res.data.number} — inventory reconciled.`);
      await loadAll();
      return true;
    } finally {
      setSavingCount(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">
          Counts &amp; Adjustments
        </h1>

        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
          <button
            type="button"
            onClick={() => setTab('adjustments')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer',
              tab === 'adjustments'
                ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            Stock Adjustments
          </button>
          <button
            type="button"
            onClick={() => setTab('counts')}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer',
              tab === 'counts'
                ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                : 'text-[var(--text-secondary)]'
            )}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Physical Stock Counts
          </button>
        </div>
      </div>

      {/* TAB 1: ADJUSTMENTS */}
      {tab === 'adjustments' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWrite && (
              <Button
                variant="primary"
                tooltip="Record spoilage, wastage, damage, expired stock, or found items."
                onClick={() => {
                  const first = catalog[0];
                  setAdjReason('spoilage');
                  setAdjDate(todayIso());
                  setAdjNotes('');
                  setAdjLines(
                    first
                      ? [{ item_id: first.id, unit_id: first.base_unit_id, qty_str: '1' }]
                      : []
                  );
                  setAdjOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Record Adjustment
              </Button>
            )}
          </div>

          {adjustments.length === 0 ? (
            <EmptyState
              icon={<SlidersHorizontal className="h-5 w-5" />}
              title="No stock adjustments recorded"
              description="Log wastage, spoilage, expired items, or found stock with full audit notes."
            />
          ) : (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                    <th className="py-2.5 px-4">Number</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Reason</th>
                    <th className="py-2.5 px-3">Notes &amp; Items</th>
                    <th className="py-2.5 px-3">Posted By</th>
                    <th className="py-2.5 px-4 text-right">Value Impact</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {adjustments.map((a) => (
                    <tr key={a.id} className="hover:bg-[var(--bg-hover)]">
                      <td className="py-2.5 px-4 font-medium tabular-nums">{a.number}</td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)] tabular-nums">
                        {formatDateShort(a.adjustment_date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone={a.reason === 'found' ? 'accent' : 'warning'}>
                          {a.reason.replace('_', ' ')}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <div>{a.notes}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          {a.lines
                            .map(
                              (l) =>
                                `${l.item_name} (${l.base_qty_milli > 0 ? '+' : ''}${formatMilli(
                                  l.base_qty_milli
                                )} ${l.base_unit_code})`
                            )
                            .join(', ')}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                        {a.posted_by_name}
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-4 text-right tabular-nums font-semibold',
                          a.total_value_minor < 0
                            ? 'text-[var(--danger)]'
                            : 'text-[var(--accent-text)]'
                        )}
                      >
                        {formatMinor(a.total_value_minor, currencySymbol, true)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PHYSICAL STOCK COUNTS */}
      {tab === 'counts' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Sessions list */}
          <div className="lg:col-span-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            {canWrite && (
              <div className="space-y-2 pb-3 border-b border-[var(--border-subtle)]">
                <div className="text-[12px] font-semibold">Start New Physical Count</div>
                <div className="flex gap-2">
                  <Select
                    value={startDeptId}
                    onChange={(e) => setStartDeptId(e.target.value)}
                    className="h-8 text-[12px]"
                  >
                    <option value="">All Active Items</option>
                    {departments
                      .filter((d) => d.name.toLowerCase() !== 'store')
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                  </Select>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={handleStartCount}
                    tooltip="Snapshot current system balances and begin a physical stock count session."
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Start
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              {counts.length === 0 ? (
                <p className="text-[12px] text-[var(--text-muted)] py-6 text-center">
                  No stock count sessions yet.
                </p>
              ) : (
                counts.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => handleSelectCount(c.id)}
                    className={cn(
                      'w-full text-left p-3 rounded-xl border transition-all cursor-pointer',
                      activeCount?.id === c.id
                        ? 'border-[#6AD4B0] bg-[var(--accent-soft)]/50'
                        : 'border-[var(--border-subtle)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[12.5px] tabular-nums">{c.number}</span>
                      <Badge tone={c.status === 'posted' ? 'success' : 'warning'}>
                        {c.status}
                      </Badge>
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-1 tabular-nums flex justify-between">
                      <span>
                        {c.counted_lines}/{c.total_lines} counted
                      </span>
                      <span>
                        {formatMinor(c.net_variance_value_minor, currencySymbol, true)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Count Sheet */}
          <div className="lg:col-span-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            {!activeCount ? (
              <div className="p-10 text-center text-[13px] text-[var(--text-muted)]">
                Select a stock count session on the left or start a new one.
              </div>
            ) : (
              <>
                <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-[14.5px] font-semibold tabular-nums">
                        {activeCount.number}
                      </h2>
                      <Badge tone={activeCount.status === 'posted' ? 'success' : 'warning'}>
                        {activeCount.status}
                      </Badge>
                    </div>
                    <p className="text-[11.5px] text-[var(--text-muted)]">
                      Started by {activeCount.started_by_name}
                    </p>
                  </div>
                  {activeCount.status === 'draft' && canWrite && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={savingCount}
                        onClick={handleSaveCountDraft}
                        tooltip="Save your entered physical counts as a draft without adjusting inventory yet."
                      >
                        <Save className="h-3.5 w-3.5" />
                        Save Draft
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={savingCount}
                        onClick={() => submitPostCount(null)}
                        tooltip="Finalize this stock count and automatically reconcile any variances."
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Post &amp; Reconcile
                      </Button>
                    </div>
                  )}
                </div>

                <div className="max-h-[500px] overflow-y-auto">
                  <table className="w-full text-left border-collapse text-[13px]">
                    <thead className="sticky top-0 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                      <tr>
                        <th className="py-2.5 px-4">Item</th>
                        <th className="py-2.5 px-3 text-right">System Qty</th>
                        <th className="py-2.5 px-3 text-right w-[130px]">Counted Qty</th>
                        <th className="py-2.5 px-4 text-right">Variance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                      {activeCount.lines.map((l) => {
                        const rawEdit = countedEdits[l.id] ?? '';
                        const liveVar =
                          rawEdit.trim() !== ''
                            ? parseQtyToMilli(rawEdit) - l.system_qty_milli
                            : null;
                        return (
                          <tr key={l.id}>
                            <td className="py-2 px-4 font-medium">
                              {l.item_name}{' '}
                              <span className="text-[11px] text-[var(--text-muted)]">
                                ({l.base_unit_code})
                              </span>
                            </td>
                            <td className="py-2 px-3 text-right text-[var(--text-secondary)]">
                              {formatMilli(l.system_qty_milli)}
                            </td>
                            <td className="py-2 px-3 text-right">
                              <Input
                                value={rawEdit}
                                disabled={activeCount.status !== 'draft'}
                                onChange={(e) =>
                                  setCountedEdits((prev) => ({
                                    ...prev,
                                    [l.id]: e.target.value,
                                  }))
                                }
                                placeholder="—"
                                className="h-8 text-right tabular-nums"
                              />
                            </td>
                            <td
                              className={cn(
                                'py-2 px-4 text-right font-medium',
                                liveVar == null
                                  ? 'text-[var(--text-muted)]'
                                  : liveVar < 0
                                    ? 'text-[var(--danger)]'
                                    : liveVar > 0
                                      ? 'text-[var(--accent-text)]'
                                      : 'text-[var(--text-secondary)]'
                              )}
                            >
                              {liveVar == null
                                ? '—'
                                : `${liveVar > 0 ? '+' : ''}${formatMilli(liveVar)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* New Adjustment Modal */}
      <Modal
        open={adjOpen}
        onOpenChange={setAdjOpen}
        title="Record Stock Adjustment"
        maxWidth="max-w-xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdjOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={adjSaving}
              onClick={() => submitAdjustment(null)}
              tooltip="Post this stock adjustment to the inventory ledger."
            >
              Post Adjustment
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Reason" required>
              <Select value={adjReason} onChange={(e) => setAdjReason(e.target.value)}>
                {ADJUSTMENT_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={adjDate}
                onChange={(e) => setAdjDate(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>

          <Field label="Mandatory Audit Notes" required>
            <Input
              value={adjNotes}
              onChange={(e) => setAdjNotes(e.target.value)}
              placeholder="Explain what happened..."
            />
          </Field>

          <div className="space-y-2">
            <div className="flex items-center justify-between text-[12px] font-medium">
              <span>Items</span>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const first = catalog[0];
                  if (!first) return;
                  setAdjLines([
                    ...adjLines,
                    { item_id: first.id, unit_id: first.base_unit_id, qty_str: '1' },
                  ]);
                }}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Item
              </Button>
            </div>
            {adjLines.map((l, idx) => {
              const itemObj = catalog.find((c) => c.id === l.item_id);
              const compatibleUnits = itemObj ? getCompatibleUnits(itemObj, units) : units;
              return (
              <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-6">
                  <Select
                    value={l.item_id}
                    onChange={(e) => {
                      const it = catalog.find((c) => c.id === e.target.value);
                      const next = [...adjLines];
                      next[idx] = {
                        ...l,
                        item_id: e.target.value,
                        unit_id: it?.base_unit_id ?? l.unit_id,
                      };
                      setAdjLines(next);
                    }}
                    className="h-8 text-[12px]"
                  >
                    {catalog.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({formatMilli(c.on_hand_milli)} {c.base_unit_code})
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-3">
                  <Select
                    value={l.unit_id}
                    onChange={(e) => {
                      const next = [...adjLines];
                      next[idx] = { ...l, unit_id: e.target.value };
                      setAdjLines(next);
                    }}
                    className="h-8 text-[12px]"
                  >
                    {compatibleUnits.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="col-span-2">
                  <Input
                    value={l.qty_str}
                    onChange={(e) => {
                      const next = [...adjLines];
                      next[idx] = { ...l, qty_str: e.target.value };
                      setAdjLines(next);
                    }}
                    className="h-8 text-right tabular-nums"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => setAdjLines(adjLines.filter((_, i) => i !== idx))}
                  className="col-span-1 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
              );
            })}
          </div>
        </div>
      </Modal>

      <PinModal
        open={Boolean(pinFor)}
        onOpenChange={(o) => {
          if (!o) setPinFor(null);
        }}
        title="Manager PIN Required"
        description="This variance value meets or exceeds the manager approval threshold."
        onConfirm={async (pin) => {
          if (pinFor === 'adjustment') return submitAdjustment(pin);
          if (pinFor === 'count') return submitPostCount(pin);
          return true;
        }}
      />
    </div>
  );
}
