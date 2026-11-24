import { useEffect, useMemo, useState } from 'react';
import { Calendar, Download, Plus, Printer, Search, UserCheck } from 'lucide-react';
import type { Guest, HotelSettings, PaginatedGuestsResponse, Stay } from '../types';
import { validateDateRange } from '../utils/dateValidation';
import { exportToExcelXlsx } from '../utils/excelExport';
import { Drawer } from './Drawer';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';
import { PaginationBar } from './PaginationBar';

interface GuestDirectoryViewProps {
  guests: Guest[];
  stays: Stay[];
  settings: HotelSettings;
  focusedGuestId: number | null;
  onClearFocusedGuest: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  onOpenFolio: (stayId: number) => void;
  onCheckInGuest: (guest: Guest) => void;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

export function GuestDirectoryView({
  guests,
  stays,
  settings,
  focusedGuestId,
  onClearFocusedGuest,
  authFetch,
  onOpenFolio,
  onCheckInGuest,
  mutate,
}: GuestDirectoryViewProps) {
  const [search, setSearch] = useState('');
  const [lodgeFrom, setLodgeFrom] = useState('');
  const [lodgeTo, setLodgeTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [pagedGuests, setPagedGuests] = useState<Guest[]>([]);
  const [totalGuests, setTotalGuests] = useState<number>(guests.length);
  const [loadingPage, setLoadingPage] = useState(false);

  const [selectedGuest, setSelectedGuest] = useState<Guest | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [company, setCompany] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const staysByGuest = useMemo(() => {
    const map = new Map<number, Stay[]>();
    for (const s of stays) {
      if (s.status === 'cancelled') continue;
      const list = map.get(s.guest_id) ?? [];
      list.push(s);
      map.set(s.guest_id, list);
    }
    return map;
  }, [stays]);

  const inHouseByGuest = useMemo(() => {
    const map = new Map<number, Stay>();
    for (const s of stays) {
      if (s.status === 'checked_in' && !map.has(s.guest_id)) {
        map.set(s.guest_id, s);
      }
    }
    return map;
  }, [stays]);

  const hasDateFilter = Boolean(lodgeFrom || lodgeTo);
  const dateRangeError = useMemo(
    () => validateDateRange(lodgeFrom, lodgeTo, { allowEmpty: true }),
    [lodgeFrom, lodgeTo]
  );

  // Open focused guest from Global Quick Search
  useEffect(() => {
    if (focusedGuestId === null) return;
    const match = guests.find((g) => g.id === focusedGuestId) ?? null;
    if (match) setSelectedGuest(match);
    onClearFocusedGuest();
  }, [focusedGuestId, guests, onClearFocusedGuest]);

  // Reset to page 1 on filter change
  useEffect(() => {
    setPage(1);
  }, [search, lodgeFrom, lodgeTo, pageSize]);

  // Server-side paginated fetch
  useEffect(() => {
    if (dateRangeError) return;
    let active = true;
    async function loadPage() {
      setLoadingPage(true);
      try {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(pageSize),
        });
        if (search.trim()) params.set('q', search.trim());
        if (lodgeFrom) params.set('from', lodgeFrom);
        if (lodgeTo) params.set('to', lodgeTo);

        const res = await authFetch(`/api/guests/paginated?${params.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as PaginatedGuestsResponse;
        if (active) {
          setPagedGuests(data.guests);
          setTotalGuests(data.total);
        }
      } catch {
        // Fallback handled below
      } finally {
        if (active) setLoadingPage(false);
      }
    }
    loadPage();
    return () => {
      active = false;
    };
  }, [authFetch, page, pageSize, search, lodgeFrom, lodgeTo, dateRangeError, guests]);

  // Full filtered list (used for Excel export of the full filtered set)
  const filteredGuestsForExport = useMemo(() => {
    const q = search.trim().toLowerCase();
    return guests.filter((g) => {
      if (hasDateFilter && !dateRangeError) {
        const guestStays = staysByGuest.get(g.id) ?? [];
        const matchedStay = guestStays.some((s) => {
          if (s.status !== 'checked_in' && s.status !== 'checked_out') return false;
          const afterStart = !lodgeFrom || s.check_out_date >= lodgeFrom;
          const beforeEnd = !lodgeTo || s.check_in_date <= lodgeTo;
          return afterStart && beforeEnd;
        });
        if (!matchedStay) return false;
      }

      if (!q) return true;
      return (
        g.full_name.toLowerCase().includes(q) ||
        g.email.toLowerCase().includes(q) ||
        g.phone.toLowerCase().includes(q) ||
        g.id_number.toLowerCase().includes(q) ||
        g.company.toLowerCase().includes(q)
      );
    });
  }, [guests, staysByGuest, search, lodgeFrom, lodgeTo, hasDateFilter, dateRangeError]);

  const selectedGuestStays = useMemo(() => {
    if (!selectedGuest) return [];
    return stays.filter((s) => s.guest_id === selectedGuest.id);
  }, [selectedGuest, stays]);

  function openCreateModal() {
    setEditingGuest(null);
    setFullName('');
    setEmail('');
    setPhone('');
    setIdNumber('');
    setCompany('');
    setNotes('');
    setEditorOpen(true);
  }

  function openEditModal(guest: Guest) {
    setEditingGuest(guest);
    setFullName(guest.full_name);
    setEmail(guest.email);
    setPhone(guest.phone);
    setIdNumber(guest.id_number);
    setCompany(guest.company);
    setNotes(guest.notes);
    setEditorOpen(true);
  }

  async function handleSaveGuest(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload = {
        full_name: fullName,
        email,
        phone,
        id_number: idNumber,
        company,
        notes,
      };
      const ok = editingGuest
        ? await mutate(`/api/guests/${editingGuest.id}`, 'PATCH', payload, 'Guest profile updated')
        : await mutate('/api/guests', 'POST', payload, 'Guest added to directory');
      if (ok) {
        setEditorOpen(false);
        if (editingGuest && selectedGuest?.id === editingGuest.id) {
          setSelectedGuest({ ...editingGuest, ...payload });
        }
      }
    } finally {
      setSubmitting(false);
    }
  }

  function handleExportExcel() {
    if (dateRangeError) return;
    const rangeLabel = hasDateFilter
      ? `${lodgeFrom || 'Start'} to ${lodgeTo || 'Today'}`
      : 'All Time';

    const rows: Array<Array<string | number>> = [];

    if (hasDateFilter) {
      for (const guest of filteredGuestsForExport) {
        const matchedStays = (staysByGuest.get(guest.id) ?? []).filter((s) => {
          if (s.status !== 'checked_in' && s.status !== 'checked_out') return false;
          const afterStart = !lodgeFrom || s.check_out_date >= lodgeFrom;
          const beforeEnd = !lodgeTo || s.check_in_date <= lodgeTo;
          return afterStart && beforeEnd;
        });
        for (const s of matchedStays) {
          rows.push([
            guest.full_name,
            guest.email,
            guest.phone,
            guest.id_number,
            guest.company,
            s.room_number,
            s.check_in_date,
            s.check_out_date,
            s.status.replace('_', ' '),
            Number(s.total_billed.toFixed(2)),
          ]);
        }
      }
      exportToExcelXlsx(
        `hosila-guest-lodge-register-${lodgeFrom || 'all'}-to-${lodgeTo || 'now'}.xlsx`,
        'Guest Lodge Register',
        ['Full Name', 'Email', 'Phone', 'ID / Passport', 'Company', 'Room', 'Check-In', 'Check-Out', 'Status', 'Total Billed'],
        rows,
        `${settings.hotel_name} — Guest Lodge Register (${rangeLabel})`
      );
    } else {
      for (const guest of filteredGuestsForExport) {
        const latestStay = (staysByGuest.get(guest.id) ?? [])[0];
        rows.push([
          guest.full_name,
          guest.email,
          guest.phone,
          guest.id_number,
          guest.company,
          guest.stay_count,
          Number(Number(guest.lifetime_spend).toFixed(2)),
          latestStay ? `${latestStay.check_in_date} to ${latestStay.check_out_date}` : 'No stays yet',
        ]);
      }
      exportToExcelXlsx(
        'hosila-guest-directory-all.xlsx',
        'Guest Directory',
        ['Full Name', 'Email', 'Phone', 'ID / Passport', 'Company', 'Total Stays', 'Lifetime Spend', 'Most Recent Stay'],
        rows,
        `${settings.hotel_name} — Complete Guest Directory (${rangeLabel})`
      );
    }
  }

  const currency = settings.currency_symbol;

  return (
    <div className="space-y-6 print-full">
      {/* Print-Only Header */}
      <div className="hidden print-only border-b border-ink/15 pb-4 mb-6">
        <div className="flex items-center justify-between">
          <div>
            {settings.hotel_logo_url && (
              <img
                src={settings.hotel_logo_url}
                alt={settings.hotel_name}
                className="mb-2 max-h-10 object-contain"
              />
            )}
            <div className="text-lg font-semibold text-ink">{settings.hotel_name}</div>
            <div className="text-xs text-ink/60">
              Guest Directory &amp; Lodge Register ·{' '}
              {hasDateFilter ? `Lodged ${lodgeFrom || 'Beginning'} to ${lodgeTo || 'Present'}` : 'All Recorded Guests'}
            </div>
          </div>
          <div className="text-right font-mono text-xs text-ink/55">
            Printed {new Date().toISOString().slice(0, 10)}
          </div>
        </div>
      </div>

      {/* Filter & Export Controls */}
      <div className="no-print space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email, phone, ID..."
                className="w-full rounded-xl border border-ink/12 bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink/40"
              />
            </div>

            <HoverTip text="Filter guests who lodged within a specific date range for printing or Excel export.">
              <div
                className={`flex flex-wrap items-center gap-2 rounded-xl border bg-surface px-3 py-1.5 text-xs text-ink/65 ${
                  dateRangeError ? 'border-[#E05252]' : 'border-ink/12'
                }`}
              >
                <Calendar className="h-3.5 w-3.5 text-ink/45" />
                <span>Lodged:</span>
                <input
                  type="date"
                  aria-label="Lodged from date"
                  max={lodgeTo || undefined}
                  value={lodgeFrom}
                  onChange={(e) => setLodgeFrom(e.target.value)}
                  className="bg-transparent font-mono text-xs tabular-nums text-ink focus:outline-none"
                />
                <span>to</span>
                <input
                  type="date"
                  aria-label="Lodged to date"
                  min={lodgeFrom || undefined}
                  value={lodgeTo}
                  onChange={(e) => setLodgeTo(e.target.value)}
                  className="bg-transparent font-mono text-xs tabular-nums text-ink focus:outline-none"
                />
                {hasDateFilter && (
                  <button
                    type="button"
                    onClick={() => {
                      setLodgeFrom('');
                      setLodgeTo('');
                    }}
                    className="ml-1 font-medium text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4"
                  >
                    All
                  </button>
                )}
              </div>
            </HoverTip>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <HoverTip text="Download the current guest list or date-filtered lodge register as an Excel (.xlsx) workbook.">
              <button
                type="button"
                disabled={Boolean(dateRangeError)}
                onClick={handleExportExcel}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Download className="h-3.5 w-3.5" />
                Export Excel (.xlsx)
              </button>
            </HoverTip>
            <HoverTip text="Print the displayed guest list with your hotel masthead.">
              <button
                type="button"
                disabled={Boolean(dateRangeError)}
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                Print List
              </button>
            </HoverTip>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Guest
            </button>
          </div>
        </div>

        {dateRangeError && (
          <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/8 px-3.5 py-2 text-xs font-medium text-danger-ink">
            {dateRangeError}
          </div>
        )}
      </div>

      {/* Full-Width Paginated Directory Table */}
      <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                <th className="py-3 px-4">Guest Name</th>
                <th className="py-3 px-4">Contact</th>
                <th className="py-3 px-4">Document ID</th>
                <th className="py-3 px-4 text-right">Stays</th>
                <th className="py-3 px-4 text-right">Lifetime Spend</th>
                <th className="no-print py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8 text-sm">
              {loadingPage && pagedGuests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-xs text-ink/45">
                    Loading guest directory...
                  </td>
                </tr>
              ) : pagedGuests.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center">
                    <p className="text-sm text-ink/50">
                      {hasDateFilter
                        ? 'No guests lodged within the selected date range.'
                        : 'No matching guests found.'}
                    </p>
                    <button
                      type="button"
                      onClick={openCreateModal}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Guest
                    </button>
                  </td>
                </tr>
              ) : (
                pagedGuests.map((guest) => {
                  const isSelected = selectedGuest?.id === guest.id;
                  const activeStay = inHouseByGuest.get(guest.id);
                  return (
                    <tr
                      key={guest.id}
                      onClick={() => setSelectedGuest(guest)}
                      className={`cursor-pointer transition-colors ${
                        isSelected ? 'bg-[#6AD4B0]/14' : 'hover:bg-ink/[0.02]'
                      }`}
                    >
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-ink">{guest.full_name}</span>
                          {activeStay && (
                            <span className="inline-flex items-center gap-1 font-mono text-[11px] font-medium text-ink">
                              <span className="h-1.5 w-1.5 rounded-full bg-[#6AD4B0]" />
                              In-House Rm {activeStay.room_number}
                            </span>
                          )}
                        </div>
                        {guest.company && <div className="text-xs text-ink/50">{guest.company}</div>}
                      </td>
                      <td className="py-3 px-4">
                        <div className="text-xs text-ink">{guest.email || '—'}</div>
                        <div className="font-mono text-xs tabular-nums text-ink/50">{guest.phone || '—'}</div>
                      </td>
                      <td className="py-3 px-4 font-mono text-xs tabular-nums text-ink/65 whitespace-nowrap">
                        {guest.id_number || '—'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-xs tabular-nums text-ink">
                        {guest.stay_count}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                        {currency}
                        {Number(guest.lifetime_spend).toFixed(2)}
                      </td>
                      <td className="no-print py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2.5 text-xs font-medium">
                          <HoverTip text="Open the Check-In modal with this guest pre-selected.">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onCheckInGuest(guest);
                              }}
                              className="rounded-lg bg-[#6AD4B0]/25 px-2.5 py-1 font-semibold text-ink hover:bg-[#6AD4B0]/45 transition-colors"
                            >
                              Check In
                            </button>
                          </HoverTip>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openEditModal(guest);
                            }}
                            className="text-ink/60 hover:text-ink"
                          >
                            Edit
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <PaginationBar
          page={page}
          pageSize={pageSize}
          totalItems={totalGuests}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          itemLabel="guests"
        />
      </div>

      {/* Print-Only Footer */}
      <div className="hidden print-only pt-6 mt-6 border-t border-ink/15 text-xs text-ink/55 flex justify-between">
        <span>
          {settings.hotel_name} · {settings.hotel_address} · {settings.hotel_phone}
        </span>
        <span>Powered by Hosila</span>
      </div>

      {/* Right-Side Slide-Over Guest Profile Drawer */}
      <Drawer
        open={Boolean(selectedGuest)}
        onClose={() => setSelectedGuest(null)}
        title={selectedGuest ? selectedGuest.full_name : ''}
        subtitle={selectedGuest?.company || 'Guest Profile & Stay History'}
      >
        {selectedGuest && (
          <div className="space-y-6">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const g = selectedGuest;
                  setSelectedGuest(null);
                  onCheckInGuest(g);
                }}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#6AD4B0] py-2.5 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
              >
                <UserCheck className="h-4 w-4" />
                Check In / Reserve
              </button>
              <button
                type="button"
                onClick={() => openEditModal(selectedGuest)}
                className="rounded-xl border border-ink/15 px-4 py-2.5 text-xs font-medium text-ink hover:bg-ink/[0.04]"
              >
                Edit
              </button>
            </div>

            <dl className="space-y-3 text-sm border-t border-ink/8 pt-4">
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-ink/50">Email</dt>
                <dd className="text-xs text-ink text-right truncate">{selectedGuest.email || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-ink/50">Phone</dt>
                <dd className="font-mono text-xs tabular-nums text-ink">{selectedGuest.phone || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-ink/50">ID / Passport</dt>
                <dd className="font-mono text-xs tabular-nums text-ink">{selectedGuest.id_number || '—'}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-xs text-ink/50">Lifetime Spend</dt>
                <dd className="font-mono text-xs font-semibold tabular-nums text-ink">
                  {currency}
                  {Number(selectedGuest.lifetime_spend).toFixed(2)} ({selectedGuest.stay_count}{' '}
                  {selectedGuest.stay_count === 1 ? 'stay' : 'stays'})
                </dd>
              </div>
              {selectedGuest.notes && (
                <div className="pt-2 border-t border-ink/8">
                  <dt className="text-xs text-ink/50 mb-1">Preferences &amp; Notes</dt>
                  <dd className="text-xs leading-relaxed text-ink/80">{selectedGuest.notes}</dd>
                </div>
              )}
            </dl>

            <div className="border-t border-ink/8 pt-4 space-y-3">
              <div className="text-xs font-medium text-ink/55">Stay &amp; Folio History</div>
              {selectedGuestStays.length === 0 ? (
                <p className="text-xs text-ink/45">No stays recorded for this guest yet.</p>
              ) : (
                <div className="space-y-2">
                  {selectedGuestStays.map((stay) => (
                    <div
                      key={stay.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-ink/10 px-3.5 py-2.5"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-medium text-ink">
                          {stay.room_id ? `Room ${stay.room_number}` : 'Unassigned'} ·{' '}
                          <span className="capitalize">{stay.status.replace('_', ' ')}</span>
                        </div>
                        <div className="font-mono text-xs tabular-nums text-ink/50">
                          {stay.check_in_date} → {stay.check_out_date}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedGuest(null);
                          onOpenFolio(stay.id);
                        }}
                        className="rounded-lg bg-[#6AD4B0]/25 px-2.5 py-1 text-xs font-semibold text-ink hover:bg-[#6AD4B0]/45 whitespace-nowrap shrink-0"
                      >
                        Folio
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Drawer>

      {/* Add / Edit Guest Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editingGuest ? 'Edit Guest Profile' : 'New Guest Profile'}
      >
        <form onSubmit={handleSaveGuest} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Full Name *</label>
            <input
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Used for confirmation receipts"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Phone Number</label>
              <input
                type="text"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Passport / ID Number</label>
              <input
                type="text"
                value={idNumber}
                onChange={(e) => setIdNumber(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Company / Organization</label>
              <input
                type="text"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Preferences &amp; Notes</label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Room preferences, dietary notes, billing instructions..."
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setEditorOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : editingGuest ? 'Update Guest' : 'Save Guest'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
