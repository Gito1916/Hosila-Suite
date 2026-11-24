import { useMemo, useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  FolderOpen,
  Search,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type WeeklySheetImportPreview_Serialize,
} from '../../../bindings/bindings';
import { useApp } from '../../context/AppContext';
import { Button } from '../ui/Button';
import { Badge } from '../ui/Badge';
import { Field, Input, Select } from '../ui/Field';
import {
  encodeExcelFileForBackend,
  formatMinor,
  parseQtyToMilli,
  parseUnitCostToMicro,
  todayIso,
} from '../../lib/format';

export interface EditablePreviewRow {
  row_number: number;
  include: boolean;
  original_name: string;
  item_name: string;
  department: string;
  store_section: string;
  stocking_unit_code: string;
  collection_unit_code: string;
  factor_str: string;
  closing_str: string;
  unit_cost_str: string;
  original_closing_milli: number;
  original_unit_cost_micro: number;
  original_unit_code: string;
  edited: boolean;
}

export function ImportInventoryReviewer({
  onComplete,
  onSkip,
  compact = false,
}: {
  onComplete?: () => void;
  onSkip?: () => void;
  compact?: boolean;
}) {
  const { units, currencySymbol, refreshReferenceData } = useApp();

  const [filePath, setFilePath] = useState('');
  const [encodedFilePayload, setEncodedFilePayload] = useState<string | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [profile, setProfile] = useState<'de_palms' | 'generic'>('de_palms');
  const [openingDate, setOpeningDate] = useState(todayIso());
  const [purchaseDate, setPurchaseDate] = useState(todayIso());

  const [preview, setPreview] = useState<WeeklySheetImportPreview_Serialize | null>(null);
  const [rows, setRows] = useState<EditablePreviewRow[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleParsePreview() {
    const effectivePath = encodedFilePayload || filePath.trim();
    if (!effectivePath) {
      toast.error('Click Browse to select your Excel (.xlsx) inventory sheet.');
      return;
    }
    setBusy(true);
    try {
      const res = await commands.previewWeeklySheetImport({
        file_path: effectivePath,
        sheet_name: sheetName.trim() || null,
        opening_date: openingDate,
        purchase_date: purchaseDate,
        profile,
        excluded_row_numbers: null,
      });
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      setPreview(res.data);
      setRows(
        res.data.rows.map((r) => ({
          row_number: r.row_number,
          include: true,
          original_name: r.item_name,
          item_name: r.item_name,
          department: r.department,
          store_section: r.store_section ?? '',
          stocking_unit_code: r.unit_code,
          collection_unit_code: r.unit_code,
          factor_str: '1',
          closing_str: String(r.closing_milli / 1000),
          unit_cost_str: r.cost_missing ? '' : String(r.unit_cost_micro / 1_000_000),
          original_closing_milli: r.closing_milli,
          original_unit_cost_micro: r.unit_cost_micro,
          original_unit_code: r.unit_code,
          edited: false,
        }))
      );
      toast.success(`Parsed ${res.data.total_items} items for review`);
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveAndCommit() {
    if (!preview) return;
    const effectivePath = encodedFilePayload || filePath.trim();
    const excludedRowNumbers = rows.filter((r) => !r.include).map((r) => r.row_number);
    setBusy(true);
    try {
      const commitRes = await commands.commitWeeklySheetImport({
        file_path: effectivePath,
        sheet_name: sheetName.trim() || null,
        opening_date: openingDate,
        purchase_date: purchaseDate,
        profile,
        excluded_row_numbers: excludedRowNumbers.length > 0 ? excludedRowNumbers : null,
      });
      if (commitRes.status === 'error') {
        toast.error(commitRes.error.message);
        return;
      }

      // Apply any row adjustments made by the user in the review table
      const editedRows = rows.filter((r) => r.include && r.edited);
      if (editedRows.length > 0) {
        const [allItemsRes, allUnitsRes, allDeptsRes, allSecsRes] = await Promise.all([
          commands.listItems({
            cost_missing_only: false,
            returnable_only: false,
            include_inactive: false,
          }),
          commands.listUnits(),
          commands.listDepartments(false),
          commands.listStoreSections(false),
        ]);

        if (allItemsRes.status === 'error') {
          toast.error(allItemsRes.error.message);
          return;
        }
        if (allUnitsRes.status === 'error') {
          toast.error(allUnitsRes.error.message);
          return;
        }
        if (allDeptsRes.status === 'error') {
          toast.error(allDeptsRes.error.message);
          return;
        }
        if (allSecsRes.status === 'error') {
          toast.error(allSecsRes.error.message);
          return;
        }

        const catalog = allItemsRes.data;
        const unitList = allUnitsRes.data;
        const deptList = allDeptsRes.data;
        const secList = allSecsRes.data;

        const unitByCode = new Map(unitList.map((u) => [u.code.toUpperCase(), u]));
        const deptByName = new Map(deptList.map((d) => [d.name.toLowerCase(), d]));
        const secByName = new Map(secList.map((s) => [s.name.toLowerCase(), s]));
        const closingAdjustments: { item_id: string; unit_id: string; delta_qty_milli: number }[] = [];

        for (const row of editedRows) {
          const item = catalog.find(
            (i) => i.name.toLowerCase() === row.original_name.toLowerCase()
          );
          if (!item) continue;

          const stockingUnit =
            unitByCode.get(row.stocking_unit_code.toUpperCase()) ??
            unitByCode.get(item.base_unit_code.toUpperCase());
          const collectionUnit =
            unitByCode.get(row.collection_unit_code.toUpperCase()) ?? stockingUnit;
          const factorNum = Math.max(1, Number(row.factor_str) || 1);
          const factorMilli = Math.round(factorNum * 1000);

          let currentBaseUnitId = item.base_unit_id;
          // If Collection Unit differs from imported base unit, rescale base unit to Collection Unit
          if (collectionUnit && collectionUnit.id !== item.base_unit_id) {
            const rescaleRes = await commands.changeItemBaseUnit(item.id, {
              new_base_unit_id: collectionUnit.id,
              conversion_factor_milli: factorMilli,
              reason: `Configured stocking (${row.stocking_unit_code}) to collection (${row.collection_unit_code}) unit on import`,
            });
            if (rescaleRes.status === 'error') {
              toast.error(`${row.original_name}: ${rescaleRes.error.message}`);
              return;
            }
            currentBaseUnitId = rescaleRes.data.base_unit_id;
          }

          const deptName = row.department.trim();
          let targetDept = deptName ? deptByName.get(deptName.toLowerCase()) : undefined;
          if (deptName && !targetDept) {
            const createdDept = await commands.createDepartment({
              name: deptName,
              color: null,
              sort_order: null,
            });
            if (createdDept.status === 'error') {
              toast.error(createdDept.error.message);
              return;
            }
            targetDept = createdDept.data;
            deptByName.set(deptName.toLowerCase(), targetDept);
          }

          const secName = row.store_section.trim();
          let targetSec = secName ? secByName.get(secName.toLowerCase()) : undefined;
          if (secName && !targetSec) {
            const createdSec = await commands.createStoreSection({
              name: secName,
              sort_order: null,
            });
            if (createdSec.status === 'error') {
              toast.error(createdSec.error.message);
              return;
            }
            targetSec = createdSec.data;
            secByName.set(secName.toLowerCase(), targetSec);
          }

          const costMissing = row.unit_cost_str.trim() === '';
          const stockingCostMicro = costMissing
            ? 0
            : parseUnitCostToMicro(row.unit_cost_str);
          const baseUnitCostMicro =
            stockingUnit && collectionUnit && stockingUnit.id !== collectionUnit.id && factorNum > 0
              ? Math.round(stockingCostMicro / factorNum)
              : stockingCostMicro;

          const itemUnits =
            stockingUnit && collectionUnit && stockingUnit.id !== collectionUnit.id
              ? [
                  {
                    unit_id: stockingUnit.id,
                    factor_milli: factorMilli,
                    can_purchase: true,
                    can_issue: true,
                    label_override: null,
                  },
                ]
              : [];

          const updRes = await commands.updateItem(item.id, {
            name: row.item_name.trim() || row.original_name,
            display_unit_id: stockingUnit?.id ?? currentBaseUnitId,
            default_issue_unit_id: collectionUnit?.id ?? currentBaseUnitId,
            default_purchase_unit_id: stockingUnit?.id ?? currentBaseUnitId,
            store_section_id: targetSec?.id ?? null,
            clear_store_section: !targetSec,
            department_ids: targetDept ? [targetDept.id] : item.department_ids,
            item_units: itemUnits,
            unit_cost_micro: baseUnitCostMicro,
            cost_missing: costMissing,
          });
          if (updRes.status === 'error') {
            toast.error(`${row.original_name}: ${updRes.error.message}`);
            return;
          }

          const editedStockingClosingMilli = parseQtyToMilli(row.closing_str);
          if (editedStockingClosingMilli !== row.original_closing_milli) {
            const targetBaseClosing =
              collectionUnit && collectionUnit.id !== item.base_unit_id
                ? Math.round(editedStockingClosingMilli * factorNum)
                : editedStockingClosingMilli;
            const deltaMilli = targetBaseClosing - updRes.data.on_hand_milli;
            if (deltaMilli !== 0) {
              closingAdjustments.push({
                item_id: item.id,
                unit_id: currentBaseUnitId,
                delta_qty_milli: deltaMilli,
              });
            }
          }
        }

        if (closingAdjustments.length > 0) {
          const adjRes = await commands.createAdjustment({
            reason: 'count_correction',
            notes: 'Adjusted opening balance during Excel import review',
            adjustment_date: openingDate,
            manager_pin: null,
            lines: closingAdjustments,
          });
          if (adjRes.status === 'error') {
            toast.error(adjRes.error.message);
            return;
          }
        }
      }

      await refreshReferenceData();
      toast.success(
        `Approved & imported ${rows.filter((r) => r.include).length} inventory items.`
      );
      setPreview(null);
      setRows([]);
      onComplete?.();
    } finally {
      setBusy(false);
    }
  }

  function updateRow(idx: number, patch: Partial<EditablePreviewRow>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch, edited: true };
      return next;
    });
  }

  const deptsInSheet = useMemo(
    () => Array.from(new Set(rows.map((r) => r.department))).sort(),
    [rows]
  );

  const visibleRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .map((row, idx) => ({ row, idx }))
      .filter(({ row }) => {
        if (deptFilter && row.department !== deptFilter) return false;
        if (q && !row.item_name.toLowerCase().includes(q)) return false;
        return true;
      });
  }, [rows, search, deptFilter]);

  const summary = useMemo(() => {
    let activeCount = 0;
    let missingCost = 0;
    let totalMinor = 0;
    for (const r of rows) {
      if (!r.include) continue;
      activeCount++;
      const costNum = Number(r.unit_cost_str.replace(/,/g, '')) || 0;
      const qtyNum = Number(r.closing_str.replace(/,/g, '')) || 0;
      if (!r.unit_cost_str.trim() || costNum <= 0) {
        missingCost++;
      } else {
        totalMinor += Math.round(qtyNum * costNum * 100);
      }
    }
    return { activeCount, missingCost, totalMinor };
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
        <Field label="Excel Workbook (.xlsx)" required className="sm:col-span-6">
          <div className="flex gap-1.5">
            <Input
              value={filePath}
              onChange={(e) => {
                setFilePath(e.target.value);
                setEncodedFilePayload(null);
              }}
              placeholder="Click Browse to select an Excel (.xlsx) file..."
            />
            <label className="inline-flex items-center justify-center h-9 px-3 rounded-xl border border-ink/15 bg-surface hover:bg-ink/[0.04] text-xs font-medium text-ink cursor-pointer shrink-0 transition-colors">
              <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-accent-ink" />
              Browse
              <input
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setFilePath(file.name);
                    try {
                      const payload = await encodeExcelFileForBackend(file);
                      setEncodedFilePayload(payload);
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : 'Could not read Excel file');
                    }
                  }
                }}
              />
            </label>
          </div>
        </Field>
        <Field label="Sheet Name" className="sm:col-span-2">
          {preview && preview.available_sheets.length > 1 ? (
            <Select
              value={sheetName || preview.sheet_name}
              onChange={(e) => setSheetName(e.target.value)}
            >
              {preview.available_sheets.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={sheetName}
              onChange={(e) => setSheetName(e.target.value)}
              placeholder="Auto (latest tab)"
            />
          )}
        </Field>
        <Field label="Format Profile" className="sm:col-span-2">
          <Select
            value={profile}
            onChange={(e) => setProfile(e.target.value as 'de_palms' | 'generic')}
          >
            <option value="de_palms">Hosila Hospitality Sheet</option>
            <option value="generic">Standard Sheet</option>
          </Select>
        </Field>
        <div className="sm:col-span-2 flex gap-1.5">
          <Button
            variant="primary"
            loading={busy}
            onClick={handleParsePreview}
            tooltip="Parse Excel workbook and preview items for adjustment before posting"
            className="w-full"
          >
            <Upload className="h-3.5 w-3.5" />
            Parse Sheet
          </Button>
        </div>
      </div>

      {!compact && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Opening Date">
            <Input
              type="date"
              value={openingDate}
              onChange={(e) => setOpeningDate(e.target.value)}
              className="tabular-nums"
            />
          </Field>
          <Field label="Purchases Date">
            <Input
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              className="tabular-nums"
            />
          </Field>
        </div>
      )}

      {/* Interactive Review & Adjustment Table */}
      {preview && rows.length > 0 && (
        <div className="rounded-2xl border border-ink/10 bg-surface overflow-hidden space-y-0">
          {/* Summary Bar */}
          <div className="px-4 py-3 border-b border-ink/10 bg-ink/[0.02] flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <FileSpreadsheet className="h-4 w-4 text-accent-ink" />
              <span className="text-sm font-semibold text-ink">
                Review &amp; Adjust Parsed Inventory
              </span>
              <Badge tone="neutral">Sheet: {preview.sheet_name}</Badge>
              <Badge tone="accent">{summary.activeCount} Selected</Badge>
              {summary.missingCost > 0 && (
                <Badge tone="danger">{summary.missingCost} Cost Missing</Badge>
              )}
              <Badge tone="info" className="font-mono tabular-nums">
                Closing Value: {formatMinor(summary.totalMinor, currencySymbol)}
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative w-52">
                <Search className="h-3.5 w-3.5 text-[var(--text-muted)] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Filter parsed items..."
                  className="h-7.5 pl-8 text-[12px]"
                />
              </div>
              <Select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="h-7.5 w-36 text-[12px]"
              >
                <option value="">All Departments</option>
                {deptsInSheet.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          {/* Editable Grid */}
          <div className="max-h-[380px] overflow-y-auto overflow-x-auto">
            <table className="w-full text-left border-collapse text-[12px]">
              <thead className="sticky top-0 z-10 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[10.5px] uppercase text-[var(--text-muted)]">
                <tr>
                  <th className="py-2 px-3 w-8">Inc</th>
                  <th className="py-2 px-2 min-w-[180px]">Item Name</th>
                  <th className="py-2 px-2 w-[115px]">Department</th>
                  <th className="py-2 px-2 w-[95px]">Section</th>
                  <th className="py-2 px-2 w-[92px]">Stock Unit</th>
                  <th className="py-2 px-2 w-[92px]">Collect Unit</th>
                  <th className="py-2 px-2 w-[95px]">1 Stock = X Col</th>
                  <th className="py-2 px-2 w-[82px] text-right">Stock Qty</th>
                  <th className="py-2 px-3 w-[105px] text-right">
                    Unit Cost ({currencySymbol})
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {visibleRows.map(({ row, idx }) => {
                  const diffUnits =
                    row.stocking_unit_code.toUpperCase() !==
                    row.collection_unit_code.toUpperCase();
                  return (
                    <tr
                      key={row.row_number}
                      className={!row.include ? 'opacity-40' : 'hover:bg-[var(--bg-hover)]'}
                    >
                      <td className="py-1.5 px-3">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={(e) => updateRow(idx, { include: e.target.checked })}
                          className="accent-[#6AD4B0]"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          value={row.item_name}
                          disabled={!row.include}
                          onChange={(e) => updateRow(idx, { item_name: e.target.value })}
                          className="h-7 text-[12px]"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          value={row.department}
                          disabled={!row.include}
                          onChange={(e) => updateRow(idx, { department: e.target.value })}
                          className="h-7 text-[12px]"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Input
                          value={row.store_section}
                          disabled={!row.include}
                          onChange={(e) => updateRow(idx, { store_section: e.target.value })}
                          placeholder="—"
                          className="h-7 text-[12px]"
                        />
                      </td>
                      <td className="py-1.5 px-2">
                        <Select
                          value={row.stocking_unit_code}
                          disabled={!row.include}
                          onChange={(e) =>
                            updateRow(idx, { stocking_unit_code: e.target.value })
                          }
                          className="h-7 text-[11.5px] px-2"
                        >
                          {units.map((u) => (
                            <option key={u.id} value={u.code}>
                              {u.code}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5 px-2">
                        <Select
                          value={row.collection_unit_code}
                          disabled={!row.include}
                          onChange={(e) =>
                            updateRow(idx, {
                              collection_unit_code: e.target.value,
                              factor_str:
                                e.target.value === row.stocking_unit_code
                                  ? '1'
                                  : row.factor_str === '1'
                                    ? '5'
                                    : row.factor_str,
                            })
                          }
                          className="h-7 text-[11.5px] px-2"
                        >
                          {units.map((u) => (
                            <option key={u.id} value={u.code}>
                              {u.code}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="py-1.5 px-2">
                        {diffUnits ? (
                          <div className="flex items-center gap-1">
                            <Input
                              value={row.factor_str}
                              disabled={!row.include}
                              onChange={(e) => updateRow(idx, { factor_str: e.target.value })}
                              className="h-7 text-right text-[12px] px-1.5"
                            />
                            <span className="text-[10.5px] text-[var(--accent-text)] font-medium">
                              {row.collection_unit_code}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-[var(--text-muted)] pl-2">1 : 1</span>
                        )}
                      </td>
                      <td className="py-1.5 px-2 text-right font-medium">
                        <div className="flex items-center justify-end gap-1">
                          <Input
                            value={row.closing_str}
                            disabled={!row.include}
                            onChange={(e) => updateRow(idx, { closing_str: e.target.value })}
                            className="h-7 w-20 text-right text-[12px] px-1.5 tabular-nums"
                          />
                          <span className="text-[11px] text-[var(--text-muted)]">
                            {row.stocking_unit_code}
                          </span>
                        </div>
                        {diffUnits && (
                          <div className="text-[10.5px] text-[var(--accent-text)]">
                            ={' '}
                            {(Number(row.closing_str) || 0) *
                              (Number(row.factor_str) || 1)}{' '}
                            {row.collection_unit_code}
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-3">
                        <Input
                          value={row.unit_cost_str}
                          disabled={!row.include}
                          onChange={(e) => updateRow(idx, { unit_cost_str: e.target.value })}
                          placeholder="Missing"
                          className="h-7 text-right text-[12px]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Approval Footer */}
          <div className="px-4 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-subtle)]/35 flex items-center justify-between gap-3">
            <span className="text-[12px] text-[var(--text-secondary)]">
              Showing {visibleRows.length} of {rows.length} parsed rows
            </span>
            <div className="flex items-center gap-2">
              {onSkip && (
                <Button variant="ghost" onClick={onSkip}>
                  Skip &amp; Add Manually
                </Button>
              )}
              <Button
                variant="primary"
                loading={busy}
                disabled={summary.activeCount === 0}
                onClick={handleApproveAndCommit}
                tooltip="Commit approved items, unit conversions, and opening balances to inventory"
              >
                <CheckCircle2 className="h-4 w-4" />
                Approve &amp; Post {summary.activeCount} Items
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
