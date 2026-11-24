import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  History,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Undo2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type CollectionDto_Serialize,
  type CollectionValidationDto_Serialize,
  type ItemListRowDto_Serialize,
  type OutstandingReturnDto,
  type StaffDto_Serialize,
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
  daysAgoIso,
  formatDateShort,
  formatMilli,
  formatMinor,
  parseQtyToMilli,
  todayIso,
} from '../lib/format';
import { filterActiveStoreStaff, filterIssueDepartments } from '../lib/domain';

interface CartLine {
  item: ItemListRowDto_Serialize;
  unit_id: string;
  qty_str: string;
}

export function CollectionPage() {
  const { departments, staff, settings, currencySymbol, canWrite, isAdmin } = useApp();

  const [tab, setTab] = useState<'issue' | 'history' | 'returns'>('issue');

  // Issue Stock State
  const issueDepts = useMemo(() => filterIssueDepartments(departments), [departments]);
  const storeStaff = useMemo(() => filterActiveStoreStaff(staff), [staff]);

  const [selectedDeptId, setSelectedDeptId] = useState('');
  const [deptStaff, setDeptStaff] = useState<StaffDto_Serialize[]>([]);
  const [deptItems, setDeptItems] = useState<ItemListRowDto_Serialize[]>([]);
  const [collectorId, setCollectorId] = useState('');
  const [storekeeperId, setStorekeeperId] = useState('');
  const [collectionDate, setCollectionDate] = useState(todayIso());
  const [notes, setNotes] = useState('');
  const [itemSearch, setItemSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [validation, setValidation] = useState<CollectionValidationDto_Serialize | null>(null);
  const [posting, setPosting] = useState(false);

  // History State
  const [history, setHistory] = useState<CollectionDto_Serialize[]>([]);
  const [histStart, setHistStart] = useState(daysAgoIso(14));
  const [histEnd, setHistEnd] = useState(todayIso());
  const [histDeptId, setHistDeptId] = useState('');
  const [reversingCol, setReversingCol] = useState<CollectionDto_Serialize | null>(null);
  const [reverseReason, setReverseReason] = useState('');
  const [pinMode, setPinMode] = useState<'issue' | 'reverse' | null>(null);

  // Returnables State
  const [returnsList, setReturnsList] = useState<OutstandingReturnDto[]>([]);
  const [returnTarget, setReturnTarget] = useState<OutstandingReturnDto | null>(null);
  const [retGood, setRetGood] = useState('');
  const [retDamaged, setRetDamaged] = useState('0');
  const [retNotes, setRetNotes] = useState('');
  const [returning, setReturning] = useState(false);

  // Initialize defaults
  useEffect(() => {
    if (!selectedDeptId && issueDepts.length > 0) {
      setSelectedDeptId(issueDepts[0].id);
    }
    if (!storekeeperId && storeStaff.length > 0) {
      setStorekeeperId(storeStaff[0].id);
    }
  }, [issueDepts, storeStaff, selectedDeptId, storekeeperId]);

  // Load department-scoped items and collectors
  const loadDeptResources = useCallback(async () => {
    if (!selectedDeptId) return;
    const [stRes, itRes] = await Promise.all([
      commands.listStaff({
        department_id: selectedDeptId,
        store_staff_only: false,
        include_inactive: false,
      }),
      commands.listItems({
        department_id: selectedDeptId,
        cost_missing_only: false,
        returnable_only: false,
        include_inactive: false,
      }),
    ]);
    if (stRes.status === 'ok') {
      setDeptStaff(stRes.data);
      setCollectorId((prev) =>
        stRes.data.some((s) => s.id === prev) ? prev : (stRes.data[0]?.id ?? '')
      );
    }
    if (itRes.status === 'ok') {
      setDeptItems(itRes.data);
    }
  }, [selectedDeptId]);

  useEffect(() => {
    loadDeptResources();
  }, [loadDeptResources]);

  // Live dry-run validation on cart changes
  useEffect(() => {
    let active = true;
    async function runValidation() {
      if (!selectedDeptId || cart.length === 0) {
        setValidation(null);
        return;
      }
      const lines = cart
        .map((c) => ({
          item_id: c.item.id,
          unit_id: c.unit_id,
          quantity_milli: parseQtyToMilli(c.qty_str),
        }))
        .filter((l) => l.quantity_milli > 0);
      if (lines.length === 0) {
        setValidation(null);
        return;
      }
      const res = await commands.validateCollection({
        department_id: selectedDeptId,
        collector_staff_id: collectorId || 'dry-run',
        storekeeper_staff_id: storekeeperId || 'dry-run',
        collection_date: collectionDate,
        notes: null,
        storekeeper_pin: null,
        lines,
      });
      if (!active) return;
      if (res.status === 'ok') {
        setValidation(res.data);
      } else {
        setValidation(null);
      }
    }
    const t = setTimeout(runValidation, 120);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [cart, selectedDeptId, collectorId, storekeeperId, collectionDate]);

  const loadHistory = useCallback(async () => {
    const res = await commands.listCollections({
      department_id: histDeptId || null,
      start_date: histStart || null,
      end_date: histEnd || null,
      limit: 100,
    });
    if (res.status === 'ok') setHistory(res.data);
  }, [histDeptId, histStart, histEnd]);

  const loadReturns = useCallback(async () => {
    const res = await commands.listOutstandingReturns(null, null);
    if (res.status === 'ok') setReturnsList(res.data);
  }, []);

  useEffect(() => {
    loadReturns();
  }, [loadReturns]);

  useEffect(() => {
    if (tab === 'history') loadHistory();
    if (tab === 'returns') loadReturns();
  }, [tab, loadHistory, loadReturns]);

  function addItemToCart(item: ItemListRowDto_Serialize) {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id);
      if (existing) {
        const nextQty = (parseQtyToMilli(existing.qty_str) + 1000) / 1000;
        return prev.map((c) =>
          c.item.id === item.id ? { ...c, qty_str: String(nextQty) } : c
        );
      }
      return [
        ...prev,
        {
          item,
          unit_id: item.default_issue_unit_id || item.base_unit_id,
          qty_str: '1',
        },
      ];
    });
  }

  async function submitPostCollection(storekeeperPin: string | null): Promise<boolean> {
    if (!selectedDeptId || !collectorId || !storekeeperId) {
      toast.error('Select department, collector, and approving storekeeper.');
      return false;
    }
    const lines = cart
      .map((c) => ({
        item_id: c.item.id,
        unit_id: c.unit_id,
        quantity_milli: parseQtyToMilli(c.qty_str),
      }))
      .filter((l) => l.quantity_milli > 0);
    if (lines.length === 0) {
      toast.error('Add at least one item with quantity greater than 0.');
      return false;
    }

    setPosting(true);
    try {
      const res = await commands.createCollection({
        department_id: selectedDeptId,
        collector_staff_id: collectorId,
        storekeeper_staff_id: storekeeperId,
        collection_date: collectionDate,
        notes: notes.trim() || null,
        storekeeper_pin: storekeeperPin,
        lines,
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return false;
      }
      toast.success(
        `Posted ${res.data.number} (${res.data.lines.length} items · ${formatMinor(
          res.data.total_value_minor,
          currencySymbol
        )})`
      );
      setCart([]);
      setValidation(null);
      setNotes('');
      await Promise.all([loadDeptResources(), loadReturns()]);
      return true;
    } finally {
      setPosting(false);
    }
  }

  function handlePostCollection() {
    if (!selectedDeptId || !collectorId || !storekeeperId) {
      toast.error('Select department, collector, and approving storekeeper.');
      return;
    }
    const hasPositiveQty = cart.some((c) => parseQtyToMilli(c.qty_str) > 0);
    if (!hasPositiveQty) {
      toast.error('Add at least one item with quantity greater than 0.');
      return;
    }
    if (settings?.inventory_rules.require_storekeeper_pin_on_issue) {
      setPinMode('issue');
      return;
    }
    void submitPostCollection(null);
  }

  async function executeReverse(pin: string | null): Promise<boolean> {
    if (!reversingCol) return true;
    const res = await commands.reverseCollection(reversingCol.id, reverseReason.trim(), pin);
    if (res.status === 'error') {
      toast.error(res.error.message);
      return false;
    }
    toast.success(`Reversed ${res.data.number} — stock restored.`);
    setReversingCol(null);
    setReverseReason('');
    await Promise.all([loadHistory(), loadDeptResources(), loadReturns()]);
    return true;
  }

  async function handleRecordReturn(e: React.FormEvent) {
    e.preventDefault();
    if (!returnTarget) return;
    setReturning(true);
    try {
      const res = await commands.recordReturn({
        collection_line_id: returnTarget.collection_line_id,
        returned_qty_milli: parseQtyToMilli(retGood),
        damaged_qty_milli: parseQtyToMilli(retDamaged),
        return_date: todayIso(),
        storekeeper_staff_id: storekeeperId || storeStaff[0]?.id || '',
        notes: retNotes.trim() || null,
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Return recorded for ${returnTarget.item_name}`);
      setReturnTarget(null);
      await Promise.all([loadReturns(), loadDeptResources()]);
    } finally {
      setReturning(false);
    }
  }

  const filteredItems = useMemo(() => {
    const q = itemSearch.trim().toLowerCase();
    if (!q) return deptItems;
    return deptItems.filter(
      (i) => i.name.toLowerCase().includes(q) || i.sku.toLowerCase().includes(q)
    );
  }, [deptItems, itemSearch]);

  const validationByCartIdx = useMemo(() => {
    const map = new Map<number, NonNullable<typeof validation>['lines'][number]>();
    if (!validation) return map;
    const validCartIndices: number[] = [];
    cart.forEach((c, idx) => {
      if (parseQtyToMilli(c.qty_str) > 0) validCartIndices.push(idx);
    });
    validation.lines.forEach((vl, vIdx) => {
      const cartIdx = validCartIndices[vIdx];
      if (cartIdx !== undefined) {
        map.set(cartIdx, vl);
      }
    });
    return map;
  }, [cart, validation]);

  const hasValidationError = Boolean(validation && !validation.valid);

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">Stock Collection</h1>

        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)]">
          {(
            [
              { id: 'issue', label: 'Issue Stock', icon: ArrowRightLeft },
              { id: 'history', label: 'History', icon: History },
              {
                id: 'returns',
                label: `Returnables${returnsList.length > 0 ? ` (${returnsList.length})` : ''}`,
                icon: RotateCcw,
              },
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

      {/* TAB 1: ISSUE STOCK */}
      {tab === 'issue' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          {/* Left: Department + Catalog Picker */}
          <div className="lg:col-span-5 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <div>
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)] mb-2">
                1. Collecting Department
              </div>
              <div className="flex flex-wrap gap-1.5">
                {issueDepts.map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => {
                      if (d.id !== selectedDeptId) {
                        setSelectedDeptId(d.id);
                        setCart([]);
                        setValidation(null);
                      }
                    }}
                    className={cn(
                      'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium border transition-all cursor-pointer',
                      selectedDeptId === d.id
                        ? 'border-[#6AD4B0] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: d.color || '#6AD4B0' }}
                    />
                    {d.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="relative">
              <Search className="h-4 w-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                value={itemSearch}
                onChange={(e) => setItemSearch(e.target.value)}
                placeholder="Filter department items..."
                className="pl-9"
              />
            </div>

            <div className="max-h-[460px] overflow-y-auto divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {filteredItems.length === 0 ? (
                <div className="py-10 text-center text-[12.5px] text-[var(--text-muted)]">
                  No items assigned to this department.
                </div>
              ) : (
                filteredItems.map((item) => {
                  const inCart = cart.some((c) => c.item.id === item.id);
                  const out = item.on_hand_milli <= 0;
                  const primaryConv = item.item_units[0];
                  return (
                    <button
                      key={item.id}
                      type="button"
                      disabled={out || !canWrite}
                      onClick={() => addItemToCart(item)}
                      className={cn(
                        'w-full px-3.5 py-2.5 flex items-center justify-between gap-2 text-left transition-colors',
                        out
                          ? 'opacity-45 cursor-not-allowed'
                          : 'hover:bg-[var(--bg-hover)] cursor-pointer',
                        inCart && 'bg-[var(--accent-soft)]/45'
                      )}
                    >
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium truncate flex items-center gap-1.5">
                          {item.name}
                          {item.store_section_name && (
                            <Badge tone="info">{item.store_section_name}</Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
                          Available: {item.display_stock}
                          {primaryConv && primaryConv.unit_id !== item.base_unit_id && (
                            <span>
                              {' '}
                              · Collect in {item.base_unit_code} or {primaryConv.unit_code}
                            </span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0">
                        {out ? (
                          <Badge tone="danger">Out</Badge>
                        ) : (
                          <span className="inline-flex items-center justify-center h-7 w-7 rounded-lg bg-[var(--bg-subtle)] text-[var(--text-primary)]">
                            <Plus className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Right: Sign-off Details & Live Validated Basket */}
          <div className="lg:col-span-7 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Collector (Dept Staff)" required>
                <Select value={collectorId} onChange={(e) => setCollectorId(e.target.value)}>
                  {deptStaff.length === 0 && <option value="">Add staff in Settings</option>}
                  {deptStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Approving Storekeeper" required>
                <Select value={storekeeperId} onChange={(e) => setStorekeeperId(e.target.value)}>
                  {storeStaff.length === 0 && <option value="">Add store staff</option>}
                  {storeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.full_name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Collection Date" required>
                <Input
                  type="date"
                  value={collectionDate}
                  onChange={(e) => setCollectionDate(e.target.value)}
                  className="tabular-nums"
                />
              </Field>
            </div>

            {/* Cart Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                  2. Selected Items ({cart.length})
                </span>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setCart([]);
                      setValidation(null);
                    }}
                    className="text-[12px] text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                  >
                    Clear basket
                  </button>
                )}
              </div>

              {cart.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--border-subtle)] py-12 px-4 text-center text-[13px] text-[var(--text-muted)]">
                  Click items on the left to build a collection slip.
                </div>
              ) : (
                <div className="divide-y divide-[var(--border-subtle)] rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  {cart.map((line, idx) => {
                    const valLine = validationByCartIdx.get(idx);
                    const unitOptions = [
                      {
                        id: line.item.base_unit_id,
                        code: `${line.item.base_unit_code} (Collection)`,
                      },
                      ...line.item.item_units
                        .filter((u) => u.can_issue)
                        .map((u) => ({
                          id: u.unit_id,
                          code: `${u.unit_code} (1 = ${u.factor_milli / 1000} ${line.item.base_unit_code})`,
                        })),
                    ];
                    return (
                      <div key={line.item.id} className="p-3 space-y-1.5">
                        <div className="grid grid-cols-12 gap-2.5 items-center">
                          <div className="col-span-5 min-w-0">
                            <div className="text-[13px] font-medium truncate">
                              {line.item.name}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
                              In stock: {line.item.display_stock}
                              {valLine && !valLine.error && (
                                <span className="ml-2 text-[var(--accent-text)]">
                                  → {formatMilli(valLine.remaining_after_milli)}{' '}
                                  {line.item.base_unit_code} left
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="col-span-3">
                            <Select
                              value={line.unit_id}
                              onChange={(e) => {
                                const next = [...cart];
                                next[idx] = { ...line, unit_id: e.target.value };
                                setCart(next);
                              }}
                              className="h-8 text-[12px]"
                            >
                              {unitOptions.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.code}
                                </option>
                              ))}
                            </Select>
                          </div>
                          <div className="col-span-2">
                            <Input
                              value={line.qty_str}
                              onChange={(e) => {
                                const next = [...cart];
                                next[idx] = { ...line, qty_str: e.target.value };
                                setCart(next);
                              }}
                              className={cn(
                                'h-8 text-right tabular-nums',
                                valLine?.error && 'border-[var(--danger)]'
                              )}
                            />
                          </div>
                          <div className="col-span-2 flex items-center justify-end gap-2">
                            <span className="text-[12px] font-medium tabular-nums">
                              {valLine
                                ? formatMinor(valLine.line_value_minor, currencySymbol)
                                : '—'}
                            </span>
                            <button
                              type="button"
                              onClick={() => setCart(cart.filter((_, i) => i !== idx))}
                              className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </div>

                        {valLine?.error && (
                          <div className="flex items-center gap-1.5 rounded-lg bg-[var(--danger-soft)] px-2.5 py-1.5 text-[12px] text-[var(--danger)] font-medium">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            {valLine.error}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <Field label="Notes">
              <Input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Morning breakfast prep / Banquet service"
              />
            </Field>

            <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] text-[var(--text-muted)]">Estimated Issue Value</div>
                <div className="text-[18px] font-semibold tabular-nums text-[var(--text-primary)]">
                  {formatMinor(validation?.total_value_minor ?? 0, currencySymbol)}
                </div>
              </div>
              <Button
                variant="primary"
                size="lg"
                loading={posting}
                disabled={
                  !canWrite ||
                  cart.length === 0 ||
                  hasValidationError ||
                  !collectorId ||
                  !storekeeperId
                }
                onClick={handlePostCollection}
                tooltip="Deduct these items from store inventory and record the signed collection slip."
              >
                <CheckCircle2 className="h-4 w-4" />
                Confirm &amp; Post Collection
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: COLLECTION HISTORY */}
      {tab === 'history' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5">
            <Input
              type="date"
              value={histStart}
              onChange={(e) => setHistStart(e.target.value)}
              className="w-[155px] tabular-nums"
            />
            <span className="text-[12px] text-[var(--text-muted)]">to</span>
            <Input
              type="date"
              value={histEnd}
              onChange={(e) => setHistEnd(e.target.value)}
              className="w-[155px] tabular-nums"
            />
            <Select
              value={histDeptId}
              onChange={(e) => setHistDeptId(e.target.value)}
              className="w-[180px]"
            >
              <option value="">All Departments</option>
              {issueDepts.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </div>

          {history.length === 0 ? (
            <EmptyState
              icon={<History className="h-5 w-5" />}
              title="No collections in this period"
              description="Posted stock issues will appear here with collector, storekeeper, and valuation details."
            />
          ) : (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                    <th className="py-2.5 px-4">Number</th>
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Department</th>
                    <th className="py-2.5 px-3">Collector / Storekeeper</th>
                    <th className="py-2.5 px-3 text-right">Items</th>
                    <th className="py-2.5 px-3 text-right">Value</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {history.map((c) => (
                    <tr key={c.id} className="hover:bg-[var(--bg-hover)]">
                      <td className="py-2.5 px-4 font-medium tabular-nums">{c.number}</td>
                      <td className="py-2.5 px-3 text-[var(--text-secondary)] tabular-nums">
                        {formatDateShort(c.collection_date)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone="neutral">{c.department_name}</Badge>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="font-medium">{c.collector_name}</div>
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Approved by {c.storekeeper_name}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{c.lines.length}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {formatMinor(c.total_value_minor, currencySymbol)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone={c.status === 'posted' ? 'success' : 'danger'}>
                          {c.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {c.status === 'posted' && canWrite && (
                          <Button
                            variant="ghost"
                            size="sm"
                            tooltip="Reverse this collection slip and return its items to stock."
                            onClick={() => {
                              setReversingCol(c);
                              setReverseReason('');
                            }}
                          >
                            <Undo2 className="h-3.5 w-3.5" />
                            Reverse
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: RETURNABLES TRACKER */}
      {tab === 'returns' &&
        (returnsList.length === 0 ? (
          <EmptyState
            icon={<RotateCcw className="h-5 w-5" />}
            title="All returnable items accounted for"
            description="Items marked Returnable that are checked out will be tracked here until returned."
          />
        ) : (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-3">Slip #</th>
                  <th className="py-2.5 px-3">Collector</th>
                  <th className="py-2.5 px-3">Issued Date</th>
                  <th className="py-2.5 px-3 text-right">Outstanding</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {returnsList.map((r) => (
                  <tr key={r.collection_line_id} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 px-4 font-medium">{r.item_name}</td>
                    <td className="py-2.5 px-3 tabular-nums text-[var(--text-secondary)]">
                      {r.collection_number}
                    </td>
                    <td className="py-2.5 px-3">
                      {r.collector_name}{' '}
                      <span className="text-[var(--text-muted)]">({r.department_name})</span>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-[var(--text-secondary)]">
                      {formatDateShort(r.collection_date)}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-danger-ink">
                      {formatMilli(r.outstanding_milli)} {r.base_unit_code}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {canWrite && (
                        <Button
                          size="sm"
                          variant="primary"
                          tooltip="Log returned or damaged quantities for this checked-out item."
                          onClick={() => {
                            setReturnTarget(r);
                            setRetGood(String(r.outstanding_milli / 1000));
                            setRetDamaged('0');
                            setRetNotes('');
                          }}
                        >
                          Record Return
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {/* Reverse Collection Modal */}
      <Modal
        open={Boolean(reversingCol)}
        onOpenChange={(o) => {
          if (!o) setReversingCol(null);
        }}
        title={`Reverse ${reversingCol?.number ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReversingCol(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!reverseReason.trim()}
              tooltip="Confirm reversal and restore all issued quantities to inventory."
              onClick={() => {
                if (isAdmin) {
                  void executeReverse(null);
                } else {
                  setPinMode('reverse');
                }
              }}
            >
              Confirm Reversal
            </Button>
          </>
        }
      >
        <Field label="Reason for Reversal" required>
          <Input
            autoFocus
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="e.g. Wrong department selected"
          />
        </Field>
      </Modal>

      <PinModal
        open={Boolean(pinMode)}
        onOpenChange={(o) => {
          if (!o) setPinMode(null);
        }}
        title={pinMode === 'issue' ? 'Storekeeper PIN Required' : 'Manager PIN to Reverse Collection'}
        description={
          pinMode === 'issue'
            ? 'Enter a storekeeper or admin PIN to authorize this stock issue.'
            : 'Enter an Admin Manager PIN to authorize reversing this collection.'
        }
        onConfirm={(pin) =>
          pinMode === 'issue' ? submitPostCollection(pin) : executeReverse(pin)
        }
      />

      {/* Record Return Modal */}
      <Modal
        open={Boolean(returnTarget)}
        onOpenChange={(o) => {
          if (!o) setReturnTarget(null);
        }}
        title={`Return ${returnTarget?.item_name ?? ''}`}
        description={
          returnTarget
            ? `Outstanding: ${formatMilli(returnTarget.outstanding_milli)} ${returnTarget.base_unit_code} (${returnTarget.collector_name})`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setReturnTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={returning}
              onClick={handleRecordReturn}
              tooltip="Save this return and restore good items to stock."
            >
              Save Return
            </Button>
          </>
        }
      >
        <form onSubmit={handleRecordReturn} className="space-y-3.5">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Returned in Good Condition" required>
              <Input
                value={retGood}
                onChange={(e) => setRetGood(e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label="Damaged / Lost Quantity">
              <Input
                value={retDamaged}
                onChange={(e) => setRetDamaged(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>
          <Field label="Notes">
            <Input
              value={retNotes}
              onChange={(e) => setRetNotes(e.target.value)}
              placeholder="Condition notes..."
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
