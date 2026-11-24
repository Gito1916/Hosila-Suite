import { useEffect, useMemo, useRef, useState } from 'react';
import { BedDouble, CalendarCheck, CornerDownLeft, Search, User, X } from 'lucide-react';
import type { Guest, Room, Stay } from '../types';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  rooms: Room[];
  stays: Stay[];
  guests: Guest[];
  currency: string;
  onSelectStay: (stayId: number) => void;
  onSelectRoom: (roomId: number) => void;
  onSelectGuest: (guestId: number) => void;
}

type SearchResultItem = {
  id: string;
  group: 'Stays & Reservations' | 'Rooms' | 'Guests';
  title: string;
  subtitle: string;
  meta: string;
  alert?: boolean;
  onSelect: () => void;
};

export function CommandPalette({
  open,
  onClose,
  rooms,
  stays,
  guests,
  currency,
  onSelectStay,
  onSelectRoom,
  onSelectGuest,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActiveIndex(0);
      window.setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const stayByRoomId = useMemo(() => {
    const map = new Map<number, Stay>();
    for (const s of stays) {
      if (s.status === 'checked_in' && s.room_id !== null) {
        map.set(s.room_id, s);
      }
    }
    return map;
  }, [stays]);

  const results = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    const list: SearchResultItem[] = [];

    // 1. Stays & Reservations (active first, then recent checkouts)
    const matchedStays = stays
      .filter((s) => s.status !== 'cancelled')
      .filter((s) => {
        if (!q) return s.status === 'checked_in' || s.status === 'reserved';
        return (
          s.guest_name.toLowerCase().includes(q) ||
          s.confirmation_code.toLowerCase().includes(q) ||
          s.room_number.toLowerCase().includes(q) ||
          s.room_type.toLowerCase().includes(q)
        );
      })
      .slice(0, q ? 8 : 5);

    for (const s of matchedStays) {
      const statusLabel =
        s.status === 'checked_in' ? 'In-House' : s.status === 'reserved' ? 'Reserved' : 'Checked Out';
      list.push({
        id: `stay-${s.id}`,
        group: 'Stays & Reservations',
        title: `${s.guest_name} · ${s.confirmation_code}`,
        subtitle: `Room ${s.room_number} · ${s.check_in_date} → ${s.check_out_date} · ${statusLabel}`,
        meta: s.balance_due > 0 ? `Due ${currency}${s.balance_due.toFixed(2)}` : 'Settled',
        alert: s.balance_due > 0 && s.status !== 'reserved',
        onSelect: () => {
          onSelectStay(s.id);
          onClose();
        },
      });
    }

    // 2. Rooms
    const matchedRooms = rooms
      .filter((r) => {
        if (!q) return true;
        const occupant = stayByRoomId.get(r.id);
        return (
          r.room_number.toLowerCase().includes(q) ||
          r.room_type.toLowerCase().includes(q) ||
          r.housekeeping_status.toLowerCase().includes(q) ||
          (occupant?.guest_name.toLowerCase().includes(q) ?? false)
        );
      })
      .slice(0, q ? 6 : 4);

    for (const r of matchedRooms) {
      const occ = stayByRoomId.get(r.id);
      list.push({
        id: `room-${r.id}`,
        group: 'Rooms',
        title: `Room ${r.room_number} · ${r.room_type}`,
        subtitle: occ ? `Occupied by ${occ.guest_name}` : `Floor ${r.floor} · ${currency}${r.nightly_rate.toFixed(0)}/night`,
        meta: r.housekeeping_status.toUpperCase(),
        alert: r.housekeeping_status !== 'clean',
        onSelect: () => {
          onSelectRoom(r.id);
          onClose();
        },
      });
    }

    // 3. Guests
    if (q) {
      const matchedGuests = guests
        .filter(
          (g) =>
            g.full_name.toLowerCase().includes(q) ||
            g.email.toLowerCase().includes(q) ||
            g.phone.toLowerCase().includes(q) ||
            g.company.toLowerCase().includes(q) ||
            g.id_number.toLowerCase().includes(q)
        )
        .slice(0, 6);

      for (const g of matchedGuests) {
        list.push({
          id: `guest-${g.id}`,
          group: 'Guests',
          title: g.full_name,
          subtitle: [g.company, g.phone, g.email].filter(Boolean).join(' · ') || 'Guest profile',
          meta: `${g.stay_count} ${g.stay_count === 1 ? 'stay' : 'stays'}`,
          onSelect: () => {
            onSelectGuest(g.id);
            onClose();
          },
        });
      }
    }

    return list;
  }, [query, stays, rooms, guests, stayByRoomId, currency, onSelectStay, onSelectRoom, onSelectGuest, onClose]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIndex((prev) => (results.length === 0 ? 0 : (prev + 1) % results.length));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIndex((prev) => (results.length === 0 ? 0 : (prev - 1 + results.length) % results.length));
      } else if (e.key === 'Enter' && results[activeIndex]) {
        e.preventDefault();
        results[activeIndex].onSelect();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, results, activeIndex, onClose]);

  if (!open) return null;

  let currentGroup = '';

  return (
    <div
      className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/35 dark:bg-black/65 pt-[12vh] px-4 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Global Quick Search"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-ink/15 bg-surface text-ink shadow-[0_24px_64px_rgba(0,0,0,0.22)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.65)]">
        <div className="flex items-center gap-3 border-b border-ink/10 px-4 py-3.5">
          <Search className="h-4 w-4 shrink-0 text-ink/45" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search guest name, room number (e.g. 204), or confirmation code..."
            className="w-full bg-transparent text-sm text-ink placeholder:text-ink/40 focus:outline-none"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="rounded-md p-1 text-ink/45 hover:bg-ink/[0.06] hover:text-ink"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
          <kbd className="hidden sm:inline-flex items-center rounded border border-ink/15 px-1.5 py-0.5 font-mono text-[10px] text-ink/50">
            ESC
          </kbd>
        </div>

        <div className="max-h-[56vh] overflow-y-auto py-2">
          {results.length === 0 ? (
            <div className="px-6 py-10 text-center text-sm text-ink/50">
              No matching guests, rooms, or bookings found for "{query}".
            </div>
          ) : (
            results.map((item, idx) => {
              const showHeader = item.group !== currentGroup;
              currentGroup = item.group;
              const isSelected = idx === activeIndex;
              const Icon =
                item.group === 'Rooms'
                  ? BedDouble
                  : item.group === 'Guests'
                    ? User
                    : CalendarCheck;

              return (
                <div key={item.id}>
                  {showHeader && (
                    <div className="px-4 pt-2.5 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink/45">
                      {item.group}
                    </div>
                  )}
                  <button
                    type="button"
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={item.onSelect}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
                      isSelected ? 'bg-[#6AD4B0]/20 text-ink' : 'hover:bg-ink/[0.04]'
                    }`}
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <Icon className="h-4 w-4 shrink-0 text-ink/50" />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">{item.title}</div>
                        <div className="truncate text-xs text-ink/55">{item.subtitle}</div>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          item.alert ? 'font-semibold text-danger-ink' : 'text-ink/55'
                        }`}
                      >
                        {item.meta}
                      </span>
                      {isSelected && <CornerDownLeft className="h-3.5 w-3.5 text-ink/45" />}
                    </div>
                  </button>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between border-t border-ink/8 bg-ink/[0.02] px-4 py-2 text-[11px] text-ink/50">
          <span>↑↓ Navigate · Enter Open · Esc Close</span>
          <span className="font-mono">⌘K / Ctrl+K</span>
        </div>
      </div>
    </div>
  );
}
