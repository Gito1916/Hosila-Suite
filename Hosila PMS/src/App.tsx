import { useEffect, useState } from 'react';
import { ActivationGate } from './components/ActivationGate';
import { AuthGate } from './components/AuthGate';
import { CommandPalette } from './components/CommandPalette';
import { FinanceView } from './components/FinanceView';
import { FrontDeskView } from './components/FrontDeskView';
import { HoverTip } from './components/HoverTip';
import { Modal } from './components/Modal';
import { RestaurantPosView } from './components/RestaurantPosView';
import { SettingsView } from './components/SettingsView';
import { Sidebar } from './components/Sidebar';
import { useHotelStore } from './hooks/useHotelStore';
import { useTheme } from './hooks/useTheme';
import type { FrontDeskTab, NavSection, ShiftSummary } from './types';

export default function App() {
  const {
    authStatus,
    session,
    state,
    network,
    loading,
    error,
    wsConnected,
    lastSyncAt,
    stationRole,
    setStationIdentity,
    notice,
    showNotice,
    authFetch,
    mutate,
    setupInitialAdmin,
    login,
    logout,
    closeShift,
    activateLicense,
    startTrial,
    refresh,
  } = useHotelStore();

  const { isDark, toggleTheme } = useTheme();

  const [activeSection, setActiveSection] = useState<NavSection>('front_desk');
  const [frontDeskTab, setFrontDeskTab] = useState<FrontDeskTab>('dashboard');
  const [openFolioStayId, setOpenFolioStayId] = useState<number | null>(null);
  const [focusedRoomId, setFocusedRoomId] = useState<number | null>(null);
  const [focusedGuestId, setFocusedGuestId] = useState<number | null>(null);
  const [quickSearchOpen, setQuickSearchOpen] = useState(false);

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth < 1120 : false
  );

  // Automatically collapse sidebar to compact icon rail on tablet screens and expand on desktop
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1119px)');
    const handleChange = (e: MediaQueryListEvent) => {
      setSidebarCollapsed(e.matches);
    };
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  // Close Shift modal state + live handover summary
  const [closeShiftModalOpen, setCloseShiftModalOpen] = useState(false);
  const [shiftSummary, setShiftSummary] = useState<ShiftSummary | null>(null);
  const [loadingShiftSummary, setLoadingShiftSummary] = useState(false);
  const [closingCash, setClosingCash] = useState('0');
  const [shiftNotes, setShiftNotes] = useState('');
  const [closingShift, setClosingShift] = useState(false);

  const isRestaurantScoped = session?.role === 'restaurant';
  const canAccessFrontDesk = !isRestaurantScoped;
  const canAccessFinance =
    session?.role === 'management' || session?.role === 'accountant' || session?.role === 'auditor';
  const canAccessSettings =
    session?.role === 'management' || session?.role === 'accountant';

  // Global Cmd/Ctrl + K shortcut for Quick Search
  useEffect(() => {
    if (!session || !canAccessFrontDesk) return;
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQuickSearchOpen((prev) => !prev);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, canAccessFrontDesk]);

  // Scope restaurant staff strictly to Restaurant POS
  useEffect(() => {
    if (session?.role === 'restaurant' && activeSection !== 'pos') {
      setActiveSection('pos');
      setOpenFolioStayId(null);
    }
  }, [session, activeSection]);

  // If POS gets disabled from another workstation while viewing POS, return non-restaurant staff to Front Desk
  useEffect(() => {
    if (
      state &&
      state.settings.pos_enabled === 0 &&
      activeSection === 'pos' &&
      session?.role !== 'restaurant'
    ) {
      setActiveSection('front_desk');
      setFrontDeskTab('room_board');
    }
  }, [state, activeSection, session]);

  // Ensure staff without Finance/Settings privileges cannot stay on restricted routes
  useEffect(() => {
    if (!session) return;
    if (activeSection === 'finance' && !canAccessFinance) {
      setActiveSection(session.role === 'restaurant' ? 'pos' : 'front_desk');
    } else if (activeSection === 'settings' && !canAccessSettings) {
      setActiveSection(session.role === 'restaurant' ? 'pos' : 'front_desk');
    }
  }, [session, canAccessFinance, canAccessSettings, activeSection]);

  // Fetch expected shift cash handover summary whenever Close Shift modal opens
  useEffect(() => {
    if (!closeShiftModalOpen || !session) return;
    let cancelled = false;
    setLoadingShiftSummary(true);
    authFetch('/api/auth/shift-summary')
      .then((res) => (res.ok ? res.json() : null))
      .then((data: ShiftSummary | null) => {
        if (!cancelled && data) {
          setShiftSummary(data);
          setClosingCash(data.expectedCash.toFixed(2));
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoadingShiftSummary(false);
      });
    return () => {
      cancelled = true;
    };
  }, [closeShiftModalOpen, session, authFetch]);

  function openSingleFolio(stayId: number) {
    if (!canAccessFrontDesk) return;
    setOpenFolioStayId(stayId);
    setActiveSection('front_desk');
  }

  function handleSelectSection(section: NavSection) {
    if (isRestaurantScoped && section !== 'pos') {
      showNotice('Restaurant accounts are scoped to Restaurant POS only', 'error');
      return;
    }
    if (section === 'front_desk' && activeSection === 'front_desk') {
      setOpenFolioStayId(null);
    } else if (section !== 'front_desk') {
      setOpenFolioStayId(null);
    }
    setActiveSection(section);
  }

  async function handleConfirmCloseShift(e: React.FormEvent) {
    e.preventDefault();
    setClosingShift(true);
    try {
      const ok = await closeShift(Number(closingCash) || 0, shiftNotes);
      if (ok) {
        setCloseShiftModalOpen(false);
        setShiftSummary(null);
        setClosingCash('0');
        setShiftNotes('');
      }
    } finally {
      setClosingShift(false);
    }
  }

  if (loading && !authStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink">
        <div className="space-y-2 text-center">
          <div className="text-base font-semibold tracking-tight">Hosila PMS</div>
          <div className="text-xs text-ink/50">Connecting to local hotel database...</div>
        </div>
      </div>
    );
  }

  if (error && !authStatus) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas p-6 text-ink">
        <div className="max-w-sm rounded-2xl border border-ink/12 bg-surface p-6 text-center space-y-4">
          <h1 className="text-base font-semibold">Local Server Unavailable</h1>
          <p className="text-sm text-ink/60">
            {error ?? 'Could not connect to the local Hosila PMS server on your LAN.'}
          </p>
          <button
            type="button"
            onClick={refresh}
            className="rounded-xl bg-[#6AD4B0] px-4 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
          >
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Offline License Activation Gate (shown before Onboarding/Sign-In when Host PC is unlicensed)
  if (!session && authStatus?.license?.status === 'unlicensed') {
    return (
      <ActivationGate
        license={authStatus.license}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onActivate={activateLicense}
        onStartTrial={startTrial}
      />
    );
  }

  // First-Run Onboarding Wizard or Staff Sign-In Gate
  if (!session && authStatus) {
    return (
      <AuthGate
        authStatus={authStatus}
        onSetup={setupInitialAdmin}
        onLogin={login}
        isDark={isDark}
        onToggleTheme={toggleTheme}
      />
    );
  }

  if (!state || !session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas text-ink">
        <div className="space-y-2 text-center">
          <div className="text-base font-semibold tracking-tight">Hosila PMS</div>
          <div className="text-xs text-ink/50">Loading workstation workspace...</div>
        </div>
      </div>
    );
  }

  const currency = state.settings.currency_symbol;
  const checkedInCount = state.stays.filter((s) => s.status === 'checked_in').length;
  const parsedClosingCash = Number(closingCash);
  const cashVariance =
    shiftSummary && Number.isFinite(parsedClosingCash)
      ? Math.round((parsedClosingCash - shiftSummary.expectedCash) * 100) / 100
      : null;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas text-ink">
      <Sidebar
        hotelName={state.settings.hotel_name}
        activeSection={activeSection}
        onSelectSection={handleSelectSection}
        posEnabled={state.settings.pos_enabled === 1}
        session={session}
        canAccessFrontDesk={canAccessFrontDesk}
        canAccessFinance={canAccessFinance}
        canAccessSettings={canAccessSettings}
        onLockedClick={(label) =>
          showNotice(
            label === 'Finance'
              ? 'Finance is locked to Management, Accountant, and Auditor accounts'
              : `${label} is locked to Management and Accountant accounts`,
            'error'
          )
        }
        onOpenQuickSearch={() => setQuickSearchOpen(true)}
        stationRole={stationRole}
        onChangeStationRole={(role) => setStationIdentity(role)}
        wsConnected={wsConnected}
        network={network}
        checkedInCount={checkedInCount}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        isDark={isDark}
        onToggleTheme={toggleTheme}
        onRequestCloseShift={() => setCloseShiftModalOpen(true)}
        onLogout={logout}
      />

      {/* Viewport-locked workspace column: each section fixes its top tab selector bar and scrolls only the content below */}
      <div className="flex flex-1 min-w-0 h-screen flex-col overflow-hidden">
        {authStatus?.license &&
          (authStatus.license.status === 'grace' ||
            authStatus.license.status === 'expired' ||
            (authStatus.license.status === 'trial' && (authStatus.license.daysRemaining ?? 99) <= 5)) && (
            <div
              className={`no-print flex items-center justify-between gap-4 border-b px-6 py-2 text-xs ${
                authStatus.license.status === 'trial'
                  ? 'border-[#6AD4B0]/40 bg-[#6AD4B0]/12 text-ink'
                  : 'border-[#E05252]/35 bg-[#E05252]/[0.07] text-danger-ink'
              }`}
            >
              <span className="font-medium">{authStatus.license.message}</span>
              {canAccessSettings && (
                <button
                  type="button"
                  onClick={() => setActiveSection('settings')}
                  className="shrink-0 rounded-lg border border-ink/15 bg-surface px-2.5 py-1 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors"
                >
                  Manage License
                </button>
              )}
            </div>
          )}
        <main className="flex flex-1 min-h-0 flex-col max-w-[1600px] w-full mx-auto">
          {activeSection === 'front_desk' && canAccessFrontDesk && (
            <FrontDeskView
              rooms={state.rooms}
              guests={state.guests}
              stays={state.stays}
              charges={state.charges}
              payments={state.payments}
              categories={state.categories ?? []}
              settings={state.settings}
              userRole={session.role}
              activeTab={frontDeskTab}
              onSelectTab={(tab) => {
                setOpenFolioStayId(null);
                setFrontDeskTab(tab);
              }}
              openFolioStayId={openFolioStayId}
              onOpenFolio={(stayId) => setOpenFolioStayId(stayId)}
              onCloseFolio={() => setOpenFolioStayId(null)}
              focusedRoomId={focusedRoomId}
              onClearFocusedRoom={() => setFocusedRoomId(null)}
              focusedGuestId={focusedGuestId}
              onClearFocusedGuest={() => setFocusedGuestId(null)}
              authFetch={authFetch}
              mutate={mutate}
            />
          )}

          {activeSection === 'pos' && state.settings.pos_enabled === 1 && (
            <RestaurantPosView
              menuItems={state.menuItems}
              posOrders={state.posOrders}
              stays={state.stays}
              categories={state.categories ?? []}
              settings={state.settings}
              userRole={session.role}
              canOpenFolio={canAccessFrontDesk}
              onOpenFolio={openSingleFolio}
              authFetch={authFetch}
              mutate={mutate}
            />
          )}

          {activeSection === 'pos' && state.settings.pos_enabled === 0 && isRestaurantScoped && (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="max-w-sm rounded-2xl border border-ink/12 bg-surface p-6 text-center space-y-2">
                <h2 className="text-base font-semibold text-ink">Restaurant POS Disabled</h2>
                <p className="text-xs text-ink/55">
                  Management has turned off the Restaurant POS module in Settings. Ask a manager to re-enable it.
                </p>
              </div>
            </div>
          )}

          {activeSection === 'finance' && canAccessFinance && (
            <FinanceView
              settings={state.settings}
              stays={state.stays}
              categories={state.categories ?? []}
              userRole={session.role}
              lastSyncAt={lastSyncAt}
              onOpenFolio={openSingleFolio}
              authFetch={authFetch}
              mutate={mutate}
              isDark={isDark}
            />
          )}

          {activeSection === 'settings' && canAccessSettings && (
            <SettingsView
              settings={state.settings}
              rooms={state.rooms}
              menuItems={state.menuItems}
              categories={state.categories ?? []}
              emailTemplates={state.emailTemplates}
              staffUsers={state.staffUsers}
              recentShifts={state.recentShifts}
              currentUserId={session.userId}
              userRole={session.role}
              network={network}
              emailLogs={state.emailLogs}
              wsConnected={wsConnected}
              license={authStatus?.license ?? null}
              onActivateLicense={activateLicense}
              authFetch={authFetch}
              mutate={mutate}
            />
          )}
        </main>
      </div>

      {/* Global Quick Search Palette (Cmd/Ctrl + K) */}
      {canAccessFrontDesk && (
        <CommandPalette
          open={quickSearchOpen}
          onClose={() => setQuickSearchOpen(false)}
          rooms={state.rooms}
          stays={state.stays}
          guests={state.guests}
          currency={currency}
          onSelectStay={(stayId) => {
            openSingleFolio(stayId);
          }}
          onSelectRoom={(roomId) => {
            setOpenFolioStayId(null);
            setActiveSection('front_desk');
            setFrontDeskTab('room_board');
            setFocusedRoomId(roomId);
          }}
          onSelectGuest={(guestId) => {
            setOpenFolioStayId(null);
            setActiveSection('front_desk');
            setFrontDeskTab('directory');
            setFocusedGuestId(guestId);
          }}
        />
      )}

      {/* Close Shift Modal with Expected Cash Handover Summary */}
      <Modal
        open={closeShiftModalOpen}
        onClose={() => setCloseShiftModalOpen(false)}
        title="Close Current Shift"
        subtitle={`${session.fullName} · Shift opened ${session.shiftOpenedAt.slice(0, 16).replace('T', ' ')} UTC`}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleConfirmCloseShift} className="space-y-4">
          {/* Expected Cash Drawer Reconciliation Summary */}
          <div className="rounded-xl border border-ink/10 bg-ink/[0.025] p-4 space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-ink">Shift Cash Handover Summary</span>
              {loadingShiftSummary && <span className="text-ink/45">Calculating...</span>}
            </div>
            {shiftSummary && (
              <>
                <div className="space-y-1.5 pt-1 font-mono tabular-nums">
                  <div className="flex justify-between text-ink/70">
                    <span className="font-sans">Opening Drawer Float</span>
                    <span>
                      {currency}
                      {shiftSummary.openingCash.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between text-ink/70">
                    <span className="font-sans">+ Cash Folio Payments</span>
                    <span>
                      +{currency}
                      {shiftSummary.cashFolioPayments.toFixed(2)}
                    </span>
                  </div>
                  {shiftSummary.cashPosSales > 0 && (
                    <div className="flex justify-between text-ink/70">
                      <span className="font-sans">+ Cash Restaurant POS</span>
                      <span>
                        +{currency}
                        {shiftSummary.cashPosSales.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {shiftSummary.cashExtraIncome > 0 && (
                    <div className="flex justify-between text-ink/70">
                      <span className="font-sans">+ Cash Extra Income</span>
                      <span>
                        +{currency}
                        {shiftSummary.cashExtraIncome.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {shiftSummary.cashExpenses > 0 && (
                    <div className="flex justify-between text-danger-ink">
                      <span className="font-sans">− Cash Expenses</span>
                      <span>
                        -{currency}
                        {shiftSummary.cashExpenses.toFixed(2)}
                      </span>
                    </div>
                  )}
                  {shiftSummary.cashRefunds > 0 && (
                    <div className="flex justify-between text-danger-ink">
                      <span className="font-sans">− Cash Guest Refunds</span>
                      <span>
                        -{currency}
                        {shiftSummary.cashRefunds.toFixed(2)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between border-t border-ink/10 pt-2 text-sm font-semibold text-ink">
                    <span className="font-sans">Expected Cash in Drawer</span>
                    <span>
                      {currency}
                      {shiftSummary.expectedCash.toFixed(2)}
                    </span>
                  </div>
                </div>

                {(shiftSummary.cardCollected !== 0 ||
                  shiftSummary.bankTransferCollected !== 0 ||
                  shiftSummary.corporateBilled !== 0) && (
                  <div className="mt-2 flex flex-wrap gap-3 border-t border-ink/8 pt-2 text-[11px] text-ink/55">
                    <span>
                      Card: <strong className="font-mono text-ink">{currency}{shiftSummary.cardCollected.toFixed(2)}</strong>
                    </span>
                    <span>
                      Bank Transfer: <strong className="font-mono text-ink">{currency}{shiftSummary.bankTransferCollected.toFixed(2)}</strong>
                    </span>
                    {shiftSummary.corporateBilled > 0 && (
                      <span>
                        Corporate: <strong className="font-mono text-ink">{currency}{shiftSummary.corporateBilled.toFixed(2)}</strong>
                      </span>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Actual Closing Cash Count ({currency})
            </label>
            <input
              type="number"
              step="0.01"
              min="0"
              required
              value={closingCash}
              onChange={(e) => setClosingCash(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
            />
            {cashVariance !== null && (
              <div
                className={`mt-1.5 flex items-center justify-between rounded-lg px-3 py-1.5 text-xs font-medium ${
                  Math.abs(cashVariance) < 0.01
                    ? 'bg-[#6AD4B0]/20 text-accent-ink'
                    : cashVariance > 0
                      ? 'bg-[#6AD4B0]/15 text-accent-ink'
                      : 'bg-[#E05252]/12 text-danger-ink'
                }`}
              >
                <span>
                  {Math.abs(cashVariance) < 0.01
                    ? 'Drawer balanced exactly'
                    : cashVariance > 0
                      ? 'Cash Over'
                      : 'Cash Short Discrepancy'}
                </span>
                <span className="font-mono tabular-nums font-semibold">
                  {cashVariance > 0 ? '+' : ''}
                  {currency}
                  {cashVariance.toFixed(2)}
                </span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Shift Handover Notes
            </label>
            <textarea
              rows={3}
              value={shiftNotes}
              onChange={(e) => setShiftNotes(e.target.value)}
              placeholder="Pending arrivals, housekeeping handoff, cash variance note..."
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setCloseShiftModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.06]"
            >
              Cancel
            </button>
            <HoverTip text="Saves your cash drawer count, variance, and handover record for Management, then signs you out.">
              <button
                type="submit"
                disabled={closingShift}
                className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
              >
                {closingShift ? 'Closing...' : 'Close Shift & Sign Out'}
              </button>
            </HoverTip>
          </div>
        </form>
      </Modal>

      {/* Quiet Toast Feedback */}
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className={`no-print fixed bottom-6 right-6 z-50 rounded-xl px-4 py-2.5 text-xs font-medium shadow-[0_12px_32px_rgba(0,0,0,0.2)] ${
            notice.kind === 'error'
              ? 'border border-[#E05252]/40 bg-surface text-danger-ink'
              : 'bg-ink text-canvas'
          }`}
        >
          {notice.message}
        </div>
      )}
    </div>
  );
}
