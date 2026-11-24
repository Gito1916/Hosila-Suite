import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import {
  commands,
  type AllSettingsDto_Serialize,
  type DepartmentDto,
  type LicenseStatusDto_Serialize,
  type SessionUser,
  type StaffDto_Serialize,
  type StoreSectionDto,
  type SupplierDto_Serialize,
  type SystemInfo,
  type UnitDto,
} from '../../bindings/bindings';
import { applyThemeToDocument, type ThemeMode } from '../lib/theme';

export type AppRoute =
  | 'dashboard'
  | 'collect'
  | 'inventory'
  | 'procurement'
  | 'counts'
  | 'reports'
  | 'settings';

export type InventoryPresetFilter =
  | ''
  | 'low_stock'
  | 'out_of_stock'
  | 'cost_missing'
  | 'returnable'
  | 'archived';

const SCALE_STORAGE_KEY = 'hosila_ui_scale';

interface AppContextValue {
  booting: boolean;
  bootError: string | null;
  systemInfo: SystemInfo | null;
  settings: AllSettingsDto_Serialize | null;
  session: SessionUser | null;
  license: LicenseStatusDto_Serialize | null;
  departments: DepartmentDto[];
  storeSections: StoreSectionDto[];
  units: UnitDto[];
  staff: StaffDto_Serialize[];
  suppliers: SupplierDto_Serialize[];
  currencySymbol: string;
  activeRoute: AppRoute;
  setActiveRoute: (route: AppRoute) => void;
  inventoryPresetFilter: InventoryPresetFilter;
  clearInventoryPresetFilter: () => void;
  navigateToInventoryWithFilter: (preset: InventoryPresetFilter) => void;
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => Promise<void>;
  uiScale: number;
  setUiScale: (scale: number) => void;
  isAdmin: boolean;
  canWrite: boolean;
  onboardingInProgress: boolean;
  setOnboardingInProgress: (active: boolean) => void;
  refreshBoot: () => Promise<void>;
  refreshReferenceData: () => Promise<void>;
  setSessionUser: (user: SessionUser | null) => Promise<void>;
  logout: () => Promise<void>;
  saveCleanBaselineSnapshot: () => Promise<void>;
  clearAllInventory: () => Promise<{ ok: boolean; message: string }>;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [settings, setSettings] = useState<AllSettingsDto_Serialize | null>(null);
  const [session, setSession] = useState<SessionUser | null>(null);
  const [license, setLicense] = useState<LicenseStatusDto_Serialize | null>(null);

  const [departments, setDepartments] = useState<DepartmentDto[]>([]);
  const [storeSections, setStoreSections] = useState<StoreSectionDto[]>([]);
  const [units, setUnits] = useState<UnitDto[]>([]);
  const [staff, setStaff] = useState<StaffDto_Serialize[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierDto_Serialize[]>([]);

  const [activeRoute, setActiveRouteState] = useState<AppRoute>('dashboard');
  const [inventoryPresetFilter, setInventoryPresetFilter] = useState<InventoryPresetFilter>('');
  const [onboardingInProgress, setOnboardingInProgress] = useState(false);

  const setActiveRoute = useCallback((route: AppRoute) => {
    setInventoryPresetFilter('');
    setActiveRouteState(route);
  }, []);

  const clearInventoryPresetFilter = useCallback(() => {
    setInventoryPresetFilter('');
  }, []);

  const navigateToInventoryWithFilter = useCallback((preset: InventoryPresetFilter) => {
    setInventoryPresetFilter(preset);
    setActiveRouteState('inventory');
  }, []);
  const [theme, setThemeState] = useState<ThemeMode>('system');
  const [uiScale, setUiScaleState] = useState<number>(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SCALE_STORAGE_KEY) : null;
    const parsed = saved ? Number(saved) : 0.85;
    return Number.isFinite(parsed) && parsed >= 0.7 && parsed <= 1.1 ? parsed : 0.85;
  });

  const setUiScale = useCallback((next: number) => {
    const clamped = Math.round(Math.min(1.05, Math.max(0.75, next)) * 100) / 100;
    setUiScaleState(clamped);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCALE_STORAGE_KEY, String(clamped));
    }
  }, []);

  const refreshReferenceData = useCallback(async () => {
    const [dRes, secRes, uRes, stRes, supRes, setRes, licRes, sysRes] = await Promise.all([
      commands.listDepartments(false),
      commands.listStoreSections(false),
      commands.listUnits(),
      commands.listStaff({ include_inactive: false, store_staff_only: false }),
      commands.listSuppliers(false),
      commands.getSettings(),
      commands.getLicenseStatus(),
      commands.getSystemInfo(),
    ]);

    if (dRes.status === 'ok') setDepartments(dRes.data);
    if (secRes.status === 'ok') setStoreSections(secRes.data);
    if (uRes.status === 'ok') setUnits(uRes.data);
    if (stRes.status === 'ok') setStaff(stRes.data);
    if (supRes.status === 'ok') setSuppliers(supRes.data);
    if (setRes.status === 'ok') {
      setSettings(setRes.data);
      const t = (setRes.data.appearance.theme as ThemeMode) || 'system';
      setThemeState(t);
      applyThemeToDocument(t);
    }
    if (licRes.status === 'ok') setLicense(licRes.data);
    if (sysRes.status === 'ok') setSystemInfo(sysRes.data);
  }, []);

  const saveCleanBaselineSnapshot = useCallback(async () => {
    const sys = await commands.getSystemInfo();
    if (sys.status === 'ok' && sys.data.item_count === 0) {
      await commands.createBackup();
    }
  }, []);

  const refreshBoot = useCallback(async () => {
    setBootError(null);
    try {
      const [sysRes, setRes, sessRes, licRes] = await Promise.all([
        commands.getSystemInfo(),
        commands.getSettings(),
        commands.getCurrentSession(),
        commands.getLicenseStatus(),
      ]);

      if (sysRes.status === 'error') {
        setBootError(sysRes.error.message);
        return;
      }
      setSystemInfo(sysRes.data);

      if (setRes.status === 'ok') {
        setSettings(setRes.data);
        const t = (setRes.data.appearance.theme as ThemeMode) || 'system';
        setThemeState(t);
        applyThemeToDocument(t);
      }
      if (licRes.status === 'ok') setLicense(licRes.data);

      if (sessRes.status === 'ok') {
        setSession(sessRes.data);
        if (sessRes.data) {
          await refreshReferenceData();
          if (sysRes.data.item_count === 0) {
            await saveCleanBaselineSnapshot();
          }
        }
      }
    } catch (err) {
      setBootError(err instanceof Error ? err.message : String(err));
    } finally {
      setBooting(false);
    }
  }, [refreshReferenceData, saveCleanBaselineSnapshot]);

  useEffect(() => {
    refreshBoot();
  }, [refreshBoot]);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => applyThemeToDocument('system');
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  const setTheme = useCallback(async (mode: ThemeMode) => {
    setThemeState(mode);
    applyThemeToDocument(mode);
    const res = await commands.updateAppearance({ theme: mode });
    if (res.status === 'ok') {
      setSettings((prev) => (prev ? { ...prev, appearance: res.data } : prev));
    }
  }, []);

  const setSessionUser = useCallback(
    async (user: SessionUser | null) => {
      setSession(user);
      if (user) {
        await refreshReferenceData();
      }
    },
    [refreshReferenceData]
  );

  const logout = useCallback(async () => {
    await commands.logout();
    setSession(null);
    setInventoryPresetFilter('');
    setActiveRouteState('dashboard');
  }, []);

  const clearAllInventory = useCallback(async (): Promise<{ ok: boolean; message: string }> => {
    const res = await commands.clearInventory();
    if (res.status === 'error') {
      return { ok: false, message: res.error.message };
    }
    await refreshReferenceData();
    return { ok: true, message: `Cleared ${res.data} inventory items and ledger history.` };
  }, [refreshReferenceData]);

  const currencySymbol = settings?.business_profile.currency_symbol || '₦';
  const isAdmin = session?.role === 'admin';
  const canWrite =
    (session?.role === 'admin' || session?.role === 'storekeeper') &&
    !(license?.is_read_only ?? false);

  return (
    <AppContext.Provider
      value={{
        booting,
        bootError,
        systemInfo,
        settings,
        session,
        license,
        departments,
        storeSections,
        units,
        staff,
        suppliers,
        currencySymbol,
        activeRoute,
        setActiveRoute,
        inventoryPresetFilter,
        clearInventoryPresetFilter,
        navigateToInventoryWithFilter,
        theme,
        setTheme,
        uiScale,
        setUiScale,
        isAdmin,
        canWrite,
        onboardingInProgress,
        setOnboardingInProgress,
        refreshBoot,
        refreshReferenceData,
        setSessionUser,
        logout,
        saveCleanBaselineSnapshot,
        clearAllInventory,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
