import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, Lock, Plus, Search, Wrench } from 'lucide-react';
import type {
  AppCategory,
  FolioCharge,
  FolioPayment,
  FrontDeskTab,
  Guest,
  HotelSettings,
  Room,
  SplitPaymentLeg,
  StaffRole,
  Stay,
} from '../types';
import { addDaysIso } from '../utils/constants';
import { getLocalTodayIso, validateStayDates } from '../utils/dateValidation';
import { calculateTax } from '../utils/tax';
import { Drawer } from './Drawer';
import { GuestDirectoryView } from './GuestDirectoryView';
import { GuestFolioView } from './GuestFolioView';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';
import { ReservationCheckInModal, ReservationsView } from './ReservationsView';

interface FrontDeskViewProps {
  rooms: Room[];
  guests: Guest[];
  stays: Stay[];
  charges: FolioCharge[];
  payments: FolioPayment[];
  categories: AppCategory[];
  settings: HotelSettings;
  userRole: StaffRole;
  activeTab: FrontDeskTab;
  onSelectTab: (tab: FrontDeskTab) => void;
  openFolioStayId: number | null;
  onOpenFolio: (stayId: number) => void;
  onCloseFolio: () => void;
  focusedRoomId: number | null;
  onClearFocusedRoom: () => void;
  focusedGuestId: number | null;
  onClearFocusedGuest: () => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

type RoomFilter = 'all' | 'occupied' | 'available' | 'reserved' | 'housekeeping';

function todayIso(): string {
  return getLocalTodayIso();
}

function countNights(checkIn: string, checkOut: string): number {
  const start = new Date(`${checkIn}T12:00:00Z`).getTime();
  const end = new Date(`${checkOut}T12:00:00Z`).getTime();
  return Math.max(1, Math.round((end - start) / (1000 * 60 * 60 * 24)));
}

const HK_LABELS: Record<Room['housekeeping_status'], string> = {
  clean: 'Clean',
  dirty: 'Dirty',
  inspecting: 'Inspecting',
  maintenance: 'Maintenance',
};

export function FrontDeskView({
  rooms,
  guests,
  stays,
  charges,
  payments,
  categories,
  settings,
  userRole,
  activeTab,
  onSelectTab,
  openFolioStayId,
  onOpenFolio,
  onCloseFolio,
  focusedRoomId,
  onClearFocusedRoom,
  focusedGuestId,
  onClearFocusedGuest,
  authFetch,
  mutate,
}: FrontDeskViewProps) {
  const canFinancialControl =
    userRole === 'management' || userRole === 'accountant' || userRole === 'auditor';
  const canEditCatalogRates = userRole === 'management' || userRole === 'accountant';

  const [filter, setFilter] = useState<RoomFilter>('all');
  const [search, setSearch] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [checkoutStay, setCheckoutStay] = useState<Stay | null>(null);
  const [checkInReservationStay, setCheckInReservationStay] = useState<Stay | null>(null);
  const [bookingModalOpen, setBookingModalOpen] = useState(false);

  // Booking / Check-In modal state
  const [bookingGuestMode, setBookingGuestMode] = useState<'directory' | 'new'>('directory');
  const [bookingGuestId, setBookingGuestId] = useState<string>('');
  const [directoryQuery, setDirectoryQuery] = useState('');
  const [directoryDropdownOpen, setDirectoryDropdownOpen] = useState(false);
  const [confirmInHouseOverride, setConfirmInHouseOverride] = useState(false);

  const [newGuestName, setNewGuestName] = useState('');
  const [newGuestEmail, setNewGuestEmail] = useState('');
  const [newGuestPhone, setNewGuestPhone] = useState('');
  const [newGuestIdDoc, setNewGuestIdDoc] = useState('');

  // bookingRoomId can be a room id string or 'unassigned'
  const [bookingRoomId, setBookingRoomId] = useState<string>('');
  const [bookingRoomType, setBookingRoomType] = useState<string>('');
  const [bookingCheckIn, setBookingCheckIn] = useState(todayIso());
  const [bookingCheckOut, setBookingCheckOut] = useState(addDaysIso(todayIso(), 2));
  const [bookingMaxCheckOutHint, setBookingMaxCheckOutHint] = useState<string | null>(null);
  const [bookingAdults, setBookingAdults] = useState('2');
  const [bookingRate, setBookingRate] = useState('');
  const [bookingNotes, setBookingNotes] = useState('');
  const [bookingImmediate, setBookingImmediate] = useState(false);
  const [bookingDepositAmount, setBookingDepositAmount] = useState('0');
  const [bookingDepositMethod, setBookingDepositMethod] = useState<FolioPayment['method']>('card');
  const [bookingDepositRef, setBookingDepositRef] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Checkout settlement form state (Split Payments + Early Checkout + Settle Later + Overpayment Refund)
  const [checkoutLegs, setCheckoutLegs] = useState<SplitPaymentLeg[]>([
    { amount: '', method: 'card', reference: '', billing_split: 'personal' },
  ]);
  const [checkoutEarlyCredit, setCheckoutEarlyCredit] = useState(true);
  const [checkoutAllowDeferred, setCheckoutAllowDeferred] = useState(false);
  const [checkoutDeferredReason, setCheckoutDeferredReason] = useState('');
  const [checkoutDeferredDueDate, setCheckoutDeferredDueDate] = useState('');
  const [checkoutRefundAmount, setCheckoutRefundAmount] = useState('');
  const [checkoutRefundMethod, setCheckoutRefundMethod] = useState<FolioPayment['method']>('cash');
  const [checkoutRefundRef, setCheckoutRefundRef] = useState('');

  // Room inspector form state
  const [roomEditRate, setRoomEditRate] = useState('');
  const [roomEditNotes, setRoomEditNotes] = useState('');

  const today = todayIso();

  // Open focused room drawer when jumped from Global Quick Search
  useEffect(() => {
    if (focusedRoomId === null) return;
    const match = rooms.find((r) => r.id === focusedRoomId);
    if (match) {
      setSelectedRoom(match);
      setRoomEditRate(String(match.nightly_rate));
      setRoomEditNotes(match.notes);
    }
    onClearFocusedRoom();
  }, [focusedRoomId, rooms, onClearFocusedRoom]);

  // Unique room types + representative nightly rate for unassigned reservations
  const roomTypeCatalog = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of rooms) {
      if (!map.has(r.room_type)) {
        map.set(r.room_type, r.nightly_rate);
      }
    }
    return Array.from(map.entries()).map(([type, rate]) => ({ type, rate }));
  }, [rooms]);

  const activeStayByRoom = useMemo(() => {
    const map = new Map<number, Stay>();
    for (const s of stays) {
      if (s.status === 'checked_in' && s.room_id !== null) {
        map.set(s.room_id, s);
      }
    }
    return map;
  }, [stays]);

  // Earliest upcoming reservation per room (sorted by check_in_date)
  const nextReservationByRoom = useMemo(() => {
    const map = new Map<number, Stay>();
    const reserved = stays
      .filter((s) => s.status === 'reserved' && s.room_id !== null)
      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date));
    for (const s of reserved) {
      if (s.room_id !== null && !map.has(s.room_id)) {
        map.set(s.room_id, s);
      }
    }
    return map;
  }, [stays]);

  // Active in-house stay by guest ID (for warning when checking in an already in-house guest)
  const inHouseStayByGuestId = useMemo(() => {
    const map = new Map<number, Stay>();
    for (const s of stays) {
      if (s.status === 'checked_in' && !map.has(s.guest_id)) {
        map.set(s.guest_id, s);
      }
    }
    return map;
  }, [stays]);

  function openBookingModal(options?: {
    room?: Room;
    guest?: Guest;
    immediate?: boolean;
    checkInDate?: string;
    maxCheckOutDate?: string;
  }) {
    const wantsImmediate = Boolean(options?.immediate);
    const defaultRoom =
      options?.room ??
      rooms.find((r) => !activeStayByRoom.has(r.id) && r.housekeeping_status === 'clean') ??
      (wantsImmediate ? undefined : rooms[0]);

    const startDate = options?.checkInDate ?? todayIso();
    let defaultEndDate = addDaysIso(startDate, 2);
    if (options?.maxCheckOutDate && options.maxCheckOutDate > startDate && options.maxCheckOutDate < defaultEndDate) {
      defaultEndDate = options.maxCheckOutDate;
    }

    setBookingRoomId(defaultRoom ? String(defaultRoom.id) : wantsImmediate ? '' : 'unassigned');
    setBookingRoomType(defaultRoom?.room_type ?? roomTypeCatalog[0]?.type ?? '');
    setBookingRate(
      defaultRoom
        ? String(defaultRoom.nightly_rate)
        : roomTypeCatalog[0]
          ? String(roomTypeCatalog[0].rate)
          : ''
    );
    setBookingMaxCheckOutHint(options?.maxCheckOutDate ?? null);

    if (options?.guest) {
      setBookingGuestMode('directory');
      setBookingGuestId(String(options.guest.id));
      setDirectoryQuery(options.guest.full_name);
      setDirectoryDropdownOpen(false);
    } else {
      setBookingGuestMode(guests.length > 0 ? 'directory' : 'new');
      setBookingGuestId('');
      setDirectoryQuery('');
      setDirectoryDropdownOpen(false);
    }

    setConfirmInHouseOverride(false);
    setBookingCheckIn(startDate);
    setBookingCheckOut(defaultEndDate);
    setBookingAdults('2');
    setBookingNotes('');
    setBookingImmediate(Boolean(options?.immediate));
    setBookingDepositAmount('0');
    setBookingDepositMethod('card');
    setBookingDepositRef('');
    setNewGuestName('');
    setNewGuestEmail('');
    setNewGuestPhone('');
    setNewGuestIdDoc('');
    setSelectedRoom(null);
    setBookingModalOpen(true);
  }

  const metrics = useMemo(() => {
    const occupied = rooms.filter((r) => activeStayByRoom.has(r.id)).length;
    const readyAvailable = rooms.filter(
      (r) => !activeStayByRoom.has(r.id) && r.housekeeping_status === 'clean'
    ).length;
    const arrivals = stays.filter((s) => s.status === 'reserved').length;
    const hkAttention = rooms.filter((r) => r.housekeeping_status !== 'clean').length;
    return { occupied, readyAvailable, arrivals, hkAttention };
  }, [rooms, activeStayByRoom, stays]);

  const filteredRooms = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rooms.filter((room) => {
      const activeStay = activeStayByRoom.get(room.id);
      const reservedStay = nextReservationByRoom.get(room.id);

      if (filter === 'occupied' && !activeStay) return false;
      if (filter === 'available' && (activeStay || room.housekeeping_status === 'maintenance')) return false;
      if (filter === 'reserved' && !reservedStay) return false;
      if (filter === 'housekeeping' && room.housekeeping_status === 'clean') return false;

      if (!q) return true;
      return (
        room.room_number.toLowerCase().includes(q) ||
        room.room_type.toLowerCase().includes(q) ||
        (activeStay?.guest_name.toLowerCase().includes(q) ?? false) ||
        (reservedStay?.guest_name.toLowerCase().includes(q) ?? false)
      );
    });
  }, [rooms, activeStayByRoom, nextReservationByRoom, filter, search]);

  const roomsByFloor = useMemo(() => {
    const groups = new Map<number, Room[]>();
    for (const r of filteredRooms) {
      const list = groups.get(r.floor) ?? [];
      list.push(r);
      groups.set(r.floor, list);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0] - b[0]);
  }, [filteredRooms]);

  const activeQueueStays = useMemo(
    () => stays.filter((s) => s.status === 'reserved' || s.status === 'checked_in'),
    [stays]
  );

  // Live filtered Directory list for Check-In modal type-ahead combobox
  const filteredDirectoryGuests = useMemo(() => {
    const q = directoryQuery.trim().toLowerCase();
    if (!q) return guests.slice(0, 12);
    return guests
      .filter(
        (g) =>
          g.full_name.toLowerCase().includes(q) ||
          g.email.toLowerCase().includes(q) ||
          g.phone.toLowerCase().includes(q) ||
          g.id_number.toLowerCase().includes(q)
      )
      .slice(0, 12);
  }, [guests, directoryQuery]);

  const selectedDirectoryGuest = useMemo(
    () => guests.find((g) => String(g.id) === bookingGuestId) ?? null,
    [guests, bookingGuestId]
  );

  const selectedGuestActiveStay = useMemo(() => {
    if (bookingGuestMode !== 'directory' || !selectedDirectoryGuest) return null;
    return inHouseStayByGuestId.get(selectedDirectoryGuest.id) ?? null;
  }, [bookingGuestMode, selectedDirectoryGuest, inHouseStayByGuestId]);

  // Live stay pricing + tax calculation BEFORE submitting Check-In / Reservation
  const bookingNights = useMemo(
    () => countNights(bookingCheckIn, bookingCheckOut),
    [bookingCheckIn, bookingCheckOut]
  );
  const bookingNightlyRateNum = Math.max(0, Number(bookingRate) || 0);
  const bookingTaxPreview = useMemo(
    () => calculateTax(bookingNights * bookingNightlyRateNum, 'accommodation', settings),
    [bookingNights, bookingNightlyRateNum, settings]
  );
  const bookingDepositNum = Math.max(0, Number(bookingDepositAmount) || 0);
  const bookingBalanceRemaining = Math.max(
    0,
    Math.round((bookingTaxPreview.totalAmount - bookingDepositNum) * 100) / 100
  );

  // Check if selected room has a future reservation warning for the chosen check-in date
  const selectedRoomNextReservation = useMemo(() => {
    if (!bookingRoomId || bookingRoomId === 'unassigned') return null;
    const rid = Number(bookingRoomId);
    const future = stays
      .filter(
        (s) =>
          s.status === 'reserved' &&
          s.room_id === rid &&
          s.check_in_date > bookingCheckIn
      )
      .sort((a, b) => a.check_in_date.localeCompare(b.check_in_date))[0];
    return future ?? null;
  }, [bookingRoomId, bookingCheckIn, stays]);

  function openRoomInspector(room: Room) {
    setSelectedRoom(room);
    setRoomEditRate(String(room.nightly_rate));
    setRoomEditNotes(room.notes);
  }

  function computeEarlyUnusedNights(stay: Stay): number {
    if (today >= stay.check_out_date) return 0;
    const effectiveOut = today <= stay.check_in_date ? addDaysIso(stay.check_in_date, 1) : today;
    if (effectiveOut >= stay.check_out_date) return 0;
    const planned = countNights(stay.check_in_date, stay.check_out_date);
    const actual = countNights(stay.check_in_date, effectiveOut);
    return Math.max(0, planned - actual);
  }

  function openCheckoutSheet(stay: Stay) {
    const unusedNights = computeEarlyUnusedNights(stay);
    const allowEarlyCredit = canFinancialControl && unusedNights > 0;
    const creditCalc = allowEarlyCredit
      ? calculateTax(unusedNights * stay.nightly_rate, 'accommodation', settings)
      : null;
    const adjustedBalance =
      allowEarlyCredit && creditCalc
        ? Math.round((stay.balance_due - creditCalc.totalAmount) * 100) / 100
        : stay.balance_due;

    setCheckoutStay(stay);
    setCheckoutEarlyCredit(allowEarlyCredit);
    setCheckoutAllowDeferred(false);
    setCheckoutDeferredReason('');
    setCheckoutDeferredDueDate('');
    setCheckoutLegs([
      {
        amount: adjustedBalance > 0 ? adjustedBalance.toFixed(2) : '0.00',
        method: 'card',
        reference: '',
        billing_split: 'personal',
      },
    ]);
    setCheckoutRefundAmount(
      canFinancialControl && adjustedBalance < 0 ? Math.abs(adjustedBalance).toFixed(2) : ''
    );
    setCheckoutRefundMethod('cash');
    setCheckoutRefundRef('');
  }

  const selectedBookingRoom = useMemo(
    () => (bookingRoomId && bookingRoomId !== 'unassigned' ? rooms.find((r) => String(r.id) === bookingRoomId) ?? null : null),
    [rooms, bookingRoomId]
  );
  const isSelectedBookingRoomUnclean = Boolean(
    selectedBookingRoom && selectedBookingRoom.housekeeping_status !== 'clean'
  );
  const bookingDateError = useMemo(
    () =>
      validateStayDates(bookingCheckIn, bookingCheckOut, {
        allowPastCheckIn: bookingImmediate,
        maxCheckOutDate:
          selectedRoomNextReservation?.check_in_date ?? bookingMaxCheckOutHint ?? undefined,
      }),
    [
      bookingCheckIn,
      bookingCheckOut,
      bookingImmediate,
      selectedRoomNextReservation,
      bookingMaxCheckOutHint,
    ]
  );

  async function handleCreateBooking(e: React.FormEvent) {
    e.preventDefault();
    if (bookingDateError) return;
    if (bookingGuestMode === 'directory' && !bookingGuestId) return;
    if (selectedGuestActiveStay && !confirmInHouseOverride) return;
    if (bookingImmediate && (!selectedBookingRoom || selectedBookingRoom.housekeeping_status !== 'clean')) return;

    setSubmitting(true);
    try {
      let guestIdToUse = Number(bookingGuestId);

      if (bookingGuestMode === 'new') {
        const created = await mutate<{ guest: Guest }>('/api/guests', 'POST', {
          full_name: newGuestName,
          email: newGuestEmail,
          phone: newGuestPhone,
          id_number: newGuestIdDoc,
        });
        if (!created?.guest) return;
        guestIdToUse = created.guest.id;
      }

      const isUnassigned = !bookingImmediate && bookingRoomId === 'unassigned';
      const result = await mutate(
        '/api/stays',
        'POST',
        {
          guest_id: guestIdToUse,
          room_id: isUnassigned ? null : Number(bookingRoomId),
          room_type: isUnassigned ? bookingRoomType : undefined,
          check_in_date: bookingCheckIn,
          check_out_date: bookingCheckOut,
          adults: Number(bookingAdults) || 1,
          nightly_rate: canFinancialControl && bookingRate ? Number(bookingRate) : undefined,
          notes: bookingNotes,
          immediate_check_in: bookingImmediate,
          deposit_amount: bookingDepositNum > 0 ? bookingDepositNum : 0,
          deposit_method: bookingDepositMethod,
          deposit_reference: bookingDepositRef,
        },
        bookingImmediate ? 'Guest checked in and folio opened' : 'Reservation created'
      );

      if (result) {
        setBookingModalOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateRoomStatus(room: Room, status: Room['housekeeping_status']) {
    await mutate(
      `/api/rooms/${room.id}`,
      'PATCH',
      { housekeeping_status: status },
      `Room ${room.room_number} marked ${HK_LABELS[status]}`
    );
    setSelectedRoom((prev) => (prev && prev.id === room.id ? { ...prev, housekeeping_status: status } : prev));
  }

  async function handleSaveRoomDetails(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRoom) return;
    const payload: Record<string, unknown> = { notes: roomEditNotes };
    if (canEditCatalogRates) {
      payload.nightly_rate = Number(roomEditRate);
    }
    const ok = await mutate(
      `/api/rooms/${selectedRoom.id}`,
      'PATCH',
      payload,
      `Room ${selectedRoom.room_number} updated`
    );
    if (ok) setSelectedRoom(null);
  }

  const checkoutUnusedNights = useMemo(
    () => (checkoutStay ? computeEarlyUnusedNights(checkoutStay) : 0),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [checkoutStay, today]
  );

  const checkoutEarlyCreditCalc = useMemo(() => {
    if (!checkoutStay || checkoutUnusedNights <= 0) return null;
    return calculateTax(checkoutUnusedNights * checkoutStay.nightly_rate, 'accommodation', settings);
  }, [checkoutStay, checkoutUnusedNights, settings]);

  const checkoutNetBalance = useMemo(() => {
    if (!checkoutStay) return 0;
    const credit =
      checkoutEarlyCredit && checkoutEarlyCreditCalc ? checkoutEarlyCreditCalc.totalAmount : 0;
    return Math.round((checkoutStay.balance_due - credit) * 100) / 100;
  }, [checkoutStay, checkoutEarlyCredit, checkoutEarlyCreditCalc]);

  function toggleEarlyCredit(next: boolean) {
    setCheckoutEarlyCredit(next);
    if (!checkoutStay) return;
    const credit = next && checkoutEarlyCreditCalc ? checkoutEarlyCreditCalc.totalAmount : 0;
    const net = Math.round((checkoutStay.balance_due - credit) * 100) / 100;
    setCheckoutLegs([
      {
        amount: net > 0 ? net.toFixed(2) : '0.00',
        method: checkoutLegs[0]?.method ?? 'card',
        reference: checkoutLegs[0]?.reference ?? '',
        billing_split: 'personal',
      },
    ]);
    setCheckoutRefundAmount(net < 0 ? Math.abs(net).toFixed(2) : '');
  }

  function addCheckoutLeg() {
    const entered = checkoutLegs.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const rem = Math.max(0, Math.round((checkoutNetBalance - entered) * 100) / 100);
    const nextMethod: FolioPayment['method'] =
      checkoutLegs[checkoutLegs.length - 1]?.method === 'card' ? 'cash' : 'bank_transfer';
    setCheckoutLegs((prev) => [
      ...prev,
      { amount: rem > 0 ? rem.toFixed(2) : '', method: nextMethod, reference: '', billing_split: 'personal' },
    ]);
  }

  const checkoutPaymentsTotal = useMemo(
    () =>
      Math.round(
        checkoutLegs.reduce((sum, l) => sum + Math.max(0, Number(l.amount) || 0), 0) * 100
      ) / 100,
    [checkoutLegs]
  );

  const checkoutRemainingAfterPayment = useMemo(
    () => Math.round((checkoutNetBalance - checkoutPaymentsTotal) * 100) / 100,
    [checkoutNetBalance, checkoutPaymentsTotal]
  );

  const hasUnpaidCheckoutBalance = checkoutRemainingAfterPayment > 0.01;
  const canAuthorizeDeferredSettlement = canEditCatalogRates; // Management or Accountant only
  const isCheckoutBlockedForRole = hasUnpaidCheckoutBalance && !canAuthorizeDeferredSettlement;
  const isCheckoutMissingDeferredAuth =
    hasUnpaidCheckoutBalance &&
    canAuthorizeDeferredSettlement &&
    (!checkoutAllowDeferred || checkoutDeferredReason.trim().length < 4);

  async function handleCheckOut(e: React.FormEvent) {
    e.preventDefault();
    if (!checkoutStay) return;
    if (isCheckoutBlockedForRole || isCheckoutMissingDeferredAuth) return;
    setSubmitting(true);
    try {
      const validPayments = checkoutLegs
        .map((l) => ({
          amount: Number(l.amount) || 0,
          method: l.method,
          reference: l.reference.trim(),
          billing_split: l.billing_split ?? 'personal',
        }))
        .filter((l) => l.amount > 0);
      const refundAmt = canFinancialControl ? Number(checkoutRefundAmount) || 0 : 0;
      const refundPayload =
        canFinancialControl && refundAmt > 0
          ? {
              amount: refundAmt,
              method: checkoutRefundMethod,
              reference: checkoutRefundRef.trim() || 'Checkout Refund',
            }
          : undefined;

      const deferredPayload =
        hasUnpaidCheckoutBalance && canAuthorizeDeferredSettlement && checkoutAllowDeferred
          ? {
              allow_deferred_settlement: true,
              deferred_reason: checkoutDeferredReason.trim(),
              deferred_due_date: checkoutDeferredDueDate.trim(),
            }
          : {};

      const isEarly = checkoutUnusedNights > 0;
      const endpoint = isEarly
        ? `/api/stays/${checkoutStay.id}/early-checkout`
        : `/api/stays/${checkoutStay.id}/checkout`;
      const body = isEarly
        ? {
            actual_checkout_date: today,
            refund_unused_nights: canFinancialControl ? checkoutEarlyCredit : false,
            payments: validPayments,
            refund: refundPayload,
            ...deferredPayload,
          }
        : {
            payments: validPayments,
            refund: refundPayload,
            ...deferredPayload,
          };

      const ok = await mutate(
        endpoint,
        'POST',
        body,
        hasUnpaidCheckoutBalance
          ? `${checkoutStay.guest_name} checked out with Settle Later balance (${currency}${checkoutRemainingAfterPayment.toFixed(2)})`
          : `${checkoutStay.guest_name} checked out of Room ${checkoutStay.room_number}`
      );
      if (ok) {
        setCheckoutStay(null);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancelReservation(stay: Stay) {
    await mutate(`/api/stays/${stay.id}/cancel`, 'POST', {}, `Reservation ${stay.confirmation_code} cancelled`);
  }

  const currency = settings.currency_symbol;

  const checkoutModalElement = (
    <Modal
      open={Boolean(checkoutStay)}
      onClose={() => setCheckoutStay(null)}
      title={
        checkoutStay
          ? `${checkoutUnusedNights > 0 ? 'Early Check-Out' : 'Check Out'} · ${checkoutStay.guest_name}`
          : ''
      }
      subtitle={
        checkoutStay ? `Room ${checkoutStay.room_number} · ${checkoutStay.confirmation_code}` : ''
      }
      maxWidthClass="max-w-lg"
    >
      {checkoutStay && (
        <form onSubmit={handleCheckOut} className="space-y-4">
          {checkoutUnusedNights > 0 && checkoutEarlyCreditCalc && (
            canFinancialControl ? (
              <label className="flex items-start gap-2.5 rounded-xl border border-[#6AD4B0]/50 bg-[#6AD4B0]/12 p-3 text-xs cursor-pointer">
                <input
                  type="checkbox"
                  checked={checkoutEarlyCredit}
                  onChange={(e) => toggleEarlyCredit(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded accent-[#6AD4B0]"
                />
                <span className="text-ink">
                  <strong className="font-semibold">
                    Credit {checkoutUnusedNights} unused {checkoutUnusedNights === 1 ? 'night' : 'nights'}
                  </strong>{' '}
                  (planned checkout {checkoutStay.check_out_date}) — posts an automatic{' '}
                  <strong className="font-mono">
                    −{currency}
                    {checkoutEarlyCreditCalc.totalAmount.toFixed(2)}
                  </strong>{' '}
                  credit note.
                </span>
              </label>
            ) : (
              <HoverTip text="Early check-out unused-nights credit notes are locked to Management, Accountant, and Auditor accounts.">
                <div className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.03] p-3 text-xs text-ink/60 opacity-60 cursor-not-allowed select-none">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/55" />
                  <span>
                    <strong className="font-semibold text-ink/75">
                      Credit {checkoutUnusedNights} unused {checkoutUnusedNights === 1 ? 'night' : 'nights'} (Locked)
                    </strong>{' '}
                    — Issuing an early-checkout credit note requires Management, Accountant, or Auditor authorization.
                  </span>
                </div>
              </HoverTip>
            )
          )}

          <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-4 space-y-1.5 text-xs">
            <div className="flex justify-between text-ink/65">
              <span>{settings.tax_enabled === 1 ? 'Total Billed (incl. tax)' : 'Total Billed'}</span>
              <span className="font-mono tabular-nums text-ink">
                {currency}
                {checkoutStay.total_billed.toFixed(2)}
              </span>
            </div>
            {checkoutEarlyCredit && checkoutEarlyCreditCalc && (
              <div className="flex justify-between text-accent-ink">
                <span>Early Checkout Credit ({checkoutUnusedNights} nt)</span>
                <span className="font-mono tabular-nums">
                  −{currency}
                  {checkoutEarlyCreditCalc.totalAmount.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between text-ink/65">
              <span>Total Paid</span>
              <span className="font-mono tabular-nums text-ink">
                {currency}
                {checkoutStay.total_paid.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between border-t border-ink/10 pt-2 text-sm font-semibold text-ink">
              <span>{checkoutNetBalance < 0 ? 'Overpayment Credit' : 'Balance Due'}</span>
              <span
                className={`font-mono tabular-nums ${
                  checkoutNetBalance > 0
                    ? 'text-danger-ink'
                    : checkoutNetBalance < 0
                      ? 'text-accent-ink'
                      : 'text-ink'
                }`}
              >
                {checkoutNetBalance < 0 ? '−' : ''}
                {currency}
                {Math.abs(checkoutNetBalance).toFixed(2)}
              </span>
            </div>
          </div>

          {checkoutNetBalance >= 0 ? (
            <div className="space-y-2.5">
              {checkoutLegs.map((leg, idx) => (
                <div key={idx} className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">
                      {checkoutLegs.length > 1 ? `Final Payment #${idx + 1}` : 'Final Payment'}
                    </span>
                    {checkoutLegs.length > 1 && (
                      <button
                        type="button"
                        onClick={() =>
                          setCheckoutLegs((prev) => prev.filter((_, i) => i !== idx))
                        }
                        className="text-xs font-medium text-danger-ink hover:underline"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[11px] font-medium text-ink/60 mb-1">
                        Amount ({currency})
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        value={leg.amount}
                        onChange={(e) =>
                          setCheckoutLegs((prev) =>
                            prev.map((l, i) => (i === idx ? { ...l, amount: e.target.value } : l))
                          )
                        }
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 font-mono text-sm tabular-nums text-ink"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-medium text-ink/60 mb-1">Method</label>
                      <select
                        value={leg.method}
                        onChange={(e) =>
                          setCheckoutLegs((prev) =>
                            prev.map((l, i) =>
                              i === idx
                                ? { ...l, method: e.target.value as FolioPayment['method'] }
                                : l
                            )
                          )
                        }
                        className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
                      >
                        <option value="card">Card</option>
                        <option value="cash">Cash</option>
                        <option value="bank_transfer">Bank Transfer</option>
                        <option value="corporate">Corporate</option>
                      </select>
                    </div>
                  </div>
                  <input
                    type="text"
                    value={leg.reference}
                    onChange={(e) =>
                      setCheckoutLegs((prev) =>
                        prev.map((l, i) => (i === idx ? { ...l, reference: e.target.value } : l))
                      )
                    }
                    placeholder="Receipt or authorization code"
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
                  />
                </div>
              ))}

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={addCheckoutLeg}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4 hover:opacity-80"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Split Payment Across Methods
                </button>
                {canAuthorizeDeferredSettlement && checkoutNetBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const stayId = checkoutStay.id;
                      setCheckoutStay(null);
                      onOpenFolio(stayId);
                    }}
                    className="text-xs font-medium text-ink/65 hover:text-ink underline underline-offset-4"
                  >
                    Waive Room / Food Bill in Folio →
                  </button>
                )}
              </div>

              {/* Settle Later (Pay After Check-Out) Authorization — Management & Accountant ONLY */}
              {checkoutNetBalance > 0 && (
                canAuthorizeDeferredSettlement ? (
                  <div
                    className={`rounded-xl border p-3.5 space-y-3 transition-colors ${
                      checkoutAllowDeferred
                        ? 'border-[#E05252]/40 bg-[#E05252]/[0.04]'
                        : 'border-ink/12 bg-ink/[0.02]'
                    }`}
                  >
                    <label className="flex items-start gap-2.5 text-xs cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checkoutAllowDeferred}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setCheckoutAllowDeferred(checked);
                          if (checked) {
                            setCheckoutLegs([
                              { amount: '0.00', method: 'card', reference: '', billing_split: 'personal' },
                            ]);
                          } else {
                            setCheckoutLegs([
                              {
                                amount: checkoutNetBalance > 0 ? checkoutNetBalance.toFixed(2) : '0.00',
                                method: 'card',
                                reference: '',
                                billing_split: 'personal',
                              },
                            ]);
                          }
                        }}
                        className="mt-0.5 h-4 w-4 rounded accent-[#6AD4B0]"
                      />
                      <span className="text-ink">
                        <strong className="font-semibold">
                          Allow Unpaid Check-Out (Settle Later / City Ledger)
                        </strong>
                        <span className="block text-[11px] text-ink/60 mt-0.5">
                          Release the room now and keep the remaining balance open in Finance so an Accountant can record payment or waive it later.
                        </span>
                      </span>
                    </label>

                    {checkoutAllowDeferred && (
                      <div className="space-y-2.5 pt-1">
                        <div>
                          <label className="block text-[11px] font-medium text-ink/65 mb-1">
                            Authorization Reason / Guarantor Note *
                          </label>
                          <input
                            type="text"
                            required={hasUnpaidCheckoutBalance}
                            value={checkoutDeferredReason}
                            onChange={(e) => setCheckoutDeferredReason(e.target.value)}
                            placeholder="e.g. Friend of owner — paying by bank transfer on Friday"
                            className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
                          />
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 items-end">
                          <div>
                            <label className="block text-[11px] font-medium text-ink/65 mb-1">
                              Expected Settlement Date (Optional)
                            </label>
                            <input
                              type="date"
                              min={today}
                              value={checkoutDeferredDueDate}
                              onChange={(e) => setCheckoutDeferredDueDate(e.target.value)}
                              className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 font-mono text-xs tabular-nums text-ink"
                            />
                          </div>
                          <div className="rounded-lg border border-[#E05252]/25 bg-surface px-3 py-2 text-xs">
                            <span className="text-ink/55">Balance Carried Open: </span>
                            <strong className="font-mono tabular-nums text-danger-ink">
                              {currency}
                              {Math.max(0, checkoutRemainingAfterPayment).toFixed(2)}
                            </strong>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <HoverTip text="Allowing a guest to check out with an unpaid balance (Settle Later) is locked to Management and Accountant accounts.">
                    <div className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.03] p-3 text-xs text-ink/60 opacity-60 cursor-not-allowed select-none">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/55" />
                      <span>
                        <strong className="font-semibold text-ink/75">
                          Settle Later (Unpaid Check-Out) · Locked
                        </strong>
                        <span className="block text-[11px] text-ink/55 mt-0.5">
                          Only Management or Accountant can authorize checking out with an unpaid balance or waiving the bill.
                        </span>
                      </span>
                    </div>
                  </HoverTip>
                )
              )}
            </div>
          ) : canFinancialControl ? (
            <div className="rounded-xl border border-[#E05252]/30 bg-[#E05252]/[0.05] p-3.5 space-y-2.5">
              <div className="text-xs font-semibold text-danger-ink">
                Optional Overpayment Refund to Guest
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label className="block text-[11px] font-medium text-ink/60 mb-1">
                    Refund ({currency})
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={checkoutRefundAmount}
                    onChange={(e) => setCheckoutRefundAmount(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 font-mono text-sm tabular-nums text-ink"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-ink/60 mb-1">Method</label>
                  <select
                    value={checkoutRefundMethod}
                    onChange={(e) =>
                      setCheckoutRefundMethod(e.target.value as FolioPayment['method'])
                    }
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
                  >
                    <option value="cash">Cash</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="card">Card Reversal</option>
                    <option value="corporate">Corporate</option>
                  </select>
                </div>
              </div>
              <input
                type="text"
                value={checkoutRefundRef}
                onChange={(e) => setCheckoutRefundRef(e.target.value)}
                placeholder="Refund receipt / transfer ref"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
              />
            </div>
          ) : (
            <HoverTip text="Issuing guest cash/card refunds is locked to Management, Accountant, and Auditor accounts.">
              <div className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.03] p-3.5 text-xs text-ink/60 opacity-60 cursor-not-allowed select-none">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/55" />
                <span>
                  This folio carries an overpayment credit of{' '}
                  <strong className="font-mono text-ink/80">
                    {currency}
                    {Math.abs(checkoutNetBalance).toFixed(2)}
                  </strong>
                  . Issuing a guest refund is locked to Management, Accountant, or Auditor accounts.
                </span>
              </div>
            </HoverTip>
          )}

          {isCheckoutBlockedForRole && (
            <div className="flex items-start gap-2 rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.06] px-3.5 py-2.5 text-xs text-danger-ink">
              <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                Remaining unpaid balance of{' '}
                <strong className="font-mono">
                  {currency}
                  {checkoutRemainingAfterPayment.toFixed(2)}
                </strong>
                . Collect full payment to complete check-out, or ask Management / Accountant to authorize Settle Later or Waive Bill.
              </span>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
            <button
              type="button"
              onClick={() => setCheckoutStay(null)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <HoverTip
              text={
                isCheckoutBlockedForRole
                  ? 'Unpaid check-out is blocked for your role. Collect full payment or ask Management/Accountant to authorize Settle Later.'
                  : isCheckoutMissingDeferredAuth
                    ? 'Tick "Allow Unpaid Check-Out (Settle Later)" and enter a reason (min 4 characters), or collect the remaining balance.'
                    : `Settles checkout, marks Room ${checkoutStay.room_number} Dirty for housekeeping, and emails receipt if Email Service is enabled.`
              }
            >
              <button
                type="submit"
                disabled={submitting || isCheckoutBlockedForRole || isCheckoutMissingDeferredAuth}
                className={`inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-opacity ${
                  isCheckoutBlockedForRole || isCheckoutMissingDeferredAuth
                    ? 'opacity-45 cursor-not-allowed'
                    : 'disabled:opacity-50'
                }`}
              >
                {isCheckoutBlockedForRole && <Lock className="h-3.5 w-3.5" />}
                {submitting
                  ? 'Completing...'
                  : hasUnpaidCheckoutBalance && canAuthorizeDeferredSettlement && checkoutAllowDeferred
                    ? 'Check Out (Settle Later)'
                    : 'Complete Check-Out'}
              </button>
            </HoverTip>
          </div>
        </form>
      )}
    </Modal>
  );

  const openFolioStay = useMemo(
    () => (openFolioStayId !== null ? stays.find((s) => s.id === openFolioStayId) ?? null : null),
    [openFolioStayId, stays]
  );

  const voidReasonPresets = useMemo(
    () =>
      categories
        .filter((c) => c.kind === 'void_reason' && c.active === 1)
        .map((c) => c.name),
    [categories]
  );

  // SINGLE FOLIO DRILL-DOWN VIEW (accessible only via Open Folio on room card / stay row, shows ONLY that folio)
  if (openFolioStayId !== null) {
    return (
      <>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-5 lg:px-7">
          <GuestFolioView
            stay={openFolioStay}
            rooms={rooms}
            stays={stays}
            charges={charges}
            payments={payments}
            settings={settings}
            userRole={userRole}
            voidReasonPresets={voidReasonPresets}
            onBack={onCloseFolio}
            onRequestCheckOut={(stay) => openCheckoutSheet(stay)}
            mutate={mutate}
          />
        </div>
        {checkoutModalElement}
      </>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {/* Fixed Front Desk Sub-Navigation Tabs: Dashboard, Room Board, Reservations, Guest Directory */}
      <div className="no-print shrink-0 bg-canvas border-b border-ink/10 px-4 pt-4 md:px-5 md:pt-5 lg:px-7 lg:pt-6 overflow-x-auto no-scrollbar">
        <div role="tablist" aria-label="Front Desk sections" className="flex items-center gap-5 sm:gap-6 min-w-max">
          {(
            [
              ['dashboard', 'Dashboard'],
              ['room_board', 'Room Board'],
              ['reservations', 'Reservations'],
              ['directory', 'Guest Directory'],
            ] as Array<[FrontDeskTab, string]>
          ).map(([tabId, label]) => {
            const active = activeTab === tabId;
            return (
              <button
                key={tabId}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectTab(tabId)}
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

      {/* Scrollable Front Desk Tab Content */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-5 lg:px-7 space-y-6">
      {/* TAB 1: DASHBOARD (KPIs + In-House Guests & Arrivals) */}
      {activeTab === 'dashboard' && (
        <div className="space-y-8">
          <section
            aria-label="Front desk summary"
            className="grid grid-cols-2 lg:grid-cols-4 border-y border-ink/10 divide-y lg:divide-y-0 lg:divide-x divide-ink/10"
          >
            <div className="py-4 pr-6">
              <div className="text-xs font-medium text-ink/55">Occupied Rooms</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                  {metrics.occupied}
                </span>
                <span className="font-mono text-xs tabular-nums text-ink/45">
                  / {rooms.length} total
                </span>
              </div>
              <div className="mt-1.5 h-1 w-10 rounded-full bg-[#6AD4B0]" />
            </div>
            <div className="py-4 lg:px-6">
              <div className="text-xs font-medium text-ink/55">Available &amp; Clean</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                  {metrics.readyAvailable}
                </span>
                <span className="text-xs text-ink/45">ready for check-in</span>
              </div>
            </div>
            <div className="py-4 pr-6 lg:px-6">
              <div className="text-xs font-medium text-ink/55">Upcoming Arrivals</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-mono text-2xl font-semibold tabular-nums text-ink">
                  {metrics.arrivals}
                </span>
                <span className="text-xs text-ink/45">confirmed bookings</span>
              </div>
            </div>
            <div className="py-4 lg:pl-6">
              <div className="text-xs font-medium text-ink/55">Housekeeping Attention</div>
              <div className="mt-1.5 flex items-baseline gap-2">
                <span
                  className={`font-mono text-2xl font-semibold tabular-nums ${
                    metrics.hkAttention > 0 ? 'text-danger-ink' : 'text-ink'
                  }`}
                >
                  {metrics.hkAttention}
                </span>
                <span className="text-xs text-ink/45">dirty, inspecting, or maintenance</span>
              </div>
              {metrics.hkAttention > 0 && (
                <div className="mt-1.5 h-1 w-10 rounded-full bg-[#E05252]" />
              )}
            </div>
          </section>

          <section aria-label="In-house and upcoming stays" className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-ink">In-House Guests &amp; Arrivals</h2>
            </div>

            <div className="overflow-x-auto rounded-2xl border border-ink/10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                    <th className="py-3 px-4">Confirmation</th>
                    <th className="py-3 px-4">Guest</th>
                    <th className="py-3 px-4">Room</th>
                    <th className="py-3 px-4">Stay Dates</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Balance Due</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8 text-sm">
                  {activeQueueStays.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
                        <p className="text-sm text-ink/50">No active stays or arrivals today.</p>
                        <button
                          type="button"
                          onClick={() => openBookingModal({ immediate: false })}
                          className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          New Reservation
                        </button>
                      </td>
                    </tr>
                  ) : (
                    activeQueueStays.map((stay) => (
                      <tr key={stay.id} className="hover:bg-ink/[0.02] transition-colors">
                        <td className="py-3 px-4 font-mono text-xs tabular-nums text-ink/70 whitespace-nowrap">
                          {stay.confirmation_code}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-ink">{stay.guest_name}</div>
                          <div className="text-xs text-ink/50">
                            {stay.guest_email || stay.guest_phone || 'No contact'}
                          </div>
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span className="font-mono font-medium tabular-nums text-ink">
                            {stay.room_id ? stay.room_number : 'Unassigned'}
                          </span>
                          <span className="text-xs text-ink/50"> · {stay.room_type}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-xs tabular-nums text-ink/70 whitespace-nowrap">
                          {stay.check_in_date} → {stay.check_out_date}
                        </td>
                        <td className="py-3 px-4 text-xs font-medium whitespace-nowrap">
                          <span className="inline-flex items-center gap-1.5 text-ink">
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${
                                stay.status === 'checked_in' ? 'bg-[#6AD4B0]' : 'bg-ink/40'
                              }`}
                            />
                            {stay.status === 'checked_in' ? 'Checked In' : 'Reserved'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-sm tabular-nums whitespace-nowrap">
                          {currency}
                          {stay.balance_due.toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2.5 text-xs font-medium">
                            {stay.status === 'reserved' ? (
                              <>
                                <HoverTip text="Assign a clean room, verify deposit and balance, and check guest in.">
                                  <button
                                    type="button"
                                    onClick={() => setCheckInReservationStay(stay)}
                                    className="rounded-lg bg-[#6AD4B0] px-2.5 py-1 font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
                                  >
                                    Check In
                                  </button>
                                </HoverTip>
                                <button
                                  type="button"
                                  onClick={() => handleCancelReservation(stay)}
                                  className="text-ink/50 hover:text-ink"
                                >
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <HoverTip text="View guest charges, post manual items, record payments, or print invoice.">
                                  <button
                                    type="button"
                                    onClick={() => onOpenFolio(stay.id)}
                                    className="rounded-lg bg-[#6AD4B0]/25 px-2.5 py-1 font-semibold text-ink hover:bg-[#6AD4B0]/45"
                                  >
                                    Open Folio
                                  </button>
                                </HoverTip>
                                <HoverTip text="Settle remaining balance and release room to housekeeping.">
                                  <button
                                    type="button"
                                    onClick={() => openCheckoutSheet(stay)}
                                    className="text-ink/70 hover:text-ink"
                                  >
                                    Check Out
                                  </button>
                                </HoverTip>
                              </>
                            )}
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

      {/* TAB 2: ROOM BOARD (Compact Room Cards Only) */}
      {activeTab === 'room_board' && (
        <div className="space-y-6">
          <section className="flex flex-wrap items-center justify-between gap-4">
            <div className="inline-flex items-center rounded-xl bg-ink/[0.05] p-1">
              {(
                [
                  ['all', 'All Rooms'],
                  ['occupied', 'Occupied'],
                  ['available', 'Available'],
                  ['reserved', 'Reserved'],
                  ['housekeeping', 'Housekeeping'],
                ] as Array<[RoomFilter, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setFilter(id)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                    filter === id
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                      : 'text-ink/60 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search room, type, or guest..."
                className="w-full rounded-xl border border-ink/12 bg-surface py-1.5 pl-9 pr-3 text-sm text-ink placeholder:text-ink/40"
              />
            </div>
          </section>

          <section aria-label="Room inventory board" className="space-y-6">
            {roomsByFloor.length === 0 ? (
              <div className="rounded-2xl border border-ink/10 py-14 text-center">
                <p className="text-sm text-ink/60">No rooms match the selected filter.</p>
                <button
                  type="button"
                  onClick={() => {
                    setFilter('all');
                    setSearch('');
                  }}
                  className="mt-3 text-sm font-medium text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4"
                >
                  Reset filters
                </button>
              </div>
            ) : (
              roomsByFloor.map(([floor, floorRooms]) => (
                <div key={floor} className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xs font-semibold uppercase tracking-wider text-ink/60">
                      Floor {floor}
                    </h2>
                    <span className="font-mono text-xs tabular-nums text-ink/45">
                      {floorRooms.length} {floorRooms.length === 1 ? 'room' : 'rooms'}
                    </span>
                  </div>

                  {/* Adaptive room card grid from tablet up to large desktop */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5 lg:gap-3">
                    {floorRooms.map((room) => {
                      const activeStay = activeStayByRoom.get(room.id);
                      const nextRes = nextReservationByRoom.get(room.id);
                      const isOccupied = Boolean(activeStay);
                      const isUnclean = room.housekeeping_status !== 'clean';
                      const isArrivingToday = !isOccupied && Boolean(nextRes && nextRes.check_in_date <= today);
                      const hasFutureRes = !isOccupied && Boolean(nextRes && nextRes.check_in_date > today);
                      const hasOverdueOrUnpaidDeparture = Boolean(
                        activeStay &&
                          (activeStay.check_out_date < today ||
                            (activeStay.check_out_date === today && activeStay.balance_due > 0))
                      );

                      // Crisp left status accent bar for 1-second visual scanning across 30+ rooms
                      const leftAccentClass =
                        isUnclean || hasOverdueOrUnpaidDeparture
                          ? 'border-l-[4px] border-l-[#E05252]'
                          : isOccupied
                            ? 'border-l-[4px] border-l-ink'
                            : 'border-l-[4px] border-l-[#6AD4B0]';

                      return (
                        <div
                          key={room.id}
                          onClick={() => openRoomInspector(room)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              openRoomInspector(room);
                            }
                          }}
                          className={`group flex flex-col justify-between rounded-xl border p-3 text-left transition-colors ${leftAccentClass} ${
                            isUnclean && !isOccupied
                              ? 'border-[#E05252]/40 bg-[#E05252]/[0.06] hover:bg-[#E05252]/[0.10]'
                              : isOccupied
                                ? hasOverdueOrUnpaidDeparture
                                  ? 'border-[#E05252]/40 bg-[#E05252]/[0.04] hover:bg-[#E05252]/[0.08]'
                                  : 'border-ink/20 bg-surface hover:border-ink/40'
                                : isArrivingToday
                                  ? 'border-ink/30 bg-ink/[0.03] hover:border-ink/50'
                                  : 'border-ink/12 bg-surface hover:border-ink/30'
                          }`}
                        >
                          <div>
                            <div className="flex items-baseline justify-between gap-1.5">
                              <span className="inline-flex items-center gap-1.5 font-mono text-base font-semibold tabular-nums text-ink">
                                {room.room_number}
                                {isUnclean && (
                                  <span
                                    className="h-2 w-2 rounded-full bg-[#E05252]"
                                    title={HK_LABELS[room.housekeeping_status]}
                                  />
                                )}
                              </span>
                              <span className="font-mono text-[11px] tabular-nums text-ink/55">
                                {currency}
                                {room.nightly_rate}/nt
                              </span>
                            </div>

                            <div className="mt-0.5 text-[11px] text-ink/55 truncate">
                              {room.room_type} ·{' '}
                              <span className={isUnclean ? 'font-semibold text-danger-ink' : ''}>
                                {HK_LABELS[room.housekeeping_status]}
                              </span>
                            </div>

                            <div className="mt-2.5 pt-2 border-t border-ink/8">
                              {activeStay ? (
                                <div>
                                  <div className="text-xs font-semibold text-ink truncate">
                                    {activeStay.guest_name}
                                  </div>
                                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/60">
                                    Out {activeStay.check_out_date.slice(5)} ·{' '}
                                    <span className={activeStay.balance_due > 0 ? 'font-semibold text-danger-ink' : ''}>
                                      {currency}
                                      {activeStay.balance_due.toFixed(0)}
                                    </span>
                                  </div>
                                </div>
                              ) : isArrivingToday && nextRes ? (
                                <div>
                                  <div className="text-xs font-semibold text-ink truncate">
                                    Arriving · {nextRes.guest_name}
                                  </div>
                                  <div className="mt-0.5 font-mono text-[11px] tabular-nums text-ink/55">
                                    {nextRes.check_in_date.slice(5)} → {nextRes.check_out_date.slice(5)}
                                  </div>
                                </div>
                              ) : hasFutureRes && nextRes ? (
                                <div>
                                  <div className="text-xs font-medium text-ink">
                                    Open until {nextRes.check_in_date.slice(5)}
                                  </div>
                                  <div className="mt-0.5 text-[11px] text-ink/50 truncate">
                                    Next: {nextRes.guest_name}
                                  </div>
                                </div>
                              ) : (
                                <div
                                  className={`text-xs ${
                                    isUnclean ? 'font-medium text-danger-ink' : 'text-ink/45'
                                  }`}
                                >
                                  {room.housekeeping_status === 'maintenance'
                                    ? 'Out of service'
                                    : isUnclean
                                      ? 'Needs cleaning'
                                      : 'Available'}
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="mt-3 flex items-center justify-between gap-1.5">
                            {activeStay ? (
                              <>
                                <HoverTip text="Open this guest's folio for charges, payments, and invoice.">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenFolio(activeStay.id);
                                    }}
                                    className="rounded-lg bg-[#6AD4B0] px-2 py-1 text-[11px] font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
                                  >
                                    Open Folio
                                  </button>
                                </HoverTip>
                                <HoverTip text="Settle balance and check guest out of this room.">
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openCheckoutSheet(activeStay);
                                    }}
                                    className="text-[11px] font-medium text-ink/65 hover:text-ink whitespace-nowrap"
                                  >
                                    Check Out
                                  </button>
                                </HoverTip>
                              </>
                            ) : isArrivingToday && nextRes ? (
                              <>
                                <HoverTip
                                  text={
                                    isUnclean
                                      ? `Room ${room.room_number} is ${HK_LABELS[room.housekeeping_status]}. Mark Clean before checking in.`
                                      : 'Check in arriving reservation and open folio.'
                                  }
                                >
                                  <button
                                    type="button"
                                    disabled={isUnclean}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setCheckInReservationStay(nextRes);
                                    }}
                                    className="rounded-lg bg-[#6AD4B0] px-2.5 py-1 text-[11px] font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
                                  >
                                    Check In
                                  </button>
                                </HoverTip>
                                {isUnclean && (
                                  <HoverTip text="Mark room Clean to allow check-in.">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateRoomStatus(room, 'clean');
                                      }}
                                      className="rounded-lg border border-[#E05252]/40 bg-surface px-2 py-0.5 text-[11px] font-semibold text-danger-ink hover:bg-[#E05252]/10 whitespace-nowrap"
                                    >
                                      Mark Clean
                                    </button>
                                  </HoverTip>
                                )}
                              </>
                            ) : (
                              <>
                                <HoverTip
                                  text={
                                    isUnclean
                                      ? `Room ${room.room_number} is ${HK_LABELS[room.housekeeping_status]}. Mark Clean before checking a guest in.`
                                      : 'Start immediate check-in for a walk-in or directory guest.'
                                  }
                                >
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openBookingModal({
                                        room,
                                        immediate: true,
                                        maxCheckOutDate: hasFutureRes && nextRes ? nextRes.check_in_date : undefined,
                                      });
                                    }}
                                    disabled={isUnclean}
                                    className="rounded-lg bg-[#6AD4B0]/25 px-2 py-1 text-[11px] font-semibold text-ink hover:bg-[#6AD4B0]/45 disabled:opacity-35 disabled:cursor-not-allowed whitespace-nowrap"
                                  >
                                    Check In
                                  </button>
                                </HoverTip>
                                {isUnclean && (
                                  <HoverTip text="Mark room Clean to allow check-in.">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleUpdateRoomStatus(room, 'clean');
                                      }}
                                      className="rounded-lg border border-[#E05252]/40 bg-surface px-2 py-0.5 text-[11px] font-semibold text-danger-ink hover:bg-[#E05252]/10 whitespace-nowrap"
                                    >
                                      Mark Clean
                                    </button>
                                  </HoverTip>
                                )}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </section>
        </div>
      )}

      {/* TAB 3: RESERVATIONS (Calendar + Room Selector + Reservation List) */}
      {activeTab === 'reservations' && (
        <ReservationsView
          rooms={rooms}
          stays={stays}
          settings={settings}
          onNewReservation={(opts) =>
            openBookingModal({
              room: opts?.room,
              immediate: false,
              checkInDate: opts?.checkInDate,
              maxCheckOutDate: opts?.maxCheckOutDate,
            })
          }
          onRequestCheckIn={(stay) => setCheckInReservationStay(stay)}
          onOpenFolio={onOpenFolio}
          mutate={mutate}
        />
      )}

      {/* TAB 4: GUEST DIRECTORY */}
      {activeTab === 'directory' && (
        <GuestDirectoryView
          guests={guests}
          stays={stays}
          settings={settings}
          focusedGuestId={focusedGuestId}
          onClearFocusedGuest={onClearFocusedGuest}
          authFetch={authFetch}
          onOpenFolio={onOpenFolio}
          onCheckInGuest={(guest) => openBookingModal({ guest, immediate: true })}
          mutate={mutate}
        />
      )}
      </div>

      {/* Room Inspector Slide-Over Drawer */}
      <Drawer
        open={Boolean(selectedRoom)}
        onClose={() => setSelectedRoom(null)}
        title={selectedRoom ? `Room ${selectedRoom.room_number} · ${selectedRoom.room_type}` : ''}
        subtitle={selectedRoom ? `Floor ${selectedRoom.floor} · Max ${selectedRoom.capacity} guests` : ''}
      >
        {selectedRoom && (
          <div className="space-y-6">
            <div>
              <div className="text-xs font-medium text-ink/55 mb-2.5">Housekeeping Status</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {(['clean', 'dirty', 'inspecting', 'maintenance'] as Array<Room['housekeeping_status']>).map(
                  (status) => {
                    const active = selectedRoom.housekeeping_status === status;
                    const isBadStatus = status !== 'clean';
                    return (
                      <button
                        key={status}
                        type="button"
                        onClick={() => handleUpdateRoomStatus(selectedRoom, status)}
                        className={`flex items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                          active
                            ? isBadStatus
                              ? 'border-[#E05252] bg-[#E05252]/12 text-danger-ink font-semibold'
                              : 'border-[#6AD4B0] bg-[#6AD4B0] text-[#1D1D1F] font-semibold'
                            : 'border-ink/15 bg-surface text-ink hover:bg-ink/[0.04]'
                        }`}
                      >
                        {active && <Check className="h-3.5 w-3.5" />}
                        {status === 'maintenance' && !active && <Wrench className="h-3.5 w-3.5" />}
                        {HK_LABELS[status]}
                      </button>
                    );
                  }
                )}
              </div>
            </div>

            <form onSubmit={handleSaveRoomDetails} className="space-y-4 border-t border-ink/8 pt-5">
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-ink/65 mb-1.5">
                  {!canEditCatalogRates && <Lock className="h-3 w-3 text-ink/50" />}
                  Standard Nightly Rate ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  readOnly={!canEditCatalogRates}
                  value={roomEditRate}
                  onChange={(e) => canEditCatalogRates && setRoomEditRate(e.target.value)}
                  className={`w-full rounded-xl border border-ink/15 px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink ${
                    !canEditCatalogRates ? 'bg-ink/[0.04] text-ink/60 opacity-60 cursor-not-allowed' : ''
                  }`}
                />
                {!canEditCatalogRates && (
                  <p className="mt-1 text-[11px] text-ink/45">
                    Locked · Room catalog rates can only be edited by Management or Accountant.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">Room Notes</label>
                <input
                  type="text"
                  value={roomEditNotes}
                  onChange={(e) => setRoomEditNotes(e.target.value)}
                  placeholder="View, accessibility, maintenance remarks..."
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2.5 text-sm text-ink"
                />
              </div>
              <div className="flex items-center justify-between pt-2">
                {activeStayByRoom.get(selectedRoom.id) ? (
                  <button
                    type="button"
                    onClick={() => {
                      const st = activeStayByRoom.get(selectedRoom.id)!;
                      setSelectedRoom(null);
                      onOpenFolio(st.id);
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4"
                  >
                    Open Active Folio
                    <ArrowRight className="h-4 w-4" />
                  </button>
                ) : (
                  <HoverTip
                    text={
                      selectedRoom.housekeeping_status !== 'clean'
                        ? `Room is ${HK_LABELS[selectedRoom.housekeeping_status]}. Mark Clean above for immediate check-in, or create a future reservation.`
                        : 'Open check-in or reservation form for this room.'
                    }
                  >
                    <button
                      type="button"
                      onClick={() => {
                        const nextRes = nextReservationByRoom.get(selectedRoom.id);
                        openBookingModal({
                          room: selectedRoom,
                          immediate: selectedRoom.housekeeping_status === 'clean',
                          maxCheckOutDate:
                            nextRes && nextRes.check_in_date > today ? nextRes.check_in_date : undefined,
                        });
                      }}
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4"
                    >
                      {selectedRoom.housekeeping_status === 'clean'
                        ? `Book / Check In Room ${selectedRoom.room_number}`
                        : `Reserve Room ${selectedRoom.room_number}`}
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  </HoverTip>
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedRoom(null)}
                    className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="rounded-xl bg-[#6AD4B0] px-4 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
                  >
                    Save Room
                  </button>
                </div>
              </div>
            </form>
          </div>
        )}
      </Drawer>

      {/* Check-In / New Reservation Modal with Directory Search, In-House Warning, Unassigned Room, & Live Tax Preview */}
      <Modal
        open={bookingModalOpen}
        onClose={() => setBookingModalOpen(false)}
        title={bookingImmediate ? 'Check In Guest' : 'New Reservation'}
        maxWidthClass="max-w-xl"
      >
        <form onSubmit={handleCreateBooking} className="space-y-4">
          {/* Action Mode: Immediate Check-In vs Reservation */}
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
            <HoverTip text="Checks guest in now, posts room charges to folio, and requires a Clean room." className="flex w-full">
              <button
                type="button"
                onClick={() => {
                  setBookingImmediate(true);
                  const currentRoom = rooms.find((r) => String(r.id) === bookingRoomId);
                  if (
                    bookingRoomId === 'unassigned' ||
                    !currentRoom ||
                    currentRoom.housekeeping_status !== 'clean'
                  ) {
                    const firstClean = rooms.find(
                      (r) => !activeStayByRoom.has(r.id) && r.housekeeping_status === 'clean'
                    );
                    if (firstClean) {
                      setBookingRoomId(String(firstClean.id));
                      setBookingRoomType(firstClean.room_type);
                      setBookingRate(String(firstClean.nightly_rate));
                    } else {
                      setBookingRoomId('');
                    }
                  }
                }}
                className={`w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  bookingImmediate
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                Immediate Check-In
              </button>
            </HoverTip>
            <HoverTip text="Schedules a future booking with optional deposit and room assignment at check-in." className="flex w-full">
              <button
                type="button"
                onClick={() => setBookingImmediate(false)}
                className={`w-full rounded-lg py-1.5 text-xs font-medium transition-colors ${
                  !bookingImmediate
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                Future Reservation
              </button>
            </HoverTip>
          </div>

          {/* Guest Source: Directory vs New Guest */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink/65">Guest Source</span>
              <div className="inline-flex rounded-lg bg-ink/[0.05] p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => {
                    setBookingGuestMode('directory');
                    setConfirmInHouseOverride(false);
                  }}
                  className={`rounded-md px-3 py-1 font-medium ${
                    bookingGuestMode === 'directory' ? 'bg-surface text-ink' : 'text-ink/60'
                  }`}
                >
                  Directory
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setBookingGuestMode('new');
                    setConfirmInHouseOverride(false);
                  }}
                  className={`rounded-md px-3 py-1 font-medium ${
                    bookingGuestMode === 'new' ? 'bg-surface text-ink' : 'text-ink/60'
                  }`}
                >
                  New Guest
                </button>
              </div>
            </div>

            {bookingGuestMode === 'directory' ? (
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-ink/40" />
                <input
                  type="text"
                  value={directoryQuery}
                  onFocus={() => setDirectoryDropdownOpen(true)}
                  onChange={(e) => {
                    setDirectoryQuery(e.target.value);
                    setBookingGuestId('');
                    setConfirmInHouseOverride(false);
                    setDirectoryDropdownOpen(true);
                  }}
                  placeholder="Type guest name, email, phone, or ID to filter directory..."
                  className="w-full rounded-xl border border-ink/15 bg-surface py-2.5 pl-10 pr-3.5 text-sm text-ink placeholder:text-ink/40"
                />

                {selectedDirectoryGuest && !directoryDropdownOpen && (
                  <div className="mt-1.5 flex items-center justify-between text-xs text-ink/60 px-1">
                    <span>
                      Selected:{' '}
                      <span className="font-semibold text-ink">{selectedDirectoryGuest.full_name}</span>
                      {selectedDirectoryGuest.email ? ` · ${selectedDirectoryGuest.email}` : ''}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setBookingGuestId('');
                        setDirectoryQuery('');
                        setConfirmInHouseOverride(false);
                        setDirectoryDropdownOpen(true);
                      }}
                      className="text-ink/65 hover:text-ink underline decoration-[#6AD4B0]"
                    >
                      Change
                    </button>
                  </div>
                )}

                {directoryDropdownOpen && (
                  <div className="mt-1.5 max-h-44 overflow-y-auto rounded-xl border border-ink/12 bg-surface divide-y divide-ink/6 shadow-[0_12px_30px_rgba(29,29,31,0.1)]">
                    {filteredDirectoryGuests.length === 0 ? (
                      <div className="px-4 py-3 text-xs text-ink/50 flex items-center justify-between">
                        <span>No matching guest in Directory.</span>
                        <button
                          type="button"
                          onClick={() => {
                            setNewGuestName(directoryQuery);
                            setBookingGuestMode('new');
                            setDirectoryDropdownOpen(false);
                          }}
                          className="font-semibold text-ink underline decoration-[#6AD4B0] decoration-2"
                        >
                          Create &ldquo;{directoryQuery || 'New Guest'}&rdquo;
                        </button>
                      </div>
                    ) : (
                      filteredDirectoryGuests.map((g) => {
                        const existingInHouse = inHouseStayByGuestId.get(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => {
                              setBookingGuestId(String(g.id));
                              setDirectoryQuery(g.full_name);
                              setConfirmInHouseOverride(false);
                              setDirectoryDropdownOpen(false);
                            }}
                            className="flex w-full items-center justify-between px-4 py-2.5 text-left hover:bg-[#6AD4B0]/15 transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-ink truncate">{g.full_name}</span>
                                {existingInHouse && (
                                  <span className="font-mono text-[10px] font-semibold text-ink bg-[#6AD4B0]/30 px-1.5 py-0.5 rounded">
                                    In-House Rm {existingInHouse.room_number}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-ink/50 truncate">
                                {[g.email, g.phone, g.id_number].filter(Boolean).join(' · ') || 'No contact info'}
                              </div>
                            </div>
                            <span className="font-mono text-xs tabular-nums text-ink/45 shrink-0 ml-2">
                              {g.stay_count} {g.stay_count === 1 ? 'stay' : 'stays'}
                            </span>
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* ALREADY IN-HOUSE WARNING BANNER */}
                {selectedGuestActiveStay && (
                  <div className="mt-3 rounded-xl border border-ink/35 bg-[#6AD4B0]/15 p-3.5 space-y-2.5">
                    <div className="flex items-start gap-2.5">
                      <AlertTriangle className="h-4 w-4 shrink-0 text-ink mt-0.5" />
                      <div className="text-xs text-ink leading-relaxed">
                        <span className="font-semibold">Guest Already In-House:</span>{' '}
                        {selectedDirectoryGuest?.full_name} is currently checked into{' '}
                        <span className="font-mono font-semibold">Room {selectedGuestActiveStay.room_number}</span>{' '}
                        (checking out {selectedGuestActiveStay.check_out_date}). Please confirm before proceeding with another check-in or booking.
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-xs font-medium text-ink cursor-pointer">
                      <input
                        type="checkbox"
                        checked={confirmInHouseOverride}
                        onChange={(e) => setConfirmInHouseOverride(e.target.checked)}
                        className="h-4 w-4 accent-[#6AD4B0]"
                      />
                      <span>I acknowledge this guest is already in-house and want to proceed</span>
                    </label>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="text"
                  required
                  value={newGuestName}
                  onChange={(e) => setNewGuestName(e.target.value)}
                  placeholder="Full Name *"
                  className="rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
                <input
                  type="email"
                  value={newGuestEmail}
                  onChange={(e) => setNewGuestEmail(e.target.value)}
                  placeholder="Email (for receipts)"
                  className="rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
                <input
                  type="text"
                  value={newGuestPhone}
                  onChange={(e) => setNewGuestPhone(e.target.value)}
                  placeholder="Phone Number"
                  className="rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
                <input
                  type="text"
                  value={newGuestIdDoc}
                  onChange={(e) => setNewGuestIdDoc(e.target.value)}
                  placeholder="Passport / ID Number"
                  className="rounded-xl border border-ink/15 px-3.5 py-2 font-mono text-sm text-ink"
                />
              </div>
            )}
          </div>

          {/* Room or Room-Type Selection */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1">
                {bookingImmediate ? 'Room *' : 'Room Assignment'}
              </label>
              <select
                required
                value={bookingRoomId}
                onChange={(e) => {
                  const val = e.target.value;
                  setBookingRoomId(val);
                  if (val === 'unassigned') {
                    const cat = roomTypeCatalog.find((c) => c.type === bookingRoomType) ?? roomTypeCatalog[0];
                    if (cat) {
                      setBookingRoomType(cat.type);
                      setBookingRate(String(cat.rate));
                    }
                  } else {
                    const r = rooms.find((rm) => String(rm.id) === val);
                    if (r) {
                      setBookingRate(String(r.nightly_rate));
                      setBookingRoomType(r.room_type);
                    }
                  }
                }}
                className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm text-ink"
              >
                {bookingImmediate && <option value="">Select a Clean room...</option>}
                {!bookingImmediate && (
                  <option value="unassigned">Assign Room Later (Select Room Type)</option>
                )}
                {rooms.map((r) => {
                  const unclean = r.housekeeping_status !== 'clean';
                  const disabledOpt =
                    r.housekeeping_status === 'maintenance' || (bookingImmediate && unclean);
                  return (
                    <option key={r.id} value={r.id} disabled={disabledOpt}>
                      Room {r.room_number} · {r.room_type} ({currency}
                      {r.nightly_rate}/nt)
                      {activeStayByRoom.has(r.id) ? ' — In-House' : ''}
                      {unclean ? ` — ${HK_LABELS[r.housekeeping_status]}` : ''}
                    </option>
                  );
                })}
              </select>
              {bookingImmediate && isSelectedBookingRoomUnclean && selectedBookingRoom && (
                <div className="mt-1.5 rounded-lg border border-[#E05252]/40 bg-[#E05252]/8 px-2.5 py-1.5 text-[11px] font-medium text-danger-ink">
                  Room {selectedBookingRoom.room_number} is {HK_LABELS[selectedBookingRoom.housekeeping_status]} — mark Clean before checking in.
                </div>
              )}
            </div>

            {!bookingImmediate && bookingRoomId === 'unassigned' ? (
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1">
                  Room Category / Type *
                </label>
                <select
                  required
                  value={bookingRoomType}
                  onChange={(e) => {
                    const t = e.target.value;
                    setBookingRoomType(t);
                    const match = roomTypeCatalog.find((c) => c.type === t);
                    if (match) setBookingRate(String(match.rate));
                  }}
                  className="w-full rounded-xl border border-ink/15 bg-surface px-3 py-2 text-sm text-ink"
                >
                  {roomTypeCatalog.map((cat) => (
                    <option key={cat.type} value={cat.type}>
                      {cat.type} ({currency}
                      {cat.rate}/nt)
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-ink/65 mb-1">
                  {!canFinancialControl && <Lock className="h-3 w-3 text-ink/50" />}
                  Nightly Rate ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  readOnly={!canFinancialControl}
                  value={bookingRate}
                  onChange={(e) => canFinancialControl && setBookingRate(e.target.value)}
                  className={`w-full rounded-xl border border-ink/15 px-3 py-2 font-mono text-sm tabular-nums text-ink ${
                    !canFinancialControl ? 'bg-ink/[0.04] text-ink/60 opacity-60 cursor-not-allowed' : ''
                  }`}
                />
                {!canFinancialControl && (
                  <p className="mt-1 text-[10px] text-ink/45">
                    Catalog rate locked · Management/Accountant/Auditor to override
                  </p>
                )}
              </div>
            )}
          </div>

          {!bookingImmediate && bookingRoomId === 'unassigned' && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="flex items-center gap-1 text-xs font-medium text-ink/65 mb-1">
                  {!canFinancialControl && <Lock className="h-3 w-3 text-ink/50" />}
                  Nightly Rate ({currency})
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  required
                  readOnly={!canFinancialControl}
                  value={bookingRate}
                  onChange={(e) => canFinancialControl && setBookingRate(e.target.value)}
                  className={`w-full rounded-xl border border-ink/15 px-3 py-2 font-mono text-sm tabular-nums text-ink ${
                    !canFinancialControl ? 'bg-ink/[0.04] text-ink/60 opacity-60 cursor-not-allowed' : ''
                  }`}
                />
                {!canFinancialControl && (
                  <p className="mt-1 text-[10px] text-ink/45">
                    Catalog rate locked · Management/Accountant/Auditor to override
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1">Adults</label>
                <input
                  type="number"
                  min="1"
                  max="8"
                  value={bookingAdults}
                  onChange={(e) => setBookingAdults(e.target.value)}
                  className="w-full rounded-xl border border-ink/15 px-3 py-2 font-mono text-sm tabular-nums text-ink"
                />
              </div>
            </div>
          )}

          {/* Stay Dates & Adults */}
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1">Check-In</label>
              <input
                type="date"
                required
                min={!bookingImmediate ? today : undefined}
                value={bookingCheckIn}
                onChange={(e) => {
                  const nextIn = e.target.value;
                  setBookingCheckIn(nextIn);
                  if (nextIn && bookingCheckOut && nextIn >= bookingCheckOut) {
                    setBookingCheckOut(addDaysIso(nextIn, 1));
                  }
                }}
                className={`w-full rounded-xl border px-3 py-2 font-mono text-xs tabular-nums text-ink ${
                  bookingDateError ? 'border-[#E05252]' : 'border-ink/15'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1">Check-Out</label>
              <input
                type="date"
                required
                min={addDaysIso(bookingCheckIn, 1)}
                max={selectedRoomNextReservation?.check_in_date ?? bookingMaxCheckOutHint ?? undefined}
                value={bookingCheckOut}
                onChange={(e) => setBookingCheckOut(e.target.value)}
                className={`w-full rounded-xl border px-3 py-2 font-mono text-xs tabular-nums text-ink ${
                  bookingDateError ? 'border-[#E05252]' : 'border-ink/15'
                }`}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1">Adults</label>
              <input
                type="number"
                min="1"
                max="8"
                value={bookingAdults}
                onChange={(e) => setBookingAdults(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3 py-2 font-mono text-sm tabular-nums text-ink"
              />
            </div>
          </div>

          {bookingDateError && (
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/8 px-3.5 py-2 text-xs font-medium text-danger-ink">
              {bookingDateError}
            </div>
          )}

          {selectedRoomNextReservation && (
            <div className="rounded-xl border border-ink/12 bg-ink/[0.02] px-3.5 py-2 text-xs text-ink/70">
              Next arrival:{' '}
              <span className="font-mono font-semibold text-ink">
                {selectedRoomNextReservation.check_in_date}
              </span>{' '}
              ({selectedRoomNextReservation.guest_name}) · Check-out must be on or before this date.
            </div>
          )}

          {/* LIVE TAX & TOTAL PRICE CALCULATION PREVIEW BEFORE PROCESSING */}
          <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-ink/65">
              <span>
                Accommodation ({bookingNights} {bookingNights === 1 ? 'night' : 'nights'} × {currency}
                {bookingNightlyRateNum.toFixed(2)})
              </span>
              <span className="font-mono tabular-nums text-ink">
                {currency}
                {bookingTaxPreview.netAmount.toFixed(2)}
              </span>
            </div>
            {settings.tax_enabled === 1 &&
              (bookingTaxPreview.applicable && bookingTaxPreview.breakdown.length > 0 ? (
                bookingTaxPreview.breakdown.map((item) => (
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
                  <span>Tax (Not applied to Accommodation)</span>
                  <span className="font-mono tabular-nums text-ink">{currency}0.00</span>
                </div>
              ))}
            <div className="flex justify-between border-t border-ink/10 pt-2 text-sm font-semibold text-ink">
              <span>Total Stay Price</span>
              <span className="font-mono tabular-nums">
                {currency}
                {bookingTaxPreview.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          {/* Deposit / Initial Payment Option */}
          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-[11px] font-medium text-ink/60 mb-1">
                {bookingImmediate ? 'Payment Now' : 'Deposit'} ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={bookingDepositAmount}
                onChange={(e) => setBookingDepositAmount(e.target.value)}
                className="w-full rounded-xl border border-ink/15 px-3 py-2 font-mono text-xs tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink/60 mb-1">Method</label>
              <select
                value={bookingDepositMethod}
                onChange={(e) => setBookingDepositMethod(e.target.value as FolioPayment['method'])}
                className="w-full rounded-xl border border-ink/15 bg-surface px-2.5 py-2 text-xs text-ink"
              >
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="corporate">Corporate</option>
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-medium text-ink/60 mb-1">Reference</label>
              <input
                type="text"
                value={bookingDepositRef}
                onChange={(e) => setBookingDepositRef(e.target.value)}
                placeholder="Receipt #"
                className="w-full rounded-xl border border-ink/15 px-3 py-2 text-xs text-ink"
              />
            </div>
          </div>

          {bookingDepositNum > 0 && (
            <div className="flex justify-between px-1 text-xs text-ink/65">
              <span>Balance Remaining After Payment</span>
              <span className="font-mono font-semibold tabular-nums text-ink">
                {currency}
                {bookingBalanceRemaining.toFixed(2)}
              </span>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1">Notes</label>
            <input
              type="text"
              value={bookingNotes}
              onChange={(e) => setBookingNotes(e.target.value)}
              placeholder="Special requests, arrival time, dietary remarks..."
              className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
            <button
              type="button"
              onClick={() => setBookingModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={
                submitting ||
                Boolean(bookingDateError) ||
                (bookingGuestMode === 'directory' && !bookingGuestId) ||
                (Boolean(selectedGuestActiveStay) && !confirmInHouseOverride) ||
                (bookingImmediate && (!selectedBookingRoom || isSelectedBookingRoomUnclean))
              }
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-40 transition-colors"
            >
              {submitting
                ? 'Saving...'
                : bookingImmediate
                  ? `Confirm Check-In (${currency}${bookingTaxPreview.totalAmount.toFixed(2)})`
                  : `Create Reservation (${currency}${bookingTaxPreview.totalAmount.toFixed(2)})`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Reservation Check-In Modal (shows Amount Paid, Balance Remaining, Pre-calculated Tax, Room Assignment) */}
      <ReservationCheckInModal
        stay={checkInReservationStay}
        rooms={rooms}
        stays={stays}
        settings={settings}
        onClose={() => setCheckInReservationStay(null)}
        mutate={mutate}
      />

      {/* Checkout Settlement Modal (Split Payments + Early Checkout + Overpayment Refund) */}
      {checkoutModalElement}
    </div>
  );
}
