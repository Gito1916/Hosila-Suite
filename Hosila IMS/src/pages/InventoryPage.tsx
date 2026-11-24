import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowRight,
  ArrowRightLeft,
  Edit3,
  History,
  Package,
  Plus,
  RotateCcw,
  Search,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type ItemDetailDto_Serialize,
  type ItemListRowDto_Serialize,
  type StockMovementDto_Serialize,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { filterIssueDepartments } from '../lib/domain';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Drawer, Modal } from '../components/ui/Modal';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { EmptyState } from '../components/ui/StatCard';
import {
  cn,
  formatDateShort,
  formatMicroUnitCost,
  formatMilli,
  formatMinor,
  parseQtyToMilli,
  parseUnitCostToMicro,
  todayIso,
} from '../lib/format';

type StatusQuickFilter = '' | 'low_stock' | 'out_of_stock' | 'cost_missing' | 'returnable' | 'archived';

interface DraftUnitRow {
  unit_id: string;
  factor_str: string;
  can_purchase: boolean;
  can_issue: boolean;
}

export function InventoryPage() {
  const {
    departments,
    storeSections,
    units,
    suppliers,
    currencySymbol,
    canWrite,
    isAdmin,
    inventoryPresetFilter,
    clearInventoryPresetFilter,
  } = useApp();

  const [allItems, setAllItems] = useState<ItemListRowDto_Serialize[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [deptId, setDeptId] = useState('');
  const [sectionId, setSectionId] = useState('');
  const [quickFilter, setQuickFilter] = useState<StatusQuickFilter>('');
  const reqIdRef = useRef(0);
  const detailReqIdRef = useRef(0);
  const [archiveTarget, setArchiveTarget] = useState<ItemListRowDto_Serialize | null>(null);
  const [archiving, setArchiving] = useState(false);

  // Form Drawer State
  const [formOpen, setFormOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ItemListRowDto_Serialize | null>(null);
  const [saving, setSaving] = useState(false);

  const [fName, setFName] = useState('');
  const [fSku, setFSku] = useState('');
  const [fDesc, setFDesc] = useState('');
  // Stocking Unit (how item is bought/stocked) vs Collection Unit (how staff collect it from store)
  const [fStockingUnitId, setFStockingUnitId] = useState('');
  const [fCollectionUnitId, setFCollectionUnitId] = useState('');
  // How many Collection Units are inside 1 Stocking Unit (e.g. 1 KG = 5 PORTION)
  const [fConversionFactor, setFConversionFactor] = useState('1');
  const [fSectionId, setFSectionId] = useState('');
  const [fSupplierId, setFSupplierId] = useState('');
  const [fLocation, setFLocation] = useState('');
  const [fDeptIds, setFDeptIds] = useState<string[]>([]);
  const [fReorder, setFReorder] = useState('0');
  const [fPar, setFPar] = useState('0');
  // Entered per Stocking Unit (automatically scaled to base Collection Unit when factor > 1)
  const [fStockingUnitCost, setFStockingUnitCost] = useState('');
  const [fOpeningStockInStocking, setFOpeningStockInStocking] = useState('0');
  const [fReturnable, setFReturnable] = useState(false);
  const [fExtraUnits, setFExtraUnits] = useState<DraftUnitRow[]>([]);

  // Detail & Stock Card Drawer
  const [detailOpen, setDetailOpen] = useState(false);
  const [detail, setDetail] = useState<ItemDetailDto_Serialize | null>(null);
  const [movements, setMovements] = useState<StockMovementDto_Serialize[]>([]);

  // Base Unit Rescale Wizard Modal
  const [rescaleOpen, setRescaleOpen] = useState(false);
  const [rescaleUnitId, setRescaleUnitId] = useState('');
  const [rescaleFactor, setRescaleFactor] = useState('1');
  const [rescaleReason, setRescaleReason] = useState('');
  const [rescaling, setRescaling] = useState(false);

  useEffect(() => {
    if (inventoryPresetFilter) {
      setQuickFilter(inventoryPresetFilter);
      setDeptId('');
      setSectionId('');
      clearInventoryPresetFilter();
    }
  }, [inventoryPresetFilter, clearInventoryPresetFilter]);

  const loadItems = useCallback(async () => {
    const reqId = ++reqIdRef.current;
    setLoading(true);
    try {
      const res = await commands.listItems({
        search: null,
        department_id: null,
        store_section_id: null,
        status: null,
        cost_missing_only: false,
        returnable_only: false,
        include_inactive: true,
      });
      if (reqId !== reqIdRef.current) return;
      if (res.status === 'ok') {
        setAllItems(res.data);
      } else {
        toast.error(res.error.message);
      }
    } finally {
      if (reqId === reqIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  const matchesQuickFilter = useCallback(
    (item: ItemListRowDto_Serialize, filter: StatusQuickFilter): boolean => {
      switch (filter) {
        case '':
          return item.is_active;
        case 'low_stock':
          return (
            item.is_active &&
            (item.stock_status === 'low_stock' || item.stock_status === 'out_of_stock')
          );
        case 'out_of_stock':
          return item.is_active && item.stock_status === 'out_of_stock';
        case 'cost_missing':
          return item.is_active && item.cost_missing;
        case 'returnable':
          return item.is_active && item.is_returnable;
        case 'archived':
          return !item.is_active;
      }
    },
    []
  );

  const scopedItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      if (deptId && !item.department_ids.includes(deptId)) return false;
      if (sectionId && item.store_section_id !== sectionId) return false;
      if (q) {
        const matchesName = item.name.toLowerCase().includes(q);
        const matchesSku = item.sku.toLowerCase().includes(q);
        const matchesSection = item.store_section_name?.toLowerCase().includes(q) ?? false;
        const matchesDept = item.department_names.some((dn) => dn.toLowerCase().includes(q));
        if (!matchesName && !matchesSku && !matchesSection && !matchesDept) return false;
      }
      return true;
    });
  }, [allItems, deptId, sectionId, search]);

  const filterCounts = useMemo(() => {
    const counts = {
      all: 0,
      low_stock: 0,
      out_of_stock: 0,
      cost_missing: 0,
      returnable: 0,
      archived: 0,
    };
    for (const item of scopedItems) {
      if (!item.is_active) {
        counts.archived += 1;
        continue;
      }
      counts.all += 1;
      if (item.stock_status === 'low_stock' || item.stock_status === 'out_of_stock') {
        counts.low_stock += 1;
      }
      if (item.stock_status === 'out_of_stock') {
        counts.out_of_stock += 1;
      }
      if (item.cost_missing) {
        counts.cost_missing += 1;
      }
      if (item.is_returnable) {
        counts.returnable += 1;
      }
    }
    return counts;
  }, [scopedItems]);

  const items = useMemo(
    () => scopedItems.filter((item) => matchesQuickFilter(item, quickFilter)),
    [scopedItems, quickFilter, matchesQuickFilter]
  );

  function getItemUnitSummary(item: ItemListRowDto_Serialize) {
    const collectionCode = item.base_unit_code;
    const purchaseConv =
      item.item_units.find((iu) => iu.unit_id === item.default_purchase_unit_id) ??
      item.item_units.find((iu) => iu.unit_id === item.display_unit_id) ??
      item.item_units[0];

    if (purchaseConv && purchaseConv.unit_id !== item.base_unit_id && purchaseConv.factor_milli > 0) {
      const factor = purchaseConv.factor_milli / 1000;
      const stockingQty = item.on_hand_milli / purchaseConv.factor_milli;
      return {
        hasConversion: true,
        stockingCode: purchaseConv.unit_code,
        collectionCode,
        factor,
        factorLabel: `1 ${purchaseConv.unit_code} = ${Number(factor.toFixed(3))} ${collectionCode}`,
        stockingQtyLabel: `${Number(stockingQty.toFixed(2))} ${purchaseConv.unit_code}`,
        collectionQtyLabel: `${formatMilli(item.on_hand_milli)} ${collectionCode}`,
      };
    }

    return {
      hasConversion: false,
      stockingCode: collectionCode,
      collectionCode,
      factor: 1,
      factorLabel: collectionCode,
      stockingQtyLabel: `${formatMilli(item.on_hand_milli)} ${collectionCode}`,
      collectionQtyLabel: `${formatMilli(item.on_hand_milli)} ${collectionCode}`,
    };
  }

  function openCreateDrawer() {
    setEditingItem(null);
    const defaultUnit = units.find((u) => u.code === 'PCS') ?? units[0];
    const defaultDept = departments.find((d) => d.name !== 'Store') ?? departments[0];
    setFName('');
    setFSku('');
    setFDesc('');
    setFStockingUnitId(defaultUnit?.id ?? '');
    setFCollectionUnitId(defaultUnit?.id ?? '');
    setFConversionFactor('1');
    setFSectionId('');
    setFSupplierId('');
    setFLocation('');
    setFDeptIds(defaultDept ? [defaultDept.id] : []);
    setFReorder('0');
    setFPar('0');
    setFStockingUnitCost('');
    setFOpeningStockInStocking('0');
    setFReturnable(false);
    setFExtraUnits([]);
    setFormOpen(true);
  }

  function openEditDrawer(item: ItemListRowDto_Serialize) {
    setEditingItem(item);
    setFName(item.name);
    setFSku(item.sku);
    setFDesc(item.description ?? '');

    const collectionUnitId = item.base_unit_id;
    const primaryConv =
      item.item_units.find((iu) => iu.unit_id === item.default_purchase_unit_id) ??
      item.item_units.find((iu) => iu.unit_id === item.display_unit_id) ??
      item.item_units[0];

    const stockingUnitId = primaryConv ? primaryConv.unit_id : collectionUnitId;
    const factorNum = primaryConv ? primaryConv.factor_milli / 1000 : 1;

    setFCollectionUnitId(collectionUnitId);
    setFStockingUnitId(stockingUnitId);
    setFConversionFactor(String(factorNum));

    setFSectionId(item.store_section_id ?? '');
    setFSupplierId(item.supplier_id ?? '');
    setFLocation(item.storage_location ?? '');
    setFDeptIds(item.department_ids);
    setFReorder(formatMilli(item.reorder_point_milli));
    setFPar(formatMilli(item.par_level_milli));
    setFStockingUnitCost(
      item.cost_missing ? '' : String(Number(((item.avg_cost_micro / 1_000_000) * factorNum).toFixed(2)))
    );
    setFOpeningStockInStocking('0');
    setFReturnable(item.is_returnable);
    setFExtraUnits(
      item.item_units
        .filter((iu) => iu.unit_id !== stockingUnitId)
        .map((iu) => ({
          unit_id: iu.unit_id,
          factor_str: String(iu.factor_milli / 1000),
          can_purchase: iu.can_purchase,
          can_issue: iu.can_issue,
        }))
    );
    setFormOpen(true);
  }

  async function openDetailDrawer(item: ItemListRowDto_Serialize) {
    const reqId = ++detailReqIdRef.current;
    setDetailOpen(true);
    setDetail(null);
    setMovements([]);
    const [dRes, mRes] = await Promise.all([
      commands.getItemDetail(item.id),
      commands.getItemStockCard(item.id, null, null, 60),
    ]);
    if (reqId !== detailReqIdRef.current) return;
    if (dRes.status === 'ok') setDetail(dRes.data);
    else toast.error(dRes.error.message);
    if (mRes.status === 'ok') setMovements(mRes.data);
    else toast.error(mRes.error.message);
  }

  async function handleSaveItem(e: React.FormEvent) {
    e.preventDefault();
    if (!fName.trim()) {
      toast.error('Item name is required.');
      return;
    }
    if (fDeptIds.length === 0) {
      toast.error('Select at least one department.');
      return;
    }
    const isSplitUnits = fStockingUnitId !== fCollectionUnitId;
    const factorMilli = isSplitUnits ? parseQtyToMilli(fConversionFactor) : 1000;
    if (isSplitUnits && factorMilli <= 0) {
      toast.error('Enter a valid conversion count showing how many Collection Units are in 1 Stocking Unit.');
      return;
    }

    setSaving(true);
    try {
      const factorNum = factorMilli / 1000;
      const combinedUnits = [
        ...(isSplitUnits
          ? [
            {
              unit_id: fStockingUnitId,
              factor_milli: factorMilli,
              can_purchase: true,
              can_issue: true,
              label_override: null,
            },
          ]
          : []),
        ...fExtraUnits
          .filter(
            (u) =>
              u.unit_id &&
              u.unit_id !== fCollectionUnitId &&
              u.unit_id !== fStockingUnitId &&
              parseQtyToMilli(u.factor_str) > 0
          )
          .map((u) => ({
            unit_id: u.unit_id,
            factor_milli: parseQtyToMilli(u.factor_str),
            can_purchase: u.can_purchase,
            can_issue: u.can_issue,
            label_override: null,
          })),
      ];

      const costMissing = fStockingUnitCost.trim() === '';
      const rawStockingCostMicro = costMissing ? 0 : parseUnitCostToMicro(fStockingUnitCost);
      const baseCollectionCostMicro =
        factorNum > 0 ? Math.round(rawStockingCostMicro / factorNum) : rawStockingCostMicro;

      if (editingItem) {
        // If Admin also changed the Collection Unit (base_unit_id), rescale first
        if (fCollectionUnitId !== editingItem.base_unit_id) {
          const prevPrimary =
            editingItem.item_units.find(
              (iu) => iu.unit_id === editingItem.default_purchase_unit_id
            ) ??
            editingItem.item_units.find((iu) => iu.unit_id === editingItem.display_unit_id) ??
            editingItem.item_units[0];
          const prevStockingId = prevPrimary ? prevPrimary.unit_id : editingItem.base_unit_id;
          let rescaleMilli = factorMilli > 0 ? factorMilli : 1000;
          if (prevPrimary && fStockingUnitId === prevStockingId) {
            rescaleMilli = Math.max(
              1,
              Math.round((factorMilli * 1000) / prevPrimary.factor_milli)
            );
          } else if (
            prevStockingId === editingItem.base_unit_id &&
            fStockingUnitId === editingItem.base_unit_id
          ) {
            rescaleMilli = Math.max(1, factorMilli);
          }
          const rescaleRes = await commands.changeItemBaseUnit(editingItem.id, {
            new_base_unit_id: fCollectionUnitId,
            conversion_factor_milli: rescaleMilli,
            reason: 'Updated Collection Unit from Item Editor',
          });
          if (rescaleRes.status === 'error') {
            toast.error(rescaleRes.error.message);
            return;
          }
        }

        const res = await commands.updateItem(editingItem.id, {
          name: fName.trim(),
          description: fDesc.trim() || null,
          display_unit_id: isSplitUnits ? fStockingUnitId : fCollectionUnitId,
          default_issue_unit_id: fCollectionUnitId,
          default_purchase_unit_id: fStockingUnitId,
          store_section_id: fSectionId || null,
          clear_store_section: !fSectionId,
          department_ids: fDeptIds,
          item_units: combinedUnits,
          reorder_point_milli: parseQtyToMilli(fReorder),
          par_level_milli: parseQtyToMilli(fPar),
          unit_cost_micro: baseCollectionCostMicro,
          cost_missing: costMissing,
          is_returnable: fReturnable,
          supplier_id: fSupplierId || null,
          clear_supplier: !fSupplierId,
          storage_location: fLocation.trim() || null,
          is_active: true,
        });
        if (res.status === 'error') {
          toast.error(res.error.message);
          return;
        }
        toast.success(`Updated ${res.data.name}`);
      } else {
        const openingInStockingMilli = parseQtyToMilli(fOpeningStockInStocking);
        const openingInCollectionMilli = Math.round(openingInStockingMilli * factorNum);

        const res = await commands.createItem({
          sku: fSku.trim() || null,
          name: fName.trim(),
          description: fDesc.trim() || null,
          base_unit_id: fCollectionUnitId,
          display_unit_id: isSplitUnits ? fStockingUnitId : fCollectionUnitId,
          default_issue_unit_id: fCollectionUnitId,
          default_purchase_unit_id: fStockingUnitId,
          store_section_id: fSectionId || null,
          department_ids: fDeptIds,
          item_units: combinedUnits,
          reorder_point_milli: parseQtyToMilli(fReorder),
          par_level_milli: parseQtyToMilli(fPar),
          initial_unit_cost_micro: baseCollectionCostMicro,
          cost_missing: costMissing,
          is_returnable: fReturnable,
          opening_stock_milli: openingInCollectionMilli,
          opening_date: todayIso(),
          supplier_id: fSupplierId || null,
          storage_location: fLocation.trim() || null,
        });
        if (res.status === 'error') {
          toast.error(res.error.message);
          return;
        }
        toast.success(`Created ${res.data.name}`);
      }
      setFormOpen(false);
      await loadItems();
    } finally {
      setSaving(false);
    }
  }

  async function executeArchiveConfirmed() {
    if (!archiveTarget) return;
    setArchiving(true);
    try {
      const res = await commands.archiveItem(archiveTarget.id);
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Archived ${archiveTarget.name}`);
      setArchiveTarget(null);
      setDetailOpen(false);
      await loadItems();
    } finally {
      setArchiving(false);
    }
  }

  async function handleUnarchive(item: ItemListRowDto_Serialize) {
    const res = await commands.updateItem(item.id, { is_active: true });
    if (res.status === 'error') {
      toast.error(res.error.message);
      return;
    }
    toast.success(`Restored ${item.name}`);
    setDetailOpen(false);
    await loadItems();
  }

  async function handleRescaleBaseUnit(e: React.FormEvent) {
    e.preventDefault();
    if (!detail) return;
    setRescaling(true);
    try {
      const res = await commands.changeItemBaseUnit(detail.item.id, {
        new_base_unit_id: rescaleUnitId,
        conversion_factor_milli: parseQtyToMilli(rescaleFactor),
        reason: rescaleReason.trim(),
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Collection unit rescaled to ${res.data.base_unit_code}`);
      setRescaleOpen(false);
      await openDetailDrawer(res.data);
      await loadItems();
    } finally {
      setRescaling(false);
    }
  }

  function toggleDept(id: string) {
    setFDeptIds((prev) =>
      prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]
    );
  }

  const stockingUnitObj = units.find((u) => u.id === fStockingUnitId);
  const collectionUnitObj = units.find((u) => u.id === fCollectionUnitId);
  const isSplitUnits = Boolean(
    fStockingUnitId && fCollectionUnitId && fStockingUnitId !== fCollectionUnitId
  );
  const factorNum = isSplitUnits ? Math.max(parseQtyToMilli(fConversionFactor) / 1000, 0) : 1;

  const hasActiveFilters = Boolean(search.trim() || deptId || sectionId || quickFilter);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">Inventory Catalog</h1>
        {canWrite && (
          <Button
            variant="primary"
            onClick={openCreateDrawer}
            tooltip="Create a new inventory item with its Stocking Unit, Collection Unit, conversion ratio, and department access."
          >
            <Plus className="h-4 w-4" />
            Add New Item
          </Button>
        )}
      </div>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-3.5 space-y-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="h-4 w-4 text-[var(--text-muted)] absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by item name, SKU, or saved alias..."
              className="pl-9"
            />
          </div>
          <Select
            value={sectionId}
            onChange={(e) => setSectionId(e.target.value)}
            className="w-[175px]"
          >
            <option value="">All Store Sections</option>
            {storeSections.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </div>

        {/* Department Pills */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setDeptId('');
                setSectionId('');
                setQuickFilter('');
              }}
              className={cn(
                'px-3 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer',
                deptId === ''
                  ? 'bg-[#6AD4B0] text-[#1D1D1F]'
                  : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              )}
            >
              All Departments
            </button>
            {filterIssueDepartments(departments).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  const nextDeptId = d.id === deptId ? '' : d.id;
                  setDeptId(nextDeptId);
                  if (quickFilter !== '') {
                    const hasMatchInNext = allItems.some(
                      (it) =>
                        (!nextDeptId || it.department_ids.includes(nextDeptId)) &&
                        (!sectionId || it.store_section_id === sectionId) &&
                        matchesQuickFilter(it, quickFilter)
                    );
                    if (!hasMatchInNext) setQuickFilter('');
                  }
                }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium transition-colors cursor-pointer',
                  deptId === d.id
                    ? 'bg-[#6AD4B0] text-[#1D1D1F]'
                    : 'bg-[var(--bg-subtle)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                )}
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: deptId === d.id ? '#1D1D1F' : d.color || '#6AD4B0',
                  }}
                />
                {d.name}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: '', label: 'All', count: filterCounts.all },
                { id: 'low_stock', label: 'Low Stock', count: filterCounts.low_stock },
                { id: 'out_of_stock', label: 'Out', count: filterCounts.out_of_stock },
                { id: 'cost_missing', label: 'Cost Missing', count: filterCounts.cost_missing },
                { id: 'returnable', label: 'Returnable', count: filterCounts.returnable },
                { id: 'archived', label: 'Archived', count: filterCounts.archived },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() =>
                  setQuickFilter(f.id === '' ? '' : quickFilter === f.id ? '' : f.id)
                }
                className={cn(
                  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition-colors cursor-pointer',
                  quickFilter === f.id
                    ? 'bg-[var(--accent-soft)] text-[var(--accent-text)] font-semibold'
                    : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)]'
                )}
              >
                <span>{f.label}</span>
                <span className="text-[10.5px] tabular-nums opacity-80">({f.count})</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Items Table */}
      {items.length === 0 && !loading ? (
        hasActiveFilters || allItems.length > 0 ? (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No matching inventory items"
            description="No items match the current search, department, section, or stock status filter."
            action={
              <Button
                variant="primary"
                onClick={() => {
                  setSearch('');
                  setDeptId('');
                  setSectionId('');
                  setQuickFilter('');
                }}
                tooltip="Clear all active search, department, and status filters."
              >
                <RotateCcw className="h-4 w-4" />
                Reset Filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<Package className="h-5 w-5" />}
            title="No inventory items yet"
            description="Add your first item manually or import an Excel sheet in Settings → Import Inventory."
            action={
              canWrite ? (
                <Button
                  variant="primary"
                  onClick={openCreateDrawer}
                  tooltip="Open the form to add a new stock item to the catalog."
                >
                  <Plus className="h-4 w-4" />
                  Add New Item
                </Button>
              ) : undefined
            }
          />
        )
      ) : (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]/55 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-3">Departments</th>
                  <th className="py-2.5 px-3">Units (Stock → Collect)</th>
                  <th className="py-2.5 px-3 text-right">In Stock</th>
                  <th className="py-2.5 px-3 text-right">Unit Cost</th>
                  <th className="py-2.5 px-3 text-right">Stock Value</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] text-[13px]">
                {items.map((item) => {
                  const unitSummary = getItemUnitSummary(item);
                  return (
                    <tr
                      key={item.id}
                      onClick={() => openDetailDrawer(item)}
                      className="hover:bg-[var(--bg-hover)] transition-colors cursor-pointer"
                    >
                      <td className="py-2.5 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[var(--text-primary)]">{item.name}</span>
                          {item.store_section_name && (
                            <Badge tone="info">{item.store_section_name}</Badge>
                          )}
                          {item.is_returnable && (
                            <Badge tone="accent">
                              <RotateCcw className="h-3 w-3" />
                              Returnable
                            </Badge>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--text-muted)] tabular-nums mt-0.5">
                          {item.sku}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap gap-1">
                          {item.department_names.map((dn) => (
                            <Badge key={dn} tone="neutral">
                              {dn}
                            </Badge>
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        {unitSummary.hasConversion ? (
                          <div className="space-y-0.5">
                            <div className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--text-primary)]">
                              <span>{unitSummary.stockingCode}</span>
                              <ArrowRight className="h-3 w-3 text-[#6AD4B0]" />
                              <span>{unitSummary.collectionCode}</span>
                            </div>
                            <div className="text-[11px] text-[var(--accent-text)] font-medium tabular-nums">
                              {unitSummary.factorLabel}
                            </div>
                          </div>
                        ) : (
                          <Badge tone="neutral">{unitSummary.collectionCode}</Badge>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        <div className="font-semibold text-[var(--text-primary)]">
                          {item.display_stock}
                        </div>
                        {unitSummary.hasConversion && (
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {unitSummary.collectionQtyLabel}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {item.cost_missing ? (
                          <Badge tone="warning">
                            <AlertCircle className="h-3 w-3" />
                            Missing
                          </Badge>
                        ) : (
                          <div>
                            <div>
                              {formatMicroUnitCost(item.avg_cost_micro, currencySymbol)}/
                              {item.base_unit_code}
                            </div>
                            {unitSummary.hasConversion && (
                              <div className="text-[11px] text-[var(--text-muted)]">
                                {formatMicroUnitCost(
                                  Math.round(item.avg_cost_micro * unitSummary.factor),
                                  currencySymbol
                                )}
                                /{unitSummary.stockingCode}
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {formatMinor(item.stock_value_minor, currencySymbol)}
                      </td>
                      <td className="py-2.5 px-3">
                        <div className="flex flex-wrap items-center gap-1">
                          {item.stock_status === 'out_of_stock' ? (
                            <Badge tone="danger">Out of Stock</Badge>
                          ) : item.stock_status === 'low_stock' ? (
                            <Badge tone="warning">Low Stock</Badge>
                          ) : (
                            <Badge tone="success">In Stock</Badge>
                          )}
                          {!item.is_active && <Badge tone="neutral">Archived</Badge>}
                        </div>
                      </td>
                      <td
                        className="py-2.5 px-4 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            tooltip="Open the item stock card and movement ledger."
                            onClick={() => openDetailDrawer(item)}
                          >
                            <History className="h-4 w-4" />
                          </Button>
                          {canWrite && (
                            <Button
                              variant="ghost"
                              size="icon"
                              tooltip="Edit item units, conversion ratio, departments, or unit cost."
                              onClick={() => openEditDrawer(item)}
                            >
                              <Edit3 className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-2 border-t border-[var(--border-subtle)] text-[12px] text-[var(--text-muted)] flex items-center justify-between tabular-nums">
            <span>
              Showing {items.length} item{items.length === 1 ? '' : 's'}
            </span>
            <span>
              Visible Value:{' '}
              <strong className="text-[var(--text-primary)]">
                {formatMinor(
                  items.reduce((acc, i) => acc + i.stock_value_minor, 0),
                  currencySymbol
                )}
              </strong>
            </span>
          </div>
        </div>
      )}

      {/* Add / Edit Item Drawer */}
      <Drawer
        open={formOpen}
        onOpenChange={setFormOpen}
        title={editingItem ? `Edit ${editingItem.name}` : 'New Inventory Item'}
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => setFormOpen(false)}
              tooltip="Close without saving changes."
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSaveItem}
              tooltip="Save item details, stocking/collection unit mapping, and department access."
            >
              {editingItem ? 'Save Changes' : 'Create Item'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSaveItem} className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Item Name" required className="col-span-2">
              <Input
                autoFocus
                value={fName}
                onChange={(e) => setFName(e.target.value)}
                placeholder="e.g. Goat Meat, Chicken Breast, Star Beer"
              />
            </Field>
            <Field label="SKU" hint="Auto if blank">
              <Input
                value={fSku}
                disabled={Boolean(editingItem)}
                onChange={(e) => setFSku(e.target.value)}
                placeholder="ITM-0001"
              />
            </Field>
          </div>

          <Field label="Shared Departments" required>
            <div className="flex flex-wrap gap-2">
              {filterIssueDepartments(departments).map((d) => {
                const selected = fDeptIds.includes(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    onClick={() => toggleDept(d.id)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg border text-[12px] font-medium transition-all cursor-pointer',
                      selected
                        ? 'border-[#6AD4B0] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                        : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)] hover:border-[var(--border-strong)]'
                    )}
                  >
                    {d.name}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Store Section">
              <Select value={fSectionId} onChange={(e) => setFSectionId(e.target.value)}>
                <option value="">None</option>
                {storeSections.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Default Supplier">
              <Select value={fSupplierId} onChange={(e) => setFSupplierId(e.target.value)}>
                <option value="">None</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          {/* Stocking Unit vs Collection Unit Mapping */}
          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/35 p-3.5 space-y-3">
            <div className="text-[12.5px] font-semibold text-[var(--text-primary)]">
              Stocking &amp; Collection Units
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Stocking Unit (Bought In)" required>
                <Select
                  value={fStockingUnitId}
                  onChange={(e) => {
                    const nextStockId = e.target.value;
                    setFStockingUnitId(nextStockId);
                    if (nextStockId === fCollectionUnitId) {
                      setFConversionFactor('1');
                    } else if (fConversionFactor === '1') {
                      setFConversionFactor('5');
                    }
                  }}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Collection Unit (Issued In)"
                required
                hint={editingItem && !isAdmin ? 'Admin required to change base unit' : undefined}
              >
                <Select
                  value={fCollectionUnitId}
                  disabled={Boolean(editingItem) && !isAdmin}
                  onChange={(e) => {
                    const nextColId = e.target.value;
                    setFCollectionUnitId(nextColId);
                    if (nextColId === fStockingUnitId) {
                      setFConversionFactor('1');
                    } else if (fConversionFactor === '1') {
                      setFConversionFactor('5');
                    }
                  }}
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} — {u.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {isSplitUnits && (
              <div className="rounded-xl border border-[#6AD4B0]/40 bg-[var(--accent-soft)]/50 p-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-[12px] font-semibold text-[var(--text-primary)]">
                    Conversion Mapping
                  </span>
                  <div className="inline-flex items-center gap-2 text-[12.5px] font-semibold">
                    <span>1 {stockingUnitObj?.code ?? 'Stock Unit'} =</span>
                    <Input
                      value={fConversionFactor}
                      onChange={(e) => setFConversionFactor(e.target.value)}
                      className="w-20 h-7 text-center tabular-nums font-bold"
                    />
                    <span>{collectionUnitObj?.code ?? 'Collection Units'}</span>
                  </div>
                </div>
                {factorNum > 0 && (
                  <div className="text-[11.5px] text-[var(--text-secondary)] flex flex-wrap items-center justify-between gap-2 tabular-nums">
                    <span>
                      Stocked in <strong>{stockingUnitObj?.code}</strong>, collected in{' '}
                      <strong>{collectionUnitObj?.code}</strong>
                    </span>
                    {fStockingUnitCost.trim() !== '' && (
                      <span>
                        Cost per {collectionUnitObj?.code}:{' '}
                        <strong className="text-[var(--accent-text)]">
                          {currencySymbol}
                          {((Number(fStockingUnitCost) || 0) / factorNum).toLocaleString(undefined, {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}
                        </strong>
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Optional Extra Pack Conversions */}
            {fExtraUnits.length > 0 && (
              <div className="pt-1 space-y-2">
                {fExtraUnits.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <div className="col-span-5">
                      <Select
                        value={row.unit_id}
                        onChange={(e) => {
                          const next = [...fExtraUnits];
                          next[idx] = { ...row, unit_id: e.target.value };
                          setFExtraUnits(next);
                        }}
                      >
                        {units
                          .filter((u) => u.id !== fCollectionUnitId && u.id !== fStockingUnitId)
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              1 {u.code} =
                            </option>
                          ))}
                      </Select>
                    </div>
                    <div className="col-span-4">
                      <Input
                        value={row.factor_str}
                        onChange={(e) => {
                          const next = [...fExtraUnits];
                          next[idx] = { ...row, factor_str: e.target.value };
                          setFExtraUnits(next);
                        }}
                        placeholder="Factor"
                        className="tabular-nums"
                      />
                    </div>
                    <span className="col-span-2 text-[11px] text-[var(--text-muted)]">
                      {collectionUnitObj?.code}
                    </span>
                    <button
                      type="button"
                      onClick={() => setFExtraUnits(fExtraUnits.filter((_, i) => i !== idx))}
                      className="col-span-1 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {(() => {
              const usedIds = new Set([
                fCollectionUnitId,
                fStockingUnitId,
                ...fExtraUnits.map((u) => u.unit_id),
              ]);
              const availableExtra = units.filter((u) => !usedIds.has(u.id));
              if (availableExtra.length === 0) return null;
              return (
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setFExtraUnits([
                        ...fExtraUnits,
                        {
                          unit_id: availableExtra[0].id,
                          factor_str: '1',
                          can_purchase: true,
                          can_issue: true,
                        },
                      ])
                    }
                    tooltip="Add another alternate pack or bulk unit conversion for this item."
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Extra Pack Unit
                  </Button>
                </div>
              );
            })()}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <Field
              label={`Cost per ${stockingUnitObj?.code ?? 'Unit'} (${currencySymbol})`}
            >
              <Input
                value={fStockingUnitCost}
                onChange={(e) => setFStockingUnitCost(e.target.value)}
                placeholder="0.00"
                className="tabular-nums"
              />
            </Field>
            <Field label={`Reorder (${collectionUnitObj?.code ?? 'Unit'})`}>
              <Input
                value={fReorder}
                onChange={(e) => setFReorder(e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label={`Par (${collectionUnitObj?.code ?? 'Unit'})`}>
              <Input
                value={fPar}
                onChange={(e) => setFPar(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>

          {!editingItem && (
            <Field
              label={`Opening Stock (${stockingUnitObj?.code ?? 'Unit'})`}
              hint={
                isSplitUnits && factorNum > 0
                  ? `= ${Number(((Number(fOpeningStockInStocking) || 0) * factorNum).toFixed(2))} ${collectionUnitObj?.code}`
                  : undefined
              }
            >
              <Input
                value={fOpeningStockInStocking}
                onChange={(e) => setFOpeningStockInStocking(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3 items-center">
            <Field label="Storage Location">
              <Input
                value={fLocation}
                onChange={(e) => setFLocation(e.target.value)}
                placeholder="e.g. Dry Store Rack B"
              />
            </Field>
            <label className="flex items-center gap-2.5 pt-5 text-[12.5px] cursor-pointer select-none">
              <input
                type="checkbox"
                checked={fReturnable}
                onChange={(e) => setFReturnable(e.target.checked)}
                className="h-4 w-4 accent-[#6AD4B0]"
              />
              <span>Returnable Item (Tools / Equipment)</span>
            </label>
          </div>

          <Field label="Notes">
            <Textarea
              rows={2}
              value={fDesc}
              onChange={(e) => setFDesc(e.target.value)}
              placeholder="Optional specifications..."
            />
          </Field>
        </form>
      </Drawer>

      {/* Item Detail & Stock Card Drawer */}
      <Drawer
        open={detailOpen}
        onOpenChange={setDetailOpen}
        title={detail ? detail.item.name : 'Item Stock Card'}
        description={detail ? `${detail.item.sku} · ${detail.item.department_names.join(', ')}` : undefined}
        width="max-w-2xl"
        footer={
          detail && canWrite ? (
            <>
              {detail.item.is_active ? (
                <Button
                  variant="danger"
                  onClick={() => setArchiveTarget(detail.item)}
                  tooltip="Archive this item so it no longer appears in active collections or restocks."
                >
                  <Archive className="h-4 w-4" />
                  Archive
                </Button>
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => handleUnarchive(detail.item)}
                  tooltip="Restore this archived item to the active catalog."
                >
                  <RotateCcw className="h-4 w-4" />
                  Unarchive / Restore
                </Button>
              )}
              {isAdmin && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setRescaleUnitId(units.find((u) => u.id !== detail.item.base_unit_id)?.id ?? '');
                    setRescaleFactor('1');
                    setRescaleReason('');
                    setRescaleOpen(true);
                  }}
                  tooltip="Convert this item's base collection unit while preserving total stock valuation."
                >
                  <ArrowRightLeft className="h-4 w-4" />
                  Rescale Collection Unit
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => {
                  setDetailOpen(false);
                  openEditDrawer(detail.item);
                }}
                tooltip="Edit this item's stocking unit, collection unit, conversion factor, or departments."
              >
                <Edit3 className="h-4 w-4" />
                Edit Item
              </Button>
            </>
          ) : undefined
        }
      >
        {detail ? (
          <div className="space-y-5">
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-3.5">
                <div className="text-[11.5px] text-[var(--text-muted)]">Current Stock</div>
                <div className="text-[17px] font-semibold tabular-nums mt-1">
                  {detail.item.display_stock}
                </div>
                <div className="text-[11px] text-[var(--text-muted)] tabular-nums mt-0.5">
                  {formatMilli(detail.item.on_hand_milli)} {detail.item.base_unit_code}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-3.5">
                <div className="text-[11.5px] text-[var(--text-muted)]">
                  Avg Cost / {detail.item.base_unit_code}
                </div>
                <div className="text-[17px] font-semibold tabular-nums mt-1">
                  {detail.item.cost_missing
                    ? 'Missing'
                    : formatMicroUnitCost(detail.item.avg_cost_micro, currencySymbol)}
                </div>
              </div>
              <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-3.5">
                <div className="text-[11.5px] text-[var(--text-muted)]">Valuation</div>
                <div className="text-[17px] font-semibold tabular-nums text-[var(--accent-text)] mt-1">
                  {formatMinor(detail.item.stock_value_minor, currencySymbol)}
                </div>
              </div>
            </div>

            {detail.aliases.length > 0 && (
              <div>
                <div className="text-[12px] font-medium text-[var(--text-secondary)] mb-1.5">
                  Remembered Excel Aliases
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {detail.aliases.map((a) => (
                    <Badge key={a} tone="neutral">
                      {a}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[13.5px] font-semibold mb-2.5">Movement Ledger</h3>
              {movements.length === 0 ? (
                <p className="text-[13px] text-[var(--text-muted)] py-6 text-center border border-dashed border-[var(--border-subtle)] rounded-xl">
                  No stock movements recorded yet.
                </p>
              ) : (
                <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                  <table className="w-full text-left border-collapse text-[12.5px]">
                    <thead>
                      <tr className="bg-[var(--bg-subtle)]/60 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                        <th className="py-2 px-3">Date</th>
                        <th className="py-2 px-2">Type</th>
                        <th className="py-2 px-2">Ref</th>
                        <th className="py-2 px-2 text-right">Qty ({detail.item.base_unit_code})</th>
                        <th className="py-2 px-3 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                      {movements.map((m) => (
                        <tr key={m.id}>
                          <td className="py-2 px-3 text-[var(--text-secondary)]">
                            {formatDateShort(m.business_date)}
                          </td>
                          <td className="py-2 px-2">
                            <Badge
                              tone={
                                m.qty_milli > 0
                                  ? 'accent'
                                  : m.movement_type === 'issue'
                                    ? 'info'
                                    : 'warning'
                              }
                            >
                              {m.movement_type}
                            </Badge>
                          </td>
                          <td className="py-2 px-2 text-[var(--text-secondary)]">
                            {m.doc_number}
                            {m.counterparty_staff_name ? ` · ${m.counterparty_staff_name}` : ''}
                          </td>
                          <td
                            className={cn(
                              'py-2 px-2 text-right font-medium',
                              m.qty_milli > 0 ? 'text-[var(--accent-text)]' : 'text-[var(--danger)]'
                            )}
                          >
                            {m.qty_milli > 0 ? '+' : ''}
                            {formatMilli(m.qty_milli)}
                          </td>
                          <td className="py-2 px-3 text-right font-medium">
                            {formatMilli(m.balance_after_milli)} {detail.item.base_unit_code}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-[13px] text-[var(--text-muted)]">
            Loading stock card...
          </div>
        )}
      </Drawer>

      {/* Base Unit Rescale Wizard */}
      <Modal
        open={rescaleOpen}
        onOpenChange={setRescaleOpen}
        title="Rescale Collection Unit"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRescaleOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={rescaling}
              disabled={!rescaleUnitId || !rescaleReason.trim()}
              onClick={handleRescaleBaseUnit}
              tooltip="Apply the new collection unit and rescale existing quantities while keeping stock value unchanged."
            >
              Confirm Rescale
            </Button>
          </>
        }
      >
        <form onSubmit={handleRescaleBaseUnit} className="space-y-4">
          <Field label="New Collection Unit" required>
            <Select value={rescaleUnitId} onChange={(e) => setRescaleUnitId(e.target.value)}>
              {units
                .filter((u) => u.id !== detail?.item.base_unit_id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code} — {u.name}
                  </option>
                ))}
            </Select>
          </Field>
          <Field
            label="Conversion Factor"
            required
            hint={`How many new collection units equal 1 old ${detail?.item.base_unit_code ?? 'unit'}`}
          >
            <Input
              value={rescaleFactor}
              onChange={(e) => setRescaleFactor(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Audit Reason" required>
            <Input
              value={rescaleReason}
              onChange={(e) => setRescaleReason(e.target.value)}
              placeholder="e.g. Dividing 1 KG into 5 Portions"
            />
          </Field>
        </form>
      </Modal>

      {/* Archive Confirmation Modal */}
      <Modal
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
        title="Archive Inventory Item"
        description={
          archiveTarget
            ? `Archive "${archiveTarget.name}" (${archiveTarget.sku})? Its ledger history is preserved and you can restore it anytime under the Archived filter.`
            : undefined
        }
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setArchiveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger-solid"
              loading={archiving}
              onClick={executeArchiveConfirmed}
              tooltip="Confirm archiving this item from the active catalog."
            >
              <Archive className="h-4 w-4" />
              Archive Item
            </Button>
          </>
        }
      >
        <p className="text-xs text-ink/65">
          Archived items are hidden from stock collections, procurement drafts, and restock pickers
          until restored.
        </p>
      </Modal>
    </div>
  );
}
