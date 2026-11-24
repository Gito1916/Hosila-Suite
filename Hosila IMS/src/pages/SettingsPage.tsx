import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Building2,
  Copy,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  FolderOpen,
  KeyRound,
  Plus,
  RefreshCw,
  Ruler,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  commands,
  type BackupFileDto,
  type IntegrityReport,
  type UserDto,
  type UserRole,
} from '../../bindings/bindings';
import { useApp } from '../context/AppContext';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Field, Input, Select } from '../components/ui/Field';
import { Modal } from '../components/ui/Modal';
import { ImportInventoryReviewer } from '../components/inventory/ImportInventoryReviewer';
import {
  cn,
  encodeBackupFileForBackend,
  formatBytes,
  formatDateTime,
  parseCurrencyToMinor,
  parseQtyToMilli,
  todayIso,
} from '../lib/format';

type SettingsTab =
  | 'general'
  | 'org'
  | 'people'
  | 'units'
  | 'importer'
  | 'backups'
  | 'licence';

export function SettingsPage() {
  const {
    settings,
    departments,
    storeSections,
    staff,
    suppliers,
    units,
    license,
    currencySymbol,
    isAdmin,
    theme,
    setTheme,
    refreshBoot,
    refreshReferenceData,
    clearAllInventory,
  } = useApp();

  const [tab, setTab] = useState<SettingsTab>('general');

  // General & Rules
  const [bizName, setBizName] = useState('');
  const [legalName, setLegalName] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [curSym, setCurSym] = useState('₦');
  const [curCode, setCurCode] = useState('NGN');
  const [allowNeg, setAllowNeg] = useState(false);
  const [requireStorekeeperPin, setRequireStorekeeperPin] = useState(false);
  const [pinAbove, setPinAbove] = useState('50000');
  const [savingGeneral, setSavingGeneral] = useState(false);

  // Org
  const [newDeptName, setNewDeptName] = useState('');
  const [newDeptColor, setNewDeptColor] = useState('#6AD4B0');
  const [newSectionName, setNewSectionName] = useState('');
  const [newSupName, setNewSupName] = useState('');
  const [newSupPhone, setNewSupPhone] = useState('');
  const [pendingRestore, setPendingRestore] = useState<
    { kind: 'path'; path: string; label: string } | { kind: 'file'; file: File; label: string } | null
  >(null);

  // People (Staff & Users)
  const [users, setUsers] = useState<UserDto[]>([]);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [stName, setStName] = useState('');
  const [stPhone, setStPhone] = useState('');
  const [stIsStore, setStIsStore] = useState(false);
  const [stDeptIds, setStDeptIds] = useState<string[]>([]);

  const [uUsername, setUUsername] = useState('');
  const [uFullName, setUFullName] = useState('');
  const [uPassword, setUPassword] = useState('');
  const [uPin, setUPin] = useState('');
  const [uRole, setURole] = useState<UserRole>('storekeeper');
  const [credUser, setCredUser] = useState<UserDto | null>(null);
  const [credPassword, setCredPassword] = useState('');
  const [credPin, setCredPin] = useState('');
  const [savingCreds, setSavingCreds] = useState(false);

  // Units
  const [unitCode, setUnitCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [unitPlural, setUnitPlural] = useState('');
  const [unitDim, setUnitDim] = useState('count');
  const [unitDecimals, setUnitDecimals] = useState(false);
  const [unitFactorStr, setUnitFactorStr] = useState('1');

  // Export & Clear Inventory (inside Import Inventory tab)
  const [exportInvPath, setExportInvPath] = useState(
    `Downloads\\Hosila-Inventory-${todayIso()}.xlsx`
  );
  const [exportingInv, setExportingInv] = useState(false);
  const [clearModalOpen, setClearModalOpen] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState('');
  const [clearingInv, setClearingInv] = useState(false);

  // Backups & Integrity
  const [backups, setBackups] = useState<BackupFileDto[]>([]);
  const [integrity, setIntegrity] = useState<IntegrityReport | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [exportBackupPath, setExportBackupPath] = useState(
    `Downloads\\Hosila-Backup-${todayIso()}.db`
  );

  // Licence
  const [licenseKey, setLicenseKey] = useState('');
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setBizName(settings.business_profile.name);
    setLegalName(settings.business_profile.legal_name);
    setAddress(settings.business_profile.address);
    setPhone(settings.business_profile.phone);
    setEmail(settings.business_profile.email);
    setCurSym(settings.business_profile.currency_symbol);
    setCurCode(settings.business_profile.currency_code);
    setAllowNeg(settings.inventory_rules.allow_negative_stock);
    setRequireStorekeeperPin(settings.inventory_rules.require_storekeeper_pin_on_issue);
    setPinAbove(String(settings.inventory_rules.require_manager_pin_above_minor / 100));
  }, [settings]);

  const loadAdminTabs = useCallback(async () => {
    const [uRes, bRes] = await Promise.all([commands.listUsers(), commands.listBackups()]);
    if (uRes.status === 'ok') setUsers(uRes.data);
    if (bRes.status === 'ok') setBackups(bRes.data);
  }, []);

  useEffect(() => {
    loadAdminTabs();
  }, [loadAdminTabs]);

  async function saveGeneral(e: React.FormEvent) {
    e.preventDefault();
    setSavingGeneral(true);
    try {
      const [pRes, rRes] = await Promise.all([
        commands.updateBusinessProfile({
          name: bizName.trim(),
          legal_name: legalName.trim(),
          address: address.trim(),
          phone: phone.trim(),
          email: email.trim(),
          currency_symbol: curSym.trim() || '₦',
          currency_code: curCode.trim().toUpperCase() || 'NGN',
          date_format: 'DD MMM YYYY',
          logo_data_url: settings?.business_profile.logo_data_url ?? null,
        }),
        commands.updateInventoryRules({
          allow_negative_stock: allowNeg,
          costing_method: settings?.inventory_rules.costing_method || 'wac',
          require_storekeeper_pin_on_issue: requireStorekeeperPin,
          require_manager_pin_above_minor: parseCurrencyToMinor(pinAbove),
        }),
      ]);
      if (pRes.status === 'error') {
        toast.error(pRes.error.message);
        return;
      }
      if (rRes.status === 'error') {
        toast.error(rRes.error.message);
        return;
      }
      toast.success('Settings saved');
      await refreshReferenceData();
    } finally {
      setSavingGeneral(false);
    }
  }

  async function handleAddDept(e: React.FormEvent) {
    e.preventDefault();
    if (!newDeptName.trim()) return;
    const res = await commands.createDepartment({
      name: newDeptName.trim(),
      color: newDeptColor,
      sort_order: departments.length + 1,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Added department ${res.data.name}`);
      setNewDeptName('');
      await refreshReferenceData();
    }
  }

  async function handleAddSection(e: React.FormEvent) {
    e.preventDefault();
    if (!newSectionName.trim()) return;
    const res = await commands.createStoreSection({
      name: newSectionName.trim(),
      sort_order: storeSections.length + 1,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Added section ${res.data.name}`);
      setNewSectionName('');
      await refreshReferenceData();
    }
  }

  async function handleAddSupplier(e: React.FormEvent) {
    e.preventDefault();
    if (!newSupName.trim()) return;
    const res = await commands.createSupplier({
      name: newSupName.trim(),
      phone: newSupPhone.trim() || null,
      email: null,
      notes: null,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Added supplier ${res.data.name}`);
      setNewSupName('');
      setNewSupPhone('');
      await refreshReferenceData();
    }
  }

  async function handleSaveStaff(e: React.FormEvent) {
    e.preventDefault();
    if (!stName.trim()) return;
    if (editingStaffId) {
      const res = await commands.updateStaff(editingStaffId, {
        full_name: stName.trim(),
        phone: stPhone.trim() || null,
        is_store_staff: stIsStore,
        department_ids: stDeptIds,
        is_active: true,
      });
      if (res.status === 'error') toast.error(res.error.message);
      else {
        toast.success(`Updated staff member ${res.data.full_name}`);
        setEditingStaffId(null);
        setStName('');
        setStPhone('');
        setStIsStore(false);
        setStDeptIds([]);
        await refreshReferenceData();
      }
      return;
    }

    const res = await commands.createStaff({
      full_name: stName.trim(),
      staff_code: null,
      phone: stPhone.trim() || null,
      is_store_staff: stIsStore,
      department_ids: stDeptIds,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Added staff member ${res.data.full_name}`);
      setStName('');
      setStPhone('');
      setStIsStore(false);
      setStDeptIds([]);
      await refreshReferenceData();
    }
  }

  async function handleAddUser(e: React.FormEvent) {
    e.preventDefault();
    const res = await commands.createUser({
      username: uUsername.trim(),
      full_name: uFullName.trim(),
      password: uPassword,
      pin: uPin.trim() || null,
      role: uRole,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Created user ${res.data.username}`);
      setUUsername('');
      setUFullName('');
      setUPassword('');
      setUPin('');
      await loadAdminTabs();
    }
  }

  async function handleSaveUserCreds(e: React.FormEvent) {
    e.preventDefault();
    if (!credUser) return;
    if (credPassword && credPassword.length < 6) {
      toast.error('Password must be at least 6 characters.');
      return;
    }
    if (credPin.trim() && !/^\d{4,6}$/.test(credPin.trim())) {
      toast.error('PIN must be 4–6 digits (or leave blank to skip/clear).');
      return;
    }
    setSavingCreds(true);
    try {
      if (credPassword) {
        const pwRes = await commands.resetUserPassword(credUser.id, credPassword);
        if (pwRes.status === 'error') {
          toast.error(pwRes.error.message);
          return;
        }
      }
      if (credPin.trim()) {
        const pinRes = await commands.setUserPin(credUser.id, credPin.trim());
        if (pinRes.status === 'error') {
          toast.error(pinRes.error.message);
          return;
        }
      }
      toast.success(`Updated credentials for @${credUser.username}`);
      setCredUser(null);
      setCredPassword('');
      setCredPin('');
      await loadAdminTabs();
    } finally {
      setSavingCreds(false);
    }
  }

  async function handleAddUnit(e: React.FormEvent) {
    e.preventDefault();
    const factorMilli =
      unitDim === 'count' ? 1000 : Math.max(1, parseQtyToMilli(unitFactorStr));
    const res = await commands.createUnit({
      code: unitCode.trim().toUpperCase(),
      name: unitName.trim(),
      plural: unitPlural.trim(),
      dimension: unitDim,
      allows_decimals: unitDecimals,
      factor_to_dim_base_milli: factorMilli,
    });
    if (res.status === 'error') toast.error(res.error.message);
    else {
      toast.success(`Added unit ${res.data.code}`);
      setUnitCode('');
      setUnitName('');
      setUnitPlural('');
      setUnitFactorStr('1');
      await refreshReferenceData();
    }
  }

  async function handleExportInventory(e: React.FormEvent) {
    e.preventDefault();
    if (!exportInvPath.trim()) {
      toast.error('Enter an output path for the exported inventory Excel file.');
      return;
    }
    setExportingInv(true);
    try {
      const res = await commands.exportWeeklyStockSheetXlsx(
        '2026-01-01',
        todayIso(),
        exportInvPath.trim()
      );
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Exported inventory workbook to ${res.data}`);
    } finally {
      setExportingInv(false);
    }
  }

  async function handleExecuteClearInventory() {
    if (clearConfirmText.trim().toUpperCase() !== 'CLEAR') return;
    setClearingInv(true);
    try {
      const res = await clearAllInventory();
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      await loadAdminTabs();
      setClearModalOpen(false);
      setClearConfirmText('');
      toast.success(res.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setClearingInv(false);
    }
  }

  async function handleCreateBackup() {
    setBackupBusy(true);
    try {
      const res = await commands.createBackup();
      if (res.status === 'error') toast.error(res.error.message);
      else {
        toast.success(`Saved backup ${res.data.filename}`);
        await loadAdminTabs();
      }
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleExportBackupFile(e: React.FormEvent) {
    e.preventDefault();
    if (!exportBackupPath.trim()) {
      toast.error('Enter a destination file path for the backup.');
      return;
    }
    setBackupBusy(true);
    try {
      const res = await commands.exportBackupFile(exportBackupPath.trim());
      if (res.status === 'error') toast.error(res.error.message);
      else {
        toast.success(`Backup saved to ${res.data}`);
        await loadAdminTabs();
      }
    } finally {
      setBackupBusy(false);
    }
  }

  function handleRestoreBackup(path: string) {
    setPendingRestore({
      kind: 'path',
      path,
      label: 'Restore this backup? A pre-restore safety snapshot of your current database will be created first.',
    });
  }

  function handleRestoreFromExternalFile(file: File) {
    setPendingRestore({
      kind: 'file',
      file,
      label: `Restore database from "${file.name}"? A pre-restore safety snapshot of your current database will be saved first.`,
    });
  }

  async function executeConfirmedRestore() {
    if (!pendingRestore) return;
    const target = pendingRestore;
    setPendingRestore(null);
    setBackupBusy(true);
    try {
      const payload =
        target.kind === 'path' ? target.path : await encodeBackupFileForBackend(target.file);
      const res = await commands.restoreBackup(payload);
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      setIntegrity(res.data);
      toast.success(
        target.kind === 'path'
          ? 'Database restored & verified cleanly.'
          : `Restored "${target.file.name}" & verified integrity cleanly.`
      );
      await refreshBoot();
      await loadAdminTabs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBackupBusy(false);
    }
  }

  async function handleIntegrityCheck() {
    const res = await commands.runIntegrityCheck();
    if (res.status === 'ok') {
      setIntegrity(res.data);
      if (res.data.ok) toast.success('SQLite integrity & ledger reconciliation passed.');
      else toast.error(`Integrity issue: ${res.data.ledger_mismatches} ledger mismatches.`);
    }
  }

  async function handleActivateLicense(e: React.FormEvent) {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setActivating(true);
    try {
      const res = await commands.activateLicense(licenseKey.trim());
      if (res.status === 'error') {
        toast.error(res.error.message);
        return;
      }
      toast.success(`Activated licence for ${res.data.licensed_to ?? 'this workstation'}`);
      setLicenseKey('');
      await refreshReferenceData();
    } finally {
      setActivating(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-[20px] font-semibold tracking-[-0.025em]">Settings</h1>

        {/* Sub-navigation tabs */}
        <div className="flex flex-wrap gap-1 p-1 rounded-xl bg-[var(--bg-card)] border border-[var(--border-subtle)] w-fit">
          {(
            [
              { id: 'general', label: 'General', icon: Building2 },
              { id: 'org', label: 'Departments', icon: Building2 },
              { id: 'people', label: 'Staff & Users', icon: Users },
              { id: 'units', label: 'Units', icon: Ruler },
              { id: 'importer', label: 'Import Inventory', icon: FileSpreadsheet },
              { id: 'backups', label: 'Backups', icon: Database },
              { id: 'licence', label: 'Licence', icon: KeyRound },
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

      {/* TAB: GENERAL */}
      {tab === 'general' && (
        <form
          onSubmit={saveGeneral}
          className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 space-y-4 max-w-2xl"
        >
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Business Name" required>
              <Input
                value={bizName}
                disabled={!isAdmin}
                onChange={(e) => setBizName(e.target.value)}
              />
            </Field>
            <Field label="Legal Name">
              <Input
                value={legalName}
                disabled={!isAdmin}
                onChange={(e) => setLegalName(e.target.value)}
              />
            </Field>
            <Field label="Currency Symbol" required>
              <Input
                value={curSym}
                disabled={!isAdmin}
                onChange={(e) => setCurSym(e.target.value)}
              />
            </Field>
            <Field label="Currency Code" required>
              <Input
                value={curCode}
                disabled={!isAdmin}
                onChange={(e) => setCurCode(e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={phone}
                disabled={!isAdmin}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field label="Email">
              <Input
                value={email}
                disabled={!isAdmin}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
          </div>
          <Field label="Address">
            <Input
              value={address}
              disabled={!isAdmin}
              onChange={(e) => setAddress(e.target.value)}
            />
          </Field>

          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
            <div className="text-[13px] font-semibold">Appearance</div>
            <div className="inline-flex gap-2">
              {(['light', 'dark', 'system'] as const).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  size="sm"
                  variant={theme === mode ? 'primary' : 'secondary'}
                  onClick={() => setTheme(mode)}
                  className="capitalize"
                  tooltip={`Switch appearance to ${mode} theme.`}
                >
                  {mode}
                </Button>
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)] space-y-2.5">
            <div className="text-[13px] font-semibold">Inventory Controls</div>
            <label className="flex items-center gap-2.5 text-[12.5px] cursor-pointer">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={allowNeg}
                onChange={(e) => setAllowNeg(e.target.checked)}
                className="h-4 w-4 accent-[#6AD4B0]"
              />
              <span>Allow negative stock</span>
            </label>
            <label className="flex items-center gap-2.5 text-[12.5px] cursor-pointer">
              <input
                type="checkbox"
                disabled={!isAdmin}
                checked={requireStorekeeperPin}
                onChange={(e) => setRequireStorekeeperPin(e.target.checked)}
                className="h-4 w-4 accent-[#6AD4B0]"
              />
              <span>Require Storekeeper PIN on stock issue</span>
            </label>
            <Field
              label={`Require Manager PIN above (${currencySymbol})`}
              className="max-w-xs"
            >
              <Input
                disabled={!isAdmin}
                value={pinAbove}
                onChange={(e) => setPinAbove(e.target.value)}
                className="tabular-nums"
              />
            </Field>
          </div>

          {isAdmin && (
            <div className="pt-1">
              <Button
                type="submit"
                variant="primary"
                loading={savingGeneral}
                tooltip="Save business profile and inventory control rules."
              >
                Save Settings
              </Button>
            </div>
          )}
        </form>
      )}

      {/* TAB: DEPARTMENTS & SECTIONS */}
      {tab === 'org' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <h2 className="text-[14.5px] font-semibold">Departments ({departments.length})</h2>
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {departments.map((d) => (
                <div key={d.id} className="px-3.5 py-2 flex items-center justify-between text-[13px]">
                  <span className="flex items-center gap-2 font-medium">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: d.color }} />
                    {d.name}
                  </span>
                  <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
                    {d.item_count} items · {d.staff_count} staff
                  </span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <form onSubmit={handleAddDept} className="flex gap-2">
                <Input
                  value={newDeptName}
                  onChange={(e) => setNewDeptName(e.target.value)}
                  placeholder="New department name..."
                />
                <input
                  type="color"
                  value={newDeptColor}
                  onChange={(e) => setNewDeptColor(e.target.value)}
                  className="h-9 w-11 rounded-lg border border-[var(--border-subtle)] cursor-pointer p-1 bg-[var(--bg-card)]"
                />
                <Button type="submit" variant="primary" tooltip="Create a new department.">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <h2 className="text-[14.5px] font-semibold">Store Sections ({storeSections.length})</h2>
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {storeSections.map((s) => (
                <div key={s.id} className="px-3.5 py-2 flex items-center justify-between text-[13px]">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-[11.5px] text-[var(--text-muted)] tabular-nums">
                    {s.item_count} items
                  </span>
                </div>
              ))}
            </div>
            {isAdmin && (
              <form onSubmit={handleAddSection} className="flex gap-2">
                <Input
                  value={newSectionName}
                  onChange={(e) => setNewSectionName(e.target.value)}
                  placeholder="New store section..."
                />
                <Button type="submit" variant="primary" tooltip="Create a new store section.">
                  <Plus className="h-4 w-4" />
                  Add
                </Button>
              </form>
            )}
          </div>

          <div className="lg:col-span-2 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <h2 className="text-[14.5px] font-semibold">Suppliers ({suppliers.length})</h2>
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {suppliers.length === 0 ? (
                <div className="px-3.5 py-4 text-[12.5px] text-[var(--text-muted)]">
                  No suppliers added yet.
                </div>
              ) : (
                suppliers.map((s) => (
                  <div
                    key={s.id}
                    className="px-3.5 py-2 flex items-center justify-between gap-3 text-[13px]"
                  >
                    <div>
                      <span className="font-medium">{s.name}</span>
                      {s.phone && (
                        <span className="ml-2 text-[11.5px] text-[var(--text-muted)] tabular-nums">
                          {s.phone}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={s.is_active ? 'accent' : 'neutral'}>
                        {s.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const r = await commands.updateSupplier(s.id, {
                              name: null,
                              phone: null,
                              email: null,
                              notes: null,
                              is_active: !s.is_active,
                            });
                            if (r.status === 'error') toast.error(r.error.message);
                            else {
                              toast.success(
                                `${r.data.is_active ? 'Activated' : 'Deactivated'} ${r.data.name}`
                              );
                              await refreshReferenceData();
                            }
                          }}
                        >
                          {s.is_active ? 'Disable' : 'Enable'}
                        </Button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
            {isAdmin && (
              <form onSubmit={handleAddSupplier} className="flex flex-wrap gap-2">
                <Input
                  value={newSupName}
                  onChange={(e) => setNewSupName(e.target.value)}
                  placeholder="Supplier name"
                  className="flex-1 min-w-[180px]"
                />
                <Input
                  value={newSupPhone}
                  onChange={(e) => setNewSupPhone(e.target.value)}
                  placeholder="Phone (optional)"
                  className="w-44"
                />
                <Button type="submit" variant="primary" tooltip="Create a new vendor / supplier.">
                  <Plus className="h-4 w-4" />
                  Add Supplier
                </Button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB: STAFF & USERS */}
      {tab === 'people' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <h2 className="text-[14.5px] font-semibold">Staff Directory ({staff.length})</h2>
            <div className="max-h-72 overflow-y-auto divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {staff.map((s) => (
                <div
                  key={s.id}
                  className={cn(
                    'px-3.5 py-2 flex items-center justify-between gap-2 text-[13px]',
                    editingStaffId === s.id && 'bg-[var(--accent-soft)]/40'
                  )}
                >
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-1.5">
                      <span className="truncate">{s.full_name}</span>
                      {s.is_store_staff && <Badge tone="accent">Storekeeper</Badge>}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">
                      {s.department_names.join(', ') || 'Unassigned'}
                      {s.phone ? ` · ${s.phone}` : ''}
                    </div>
                  </div>
                  {isAdmin && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      tooltip="Edit this staff member's name, phone, departments, or storekeeper role."
                      onClick={() => {
                        setEditingStaffId(s.id);
                        setStName(s.full_name);
                        setStPhone(s.phone ?? '');
                        setStIsStore(s.is_store_staff);
                        setStDeptIds(s.department_ids);
                      }}
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </Button>
                  )}
                </div>
              ))}
            </div>

            {isAdmin && (
              <form onSubmit={handleSaveStaff} className="space-y-2.5 pt-2 border-t border-[var(--border-subtle)]">
                <div className="flex items-center justify-between">
                  <div className="text-[12px] font-semibold">
                    {editingStaffId ? 'Edit Staff Member' : 'Add Staff Member'}
                  </div>
                  {editingStaffId && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingStaffId(null);
                        setStName('');
                        setStPhone('');
                        setStIsStore(false);
                        setStDeptIds([]);
                      }}
                      className="text-[11.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)] cursor-pointer"
                    >
                      Cancel Edit
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={stName}
                    onChange={(e) => setStName(e.target.value)}
                    placeholder="Full name"
                  />
                  <Input
                    value={stPhone}
                    onChange={(e) => setStPhone(e.target.value)}
                    placeholder="Phone (optional)"
                  />
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {departments.map((d) => {
                    const checked = stDeptIds.includes(d.id);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        onClick={() =>
                          setStDeptIds((prev) =>
                            checked ? prev.filter((x) => x !== d.id) : [...prev, d.id]
                          )
                        }
                        className={cn(
                          'px-2.5 py-1 rounded-lg border text-[11.5px] cursor-pointer',
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
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={stIsStore}
                      onChange={(e) => setStIsStore(e.target.checked)}
                    />
                    Store Staff (can approve collections/receipts)
                  </label>
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    tooltip={
                      editingStaffId
                        ? 'Save changes to this staff member.'
                        : 'Add this person to the staff directory.'
                    }
                  >
                    {editingStaffId ? 'Save Staff' : 'Add Staff'}
                  </Button>
                </div>
              </form>
            )}
          </div>

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3.5">
            <h2 className="text-[14.5px] font-semibold">User Accounts ({users.length})</h2>
            <div className="divide-y divide-[var(--border-subtle)] border border-[var(--border-subtle)] rounded-xl">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="px-3.5 py-2 flex flex-wrap items-center justify-between gap-2 text-[13px]"
                >
                  <div>
                    <div className="font-medium flex items-center gap-1.5">
                      <span>{u.full_name}</span>
                      {!u.is_active && <Badge tone="danger">Disabled</Badge>}
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)]">@{u.username}</div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {u.has_pin && <Badge tone="info">PIN</Badge>}
                    <Badge tone={u.role === 'admin' ? 'accent' : 'neutral'}>{u.role}</Badge>
                    {isAdmin && (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          tooltip="Reset password or set quick PIN for this user."
                          onClick={() => {
                            setCredUser(u);
                            setCredPassword('');
                            setCredPin('');
                          }}
                        >
                          <KeyRound className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const r = await commands.updateUser(u.id, {
                              full_name: null,
                              role: null,
                              is_active: !u.is_active,
                            });
                            if (r.status === 'error') toast.error(r.error.message);
                            else {
                              toast.success(
                                `${r.data.is_active ? 'Enabled' : 'Disabled'} @${r.data.username}`
                              );
                              await loadAdminTabs();
                            }
                          }}
                        >
                          {u.is_active ? 'Disable' : 'Enable'}
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {isAdmin && (
              <form onSubmit={handleAddUser} className="space-y-2.5 pt-2 border-t border-[var(--border-subtle)]">
                <div className="text-[12px] font-semibold">Create App Login Account</div>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    value={uFullName}
                    onChange={(e) => setUFullName(e.target.value)}
                    placeholder="Full name"
                  />
                  <Input
                    value={uUsername}
                    onChange={(e) => setUUsername(e.target.value)}
                    placeholder="Username"
                  />
                  <Input
                    type="password"
                    value={uPassword}
                    onChange={(e) => setUPassword(e.target.value)}
                    placeholder="Password (min 6)"
                  />
                  <Input
                    type="password"
                    value={uPin}
                    onChange={(e) => setUPin(e.target.value)}
                    placeholder="PIN (4-6 digits)"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <Select
                    value={uRole}
                    onChange={(e) => setURole(e.target.value as UserRole)}
                    className="w-[160px]"
                  >
                    <option value="storekeeper">Storekeeper</option>
                    <option value="admin">Admin</option>
                    <option value="viewer">Viewer</option>
                  </Select>
                  <Button
                    type="submit"
                    size="sm"
                    variant="primary"
                    tooltip="Create a new workstation user account."
                  >
                    Create Account
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* TAB: UNITS */}
      {tab === 'units' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
          <div className="lg:col-span-8 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <div className="max-h-[480px] overflow-y-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead className="sticky top-0 bg-[var(--bg-elevated)] border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <tr>
                    <th className="py-2.5 px-4">Code</th>
                    <th className="py-2.5 px-3">Name / Plural</th>
                    <th className="py-2.5 px-3">Dimension</th>
                    <th className="py-2.5 px-3">Type</th>
                    <th className="py-2.5 px-4 text-right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {units.map((u) => (
                    <tr key={u.id}>
                      <td className="py-2 px-4 font-semibold tabular-nums">{u.code}</td>
                      <td className="py-2 px-3">
                        {u.name} / {u.plural}
                      </td>
                      <td className="py-2 px-3 capitalize text-[var(--text-secondary)]">
                        {u.dimension}
                      </td>
                      <td className="py-2 px-3">
                        <Badge tone={u.is_system ? 'neutral' : 'accent'}>
                          {u.is_system ? 'System' : 'Custom'}
                        </Badge>
                      </td>
                      <td className="py-2 px-4 text-right">
                        {!u.is_system && isAdmin && (
                          <button
                            type="button"
                            onClick={async () => {
                              const r = await commands.deleteUnit(u.id);
                              if (r.status === 'error') toast.error(r.error.message);
                              else {
                                toast.success(`Deleted ${u.code}`);
                                await refreshReferenceData();
                              }
                            }}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {isAdmin && (
            <form
              onSubmit={handleAddUnit}
              className="lg:col-span-4 rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 space-y-3"
            >
              <h2 className="text-[14px] font-semibold">Add Custom Unit</h2>
              <Field label="Code" required hint="e.g. KEG">
                <Input value={unitCode} onChange={(e) => setUnitCode(e.target.value)} />
              </Field>
              <Field label="Singular Name" required>
                <Input value={unitName} onChange={(e) => setUnitName(e.target.value)} />
              </Field>
              <Field label="Plural Name" required>
                <Input value={unitPlural} onChange={(e) => setUnitPlural(e.target.value)} />
              </Field>
              <Field label="Dimension">
                <Select value={unitDim} onChange={(e) => setUnitDim(e.target.value)}>
                  <option value="count">Count</option>
                  <option value="mass">Mass</option>
                  <option value="volume">Volume</option>
                  <option value="length">Length</option>
                </Select>
              </Field>
              {unitDim !== 'count' && (
                <Field
                  label="Base Factor"
                  hint={
                    unitDim === 'mass'
                      ? '1 unit = X grams (e.g. 1000 for KG)'
                      : unitDim === 'volume'
                        ? '1 unit = X ml (e.g. 1000 for Litre)'
                        : '1 unit = X mm'
                  }
                >
                  <Input
                    value={unitFactorStr}
                    onChange={(e) => setUnitFactorStr(e.target.value)}
                    placeholder="1000"
                    className="tabular-nums"
                  />
                </Field>
              )}
              <label className="flex items-center gap-2 text-[12px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={unitDecimals}
                  onChange={(e) => setUnitDecimals(e.target.checked)}
                />
                Allow decimal quantities
              </label>
              <Button
                type="submit"
                variant="primary"
                className="w-full"
                tooltip="Create a custom unit of measure."
              >
                Create Unit
              </Button>
            </form>
          )}
        </div>
      )}

      {/* TAB: IMPORT / EXPORT / CLEAR INVENTORY */}
      {tab === 'importer' && (
        <div className="space-y-4">
          {/* Card 1: Interactive Import Inventory from Excel */}
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 space-y-4">
            <div className="flex items-center gap-2.5">
              <div className="h-8 w-8 rounded-xl bg-[var(--accent-soft)] text-[#6AD4B0] flex items-center justify-center">
                <FileSpreadsheet className="h-4 w-4" />
              </div>
              <h2 className="text-[15px] font-semibold">Import Inventory from Excel (.xlsx)</h2>
            </div>

            <ImportInventoryReviewer
              onComplete={async () => {
                await refreshReferenceData();
              }}
            />
          </div>

          {/* Card 2: Export Inventory + Card 3: Clear Inventory */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <form
              onSubmit={handleExportInventory}
              className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 space-y-3.5"
            >
              <div className="flex items-center gap-2.5">
                <div className="h-8 w-8 rounded-xl bg-[var(--accent-soft)] text-[#6AD4B0] flex items-center justify-center">
                  <Download className="h-4 w-4" />
                </div>
                <h2 className="text-[15px] font-semibold">Export Inventory (.xlsx)</h2>
              </div>

              <Field label="Output Excel Path (.xlsx)" required>
                <Input
                  value={exportInvPath}
                  onChange={(e) => setExportInvPath(e.target.value)}
                  placeholder="Downloads\Hosila-Inventory.xlsx"
                />
              </Field>

              <Button
                type="submit"
                variant="primary"
                loading={exportingInv}
                tooltip="Export the complete inventory catalog and stock ledger to a formatted Excel (.xlsx) workbook."
              >
                <Download className="h-4 w-4" />
                Export Inventory (.xlsx)
              </Button>
            </form>

            {isAdmin && (
              <div className="rounded-2xl border border-[#E05252]/30 bg-[var(--bg-card)] p-5 flex flex-col justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <div className="h-8 w-8 rounded-xl bg-[var(--danger-soft)] text-[var(--danger)] flex items-center justify-center">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <h2 className="text-[15px] font-semibold text-[var(--danger)]">
                    Clear Inventory
                  </h2>
                </div>

                <div>
                  <Button
                    type="button"
                    variant="danger"
                    onClick={() => {
                      setClearConfirmText('');
                      setClearModalOpen(true);
                    }}
                    tooltip="Clear all inventory items and stock balances while keeping your company settings, departments, and user accounts."
                  >
                    <Trash2 className="h-4 w-4" />
                    Clear Inventory...
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB: BACKUPS & INTEGRITY */}
      {tab === 'backups' && (
        <div className="space-y-4 max-w-3xl">
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 flex flex-wrap items-center justify-between gap-4">
            <h2 className="text-[14.5px] font-semibold">SQLite Backups &amp; Integrity</h2>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                onClick={handleIntegrityCheck}
                tooltip="Run a full SQLite integrity check and ledger reconciliation."
              >
                <ShieldCheck className="h-4 w-4" />
                Verify Integrity
              </Button>
              <Button
                variant="primary"
                loading={backupBusy}
                onClick={handleCreateBackup}
                tooltip="Capture an immediate hot snapshot of the SQLite database."
              >
                <RefreshCw className="h-4 w-4" />
                Backup Now
              </Button>
              {isAdmin && (
                <label className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-card)] hover:bg-[var(--bg-hover)] text-[12.5px] font-medium cursor-pointer transition-colors">
                  <FolderOpen className="h-4 w-4 text-[#6AD4B0]" />
                  Restore from File (.db)
                  <input
                    type="file"
                    accept=".db,.sqlite,.sqlite3"
                    disabled={backupBusy}
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      e.target.value = '';
                      if (f) handleRestoreFromExternalFile(f);
                    }}
                  />
                </label>
              )}
            </div>
          </div>

          <form
            onSubmit={handleExportBackupFile}
            className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-4 flex flex-wrap items-end gap-3"
          >
            <Field label="Save Portable Backup Copy (.db)" className="flex-1 min-w-[260px]">
              <Input
                value={exportBackupPath}
                onChange={(e) => setExportBackupPath(e.target.value)}
                placeholder="Downloads\Hosila-Backup.db"
              />
            </Field>
            <Button
              type="submit"
              variant="secondary"
              loading={backupBusy}
              tooltip="Export a standalone .db backup copy to your Downloads folder or USB drive so it survives a clean uninstall or PC transfer."
            >
              <Download className="h-4 w-4" />
              Export Backup (.db)
            </Button>
          </form>

          {integrity && (
            <div
              className={cn(
                'rounded-xl border px-4 py-3 text-[13px]',
                integrity.ok
                  ? 'border-[#6AD4B0]/30 bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'border-[#E05252]/30 bg-[var(--danger-soft)] text-[var(--danger)]'
              )}
            >
              Integrity Check: <strong>{integrity.ok ? 'OK' : 'ISSUE'}</strong> · SQLite:{' '}
              {integrity.sqlite_quick_check} · Ledger Mismatches: {integrity.ledger_mismatches}
            </div>
          )}

          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] overflow-hidden">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="bg-[var(--bg-subtle)]/55 border-b border-[var(--border-subtle)] text-[11px] uppercase text-[var(--text-muted)]">
                  <th className="py-2.5 px-4">Snapshot</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3 text-right">Size</th>
                  <th className="py-2.5 px-3">Created</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)] tabular-nums">
                {backups.map((b) => (
                  <tr key={b.path}>
                    <td className="py-2.5 px-4 font-medium">{b.filename}</td>
                    <td className="py-2.5 px-3">
                      <Badge tone={b.kind === 'manual' ? 'accent' : 'neutral'}>{b.kind}</Badge>
                    </td>
                    <td className="py-2.5 px-3 text-right text-[var(--text-secondary)]">
                      {formatBytes(b.size_bytes)}
                    </td>
                    <td className="py-2.5 px-3 text-[var(--text-secondary)]">
                      {formatDateTime(b.created_at)}
                    </td>
                    <td className="py-2.5 px-4 text-right">
                      {isAdmin && (
                        <Button
                          size="sm"
                          variant="danger"
                          disabled={backupBusy}
                          tooltip="Restore this SQLite database snapshot."
                          onClick={() => handleRestoreBackup(b.path)}
                        >
                          Restore
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB: LICENCE */}
      {tab === 'licence' && license && (
        <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--bg-card)] p-5 space-y-4 max-w-xl">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-[15px] font-semibold">Workstation Licence</h2>
              <p className="text-[12px] text-[var(--text-secondary)] mt-0.5">{license.message}</p>
            </div>
            <Badge
              tone={
                license.state === 'licensed'
                  ? 'success'
                  : license.state === 'trial'
                    ? 'accent'
                    : license.state === 'grace'
                      ? 'warning'
                      : 'danger'
              }
            >
              {license.state.replace('_', ' ')}
            </Badge>
          </div>

          <div className="rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-subtle)]/40 p-3.5 flex items-center justify-between gap-3">
            <div>
              <div className="text-[11px] text-[var(--text-muted)]">Machine Fingerprint</div>
              <div className="font-mono text-[14.5px] font-semibold tracking-wide mt-0.5">
                {license.machine_fingerprint}
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary"
              tooltip="Copy this workstation's machine fingerprint to the clipboard."
              onClick={() => {
                navigator.clipboard.writeText(license.machine_fingerprint);
                toast.success('Copied workstation fingerprint');
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              Copy
            </Button>
          </div>

          {license.licensed_to && (
            <div className="text-[13px] space-y-1">
              <div>
                Licensed to: <strong>{license.licensed_to}</strong>
              </div>
              {license.edition && (
                <div className="text-[var(--text-secondary)]">Edition: {license.edition}</div>
              )}
            </div>
          )}

          {isAdmin && (
            <form onSubmit={handleActivateLicense} className="space-y-3 pt-2 border-t border-[var(--border-subtle)]">
              <Field label="Enter Hosila Activation Key" hint="Generated by Hosila KeyGen (starts with HSL1.)">
                <Input
                  value={licenseKey}
                  onChange={(e) => setLicenseKey(e.target.value)}
                  placeholder="HSL1...."
                  className="font-mono text-[12px]"
                />
              </Field>
              <Button
                type="submit"
                variant="primary"
                loading={activating}
                disabled={!licenseKey.trim()}
                tooltip="Verify and activate the signed offline licence key."
              >
                Activate Workstation
              </Button>
            </form>
          )}
        </div>
      )}

      {/* Clear Inventory Confirmation Modal */}
      <Modal
        open={clearModalOpen}
        onOpenChange={setClearModalOpen}
        title="Confirm Clear All Inventory"
        description="This action permanently clears all inventory items and stock balances so you can re-import or start fresh. Your company profile, departments, staff, and user accounts will be preserved."
        footer={
          <>
            <Button variant="ghost" onClick={() => setClearModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger-solid"
              loading={clearingInv}
              disabled={clearConfirmText.trim().toUpperCase() !== 'CLEAR'}
              onClick={handleExecuteClearInventory}
              tooltip="Permanently clear all inventory items and stock balances."
            >
              <Trash2 className="h-4 w-4" />
              Clear All Inventory
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label='Type "CLEAR" to confirm' required>
            <Input
              autoFocus
              value={clearConfirmText}
              onChange={(e) => setClearConfirmText(e.target.value)}
              placeholder="CLEAR"
              className="font-mono uppercase"
            />
          </Field>
        </div>
      </Modal>

      {/* Restore Backup Confirmation Modal */}
      <Modal
        open={Boolean(pendingRestore)}
        onOpenChange={(open) => {
          if (!open) setPendingRestore(null);
        }}
        title="Confirm Database Restore"
        description={pendingRestore?.label}
        maxWidth="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPendingRestore(null)}>
              Cancel
            </Button>
            <Button
              variant="danger-solid"
              loading={backupBusy}
              onClick={executeConfirmedRestore}
              tooltip="Save a safety snapshot and restore the selected database backup."
            >
              Restore Backup
            </Button>
          </>
        }
      >
        <p className="text-xs text-ink/65">
          All active records will be replaced by the selected backup after a pre-restore safety
          snapshot is automatically created.
        </p>
      </Modal>

      {/* Reset User Password / PIN Modal */}
      <Modal
        open={Boolean(credUser)}
        onOpenChange={(open) => {
          if (!open) setCredUser(null);
        }}
        title={credUser ? `Credentials for @${credUser.username}` : 'User Credentials'}
        maxWidth="max-w-sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCredUser(null)}>
              Cancel
            </Button>
            <Button
              type="submit"
              form="user-creds-form"
              variant="primary"
              loading={savingCreds}
              disabled={!credPassword && !credPin.trim()}
            >
              Save Credentials
            </Button>
          </>
        }
      >
        <form id="user-creds-form" onSubmit={handleSaveUserCreds} className="space-y-3">
          <Field label="New Password" hint="Min 6 chars (leave blank to keep unchanged)">
            <Input
              type="password"
              value={credPassword}
              onChange={(e) => setCredPassword(e.target.value)}
              placeholder="••••••"
            />
          </Field>
          <Field label="New PIN" hint="4–6 digits (leave blank to keep unchanged)">
            <Input
              type="password"
              inputMode="numeric"
              value={credPin}
              onChange={(e) => setCredPin(e.target.value)}
              placeholder="••••"
              className="font-mono tracking-[0.3em]"
            />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
