import { useEffect, useRef, useState } from 'react';
import {
  BedDouble,
  Clock,
  Landmark,
  Lock,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  UtensilsCrossed,
  Wifi,
} from 'lucide-react';
import type { AuthSession, NavSection, NetworkInfo, WorkstationRole } from '../types';
import { STAFF_ROLE_LABELS } from '../utils/constants';
import { HoverTip } from './HoverTip';

interface SidebarProps {
  hotelName: string;
  activeSection: NavSection;
  onSelectSection: (section: NavSection) => void;
  posEnabled: boolean;
  session: AuthSession;
  canAccessFrontDesk: boolean;
  canAccessFinance: boolean;
  canAccessSettings: boolean;
  onLockedClick: (label: string) => void;
  onOpenQuickSearch: () => void;
  stationRole: WorkstationRole;
  onChangeStationRole: (role: WorkstationRole) => void;
  wsConnected: boolean;
  network: NetworkInfo | null;
  checkedInCount: number;
  collapsed: boolean;
  onToggleCollapse: () => void;
  isDark: boolean;
  onToggleTheme: () => void;
  onRequestCloseShift: () => void;
  onLogout: () => void;
}

const ROLES: WorkstationRole[] = ['Front Desk', 'Restaurant POS', 'Management Office'];

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'U';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function Sidebar({
  hotelName,
  activeSection,
  onSelectSection,
  posEnabled,
  session,
  canAccessFrontDesk,
  canAccessFinance,
  canAccessSettings,
  onLockedClick,
  onOpenQuickSearch,
  stationRole,
  onChangeStationRole,
  wsConnected,
  network,
  checkedInCount,
  collapsed,
  onToggleCollapse,
  isDark,
  onToggleTheme,
  onRequestCloseShift,
  onLogout,
}: SidebarProps) {
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountMenuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setAccountMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', handleOutside);
    return () => window.removeEventListener('mousedown', handleOutside);
  }, [accountMenuOpen]);

  const isRestaurantScoped = !canAccessFrontDesk;

  const navItems: Array<{
    id: NavSection;
    label: string;
    icon: typeof BedDouble;
    meta?: string;
    hidden?: boolean;
    locked?: boolean;
  }> = [
    {
      id: 'front_desk',
      label: 'Front Desk',
      icon: BedDouble,
      meta: `${checkedInCount} in`,
      hidden: isRestaurantScoped,
    },
    {
      id: 'pos',
      label: 'Restaurant',
      icon: UtensilsCrossed,
      hidden: !posEnabled && !isRestaurantScoped,
    },
    {
      id: 'finance',
      label: 'Finance',
      icon: Landmark,
      hidden: isRestaurantScoped,
      locked: !canAccessFinance,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: Settings,
      hidden: isRestaurantScoped,
      locked: !canAccessSettings,
    },
  ];

  const peerCount = network?.connectedStations.length ?? (wsConnected ? 1 : 0);

  return (
    <aside
      className={`no-print sticky top-0 flex h-screen shrink-0 flex-col justify-between border-r border-ink/10 bg-ink/[0.025] dark:bg-surface transition-[width] duration-200 ${
        collapsed ? 'w-[66px] px-2.5 py-4' : 'w-56 xl:w-64 px-3.5 xl:px-4 py-5'
      }`}
    >
      {/* Top Brand + Collapse Control + Navigation */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div
          className={`flex items-center ${
            collapsed ? 'flex-col justify-center gap-3 pb-5' : 'justify-between px-2 pb-6'
          }`}
        >
          {collapsed ? (
            <img
              src="/hosila-logo.png"
              alt="Hosila PMS"
              className="h-6 w-6 shrink-0 object-contain"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-2.5 pr-2">
              <img
                src="/hosila-logo.png"
                alt="Hosila PMS"
                className="h-6 w-6 shrink-0 object-contain"
              />
              <div className="min-w-0">
                <div className="text-base font-semibold tracking-tight text-ink truncate">
                  <span className="text-accent-ink">Hosila</span> PMS
                </div>
                <div className="mt-0.5 truncate text-xs text-ink/55">{hotelName}</div>
              </div>
            </div>
          )}
          <HoverTip text={collapsed ? 'Expand sidebar labels.' : 'Minimize sidebar to icons only.'}>
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-ink/55 hover:bg-ink/[0.06] hover:text-ink transition-colors"
            >
              {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
            </button>
          </HoverTip>
        </div>

        {canAccessFrontDesk && (
          <div className="mb-3">
            <HoverTip
              text="Jump to any guest folio, room card, or booking confirmation (Cmd/Ctrl + K)."
              className="flex w-full"
            >
              <button
                type="button"
                onClick={onOpenQuickSearch}
                aria-label="Global Quick Search"
                className={`flex w-full items-center rounded-xl border border-ink/12 bg-surface py-2 text-xs text-ink/65 hover:border-ink/25 hover:text-ink transition-colors ${
                  collapsed ? 'justify-center px-0' : 'justify-between px-3'
                }`}
              >
                <span className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 shrink-0 text-ink/50" />
                  {!collapsed && <span>Quick Search</span>}
                </span>
                {!collapsed && (
                  <kbd className="rounded border border-ink/12 px-1.5 py-0.5 font-mono text-[10px] text-ink/45">
                    ⌘K
                  </kbd>
                )}
              </button>
            </HoverTip>
          </div>
        )}

        <nav aria-label="Primary navigation" className="flex-1 space-y-1 overflow-y-auto">
          {navItems
            .filter((item) => !item.hidden)
            .map((item) => {
              const Icon = item.icon;
              const isActive = activeSection === item.id;
              const tipText = item.locked
                ? `${item.label} is restricted to Management and Accountant accounts.`
                : collapsed
                  ? item.label
                  : undefined;
              return (
                <HoverTip key={item.id} text={tipText} className="flex w-full">
                  <button
                    type="button"
                    aria-label={item.label}
                    onClick={() => {
                      if (item.locked) {
                        onLockedClick(item.label);
                        return;
                      }
                      onSelectSection(item.id);
                    }}
                    className={`relative flex w-full items-center rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                      collapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2.5'
                    } ${
                      item.locked
                        ? 'text-ink/40 hover:bg-ink/[0.04]'
                        : isActive
                          ? 'bg-[#6AD4B0] text-[#1D1D1F] font-semibold'
                          : 'text-ink/75 hover:bg-ink/[0.05] hover:text-ink'
                    }`}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      {!collapsed && <span>{item.label}</span>}
                    </span>

                    {collapsed && item.locked && (
                      <Lock className="absolute right-2 top-2 h-2.5 w-2.5 text-ink/50" />
                    )}

                    {!collapsed && item.locked && (
                      <Lock className="h-3.5 w-3.5 shrink-0 text-ink/45" aria-label="Locked" />
                    )}

                    {!collapsed && !item.locked && item.meta && (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          isActive ? 'text-[#1D1D1F]/75' : 'text-ink/45'
                        }`}
                      >
                        {item.meta}
                      </span>
                    )}
                  </button>
                </HoverTip>
              );
            })}
        </nav>
      </div>

      {/* Bottom Fixed Section: Workstation Role + LAN Link + Theme Switch + User Account Avatar */}
      <div className="space-y-2.5 border-t border-ink/10 pt-3">
        {!collapsed && (
          <>
            <HoverTip
              text="Labels this workstation on the local network so connected PCs know which terminal is active."
              className="block w-full"
            >
              <div className="px-1">
                <label
                  htmlFor="workstation-role-select"
                  className="block text-[11px] font-medium text-ink/50 mb-1"
                >
                  Workstation Terminal
                </label>
                <select
                  id="workstation-role-select"
                  value={stationRole}
                  onChange={(e) => onChangeStationRole(e.target.value as WorkstationRole)}
                  className="w-full rounded-lg border border-ink/15 bg-canvas px-2.5 py-1.5 text-xs font-medium text-ink"
                >
                  {ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </div>
            </HoverTip>

            <HoverTip
              text="Real-time local network sync across connected workstations. No internet required."
              className="block w-full"
            >
              <div className="flex items-center justify-between px-2 text-xs text-ink/60">
                <span className="flex items-center gap-1.5 truncate">
                  <Wifi
                    className={`h-3.5 w-3.5 shrink-0 ${wsConnected ? 'text-[#6AD4B0]' : 'text-ink/35'}`}
                  />
                  <span className="truncate">{wsConnected ? 'LAN Synced' : 'Reconnecting'}</span>
                </span>
                <span className="font-mono text-xs tabular-nums text-ink/50 shrink-0">
                  {peerCount} {peerCount === 1 ? 'PC' : 'PCs'}
                </span>
              </div>
            </HoverTip>
          </>
        )}

        {/* Light / Dark Appearance Toggle */}
        <HoverTip
          text={isDark ? 'Switch to Light Mode.' : 'Switch to Dark Mode.'}
          className="flex w-full"
        >
          <button
            type="button"
            onClick={onToggleTheme}
            aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className={`flex w-full items-center rounded-xl py-2 text-xs font-medium text-ink/70 hover:bg-ink/[0.06] hover:text-ink transition-colors ${
              collapsed ? 'justify-center px-0' : 'justify-between px-2.5'
            }`}
          >
            <span className="flex items-center gap-2">
              {isDark ? (
                <Sun className="h-4 w-4 shrink-0 text-[#6AD4B0]" />
              ) : (
                <Moon className="h-4 w-4 shrink-0 text-ink/60" />
              )}
              {!collapsed && <span>{isDark ? 'Dark Mode' : 'Light Mode'}</span>}
            </span>
            {!collapsed && (
              <span
                className={`inline-flex h-4 w-7 items-center rounded-full p-0.5 transition-colors ${
                  isDark ? 'bg-[#6AD4B0]' : 'bg-ink/20'
                }`}
              >
                <span
                  className={`h-3 w-3 rounded-full bg-white transition-transform ${
                    isDark ? 'translate-x-3' : 'translate-x-0'
                  }`}
                />
              </span>
            )}
          </button>
        </HoverTip>

        {/* User Account Avatar & Popover Menu */}
        <div ref={menuRef} className="relative">
          {accountMenuOpen && (
            <div
              className={`absolute bottom-full z-40 mb-2 w-56 rounded-2xl border border-ink/12 bg-surface p-2 shadow-[0_16px_40px_rgba(0,0,0,0.16)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.5)] ${
                collapsed ? 'left-0' : 'left-0 right-0 w-auto'
              }`}
            >
              <div className="border-b border-ink/8 px-3 py-2.5">
                <div className="text-xs font-semibold text-ink truncate">{session.fullName}</div>
                <div className="mt-0.5 text-[11px] text-ink/55">
                  {STAFF_ROLE_LABELS[session.role]} · @{session.username}
                </div>
                <div className="mt-1 font-mono text-[11px] tabular-nums text-ink/45">
                  Shift started {session.shiftOpenedAt.slice(11, 16)} UTC
                </div>
              </div>
              <div className="pt-1.5 space-y-0.5">
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onRequestCloseShift();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.06] transition-colors"
                >
                  <Clock className="h-3.5 w-3.5 text-[#6AD4B0]" />
                  Close Shift
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAccountMenuOpen(false);
                    onLogout();
                  }}
                  className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.06] transition-colors"
                >
                  <LogOut className="h-3.5 w-3.5 text-ink/65" />
                  Log Out
                </button>
              </div>
            </div>
          )}

          <HoverTip
            text={`${session.fullName} (${STAFF_ROLE_LABELS[session.role]}). Click to close shift or sign out.`}
            className="flex w-full"
          >
            <button
              type="button"
              onClick={() => setAccountMenuOpen((o) => !o)}
              aria-label="Account menu"
              className={`flex w-full items-center rounded-xl py-2 transition-colors hover:bg-ink/[0.06] ${
                collapsed ? 'justify-center px-0' : 'gap-3 px-2'
              }`}
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-canvas">
                {getInitials(session.fullName)}
              </div>
              {!collapsed && (
                <div className="min-w-0 flex-1 text-left">
                  <div className="truncate text-xs font-semibold text-ink">{session.fullName}</div>
                  <div className="truncate text-[11px] text-ink/55">
                    {STAFF_ROLE_LABELS[session.role]}
                  </div>
                </div>
              )}
            </button>
          </HoverTip>
        </div>
      </div>
    </aside>
  );
}
