import { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  CreditCard,
  Lock,
  Minus,
  Plus,
  Printer,
  Receipt,
  RotateCcw,
  Search,
  ShoppingBag,
  Trash2,
  UtensilsCrossed,
} from 'lucide-react';
import type {
  AppCategory,
  HotelSettings,
  MenuItem,
  PaginatedPosOrdersResponse,
  PosOrder,
  PosOrderItem,
  StaffRole,
  Stay,
  TaxBreakdownItem,
} from '../types';
import { isoDateDaysAgo } from '../utils/constants';
import { getLocalTodayIso } from '../utils/dateValidation';
import { calculateTax } from '../utils/tax';
import { Drawer } from './Drawer';
import { HoverTip } from './HoverTip';
import { PaginationBar } from './PaginationBar';
import { VoidConfirmModal, type VoidTargetSummary } from './VoidConfirmModal';

interface RestaurantPosViewProps {
  menuItems: MenuItem[];
  posOrders: PosOrder[];
  stays: Stay[];
  categories: AppCategory[];
  settings: HotelSettings;
  userRole: StaffRole;
  canOpenFolio: boolean;
  onOpenFolio: (stayId: number) => void;
  authFetch: (url: string, init?: RequestInit) => Promise<Response>;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

type RestaurantTab = 'pos' | 'history';
type HistoryFilter = 'all' | 'unpaid' | 'paid' | 'dine_in' | 'room_service' | 'voided';
type DirectPaymentMethod = 'card' | 'cash' | 'bank_transfer';
type SettlePaymentMethod = 'card' | 'cash' | 'bank_transfer' | 'folio';

function parseOrderItems(json: string): PosOrderItem[] {
  try {
    const parsed = JSON.parse(json) as PosOrderItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseTaxBreakdown(json?: string): TaxBreakdownItem[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json) as TaxBreakdownItem[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function formatMethodLabel(settlement: PosOrder['settlement']): string {
  switch (settlement) {
    case 'card':
      return 'Card';
    case 'cash':
      return 'Cash';
    case 'bank_transfer':
      return 'Bank Transfer';
    case 'folio':
      return 'Guest Folio';
    case 'unpaid':
      return 'Pay Later';
    default:
      return settlement;
  }
}

function formatTimestamp(iso: string): string {
  if (!iso) return '';
  return iso.replace('T', ' ').slice(0, 16);
}

export function RestaurantPosView({
  menuItems,
  posOrders,
  stays,
  categories,
  settings,
  userRole,
  canOpenFolio,
  onOpenFolio,
  authFetch,
  mutate,
}: RestaurantPosViewProps) {
  const canVoid =
    userRole === 'management' || userRole === 'accountant' || userRole === 'auditor';
  const [activeTab, setActiveTab] = useState<RestaurantTab>('pos');

  // POS Catalog & Ticket state
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<Array<{ item: MenuItem; qty: number }>>([]);
  const [diningType, setDiningType] = useState<'dine_in' | 'room_service'>('dine_in');
  const [tableNumber, setTableNumber] = useState('');
  const [guestName, setGuestName] = useState('');
  const [selectedStayId, setSelectedStayId] = useState<string>('');
  const [directMethod, setDirectMethod] = useState<DirectPaymentMethod>('card');
  const [notes, setNotes] = useState('');
  const [autoPrintDocket, setAutoPrintDocket] = useState(false);
  const [ticketDrawerOpen, setTicketDrawerOpen] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<
    null | 'place' | 'pay' | 'folio' | 'folio_print'
  >(null);

  // Order History state (server-side paginated, Last 30 Days default)
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');
  const [historySearch, setHistorySearch] = useState('');
  const [historyRangePreset, setHistoryRangePreset] = useState<'7d' | '30d' | 'all'>('30d');
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState(25);
  const [historyData, setHistoryData] = useState<PaginatedPosOrdersResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  // Settle Order Drawer state
  const [settleOrder, setSettleOrder] = useState<PosOrder | null>(null);
  const [settleMethod, setSettleMethod] = useState<SettlePaymentMethod>('card');
  const [settleStayId, setSettleStayId] = useState<string>('');
  const [settleReference, setSettleReference] = useState('');
  const [settling, setSettling] = useState(false);

  // Printable Docket / Receipt Preview Drawer state
  const [printDoc, setPrintDoc] = useState<{ mode: 'docket' | 'receipt'; order: PosOrder } | null>(
    null
  );

  // Void Order modal state (Management, Accountant & Auditor only)
  const [voidOrderTarget, setVoidOrderTarget] = useState<PosOrder | null>(null);
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  const currency = settings.currency_symbol;
  const taxEnabled = settings.tax_enabled === 1;

  const checkedInStays = useMemo(
    () =>
      stays
        .filter((s) => s.status === 'checked_in')
        .sort((a, b) => (a.room_number ?? '').localeCompare(b.room_number ?? '')),
    [stays]
  );

  // Dynamically derive POS category tabs from database categories + existing menu items
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
    return ['All', ...ordered];
  }, [categories, menuItems]);

  const voidReasonPresets = useMemo(
    () =>
      categories
        .filter((c) => c.kind === 'void_reason' && c.active === 1)
        .map((c) => c.name),
    [categories]
  );

  const filteredMenu = useMemo(() => {
    const q = search.trim().toLowerCase();
    return menuItems.filter((item) => {
      if (selectedCategory !== 'All' && item.category !== selectedCategory) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q)
      );
    });
  }, [menuItems, selectedCategory, search]);

  const rawCartTotal = useMemo(
    () => cart.reduce((sum, entry) => sum + entry.item.price * entry.qty, 0),
    [cart]
  );

  const taxCalc = useMemo(
    () => calculateTax(rawCartTotal, 'restaurant', settings),
    [rawCartTotal, settings]
  );

  const unpaidOrders = useMemo(
    () => posOrders.filter((o) => o.voided !== 1 && o.payment_status === 'unpaid'),
    [posOrders]
  );

  const unpaidTotal = useMemo(
    () => unpaidOrders.reduce((sum, o) => sum + o.total_amount, 0),
    [unpaidOrders]
  );

  const cartItemCount = useMemo(
    () => cart.reduce((sum, entry) => sum + entry.qty, 0),
    [cart]
  );

  // Reset pagination to page 1 when history filters or range change
  useEffect(() => {
    setHistoryPage(1);
  }, [historyFilter, historySearch, historyRangePreset, historyPageSize]);

  // Fetch server-paginated Order History
  useEffect(() => {
    if (activeTab !== 'history') return;
    let active = true;
    const timer = setTimeout(async () => {
      setHistoryLoading(true);
      try {
        const params = new URLSearchParams({
          page: String(historyPage),
          pageSize: String(historyPageSize),
          filter: historyFilter,
        });
        if (historySearch.trim()) params.set('q', historySearch.trim());
        if (historyRangePreset !== 'all') {
          params.set('from', isoDateDaysAgo(historyRangePreset === '7d' ? 6 : 29));
          params.set('to', getLocalTodayIso());
        }
        const res = await authFetch(`/api/pos/orders?${params.toString()}`);
        if (res.ok && active) {
          const data = (await res.json()) as PaginatedPosOrdersResponse;
          setHistoryData(data);
        }
      } finally {
        if (active) setHistoryLoading(false);
      }
    }, historySearch ? 160 : 0);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    activeTab,
    historyPage,
    historyPageSize,
    historyFilter,
    historySearch,
    historyRangePreset,
    posOrders,
    authFetch,
  ]);

  const displayedOrders = historyData ? historyData.orders : posOrders.slice(0, historyPageSize);
  const displayedTotal = historyData ? historyData.total : posOrders.length;
  const displayedUnpaidCount = historyData ? historyData.unpaidCount : unpaidOrders.length;
  const displayedUnpaidTotal = historyData ? historyData.unpaidTotal : unpaidTotal;
  const displayedPaidCount = historyData
    ? historyData.paidCount
    : posOrders.filter((o) => o.voided !== 1 && o.payment_status === 'paid').length;
  const displayedVoidedCount = historyData
    ? (historyData.voidedCount ?? 0)
    : posOrders.filter((o) => o.voided === 1).length;

  const voidOrderSummary: VoidTargetSummary | null = voidOrderTarget
    ? {
        entityLabel: 'Restaurant POS Order',
        title: `${voidOrderTarget.order_number} · ${parseOrderItems(voidOrderTarget.items_json)
          .map((i) => `${i.qty}× ${i.name}`)
          .join(', ')}`,
        reference: voidOrderTarget.order_number,
        party: voidOrderTarget.room_number
          ? `Room ${voidOrderTarget.room_number} · ${voidOrderTarget.guest_name}`
          : voidOrderTarget.guest_name,
        amount: voidOrderTarget.total_amount,
        currency,
        warningNote:
          voidOrderTarget.settlement === 'folio'
            ? 'This order was posted to a guest folio. Voiding it will also void the linked guest folio charge and post a contra journal voucher.'
            : voidOrderTarget.payment_status === 'unpaid'
              ? 'This unpaid dining tab will be voided and reversed out of Restaurant Receivable (1120) and Restaurant Revenue (4200).'
              : 'This paid order will be reversed from Restaurant Revenue (4200), Tax Payable (2200), and Cash/Bank receipts with a contra journal voucher.',
      }
    : null;

  async function handleConfirmVoidOrder(reason: string) {
    if (!voidOrderTarget) return;
    setVoidSubmitting(true);
    try {
      const ok = await mutate(
        `/api/pos/orders/${voidOrderTarget.id}/void`,
        'POST',
        { reason, confirmed: true },
        `Order ${voidOrderTarget.order_number} voided & reversed`
      );
      if (ok) {
        setVoidOrderTarget(null);
      }
    } finally {
      setVoidSubmitting(false);
    }
  }

  function addToCart(item: MenuItem) {
    if (!item.available) return;
    setCart((prev) => {
      const idx = prev.findIndex((c) => c.item.id === item.id);
      if (idx >= 0) {
        return prev.map((c, i) => (i === idx ? { ...c, qty: c.qty + 1 } : c));
      }
      return [...prev, { item, qty: 1 }];
    });
  }

  function updateQty(itemId: number, delta: number) {
    setCart((prev) =>
      prev
        .map((c) => (c.item.id === itemId ? { ...c, qty: c.qty + delta } : c))
        .filter((c) => c.qty > 0)
    );
  }

  function resetTicket() {
    setCart([]);
    setTableNumber('');
    setGuestName('');
    setNotes('');
    if (diningType === 'room_service') {
      setSelectedStayId('');
    }
  }

  async function submitTicket(mode: 'place' | 'pay' | 'folio' | 'folio_print') {
    if (cart.length === 0) return;
    if ((mode === 'folio' || mode === 'folio_print') && !selectedStayId) return;

    setSubmittingAction(mode);
    try {
      const items: PosOrderItem[] = cart.map((c) => ({
        name: c.item.name,
        qty: c.qty,
        price: c.item.price,
      }));

      const isRoomService = mode === 'folio' || mode === 'folio_print';
      const isPaidNow = mode === 'pay' || isRoomService;

      const payload: Record<string, unknown> = {
        items,
        dining_type: isRoomService ? 'room_service' : 'dine_in',
        table_number: isRoomService ? '' : tableNumber.trim(),
        guest_name: isRoomService ? undefined : guestName.trim() || undefined,
        stay_id: isRoomService ? Number(selectedStayId) : undefined,
        settlement: isRoomService ? 'folio' : isPaidNow ? directMethod : 'unpaid',
        payment_status: isPaidNow ? 'paid' : 'unpaid',
        notes: notes.trim(),
      };

      const successMessage = isRoomService
        ? 'Room service order posted to guest folio'
        : isPaidNow
          ? `Order paid via ${formatMethodLabel(directMethod)}`
          : 'Dine-in order placed (unpaid — settle when guest is ready)';

      const res = await mutate<{ order?: PosOrder; orderNumber?: string }>(
        '/api/pos/orders',
        'POST',
        payload,
        successMessage
      );

      if (res) {
        resetTicket();
        setTicketDrawerOpen(false);
        if (res.order && (mode === 'folio_print' || autoPrintDocket)) {
          setPrintDoc({ mode: 'docket', order: res.order });
        }
      }
    } finally {
      setSubmittingAction(null);
    }
  }

  async function handleToggleAvailability(item: MenuItem) {
    await mutate(
      `/api/menu/${item.id}`,
      'PATCH',
      { available: item.available ? 0 : 1 },
      `${item.name} marked ${item.available ? 'unavailable' : 'available'}`
    );
  }

  async function handleUpdateOrderStatus(order: PosOrder, status: PosOrder['status']) {
    await mutate(
      `/api/pos/orders/${order.id}/status`,
      'PATCH',
      { status },
      `${order.order_number} marked ${status}`
    );
  }

  function openSettleModal(order: PosOrder) {
    setSettleOrder(order);
    setSettleMethod('card');
    setSettleStayId('');
    setSettleReference('');
  }

  async function handleConfirmSettle(printReceiptAfter: boolean) {
    if (!settleOrder) return;
    if (settleMethod === 'folio' && !settleStayId) return;

    setSettling(true);
    try {
      const res = await mutate<{ ok?: boolean; order?: PosOrder }>(
        `/api/pos/orders/${settleOrder.id}/settle`,
        'POST',
        {
          settlement: settleMethod,
          stay_id: settleMethod === 'folio' ? Number(settleStayId) : undefined,
          payment_reference: settleReference.trim(),
        },
        settleMethod === 'folio'
          ? `${settleOrder.order_number} posted to guest folio`
          : `${settleOrder.order_number} settled via ${formatMethodLabel(settleMethod)}`
      );
      if (res) {
        const updatedOrder = res.order;
        setSettleOrder(null);
        if (printReceiptAfter && updatedOrder) {
          setPrintDoc({ mode: 'receipt', order: updatedOrder });
        }
      }
    } finally {
      setSettling(false);
    }
  }

  const roomServiceMissingRoom = diningType === 'room_service' && !selectedStayId;
  const selectedStay = checkedInStays.find((s) => String(s.id) === selectedStayId);

  const ticketBuilderBody = (
    <div className="space-y-4 lg:space-y-5">
      {/* Step 1: Service Type (Dine-In vs Room Service) */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-ink/60">Service Type</div>
        <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
          <HoverTip
            text="Table or walk-in service. Guest details are optional; place unpaid tab or take payment now."
            className="flex w-full"
          >
            <button
              type="button"
              onClick={() => setDiningType('dine_in')}
              className={`w-full rounded-lg py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                diningType === 'dine_in'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Dine-In
            </button>
          </HoverTip>
          <HoverTip
            text="Deliver to an in-house room and post the charge straight to the guest's folio."
            className="flex w-full"
          >
            <button
              type="button"
              onClick={() => setDiningType('room_service')}
              className={`w-full rounded-lg py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                diningType === 'room_service'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Room Service
            </button>
          </HoverTip>
        </div>
      </div>

      {/* Step 2: Guest / Room Details based on Service Type */}
      {diningType === 'room_service' ? (
        <div className="space-y-2">
          <label className="block text-xs font-medium text-ink/65">
            Checked-In Room <span className="text-danger-ink">*</span>
          </label>
          {checkedInStays.length === 0 ? (
            <div className="rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.07] px-3.5 py-2.5 text-xs text-danger-ink">
              No guests are currently checked in. Check in a guest on Front Desk before placing a Room Service order.
            </div>
          ) : (
            <>
              <select
                value={selectedStayId}
                onChange={(e) => setSelectedStayId(e.target.value)}
                className={`w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink ${
                  cart.length > 0 && !selectedStayId
                    ? 'border-[#E05252] bg-[#E05252]/[0.04]'
                    : 'border-ink/15'
                }`}
              >
                <option value="">Select checked-in room...</option>
                {checkedInStays.map((stay) => (
                  <option key={stay.id} value={stay.id}>
                    Room {stay.room_number} · {stay.guest_name}
                  </option>
                ))}
              </select>
              {cart.length > 0 && !selectedStayId && (
                <p className="text-xs text-danger-ink">
                  Select a checked-in room before posting a Room Service order.
                </p>
              )}
              {selectedStay && (
                <p className="text-xs text-ink/55">
                  Charge will post directly to{' '}
                  <span className="font-medium text-ink">
                    Room {selectedStay.room_number} ({selectedStay.guest_name})
                  </span>{' '}
                  folio.
                </p>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">
              Table # <span className="text-ink/35 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={tableNumber}
              onChange={(e) => setTableNumber(e.target.value)}
              placeholder="e.g. T-04"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/60 mb-1">
              Guest Name <span className="text-ink/35 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={guestName}
              onChange={(e) => setGuestName(e.target.value)}
              placeholder="Walk-in / Table guest"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
            />
          </div>
        </div>
      )}

      {/* Cart Items */}
      <div className="min-h-[120px] divide-y divide-ink/8 border-y border-ink/8">
        {cart.length === 0 ? (
          <div className="py-10 text-center text-xs text-ink/45">
            Tap dishes from the menu to add them to this ticket.
          </div>
        ) : (
          cart.map(({ item, qty }) => (
            <div key={item.id} className="flex items-center justify-between gap-3 py-2.5">
              <div className="min-w-0">
                <div className="text-sm font-medium text-ink truncate">{item.name}</div>
                <div className="font-mono text-xs tabular-nums text-ink/50">
                  {currency}
                  {item.price.toFixed(2)} × {qty} = {currency}
                  {(item.price * qty).toFixed(2)}
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => updateQty(item.id, -1)}
                  aria-label={`Decrease ${item.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 text-ink hover:bg-ink/[0.05]"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="w-5 text-center font-mono text-xs font-medium tabular-nums">
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => updateQty(item.id, 1)}
                  aria-label={`Increase ${item.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-ink/15 text-ink hover:bg-ink/[0.05]"
                >
                  <Plus className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => updateQty(item.id, -qty)}
                  aria-label={`Remove ${item.name}`}
                  className="ml-1 text-ink/40 hover:text-danger-ink"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Kitchen Notes */}
      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Kitchen notes, allergies, delivery instructions..."
        className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2 text-xs text-ink"
      />

      {/* Live Multi-Tax & Total Preview */}
      <div className="space-y-1.5 border-t border-ink/8 pt-4 text-sm">
        <div className="flex justify-between text-ink/60">
          <span>{taxEnabled ? 'Subtotal (Net)' : 'Subtotal'}</span>
          <span className="font-mono tabular-nums">
            {currency}
            {taxCalc.netAmount.toFixed(2)}
          </span>
        </div>
        {taxEnabled &&
          (taxCalc.applicable && taxCalc.breakdown.length > 0 ? (
            taxCalc.breakdown.map((item) => (
              <div
                key={`${item.name}-${item.rate}-${item.mode}`}
                className="flex justify-between text-ink/60 text-xs"
              >
                <span>
                  {item.name} ({item.rate}% {item.mode === 'inclusive' ? 'incl.' : 'excl.'})
                </span>
                <span className="font-mono tabular-nums">
                  {currency}
                  {item.amount.toFixed(2)}
                </span>
              </div>
            ))
          ) : (
            <div className="flex justify-between text-ink/55 text-xs">
              <span>Tax (Not applied to Restaurant)</span>
              <span className="font-mono tabular-nums">{currency}0.00</span>
            </div>
          ))}
        <div className="flex justify-between pt-2 border-t border-ink/8 text-base font-semibold text-ink">
          <span>Total</span>
          <span className="font-mono tabular-nums">
            {currency}
            {taxCalc.totalAmount.toFixed(2)}
          </span>
        </div>
      </div>

      {/* Action Controls by Service Type */}
      {diningType === 'room_service' ? (
        <div className="space-y-2.5">
          <HoverTip
            text="Posts this room service order directly to the selected guest's folio."
            className="flex w-full"
          >
            <button
              type="button"
              disabled={submittingAction !== null || cart.length === 0 || roomServiceMissingRoom}
              onClick={() => submitTicket('folio')}
              className="w-full rounded-xl bg-[#6AD4B0] py-3 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-40 transition-colors"
            >
              {submittingAction === 'folio'
                ? 'Posting to Folio...'
                : `Post ${currency}${taxCalc.totalAmount.toFixed(2)} to Guest Folio`}
            </button>
          </HoverTip>
          <HoverTip
            text="Posts to the guest folio and immediately opens the kitchen docket print sheet."
            className="flex w-full"
          >
            <button
              type="button"
              disabled={submittingAction !== null || cart.length === 0 || roomServiceMissingRoom}
              onClick={() => submitTicket('folio_print')}
              className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-ink/18 bg-surface py-2.5 text-xs font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40 transition-colors"
            >
              <Printer className="h-3.5 w-3.5" />
              <span>
                {submittingAction === 'folio_print'
                  ? 'Posting...'
                  : 'Post to Folio & Print Docket'}
              </span>
            </button>
          </HoverTip>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Payment Method for Take Payment */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-ink/60">Payment Method</span>
              <HoverTip text="Automatically open the kitchen docket print preview after submitting this order.">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-ink/60 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoPrintDocket}
                    onChange={(e) => setAutoPrintDocket(e.target.checked)}
                    className="h-3.5 w-3.5 rounded accent-[#6AD4B0]"
                  />
                  <span>Print docket</span>
                </label>
              </HoverTip>
            </div>
            <div className="grid grid-cols-3 gap-1 rounded-xl bg-ink/[0.05] p-1">
              {(
                [
                  ['card', 'Card'],
                  ['cash', 'Cash'],
                  ['bank_transfer', 'Transfer'],
                ] as Array<[DirectPaymentMethod, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setDirectMethod(id)}
                  className={`rounded-lg py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                    directMethod === id
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                      : 'text-ink/60 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Dine-In Dual Flow: Place Order (Unpaid) OR Take Payment (Paid) */}
          <div className="grid grid-cols-2 gap-2.5">
            <HoverTip
              text="Opens an unpaid tab so the guest can dine first and settle later from Order History."
              className="flex w-full"
            >
              <button
                type="button"
                disabled={submittingAction !== null || cart.length === 0}
                onClick={() => submitTicket('place')}
                className="w-full rounded-xl border border-ink/20 bg-surface py-3 px-3 text-xs font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40 transition-colors"
              >
                {submittingAction === 'place' ? 'Placing...' : 'Place Order'}
              </button>
            </HoverTip>
            <HoverTip
              text="Places the order and marks it Paid immediately using the selected payment method."
              className="flex w-full"
            >
              <button
                type="button"
                disabled={submittingAction !== null || cart.length === 0}
                onClick={() => submitTicket('pay')}
                className="w-full inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#6AD4B0] py-3 px-3 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-40 transition-colors"
              >
                <CreditCard className="h-3.5 w-3.5" />
                <span>{submittingAction === 'pay' ? 'Settling...' : 'Take Payment'}</span>
              </button>
            </HoverTip>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className={`flex flex-1 min-h-0 flex-col ${printDoc ? 'no-print' : ''}`}>
        {/* Fixed Flush-bottom Restaurant Tabs (POS & Order History) */}
        <div className="no-print shrink-0 bg-canvas flex flex-wrap items-center justify-between gap-4 border-b border-ink/10 px-4 pt-4 md:px-5 md:pt-5 lg:px-7 lg:pt-6">
          <div className="flex items-center gap-6" role="tablist" aria-label="Restaurant views">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'pos'}
              onClick={() => setActiveTab('pos')}
              className={`relative inline-flex items-center gap-2 pb-3 pt-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'pos'
                  ? 'text-ink font-semibold'
                  : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              <UtensilsCrossed className="h-4 w-4" />
              <span>POS</span>
              {activeTab === 'pos' && (
                <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-[#6AD4B0]" />
              )}
            </button>

            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'history'}
              onClick={() => setActiveTab('history')}
              className={`relative inline-flex items-center gap-2 pb-3 pt-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'history'
                  ? 'text-ink font-semibold'
                  : 'text-ink/50 hover:text-ink/80'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              <span>Order History</span>
              {unpaidOrders.length > 0 && (
                <span className="rounded-md bg-[#E05252]/14 px-1.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-danger-ink">
                  {unpaidOrders.length} unpaid
                </span>
              )}
              {activeTab === 'history' && (
                <span className="absolute inset-x-0 bottom-0 h-[2.5px] rounded-full bg-[#6AD4B0]" />
              )}
            </button>
          </div>

          {unpaidOrders.length > 0 && activeTab === 'pos' && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('history');
                setHistoryFilter('unpaid');
              }}
              className="mb-2 inline-flex items-center gap-2 rounded-lg border border-[#E05252]/30 bg-[#E05252]/[0.07] px-3 py-1 text-xs font-medium text-danger-ink hover:bg-[#E05252]/14 transition-colors whitespace-nowrap"
            >
              <span>
                {unpaidOrders.length} unpaid {unpaidOrders.length === 1 ? 'tab' : 'tabs'} · {currency}
                {unpaidTotal.toFixed(2)}
              </span>
            </button>
          )}
        </div>

        {/* Scrollable Restaurant Tab Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-5 md:px-5 lg:px-7">
        {/* ===================== TAB 1: POS ===================== */}
        {activeTab === 'pos' && (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-5 lg:gap-7 items-start">
            {/* Left Cols: Menu Catalog */}
            <div className="md:col-span-7 xl:col-span-8 space-y-4 lg:space-y-5 pb-20 md:pb-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search menu items..."
                  className="w-full rounded-xl border border-ink/12 bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-ink/40"
                />
              </div>

              <div className="flex flex-wrap items-center gap-1 rounded-xl bg-ink/[0.05] p-1">
                {menuCategories.map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setSelectedCategory(cat)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                      selectedCategory === cat
                        ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                        : 'text-ink/60 hover:text-ink'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {filteredMenu.length === 0 ? (
                <div className="rounded-2xl border border-ink/10 py-14 text-center space-y-3">
                  <div className="text-xs text-ink/50">No menu items match your filter.</div>
                  {(search || selectedCategory !== 'All') && (
                    <button
                      type="button"
                      onClick={() => {
                        setSearch('');
                        setSelectedCategory('All');
                      }}
                      className="rounded-xl border border-ink/15 px-3.5 py-1.5 text-xs font-medium text-ink hover:bg-ink/[0.04]"
                    >
                      Show All Dishes
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 lg:gap-3">
                  {filteredMenu.map((item) => {
                    const inCart = cart.find((c) => c.item.id === item.id);
                    return (
                      <div
                        key={item.id}
                        onClick={() => addToCart(item)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            addToCart(item);
                          }
                        }}
                        className={`flex flex-col justify-between rounded-2xl border p-3.5 text-left transition-colors ${
                          !item.available
                            ? 'border-ink/8 bg-ink/[0.02] opacity-55'
                            : inCart
                              ? 'border-[#6AD4B0] bg-[#6AD4B0]/14'
                              : 'border-ink/12 bg-surface hover:border-ink/30'
                        }`}
                      >
                        <div>
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium text-ink">{item.name}</span>
                            <span className="font-mono text-sm font-semibold tabular-nums text-ink shrink-0">
                              {currency}
                              {item.price.toFixed(2)}
                            </span>
                          </div>
                          {item.description && (
                            <p className="mt-1 text-xs leading-relaxed text-ink/55">
                              {item.description}
                            </p>
                          )}
                        </div>
                        <div className="mt-3 flex items-center justify-between text-xs">
                          <span className="text-ink/50">
                            {item.category}
                            {inCart ? ` · ${inCart.qty} in ticket` : ''}
                          </span>
                          <HoverTip
                            text={
                              item.available
                                ? 'Mark this dish temporarily sold out so staff cannot add it to tickets.'
                                : 'Restore this dish as available for ordering.'
                            }
                          >
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleAvailability(item);
                              }}
                              className="text-ink/55 hover:text-ink underline-offset-2 hover:underline whitespace-nowrap"
                            >
                              {item.available ? 'Sold' : 'Restore'}
                            </button>
                          </HoverTip>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Right Cols (Desktop / Landscape Tablet): Current Ticket Builder */}
            <div className="hidden md:block md:col-span-5 xl:col-span-4 rounded-2xl border border-ink/12 bg-surface p-4 lg:p-5 space-y-4 lg:space-y-5 md:sticky md:top-4">
              <div className="flex items-center justify-between border-b border-ink/8 pb-4">
                <h2 className="text-base font-semibold text-ink">Current Ticket</h2>
                {cart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setCart([])}
                    className="text-xs font-medium text-danger-ink hover:underline"
                  >
                    Clear
                  </button>
                )}
              </div>
              {ticketBuilderBody}
            </div>
          </div>
        )}

        {/* ===================== TAB 2: ORDER HISTORY ===================== */}
        {activeTab === 'history' && (
          <div className="space-y-5">
            {/* Compact KPI Summary Strip */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                <div className="text-xs font-medium text-ink/55">
                  Orders ({historyRangePreset === 'all' ? 'All Time' : historyRangePreset === '7d' ? 'Last 7 Days' : 'Last 30 Days'})
                </div>
                <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-ink">
                  {displayedTotal}
                </div>
              </div>
              <div
                className={`rounded-2xl border p-4 ${
                  displayedUnpaidCount > 0
                    ? 'border-[#E05252]/40 bg-[#E05252]/[0.06]'
                    : 'border-ink/10 bg-surface'
                }`}
              >
                <div
                  className={`text-xs font-medium ${
                    displayedUnpaidCount > 0 ? 'text-danger-ink' : 'text-ink/55'
                  }`}
                >
                  Unpaid Dine-In Tabs
                </div>
                <div className="mt-1.5 flex items-baseline justify-between gap-2">
                  <span
                    className={`font-mono text-2xl font-semibold tabular-nums ${
                      displayedUnpaidCount > 0 ? 'text-danger-ink' : 'text-ink'
                    }`}
                  >
                    {displayedUnpaidCount}
                  </span>
                  <span
                    className={`font-mono text-xs font-semibold tabular-nums ${
                      displayedUnpaidCount > 0 ? 'text-danger-ink' : 'text-ink/45'
                    }`}
                  >
                    {currency}
                    {displayedUnpaidTotal.toFixed(2)} due
                  </span>
                </div>
              </div>
              <div className="rounded-2xl border border-ink/10 bg-surface p-4">
                <div className="text-xs font-medium text-ink/55">Paid &amp; Posted Orders</div>
                <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-accent-ink">
                  {displayedPaidCount}
                </div>
              </div>
            </div>

            {/* Filter, Date Range & Search Toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap items-center gap-1 rounded-xl bg-ink/[0.05] p-1">
                  {(
                    [
                      ['all', 'All'],
                      ['unpaid', `Unpaid (${displayedUnpaidCount})`],
                      ['paid', 'Paid'],
                      ['dine_in', 'Dine-In'],
                      ['room_service', 'Room Service'],
                      ['voided', displayedVoidedCount > 0 ? `Voided (${displayedVoidedCount})` : 'Voided'],
                    ] as Array<[HistoryFilter, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setHistoryFilter(id)}
                      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap shrink-0 ${
                        historyFilter === id
                          ? (id === 'unpaid' && displayedUnpaidCount > 0) || id === 'voided'
                            ? 'bg-surface text-danger-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                            : 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                          : id === 'unpaid' && displayedUnpaidCount > 0
                            ? 'text-danger-ink/85 hover:text-danger-ink'
                            : 'text-ink/60 hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="inline-flex rounded-xl bg-ink/[0.05] p-1">
                  {(
                    [
                      ['7d', '7d'],
                      ['30d', '30d'],
                      ['all', 'All'],
                    ] as const
                  ).map(([preset, label]) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setHistoryRangePreset(preset)}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        historyRangePreset === preset
                          ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                          : 'text-ink/60 hover:text-ink'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative w-full sm:w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40" />
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Search ticket, guest, table, item..."
                  className="w-full rounded-xl border border-ink/12 bg-surface py-2 pl-9 pr-3 text-xs text-ink placeholder:text-ink/40"
                />
              </div>
            </div>

            {/* Order History Table + Pagination */}
            <div className="overflow-hidden rounded-2xl border border-ink/10 bg-surface">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-ink/10 bg-ink/[0.02] text-xs font-medium text-ink/55">
                      <th className="py-3 px-4">Ticket</th>
                      <th className="py-3 px-4">Service &amp; Guest</th>
                      <th className="py-3 px-4">Items</th>
                      <th className="py-3 px-4">Payment</th>
                      <th className="py-3 px-4 text-right">Total</th>
                      <th className="py-3 px-4">Kitchen</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className={`divide-y divide-ink/8 text-sm ${historyLoading ? 'opacity-65' : ''}`}>
                    {displayedOrders.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-12 text-center space-y-3">
                          <div className="text-xs text-ink/50">
                            No restaurant orders match this filter and date window.
                          </div>
                          <button
                            type="button"
                            onClick={() => setActiveTab('pos')}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                          >
                            <Plus className="h-3.5 w-3.5" />
                            Start New Order
                          </button>
                        </td>
                      </tr>
                    ) : (
                      displayedOrders.map((order) => {
                        const items = parseOrderItems(order.items_json);
                        const isVoided = order.voided === 1;
                        const isUnpaid = !isVoided && order.payment_status === 'unpaid';

                        return (
                          <tr
                            key={order.id}
                            className={
                              isVoided
                                ? 'bg-[#E05252]/[0.05] opacity-70 transition-colors'
                                : isUnpaid
                                  ? 'bg-[#E05252]/[0.08] hover:bg-[#E05252]/[0.13] transition-colors'
                                  : 'bg-surface hover:bg-ink/[0.02] transition-colors'
                            }
                          >
                            <td className="py-3.5 px-4 font-mono text-xs tabular-nums whitespace-nowrap">
                              <div
                                className={`font-semibold ${
                                  isVoided
                                    ? 'line-through text-ink/55'
                                    : isUnpaid
                                      ? 'text-danger-ink'
                                      : 'text-ink'
                                }`}
                              >
                                {order.order_number}
                              </div>
                              <div className="text-ink/45">{formatTimestamp(order.created_at)}</div>
                            </td>

                            <td className="py-3.5 px-4">
                              <div className={`font-medium text-ink ${isVoided ? 'line-through opacity-75' : ''}`}>
                                {order.room_number ? `Room ${order.room_number} · ` : ''}
                                {order.guest_name}
                              </div>
                              <div className="text-xs text-ink/50 capitalize">
                                {order.dining_type.replace('_', ' ')}
                                {order.table_number ? ` · Table ${order.table_number}` : ''}
                              </div>
                              {isVoided && (
                                <div className="mt-0.5 text-[11px] font-medium text-danger-ink">
                                  Voided
                                  {order.void_reason ? ` · ${order.void_reason}` : ''}
                                  {order.voided_by ? ` — by ${order.voided_by}` : ''}
                                </div>
                              )}
                              {!isVoided && order.notes && (
                                <div className="mt-0.5 text-[11px] text-ink/45 truncate max-w-[200px]">
                                  Note: {order.notes}
                                </div>
                              )}
                            </td>

                            <td className={`py-3.5 px-4 text-xs text-ink/75 max-w-xs ${isVoided ? 'line-through opacity-70' : ''}`}>
                              {items.map((i) => `${i.qty}× ${i.name}`).join(', ')}
                            </td>

                            {/* Payment column: Voided in soft red; Unpaid in soft red; Paid in normal row with ONLY "Paid" text green */}
                            <td className="py-3.5 px-4 text-xs whitespace-nowrap">
                              {isVoided ? (
                                <div>
                                  <div className="font-semibold text-danger-ink">Voided</div>
                                  <div className="text-[11px] text-danger-ink/75">Reversed</div>
                                </div>
                              ) : isUnpaid ? (
                                <div>
                                  <div className="font-semibold text-danger-ink">Unpaid</div>
                                  <div className="text-[11px] text-danger-ink/75">
                                    Awaiting settlement
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div className="font-semibold text-accent-ink">Paid</div>
                                  <div className="text-[11px] text-ink/55">
                                    {order.settlement === 'folio' && order.stay_id && canOpenFolio ? (
                                      <button
                                        type="button"
                                        onClick={() => onOpenFolio(order.stay_id!)}
                                        className="underline underline-offset-2 hover:text-ink"
                                      >
                                        Posted to Folio
                                      </button>
                                    ) : order.settlement === 'folio' ? (
                                      'Posted to Folio'
                                    ) : (
                                      formatMethodLabel(order.settlement)
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right font-mono text-sm tabular-nums whitespace-nowrap">
                              <div
                                className={`font-semibold ${
                                  isVoided
                                    ? 'line-through text-ink/45'
                                    : isUnpaid
                                      ? 'text-danger-ink'
                                      : 'text-ink'
                                }`}
                              >
                                {currency}
                                {order.total_amount.toFixed(2)}
                              </div>
                              {taxEnabled && order.tax_amount > 0 && (
                                <div className="text-[11px] text-ink/45">
                                  incl. {currency}
                                  {order.tax_amount.toFixed(2)} tax
                                </div>
                              )}
                            </td>

                            <td className="py-3.5 px-4 whitespace-nowrap">
                              {isVoided ? (
                                <span className="inline-block rounded-lg border border-[#E05252]/30 bg-[#E05252]/10 px-2.5 py-1 text-xs font-medium text-danger-ink">
                                  Voided
                                </span>
                              ) : (
                                <select
                                  aria-label={`Order ${order.order_number} kitchen status`}
                                  value={order.status}
                                  onChange={(e) =>
                                    handleUpdateOrderStatus(order, e.target.value as PosOrder['status'])
                                  }
                                  className="rounded-lg border border-ink/15 bg-surface px-2.5 py-1 text-xs text-ink"
                                >
                                  <option value="open">Open</option>
                                  <option value="preparing">Preparing</option>
                                  <option value="served">Served</option>
                                  <option value="closed">Closed</option>
                                </select>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-right whitespace-nowrap">
                              <div className="inline-flex items-center gap-1.5">
                                {isUnpaid && (
                                  <HoverTip text="Record payment or post this unpaid tab to an in-house guest folio.">
                                    <button
                                      type="button"
                                      onClick={() => openSettleModal(order)}
                                      className="rounded-lg bg-[#6AD4B0] px-2.5 py-1.5 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
                                    >
                                      Settle
                                    </button>
                                  </HoverTip>
                                )}
                                <HoverTip text="Open printable kitchen preparation docket for this order.">
                                  <button
                                    type="button"
                                    onClick={() => setPrintDoc({ mode: 'docket', order })}
                                    className="inline-flex items-center gap-1 rounded-lg border border-ink/15 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-ink/[0.04]"
                                  >
                                    <Printer className="h-3.5 w-3.5" />
                                    <span>Docket</span>
                                  </button>
                                </HoverTip>
                                <HoverTip text="Open printable itemized guest receipt with tax and payment status.">
                                  <button
                                    type="button"
                                    onClick={() => setPrintDoc({ mode: 'receipt', order })}
                                    className="inline-flex items-center gap-1 rounded-lg border border-ink/15 bg-surface px-2.5 py-1.5 text-xs font-medium text-ink hover:bg-ink/[0.04]"
                                  >
                                    <Receipt className="h-3.5 w-3.5" />
                                    <span>Receipt</span>
                                  </button>
                                </HoverTip>
                                {!isVoided &&
                                  (canVoid ? (
                                    <HoverTip text="Void & reverse this POS order with an audit reason and contra journal voucher.">
                                      <button
                                        type="button"
                                        onClick={() => setVoidOrderTarget(order)}
                                        aria-label={`Void ${order.order_number}`}
                                        className="inline-flex items-center gap-1 rounded-lg border border-[#E05252]/30 bg-surface px-2 py-1.5 text-xs font-medium text-danger-ink hover:bg-[#E05252]/10"
                                      >
                                        <RotateCcw className="h-3.5 w-3.5" />
                                        <span>Void</span>
                                      </button>
                                    </HoverTip>
                                  ) : (
                                    <HoverTip text="Voiding POS orders is locked to Management, Accountant, and Auditor accounts.">
                                      <button
                                        type="button"
                                        disabled
                                        aria-disabled="true"
                                        aria-label={`Void locked for ${order.order_number}`}
                                        className="inline-flex items-center gap-1 rounded-lg border border-ink/12 bg-ink/[0.03] px-2 py-1.5 text-xs font-medium text-ink/50 opacity-45 cursor-not-allowed"
                                      >
                                        <Lock className="h-3.5 w-3.5" />
                                        <span>Void</span>
                                      </button>
                                    </HoverTip>
                                  ))}
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
                page={historyPage}
                pageSize={historyPageSize}
                totalItems={displayedTotal}
                onPageChange={setHistoryPage}
                onPageSizeChange={setHistoryPageSize}
                itemLabel="orders"
              />
            </div>
          </div>
        )}
        </div>

        {/* Sticky Bottom Ticket Bar for Portrait Tablets & Small Screens (< md) */}
        {activeTab === 'pos' && (
          <div className="no-print md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-ink/12 bg-surface/95 backdrop-blur-md px-4 py-3">
            <button
              type="button"
              onClick={() => setTicketDrawerOpen(true)}
              className="flex w-full items-center justify-between rounded-xl bg-[#6AD4B0] px-4 py-3 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors"
            >
              <span className="inline-flex items-center gap-2">
                <ShoppingBag className="h-4 w-4" />
                <span>
                  Current Ticket ({cartItemCount} {cartItemCount === 1 ? 'item' : 'items'})
                </span>
              </span>
              <span className="font-mono tabular-nums">
                {currency}
                {taxCalc.totalAmount.toFixed(2)}
              </span>
            </button>
          </div>
        )}
      </div>

      {/* ===================== TABLET / MOBILE TICKET SLIDE-OVER DRAWER ===================== */}
      <Drawer
        open={ticketDrawerOpen}
        onClose={() => setTicketDrawerOpen(false)}
        title="Current Ticket"
        subtitle={`${cartItemCount} ${cartItemCount === 1 ? 'item' : 'items'} · ${currency}${taxCalc.totalAmount.toFixed(2)}`}
        headerActions={
          cart.length > 0 ? (
            <button
              type="button"
              onClick={() => setCart([])}
              className="rounded-lg px-2 py-1 text-xs font-medium text-danger-ink hover:bg-[#E05252]/10"
            >
              Clear
            </button>
          ) : undefined
        }
        widthClass="max-w-md"
      >
        {ticketBuilderBody}
      </Drawer>

      {/* ===================== SETTLE UNPAID ORDER SLIDE-OVER DRAWER ===================== */}
      <Drawer
        open={settleOrder !== null}
        onClose={() => !settling && setSettleOrder(null)}
        title={settleOrder ? `Settle ${settleOrder.order_number}` : 'Settle Order'}
        subtitle={
          settleOrder
            ? `${settleOrder.guest_name}${settleOrder.table_number ? ` · Table ${settleOrder.table_number}` : ''}`
            : undefined
        }
        widthClass="max-w-md"
      >
        {settleOrder && (
          <div className="space-y-5">
            {/* Order Items & Tax Summary */}
            <div className="rounded-xl border border-ink/10 bg-ink/[0.02] p-4 space-y-2.5">
              <div className="space-y-1.5">
                {parseOrderItems(settleOrder.items_json).map((item, idx) => (
                  <div key={`${item.name}-${idx}`} className="flex justify-between text-xs text-ink">
                    <span>
                      {item.qty}× {item.name}
                    </span>
                    <span className="font-mono tabular-nums">
                      {currency}
                      {(item.qty * item.price).toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>

              <div className="border-t border-ink/10 pt-2.5 space-y-1 text-xs">
                <div className="flex justify-between text-ink/60">
                  <span>{taxEnabled ? 'Net Subtotal' : 'Subtotal'}</span>
                  <span className="font-mono tabular-nums">
                    {currency}
                    {settleOrder.subtotal.toFixed(2)}
                  </span>
                </div>
                {taxEnabled &&
                  parseTaxBreakdown(settleOrder.tax_breakdown_json).map((taxItem) => (
                    <div
                      key={`${taxItem.name}-${taxItem.rate}`}
                      className="flex justify-between text-ink/60"
                    >
                      <span>
                        {taxItem.name} ({taxItem.rate}% {taxItem.mode === 'inclusive' ? 'incl.' : 'excl.'})
                      </span>
                      <span className="font-mono tabular-nums">
                        {currency}
                        {taxItem.amount.toFixed(2)}
                      </span>
                    </div>
                  ))}
                <div className="flex justify-between pt-2 border-t border-ink/10 text-sm font-semibold">
                  <span className="text-ink">Amount Due</span>
                  <span className="font-mono tabular-nums text-danger-ink">
                    {currency}
                    {settleOrder.total_amount.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>

            {/* Payment Method */}
            <div className="space-y-2">
              <div className="text-xs font-medium text-ink/65">Payment Method</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 rounded-xl bg-ink/[0.05] p-1">
                {(
                  [
                    ['card', 'Card'],
                    ['cash', 'Cash'],
                    ['bank_transfer', 'Transfer'],
                    ['folio', 'Room Folio'],
                  ] as Array<[SettlePaymentMethod, string]>
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSettleMethod(id)}
                    className={`rounded-lg py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                      settleMethod === id
                        ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                        : 'text-ink/60 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {settleMethod === 'folio' ? (
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-ink/65">
                  Checked-In Room <span className="text-danger-ink">*</span>
                </label>
                {checkedInStays.length === 0 ? (
                  <p className="text-xs text-danger-ink">
                    No checked-in rooms available. Choose Card, Cash, or Transfer instead.
                  </p>
                ) : (
                  <select
                    value={settleStayId}
                    onChange={(e) => setSettleStayId(e.target.value)}
                    className="w-full rounded-xl border border-ink/15 bg-surface px-3.5 py-2.5 text-sm text-ink"
                  >
                    <option value="">Select checked-in room...</option>
                    {checkedInStays.map((stay) => (
                      <option key={stay.id} value={stay.id}>
                        Room {stay.room_number} · {stay.guest_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-ink/65 mb-1.5">
                  Payment Reference <span className="text-ink/35 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={settleReference}
                  onChange={(e) => setSettleReference(e.target.value)}
                  placeholder="Card last 4, POS slip #, transfer ref..."
                  className="w-full rounded-xl border border-ink/15 px-3.5 py-2 text-sm text-ink"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                disabled={settling}
                onClick={() => setSettleOrder(null)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={settling || (settleMethod === 'folio' && !settleStayId)}
                onClick={() => handleConfirmSettle(false)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/18 bg-surface px-4 py-2 text-xs font-semibold text-ink hover:bg-ink/[0.04] disabled:opacity-40"
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-accent-ink" />
                <span>{settling ? 'Settling...' : 'Confirm Payment'}</span>
              </button>
              <button
                type="button"
                disabled={settling || (settleMethod === 'folio' && !settleStayId)}
                onClick={() => handleConfirmSettle(true)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-40"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>{settling ? 'Settling...' : 'Confirm & Print Receipt'}</span>
              </button>
            </div>
          </div>
        )}
      </Drawer>

      {/* ===================== PRINTABLE DOCKET & RECEIPT SLIDE-OVER DRAWER ===================== */}
      <Drawer
        open={printDoc !== null}
        onClose={() => setPrintDoc(null)}
        title={
          printDoc
            ? printDoc.mode === 'docket'
              ? `Kitchen Docket · ${printDoc.order.order_number}`
              : `Guest Receipt · ${printDoc.order.order_number}`
            : 'Print Preview'
        }
        subtitle={printDoc ? printDoc.order.guest_name : undefined}
        widthClass="max-w-md"
        printable
        headerActions={
          printDoc ? (
            <div className="inline-flex items-center gap-1 rounded-lg bg-ink/[0.06] p-0.5">
              <button
                type="button"
                onClick={() => setPrintDoc({ ...printDoc, mode: 'docket' })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  printDoc.mode === 'docket'
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                Docket
              </button>
              <button
                type="button"
                onClick={() => setPrintDoc({ ...printDoc, mode: 'receipt' })}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  printDoc.mode === 'receipt'
                    ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                    : 'text-ink/60 hover:text-ink'
                }`}
              >
                Receipt
              </button>
            </div>
          ) : undefined
        }
      >
        {printDoc && (
          <div className="space-y-5 print-ticket-card">
            {/* Printable Thermal / Slip Content */}
            <div className="rounded-2xl border border-ink/10 bg-canvas p-5 text-ink space-y-4">
              {printDoc.mode === 'docket' ? (
                /* ---------- KITCHEN DOCKET ---------- */
                <>
                  <div className="text-center border-b border-dashed border-ink/25 pb-3.5 space-y-1">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-ink/60">
                      {settings.hotel_name}
                    </div>
                    <div className="text-lg font-bold tracking-tight">KITCHEN DOCKET</div>
                    <div className="font-mono text-xs text-ink/65">
                      {printDoc.order.order_number} · {formatTimestamp(printDoc.order.created_at)}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-b border-dashed border-ink/25 pb-3.5 text-xs">
                    <div>
                      <div className="text-ink/50">Service</div>
                      <div className="font-semibold uppercase">
                        {printDoc.order.dining_type === 'room_service' ? 'Room Service' : 'Dine-In'}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-ink/50">
                        {printDoc.order.room_number ? 'Room' : 'Table'}
                      </div>
                      <div className="font-semibold">
                        {printDoc.order.room_number
                          ? `Room ${printDoc.order.room_number}`
                          : printDoc.order.table_number || 'Counter / Walk-in'}
                      </div>
                    </div>
                    <div className="col-span-2">
                      <span className="text-ink/50">Guest: </span>
                      <span className="font-medium">{printDoc.order.guest_name}</span>
                    </div>
                  </div>

                  <div className="space-y-2.5 border-b border-dashed border-ink/25 pb-4">
                    {parseOrderItems(printDoc.order.items_json).map((item, idx) => (
                      <div
                        key={`${item.name}-${idx}`}
                        className="flex items-start justify-between gap-3 text-base font-semibold"
                      >
                        <span>
                          <span className="font-mono mr-2">{item.qty}×</span>
                          {item.name}
                        </span>
                      </div>
                    ))}
                  </div>

                  {printDoc.order.notes && (
                    <div className="rounded-xl border border-ink/15 p-3 text-xs">
                      <div className="font-semibold uppercase tracking-wide text-ink/60 mb-1">
                        Kitchen Notes
                      </div>
                      <div className="text-sm font-medium text-ink">{printDoc.order.notes}</div>
                    </div>
                  )}

                  <div className="pt-1 text-center text-[11px] text-ink/45">
                    Powered by Hosila
                  </div>
                </>
              ) : (
                /* ---------- GUEST RECEIPT ---------- */
                <>
                  <div className="text-center border-b border-dashed border-ink/25 pb-4 space-y-1">
                    {settings.hotel_logo_url && (
                      <img
                        src={settings.hotel_logo_url}
                        alt={settings.hotel_name}
                        className="mx-auto mb-2 h-10 w-auto object-contain"
                      />
                    )}
                    <div className="text-base font-bold tracking-tight">{settings.hotel_name}</div>
                    {settings.hotel_address && (
                      <div className="text-[11px] text-ink/60">{settings.hotel_address}</div>
                    )}
                    <div className="text-[11px] text-ink/60">
                      {[settings.hotel_phone, settings.hotel_email].filter(Boolean).join(' · ')}
                    </div>
                    {taxEnabled && settings.tax_id && (
                      <div className="text-[11px] font-mono text-ink/55">
                        Tax ID: {settings.tax_id}
                      </div>
                    )}
                    <div className="pt-1.5 text-xs font-semibold uppercase tracking-[0.12em]">
                      Restaurant Receipt
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-y-1 text-xs border-b border-dashed border-ink/25 pb-3.5">
                    <span className="text-ink/55">Receipt #</span>
                    <span className="text-right font-mono font-medium">
                      {printDoc.order.order_number}
                    </span>
                    <span className="text-ink/55">Date</span>
                    <span className="text-right font-mono">
                      {formatTimestamp(printDoc.order.created_at)}
                    </span>
                    <span className="text-ink/55">Guest</span>
                    <span className="text-right font-medium">{printDoc.order.guest_name}</span>
                    <span className="text-ink/55">Service</span>
                    <span className="text-right capitalize">
                      {printDoc.order.dining_type === 'room_service'
                        ? `Room Service · Room ${printDoc.order.room_number ?? ''}`
                        : `Dine-In${printDoc.order.table_number ? ` · ${printDoc.order.table_number}` : ''}`}
                    </span>
                  </div>

                  {/* Line Items */}
                  <div className="space-y-2 border-b border-dashed border-ink/25 pb-3.5 text-xs">
                    {parseOrderItems(printDoc.order.items_json).map((item, idx) => (
                      <div key={`${item.name}-${idx}`} className="flex justify-between gap-2">
                        <span className="text-ink">
                          {item.qty}× {item.name}
                        </span>
                        <span className="font-mono tabular-nums text-ink shrink-0">
                          {currency}
                          {(item.qty * item.price).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Totals & Multi-Tax Breakdown */}
                  <div className="space-y-1.5 border-b border-dashed border-ink/25 pb-3.5 text-xs">
                    <div className="flex justify-between text-ink/65">
                      <span>{taxEnabled ? 'Subtotal (Net)' : 'Subtotal'}</span>
                      <span className="font-mono tabular-nums">
                        {currency}
                        {printDoc.order.subtotal.toFixed(2)}
                      </span>
                    </div>
                    {taxEnabled &&
                      (parseTaxBreakdown(printDoc.order.tax_breakdown_json).length > 0 ? (
                        parseTaxBreakdown(printDoc.order.tax_breakdown_json).map((taxItem) => (
                          <div
                            key={`${taxItem.name}-${taxItem.rate}`}
                            className="flex justify-between text-ink/65"
                          >
                            <span>
                              {taxItem.name} ({taxItem.rate}%{' '}
                              {taxItem.mode === 'inclusive' ? 'incl.' : 'excl.'})
                            </span>
                            <span className="font-mono tabular-nums">
                              {currency}
                              {taxItem.amount.toFixed(2)}
                            </span>
                          </div>
                        ))
                      ) : printDoc.order.tax_amount > 0 ? (
                        <div className="flex justify-between text-ink/65">
                          <span>Tax</span>
                          <span className="font-mono tabular-nums">
                            {currency}
                            {printDoc.order.tax_amount.toFixed(2)}
                          </span>
                        </div>
                      ) : null)}

                    <div className="flex justify-between pt-2 text-sm font-bold text-ink">
                      <span>TOTAL</span>
                      <span className="font-mono tabular-nums">
                        {currency}
                        {printDoc.order.total_amount.toFixed(2)}
                      </span>
                    </div>
                  </div>

                  {/* Payment Status Banner */}
                  <div className="text-center space-y-1 pt-1">
                    {printDoc.order.payment_status === 'unpaid' ? (
                      <div className="text-xs font-bold uppercase tracking-wider text-danger-ink">
                        Unpaid — Balance Due {currency}
                        {printDoc.order.total_amount.toFixed(2)}
                      </div>
                    ) : printDoc.order.settlement === 'folio' ? (
                      <div className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
                        Paid · Posted to Room {printDoc.order.room_number} Folio
                      </div>
                    ) : (
                      <div className="text-xs font-semibold uppercase tracking-wider text-accent-ink">
                        Paid · {formatMethodLabel(printDoc.order.settlement)}
                        {printDoc.order.payment_reference
                          ? ` (${printDoc.order.payment_reference})`
                          : ''}
                      </div>
                    )}
                    <div className="text-[11px] text-ink/50 pt-1">
                      Thank you for dining with us
                    </div>
                    <div className="text-[11px] text-ink/40">Powered by Hosila</div>
                  </div>
                </>
              )}
            </div>

            {/* Non-printable action footer */}
            <div className="no-print flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setPrintDoc(null)}
                className="rounded-xl px-4 py-2 text-xs font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-4 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print {printDoc.mode === 'docket' ? 'Docket' : 'Receipt'}</span>
              </button>
            </div>
          </div>
        )}
      </Drawer>

      <VoidConfirmModal
        open={Boolean(voidOrderTarget)}
        target={voidOrderSummary}
        reasonPresets={voidReasonPresets}
        submitting={voidSubmitting}
        onClose={() => !voidSubmitting && setVoidOrderTarget(null)}
        onConfirm={handleConfirmVoidOrder}
      />
    </>
  );
}
