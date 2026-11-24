import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Eye,
  KeyRound,
  Lock,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Upload,
} from 'lucide-react';
import type {
  AppCategory,
  EmailLog,
  EmailTemplate,
  HotelSettings,
  LicenseStatus,
  MenuItem,
  NetworkInfo,
  Room,
  ShiftRecord,
  StaffRole,
  StaffUser,
  TaxAppliesTo,
  TaxMode,
  TaxRule,
} from '../types';
import { STAFF_ROLE_LABELS } from '../utils/constants';
import { calculateTax } from '../utils/tax';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';

interface SettingsViewProps {
  settings: HotelSettings;
  rooms: Room[];
  menuItems: MenuItem[];
  categories: AppCategory[];
  emailTemplates: EmailTemplate[];
  staffUsers: StaffUser[];
  recentShifts: ShiftRecord[];
  currentUserId: number;
  userRole: StaffRole;
  network: NetworkInfo | null;
  emailLogs: EmailLog[];
  wsConnected: boolean;
  license?: LicenseStatus | null;
  onActivateLicense?: (key: string) => Promise<string | null>;
  authFetch?: (url: string, init?: RequestInit) => Promise<Response>;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

const TEMPLATE_LABELS: Record<EmailTemplate['event_type'], string> = {
  reservation: 'Reservation Confirmation',
  checkin: 'Check-In Welcome',
  checkout: 'Check-Out Receipt',
};

function interpolatePreview(
  text: string,
  settings: HotelSettings,
  sampleTotals?: { totalAmount: number; depositPaid: number; balanceRemaining: number }
): string {
  const cur = settings.currency_symbol;
  const totalAmount = sampleTotals?.totalAmount ?? 380;
  const depositPaid = sampleTotals?.depositPaid ?? 150;
  const balanceRemaining = sampleTotals?.balanceRemaining ?? Math.max(0, totalAmount - depositPaid);
  const sample: Record<string, string> = {
    guest_name: 'Claire Bennett',
    hotel_name: settings.hotel_name,
    hotel_phone: settings.hotel_phone,
    hotel_email: settings.hotel_email,
    hotel_address: settings.hotel_address,
    hotel_website: settings.hotel_website,
    check_in_time: settings.check_in_time || '14:00',
    check_out_time: settings.check_out_time || '11:00',
    tax_id: settings.tax_id || '—',
    room_number: '301',
    room_type: 'Suite',
    confirmation_code: 'HSL-2601',
    check_in_date: new Date().toISOString().slice(0, 10),
    check_out_date: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
    nights: '2',
    total_amount: `${cur}${totalAmount.toFixed(2)}`,
    deposit_paid: `${cur}${depositPaid.toFixed(2)}`,
    balance_remaining: `${cur}${balanceRemaining.toFixed(2)}`,
    balance_due: `${cur}${balanceRemaining.toFixed(2)}`,
  };
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => sample[key] ?? '');
}

type SettingsTabId = 'profile' | 'tax' | 'rooms' | 'menu' | 'emails' | 'staff' | 'system';

export function SettingsView({
  settings,
  rooms,
  menuItems,
  categories,
  emailTemplates,
  staffUsers,
  recentShifts,
  currentUserId,
  userRole,
  network,
  emailLogs,
  wsConnected,
  license,
  onActivateLicense,
  authFetch,
  mutate,
}: SettingsViewProps) {
  const [settingsTab, setSettingsTab] = useState<SettingsTabId>('profile');
  const [newLicenseKey, setNewLicenseKey] = useState('');
  const [activatingLicense, setActivatingLicense] = useState(false);
  const [licenseFeedback, setLicenseFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [copiedMachineId, setCopiedMachineId] = useState(false);
  const [downloadingDiagnostics, setDownloadingDiagnostics] = useState(false);

  async function handleCopyMachineId(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedMachineId(true);
      window.setTimeout(() => setCopiedMachineId(false), 2000);
    } catch {
      // Ignore clipboard failures
    }
  }

  async function handleSubmitLicenseKey(e: React.FormEvent) {
    e.preventDefault();
    if (!onActivateLicense || !newLicenseKey.trim()) return;
    setLicenseFeedback(null);
    setActivatingLicense(true);
    try {
      const err = await onActivateLicense(newLicenseKey.trim());
      if (err) {
        setLicenseFeedback({ kind: 'err', text: err });
      } else {
        setNewLicenseKey('');
        setLicenseFeedback({ kind: 'ok', text: 'Activation key verified and saved.' });
      }
    } finally {
      setActivatingLicense(false);
    }
  }

  async function handleDownloadDiagnostics() {
    if (!authFetch) return;
    setDownloadingDiagnostics(true);
    try {
      const res = await authFetch('/api/system/diagnostics');
      if (!res.ok) return;
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hosila-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingDiagnostics(false);
    }
  }

  // 1. Hotel Profile & Policies state
  const [hotelName, setHotelName] = useState(settings.hotel_name);
  const [hotelTagline, setHotelTagline] = useState(settings.hotel_tagline);
  const [hotelAddress, setHotelAddress] = useState(settings.hotel_address);
  const [hotelPhone, setHotelPhone] = useState(settings.hotel_phone);
  const [hotelEmail, setHotelEmail] = useState(settings.hotel_email);
  const [hotelWebsite, setHotelWebsite] = useState(settings.hotel_website);
  const [hotelLogoUrl, setHotelLogoUrl] = useState(settings.hotel_logo_url);
  const [checkInTime, setCheckInTime] = useState(settings.check_in_time || '14:00');
  const [checkOutTime, setCheckOutTime] = useState(settings.check_out_time || '11:00');
  const [currencySymbol, setCurrencySymbol] = useState(settings.currency_symbol);
  const [taxId, setTaxId] = useState(settings.tax_id || '');
  const [nightAuditEnabled, setNightAuditEnabled] = useState(settings.night_audit_enabled === 1);
  const [nightAuditTime, setNightAuditTime] = useState(settings.night_audit_time || '02:00');
  const [autoBackupAfterAudit, setAutoBackupAfterAudit] = useState(settings.auto_backup_after_audit !== 0);
  const [backupRetentionCount, setBackupRetentionCount] = useState(String(settings.backup_retention_count ?? 30));
  const [logoError, setLogoError] = useState<string | null>(null);

  // 2. Multi-Tax Setup state
  const [taxModalOpen, setTaxModalOpen] = useState(false);
  const [editingTaxRule, setEditingTaxRule] = useState<TaxRule | null>(null);
  const [ruleName, setRuleName] = useState('');
  const [ruleRate, setRuleRate] = useState('');
  const [ruleMode, setRuleMode] = useState<TaxMode>('exclusive');
  const [ruleAppliesTo, setRuleAppliesTo] = useState<TaxAppliesTo>('both');
  const [ruleEnabled, setRuleEnabled] = useState(true);

  // Email Provider (Resend) config state — API key input is strictly write-only
  const [resendApiKeyInput, setResendApiKeyInput] = useState('');
  const [resendFromEmail, setResendFromEmail] = useState(settings.resend_from_email || '');
  const [savingEmailProvider, setSavingEmailProvider] = useState(false);

  // 3. Room Board Setup state
  const [roomModalOpen, setRoomModalOpen] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [rmNumber, setRmNumber] = useState('');
  const [rmType, setRmType] = useState('');
  const [rmFloor, setRmFloor] = useState('1');
  const [rmCapacity, setRmCapacity] = useState('2');
  const [rmRate, setRmRate] = useState('');
  const [rmNotes, setRmNotes] = useState('');

  const [bulkRoomType, setBulkRoomType] = useState('');
  const [bulkRoomRate, setBulkRoomRate] = useState('');

  // Delete confirmation modals (Room Board & Restaurant Menu)
  const [pendingDeleteRoom, setPendingDeleteRoom] = useState<Room | null>(null);
  const [pendingDeleteMenuItem, setPendingDeleteMenuItem] = useState<MenuItem | null>(null);
  const [deletingTarget, setDeletingTarget] = useState(false);

  // 4. Restaurant Menu Setup state
  const [menuCategoryFilter, setMenuCategoryFilter] = useState<string>('All');
  const [menuModalOpen, setMenuModalOpen] = useState(false);
  const [editingMenuItem, setEditingMenuItem] = useState<MenuItem | null>(null);
  const [mnName, setMnName] = useState('');
  const [mnCategory, setMnCategory] = useState<string>('');
  const [mnPrice, setMnPrice] = useState('');
  const [mnDescription, setMnDescription] = useState('');

  // 5. Email Template Editor state
  const [selectedTemplateKey, setSelectedTemplateKey] = useState<EmailTemplate['event_type']>('reservation');
  const activeTemplateFromServer = useMemo(
    () => emailTemplates.find((t) => t.event_type === selectedTemplateKey) ?? emailTemplates[0] ?? null,
    [emailTemplates, selectedTemplateKey]
  );

  const [tplSubject, setTplSubject] = useState('');
  const [tplHeadline, setTplHeadline] = useState('');
  const [tplIntro, setTplIntro] = useState('');
  const [tplBody, setTplBody] = useState('');
  const [tplClosing, setTplClosing] = useState('');
  const [tplShowLogo, setTplShowLogo] = useState(true);
  const [tplShowStayDetails, setTplShowStayDetails] = useState(true);
  const [tplShowFolioSummary, setTplShowFolioSummary] = useState(true);
  const [tplShowContactFooter, setTplShowContactFooter] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 6. Staff account creation modal
  const [staffModalOpen, setStaffModalOpen] = useState(false);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<StaffRole>('front_desk');
  const [newStaffPassword, setNewStaffPassword] = useState('');

  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    setHotelName(settings.hotel_name);
    setHotelTagline(settings.hotel_tagline);
    setHotelAddress(settings.hotel_address);
    setHotelPhone(settings.hotel_phone);
    setHotelEmail(settings.hotel_email);
    setHotelWebsite(settings.hotel_website);
    setHotelLogoUrl(settings.hotel_logo_url);
    setCheckInTime(settings.check_in_time || '14:00');
    setCheckOutTime(settings.check_out_time || '11:00');
    setCurrencySymbol(settings.currency_symbol);
    setTaxId(settings.tax_id || '');
    setNightAuditEnabled(settings.night_audit_enabled === 1);
    setNightAuditTime(settings.night_audit_time || '02:00');
    setAutoBackupAfterAudit(settings.auto_backup_after_audit !== 0);
    setBackupRetentionCount(String(settings.backup_retention_count ?? 30));
    setResendFromEmail(settings.resend_from_email || '');
  }, [settings]);

  useEffect(() => {
    if (!activeTemplateFromServer) return;
    setTplSubject(activeTemplateFromServer.subject);
    setTplHeadline(activeTemplateFromServer.headline);
    setTplIntro(activeTemplateFromServer.intro_text);
    setTplBody(activeTemplateFromServer.body_text);
    setTplClosing(activeTemplateFromServer.closing_text);
    setTplShowLogo(activeTemplateFromServer.show_logo === 1);
    setTplShowStayDetails(activeTemplateFromServer.show_stay_details === 1);
    setTplShowFolioSummary(activeTemplateFromServer.show_folio_summary === 1);
    setTplShowContactFooter(activeTemplateFromServer.show_contact_footer === 1);
  }, [activeTemplateFromServer]);

  const uniqueRoomTypes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) set.add(r.room_type);
    return Array.from(set).sort();
  }, [rooms]);

  const menuCategories = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const c of categories) {
      if (c.kind === 'menu' && c.active === 1 && c.name && !seen.has(c.name)) {
        seen.add(c.name);
        ordered.push(c.name);
      }
    }
    for (const m of menuItems) {
      if (m.category && !seen.has(m.category)) {
        seen.add(m.category);
        ordered.push(m.category);
      }
    }
    return ordered;
  }, [categories, menuItems]);

  const filteredMenuItems = useMemo(() => {
    if (menuCategoryFilter === 'All') return menuItems;
    return menuItems.filter((m) => m.category === menuCategoryFilter);
  }, [menuItems, menuCategoryFilter]);

  const taxRules = settings.tax_rules ?? [];

  // Live multi-tax calculation previews ($100 base for Accommodation & Restaurant)
  const sampleRoomTax = useMemo(
    () => calculateTax(100, 'accommodation', settings),
    [settings]
  );
  const sampleRestTax = useMemo(
    () => calculateTax(100, 'restaurant', settings),
    [settings]
  );
  // Sample 2-night reservation preview for Boarding Pass email preview
  const previewStayTax = useMemo(
    () => calculateTax(380, 'accommodation', settings),
    [settings]
  );
  const previewDepositPaid = 150;
  const previewBalanceRemaining = Math.max(
    0,
    Math.round((previewStayTax.totalAmount - previewDepositPaid) * 100) / 100
  );

  function handleLogoFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    setLogoError(null);
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      setLogoError('Please upload a PNG, JPEG, or WebP image file.');
      return;
    }
    if (file.size > 500_000) {
      setLogoError('Logo image must be under 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setHotelLogoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  }

  async function handleSaveProperty(e: React.FormEvent) {
    e.preventDefault();
    await mutate(
      '/api/settings',
      'PATCH',
      {
        hotel_name: hotelName,
        hotel_tagline: hotelTagline,
        hotel_address: hotelAddress,
        hotel_phone: hotelPhone,
        hotel_email: hotelEmail,
        hotel_website: hotelWebsite,
        hotel_logo_url: hotelLogoUrl,
        check_in_time: checkInTime,
        check_out_time: checkOutTime,
        currency_symbol: currencySymbol,
        tax_id: taxId,
        night_audit_enabled: nightAuditEnabled ? 1 : 0,
        night_audit_time: nightAuditTime,
        auto_backup_after_audit: autoBackupAfterAudit ? 1 : 0,
        backup_retention_count: Math.max(3, Math.min(365, Math.round(Number(backupRetentionCount) || 30))),
      },
      'Hotel profile, policies & night audit settings saved'
    );
  }

  async function handleToggleMasterTax(nextEnabled: boolean) {
    await mutate(
      '/api/settings',
      'PATCH',
      { tax_enabled: nextEnabled ? 1 : 0 },
      nextEnabled
        ? 'Transaction taxes enabled across active rules'
        : 'All transaction taxes turned off across modules'
    );
  }

  function openAddTaxModal() {
    setEditingTaxRule(null);
    setRuleName('');
    setRuleRate('');
    setRuleMode('exclusive');
    setRuleAppliesTo('both');
    setRuleEnabled(true);
    setTaxModalOpen(true);
  }

  function openEditTaxModal(rule: TaxRule) {
    setEditingTaxRule(rule);
    setRuleName(rule.name);
    setRuleRate(String(rule.rate));
    setRuleMode(rule.mode);
    setRuleAppliesTo(rule.applies_to);
    setRuleEnabled(rule.enabled === 1);
    setTaxModalOpen(true);
  }

  async function handleSaveTaxRule(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: ruleName.trim(),
      rate: Math.max(0, Number(ruleRate) || 0),
      mode: ruleMode,
      applies_to: ruleAppliesTo,
      enabled: ruleEnabled ? 1 : 0,
    };
    const ok = editingTaxRule
      ? await mutate(`/api/taxes/${editingTaxRule.id}`, 'PATCH', payload, `${payload.name} tax rule updated`)
      : await mutate('/api/taxes', 'POST', payload, `${payload.name} (${payload.rate}%) tax rule added`);
    if (ok) setTaxModalOpen(false);
  }

  async function handleToggleTaxRule(rule: TaxRule) {
    await mutate(
      `/api/taxes/${rule.id}`,
      'PATCH',
      { enabled: rule.enabled === 1 ? 0 : 1 },
      `${rule.name} ${rule.enabled === 1 ? 'paused' : 'activated'}`
    );
  }

  async function handleDeleteTaxRule(rule: TaxRule) {
    await mutate(`/api/taxes/${rule.id}`, 'DELETE', {}, `${rule.name} tax rule removed`);
  }

  async function handleSaveEmailProviderConfig(e: React.FormEvent) {
    e.preventDefault();
    setSavingEmailProvider(true);
    try {
      const payload: Record<string, unknown> = {
        resend_from_email: resendFromEmail.trim(),
      };
      if (resendApiKeyInput.trim()) {
        payload.resend_api_key = resendApiKeyInput.trim();
      }
      const ok = await mutate(
        '/api/settings',
        'PATCH',
        payload,
        resendApiKeyInput.trim()
          ? 'Resend API key and sender address saved'
          : 'Resend sender email saved'
      );
      if (ok) {
        setResendApiKeyInput('');
      }
    } finally {
      setSavingEmailProvider(false);
    }
  }

  async function handleClearResendKey() {
    const ok = await mutate(
      '/api/settings',
      'PATCH',
      { clear_resend_api_key: true },
      'Saved Resend API key cleared from Email Config'
    );
    if (ok) setResendApiKeyInput('');
  }

  function openAddRoomModal() {
    setEditingRoom(null);
    setRmNumber('');
    setRmType(uniqueRoomTypes[0] ?? '');
    setRmFloor('1');
    setRmCapacity('2');
    setRmRate('');
    setRmNotes('');
    setRoomModalOpen(true);
  }

  function openEditRoomModal(room: Room) {
    setEditingRoom(room);
    setRmNumber(room.room_number);
    setRmType(room.room_type);
    setRmFloor(String(room.floor));
    setRmCapacity(String(room.capacity));
    setRmRate(String(room.nightly_rate));
    setRmNotes(room.notes);
    setRoomModalOpen(true);
  }

  async function handleSaveRoom(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      room_number: rmNumber.trim(),
      room_type: rmType.trim(),
      floor: Number(rmFloor) || 1,
      capacity: Number(rmCapacity) || 2,
      nightly_rate: Number(rmRate) || 0,
      notes: rmNotes.trim(),
    };
    const ok = editingRoom
      ? await mutate(`/api/rooms/${editingRoom.id}`, 'PATCH', payload, `Room ${payload.room_number} updated`)
      : await mutate('/api/rooms', 'POST', payload, `Room ${payload.room_number} added to room board`);
    if (ok) setRoomModalOpen(false);
  }

  async function handleConfirmDeleteRoom() {
    if (!pendingDeleteRoom) return;
    setDeletingTarget(true);
    try {
      const ok = await mutate(
        `/api/rooms/${pendingDeleteRoom.id}`,
        'DELETE',
        {},
        `Room ${pendingDeleteRoom.room_number} removed`
      );
      if (ok) setPendingDeleteRoom(null);
    } finally {
      setDeletingTarget(false);
    }
  }

  async function handleConfirmDeleteMenuItem() {
    if (!pendingDeleteMenuItem) return;
    setDeletingTarget(true);
    try {
      const ok = await mutate(
        `/api/menu/${pendingDeleteMenuItem.id}`,
        'DELETE',
        {},
        `${pendingDeleteMenuItem.name} deleted from menu`
      );
      if (ok) setPendingDeleteMenuItem(null);
    } finally {
      setDeletingTarget(false);
    }
  }

  async function handleBulkRateUpdate(e: React.FormEvent) {
    e.preventDefault();
    const targetType = bulkRoomType || uniqueRoomTypes[0];
    if (!targetType || !bulkRoomRate) return;
    const ok = await mutate(
      '/api/rooms/bulk-rate',
      'PATCH',
      { room_type: targetType, nightly_rate: Number(bulkRoomRate) },
      `Updated all ${targetType} rooms to ${settings.currency_symbol}${Number(bulkRoomRate).toFixed(2)}/night`
    );
    if (ok) setBulkRoomRate('');
  }

  function openAddMenuModal() {
    setEditingMenuItem(null);
    setMnName('');
    setMnCategory(menuCategories[0] ?? '');
    setMnPrice('');
    setMnDescription('');
    setMenuModalOpen(true);
  }

  function openEditMenuModal(item: MenuItem) {
    setEditingMenuItem(item);
    setMnName(item.name);
    setMnCategory(item.category);
    setMnPrice(String(item.price));
    setMnDescription(item.description);
    setMenuModalOpen(true);
  }

  async function handleSaveMenuItem(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      name: mnName.trim(),
      category: mnCategory,
      price: Number(mnPrice) || 0,
      description: mnDescription.trim(),
    };
    const ok = editingMenuItem
      ? await mutate(`/api/menu/${editingMenuItem.id}`, 'PATCH', payload, `${payload.name} updated`)
      : await mutate('/api/menu', 'POST', payload, `${payload.name} added to restaurant menu`);
    if (ok) setMenuModalOpen(false);
  }

  async function handleToggleMenuAvailability(item: MenuItem) {
    await mutate(
      `/api/menu/${item.id}`,
      'PATCH',
      { available: item.available ? 0 : 1 },
      `${item.name} marked ${item.available ? 'unavailable' : 'available'}`
    );
  }

  async function handleSaveTemplate(e: React.FormEvent) {
    e.preventDefault();
    await mutate(
      `/api/email-templates/${selectedTemplateKey}`,
      'PATCH',
      {
        subject: tplSubject,
        headline: tplHeadline,
        intro_text: tplIntro,
        body_text: tplBody,
        closing_text: tplClosing,
        show_logo: tplShowLogo,
        show_stay_details: tplShowStayDetails,
        show_folio_summary: tplShowFolioSummary,
        show_contact_footer: tplShowContactFooter,
      },
      `${TEMPLATE_LABELS[selectedTemplateKey]} HTML template saved`
    );
  }

  async function handleToggleSetting(
    key:
      | 'pos_enabled'
      | 'email_enabled'
      | 'email_on_reservation'
      | 'email_on_checkin'
      | 'email_on_checkout',
    nextVal: boolean
  ) {
    const messages: Record<typeof key, string> = {
      pos_enabled: nextVal
        ? 'Restaurant POS enabled on all workstations'
        : 'Restaurant POS disabled — manual folio entry active at Front Desk',
      email_enabled: nextVal
        ? 'Outgoing email service turned ON'
        : 'Outgoing email service turned OFF across all workflows',
      email_on_reservation: `Reservation confirmation emails ${nextVal ? 'enabled' : 'disabled'}`,
      email_on_checkin: `Check-in welcome emails ${nextVal ? 'enabled' : 'disabled'}`,
      email_on_checkout: `Check-out receipt emails ${nextVal ? 'enabled' : 'disabled'}`,
    };
    await mutate('/api/settings', 'PATCH', { [key]: nextVal ? 1 : 0 }, messages[key]);
  }

  async function handleRetryEmails() {
    if (settings.email_enabled !== 1) return;
    setRetrying(true);
    try {
      await mutate<{ attempted: number; sent: number; failed: number }>(
        '/api/emails/retry',
        'POST',
        {},
        network?.resendConfigured
          ? 'Queued outgoing emails processed'
          : 'Add your Resend API Key above to send queued emails'
      );
    } finally {
      setRetrying(false);
    }
  }

  async function handleCreateStaffUser(e: React.FormEvent) {
    e.preventDefault();
    const ok = await mutate(
      '/api/users',
      'POST',
      {
        full_name: newStaffName,
        username: newStaffUsername,
        role: newStaffRole,
        password: newStaffPassword,
      },
      `Created ${STAFF_ROLE_LABELS[newStaffRole]} account for ${newStaffName}`
    );
    if (ok) {
      setStaffModalOpen(false);
      setNewStaffName('');
      setNewStaffUsername('');
      setNewStaffPassword('');
      setNewStaffRole('front_desk');
    }
  }

  async function handleToggleStaffActive(user: StaffUser) {
    await mutate(
      `/api/users/${user.id}`,
      'PATCH',
      { active: user.active !== 1 },
      `${user.full_name} ${user.active === 1 ? 'deactivated' : 'reactivated'}`
    );
  }

  function copyAddress(url: string) {
    navigator.clipboard?.writeText(url);
    setCopiedUrl(url);
    window.setTimeout(() => setCopiedUrl(null), 1800);
  }

  function downloadWindowsLauncher() {
    const primaryUrl = network?.lanUrls[0] ?? network?.localUrl ?? window.location.origin;
    const batContent = [
      '@echo off',
      'title Hosila PMS - Local Hotel Management',
      `echo Launching Hosila PMS Workstation (${primaryUrl})...`,
      `start "" msedge --app="${primaryUrl}"`,
      'if errorlevel 1 (',
      `  start "" chrome --app="${primaryUrl}"`,
      ')',
      'exit',
    ].join('\r\n');
    const blob = new Blob([batContent], { type: 'application/x-bat' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'Launch-Hosila-PMS-Windows.bat';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  const queuedCount = emailLogs.filter((l) => l.status === 'queued' || l.status === 'failed').length;
  const currency = settings.currency_symbol;

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Fixed Settings Section Tabs */}
      <div className="no-print shrink-0 bg-canvas border-b border-ink/10 px-4 pt-4 md:px-5 md:pt-5 lg:px-7 lg:pt-6 overflow-x-auto no-scrollbar">
        <div role="tablist" aria-label="Settings sections" className="flex items-center gap-x-5 sm:gap-x-6 min-w-max">
          {(
            [
              ['profile', 'Hotel Profile & Policies'],
              ['tax', 'Tax Setup'],
              ['rooms', 'Room Board Setup'],
              ['menu', 'Restaurant Menu'],
              ['emails', 'Email Config'],
              ['staff', 'Staff & Shifts'],
              ['system', 'LAN Sync'],
            ] as Array<[SettingsTabId, string]>
          ).map(([id, label]) => {
            const active = settingsTab === id;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSettingsTab(id)}
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

      {/* Scrollable Settings Body */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-5 lg:px-7">
      <div className="max-w-6xl space-y-6">
      {/* TAB 1: HOTEL PROFILE, LOGO & POLICIES */}
      {settingsTab === 'profile' && (
        <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-6">
          <h2 className="text-base font-semibold text-ink">Hotel Profile, Logo &amp; Policies</h2>

          <form onSubmit={handleSaveProperty} className="space-y-6">
            {/* Logo Upload or Direct URL */}
            <div className="rounded-2xl border border-ink/10 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="text-sm font-medium text-ink">Hotel Logo</div>
                <div className="flex items-center gap-2">
                  <HoverTip text="Upload a PNG, JPEG, or WebP logo (up to 500 KB) for guest emails and printed invoices.">
                    <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04]">
                      <Upload className="h-3.5 w-3.5" />
                      Upload Logo
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleLogoFileUpload}
                        className="sr-only"
                      />
                    </label>
                  </HoverTip>
                  {hotelLogoUrl && (
                    <button
                      type="button"
                      onClick={() => setHotelLogoUrl('')}
                      className="rounded-xl px-3 py-2 text-xs font-medium text-ink/60 hover:bg-ink/[0.05]"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {logoError && <p className="text-xs font-medium text-ink">{logoError}</p>}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-ink/60 mb-1.5">Logo Image URL</label>
                  <input
                    type="text"
                    value={hotelLogoUrl.startsWith('data:image/') ? '[Uploaded local logo image]' : hotelLogoUrl}
                    onChange={(e) => setHotelLogoUrl(e.target.value)}
                    placeholder="https://yourdomain.com/logo.png"
                    className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-mono text-ink"
                  />
                  <p className="mt-1 text-[11px] text-ink/45">
                    Public HTTPS links render directly in guest emails; uploaded logos are embedded automatically as inline email attachments for Gmail, Apple Mail, and Outlook on phones.
                  </p>
                </div>
                <div className="flex h-16 items-center justify-center rounded-xl border border-ink/10 bg-ink/[0.02] px-4">
                  {hotelLogoUrl ? (
                    <img
                      src={hotelLogoUrl}
                      alt="Hotel logo preview"
                      referrerPolicy="no-referrer"
                      className="max-h-11 max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-ink/40">No logo set</span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Hotel Name *</label>
                <input
                  type="text"
                  required
                  value={hotelName}
                  onChange={(e) => setHotelName(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Tagline / Subtitle</label>
                <input
                  type="text"
                  value={hotelTagline}
                  onChange={(e) => setHotelTagline(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Street Address</label>
                <input
                  type="text"
                  value={hotelAddress}
                  onChange={(e) => setHotelAddress(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Front Desk Phone</label>
                <input
                  type="text"
                  value={hotelPhone}
                  onChange={(e) => setHotelPhone(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Hotel Contact Email</label>
                <input
                  type="email"
                  value={hotelEmail}
                  onChange={(e) => setHotelEmail(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Hotel Website</label>
                <input
                  type="text"
                  value={hotelWebsite}
                  onChange={(e) => setHotelWebsite(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Tax ID / Registration</label>
                <input
                  type="text"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                  placeholder="e.g. TIN-4820194"
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
                />
              </div>
              <div className="grid grid-cols-3 gap-3 sm:col-span-2">
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Check-In Time</label>
                  <input
                    type="time"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Check-Out Time</label>
                  <input
                    type="time"
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Currency Symbol</label>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      maxLength={6}
                      required
                      placeholder="₦"
                      value={currencySymbol}
                      onChange={(e) => setCurrencySymbol(e.target.value)}
                      className="w-full rounded-xl border border-ink/15 px-3 py-2.5 font-mono text-sm text-ink"
                    />
                    {['₦', '$', '£', '€'].map((sym) => (
                      <button
                        key={sym}
                        type="button"
                        onClick={() => setCurrencySymbol(sym)}
                        className={`rounded-lg border px-2 py-2 font-mono text-xs transition-colors shrink-0 ${
                          currencySymbol === sym
                            ? 'border-[#6AD4B0] bg-[#6AD4B0]/20 font-semibold text-ink'
                            : 'border-ink/12 text-ink/65 hover:border-ink/30'
                        }`}
                      >
                        {sym}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Night Audit Automation & Post-Audit Automatic Backup */}
            <div className="rounded-2xl border border-ink/10 p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-ink">
                  Night Audit &amp; Automatic Backup
                </div>
                <div className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums text-ink/60">
                  <span>
                    Business Date: <strong className="text-ink">{settings.business_date || '—'}</strong>
                  </span>
                  {settings.last_night_audit_date && (
                    <span>
                      Last Audit: <strong className="text-accent-ink">{settings.last_night_audit_date}</strong>
                    </span>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <HoverTip
                  text="Automatically closes the hotel's business date at the scheduled Night Audit Time, posts holdover stays, verifies ledger balance, and rolls the business date forward."
                  className="block w-full"
                >
                  <div className="flex items-center justify-between rounded-xl border border-ink/10 px-4 py-3">
                    <div>
                      <div className="text-xs font-semibold text-ink">Automated Night Audit</div>
                      <div className="text-[11px] text-ink/55">
                        {nightAuditEnabled ? `Scheduled daily at ${nightAuditTime}` : 'Manual execution only'}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={nightAuditEnabled}
                      onClick={() => setNightAuditEnabled((v) => !v)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        nightAuditEnabled ? 'bg-[#6AD4B0]' : 'bg-ink/18'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          nightAuditEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </HoverTip>

                <HoverTip
                  text="Creates a verified local SQLite backup file immediately after every automatic or manual Night Audit."
                  className="block w-full"
                >
                  <div className="flex items-center justify-between rounded-xl border border-ink/10 px-4 py-3">
                    <div>
                      <div className="text-xs font-semibold text-ink">Auto Backup After Audit</div>
                      <div className="text-[11px] text-ink/55">
                        {autoBackupAfterAudit ? 'Saves local .db snapshot after audit' : 'Disabled'}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={autoBackupAfterAudit}
                      onClick={() => setAutoBackupAfterAudit((v) => !v)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                        autoBackupAfterAudit ? 'bg-[#6AD4B0]' : 'bg-ink/18'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                          autoBackupAfterAudit ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </HoverTip>

                <div>
                  <HoverTip
                    text="Local server time to run the Night Audit. Times from 00:00–05:59 close the previous evening's business date; times 06:00–23:59 close the same day."
                    className="block w-full"
                  >
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Night Audit Time (24h)
                    </label>
                    <input
                      type="time"
                      required
                      value={nightAuditTime}
                      onChange={(e) => setNightAuditTime(e.target.value)}
                      className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
                    />
                  </HoverTip>
                </div>

                <div>
                  <HoverTip
                    text="Number of recent backup snapshots kept automatically on disk before older backups are pruned (3 to 365)."
                    className="block w-full"
                  >
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Backup Retention (Copies)
                    </label>
                    <input
                      type="number"
                      min={3}
                      max={365}
                      required
                      value={backupRetentionCount}
                      onChange={(e) => setBackupRetentionCount(e.target.value)}
                      className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
                    />
                  </HoverTip>
                </div>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="submit"
                className="rounded-xl bg-[#6AD4B0] px-5 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
              >
                Save Hotel Profile &amp; Policies
              </button>
            </div>
          </form>
        </section>
      )}

      {/* TAB 2: MULTI-TAX SETUP */}
      {settingsTab === 'tax' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">Transaction Taxes</h2>

              <HoverTip text="Master switch for all tax rules across Check-In, Reservations, Guest Folio, and Restaurant POS.">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-ink/65">
                    {settings.tax_enabled === 1 ? 'Taxes Active' : 'All Taxes Off'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.tax_enabled === 1}
                    onClick={() => handleToggleMasterTax(settings.tax_enabled !== 1)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                      settings.tax_enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settings.tax_enabled === 1 ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </HoverTip>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 pt-5">
              <h3 className="text-sm font-semibold text-ink">
                Configured Tax Rules ({taxRules.length})
              </h3>
              <HoverTip text="Add VAT, State Tax, Service Charge, or Tourism Levy as exclusive or price-inclusive rules.">
                <button
                  type="button"
                  onClick={openAddTaxModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Tax Rule
                </button>
              </HoverTip>
            </div>

            <div className={`overflow-x-auto rounded-xl border border-ink/10 ${settings.tax_enabled === 0 ? 'opacity-55' : ''}`}>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Tax Name</th>
                    <th className="py-3 px-4 text-right">Rate</th>
                    <th className="py-3 px-4">Calculation</th>
                    <th className="py-3 px-4">Applies To</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {taxRules.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-10 text-center text-xs text-ink/45">
                        No tax rules configured yet. Click &ldquo;Add Tax Rule&rdquo; to create VAT, State Tax, or Service Charge.
                      </td>
                    </tr>
                  ) : (
                    taxRules.map((rule) => (
                      <tr key={rule.id} className="hover:bg-ink/[0.02]">
                        <td className="py-3 px-4 font-medium text-ink">{rule.name}</td>
                        <td className="py-3 px-4 text-right font-mono font-semibold tabular-nums text-ink">
                          {rule.rate}%
                        </td>
                        <td className="py-3 px-4 text-xs text-ink/70 capitalize">
                          {rule.mode === 'exclusive' ? 'Excluded (Added on top)' : 'Included in price'}
                        </td>
                        <td className="py-3 px-4 text-xs text-ink/70">
                          {rule.applies_to === 'both'
                            ? 'Accommodation & Restaurant'
                            : rule.applies_to === 'accommodation'
                              ? 'Accommodation Only'
                              : 'Restaurant Only'}
                        </td>
                        <td className="py-3 px-4">
                          <button
                            type="button"
                            onClick={() => handleToggleTaxRule(rule)}
                            className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                              rule.enabled === 1 ? 'text-ink' : 'text-ink/40'
                            }`}
                          >
                            <span
                              className={`h-2 w-2 rounded-full ${
                                rule.enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/25'
                              }`}
                            />
                            {rule.enabled === 1 ? 'Active' : 'Paused'}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => openEditTaxModal(rule)}
                              aria-label={`Edit ${rule.name}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteTaxRule(rule)}
                              aria-label={`Delete ${rule.name}`}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-ink/[0.06] hover:text-ink"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Live Multi-Tax Calculation Preview */}
            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4 space-y-3">
              <div className="text-xs font-semibold text-ink">
                Live Multi-Tax Preview (Sample {currency}100.00 Base Price)
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="rounded-xl border border-ink/10 bg-surface p-3.5 space-y-1.5">
                  <div className="font-medium text-ink">Accommodation (Check-In / Reservation / Folio)</div>
                  <div className="flex justify-between text-ink/60">
                    <span>Net Revenue</span>
                    <span className="font-mono tabular-nums">
                      {currency}
                      {sampleRoomTax.netAmount.toFixed(2)}
                    </span>
                  </div>
                  {sampleRoomTax.applicable && sampleRoomTax.breakdown.length > 0 ? (
                    sampleRoomTax.breakdown.map((b) => (
                      <div key={`${b.name}-${b.rate}-${b.mode}`} className="flex justify-between text-ink/65">
                        <span>
                          {b.name} ({b.rate}% {b.mode === 'inclusive' ? 'incl.' : 'excl.'})
                        </span>
                        <span className="font-mono tabular-nums">
                          {currency}
                          {b.amount.toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between text-ink/45">
                      <span>{settings.tax_enabled === 0 ? 'All Taxes Off' : 'No Accommodation Taxes'}</span>
                      <span className="font-mono tabular-nums">{currency}0.00</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-ink/8 pt-1.5 font-semibold text-ink">
                    <span>Guest Pays</span>
                    <span className="font-mono tabular-nums">
                      {currency}
                      {sampleRoomTax.totalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>

                <div className="rounded-xl border border-ink/10 bg-surface p-3.5 space-y-1.5">
                  <div className="font-medium text-ink">Restaurant (POS / Manual Dining)</div>
                  <div className="flex justify-between text-ink/60">
                    <span>Net Revenue</span>
                    <span className="font-mono tabular-nums">
                      {currency}
                      {sampleRestTax.netAmount.toFixed(2)}
                    </span>
                  </div>
                  {sampleRestTax.applicable && sampleRestTax.breakdown.length > 0 ? (
                    sampleRestTax.breakdown.map((b) => (
                      <div key={`${b.name}-${b.rate}-${b.mode}`} className="flex justify-between text-ink/65">
                        <span>
                          {b.name} ({b.rate}% {b.mode === 'inclusive' ? 'incl.' : 'excl.'})
                        </span>
                        <span className="font-mono tabular-nums">
                          {currency}
                          {b.amount.toFixed(2)}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="flex justify-between text-ink/45">
                      <span>{settings.tax_enabled === 0 ? 'All Taxes Off' : 'No Restaurant Taxes'}</span>
                      <span className="font-mono tabular-nums">{currency}0.00</span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-ink/8 pt-1.5 font-semibold text-ink">
                    <span>Guest Pays</span>
                    <span className="font-mono tabular-nums">
                      {currency}
                      {sampleRestTax.totalAmount.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* TAB 3: ROOM BOARD SETUP */}
      {settingsTab === 'rooms' && (
        <div className="space-y-6">
          <section className="rounded-2xl border border-ink/12 p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">Room Board Inventory ({rooms.length})</h2>
              <HoverTip text="Add a new room with floor, category, guest capacity, and nightly rate.">
                <button
                  type="button"
                  onClick={openAddRoomModal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Room
                </button>
              </HoverTip>
            </div>

            {/* Bulk Rate Update by Category */}
            {uniqueRoomTypes.length > 0 && (
              <form
                onSubmit={handleBulkRateUpdate}
                className="flex flex-wrap items-end gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] p-4"
              >
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-[11px] font-medium text-ink/60 mb-1">
                    Bulk Update Rate by Room Category
                  </label>
                  <select
                    value={bulkRoomType || uniqueRoomTypes[0]}
                    onChange={(e) => setBulkRoomType(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2 text-xs text-ink"
                  >
                    {uniqueRoomTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="w-40">
                  <label className="block text-[11px] font-medium text-ink/60 mb-1">
                    New Rate ({currency}/night)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={bulkRoomRate}
                    onChange={(e) => setBulkRoomRate(e.target.value)}
                    placeholder="e.g. 149.00"
                    className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2 font-mono text-xs tabular-nums text-ink"
                  />
                </div>
                <HoverTip text="Updates the standard nightly rate for all rooms in the selected category at once.">
                  <button
                    type="submit"
                    className="rounded-xl border border-ink/15 bg-surface px-4 py-2 text-xs font-semibold text-ink hover:border-[#6AD4B0] hover:bg-[#6AD4B0]/15 transition-colors"
                  >
                    Apply to Category
                  </button>
                </HoverTip>
              </form>
            )}

            {/* Rooms Inventory Table */}
            <div className="overflow-x-auto rounded-xl border border-ink/10">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Room #</th>
                    <th className="py-3 px-4">Category / Type</th>
                    <th className="py-3 px-4 text-right">Floor</th>
                    <th className="py-3 px-4 text-right">Max Guests</th>
                    <th className="py-3 px-4 text-right">Nightly Rate</th>
                    <th className="py-3 px-4">Notes</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {rooms.map((room) => (
                    <tr key={room.id} className="hover:bg-ink/[0.02]">
                      <td className="py-2.5 px-4 font-mono font-semibold tabular-nums text-ink">
                        {room.room_number}
                      </td>
                      <td className="py-2.5 px-4 text-xs font-medium text-ink">{room.room_type}</td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink/65">
                        {room.floor}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-ink/65">
                        {room.capacity}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink">
                        {currency}
                        {room.nightly_rate.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-ink/55 truncate max-w-[180px]">
                        {room.notes || '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditRoomModal(room)}
                            aria-label={`Edit Room ${room.room_number}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteRoom(room)}
                            aria-label={`Delete Room ${room.room_number}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 4: RESTAURANT POS MODULE TOGGLE & MENU SETUP */}
      {settingsTab === 'menu' && (
        <div className="space-y-6">
          {/* Moved Restaurant POS Module Toggle */}
          <section className="rounded-2xl border border-ink/12 p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">Restaurant Operations (POS) Module</h2>
              <HoverTip text="Enable when the restaurant runs a POS workstation on the LAN. Disable to hide Restaurant POS and enter paper dining tickets manually inside Guest Folio.">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-medium text-ink/65">
                    {settings.pos_enabled === 1 ? 'POS Enabled' : 'Manual Folio Mode'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.pos_enabled === 1}
                    onClick={() => handleToggleSetting('pos_enabled', settings.pos_enabled !== 1)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                      settings.pos_enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settings.pos_enabled === 1 ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </HoverTip>
            </div>
          </section>

          <section className="rounded-2xl border border-ink/12 p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">
                Restaurant Menu Catalog ({menuItems.length})
              </h2>
              <button
                type="button"
                onClick={openAddMenuModal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Menu Item
              </button>
            </div>

          <div className="flex flex-wrap items-center gap-1 rounded-xl bg-ink/[0.05] p-1 w-fit">
            {['All', ...menuCategories].map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setMenuCategoryFilter(cat)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  menuCategoryFilter === cat
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-xl border border-ink/10">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-4">Category</th>
                  <th className="py-3 px-4 text-right">Price</th>
                  <th className="py-3 px-4">Availability</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8">
                {filteredMenuItems.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-xs text-ink/45">
                      No menu items in this category.
                    </td>
                  </tr>
                ) : (
                  filteredMenuItems.map((item) => (
                    <tr key={item.id} className="hover:bg-ink/[0.02]">
                      <td className="py-2.5 px-4">
                        <div className="font-medium text-ink">{item.name}</div>
                        {item.description && (
                          <div className="text-xs text-ink/50 truncate max-w-sm">{item.description}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-ink/65 whitespace-nowrap">
                        {item.category}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                        {currency}
                        {item.price.toFixed(2)}
                      </td>
                      <td className="py-2.5 px-4">
                        <button
                          type="button"
                          onClick={() => handleToggleMenuAvailability(item)}
                          className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                            item.available === 1 ? 'text-ink' : 'text-ink/40'
                          }`}
                        >
                          <span
                            className={`h-2 w-2 rounded-full ${
                              item.available === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/25'
                            }`}
                          />
                          {item.available === 1 ? 'Available' : 'Unavailable'}
                        </button>
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => openEditMenuModal(item)}
                            aria-label={`Edit ${item.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDeleteMenuItem(item)}
                            aria-label={`Delete ${item.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          </section>
        </div>
      )}

      {/* TAB 5: EMAIL CONFIG (MASTER TOGGLE, RESEND API, TEMPLATES & OUTBOX) */}
      {settingsTab === 'emails' && (
        <div className="space-y-8">
          {/* Master Email Service Toggle + Resend API Credentials */}
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">Email Service &amp; Resend Configuration</h2>
              <HoverTip text="Master toggle for all outgoing guest emails. Reservation, check-in, check-out, and manual folio emails check this switch first.">
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
                    <span
                      className={`h-2 w-2 rounded-full ${
                        settings.email_enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/25'
                      }`}
                    />
                    {settings.email_enabled === 1 ? 'Email Service On' : 'Email Service Off'}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={settings.email_enabled === 1}
                    onClick={() => handleToggleSetting('email_enabled', settings.email_enabled !== 1)}
                    className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
                      settings.email_enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                        settings.email_enabled === 1 ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </HoverTip>
            </div>

            {/* Resend API Key & From Email Form */}
            <form
              onSubmit={handleSaveEmailProviderConfig}
              className="rounded-xl border border-ink/10 bg-ink/[0.02] p-5 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-sm font-semibold text-ink">Resend Provider Settings</div>
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink whitespace-nowrap">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      settings.resend_key_configured ? 'bg-[#6AD4B0]' : 'bg-ink/30'
                    }`}
                  />
                  {settings.resend_key_source === 'settings'
                    ? 'Resend Key Saved'
                    : settings.resend_key_source === 'env'
                      ? 'Using Server Env Key'
                      : 'API Key Not Set'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">
                    Resend API Key
                  </label>
                  <input
                    type="password"
                    autoComplete="new-password"
                    value={resendApiKeyInput}
                    onChange={(e) => setResendApiKeyInput(e.target.value)}
                    placeholder={
                      settings.resend_key_configured
                        ? '•••••••••••••••• (leave blank to keep saved key)'
                        : 're_xxxxxxxxxxxxxxxxxxxxxxxxx'
                    }
                    className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 font-mono text-xs text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">
                    Resend From Email
                  </label>
                  <input
                    type="text"
                    value={resendFromEmail}
                    onChange={(e) => setResendFromEmail(e.target.value)}
                    placeholder={`${settings.hotel_name} <reservations@yourdomain.com>`}
                    className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-xs text-ink"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
                <div>
                  {settings.resend_key_source === 'settings' && (
                    <button
                      type="button"
                      onClick={handleClearResendKey}
                      className="text-xs font-medium text-ink/55 hover:text-ink underline underline-offset-4"
                    >
                      Clear Saved API Key
                    </button>
                  )}
                </div>
                <button
                  type="submit"
                  disabled={savingEmailProvider}
                  className="rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
                >
                  {savingEmailProvider ? 'Saving...' : 'Save Resend Config'}
                </button>
              </div>
            </form>

            {/* Automated Trigger Switches */}
            <div className={`grid grid-cols-1 sm:grid-cols-3 gap-3 ${settings.email_enabled === 0 ? 'opacity-45' : ''}`}>
              {(
                [
                  ['email_on_reservation', 'On Reservation'],
                  ['email_on_checkin', 'On Check-In'],
                  ['email_on_checkout', 'On Check-Out'],
                ] as const
              ).map(([key, label]) => {
                const enabled = settings[key] === 1;
                return (
                  <div
                    key={key}
                    className="flex items-center justify-between rounded-xl border border-ink/10 px-4 py-3"
                  >
                    <span className="text-xs font-medium text-ink">{label}</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      disabled={settings.email_enabled === 0}
                      onClick={() => handleToggleSetting(key, !enabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:cursor-not-allowed ${
                        enabled && settings.email_enabled === 1 ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 pt-5">
              <div className="inline-flex rounded-xl bg-ink/[0.05] p-1">
                {(['reservation', 'checkin', 'checkout'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedTemplateKey(key)}
                    className={`rounded-lg px-3.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                      selectedTemplateKey === key
                        ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                        : 'text-ink/60 hover:text-ink'
                    }`}
                  >
                    {TEMPLATE_LABELS[key]}
                  </button>
                ))}
              </div>

              <HoverTip text="Preview how this HTML email renders with your logo, tax rules, and hotel details.">
                <button
                  type="button"
                  onClick={() => setPreviewOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] whitespace-nowrap"
                >
                  <Eye className="h-3.5 w-3.5" />
                  Preview HTML Email
                </button>
              </HoverTip>
            </div>

            <form onSubmit={handleSaveTemplate} className="space-y-4">

              <div className="text-xs text-ink/50">
                Available variables:{' '}
                <span className="font-mono text-ink/75">
                  {'{{guest_name}} · {{hotel_name}} · {{room_number}} · {{confirmation_code}} · {{check_in_date}} · {{check_out_date}} · {{nights}} · {{check_in_time}} · {{check_out_time}} · {{total_amount}} · {{deposit_paid}} · {{balance_remaining}} · {{tax_id}}'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Email Subject *</label>
                  <input
                    type="text"
                    required
                    value={tplSubject}
                    onChange={(e) => setTplSubject(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Email Headline *</label>
                  <input
                    type="text"
                    required
                    value={tplHeadline}
                    onChange={(e) => setTplHeadline(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Opening / Greeting</label>
                <textarea
                  rows={2}
                  value={tplIntro}
                  onChange={(e) => setTplIntro(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">
                  Hotel Policies, Amenities &amp; Custom Details
                </label>
                <textarea
                  rows={3}
                  value={tplBody}
                  onChange={(e) => setTplBody(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Closing Sign-Off</label>
                <textarea
                  rows={2}
                  value={tplClosing}
                  onChange={(e) => setTplClosing(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
              </div>

              <div className="rounded-xl border border-ink/10 p-4 space-y-2.5">
                <div className="text-xs font-medium text-ink/65">
                  Sections Included in This HTML Email
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs text-ink">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tplShowLogo}
                      onChange={(e) => setTplShowLogo(e.target.checked)}
                      className="h-4 w-4 accent-[#6AD4B0]"
                    />
                    <span>Show Hotel Logo</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tplShowStayDetails}
                      onChange={(e) => setTplShowStayDetails(e.target.checked)}
                      className="h-4 w-4 accent-[#6AD4B0]"
                    />
                    <span>Include Reservation &amp; Room Table</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tplShowFolioSummary}
                      onChange={(e) => setTplShowFolioSummary(e.target.checked)}
                      className="h-4 w-4 accent-[#6AD4B0]"
                    />
                    <span>Include Itemized Folio &amp; Balance</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={tplShowContactFooter}
                      onChange={(e) => setTplShowContactFooter(e.target.checked)}
                      className="h-4 w-4 accent-[#6AD4B0]"
                    />
                    <span>Include Hotel Address &amp; Contact Footer</span>
                  </label>
                </div>
              </div>

              <div className="flex justify-end pt-1">
                <button
                  type="submit"
                  className="rounded-xl bg-[#6AD4B0] px-5 py-2.5 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
                >
                  Save {TEMPLATE_LABELS[selectedTemplateKey]} Template
                </button>
              </div>
            </form>
          </section>

          {/* Outbox Log */}
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-ink">
                Outgoing Email Log &amp; Offline Outbox ({emailLogs.length})
              </h3>
              {queuedCount > 0 && (
                <HoverTip
                  text={
                    settings.email_enabled !== 1
                      ? 'Turn on Email Service above to dispatch queued emails.'
                      : 'Retry sending offline-queued emails via Resend now.'
                  }
                >
                  <button
                    type="button"
                    onClick={handleRetryEmails}
                    disabled={retrying || settings.email_enabled !== 1}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#6AD4B0]/25 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-[#6AD4B0]/45 disabled:opacity-45"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} />
                    Retry {queuedCount} Queued
                  </button>
                </HoverTip>
              )}
            </div>

            {emailLogs.length === 0 ? (
              <p className="text-xs text-ink/45">No emails dispatched yet.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-ink/10">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ink/[0.02] text-ink/55">
                      <th className="py-2.5 px-3">Time</th>
                      <th className="py-2.5 px-3">Recipient</th>
                      <th className="py-2.5 px-3">Subject</th>
                      <th className="py-2.5 px-3 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink/8">
                    {emailLogs.slice(0, 12).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 px-3 font-mono tabular-nums text-ink/55 whitespace-nowrap">
                          {log.created_at.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-2.5 px-3 text-ink">{log.recipient_email}</td>
                        <td className="py-2.5 px-3 text-ink/75">
                          <div>{log.subject}</div>
                          {log.error_message && (
                            <div className="text-ink/45 mt-0.5">{log.error_message}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-right capitalize whitespace-nowrap font-medium">
                          <span className="inline-flex items-center gap-1.5 text-ink">
                            {log.status === 'sent' && <span className="h-1.5 w-1.5 rounded-full bg-[#6AD4B0]" />}
                            {log.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}

      {/* TAB 6: STAFF ACCOUNTS & SHIFTS */}
      {settingsTab === 'staff' && (
        <div className="space-y-8">
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">Staff Accounts &amp; Role Access</h2>
              <HoverTip text="Create a staff login. Management and Accountant access Finance & Settings; Auditor accesses Finance, Audit & Voids.">
                <button
                  type="button"
                  onClick={() => setStaffModalOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Staff Account
                </button>
              </HoverTip>
            </div>

            <div className="overflow-x-auto rounded-xl border border-ink/10">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Staff Name</th>
                    <th className="py-3 px-4">Username</th>
                    <th className="py-3 px-4">Role</th>
                    <th className="py-3 px-4">Financial Controls</th>
                    <th className="py-3 px-4 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {staffUsers.map((u) => {
                    const hasFullAccess = u.role === 'management' || u.role === 'accountant';
                    const hasAuditControl = u.role === 'auditor';
                    return (
                      <tr key={u.id}>
                        <td className="py-3 px-4 font-medium text-ink">{u.full_name}</td>
                        <td className="py-3 px-4 font-mono text-xs text-ink/65">@{u.username}</td>
                        <td className="py-3 px-4 text-xs text-ink">{STAFF_ROLE_LABELS[u.role]}</td>
                        <td className="py-3 px-4 text-xs">
                          <span className="inline-flex items-center gap-1.5 text-ink">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                hasFullAccess || hasAuditControl ? 'bg-[#6AD4B0]' : 'bg-ink/25'
                              }`}
                            />
                            {hasFullAccess
                              ? 'Finance, Voids & Settings'
                              : hasAuditControl
                                ? 'Finance, Audit & Voids'
                                : 'Restricted (No Voids)'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          {u.id === currentUserId ? (
                            <span className="text-xs text-ink/45">Current user</span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleToggleStaffActive(u)}
                              className="text-xs font-semibold text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4"
                            >
                              {u.active === 1 ? 'Deactivate' : 'Reactivate'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-4">
            <h2 className="text-base font-semibold text-ink">Recent Staff Shifts</h2>
            <div className="overflow-x-auto rounded-xl border border-ink/10">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-ink/55">
                    <th className="py-2.5 px-4">Staff Member</th>
                    <th className="py-2.5 px-4">Opened</th>
                    <th className="py-2.5 px-4">Closed</th>
                    <th className="py-2.5 px-4 text-right">Opening Cash</th>
                    <th className="py-2.5 px-4 text-right">Expected Cash</th>
                    <th className="py-2.5 px-4 text-right">Closing Cash</th>
                    <th className="py-2.5 px-4 text-right">Variance</th>
                    <th className="py-2.5 px-4">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8">
                  {recentShifts.map((sh) => {
                    const expectedCash = sh.expected_cash ?? null;
                    const variance = sh.cash_variance ?? null;
                    const isShort = variance !== null && variance < -0.005;
                    return (
                      <tr key={sh.id}>
                        <td className="py-2.5 px-4 font-medium text-ink">
                          {sh.user_name} · <span className="text-ink/55">{STAFF_ROLE_LABELS[sh.user_role]}</span>
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-ink/65 whitespace-nowrap">
                          {sh.opened_at.slice(0, 16).replace('T', ' ')}
                        </td>
                        <td className="py-2.5 px-4 font-mono tabular-nums text-ink/65 whitespace-nowrap">
                          {sh.closed_at ? sh.closed_at.slice(0, 16).replace('T', ' ') : 'Active'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {currency}
                          {sh.opening_cash.toFixed(2)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums text-ink/75 whitespace-nowrap">
                          {expectedCash !== null ? `${currency}${expectedCash.toFixed(2)}` : '—'}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums whitespace-nowrap">
                          {sh.closing_cash !== null ? `${currency}${sh.closing_cash.toFixed(2)}` : '—'}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right font-mono font-semibold tabular-nums whitespace-nowrap ${
                            variance === null
                              ? 'text-ink/40'
                              : isShort
                                ? 'text-danger-ink'
                                : 'text-accent-ink'
                          }`}
                        >
                          {variance === null
                            ? '—'
                            : `${variance >= 0 ? '+' : '−'}${currency}${Math.abs(variance).toFixed(2)}`}
                        </td>
                        <td className="py-2.5 px-4 text-ink/60">{sh.notes || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {/* TAB 7: LAN SYNC */}
      {settingsTab === 'system' && (
        <div className="space-y-8">
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <h2 className="text-base font-semibold text-ink">
                Local Network (LAN / WLAN) Multi-Workstation Sync
              </h2>
              <HoverTip text="Downloads a Windows .bat shortcut to launch Hosila PMS in native desktop app window mode over your LAN.">
                <button
                  type="button"
                  onClick={downloadWindowsLauncher}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] whitespace-nowrap shrink-0"
                >
                  <Download className="h-3.5 w-3.5" />
                  Windows Desktop Launcher (.bat)
                </button>
              </HoverTip>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-ink/10 p-4 space-y-2">
                <div className="text-xs font-medium text-ink/55">LAN Addresses for Other Workstations</div>
                {network && network.lanUrls.length > 0 ? (
                  <div className="space-y-2">
                    {network.lanUrls.map((url) => (
                      <div key={url} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-sm font-medium tabular-nums text-ink truncate">
                          {url}
                        </span>
                        <button
                          type="button"
                          onClick={() => copyAddress(url)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink shrink-0"
                        >
                          {copiedUrl === url ? (
                            <Check className="h-3.5 w-3.5 text-[#6AD4B0]" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                          {copiedUrl === url ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="font-mono text-sm text-ink">{network?.localUrl ?? window.location.origin}</div>
                )}
              </div>

              <div className="rounded-xl border border-ink/10 p-4 space-y-2">
                <div className="text-xs font-medium text-ink/55">Local Host &amp; Storage</div>
                <div className="text-xs text-ink/75 space-y-1">
                  <div>
                    Host Machine: <span className="font-mono text-ink">{network?.hostname ?? 'Local PC'}</span>
                  </div>
                  <div>
                    SQLite Database:{' '}
                    <span className="font-mono text-ink">data/{network?.databaseFile ?? 'hotel.db'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span>Sync Link:</span>
                    <span className="inline-flex items-center gap-1 font-medium text-ink">
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          wsConnected ? 'bg-[#6AD4B0]' : 'bg-ink/30'
                        }`}
                      />
                      {wsConnected ? 'Connected via Local WebSocket' : 'Reconnecting'}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {network && network.connectedStations.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-ink/55">
                  Active LAN Workstations ({network.connectedStations.length})
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {network.connectedStations.map((st) => (
                    <div
                      key={st.id}
                      className="flex items-center justify-between rounded-xl border border-ink/10 px-3.5 py-2.5 text-xs"
                    >
                      <div>
                        <div className="font-medium text-ink">{st.stationName}</div>
                        <div className="text-ink/50">{st.role}</div>
                      </div>
                      <span className="font-mono text-[11px] text-ink/45">{st.ip}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </section>

          {/* License & Offline Activation */}
          {license && (
            <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="space-y-0.5">
                  <h2 className="text-base font-semibold text-ink">License &amp; Offline Activation</h2>
                  <p className="text-xs text-ink/55">
                    Machine-locked Ed25519 license for this Host PC. LAN workstations share this license automatically.
                  </p>
                </div>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium ${
                    license.status === 'active' || license.status === 'trial'
                      ? 'border-[#6AD4B0]/50 bg-[#6AD4B0]/15 text-ink'
                      : 'border-[#E05252]/40 bg-[#E05252]/[0.07] text-danger-ink'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  <span className="capitalize">
                    {license.mode === 'master'
                      ? 'Master License'
                      : license.status === 'grace'
                        ? 'Grace Period'
                        : license.status}
                  </span>
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="rounded-xl border border-ink/10 p-4 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-ink/55">Host PC Machine ID</span>
                    <button
                      type="button"
                      onClick={() => handleCopyMachineId(license.machineId)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-ink"
                    >
                      {copiedMachineId ? (
                        <Check className="h-3.5 w-3.5 text-[#6AD4B0]" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      {copiedMachineId ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-ink select-all">
                    {license.machineId}
                  </div>
                  <div className="text-[11px] text-ink/50">
                    Share this Machine ID with Hosila Support to issue or renew your activation key.
                  </div>
                </div>

                <div className="rounded-xl border border-ink/10 p-4 space-y-1.5 text-xs text-ink/70">
                  <div className="font-medium text-ink/55 mb-1">Active License Details</div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50">Licensed Property</span>
                    <span className="font-medium text-ink truncate">{license.hotelName || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50">License ID</span>
                    <span className="font-mono tabular-nums text-ink">{license.licenseId || '—'}</span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50">Access Level</span>
                    <span className="font-medium text-ink">
                      {license.readOnly ? 'Read-Only (Expired)' : 'Full Access'}
                    </span>
                  </div>
                  <div className="flex justify-between gap-2">
                    <span className="text-ink/50">Expires</span>
                    <span className="font-mono tabular-nums text-ink">
                      {license.expiresAt
                        ? `${license.expiresAt.slice(0, 10)}${license.daysRemaining !== null ? ` (${license.daysRemaining}d)` : ''}`
                        : license.status === 'active'
                          ? 'Lifetime'
                          : '—'}
                    </span>
                  </div>
                </div>
              </div>

              {licenseFeedback && (
                <div
                  className={`rounded-xl border px-4 py-3 text-xs font-medium ${
                    licenseFeedback.kind === 'ok'
                      ? 'border-[#6AD4B0]/50 bg-[#6AD4B0]/12 text-ink'
                      : 'border-[#E05252]/35 bg-[#E05252]/[0.07] text-danger-ink'
                  }`}
                >
                  {licenseFeedback.text}
                </div>
              )}

              <form onSubmit={handleSubmitLicenseKey} className="space-y-3">
                <label className="flex items-center gap-1.5 text-xs font-medium text-ink/65">
                  <span>Activate or Renew License Key</span>
                  {userRole !== 'management' && <Lock className="h-3 w-3 text-ink/45" />}
                </label>
                <textarea
                  rows={2}
                  value={newLicenseKey}
                  onChange={(e) => setNewLicenseKey(e.target.value)}
                  readOnly={userRole !== 'management'}
                  placeholder="Paste signed HSL1... activation key"
                  className={`w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-xs resize-none ${
                    userRole !== 'management'
                      ? 'bg-ink/[0.04] text-ink/60 opacity-60 cursor-not-allowed'
                      : 'bg-canvas text-ink placeholder:text-ink/40'
                  }`}
                />
                <div className="flex justify-end">
                  {userRole === 'management' ? (
                    <button
                      type="submit"
                      disabled={activatingLicense || !newLicenseKey.trim()}
                      className="inline-flex items-center gap-2 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45 transition-colors"
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      {activatingLicense ? 'Verifying...' : 'Apply Activation Key'}
                    </button>
                  ) : (
                    <HoverTip text="Only Management accounts can activate or change the Hosila PMS license key.">
                      <button
                        type="button"
                        disabled
                        aria-disabled="true"
                        className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-ink/[0.03] px-4 py-2 text-xs font-medium text-ink/55 opacity-50 cursor-not-allowed"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Apply Activation Key
                      </button>
                    </HoverTip>
                  )}
                </div>
              </form>
            </section>
          )}

          {/* System Diagnostics Bundle */}
          <section className="rounded-2xl border border-ink/12 p-6 sm:p-8 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-ink">Support Diagnostic Bundle</h2>
              <p className="text-xs text-ink/55">
                Export redacted host health metrics, database size, schema migrations, and recent backup status (no guest PII or API keys).
              </p>
            </div>
            {userRole === 'management' ? (
              <button
                type="button"
                disabled={downloadingDiagnostics}
                onClick={handleDownloadDiagnostics}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-45 transition-colors"
              >
                <Download className="h-3.5 w-3.5" />
                {downloadingDiagnostics ? 'Preparing...' : 'Download Diagnostics (.json)'}
              </button>
            ) : (
              <HoverTip text="Only Management accounts can download system diagnostic bundles.">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-ink/[0.03] px-3.5 py-2 text-xs font-medium text-ink/55 opacity-50 cursor-not-allowed"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Download Diagnostics (.json)
                </button>
              </HoverTip>
            )}
          </section>
        </div>
      )}
      </div>
      </div>

      {/* Add / Edit Room Modal */}
      <Modal
        open={roomModalOpen}
        onClose={() => setRoomModalOpen(false)}
        title={editingRoom ? `Edit Room ${editingRoom.room_number}` : 'Add Room to Room Board'}
      >
        <form onSubmit={handleSaveRoom} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Room Number *</label>
              <input
                type="text"
                required
                value={rmNumber}
                onChange={(e) => setRmNumber(e.target.value)}
                placeholder="e.g. 204"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Room Type / Category *
              </label>
              <input
                type="text"
                required
                list="room-types-datalist"
                value={rmType}
                onChange={(e) => setRmType(e.target.value)}
                placeholder="e.g. Standard King, Deluxe Suite"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
              />
              <datalist id="room-types-datalist">
                {uniqueRoomTypes.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Floor *</label>
              <input
                type="number"
                min="0"
                max="100"
                required
                value={rmFloor}
                onChange={(e) => setRmFloor(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Max Guests</label>
              <input
                type="number"
                min="1"
                max="12"
                required
                value={rmCapacity}
                onChange={(e) => setRmCapacity(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Rate ({currency}/nt) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={rmRate}
                onChange={(e) => setRmRate(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Room Notes</label>
            <input
              type="text"
              value={rmNotes}
              onChange={(e) => setRmNotes(e.target.value)}
              placeholder="Ocean view, balcony, wheelchair accessible..."
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setRoomModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
            >
              {editingRoom ? 'Save Changes' : 'Add Room'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Menu Item Modal */}
      <Modal
        open={menuModalOpen}
        onClose={() => setMenuModalOpen(false)}
        title={editingMenuItem ? `Edit ${editingMenuItem.name}` : 'Add Restaurant Menu Item'}
      >
        <form onSubmit={handleSaveMenuItem} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Dish / Item Name *</label>
            <input
              type="text"
              required
              value={mnName}
              onChange={(e) => setMnName(e.target.value)}
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Category *</label>
              <input
                type="text"
                required
                list="menu-categories-datalist"
                value={mnCategory}
                onChange={(e) => setMnCategory(e.target.value)}
                placeholder="Choose or type category..."
                className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
              />
              <datalist id="menu-categories-datalist">
                {menuCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Price ({currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                value={mnPrice}
                onChange={(e) => setMnPrice(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Description</label>
            <input
              type="text"
              value={mnDescription}
              onChange={(e) => setMnDescription(e.target.value)}
              placeholder="Ingredients or preparation details"
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMenuModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
            >
              {editingMenuItem ? 'Save Item' : 'Add Item'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Add Staff Account Modal */}
      <Modal
        open={staffModalOpen}
        onClose={() => setStaffModalOpen(false)}
        title="Add Staff Account"
      >
        <form onSubmit={handleCreateStaffUser} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Full Name *</label>
            <input
              type="text"
              required
              value={newStaffName}
              onChange={(e) => setNewStaffName(e.target.value)}
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Username *</label>
              <input
                type="text"
                required
                value={newStaffUsername}
                onChange={(e) => setNewStaffUsername(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Role *</label>
              <select
                value={newStaffRole}
                onChange={(e) => setNewStaffRole(e.target.value as StaffRole)}
                className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="front_desk">Front Desk</option>
                <option value="restaurant">Restaurant</option>
                <option value="auditor">Auditor</option>
                <option value="accountant">Accountant</option>
                {userRole === 'management' && <option value="management">Management</option>}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Initial Password *</label>
            <input
              type="password"
              required
              minLength={4}
              value={newStaffPassword}
              onChange={(e) => setNewStaffPassword(e.target.value)}
              placeholder="Min 4 characters"
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setStaffModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
            >
              Create Account
            </button>
          </div>
        </form>
      </Modal>

      {/* Add / Edit Tax Rule Modal */}
      <Modal
        open={taxModalOpen}
        onClose={() => setTaxModalOpen(false)}
        title={editingTaxRule ? `Edit ${editingTaxRule.name}` : 'Add Tax Rule'}
      >
        <form onSubmit={handleSaveTaxRule} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Tax Name *
              </label>
              <input
                type="text"
                required
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                placeholder="e.g. VAT, State Tax, Service Charge"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Percentage (%) *
              </label>
              <input
                type="number"
                step="0.1"
                min="0"
                max="100"
                required
                value={ruleRate}
                onChange={(e) => setRuleRate(e.target.value)}
                placeholder="e.g. 7.5"
                className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Calculation Mode
              </label>
              <select
                value={ruleMode}
                onChange={(e) => setRuleMode(e.target.value as TaxMode)}
                className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="exclusive">Excluded — Add on top of base price</option>
                <option value="inclusive">Included — Base price includes tax</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Transactions Included
              </label>
              <select
                value={ruleAppliesTo}
                onChange={(e) => setRuleAppliesTo(e.target.value as TaxAppliesTo)}
                className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="both">Both Accommodation &amp; Restaurant</option>
                <option value="accommodation">Accommodation Only</option>
                <option value="restaurant">Restaurant Only</option>
              </select>
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-ink">
            <input
              type="checkbox"
              checked={ruleEnabled}
              onChange={(e) => setRuleEnabled(e.target.checked)}
              className="h-4 w-4 accent-[#6AD4B0]"
            />
            <span>Active immediately on new transactions</span>
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setTaxModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
            >
              {editingTaxRule ? 'Save Tax Rule' : 'Add Tax Rule'}
            </button>
          </div>
        </form>
      </Modal>

      {/* HTML Email Preview Modal — Unified Email Layout (Boarding-pass reservation details section for Reservation emails) */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title={`Preview · ${TEMPLATE_LABELS[selectedTemplateKey]}`}
        subtitle={`Subject: ${interpolatePreview(tplSubject, settings, {
          totalAmount: previewStayTax.totalAmount,
          depositPaid: previewDepositPaid,
          balanceRemaining: previewBalanceRemaining,
        })}`}
        maxWidthClass="max-w-xl"
      >
        <div className="rounded-2xl border border-[#1D1D1F]/12 bg-[#FFFFFF] p-6 space-y-5">
          {tplShowLogo && settings.hotel_logo_url && (
            <img
              src={settings.hotel_logo_url}
              alt={settings.hotel_name}
              referrerPolicy="no-referrer"
              className="max-h-10 max-w-[160px] object-contain"
            />
          )}
          <div>
            <div className="text-base font-semibold text-[#1D1D1F]">{settings.hotel_name}</div>
            {settings.hotel_tagline && (
              <div className="text-xs text-[#1D1D1F]/55">{settings.hotel_tagline}</div>
            )}
          </div>
          <div className="h-1 w-12 rounded-full bg-[#6AD4B0]" />
          <div className="text-lg font-semibold text-[#1D1D1F]">
            {interpolatePreview(tplHeadline, settings, {
              totalAmount: previewStayTax.totalAmount,
              depositPaid: previewDepositPaid,
              balanceRemaining: previewBalanceRemaining,
            })}
          </div>
          <p className="text-sm text-[#1D1D1F]/80 leading-relaxed whitespace-pre-line">
            {interpolatePreview(tplIntro, settings, {
              totalAmount: previewStayTax.totalAmount,
              depositPaid: previewDepositPaid,
              balanceRemaining: previewBalanceRemaining,
            })}
          </p>

          {selectedTemplateKey === 'reservation' ? (
            tplShowStayDetails && (
              <div className="rounded-2xl border border-[#1D1D1F]/15 bg-[#FFFFFF] overflow-hidden">
                {/* Clean Neutral Card Header */}
                <div className="flex items-center justify-between border-b border-[#1D1D1F]/10 px-4 py-2.5">
                  <span className="text-[10px] font-bold tracking-[0.12em] uppercase text-[#1D1D1F]/50">
                    Reservation Details
                  </span>
                  <span className="font-mono text-xs font-bold tracking-wider text-[#1D1D1F]">
                    HSL-2601
                  </span>
                </div>

                {/* Boarding Pass Route & Guest Details */}
                <div className="p-4 space-y-4">
                  <div className="grid grid-cols-3 items-center gap-2 border-b border-[#1D1D1F]/10 pb-3.5">
                    <div>
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1D1D1F]/50">
                        Check-In
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#1D1D1F]">
                        {new Date().toISOString().slice(0, 10)}
                      </div>
                      <div className="text-[11px] text-[#1D1D1F]/55">
                        From {settings.check_in_time || '14:00'}
                      </div>
                    </div>
                    <div className="text-center">
                      <span className="inline-block rounded-lg border border-[#6AD4B0] px-2.5 py-1 font-mono text-[11px] font-semibold text-[#1D1D1F]">
                        2 NIGHTS →
                      </span>
                    </div>
                    <div className="text-right">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1D1D1F]/50">
                        Check-Out
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold tabular-nums text-[#1D1D1F]">
                        {new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10)}
                      </div>
                      <div className="text-[11px] text-[#1D1D1F]/55">
                        By {settings.check_out_time || '11:00'}
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#1D1D1F]/50">Guest</div>
                      <div className="font-semibold text-[#1D1D1F]">Claire Bennett</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#1D1D1F]/50">Room / Category</div>
                      <div className="font-semibold text-[#1D1D1F]">Room 301 · Corner Suite</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#1D1D1F]/50">Occupancy</div>
                      <div className="text-[#1D1D1F]">2 Adults</div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#1D1D1F]/50">Nightly Rate</div>
                      <div className="font-mono tabular-nums text-[#1D1D1F]">{currency}190.00 / night</div>
                    </div>
                  </div>
                </div>

                {/* Perforated Boarding Pass Tear Line */}
                <div className="mx-3 border-t-2 border-dashed border-[#1D1D1F]/18" />

                {/* Payment & Balance Stub */}
                <div className="p-4 space-y-3">
                  <div className="space-y-1.5 text-xs">
                    <div className="flex justify-between text-[#1D1D1F]/65">
                      <span>Accommodation Subtotal (2 nights)</span>
                      <span className="font-mono tabular-nums text-[#1D1D1F]">
                        {currency}
                        {previewStayTax.netAmount.toFixed(2)}
                      </span>
                    </div>
                    {previewStayTax.applicable &&
                      previewStayTax.breakdown.map((b) => (
                        <div key={`${b.name}-${b.rate}`} className="flex justify-between text-[#1D1D1F]/65">
                          <span>
                            {b.name} ({b.rate}%)
                          </span>
                          <span className="font-mono tabular-nums text-[#1D1D1F]">
                            {currency}
                            {b.amount.toFixed(2)}
                          </span>
                        </div>
                      ))}
                    <div className="flex justify-between border-t border-[#1D1D1F]/10 pt-1.5 font-semibold text-[#1D1D1F]">
                      <span>Total Reservation Amount</span>
                      <span className="font-mono tabular-nums">
                        {currency}
                        {previewStayTax.totalAmount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl border border-[#1D1D1F]/12 p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1D1D1F]/55">
                        Deposit Paid
                      </div>
                      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-[#1D1D1F]">
                        {currency}
                        {previewDepositPaid.toFixed(2)}
                      </div>
                    </div>
                    <div className="rounded-xl border-[1.5px] border-[#6AD4B0] p-3">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-[#1D1D1F]/55">
                        Balance Remaining
                      </div>
                      <div className="mt-0.5 font-mono text-lg font-bold tabular-nums text-[#1D1D1F]">
                        {currency}
                        {previewBalanceRemaining.toFixed(2)}
                      </div>
                    </div>
                  </div>

                  <div className="border-t border-[#1D1D1F]/8 pt-2.5 text-center text-[11px] text-[#1D1D1F]/55">
                    Present confirmation <span className="font-mono font-semibold text-[#1D1D1F]">HSL-2601</span> with a valid photo ID at Front Desk
                  </div>
                </div>
              </div>
            )
          ) : (
            <>
              {tplShowStayDetails && (
                <div className="rounded-xl border border-[#1D1D1F]/10 p-4 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[#1D1D1F]/55">Confirmation</span>
                    <span className="font-mono font-semibold text-[#1D1D1F]">HSL-2601</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#1D1D1F]/55">Room</span>
                    <span className="text-[#1D1D1F]">Room 301 · Corner Suite</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#1D1D1F]/55">Check-In / Out</span>
                    <span className="font-mono text-[#1D1D1F]">
                      {settings.check_in_time || '14:00'} / {settings.check_out_time || '11:00'}
                    </span>
                  </div>
                </div>
              )}

              {tplShowFolioSummary && (
                <div className="rounded-xl border border-[#1D1D1F]/10 p-4 text-xs space-y-1.5">
                  <div className="flex justify-between">
                    <span className="text-[#1D1D1F]/55">Room &amp; Charges</span>
                    <span className="font-mono text-[#1D1D1F]">
                      {currency}
                      {previewStayTax.netAmount.toFixed(2)}
                    </span>
                  </div>
                  {previewStayTax.applicable &&
                    previewStayTax.breakdown.map((b) => (
                      <div key={`${b.name}-${b.rate}`} className="flex justify-between">
                        <span className="text-[#1D1D1F]/55">
                          {b.name} ({b.rate}%)
                        </span>
                        <span className="font-mono text-[#1D1D1F]">
                          {currency}
                          {b.amount.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  <div className="flex justify-between border-t border-[#1D1D1F]/10 pt-1.5 font-semibold text-[#1D1D1F]">
                    <span>Balance Due</span>
                    <span className="font-mono">
                      {currency}
                      {previewBalanceRemaining.toFixed(2)}
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {tplBody && (
            <p className="text-xs text-[#1D1D1F]/70 leading-relaxed whitespace-pre-line">
              {interpolatePreview(tplBody, settings, {
                totalAmount: previewStayTax.totalAmount,
                depositPaid: previewDepositPaid,
                balanceRemaining: previewBalanceRemaining,
              })}
            </p>
          )}
          {tplClosing && (
            <p className="text-sm text-[#1D1D1F] whitespace-pre-line">
              {interpolatePreview(tplClosing, settings, {
                totalAmount: previewStayTax.totalAmount,
                depositPaid: previewDepositPaid,
                balanceRemaining: previewBalanceRemaining,
              })}
            </p>
          )}

          <div className="border-t border-[#1D1D1F]/10 pt-4 text-[11px] text-[#1D1D1F]/50 space-y-1">
            {tplShowContactFooter && (
              <div>
                {settings.hotel_address} · {settings.hotel_phone} · {settings.hotel_email}
              </div>
            )}
            <div className="font-medium text-[#1D1D1F]/65">Powered by Hosila</div>
          </div>
        </div>
      </Modal>
      {/* Confirm Delete Room Modal */}
      <Modal
        open={Boolean(pendingDeleteRoom)}
        onClose={() => setPendingDeleteRoom(null)}
        title={pendingDeleteRoom ? `Delete Room ${pendingDeleteRoom.room_number}?` : 'Delete Room'}
      >
        {pendingDeleteRoom && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.07] p-4 text-xs text-ink/80 space-y-1">
              <div className="font-semibold text-danger-ink">
                Room {pendingDeleteRoom.room_number} · {pendingDeleteRoom.room_type}
              </div>
              <div>
                Floor {pendingDeleteRoom.floor} · {currency}
                {pendingDeleteRoom.nightly_rate.toFixed(2)}/night
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteRoom(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingTarget}
                onClick={handleConfirmDeleteRoom}
                className="rounded-xl bg-[#E05252] px-5 py-2 text-sm font-semibold text-white hover:bg-[#C83E3E] disabled:opacity-50"
              >
                {deletingTarget ? 'Deleting...' : 'Yes, Delete Room'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirm Delete Menu Item Modal */}
      <Modal
        open={Boolean(pendingDeleteMenuItem)}
        onClose={() => setPendingDeleteMenuItem(null)}
        title={pendingDeleteMenuItem ? `Delete "${pendingDeleteMenuItem.name}"?` : 'Delete Menu Item'}
      >
        {pendingDeleteMenuItem && (
          <div className="space-y-5">
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.07] p-4 text-xs text-ink/80 space-y-1">
              <div className="font-semibold text-danger-ink">{pendingDeleteMenuItem.name}</div>
              <div>
                {pendingDeleteMenuItem.category} · {currency}
                {pendingDeleteMenuItem.price.toFixed(2)}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingDeleteMenuItem(null)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={deletingTarget}
                onClick={handleConfirmDeleteMenuItem}
                className="rounded-xl bg-[#E05252] px-5 py-2 text-sm font-semibold text-white hover:bg-[#C83E3E] disabled:opacity-50"
              >
                {deletingTarget ? 'Deleting...' : 'Yes, Delete Item'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
