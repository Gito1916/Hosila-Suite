import { Toaster } from 'sonner';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/layout/AppShell';
import { OnboardingPage } from './pages/OnboardingPage';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { CollectionPage } from './pages/CollectionPage';
import { InventoryPage } from './pages/InventoryPage';
import { ProcurementPage } from './pages/ProcurementPage';
import { CountsAdjustmentsPage } from './pages/CountsAdjustmentsPage';
import { ReportsPage } from './pages/ReportsPage';
import { SettingsPage } from './pages/SettingsPage';
import { Button } from './components/ui/Button';

function AppRouter() {
  const {
    booting,
    bootError,
    systemInfo,
    session,
    activeRoute,
    refreshBoot,
    uiScale,
    onboardingInProgress,
  } = useApp();

  const scaledStyle: React.CSSProperties = {
    zoom: uiScale,
    width: `${100 / uiScale}vw`,
    height: `${100 / uiScale}vh`,
  };

  const toaster = (
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          fontFamily: 'var(--font-sans)',
          fontSize: '13px',
          borderRadius: '12px',
          background: 'var(--color-surface)',
          color: 'var(--color-ink)',
          border: '1px solid var(--border-strong)',
        },
      }}
    />
  );

  if (booting) {
    return (
      <div
        id="hosila-zoom-root"
        style={scaledStyle}
        className="flex flex-col items-center justify-center bg-canvas gap-3 overflow-hidden"
      >
        <img src="/hosila-icon.svg" alt="Hosila IMS" className="h-11 w-11 animate-pulse" />
        <p className="text-xs text-ink/50">Starting Hosila IMS...</p>
        {toaster}
      </div>
    );
  }

  if (bootError) {
    return (
      <div
        id="hosila-zoom-root"
        style={scaledStyle}
        className="flex flex-col items-center justify-center bg-canvas p-6 text-center overflow-hidden"
      >
        <div className="max-w-md rounded-2xl border border-ink/10 bg-surface p-6 space-y-3">
          <h1 className="text-base font-semibold text-danger-ink">
            Unable to connect to Hosila IMS Backend
          </h1>
          <p className="text-xs text-ink/65">{bootError}</p>
          <Button variant="primary" onClick={refreshBoot} tooltip="Reconnect to the SQLite backend.">
            Retry
          </Button>
        </div>
        {toaster}
      </div>
    );
  }

  return (
    <div id="hosila-zoom-root" style={scaledStyle} className="overflow-hidden">
      {systemInfo?.needs_onboarding || onboardingInProgress ? (
        <OnboardingPage />
      ) : !session ? (
        <LoginPage />
      ) : (
        <AppShell>
          {activeRoute === 'dashboard' && <DashboardPage />}
          {activeRoute === 'collect' && <CollectionPage />}
          {activeRoute === 'inventory' && <InventoryPage />}
          {activeRoute === 'procurement' && <ProcurementPage />}
          {activeRoute === 'counts' && <CountsAdjustmentsPage />}
          {activeRoute === 'reports' && <ReportsPage />}
          {activeRoute === 'settings' && <SettingsPage />}
        </AppShell>
      )}
      {toaster}
    </div>
  );
}

export function App() {
  return (
    <AppProvider>
      <AppRouter />
    </AppProvider>
  );
}
