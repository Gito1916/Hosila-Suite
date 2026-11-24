import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FolderOpen,
  History,
  Plus,
  Printer,
  ShoppingCart,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type ExtraChargeDto,
  type ItemListRowDto_Serialize,
  type ParsedAnomalyCode,
  type ParsedMatchCandidate,
  type ParsedProcurementDraft_Serialize,
  type ProcurementDraftLineDto_Serialize,
  type ProcurementListDto_Serialize,
  type ProcurementListSummaryDto,
  type ReceiptDto_Serialize,
  type WorkbookSheetSummary_Serialize,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Badge, type BadgeTone } from '../components/ui/Badge';
import { Field, Input, Select } from '../components/ui/Field';
import { Drawer, Modal } from '../components/ui/Modal';
import { PinModal } from '../components/ui/PinModal';
import { EmptyState } from '../components/ui/StatCard';
import {
  cn,
  encodeExcelFileForBackend,
  formatDateShort,
  formatMilli,
  formatMinor,
  parseCurrencyToMinor,
  parseQtyToMilli,
  printHtmlDocument,
  todayIso,
} from '../lib/format';
import {
  filterActiveStoreStaff,
  filterIssueDepartments,
  getCompatibleUnits,
  resolveItemUnitFactor,
} from '../lib/domain';

type ProcTab = 'lists' | 'parser' | 'restock' | 'receipts';

interface DraftEditLine {
  item_id: string;
  item_name: string;
  section_label: string;
  buyer_name: string;
  unit_id: string;
  unit_code: string;
  ordered_qty_str: string;
  est_unit_cost_str: string;
}

interface ConfirmRowState {
  row_key: string;
  sheet_name: string;
  excel_row: number;
  section_label: string;
  raw_description: string;
  raw_unit: string | null;
  anomalies: ParsedAnomalyCode[];
  anomaly_messages: string[];
  candidates: ParsedMatchCandidate[];
  action: 'map' | 'create_new' | 'skip';
  item_id: string;
  new_item_name: string;
  new_item_department_id: string;
  unit_id: string;
  factor_str: string;
  qty_str: string;
  line_total_str: string;
  procurement_line_id: string | null;
  save_alias: boolean;
  save_unit_conversion: boolean;
}

interface ManualReceiptLine {
  procurement_line_id: string | null;
  item_id: string;
  item_name: string;
  unit_id: string;
  qty_str: string;
  collection_yield_override_str: string;
  yield_manually_edited?: boolean;
  line_total_str: string;
}

interface DraftExtraCharge {
  label: string;
  amount_str: string;
}

function anomalyBadge(code: ParsedAnomalyCode): { label: string; tone: BadgeTone } {
  switch (code) {
    case 'AMOUNT_MISMATCH':
      return { label: 'Amount Mismatch', tone: 'danger' };
    case 'AMOUNT_ONLY':
      return { label: 'Qty Missing', tone: 'warning' };
    case 'UNIT_CONVERSION_NEEDED':
      return { label: 'UoM Factor Needed', tone: 'warning' };
    case 'UNMATCHED_ITEM':
      return { label: 'Unmatched Item', tone: 'danger' };
    case 'PRICE_JUMP':
      return { label: 'Price Jump', tone: 'info' };
  }
}

export function ProcurementPage() {
  const { departments, staff, units, suppliers, currencySymbol, canWrite, isAdmin } = useApp();
  const [tab, setTab] = useState<ProcTab>('lists');

  const storeStaff = useMemo(() => filterActiveStoreStaff(staff), [staff]);
  const nonStoreDepts = useMemo(() => filterIssueDepartments(departments), [departments]);

  // Catalog cache for pickers
  const [catalog, setCatalog] = useState<ItemListRowDto_Serialize[]>([]);

  // TAB 1: Procurement Lists
  const [lists, setLists] = useState<ProcurementListSummaryDto[]>([]);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [scope, setScope] = useState<'low_stock' | 'full' | 'custom'>('low_stock');
  const [selDepts, setSelDepts] = useState<string[]>([]);
  const [customItemIds, setCustomItemIds] = useState<string[]>([]);
  const [customSearch, setCustomSearch] = useState('');
  const [listTitle, setListTitle] = useState(`WEEKLY PROCUREMENT — ${todayIso()}`);
  const [draftLines, setDraftLines] = useState<DraftEditLine[]>([]);
  const [draftExtras, setDraftExtras] = useState<DraftExtraCharge[]>([
    { label: 'TRANSPORT / LOGISTICS', amount_str: '' },
  ]);
  const [savingList, setSavingList] = useState(false);

  // Export Modal
  const [exportListId, setExportListId] = useState<string | null>(null);
  const [exportPath, setExportPath] = useState('');
  const [exporting, setExporting] = useState(false);

  // TAB 2: Built-In Parser Confirmation Gate
  const [uploadPath, setUploadPath] = useState('');
  const [encodedUploadPayload, setEncodedUploadPayload] = useState<string | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [sheets, setSheets] = useState<WorkbookSheetSummary_Serialize[]>([]);
  const [selectedSheets, setSelectedSheets] = useState<string[]>([]);
  const [parsing, setParsing] = useState(false);
  const [parsedDraft, setParsedDraft] = useState<ParsedProcurementDraft_Serialize | null>(null);
  const [confirmRows, setConfirmRows] = useState<ConfirmRowState[]>([]);
  const [pReceivedBy, setPReceivedBy] = useState('');
  const [pApprovedBy, setPApprovedBy] = useState('');
  const [pDate, setPDate] = useState(todayIso());
  const [pInvoice, setPInvoice] = useState('');
  const [pDisbursement, setPDisbursement] = useState('');
  const [pNotes, setPNotes] = useState('');
  const [confirmingParse, setConfirmingParse] = useState(false);

  // TAB 3: Manual Restock (GRN)
  const [linkedListId, setLinkedListId] = useState<string | null>(null);
  const [mLines, setMLines] = useState<ManualReceiptLine[]>([]);
  const [mExtraCharges, setMExtraCharges] = useState<ExtraChargeDto[]>([]);
  const [mAddItemId, setMAddItemId] = useState('');
  const [mSupplierId, setMSupplierId] = useState('');
  const [mInvoice, setMInvoice] = useState('');
  const [mReceivedBy, setMReceivedBy] = useState('');
  const [mApprovedBy, setMApprovedBy] = useState('');
  const [mDate, setMDate] = useState(todayIso());
  const [mDisbursement, setMDisbursement] = useState('');
  const [mNotes, setMNotes] = useState('');
  const [postingReceipt, setPostingReceipt] = useState(false);

  // TAB 4: Receipts History
  const [receipts, setReceipts] = useState<ReceiptDto_Serialize[]>([]);
  const [reversingReceipt, setReversingReceipt] = useState<ReceiptDto_Serialize | null>(null);
  const [revReason, setRevReason] = useState('');
  const [pinModalOpen, setPinModalOpen] = useState(false);

  const loadBase = useCallback(async () => {
    const [catRes, plRes, recRes] = await Promise.all([
      commands.listItems({
        cost_missing_only: false,
        returnable_only: false,
        include_inactive: false,
      }),
      commands.listProcurementLists(null),
      commands.listReceipts({ limit: 80 }),
    ]);
    if (catRes.status === 'ok') setCatalog(catRes.data);
    if (plRes.status === 'ok') setLists(plRes.data);
    if (recRes.status === 'ok') setReceipts(recRes.data);
  }, []);

  useEffect(() => {
    loadBase();
  }, [loadBase]);

  useEffect(() => {
    if (selDepts.length === 0 && nonStoreDepts.length > 0) {
      setSelDepts(nonStoreDepts.map((d) => d.id));
    }
    if (!pReceivedBy && staff.length > 0) setPReceivedBy(staff[0].id);
    if (!mReceivedBy && staff.length > 0) setMReceivedBy(staff[0].id);
    if (!pApprovedBy && storeStaff.length > 0) setPApprovedBy(storeStaff[0].id);
    if (!mApprovedBy && storeStaff.length > 0) setMApprovedBy(storeStaff[0].id);
  }, [nonStoreDepts, staff, storeStaff, selDepts.length, pReceivedBy, mReceivedBy, pApprovedBy, mApprovedBy]);

  function getItemConversionFactor(itemId: string, unitId: string): number {
    const catItem = catalog.find((c) => c.id === itemId);
    if (!catItem) return 1;
    return resolveItemUnitFactor(catItem, unitId, units) / 1000;
  }

  // Generate Procurement Draft
  async function handleGenerateDraft() {
    const res = await commands.generateProcurementDraft({
      scope,
      department_ids: scope === 'custom' ? [] : selDepts,
      custom_item_ids: scope === 'custom' ? customItemIds : [],
    });
    if (res.status === 'error') {
      toast.error(res.error.message);
      return;
    }
    if (res.data.length === 0) {
      toast.info('No items matched the selected procurement scope.');
      return;
    }
    setDraftLines(
      res.data.map((d: ProcurementDraftLineDto_Serialize) => ({
        item_id: d.item_id,
        item_name: d.item_name,
        section_label: d.section_label,
        buyer_name: '',
        unit_id: d.unit_id,
        unit_code: d.unit_code,
        ordered_qty_str: String(Math.max(1, d.suggested_qty_milli / 1000)),
        est_unit_cost_str: d.est_unit_cost_minor ? String(d.est_unit_cost_minor / 100) : '',
      }))
    );
    toast.success(`Generated ${res.data.length} procurement line${res.data.length === 1 ? '' : 's'}`);
  }

  async function handleSaveProcurementList() {
    if (!listTitle.trim() || draftLines.length === 0) {
      toast.error('Provide a title and generate at least one item line.');
      return;
    }
    setSavingList(true);
    try {
      const res = await commands.createProcurementList({
        title: listTitle.trim(),
        scope,
        department_ids: selDepts,
        extra_charges: draftExtras
          .filter((e) => e.label.trim() && parseCurrencyToMinor(e.amount_str) > 0)
          .map((e) => ({
            label: e.label.trim(),
            amount_minor: parseCurrencyToMinor(e.amount_str),
          })),
        lines: draftLines.map((l) => ({
          item_id: l.item_id,
          section_label: l.section_label,
          buyer_name: l.buyer_name.trim() || null,
          unit_id: l.unit_id || null,
          ordered_qty_milli: parseQtyToMilli(l.ordered_qty_str) || null,
          est_unit_cost_minor: l.est_unit_cost_str.trim()
            ? parseCurrencyToMinor(l.est_unit_cost_str)
            : null,
          budget_amount_minor: null,
        })),
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Created procurement list ${res.data.number}`);
      setBuilderOpen(false);
      setDraftLines([]);
      await loadBase();
    } finally {
      setSavingList(false);
    }
  }

  async function handlePrintList(id: string) {
    const res = await commands.renderProcurementPrintHtml(id);
    if (res.status === 'error') {
      toast.error(res.error.message);
      return;
    }
    printHtmlDocument(res.data);
  }

  async function handleExportXlsx(e: React.FormEvent) {
    e.preventDefault();
    if (!exportListId || !exportPath.trim()) return;
    setExporting(true);
    try {
      const res = await commands.exportProcurementXlsx(exportListId, exportPath.trim());
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Exported Excel workbook to ${res.data}`);
      setExportListId(null);
    } finally {
      setExporting(false);
    }
  }

  async function carryOverToRestock(id: string) {
    const res = await commands.getProcurementList(id);
    if (res.status === 'error') {
      toast.error(res.error.message);
      return;
    }
    const list: ProcurementListDto_Serialize = res.data;
    setLinkedListId(list.id);
    setMExtraCharges(list.extra_charges ?? []);
    setMLines(
      list.lines.map((l) => {
        const qtyMilli = l.ordered_qty_milli ?? l.suggested_qty_milli;
        const catItem = catalog.find((c) => c.id === l.item_id);
        const unitId =
          l.unit_id ??
          catItem?.default_purchase_unit_id ??
          catItem?.base_unit_id ??
          units[0]?.id ??
          '';
        const estMinor =
          l.est_unit_cost_minor != null
            ? Math.round((qtyMilli * l.est_unit_cost_minor) / 1000)
            : (l.budget_amount_minor ?? 0);
        const qtyNum = qtyMilli > 0 ? qtyMilli / 1000 : 1;
        const factor = getItemConversionFactor(l.item_id, unitId);
        return {
          procurement_line_id: l.id,
          item_id: l.item_id,
          item_name: l.item_name,
          unit_id: unitId,
          qty_str: String(qtyNum),
          collection_yield_override_str: factor > 1 ? String(Number((qtyNum * factor).toFixed(2))) : '',
          yield_manually_edited: false,
          line_total_str: estMinor > 0 ? String(estMinor / 100) : '',
        };
      })
    );
    setTab('restock');
    toast.info(`Carried over ${list.lines.length} lines from ${list.number}`);
  }

  // Parser Step 1: Inspect Workbook
  async function handleInspectWorkbook() {
    const effectivePath = encodedUploadPayload || uploadPath.trim();
    if (!effectivePath) {
      toast.error('Click Browse to select an Excel (.xlsx) procurement file.');
      return;
    }
    setInspecting(true);
    try {
      const res = await commands.inspectProcurementWorkbook(effectivePath);
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      setSheets(res.data);
      const defaultSheet =
        res.data.find((s) => s.has_hosila_meta)?.name ?? res.data[0]?.name;
      setSelectedSheets(defaultSheet ? [defaultSheet] : []);
      setParsedDraft(null);
      setConfirmRows([]);
      toast.success(`Detected ${res.data.length} worksheet${res.data.length === 1 ? '' : 's'}`);
    } finally {
      setInspecting(false);
    }
  }

  // Parser Step 2: Parse Selected Sheets
  async function handleParseSheets() {
    const effectivePath = encodedUploadPayload || uploadPath.trim();
    setParsing(true);
    try {
      const res = await commands.parseProcurementWorkbook(effectivePath, selectedSheets);
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      setParsedDraft(res.data);
      setPDisbursement(
        res.data.disbursement_minor ? String(res.data.disbursement_minor / 100) : ''
      );
      const defaultUnitId = units.find((u) => u.code === 'PCS')?.id ?? units[0]?.id ?? '';
      const defaultDeptId = nonStoreDepts[0]?.id ?? '';
      setConfirmRows(
        res.data.lines.map((l) => {
          const qtyMilli = l.raw_qty_milli ?? 1000;
          const totalMinor =
            l.raw_amount_minor ??
            (l.suggested_unit_cost_minor
              ? Math.round((qtyMilli * l.suggested_unit_cost_minor) / 1000)
              : 0);
          return {
            row_key: l.row_key,
            sheet_name: l.sheet_name,
            excel_row: l.excel_row,
            section_label: l.section_label,
            raw_description: l.raw_description,
            raw_unit: l.raw_unit,
            anomalies: l.anomalies,
            anomaly_messages: l.anomaly_messages,
            candidates: l.candidates,
            action: l.matched_item_id ? 'map' : 'create_new',
            item_id: l.matched_item_id ?? l.candidates[0]?.item_id ?? '',
            new_item_name: l.raw_description,
            new_item_department_id: defaultDeptId,
            unit_id: l.resolved_unit_id ?? l.matched_base_unit_id ?? defaultUnitId,
            factor_str: String((l.resolved_factor_milli ?? 1000) / 1000),
            qty_str: l.raw_qty_milli ? String(l.raw_qty_milli / 1000) : '',
            line_total_str: totalMinor > 0 ? String(totalMinor / 100) : '0',
            procurement_line_id: l.procurement_line_id,
            save_alias: l.match_status !== 'exact' && Boolean(l.matched_item_id),
            save_unit_conversion: l.anomalies.includes('UNIT_CONVERSION_NEEDED'),
          };
        })
      );
      toast.success(
        `Parsed ${res.data.lines.length} lines (${res.data.ready_count} ready, ${res.data.needs_attention_count} need attention)`
      );
    } finally {
      setParsing(false);
    }
  }

  // Parser Step 3: Storekeeper Confirmation Gate
  async function handleConfirmParsedRestock() {
    if (!parsedDraft || !pReceivedBy || !pApprovedBy) {
      toast.error('Select both Receiver and Approving Storekeeper.');
      return;
    }
    setConfirmingParse(true);
    try {
      const res = await commands.confirmParsedRestock({
        filename: parsedDraft.filename,
        procurement_list_id: parsedDraft.linked_procurement_list_id,
        supplier_id: null,
        invoice_ref: pInvoice.trim() || null,
        received_by_staff_id: pReceivedBy,
        approved_by_staff_id: pApprovedBy,
        received_at: pDate,
        disbursement_minor: pDisbursement.trim()
          ? parseCurrencyToMinor(pDisbursement)
          : null,
        extra_charges: parsedDraft.extra_charges,
        notes: pNotes.trim() || null,
        lines: confirmRows.map((r) => ({
          raw_description: r.raw_description,
          action: r.action,
          item_id: r.action === 'map' ? r.item_id || null : null,
          new_item_name: r.action === 'create_new' ? r.new_item_name.trim() || null : null,
          new_item_department_id:
            r.action === 'create_new' ? r.new_item_department_id || null : null,
          unit_id: r.unit_id,
          factor_milli: Math.max(1, parseQtyToMilli(r.factor_str)),
          quantity_milli: parseQtyToMilli(r.qty_str),
          line_total_minor: parseCurrencyToMinor(r.line_total_str),
          procurement_line_id: r.procurement_line_id,
          save_alias: r.save_alias,
          save_unit_conversion: r.save_unit_conversion,
        })),
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(
        `Confirmed & posted ${res.data.number} (${res.data.lines.length} restocked items)`
      );
      setParsedDraft(null);
      setConfirmRows([]);
      setTab('receipts');
      await loadBase();
    } finally {
      setConfirmingParse(false);
    }
  }

  // Manual GRN Restock
  async function handlePostManualReceipt() {
    if (!mReceivedBy || !mApprovedBy || mLines.length === 0) {
      toast.error('Select Receiver, Approving Storekeeper, and at least one item.');
      return;
    }
    setPostingReceipt(true);
    try {
      const res = await commands.createReceipt({
        procurement_list_id: linkedListId,
        supplier_id: mSupplierId || null,
        invoice_ref: mInvoice.trim() || null,
        received_by_staff_id: mReceivedBy,
        approved_by_staff_id: mApprovedBy,
        received_at: mDate,
        disbursement_minor: mDisbursement.trim()
          ? parseCurrencyToMinor(mDisbursement)
          : null,
        extra_charges: mExtraCharges,
        notes: mNotes.trim() || null,
        lines: mLines.map((l) => {
          const catItem = catalog.find((c) => c.id === l.item_id);
          const factor = getItemConversionFactor(l.item_id, l.unit_id);
          const hasBatchYieldOverride = Boolean(
            catItem &&
            factor > 1 &&
            l.yield_manually_edited &&
            l.collection_yield_override_str.trim() !== '' &&
            parseQtyToMilli(l.collection_yield_override_str) > 0
          );

          const effectiveUnitId = hasBatchYieldOverride && catItem ? catItem.base_unit_id : l.unit_id;
          const qtyMilli = hasBatchYieldOverride
            ? parseQtyToMilli(l.collection_yield_override_str)
            : parseQtyToMilli(l.qty_str);
          const totalMinor = parseCurrencyToMinor(l.line_total_str);
          const unitCostMinor = qtyMilli > 0 ? Math.round((totalMinor * 1000) / qtyMilli) : 0;

          return {
            procurement_line_id: l.procurement_line_id,
            item_id: l.item_id,
            unit_id: effectiveUnitId,
            input_qty_milli: qtyMilli,
            unit_cost_minor: unitCostMinor,
            line_total_minor: totalMinor,
          };
        }),
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Posted Goods Receipt ${res.data.number}`);
      setMLines([]);
      setMExtraCharges([]);
      setLinkedListId(null);
      setMInvoice('');
      setMNotes('');
      setTab('receipts');
      await loadBase();
    } finally {
      setPostingReceipt(false);
    }
  }

  async function executeReverseReceipt(pin: string | null): Promise<boolean> {
    if (!reversingReceipt) return true;
    const res = await commands.reverseReceipt(reversingReceipt.id, revReason.trim(), pin);
    if (res.status === 'error') {
      toast.error(res.error.message);
      return false;
    }
    toast.success(`Reversed ${res.data.number}`);
    setReversingReceipt(null);
    setRevReason('');
    await loadBase();
    return true;
  }

  return (
    <div className="space-y-4">
      {/* Header & Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">
          Procurement &amp; Restock
        </h1>

        <div className="inline-flex p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] flex-wrap">
          {(
            [
              { id: 'lists', label: 'Procurement Lists', icon: ShoppingCart },
              { id: 'parser', label: 'Parse Excel Restock', icon: Sparkles },
              { id: 'restock', label: 'Manual Restock', icon: Plus },
              { id: 'receipts', label: 'Receipts Log', icon: History },
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

      {/* TAB 1: PROCUREMENT LISTS */}
      {tab === 'lists' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            {canWrite && (
              <Button
                variant="primary"
                onClick={() => setBuilderOpen(true)}
                tooltip="Create a new low-stock, full-department, or custom procurement list."
              >
                <Plus className="h-4 w-4" />
                Prepare Procurement List
              </Button>
            )}
          </div>

          {lists.length === 0 ? (
            <EmptyState
              icon={<ShoppingCart className="h-5 w-5" />}
              title="No procurement lists yet"
              description="Generate a low-stock, full-department, or custom procurement list to export to Excel or print."
              action={
                canWrite ? (
                  <Button
                    variant="primary"
                    onClick={() => setBuilderOpen(true)}
                    tooltip="Open the procurement list builder."
                  >
                    <Plus className="h-4 w-4" />
                    Prepare Procurement List
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                    <th className="py-2.5 px-4">Number &amp; Title</th>
                    <th className="py-2.5 px-3">Scope</th>
                    <th className="py-2.5 px-3 text-right">Lines</th>
                    <th className="py-2.5 px-3 text-right">Estimated Total</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {lists.map((l) => (
                    <tr key={l.id} className="hover:bg-[var(--bg-hover)]">
                      <td className="py-2.5 px-4">
                        <div className="font-medium">{l.title}</div>
                        <div className="text-[11px] text-[var(--text-muted)] tabular-nums">
                          {l.number} · Prepared by {l.prepared_by_name}
                        </div>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge tone="neutral">{l.scope.replace('_', ' ')}</Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">{l.line_count}</td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                        {formatMinor(l.estimated_total_minor, currencySymbol)}
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge
                          tone={
                            l.status === 'received' || l.status === 'closed'
                              ? 'success'
                              : l.status === 'partial'
                                ? 'warning'
                                : 'accent'
                          }
                        >
                          {l.status}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            tooltip="Export this procurement list to a formatted Excel (.xlsx) workbook."
                            onClick={() => {
                              setExportListId(l.id);
                              setExportPath(`Downloads\\${l.number}.xlsx`);
                            }}
                          >
                            <Download className="h-3.5 w-3.5" />
                            Excel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            tooltip="Print this procurement list."
                            onClick={() => handlePrintList(l.id)}
                          >
                            <Printer className="h-3.5 w-3.5" />
                            Print
                          </Button>
                          {canWrite && (
                            <Button
                              size="sm"
                              variant="primary"
                              tooltip="Carry all lines from this procurement list into Manual Restock."
                              onClick={() => carryOverToRestock(l.id)}
                            >
                              Restock
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: BUILT-IN RUST PROCUREMENT PARSER & CONFIRMATION GATE */}
      {tab === 'parser' && (
        <div className="space-y-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-[var(--accent-soft)] text-[#6AD4B0] flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <h2 className="text-[14px] font-semibold">
                Parse Procurement Excel Workbook
              </h2>
            </div>

            <div className="flex flex-wrap gap-2 items-end">
              <Field
                label="Excel Workbook (.xlsx)"
                className="flex-1 min-w-[300px]"
              >
                <div className="flex gap-1.5">
                  <Input
                    value={uploadPath}
                    onChange={(e) => {
                      setUploadPath(e.target.value);
                      setEncodedUploadPayload(null);
                    }}
                    placeholder="Click Browse to select a procurement Excel (.xlsx) file..."
                  />
                  <label className="inline-flex items-center justify-center h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium cursor-pointer shrink-0">
                    <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-[#6AD4B0]" />
                    Browse
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setUploadPath(file.name);
                          try {
                            const payload = await encodeExcelFileForBackend(file);
                            setEncodedUploadPayload(payload);
                          } catch (err) {
                            toast.error(
                              err instanceof Error ? err.message : 'Could not read Excel file'
                            );
                          }
                        }
                      }}
                    />
                  </label>
                </div>
              </Field>
              <Button
                variant="primary"
                loading={inspecting}
                onClick={handleInspectWorkbook}
                tooltip="Scan the Excel workbook and list all available worksheets."
              >
                <Upload className="h-4 w-4" />
                Inspect Workbook
              </Button>
            </div>

            {sheets.length > 0 && (
              <div className="pt-2 border-t border-[var(--border-subtle)] space-y-3">
                <div className="text-[12px] font-medium">Select Worksheets to Parse</div>
                <div className="flex flex-wrap gap-2">
                  {sheets.map((s) => {
                    const checked = selectedSheets.includes(s.name);
                    return (
                      <button
                        key={s.name}
                        type="button"
                        onClick={() =>
                          setSelectedSheets((prev) =>
                            checked ? prev.filter((x) => x !== s.name) : [...prev, s.name]
                          )
                        }
                        className={cn(
                          'inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-[12px] transition-all cursor-pointer',
                          checked
                            ? 'border-[#6AD4B0] bg-[var(--accent-soft)] text-[var(--accent-text)] font-medium'
                            : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                        )}
                      >
                        <span>{s.name}</span>
                        <span className="text-[11px] opacity-70 tabular-nums">
                          {s.row_count} rows
                        </span>
                        {s.has_hosila_meta && <Badge tone="accent">Tier 1 Meta</Badge>}
                        {s.detected_buyer && <Badge tone="info">{s.detected_buyer}</Badge>}
                      </button>
                    );
                  })}
                </div>
                <Button
                  variant="primary"
                  loading={parsing}
                  disabled={selectedSheets.length === 0}
                  onClick={handleParseSheets}
                  tooltip="Parse the selected worksheets and open the Storekeeper Confirmation Gate."
                >
                  <Sparkles className="h-4 w-4" />
                  Parse Selected Sheet{selectedSheets.length === 1 ? '' : 's'}
                </Button>
              </div>
            )}
          </div>

          {/* Storekeeper Confirmation Gate */}
          {parsedDraft && (
            <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
              <div className="px-5 py-3.5 border-b border-[var(--border-subtle)] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-[14.5px] font-semibold">Storekeeper Confirmation Gate</h3>
                  <Badge tone={parsedDraft.tier === 'tier1_meta' ? 'accent' : 'info'}>
                    {parsedDraft.tier === 'tier1_meta' ? 'Tier 1 Exact' : 'Tier 2 Smart Match'}
                  </Badge>
                  <Badge tone="success">{parsedDraft.ready_count} Ready</Badge>
                  {parsedDraft.needs_attention_count > 0 && (
                    <Badge tone="warning">
                      <AlertTriangle className="h-3 w-3" />
                      {parsedDraft.needs_attention_count} Need Review
                    </Badge>
                  )}
                </div>
                <div className="text-right tabular-nums text-[12px]">
                  <span className="text-[var(--text-muted)]">Extra Charges: </span>
                  <span className="font-semibold">
                    {formatMinor(
                      parsedDraft.extra_charges.reduce((a, e) => a + e.amount_minor, 0),
                      currencySymbol
                    )}
                  </span>
                </div>
              </div>

              {/* Sign-off header */}
              <div className="p-3.5 border-b border-[var(--border-subtle)] bg-[var(--bg-subtle)]/35 grid grid-cols-1 sm:grid-cols-5 gap-3">
                <Field label="Received By (Buyer/Staff)" required>
                  <Select value={pReceivedBy} onChange={(e) => setPReceivedBy(e.target.value)}>
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Approving Storekeeper" required>
                  <Select value={pApprovedBy} onChange={(e) => setPApprovedBy(e.target.value)}>
                    {storeStaff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.full_name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Receipt Date" required>
                  <Input
                    type="date"
                    value={pDate}
                    onChange={(e) => setPDate(e.target.value)}
                    className="tabular-nums"
                  />
                </Field>
                <Field label={`Disbursement (${currencySymbol})`}>
                  <Input
                    value={pDisbursement}
                    onChange={(e) => setPDisbursement(e.target.value)}
                    placeholder="Optional"
                    className="tabular-nums"
                  />
                </Field>
                <Field label="Invoice / Ref">
                  <Input
                    value={pInvoice}
                    onChange={(e) => setPInvoice(e.target.value)}
                    placeholder="e.g. WK3-MKT"
                  />
                </Field>
              </div>

              {/* Confirmation Lines */}
              <div className="overflow-x-auto max-h-[480px] overflow-y-auto">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[10.5px] uppercase text-[var(--text-muted)]">
                    <tr>
                      <th className="py-2.5 px-3">Excel Item &amp; Anomalies</th>
                      <th className="py-2.5 px-2 w-[108px]">Action</th>
                      <th className="py-2.5 px-2 min-w-[190px]">Target Catalog Item</th>
                      <th className="py-2.5 px-2 w-[88px]">Stock Unit</th>
                      <th className="py-2.5 px-2 w-[78px]">1 Stock = X Col</th>
                      <th className="py-2.5 px-2 w-[78px]">Qty Bought</th>
                      <th className="py-2.5 px-2 w-[112px]">Collection Yield</th>
                      <th className="py-2.5 px-2 w-[105px]">Total ({currencySymbol})</th>
                      <th className="py-2.5 px-3 w-[108px]">Learn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {confirmRows.map((row, idx) => {
                      const matchedCat = catalog.find((c) => c.id === row.item_id);
                      const colCode = matchedCat?.base_unit_code ?? 'Units';
                      const qtyNum = Math.max(parseQtyToMilli(row.qty_str) / 1000, 0);
                      const factorNum = Math.max(parseQtyToMilli(row.factor_str) / 1000, 0);
                      const totalYieldNum = Number((qtyNum * factorNum).toFixed(2));

                      return (
                        <tr
                          key={row.row_key}
                          className={cn(
                            row.action === 'skip' && 'opacity-45',
                            row.anomalies.length > 0 && row.action !== 'skip' && 'bg-[#E05252]/[0.05]'
                          )}
                        >
                          <td className="py-2 px-3 align-top">
                            <div className="font-medium text-[var(--text-primary)]">
                              {row.raw_description}
                            </div>
                            <div className="text-[11px] text-[var(--text-muted)]">
                              Row {row.excel_row} · {row.section_label}
                              {row.raw_unit ? ` · Sheet unit: ${row.raw_unit}` : ''}
                            </div>
                            {row.anomalies.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-1">
                                {row.anomalies.map((code) => {
                                  const b = anomalyBadge(code);
                                  return (
                                    <Badge key={code} tone={b.tone}>
                                      {b.label}
                                    </Badge>
                                  );
                                })}
                              </div>
                            )}
                            {row.anomaly_messages.map((msg, mi) => (
                              <div
                                key={mi}
                                className="text-[11px] text-danger-ink mt-0.5 leading-snug"
                              >
                                {msg}
                              </div>
                            ))}
                          </td>
                          <td className="py-2 px-2 align-top">
                            <Select
                              value={row.action}
                              onChange={(e) => {
                                const next = [...confirmRows];
                                next[idx] = {
                                  ...row,
                                  action: e.target.value as 'map' | 'create_new' | 'skip',
                                };
                                setConfirmRows(next);
                              }}
                              className="h-8 text-[12px]"
                            >
                              <option value="map">Map</option>
                              <option value="create_new">Create New</option>
                              <option value="skip">Skip</option>
                            </Select>
                          </td>
                          <td className="py-2 px-2 align-top">
                            {row.action === 'map' ? (
                              <Select
                                value={row.item_id}
                                onChange={(e) => {
                                  const nextItemId = e.target.value;
                                  const nextFactor = getItemConversionFactor(nextItemId, row.unit_id);
                                  const next = [...confirmRows];
                                  next[idx] = {
                                    ...row,
                                    item_id: nextItemId,
                                    factor_str: String(nextFactor),
                                  };
                                  setConfirmRows(next);
                                }}
                                className="h-8 text-[12px]"
                              >
                                <option value="">Select catalog item...</option>
                                {row.candidates.length > 0 && (
                                  <optgroup label="Suggested Matches">
                                    {row.candidates.map((c) => (
                                      <option key={c.item_id} value={c.item_id}>
                                        {c.item_name} ({Math.round((c.score ?? 0) * 100)}%)
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="All Items">
                                  {catalog.map((c) => (
                                    <option key={c.id} value={c.id}>
                                      {c.name} ({c.base_unit_code})
                                    </option>
                                  ))}
                                </optgroup>
                              </Select>
                            ) : row.action === 'create_new' ? (
                              <div className="space-y-1.5">
                                <Input
                                  value={row.new_item_name}
                                  onChange={(e) => {
                                    const next = [...confirmRows];
                                    next[idx] = { ...row, new_item_name: e.target.value };
                                    setConfirmRows(next);
                                  }}
                                  className="h-8 text-[12px]"
                                  placeholder="New item name"
                                />
                                <Select
                                  value={row.new_item_department_id}
                                  onChange={(e) => {
                                    const next = [...confirmRows];
                                    next[idx] = { ...row, new_item_department_id: e.target.value };
                                    setConfirmRows(next);
                                  }}
                                  className="h-7 text-[11px]"
                                >
                                  {nonStoreDepts.map((d) => (
                                    <option key={d.id} value={d.id}>
                                      Dept: {d.name}
                                    </option>
                                  ))}
                                </Select>
                              </div>
                            ) : (
                              <span className="text-[var(--text-muted)]">Excluded</span>
                            )}
                          </td>
                          <td className="py-2 px-2 align-top">
                            <Select
                              value={row.unit_id}
                              disabled={row.action === 'skip'}
                              onChange={(e) => {
                                const nextUnitId = e.target.value;
                                const nextFactor = getItemConversionFactor(row.item_id, nextUnitId);
                                const next = [...confirmRows];
                                next[idx] = {
                                  ...row,
                                  unit_id: nextUnitId,
                                  factor_str: String(nextFactor),
                                };
                                setConfirmRows(next);
                              }}
                              className="h-8 text-[12px]"
                            >
                              {units.map((u) => (
                                <option key={u.id} value={u.id}>
                                  {u.code}
                                </option>
                              ))}
                            </Select>
                          </td>
                          <td className="py-2 px-2 align-top">
                            <Input
                              value={row.factor_str}
                              disabled={row.action === 'skip'}
                              onChange={(e) => {
                                const next = [...confirmRows];
                                next[idx] = { ...row, factor_str: e.target.value };
                                setConfirmRows(next);
                              }}
                              className="h-8 text-right tabular-nums text-[12px]"
                            />
                          </td>
                          <td className="py-2 px-2 align-top">
                            <Input
                              value={row.qty_str}
                              disabled={row.action === 'skip'}
                              onChange={(e) => {
                                const next = [...confirmRows];
                                next[idx] = { ...row, qty_str: e.target.value };
                                setConfirmRows(next);
                              }}
                              placeholder="Qty"
                              className={cn(
                                'h-8 text-right tabular-nums text-[12px]',
                                !row.qty_str.trim() && row.action !== 'skip' && 'border-[var(--danger)]'
                              )}
                            />
                          </td>
                          <td className="py-2 px-2 align-top">
                            <div className="space-y-0.5">
                              <Input
                                value={qtyNum > 0 ? String(totalYieldNum) : ''}
                                disabled={row.action === 'skip' || qtyNum <= 0}
                                onChange={(e) => {
                                  const desiredYield = Number(e.target.value);
                                  if (qtyNum > 0 && Number.isFinite(desiredYield) && desiredYield > 0) {
                                    const next = [...confirmRows];
                                    next[idx] = {
                                      ...row,
                                      factor_str: String(Number((desiredYield / qtyNum).toFixed(3))),
                                    };
                                    setConfirmRows(next);
                                  }
                                }}
                                className="h-8 text-right tabular-nums text-[12px]"
                              />
                              <div className="text-[10px] text-[var(--text-muted)] text-right">
                                {colCode}
                              </div>
                            </div>
                          </td>
                          <td className="py-2 px-2 align-top">
                            <Input
                              value={row.line_total_str}
                              disabled={row.action === 'skip'}
                              onChange={(e) => {
                                const next = [...confirmRows];
                                next[idx] = { ...row, line_total_str: e.target.value };
                                setConfirmRows(next);
                              }}
                              className="h-8 text-right tabular-nums text-[12px]"
                            />
                          </td>
                          <td className="py-2 px-3 align-top space-y-1">
                            {row.action === 'map' && (
                              <>
                                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={row.save_alias}
                                    onChange={(e) => {
                                      const next = [...confirmRows];
                                      next[idx] = { ...row, save_alias: e.target.checked };
                                      setConfirmRows(next);
                                    }}
                                  />
                                  Save alias
                                </label>
                                <label className="flex items-center gap-1.5 text-[11px] cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={row.save_unit_conversion}
                                    onChange={(e) => {
                                      const next = [...confirmRows];
                                      next[idx] = {
                                        ...row,
                                        save_unit_conversion: e.target.checked,
                                      };
                                      setConfirmRows(next);
                                    }}
                                  />
                                  Save UoM
                                </label>
                              </>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="px-5 py-3.5 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 flex flex-wrap items-center justify-between gap-4">
                <Input
                  value={pNotes}
                  onChange={(e) => setPNotes(e.target.value)}
                  placeholder="Optional storekeeper confirmation notes..."
                  className="max-w-md"
                />
                <Button
                  variant="primary"
                  size="lg"
                  loading={confirmingParse}
                  disabled={!canWrite}
                  onClick={handleConfirmParsedRestock}
                  tooltip="Approve and post all included rows to inventory stock and Goods Receipts."
                >
                  <CheckCircle2 className="h-4 w-4" />
                  Confirm &amp; Post Restock (
                  {confirmRows.filter((r) => r.action !== 'skip').length} lines)
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 3: MANUAL RESTOCK (GRN) */}
      {tab === 'restock' && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Field label="Received By" required>
              <Select value={mReceivedBy} onChange={(e) => setMReceivedBy(e.target.value)}>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Approved By (Store)" required>
              <Select value={mApprovedBy} onChange={(e) => setMApprovedBy(e.target.value)}>
                {storeStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.full_name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Date" required>
              <Input
                type="date"
                value={mDate}
                onChange={(e) => setMDate(e.target.value)}
                className="tabular-nums"
              />
            </Field>
            <Field label="Supplier">
              <Select value={mSupplierId} onChange={(e) => setMSupplierId(e.target.value)}>
                <option value="">Market / Direct</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Invoice Ref">
              <Input
                value={mInvoice}
                onChange={(e) => setMInvoice(e.target.value)}
                placeholder="Optional"
              />
            </Field>
            <Field label={`Disbursement (${currencySymbol})`}>
              <Input
                value={mDisbursement}
                onChange={(e) => setMDisbursement(e.target.value)}
                placeholder="Optional"
                className="tabular-nums"
              />
            </Field>
          </div>

          <div className="flex gap-2 items-center">
            <Select
              value={mAddItemId}
              onChange={(e) => setMAddItemId(e.target.value)}
              className="max-w-md"
            >
              <option value="">Add catalog item to restock...</option>
              {catalog.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.base_unit_code})
                </option>
              ))}
            </Select>
            <Button
              variant="secondary"
              disabled={!mAddItemId}
              tooltip="Add the selected item to this Goods Receipt."
              onClick={() => {
                const it = catalog.find((c) => c.id === mAddItemId);
                if (!it) return;
                const purchaseUnitId = it.default_purchase_unit_id || it.base_unit_id;
                const factor = getItemConversionFactor(it.id, purchaseUnitId);
                setMLines((prev) => [
                  ...prev,
                  {
                    procurement_line_id: null,
                    item_id: it.id,
                    item_name: it.name,
                    unit_id: purchaseUnitId,
                    qty_str: '1',
                    collection_yield_override_str: factor > 1 ? String(factor) : '',
                    yield_manually_edited: false,
                    line_total_str: it.avg_cost_micro
                      ? String(Number(((it.avg_cost_micro / 1_000_000) * factor).toFixed(2)))
                      : '0',
                  },
                ]);
                setMAddItemId('');
              }}
            >
              <Plus className="h-4 w-4" />
              Add Line
            </Button>
          </div>

          {mLines.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-2 w-[130px]">Stocking Unit</th>
                    <th className="py-2 px-2 w-[110px]">Qty Bought</th>
                    <th className="py-2 px-2 w-[180px]">Collection Units Yielded</th>
                    <th className="py-2 px-2 w-[150px]">Line Total ({currencySymbol})</th>
                    <th className="py-2 px-3 w-[48px]" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {mLines.map((l, idx) => {
                    const catItem = catalog.find((c) => c.id === l.item_id);
                    const compatibleUnits = catItem ? getCompatibleUnits(catItem, units) : units;
                    const factor = getItemConversionFactor(l.item_id, l.unit_id);
                    const isSplit = factor > 1;
                    return (
                      <tr key={`${l.item_id}-${idx}`}>
                        <td className="py-2 px-3">
                          <div className="font-medium">{l.item_name}</div>
                          {isSplit && catItem && (
                            <div className="text-[11px] text-[var(--accent-text)]">
                              Standard: 1 {units.find((u) => u.id === l.unit_id)?.code} = {factor}{' '}
                              {catItem.base_unit_code}
                            </div>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Select
                            value={l.unit_id}
                            onChange={(e) => {
                              const nextUnitId = e.target.value;
                              const nextFactor = getItemConversionFactor(l.item_id, nextUnitId);
                              const qtyNum = Number(l.qty_str) || 0;
                              const next = [...mLines];
                              next[idx] = {
                                ...l,
                                unit_id: nextUnitId,
                                collection_yield_override_str:
                                  nextFactor > 1 ? String(Number((qtyNum * nextFactor).toFixed(2))) : '',
                                yield_manually_edited: false,
                              };
                              setMLines(next);
                            }}
                            className="h-8 text-[12.5px]"
                          >
                            {compatibleUnits.map((u) => (
                              <option key={u.id} value={u.id}>
                                {u.code}
                              </option>
                            ))}
                          </Select>
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            value={l.qty_str}
                            onChange={(e) => {
                              const nextQtyStr = e.target.value;
                              const qtyNum = Number(nextQtyStr) || 0;
                              const next = [...mLines];
                              next[idx] = {
                                ...l,
                                qty_str: nextQtyStr,
                                collection_yield_override_str: isSplit
                                  ? String(Number((qtyNum * factor).toFixed(2)))
                                  : '',
                                yield_manually_edited: false,
                              };
                              setMLines(next);
                            }}
                            className="h-8 text-right tabular-nums"
                          />
                        </td>
                        <td className="py-2 px-2">
                          {isSplit && catItem ? (
                            <div className="flex items-center gap-1.5">
                              <Input
                                value={l.collection_yield_override_str}
                                onChange={(e) => {
                                  const next = [...mLines];
                                  next[idx] = {
                                    ...l,
                                    collection_yield_override_str: e.target.value,
                                    yield_manually_edited: true,
                                  };
                                  setMLines(next);
                                }}
                                className="h-8 text-right tabular-nums"
                              />
                              <span className="text-[11.5px] font-medium text-[var(--text-secondary)] shrink-0">
                                {catItem.base_unit_code}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[12px] text-[var(--text-muted)] tabular-nums">
                              {l.qty_str} {catItem?.base_unit_code}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            value={l.line_total_str}
                            onChange={(e) => {
                              const next = [...mLines];
                              next[idx] = { ...l, line_total_str: e.target.value };
                              setMLines(next);
                            }}
                            className="h-8 text-right tabular-nums"
                          />
                        </td>
                        <td className="py-2 px-3 text-right">
                          <button
                            type="button"
                            onClick={() => setMLines(mLines.filter((_, i) => i !== idx))}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {mExtraCharges.length > 0 && (
            <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/35 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <span className="font-medium text-[var(--text-secondary)]">
                Extra Charges ({mExtraCharges.length}):{' '}
                {mExtraCharges
                  .map((ex) => `${ex.label} (${formatMinor(ex.amount_minor, currencySymbol)})`)
                  .join(' · ')}
              </span>
              <button
                type="button"
                onClick={() => setMExtraCharges([])}
                className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
              >
                Clear Charges
              </button>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[var(--border-subtle)]">
            <Input
              value={mNotes}
              onChange={(e) => setMNotes(e.target.value)}
              placeholder="Receipt notes..."
              className="max-w-md"
            />
            <Button
              variant="primary"
              size="lg"
              loading={postingReceipt}
              disabled={!canWrite || mLines.length === 0}
              onClick={handlePostManualReceipt}
              tooltip="Post this Goods Receipt to inventory and update Weighted Average Cost."
            >
              <CheckCircle2 className="h-4 w-4" />
              Post Goods Receipt
            </Button>
          </div>
        </div>
      )}

      {/* TAB 4: RECEIPTS LOG */}
      {tab === 'receipts' &&
        (receipts.length === 0 ? (
          <EmptyState
            icon={<History className="h-5 w-5" />}
            title="No restock receipts posted yet"
            description="Posted manual receipts and confirmed Excel procurement uploads will appear here."
          />
        ) : (
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">GRN #</th>
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Source</th>
                  <th className="py-2.5 px-3">Received / Approved</th>
                  <th className="py-2.5 px-3 text-right">Lines</th>
                  <th className="py-2.5 px-3 text-right">Total</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {receipts.map((r) => (
                  <tr key={r.id} className="hover:bg-[var(--bg-hover)]">
                    <td className="py-2.5 px-4 font-medium tabular-nums">{r.number}</td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)] tabular-nums">
                      {formatDateShort(r.received_at)}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge
                        tone={
                          r.source_type === 'parsed_excel'
                            ? 'accent'
                            : r.source_type === 'seed'
                              ? 'info'
                              : 'neutral'
                        }
                      >
                        {r.source_type.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3">
                      <div>{r.received_by_name}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">
                        Approved by {r.approved_by_name}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{r.lines.length}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-medium">
                      {formatMinor(r.total_minor, currencySymbol)}
                    </td>
                    <td className="py-2.5 px-3">
                      <Badge tone={r.status === 'posted' ? 'success' : 'danger'}>
                        {r.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {r.status === 'posted' && canWrite && (
                        <Button
                          size="sm"
                          variant="ghost"
                          tooltip="Reverse this Goods Receipt and deduct its received stock."
                          onClick={() => {
                            setReversingReceipt(r);
                            setRevReason('');
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
        ))}

      {/* Prepare Procurement List Drawer */}
      <Drawer
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        title="Prepare Procurement List"
        width="max-w-3xl"
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuilderOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={savingList}
              disabled={draftLines.length === 0}
              onClick={handleSaveProcurementList}
              tooltip="Save this procurement list so it can be exported to Excel or printed."
            >
              Save Procurement List ({draftLines.length})
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label="List Title" required>
            <Input value={listTitle} onChange={(e) => setListTitle(e.target.value)} />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                { id: 'low_stock', label: 'Low Stock Only' },
                { id: 'full', label: 'Full Department' },
                { id: 'custom', label: 'Custom Picker' },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setScope(s.id)}
                className={cn(
                  'h-9 rounded-lg border text-[12px] font-medium transition-all cursor-pointer',
                  scope === s.id
                    ? 'border-[#6AD4B0] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                    : 'border-[var(--border-subtle)] bg-[var(--bg-card)] text-[var(--text-secondary)]'
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {scope !== 'custom' ? (
            <Field label="Select Departments to Include">
              <div className="flex flex-wrap gap-2">
                {nonStoreDepts.map((d) => {
                  const checked = selDepts.includes(d.id);
                  return (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() =>
                        setSelDepts((prev) =>
                          checked ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                        )
                      }
                      className={cn(
                        'px-3 py-1.5 rounded-lg border text-[12px] font-medium cursor-pointer',
                        checked
                          ? 'border-[#6AD4B0] bg-[var(--accent-soft)] text-[var(--accent-text)]'
                          : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                      )}
                    >
                      {d.name}
                    </button>
                  );
                })}
              </div>
            </Field>
          ) : (
            <div className="space-y-2">
              <Input
                value={customSearch}
                onChange={(e) => setCustomSearch(e.target.value)}
                placeholder="Search items across departments to include..."
              />
              <div className="max-h-40 overflow-y-auto border border-[var(--border-subtle)] rounded-xl divide-y divide-[var(--border-subtle)]">
                {catalog
                  .filter((c) =>
                    c.name.toLowerCase().includes(customSearch.trim().toLowerCase())
                  )
                  .slice(0, 40)
                  .map((c) => {
                    const checked = customItemIds.includes(c.id);
                    return (
                      <label
                        key={c.id}
                        className="flex items-center justify-between px-3 py-2 text-[12px] hover:bg-[var(--bg-hover)] cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setCustomItemIds((prev) =>
                                e.target.checked
                                  ? [...prev, c.id]
                                  : prev.filter((x) => x !== c.id)
                              )
                            }
                          />
                          <span>{c.name}</span>
                        </span>
                        <span className="text-[11px] text-[var(--text-muted)] tabular-nums">
                          {formatMilli(c.on_hand_milli)} {c.base_unit_code}
                        </span>
                      </label>
                    );
                  })}
              </div>
            </div>
          )}

          <Button
            variant="secondary"
            onClick={handleGenerateDraft}
            tooltip="Populate procurement lines matching the selected scope and departments."
          >
            Generate Draft Lines
          </Button>

          {draftLines.length > 0 && (
            <div className="space-y-3">
              <div className="rounded-xl border border-[var(--border-subtle)] overflow-hidden">
                <table className="w-full text-left border-collapse text-[12px]">
                  <thead>
                    <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[10.5px] uppercase text-[var(--text-muted)]">
                      <th className="py-2 px-3">Item / Section</th>
                      <th className="py-2 px-2 w-[110px]">Buyer</th>
                      <th className="py-2 px-2 w-[78px]">Qty</th>
                      <th className="py-2 px-2 w-[110px]">Est Price</th>
                      <th className="py-2 px-2 w-[36px]" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {draftLines.map((dl, idx) => (
                      <tr key={dl.item_id}>
                        <td className="py-2 px-3">
                          <div className="font-medium">{dl.item_name}</div>
                          <div className="text-[11px] text-[var(--text-muted)]">
                            {dl.section_label} · {dl.unit_code}
                          </div>
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            value={dl.buyer_name}
                            onChange={(e) => {
                              const next = [...draftLines];
                              next[idx] = { ...dl, buyer_name: e.target.value };
                              setDraftLines(next);
                            }}
                            placeholder="e.g. NINA"
                            className="h-7 text-[12px]"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            value={dl.ordered_qty_str}
                            onChange={(e) => {
                              const next = [...draftLines];
                              next[idx] = { ...dl, ordered_qty_str: e.target.value };
                              setDraftLines(next);
                            }}
                            className="h-7 text-right tabular-nums text-[12px]"
                          />
                        </td>
                        <td className="py-2 px-2">
                          <Input
                            value={dl.est_unit_cost_str}
                            onChange={(e) => {
                              const next = [...draftLines];
                              next[idx] = { ...dl, est_unit_cost_str: e.target.value };
                              setDraftLines(next);
                            }}
                            placeholder="0.00"
                            className="h-7 text-right tabular-nums text-[12px]"
                          />
                        </td>
                        <td className="py-2 px-2 text-right">
                          <button
                            type="button"
                            onClick={() => setDraftLines(draftLines.filter((_, i) => i !== idx))}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Extra charges */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[12px] font-medium">
                  <span>Extra Charges (Transport, Bank Charges, Grinding)</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      setDraftExtras([...draftExtras, { label: '', amount_str: '' }])
                    }
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Charge
                  </Button>
                </div>
                {draftExtras.map((ex, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input
                      value={ex.label}
                      onChange={(e) => {
                        const next = [...draftExtras];
                        next[idx] = { ...ex, label: e.target.value };
                        setDraftExtras(next);
                      }}
                      placeholder="Label"
                      className="col-span-7 h-8 text-[12px]"
                    />
                    <Input
                      value={ex.amount_str}
                      onChange={(e) => {
                        const next = [...draftExtras];
                        next[idx] = {
                          ...ex,
                          amount_str: e.target.value,
                        };
                        setDraftExtras(next);
                      }}
                      placeholder="Amount"
                      className="col-span-4 h-8 text-right tabular-nums text-[12px]"
                    />
                    <button
                      type="button"
                      onClick={() => setDraftExtras(draftExtras.filter((_, i) => i !== idx))}
                      className="col-span-1 text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Drawer>

      {/* Export XLSX Modal */}
      <Modal
        open={Boolean(exportListId)}
        onOpenChange={(o) => {
          if (!o) setExportListId(null);
        }}
        title="Export Procurement List to Excel (.xlsx)"
        footer={
          <>
            <Button variant="ghost" onClick={() => setExportListId(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={exporting}
              onClick={handleExportXlsx}
              tooltip="Write the formatted Excel workbook to the output path."
            >
              <Download className="h-4 w-4" />
              Export .xlsx
            </Button>
          </>
        }
      >
        <form onSubmit={handleExportXlsx}>
          <Field label="Output File Path" required>
            <Input
              autoFocus
              value={exportPath}
              onChange={(e) => setExportPath(e.target.value)}
            />
          </Field>
        </form>
      </Modal>

      {/* Reverse Receipt Modal */}
      <Modal
        open={Boolean(reversingReceipt)}
        onOpenChange={(o) => {
          if (!o) setReversingReceipt(null);
        }}
        title={`Reverse ${reversingReceipt?.number ?? ''}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setReversingReceipt(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              disabled={!revReason.trim()}
              onClick={() => {
                if (isAdmin) void executeReverseReceipt(null);
                else setPinModalOpen(true);
              }}
              tooltip="Confirm reversal and deduct these received quantities from stock."
            >
              Confirm Reversal
            </Button>
          </>
        }
      >
        <Field label="Reason for Reversal" required>
          <Input
            autoFocus
            value={revReason}
            onChange={(e) => setRevReason(e.target.value)}
            placeholder="e.g. Duplicate upload"
          />
        </Field>
      </Modal>

      <PinModal
        open={pinModalOpen}
        onOpenChange={setPinModalOpen}
        title="Manager PIN to Reverse Receipt"
        onConfirm={(pin) => executeReverseReceipt(pin)}
      />
    </div>
  );
}
