import { useMemo, useState } from 'react';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  GanttChart,
  Plus,
  UserCheck,
} from 'lucide-react';
import type { FolioPayment, HotelSettings, Room, Stay, TaxBreakdownItem } from '../types';
import { getLocalTodayIso } from '../utils/dateValidation';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';

interface ReservationCheckInModalProps {
  stay: Stay | null;
  rooms: Room[];
  stays: Stay[];
  settings: HotelSettings;
  onClose: () => void;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function countNights(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T12:00:00Z`).getTime();
  const end = new Date(`${checkOut}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function ReservationCheckInModal({
  stay,
  rooms,
  stays,
  settings,
  onClose,
  mutate,
}: ReservationCheckInModalProps) {
  const [selectedRoomId, setSelectedRoomId] = useState<string>('');
  const [paymentAmount, setPaymentAmount] = useState<string>('0');
  const [paymentMethod, setPaymentMethod] = useState<FolioPayment['method']>('card');
  const [paymentRef, setPaymentRef] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const currency = settings.currency_symbol;
  const taxEnabled = settings.tax_enabled === 1;

  const candidateRooms = useMemo(() => {
    if (!stay) return [];
    return rooms.map((room) => {
      const conflict = stays.find(
        (other) =>
          other.id !== stay.id &&
          other.room_id === room.id &&
          (other.status === 'checked_in' || other.status === 'reserved') &&
          datesOverlap(stay.check_in_date, stay.check_out_date, other.check_in_date, other.check_out_date)
      );
      const isUnclean = room.housekeeping_status !== 'clean';
      const matchesRequestedType =
        !stay.requested_room_type || room.room_type === stay.requested_room_type;
      return {
        room,
        conflict,
        isUnclean,
        unavailable: Boolean(conflict) || isUnclean,
        matchesRequestedType,
      };
    });
  }, [stay, rooms, stays]);

  const effectiveRoomId = useMemo(() => {
    if (!stay) return '';
    if (selectedRoomId) return selectedRoomId;
    if (stay.room_id) return String(stay.room_id);
    const preferred =
      candidateRooms.find((c) => !c.unavailable && c.matchesRequestedType) ??
      candidateRooms.find((c) => !c.unavailable);
    return preferred ? String(preferred.room.id) : '';
  }, [stay, selectedRoomId, candidateRooms]);

  const selectedRoomObj = useMemo(
    () => rooms.find((r) => String(r.id) === effectiveRoomId) ?? null,
    [rooms, effectiveRoomId]
  );
  const selectedRoomUnclean = Boolean(selectedRoomObj && selectedRoomObj.housekeeping_status !== 'clean');

  if (!stay) return null;

  const nights = countNights(stay.check_in_date, stay.check_out_date);
  const subtotal = stay.charges_subtotal > 0 ? stay.charges_subtotal : stay.estimated_subtotal;
  const taxAmt = stay.charges_subtotal > 0 ? stay.tax_amount : stay.estimated_tax;
  const totalAmt = stay.total_billed > 0 ? stay.total_billed : stay.estimated_total;
  const paidAmt = stay.total_paid;
  const balanceRemaining = Math.max(0, Math.round((totalAmt - paidAmt) * 100) / 100);
  const payNowNum = Math.max(0, Number(paymentAmount) || 0);
  const balanceAfterPay = Math.max(0, Math.round((balanceRemaining - payNowNum) * 100) / 100);
  let stayTaxBreakdown: TaxBreakdownItem[] = [];
  if (stay.tax_breakdown_json) {
    try {
      stayTaxBreakdown = JSON.parse(stay.tax_breakdown_json) as TaxBreakdownItem[];
    } catch {
      stayTaxBreakdown = [];
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!stay || !effectiveRoomId || selectedRoomUnclean) return;
    setSubmitting(true);
    try {
      const assignedRoom = rooms.find((r) => String(r.id) === effectiveRoomId);
      const ok = await mutate(
        `/api/stays/${stay.id}/checkin`,
        'POST',
        {
          room_id: Number(effectiveRoomId),
          payment_amount: payNowNum,
          payment_method: paymentMethod,
          payment_reference: paymentRef,
        },
        `${stay.guest_name} checked in to Room ${assignedRoom?.room_number ?? stay.room_number}`
      );
      if (ok) {
        setSelectedRoomId('');
        setPaymentAmount('0');
        setPaymentRef('');
        onClose();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={Boolean(stay)}
      onClose={() => {
        setSelectedRoomId('');
        setPaymentAmount('0');
        setPaymentRef('');
        onClose();
      }}
      title={`Check In · ${stay.guest_name}`}
      subtitle={`${stay.confirmation_code} · ${stay.check_in_date} → ${stay.check_out_date} (${nights} ${nights === 1 ? 'night' : 'nights'})`}
      maxWidthClass="max-w-lg"
    >
      <form onSubmit={handleConfirm} className="space-y-5">
        <div>
          <label className="block text-xs font-medium text-ink/65 mb-1.5">
            Assigned Room {!stay.room_id && <span className="text-ink">(Required — Requested: {stay.room_type})</span>}
          </label>
          <select
            required
            value={effectiveRoomId}
            onChange={(e) => setSelectedRoomId(e.target.value)}
            className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
          >
            <option value="">Select a Clean room to assign...</option>
            {candidateRooms.map(({ room, conflict, isUnclean, unavailable, matchesRequestedType }) => (
              <option key={room.id} value={room.id} disabled={unavailable}>
                Room {room.room_number} · {room.room_type} ({currency}
                {room.nightly_rate}/night)
                {!matchesRequestedType && stay.requested_room_type ? ' · Different type' : ''}
                {conflict ? ` — Occupied/Reserved (${conflict.guest_name})` : ''}
                {isUnclean
                  ? ` — ${room.housekeeping_status.charAt(0).toUpperCase() + room.housekeeping_status.slice(1)}`
                  : ''}
              </option>
            ))}
          </select>
          {selectedRoomUnclean && selectedRoomObj && (
            <div className="mt-2 rounded-xl border border-[#E05252]/40 bg-[#E05252]/8 px-3 py-2 text-xs font-medium text-danger-ink">
              Room {selectedRoomObj.room_number} is marked{' '}
              <span className="capitalize font-semibold">{selectedRoomObj.housekeeping_status}</span>. Mark it Clean on the Room Board or assign another clean room to check in.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-4 space-y-2 text-xs">
          <div className="flex justify-between text-ink/65">
            <span>
              Room Charge ({nights} {nights === 1 ? 'night' : 'nights'} × {currency}
              {stay.nightly_rate.toFixed(2)})
            </span>
            <span className="font-mono tabular-nums text-ink">
              {currency}
              {subtotal.toFixed(2)}
            </span>
          </div>
          {taxEnabled &&
            (taxAmt > 0 ? (
              stayTaxBreakdown.length > 0 ? (
                stayTaxBreakdown.map((item) => (
                  <div
                    key={`${item.name}-${item.rate}-${item.mode}`}
                    className="flex justify-between text-ink/65"
                  >
                    <span>
                      {item.name} ({item.rate}% {item.mode === 'inclusive' ? 'incl.' : 'excl.'})
                    </span>
                    <span className="font-mono tabular-nums text-ink">
                      {currency}
                      {item.amount.toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between text-ink/65">
                  <span>{stay.tax_label || 'Tax'}</span>
                  <span className="font-mono tabular-nums text-ink">
                    {currency}
                    {taxAmt.toFixed(2)}
                  </span>
                </div>
              )
            ) : (
              <div className="flex justify-between text-ink/45">
                <span>Tax</span>
                <span>None / Exempt</span>
              </div>
            ))}
          <div className="flex justify-between border-t border-ink/10 pt-2 font-medium text-ink">
            <span>Total Stay Amount</span>
            <span className="font-mono tabular-nums">
              {currency}
              {totalAmt.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between text-ink/70">
            <span>Amount Paid / Deposited</span>
            <span className="font-mono tabular-nums font-medium text-ink">
              −{currency}
              {paidAmt.toFixed(2)}
            </span>
          </div>
          <div className="flex justify-between border-t border-ink/12 pt-2 text-sm font-semibold text-ink">
            <span>Balance Remaining</span>
            <span className="font-mono tabular-nums">
              {currency}
              {balanceRemaining.toFixed(2)}
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-ink/65">
              Collect Payment at Check-In (Optional)
            </span>
            {balanceRemaining > 0 && (
              <button
                type="button"
                onClick={() => setPaymentAmount(balanceRemaining.toFixed(2))}
                className="text-xs font-medium text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4 hover:opacity-80"
              >
                Collect Full Balance ({currency}
                {balanceRemaining.toFixed(2)})
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] text-ink/55 mb-1">Amount ({currency})</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 font-mono text-xs tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] text-ink/55 mb-1">Method</label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as FolioPayment['method'])}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-2.5 py-2 text-xs text-ink"
              >
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] text-ink/55 mb-1">Reference</label>
              <input
                type="text"
                value={paymentRef}
                onChange={(e) => setPaymentRef(e.target.value)}
                placeholder="Receipt #"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
              />
            </div>
          </div>
          {payNowNum > 0 && (
            <div className="flex justify-between text-xs text-ink/65 px-1">
              <span>Balance after check-in payment</span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {currency}
                {balanceAfterPay.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
          >
            Cancel
          </button>
          <HoverTip
            text={
              selectedRoomUnclean
                ? 'Cannot check in while the assigned room is not marked Clean.'
                : 'Checks guest in, posts accommodation charges, and opens active folio.'
            }
          >
            <button
              type="submit"
              disabled={submitting || !effectiveRoomId || selectedRoomUnclean}
              className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <UserCheck className="h-4 w-4" />
              {submitting ? 'Checking In...' : 'Confirm Check-In'}
            </button>
          </HoverTip>
        </div>
      </form>
    </Modal>
  );
}

interface ReservationsViewProps {
  rooms: Room[];
  stays: Stay[];
  settings: HotelSettings;
  onNewReservation: (options?: { room?: Room; checkInDate?: string; maxCheckOutDate?: string }) => void;
  onRequestCheckIn: (stay: Stay) => void;
  onOpenFolio: (stayId: number) => void;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH_NAMES = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(year: number, monthIndex: number, day: number): string {
  return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
}

export function ReservationsView({
  rooms,
  stays,
  settings,
  onNewReservation,
  onRequestCheckIn,
  onOpenFolio,
  mutate,
}: ReservationsViewProps) {
  const todayIso = getLocalTodayIso();
  const now = new Date();
  const [plannerMode, setPlannerMode] = useState<'tape_chart' | 'calendar'>('tape_chart');

  // Tape Chart state
  const [tapeStartDate, setTapeStartDate] = useState(() => addDaysIso(todayIso, -1));
  const [tapeSpanDays, setTapeSpanDays] = useState<14 | 21>(14);
  const [tapeFloorFilter, setTapeFloorFilter] = useState<string>('all');

  // Month Calendar state
  const [viewYear, setViewYear] = useState(now.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(now.getUTCMonth());
  const [selectedRoomId, setSelectedRoomId] = useState<string>(rooms[0] ? String(rooms[0].id) : '');

  // Quick Deposit Modal state
  const [depositStay, setDepositStay] = useState<Stay | null>(null);
  const [depositAmount, setDepositAmount] = useState('');
  const [depositMethod, setDepositMethod] = useState<FolioPayment['method']>('card');
  const [depositRef, setDepositRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const effectiveRoomId = selectedRoomId || (rooms[0] ? String(rooms[0].id) : '');
  const selectedRoom = useMemo(
    () => rooms.find((r) => String(r.id) === effectiveRoomId) ?? rooms[0] ?? null,
    [rooms, effectiveRoomId]
  );

  // Tape Chart date columns
  const tapeDates = useMemo(() => {
    return Array.from({ length: tapeSpanDays }, (_, idx) => {
      const iso = addDaysIso(tapeStartDate, idx);
      const d = new Date(`${iso}T12:00:00Z`);
      return {
        iso,
        weekday: WEEKDAYS[d.getUTCDay()],
        dayNum: d.getUTCDate(),
        monthShort: SHORT_MONTHS[d.getUTCMonth()],
        isWeekend: d.getUTCDay() === 0 || d.getUTCDay() === 6,
      };
    });
  }, [tapeStartDate, tapeSpanDays]);

  const tapeEndIso = useMemo(
    () => addDaysIso(tapeStartDate, tapeSpanDays),
    [tapeStartDate, tapeSpanDays]
  );

  const floors = useMemo(
    () => Array.from(new Set(rooms.map((r) => r.floor))).sort((a, b) => a - b),
    [rooms]
  );

  const tapeRooms = useMemo(() => {
    if (tapeFloorFilter === 'all') return rooms;
    return rooms.filter((r) => String(r.floor) === tapeFloorFilter);
  }, [rooms, tapeFloorFilter]);

  const activeStaysByRoom = useMemo(() => {
    const map = new Map<number, Stay[]>();
    for (const s of stays) {
      if (s.room_id === null || (s.status !== 'checked_in' && s.status !== 'reserved')) continue;
      const list = map.get(s.room_id) ?? [];
      list.push(s);
      map.set(s.room_id, list);
    }
    return map;
  }, [stays]);

  // Month Calendar stays for selected room
  const roomStays = useMemo(() => {
    if (!selectedRoom) return [];
    return activeStaysByRoom.get(selectedRoom.id) ?? [];
  }, [activeStaysByRoom, selectedRoom]);

  const upcomingReservations = useMemo(
    () =>
      stays
        .filter((s) => s.status === 'reserved')
        .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date)),
    [stays]
  );

  const calendarDays = useMemo(() => {
    const firstWeekday = new Date(Date.UTC(viewYear, viewMonth, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
    const cells: Array<{ iso: string | null; day: number | null; stay: Stay | null }> = [];

    for (let i = 0; i < firstWeekday; i++) {
      cells.push({ iso: null, day: null, stay: null });
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const iso = toIsoDate(viewYear, viewMonth, day);
      const match =
        roomStays.find((s) => s.status === 'checked_in' && s.check_in_date <= iso && iso < s.check_out_date) ??
        roomStays.find((s) => s.status === 'reserved' && s.check_in_date <= iso && iso < s.check_out_date) ??
        null;
      cells.push({ iso, day, stay: match });
    }
    return cells;
  }, [viewYear, viewMonth, roomStays]);

  const occupiedDaysCount = useMemo(
    () => calendarDays.filter((c) => c.stay !== null).length,
    [calendarDays]
  );

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewYear((y) => y - 1);
      setViewMonth(11);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (viewMonth === 11) {
      setViewYear((y) => y + 1);
      setViewMonth(0);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  function goToday() {
    const d = new Date();
    setViewYear(d.getUTCFullYear());
    setViewMonth(d.getUTCMonth());
    setTapeStartDate(addDaysIso(getLocalTodayIso(), -1));
  }

  async function handleAssignRoomQuick(stay: Stay, roomIdStr: string) {
    const roomId = roomIdStr ? Number(roomIdStr) : null;
    await mutate(
      `/api/stays/${stay.id}/assign-room`,
      'PATCH',
      { room_id: roomId },
      roomId ? 'Room assigned to reservation' : 'Room unassigned'
    );
  }

  async function handleCancelReservation(stay: Stay) {
    await mutate(
      `/api/stays/${stay.id}/cancel`,
      'POST',
      {},
      `Reservation ${stay.confirmation_code} cancelled`
    );
  }

  async function handleSaveDeposit(e: React.FormEvent) {
    e.preventDefault();
    if (!depositStay) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        `/api/stays/${depositStay.id}/payments`,
        'POST',
        {
          amount: Number(depositAmount),
          method: depositMethod,
          reference: depositRef || 'Reservation Deposit',
        },
        `Deposit recorded for ${depositStay.guest_name}`
      );
      if (ok) {
        setDepositStay(null);
        setDepositAmount('');
        setDepositRef('');
      }
    } finally {
      setSubmitting(false);
    }
  }

  const currency = settings.currency_symbol;
  const taxEnabled = settings.tax_enabled === 1;

  return (
    <div className="space-y-8">
      {/* Room Availability Section (Tape Chart | Room Calendar) */}
      <section className="rounded-2xl border border-ink/12 bg-surface p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Mode Switcher */}
            <div className="inline-flex rounded-xl bg-ink/[0.05] p-1">
              <button
                type="button"
                onClick={() => setPlannerMode('tape_chart')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  plannerMode === 'tape_chart'
                    ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                <GanttChart className="h-3.5 w-3.5" />
                Tape Chart
              </button>
              <button
                type="button"
                onClick={() => setPlannerMode('calendar')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                  plannerMode === 'calendar'
                    ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                Room Calendar
              </button>
            </div>

            {plannerMode === 'tape_chart' ? (
              <>
                <div className="inline-flex items-center rounded-xl border border-ink/12 bg-canvas p-0.5">
                  <button
                    type="button"
                    onClick={() => setTapeStartDate((prev) => addDaysIso(prev, -7))}
                    aria-label="Previous 7 days"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/65 hover:bg-ink/[0.05] hover:text-ink"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="px-2.5 font-mono text-xs font-semibold tabular-nums text-ink whitespace-nowrap">
                    {tapeDates[0]?.monthShort} {tapeDates[0]?.dayNum} →{' '}
                    {tapeDates[tapeDates.length - 1]?.monthShort} {tapeDates[tapeDates.length - 1]?.dayNum}
                  </span>
                  <button
                    type="button"
                    onClick={() => setTapeStartDate((prev) => addDaysIso(prev, 7))}
                    aria-label="Next 7 days"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/65 hover:bg-ink/[0.05] hover:text-ink"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-xl border border-ink/12 bg-canvas px-3 py-2 text-xs font-medium text-ink/70 hover:bg-ink/[0.04]"
                >
                  Today
                </button>

                <div className="inline-flex rounded-xl bg-ink/[0.05] p-0.5 text-xs">
                  {([14, 21] as const).map((span) => (
                    <button
                      key={span}
                      type="button"
                      onClick={() => setTapeSpanDays(span)}
                      className={`rounded-lg px-2.5 py-1.5 font-mono font-medium transition-colors ${
                        tapeSpanDays === span
                          ? 'bg-canvas text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                          : 'text-ink/60 hover:text-ink'
                      }`}
                    >
                      {span}d
                    </button>
                  ))}
                </div>

                {floors.length > 1 && (
                  <select
                    aria-label="Filter tape chart by floor"
                    value={tapeFloorFilter}
                    onChange={(e) => setTapeFloorFilter(e.target.value)}
                    className="rounded-xl border border-ink/12 bg-canvas px-3 py-2 text-xs font-medium text-ink"
                  >
                    <option value="all">All Floors</option>
                    {floors.map((fl) => (
                      <option key={fl} value={String(fl)}>
                        Floor {fl}
                      </option>
                    ))}
                  </select>
                )}
              </>
            ) : (
              <>
                <select
                  aria-label="Select room to view calendar"
                  value={effectiveRoomId}
                  onChange={(e) => setSelectedRoomId(e.target.value)}
                  className="rounded-xl border border-ink/15 bg-canvas px-3.5 py-2 text-sm font-medium text-ink"
                >
                  {rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      Room {r.room_number} · {r.room_type} ({currency}
                      {r.nightly_rate}/night)
                    </option>
                  ))}
                </select>

                <div className="inline-flex items-center rounded-xl border border-ink/12 bg-canvas p-0.5">
                  <button
                    type="button"
                    onClick={goPrevMonth}
                    aria-label="Previous month"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/65 hover:bg-ink/[0.05] hover:text-ink"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <span className="min-w-[136px] text-center text-xs font-semibold text-ink">
                    {MONTH_NAMES[viewMonth]} {viewYear}
                  </span>
                  <button
                    type="button"
                    onClick={goNextMonth}
                    aria-label="Next month"
                    className="flex h-8 w-8 items-center justify-center rounded-lg text-ink/65 hover:bg-ink/[0.05] hover:text-ink"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <button
                  type="button"
                  onClick={goToday}
                  className="rounded-xl border border-ink/12 bg-canvas px-3 py-2 text-xs font-medium text-ink/70 hover:bg-ink/[0.04]"
                >
                  Today
                </button>
              </>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3.5 text-xs text-ink/60">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-[#6AD4B0]" />
                In-House
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-ink" />
                Reserved
              </span>
              {plannerMode === 'calendar' && (
                <span className="font-mono tabular-nums text-ink/45">
                  {occupiedDaysCount} {occupiedDaysCount === 1 ? 'night' : 'nights'}
                </span>
              )}
            </div>

            <HoverTip text="Create a future reservation with an optional room number or room type.">
              <button
                type="button"
                onClick={() =>
                  onNewReservation({ room: plannerMode === 'calendar' ? selectedRoom ?? undefined : undefined })
                }
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors whitespace-nowrap"
              >
                <Plus className="h-3.5 w-3.5" />
                New Reservation
              </button>
            </HoverTip>
          </div>
        </div>

        {/* VIEW 1: HORIZONTAL ROOM × DATE TAPE CHART */}
        {plannerMode === 'tape_chart' ? (
          <div className="overflow-x-auto rounded-xl border border-ink/10 bg-canvas">
            <div style={{ minWidth: `${188 + tapeSpanDays * 54}px` }}>
              {/* Header Row */}
              <div
                className="grid border-b border-ink/10 bg-ink/[0.02]"
                style={{ gridTemplateColumns: `188px repeat(${tapeSpanDays}, minmax(54px, 1fr))` }}
              >
                <div className="sticky left-0 z-20 border-r border-ink/10 bg-canvas px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink/55">
                  Room
                </div>
                {tapeDates.map((d) => {
                  const isToday = d.iso === todayIso;
                  return (
                    <div
                      key={d.iso}
                      className={`border-r border-ink/6 px-1 py-2 text-center last:border-r-0 ${
                        isToday ? 'bg-[#6AD4B0]/18' : d.isWeekend ? 'bg-ink/[0.02]' : ''
                      }`}
                    >
                      <div
                        className={`text-[10px] font-medium ${
                          isToday ? 'text-accent-ink font-semibold' : 'text-ink/45'
                        }`}
                      >
                        {d.weekday}
                      </div>
                      <div
                        className={`font-mono text-xs tabular-nums ${
                          isToday ? 'font-bold text-ink' : 'font-medium text-ink/80'
                        }`}
                      >
                        {d.dayNum}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Room Rows */}
              <div className="divide-y divide-ink/8">
                {tapeRooms.map((room) => {
                  const rStays = (activeStaysByRoom.get(room.id) ?? []).filter(
                    (s) => s.check_in_date < tapeEndIso && s.check_out_date > tapeStartDate
                  );
                  const isUnclean = room.housekeeping_status !== 'clean';

                  return (
                    <div
                      key={room.id}
                      className="grid items-stretch"
                      style={{ gridTemplateColumns: `188px 1fr` }}
                    >
                      {/* Sticky Left Room Cell */}
                      <div className="sticky left-0 z-10 flex items-center justify-between gap-2 border-r border-ink/10 bg-surface px-3.5 py-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span
                              className={`h-2 w-2 rounded-full shrink-0 ${
                                isUnclean ? 'bg-[#E05252]' : 'bg-[#6AD4B0]'
                              }`}
                            />
                            <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                              {room.room_number}
                            </span>
                          </div>
                          <div className="truncate text-[11px] text-ink/50">{room.room_type}</div>
                        </div>
                        <span className="font-mono text-[10px] tabular-nums text-ink/45 shrink-0">
                          {currency}
                          {room.nightly_rate}
                        </span>
                      </div>

                      {/* Timeline Track */}
                      <div
                        className="relative grid h-11"
                        style={{ gridTemplateColumns: `repeat(${tapeSpanDays}, minmax(54px, 1fr))` }}
                      >
                        {/* Clickable Open Day Cells */}
                        {tapeDates.map((d) => {
                          const isToday = d.iso === todayIso;
                          const occupying = rStays.find(
                            (s) => s.check_in_date <= d.iso && d.iso < s.check_out_date
                          );
                          const nextAfter = !occupying
                            ? (activeStaysByRoom.get(room.id) ?? [])
                                .filter((s) => s.check_in_date > d.iso)
                                .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0]
                            : null;

                          return (
                            <button
                              key={d.iso}
                              type="button"
                              disabled={Boolean(occupying) || room.housekeeping_status === 'maintenance'}
                              onClick={() =>
                                onNewReservation({
                                  room,
                                  checkInDate: d.iso,
                                  maxCheckOutDate: nextAfter?.check_in_date,
                                })
                              }
                              aria-label={`Book Room ${room.room_number} from ${d.iso}`}
                              className={`h-full border-r border-ink/6 last:border-r-0 transition-colors ${
                                isToday
                                  ? 'bg-[#6AD4B0]/[0.08]'
                                  : d.isWeekend
                                    ? 'bg-ink/[0.015]'
                                    : ''
                              } ${
                                !occupying && room.housekeeping_status !== 'maintenance'
                                  ? 'hover:bg-[#6AD4B0]/20 cursor-pointer'
                                  : 'cursor-default'
                              }`}
                            />
                          );
                        })}

                        {/* Contiguous Stay Bars */}
                        {rStays.map((stay) => {
                          const startIdx = Math.max(
                            0,
                            Math.round(
                              (new Date(`${stay.check_in_date}T12:00:00Z`).getTime() -
                                new Date(`${tapeStartDate}T12:00:00Z`).getTime()) /
                                (1000 * 60 * 60 * 24)
                            )
                          );
                          const endIdx = Math.min(
                            tapeSpanDays,
                            Math.round(
                              (new Date(`${stay.check_out_date}T12:00:00Z`).getTime() -
                                new Date(`${tapeStartDate}T12:00:00Z`).getTime()) /
                                (1000 * 60 * 60 * 24)
                            )
                          );
                          if (endIdx <= startIdx) return null;

                          const leftPct = (startIdx / tapeSpanDays) * 100;
                          const widthPct = ((endIdx - startIdx) / tapeSpanDays) * 100;
                          const isCheckedIn = stay.status === 'checked_in';

                          return (
                            <button
                              key={stay.id}
                              type="button"
                              onClick={() =>
                                isCheckedIn ? onOpenFolio(stay.id) : onRequestCheckIn(stay)
                              }
                              title={`${stay.guest_name} (${stay.confirmation_code}) · ${stay.check_in_date} → ${stay.check_out_date}`}
                              style={{
                                left: `calc(${leftPct}% + 3px)`,
                                width: `calc(${widthPct}% - 6px)`,
                              }}
                              className={`absolute top-1.5 bottom-1.5 z-10 flex items-center justify-between gap-1.5 rounded-lg px-2 text-left text-[11px] font-semibold transition-opacity hover:opacity-90 overflow-hidden ${
                                isCheckedIn
                                  ? 'bg-[#6AD4B0] text-[#1D1D1F]'
                                  : 'bg-ink text-canvas'
                              }`}
                            >
                              <span className="truncate">{stay.guest_name}</span>
                              {endIdx - startIdx >= 2 && (
                                <span className="font-mono text-[10px] opacity-75 shrink-0">
                                  {stay.confirmation_code}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        ) : (
          /* VIEW 2: 7-COLUMN SINGLE-ROOM MONTH CALENDAR */
          <div>
            <div className="grid grid-cols-7 gap-1.5 mb-1.5">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="py-1 text-center text-[11px] font-medium text-ink/45">
                  {wd}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {calendarDays.map((cell, idx) => {
                if (!cell.iso || cell.day === null) {
                  return <div key={`empty-${idx}`} className="h-16 rounded-xl bg-ink/[0.02]" />;
                }
                const isToday = cell.iso === todayIso;
                const isCheckedIn = cell.stay?.status === 'checked_in';
                const isReserved = cell.stay?.status === 'reserved';

                const nextResAfterDay = !cell.stay
                  ? roomStays
                      .filter((s) => s.check_in_date > cell.iso!)
                      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0]
                  : null;

                return (
                  <button
                    key={cell.iso}
                    type="button"
                    onClick={() => {
                      if (isCheckedIn && cell.stay) {
                        onOpenFolio(cell.stay.id);
                      } else if (isReserved && cell.stay) {
                        onRequestCheckIn(cell.stay);
                      } else if (selectedRoom) {
                        onNewReservation({
                          room: selectedRoom,
                          checkInDate: cell.iso!,
                          maxCheckOutDate: nextResAfterDay?.check_in_date,
                        });
                      }
                    }}
                    className={`flex h-16 flex-col justify-between rounded-xl border p-2 text-left transition-colors ${
                      isCheckedIn
                        ? 'border-[#6AD4B0] bg-[#6AD4B0]/22 hover:bg-[#6AD4B0]/30'
                        : isReserved
                          ? 'border-ink/40 bg-ink/[0.09] hover:bg-ink/[0.14]'
                          : isToday
                            ? 'border-[#6AD4B0] bg-canvas hover:bg-[#6AD4B0]/10'
                            : 'border-ink/10 bg-canvas hover:border-ink/30'
                    }`}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          isToday ? 'font-bold text-ink' : 'font-medium text-ink/75'
                        }`}
                      >
                        {cell.day}
                      </span>
                      {isToday && (
                        <span className="h-1.5 w-1.5 rounded-full bg-[#6AD4B0]" aria-label="Today" />
                      )}
                    </div>
                    {cell.stay ? (
                      <div className="truncate text-[11px] font-medium text-ink">
                        {isReserved ? 'Res · ' : ''}
                        {cell.stay.guest_name.split(' ')[0]}
                      </div>
                    ) : (
                      <div className="text-[10px] text-ink/35">Open</div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </section>

      {/* Reservations List Table */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Upcoming Reservations</h2>
          <span className="font-mono text-xs tabular-nums text-ink/50">
            {upcomingReservations.length} active
          </span>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-ink/10 bg-surface">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                <th className="py-3 px-4">Guest</th>
                <th className="py-3 px-4">Room / Type</th>
                <th className="py-3 px-4">Stay Dates</th>
                <th className="py-3 px-4 text-right">Stay Total</th>
                <th className="py-3 px-4 text-right">Deposited</th>
                <th className="py-3 px-4 text-right">Balance</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/8 text-sm">
              {upcomingReservations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center">
                    <p className="text-sm text-ink/50">No upcoming reservations scheduled.</p>
                    <button
                      type="button"
                      onClick={() => onNewReservation()}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      New Reservation
                    </button>
                  </td>
                </tr>
              ) : (
                upcomingReservations.map((stay) => {
                  const nights = countNights(stay.check_in_date, stay.check_out_date);
                  const totalStay = stay.total_billed > 0 ? stay.total_billed : stay.estimated_total;
                  const taxStay = stay.charges_subtotal > 0 ? stay.tax_amount : stay.estimated_tax;
                  const balance = Math.max(0, Math.round((totalStay - stay.total_paid) * 100) / 100);

                  const assignableRooms = !stay.room_id
                    ? rooms.filter(
                        (r) =>
                          r.housekeeping_status !== 'maintenance' &&
                          !stays.some(
                            (other) =>
                              other.id !== stay.id &&
                              other.room_id === r.id &&
                              (other.status === 'checked_in' || other.status === 'reserved') &&
                              datesOverlap(
                                stay.check_in_date,
                                stay.check_out_date,
                                other.check_in_date,
                                other.check_out_date
                              )
                          )
                      )
                    : [];

                  return (
                    <tr key={stay.id} className="hover:bg-ink/[0.02] transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-medium text-ink">{stay.guest_name}</div>
                        <div className="font-mono text-[11px] tabular-nums text-ink/45">
                          {stay.confirmation_code}
                          {stay.guest_phone ? ` · ${stay.guest_phone}` : ''}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        {stay.room_id ? (
                          <div>
                            <span className="font-mono text-xs font-semibold tabular-nums text-ink">
                              Room {stay.room_number}
                            </span>
                            <div className="text-xs text-ink/55">{stay.room_type}</div>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <div className="text-xs font-medium text-ink">
                              Unassigned · {stay.room_type}
                            </div>
                            <select
                              aria-label={`Assign room for ${stay.guest_name}`}
                              defaultValue=""
                              onChange={(e) => {
                                if (e.target.value) handleAssignRoomQuick(stay, e.target.value);
                              }}
                              className="rounded-lg border border-ink/15 bg-canvas px-2 py-1 text-[11px] text-ink"
                            >
                              <option value="">Assign room...</option>
                              {assignableRooms.map((r) => (
                                <option key={r.id} value={r.id}>
                                  Rm {r.room_number} ({r.room_type})
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 whitespace-nowrap">
                        <div className="font-mono text-xs tabular-nums text-ink">
                          {stay.check_in_date} → {stay.check_out_date}
                        </div>
                        <div className="text-[11px] text-ink/45">
                          {nights} {nights === 1 ? 'night' : 'nights'} · {currency}
                          {stay.nightly_rate.toFixed(2)}/nt
                        </div>
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="font-mono text-sm tabular-nums text-ink">
                          {currency}
                          {totalStay.toFixed(2)}
                        </div>
                        {taxEnabled && taxStay > 0 && (
                          <div className="text-[11px] text-ink/45">
                            incl. {currency}
                            {taxStay.toFixed(2)} tax
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-sm tabular-nums text-ink whitespace-nowrap">
                        {currency}
                        {stay.total_paid.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-sm font-semibold tabular-nums text-ink whitespace-nowrap">
                        {currency}
                        {balance.toFixed(2)}
                      </td>
                      <td className="py-3 px-4 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-2 text-xs font-medium">
                          <HoverTip text="Assign a clean room, confirm stay total & deposit, and check guest in.">
                            <button
                              type="button"
                              onClick={() => onRequestCheckIn(stay)}
                              className="rounded-lg bg-[#6AD4B0] px-2.5 py-1 font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                            >
                              Check In
                            </button>
                          </HoverTip>
                          <HoverTip text="Record an advance deposit against this reservation's balance.">
                            <button
                              type="button"
                              onClick={() => {
                                setDepositStay(stay);
                                setDepositAmount(balance > 0 ? balance.toFixed(2) : '');
                                setDepositMethod('card');
                                setDepositRef('');
                              }}
                              className="inline-flex items-center gap-1 rounded-lg border border-ink/15 px-2.5 py-1 text-ink/75 hover:bg-ink/[0.04]"
                            >
                              <CreditCard className="h-3 w-3" />
                              Deposit
                            </button>
                          </HoverTip>
                          <button
                            type="button"
                            onClick={() => handleCancelReservation(stay)}
                            className="text-ink/45 hover:text-ink px-1"
                          >
                            Cancel
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
      </section>

      {/* Record Deposit Modal */}
      <Modal
        open={Boolean(depositStay)}
        onClose={() => setDepositStay(null)}
        title="Record Reservation Deposit"
        subtitle={
          depositStay
            ? `${depositStay.guest_name} · ${depositStay.confirmation_code}`
            : ''
        }
      >
        <form onSubmit={handleSaveDeposit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Deposit Amount ({currency}) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Method</label>
              <select
                value={depositMethod}
                onChange={(e) => setDepositMethod(e.target.value as FolioPayment['method'])}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
              >
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Reference</label>
            <input
              type="text"
              value={depositRef}
              onChange={(e) => setDepositRef(e.target.value)}
              placeholder="e.g. DEP-VISA-1042"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDepositStay(null)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting ? 'Saving...' : 'Record Deposit'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
