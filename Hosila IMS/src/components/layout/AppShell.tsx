import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  BarChart3,
  ClipboardCheck,
  Command,
  LayoutDashboard,
  LogOut,
  Minus,
  Monitor,
  Moon,
  Package,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  ShoppingCart,
  Sun,
  ZoomIn,
} from 'lucide-react';
import { useApp, type AppRoute } from '../../context/AppContext';
import { cn } from '../../lib/format';
import { Modal } from '../ui/Modal';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

interface NavItem {
  id: AppRoute;
  label: string;
  tooltip: string;
  icon: React.ComponentType<{ className?: string }>;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    tooltip: 'View store valuation KPIs, 14-day stock flow, department usage, and activity log.',
    icon: LayoutDashboard,
  },
  {
    id: 'collect',
    label: 'Collect Stock',
    tooltip: 'Issue stock to department staff with live stock availability checks and returnable tracking.',
    icon: ArrowRightLeft,
  },
  {
    id: 'inventory',
    label: 'Inventory',
    tooltip: 'Browse and manage catalog items, stocking/collection units, and item stock cards.',
    icon: Package,
  },
  {
    id: 'procurement',
    label: 'Procurement',
    tooltip: 'Prepare procurement lists, export/print sheets, and upload Excel lists to auto-parse restocks.',
    icon: ShoppingCart,
  },
  {
    id: 'counts',
    label: 'Counts & Adjustments',
    tooltip: 'Log wastage or spoilage adjustments and run physical shelf stocktakes.',
    icon: ClipboardCheck,
  },
  {
    id: 'reports',
    label: 'Reports',
    tooltip: 'Generate weekly stock sheets, department valuation, consumption, and spend reports.',
    icon: BarChart3,
  },
  {
    id: 'settings',
    label: 'Settings',
    tooltip: 'Manage departments, staff, units, import/export/clear inventory, backups, and licence.',
    icon: Settings,
  },
];

const SCALE_PRESETS = [0.75, 0.8, 0.85, 0.9, 0.95, 1.0];

export function ZoomScaleControl() {
  const { uiScale, setUiScale } = useApp();
  const [open, setOpen] = useState(false);
  const pct = Math.round(uiScale * 100);

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setOpen((o) => !o)}
        tooltip="Adjust display zoom and visual scale (default 85%)"
        className="h-7 px-2 text-xs font-mono tabular-nums"
      >
        <ZoomIn className="h-3.5 w-3.5 text-accent-ink" />
        {pct}%
      </Button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1.5 z-50 w-52 rounded-xl border border-ink/15 bg-surface p-2.5 shadow-[0_10px_28px_rgba(29,29,31,0.14)] dark:shadow-[0_14px_36px_rgba(0,0,0,0.55)] animate-fade-in space-y-2">
            <div className="flex items-center justify-between text-xs font-medium text-ink/65">
              <span>Display Scale</span>
              <span className="font-mono tabular-nums text-ink">{pct}%</span>
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="subtle"
                onClick={() => setUiScale(uiScale - 0.05)}
                className="h-7 flex-1"
              >
                <Minus className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => setUiScale(0.85)}
                className="h-7 px-2.5 text-[11px]"
              >
                Reset 85%
              </Button>
              <Button
                size="sm"
                variant="subtle"
                onClick={() => setUiScale(uiScale + 0.05)}
                className="h-7 flex-1"
              >
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-ink/10">
              {SCALE_PRESETS.map((s) => {
                const p = Math.round(s * 100);
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => {
                      setUiScale(s);
                      setOpen(false);
                    }}
                    className={cn(
                      'h-6 rounded-md text-[11px] font-mono font-medium tabular-nums transition-colors cursor-pointer',
                      Math.abs(uiScale - s) < 0.01
                        ? 'bg-[#6AD4B0] text-[#1D1D1F] font-semibold'
                        : 'hover:bg-ink/[0.05] text-ink/65'
                    )}
                  >
                    {p}%
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const {
    systemInfo,
    settings,
    session,
    license,
    activeRoute,
    setActiveRoute,
    theme,
    setTheme,
    logout,
  } = useApp();

  const [collapsed, setCollapsed] = useState(false);
  const [cmdOpen, setCmdOpen] = useState(false);
  const [cmdQuery, setCmdQuery] = useState('');

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdOpen((o) => !o);
        setCmdQuery('');
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const filteredCmd = NAV_ITEMS.filter((n) =>
    n.label.toLowerCase().includes(cmdQuery.trim().toLowerCase())
  );

  const showLicenseWarning =
    license &&
    (license.is_read_only ||
      (license.state === 'trial' && license.trial_days_remaining <= 5));

  return (
    <div className="flex h-full w-full overflow-hidden bg-canvas text-ink">
      {/* Sidebar */}
      <aside
        className={cn(
          'no-print flex flex-col shrink-0 border-r border-ink/10 bg-ink/[0.025] dark:bg-surface transition-[width] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
          collapsed ? 'w-[66px]' : 'w-56 xl:w-64'
        )}
      >
        {/* Brand header */}
        <div className="h-14 px-3.5 flex items-center justify-between border-b border-ink/10 shrink-0">
          <button
            type="button"
            onClick={() => setActiveRoute('dashboard')}
            className="flex items-center gap-2.5 min-w-0 cursor-pointer focus:outline-none"
          >
            <img
              src="/hosila-icon.svg"
              alt="Hosila"
              className="h-6.5 w-6.5 shrink-0 rounded-lg"
            />
            {!collapsed && (
              <div className="min-w-0 text-left">
                <div className="text-sm font-semibold tracking-tight leading-tight truncate text-ink">
                  <span className="text-accent-ink">Hosila</span> IMS
                </div>
                <div className="text-[11px] text-ink/50 truncate leading-tight">
                  {settings?.business_profile.name || 'Inventory'}
                </div>
              </div>
            )}
          </button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed((c) => !c)}
            tooltip={collapsed ? 'Expand navigation sidebar' : 'Collapse navigation sidebar'}
            className="h-7 w-7"
          >
            {collapsed ? (
              <PanelLeftOpen className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Quick jump + Zoom control */}
        {!collapsed && (
          <div className="px-2.5 pt-2.5 pb-1 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setCmdQuery('');
                setCmdOpen(true);
              }}
              className="flex-1 h-7 px-2 rounded-lg border border-ink/10 bg-surface hover:border-ink/20 flex items-center justify-between text-xs text-ink/50 transition-colors cursor-pointer"
            >
              <span className="flex items-center gap-1.5">
                <Command className="h-3 w-3" />
                Jump
              </span>
              <kbd className="text-[10px] font-mono font-medium px-1 py-0.5 rounded bg-ink/[0.04] border border-ink/10 text-ink/60">
                Ctrl K
              </kbd>
            </button>
            <ZoomScaleControl />
          </div>
        )}

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeRoute === item.id;
            return (
              <Button
                key={item.id}
                variant="ghost"
                tooltip={item.tooltip}
                onClick={() => setActiveRoute(item.id)}
                className={cn(
                  'w-full flex items-center justify-start gap-2.5 rounded-xl px-2.5 h-9 text-sm',
                  collapsed && 'justify-center px-0',
                  active
                    ? 'bg-[#6AD4B0]/14 text-accent-ink font-semibold hover:bg-[#6AD4B0]/18'
                    : 'text-ink/65 hover:text-ink hover:bg-ink/[0.04]'
                )}
              >
                <Icon className={cn('h-4 w-4 shrink-0', active && 'text-accent-ink')} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Button>
            );
          })}
        </nav>

        {/* Footer: Theme switcher & User profile */}
        <div className="p-2.5 border-t border-ink/10 space-y-2 shrink-0">
          {!collapsed ? (
            <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-ink/[0.05]">
              {(
                [
                  { id: 'light', icon: Sun, label: 'Light' },
                  { id: 'dark', icon: Moon, label: 'Dark' },
                  { id: 'system', icon: Monitor, label: 'Auto' },
                ] as const
              ).map((opt) => {
                const Icon = opt.icon;
                const active = theme === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setTheme(opt.id)}
                    className={cn(
                      'flex items-center justify-center gap-1 h-7 rounded-lg text-[11px] font-medium transition-colors cursor-pointer',
                      active
                        ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                        : 'text-ink/50 hover:text-ink'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {opt.label}
                  </button>
                );
              })}
            </div>
          ) : (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              tooltip="Switch between Light and Dark theme"
              className="w-full h-7"
            >
              {theme === 'dark' ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </Button>
          )}

          {session && (
            <div
              className={cn(
                'flex items-center gap-2 rounded-xl px-2 py-1',
                collapsed && 'justify-center px-0'
              )}
            >
              <div className="h-7 w-7 rounded-lg bg-[#6AD4B0]/18 text-accent-ink font-semibold text-xs flex items-center justify-center shrink-0">
                {session.full_name.slice(0, 1).toUpperCase()}
              </div>
              {!collapsed && (
                <>
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate leading-tight text-ink">
                      {session.full_name}
                    </div>
                    <div className="text-[11px] text-ink/50 capitalize leading-tight">
                      {session.role}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={logout}
                    tooltip="Sign out of current session"
                    className="h-7 w-7 text-ink/50 hover:text-danger-ink hover:bg-[#E05252]/[0.07]"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-canvas">
        {systemInfo?.is_network_path && (
          <div className="no-print px-5 py-2 bg-[#E05252]/[0.06] border-b border-[#E05252]/30 text-xs text-danger-ink flex items-center gap-2 shrink-0">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Database is on a network share ({systemInfo.db_path}). Local storage is recommended.
            </span>
          </div>
        )}

        {systemInfo && !systemInfo.integrity.ok && (
          <div className="no-print px-5 py-2 bg-[#E05252]/[0.07] border-b border-[#E05252]/30 text-xs text-danger-ink flex items-center justify-between gap-2 shrink-0">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              Database integrity alert ({systemInfo.integrity.ledger_mismatches} mismatches).
            </span>
            <button
              type="button"
              onClick={() => setActiveRoute('settings')}
              className="underline font-medium cursor-pointer"
            >
              Inspect
            </button>
          </div>
        )}

        {showLicenseWarning && license && (
          <div className="no-print px-5 py-2 border-b border-[#E05252]/30 bg-[#E05252]/[0.06] text-xs text-danger-ink flex items-center justify-between gap-2 shrink-0">
            <span>{license.message}</span>
            <button
              type="button"
              onClick={() => setActiveRoute('settings')}
              className="underline font-medium cursor-pointer"
            >
              Manage Licence
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto">
          <div key={activeRoute} className="mx-auto max-w-[1440px] px-6 py-5 animate-view-enter">
            {children}
          </div>
        </main>
      </div>

      {/* Quick Jump Command Palette */}
      <Modal open={cmdOpen} onOpenChange={setCmdOpen} title="Quick Jump" maxWidth="max-w-md">
        <div className="space-y-3">
          <input
            autoFocus
            value={cmdQuery}
            onChange={(e) => setCmdQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && filteredCmd.length > 0) {
                setActiveRoute(filteredCmd[0].id);
                setCmdOpen(false);
              }
            }}
            placeholder="Type a page name..."
            className="w-full h-9 rounded-xl border border-ink/15 bg-canvas px-3.5 text-sm text-ink placeholder:text-ink/40 focus:outline-none focus:border-[#6AD4B0]"
          />
          <div className="space-y-1">
            {filteredCmd.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveRoute(item.id);
                    setCmdOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-xl hover:bg-ink/[0.04] text-sm cursor-pointer transition-colors"
                >
                  <span className="flex items-center gap-2.5">
                    <Icon className="h-4 w-4 text-accent-ink" />
                    <span className="text-ink">{item.label}</span>
                  </span>
                  {activeRoute === item.id && <Badge tone="accent">Current</Badge>}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>
    </div>
  );
}
