import { useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRightLeft,
  CalendarPlus,
  Clock,
  CreditCard,
  Gift,
  Lock,
  LogOut,
  Mail,
  Plus,
  Printer,
  RotateCcw,
  Split,
  Trash2,
} from 'lucide-react';
import type {
  FolioCharge,
  FolioPayment,
  HotelSettings,
  Room,
  SplitPaymentLeg,
  StaffRole,
  Stay,
  TaxBreakdownItem,
} from '../types';
import { addDaysIso, countNightsBetween, datesOverlap } from '../utils/constants';
import { getLocalTodayIso } from '../utils/dateValidation';
import { calculateTax, domainForChargeCategory } from '../utils/tax';
import { HoverTip } from './HoverTip';
import { Modal } from './Modal';
import { VoidConfirmModal, type VoidTargetSummary } from './VoidConfirmModal';

interface GuestFolioViewProps {
  stay: Stay | null;
  rooms: Room[];
  stays: Stay[];
  charges: FolioCharge[];
  payments: FolioPayment[];
  settings: HotelSettings;
  userRole: StaffRole;
  voidReasonPresets?: string[];
  onBack: () => void;
  onRequestCheckOut: (stay: Stay) => void;
  mutate: <T = unknown>(
    url: string,
    method: 'POST' | 'PATCH' | 'DELETE',
    body?: Record<string, unknown>,
    successMessage?: string
  ) => Promise<T | null>;
}

const CATEGORY_LABELS: Record<FolioCharge['category'], string> = {
  room: 'Room',
  restaurant_pos: 'Restaurant POS',
  restaurant_manual: 'Restaurant (Manual)',
  service: 'Service',
  tax_adjustment: 'Adjustment / Credit',
};

type BillView = 'combined' | 'company' | 'personal';

export function GuestFolioView({
  stay,
  rooms,
  stays,
  charges,
  payments,
  settings,
  userRole,
  voidReasonPresets = [],
  onBack,
  onRequestCheckOut,
  mutate,
}: GuestFolioViewProps) {
  const canFinancialControl =
    userRole === 'management' || userRole === 'accountant' || userRole === 'auditor';
  const canWaiveBill = userRole === 'management' || userRole === 'accountant';

  const [billView, setBillView] = useState<BillView>('combined');

  // Modals
  const [chargeModalOpen, setChargeModalOpen] = useState(false);
  const [paymentModalOpen, setPaymentModalOpen] = useState(false);
  const [refundModalOpen, setRefundModalOpen] = useState(false);
  const [refundTab, setRefundTab] = useState<'refund' | 'credit_note'>('refund');
  const [waiveModalOpen, setWaiveModalOpen] = useState(false);
  const [extendModalOpen, setExtendModalOpen] = useState(false);
  const [moveRoomModalOpen, setMoveRoomModalOpen] = useState(false);
  const [voidTarget, setVoidTarget] = useState<{
    kind: 'charge' | 'payment';
    id: number;
    summary: VoidTargetSummary;
  } | null>(null);
  const [voidSubmitting, setVoidSubmitting] = useState(false);

  // Complimentary Bill Waiver form (Management & Accountant ONLY)
  const [waiveRoom, setWaiveRoom] = useState(false);
  const [waiveFood, setWaiveFood] = useState(false);
  const [waiveServices, setWaiveServices] = useState(false);
  const [waiveReason, setWaiveReason] = useState('');
  const [waiveRef, setWaiveRef] = useState('');

  // Post charge form
  const [chargeCategory, setChargeCategory] = useState<FolioCharge['category']>('restaurant_manual');
  const [chargeDescription, setChargeDescription] = useState('');
  const [chargeRef, setChargeRef] = useState('');
  const [chargeQty, setChargeQty] = useState('1');
  const [chargeUnitPrice, setChargeUnitPrice] = useState('');
  const [chargeSplit, setChargeSplit] = useState<'personal' | 'company'>('personal');

  // Split payments form
  const [paymentLegs, setPaymentLegs] = useState<SplitPaymentLeg[]>([
    { amount: '', method: 'card', reference: '', billing_split: 'personal' },
  ]);

  // Refund & Credit Note form
  const [refundAmount, setRefundAmount] = useState('');
  const [refundMethod, setRefundMethod] = useState<FolioPayment['method']>('cash');
  const [refundRef, setRefundRef] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [refundSplit, setRefundSplit] = useState<'personal' | 'company'>('personal');

  const [creditCategory, setCreditCategory] = useState<FolioCharge['category']>('tax_adjustment');
  const [creditDescription, setCreditDescription] = useState('');
  const [creditAmount, setCreditAmount] = useState('');
  const [creditApplyTax, setCreditApplyTax] = useState(false);
  const [creditRef, setCreditRef] = useState('');
  const [creditSplit, setCreditSplit] = useState<'personal' | 'company'>('personal');

  // Extend Stay form
  const [extendNewOutDate, setExtendNewOutDate] = useState('');
  const [extendRate, setExtendRate] = useState('');
  const [extendTargetRoomId, setExtendTargetRoomId] = useState('');
  const [extendBillingSplit, setExtendBillingSplit] = useState<'personal' | 'company'>('personal');

  // Move Room form
  const [moveTargetRoomId, setMoveTargetRoomId] = useState('');
  const [moveUpdateRate, setMoveUpdateRate] = useState(true);
  const [moveReason, setMoveReason] = useState('');
  const [moveBillingSplit, setMoveBillingSplit] = useState<'personal' | 'company'>('personal');

  const [submitting, setSubmitting] = useState(false);

  const today = getLocalTodayIso();
  const currency = settings.currency_symbol;
  const showTaxRow = settings.tax_enabled === 1;

  const stayCharges = useMemo(
    () => (stay ? charges.filter((c) => c.stay_id === stay.id) : []),
    [charges, stay]
  );

  const stayPayments = useMemo(
    () => (stay ? payments.filter((p) => p.stay_id === stay.id) : []),
    [payments, stay]
  );

  const hasCompanySplitItems = useMemo(
    () =>
      stayCharges.some((c) => !c.voided && (c.billing_split ?? 'personal') === 'company') ||
      stayPayments.some((p) => !p.voided && (p.billing_split ?? 'personal') === 'company'),
    [stayCharges, stayPayments]
  );

  const visibleCharges = useMemo(() => {
    if (billView === 'combined') return stayCharges;
    return stayCharges.filter((c) => (c.billing_split ?? 'personal') === billView);
  }, [stayCharges, billView]);

  const visiblePayments = useMemo(() => {
    if (billView === 'combined') return stayPayments;
    return stayPayments.filter((p) => (p.billing_split ?? 'personal') === billView);
  }, [stayPayments, billView]);

  // Split-aware totals (excluding voided charges & voided payments)
  const activeTotals = useMemo(() => {
    const activeChg = visibleCharges.filter((c) => !c.voided);
    const activePay = visiblePayments.filter((p) => !p.voided);
    const subtotal = Math.round(activeChg.reduce((s, c) => s + c.amount, 0) * 100) / 100;
    const tax = Math.round(activeChg.reduce((s, c) => s + c.tax_amount, 0) * 100) / 100;
    const totalBilled =
      Math.round(activeChg.reduce((s, c) => s + (c.total_amount || c.amount + c.tax_amount), 0) * 100) / 100;
    const totalPaid =
      Math.round(
        activePay.reduce((s, p) => s + (p.kind === 'refund' ? -p.amount : p.amount), 0) * 100
      ) / 100;
    const balanceDue = Math.round((totalBilled - totalPaid) * 100) / 100;
    return { subtotal, tax, totalBilled, totalPaid, balanceDue };
  }, [visibleCharges, visiblePayments]);

  // Live active bucket totals for Complimentary Bill Waiver (Accommodation / Food & Beverage / Services)
  const waiveBuckets = useMemo(() => {
    const active = stayCharges.filter((c) => !c.voided);
    const sumFor = (cats: Array<FolioCharge['category']>) => {
      let net = 0;
      let tax = 0;
      let total = 0;
      for (const ch of active) {
        if (!cats.includes(ch.category)) continue;
        net += ch.amount;
        tax += ch.tax_amount;
        total += ch.total_amount || ch.amount + ch.tax_amount;
      }
      return {
        net: Math.max(0, Math.round(net * 100) / 100),
        tax: Math.max(0, Math.round(tax * 100) / 100),
        total: Math.max(0, Math.round(total * 100) / 100),
      };
    };
    const room = sumFor(['room']);
    const food = sumFor(['restaurant_pos', 'restaurant_manual']);
    const services = sumFor(['service']);
    const anyWaivable = room.total > 0.01 || food.total > 0.01 || services.total > 0.01;
    return { room, food, services, anyWaivable };
  }, [stayCharges]);

  const selectedWaiveTotal = useMemo(() => {
    let total = 0;
    if (waiveRoom) total += waiveBuckets.room.total;
    if (waiveFood) total += waiveBuckets.food.total;
    if (waiveServices) total += waiveBuckets.services.total;
    return Math.round(total * 100) / 100;
  }, [waiveRoom, waiveFood, waiveServices, waiveBuckets]);

  // Aggregate per-tax-rule totals across visible active folio charges
  const folioTaxSummaryLines = useMemo(() => {
    const map = new Map<string, number>();
    for (const ch of visibleCharges) {
      if (ch.voided || ch.tax_amount === 0) continue;
      let parsed: TaxBreakdownItem[] = [];
      if (ch.tax_breakdown_json) {
        try {
          parsed = JSON.parse(ch.tax_breakdown_json) as TaxBreakdownItem[];
        } catch {
          parsed = [];
        }
      }
      const sign = ch.tax_amount < 0 ? -1 : 1;
      if (parsed.length > 0) {
        for (const item of parsed) {
          const label = `${item.name} (${item.rate}%)`;
          map.set(label, Math.round(((map.get(label) ?? 0) + sign * Math.abs(item.amount)) * 100) / 100);
        }
      } else {
        const label = ch.tax_label || 'Tax';
        map.set(label, Math.round(((map.get(label) ?? 0) + ch.tax_amount) * 100) / 100);
      }
    }
    return Array.from(map.entries())
      .filter(([, amount]) => Math.abs(amount) >= 0.005)
      .map(([label, amount]) => ({ label, amount }));
  }, [visibleCharges]);

  // Live tax preview for Post Charge modal
  const rawChargeAmount = Math.max(0, (Number(chargeQty) || 0) * (Number(chargeUnitPrice) || 0));
  const chargeDomain = domainForChargeCategory(chargeCategory);
  const chargeTaxPreview = useMemo(
    () => calculateTax(rawChargeAmount, chargeDomain, settings),
    [rawChargeAmount, chargeDomain, settings]
  );

  // Live Extend Stay preview & optional room switcher candidates
  const extendExtraNights = useMemo(() => {
    if (!stay || !extendNewOutDate) return 0;
    return Math.max(0, countNightsBetween(stay.check_out_date, extendNewOutDate));
  }, [stay, extendNewOutDate]);

  const extendRoomCandidates = useMemo(() => {
    if (!stay || !extendNewOutDate) return [];
    const windowStart =
      today > stay.check_in_date && today < stay.check_out_date ? today : stay.check_out_date;
    return rooms
      .filter((r) => r.id !== stay.room_id)
      .map((room) => {
        const occupiedNow = stays.find(
          (other) => other.id !== stay.id && other.room_id === room.id && other.status === 'checked_in'
        );
        const conflict =
          occupiedNow ??
          stays.find(
            (other) =>
              other.id !== stay.id &&
              other.room_id === room.id &&
              other.status === 'reserved' &&
              datesOverlap(windowStart, extendNewOutDate, other.check_in_date, other.check_out_date)
          );
        const unclean = room.housekeeping_status !== 'clean';
        return { room, conflict, unclean, disabled: Boolean(conflict) || unclean };
      });
  }, [stay, rooms, stays, today, extendNewOutDate]);

  const selectedExtendRoom = useMemo(
    () => (extendTargetRoomId ? rooms.find((r) => String(r.id) === extendTargetRoomId) ?? null : null),
    [rooms, extendTargetRoomId]
  );

  const effectiveExtendRate = useMemo(() => {
    if (!stay) return 0;
    if (canFinancialControl) {
      return Math.max(0, Number(extendRate) || 0);
    }
    return selectedExtendRoom ? selectedExtendRoom.nightly_rate : stay.nightly_rate;
  }, [stay, canFinancialControl, extendRate, selectedExtendRoom]);

  const extendTaxPreview = useMemo(
    () => calculateTax(extendExtraNights * effectiveExtendRate, 'accommodation', settings),
    [extendExtraNights, effectiveExtendRate, settings]
  );

  // Move Room candidates (clean, not current room, no overlapping stay for remaining dates)
  const moveRoomCandidates = useMemo(() => {
    if (!stay) return [];
    const remainingStart = today > stay.check_in_date ? today : stay.check_in_date;
    return rooms
      .filter((r) => r.id !== stay.room_id)
      .map((room) => {
        const occupiedNow = stays.find(
          (other) => other.id !== stay.id && other.room_id === room.id && other.status === 'checked_in'
        );
        const conflict =
          occupiedNow ??
          stays.find(
            (other) =>
              other.id !== stay.id &&
              other.room_id === room.id &&
              other.status === 'reserved' &&
              datesOverlap(remainingStart, stay.check_out_date, other.check_in_date, other.check_out_date)
          );
        const unclean = room.housekeeping_status !== 'clean';
        return { room, conflict, unclean, disabled: Boolean(conflict) || unclean };
      });
  }, [stay, rooms, stays, today]);

  const selectedMoveRoom = useMemo(
    () => rooms.find((r) => String(r.id) === moveTargetRoomId) ?? null,
    [rooms, moveTargetRoomId]
  );

  const remainingNightsForMove = useMemo(() => {
    if (!stay) return 0;
    if (today >= stay.check_out_date) return 0;
    const from = today > stay.check_in_date ? today : stay.check_in_date;
    return Math.max(0, countNightsBetween(from, stay.check_out_date));
  }, [stay, today]);

  const defaultRoomBillingSplit: 'personal' | 'company' = useMemo(() => {
    if (billView === 'company') return 'company';
    if (billView === 'personal') return 'personal';
    const hasCompanyRoom = stayCharges.some(
      (c) => !c.voided && c.category === 'room' && (c.billing_split ?? 'personal') === 'company'
    );
    return hasCompanyRoom ? 'company' : 'personal';
  }, [billView, stayCharges]);

  function openManualChargeModal(defaultCategory: FolioCharge['category'] = 'restaurant_manual') {
    setChargeCategory(defaultCategory);
    setChargeDescription('');
    setChargeRef('');
    setChargeQty('1');
    setChargeUnitPrice('');
    setChargeSplit(billView === 'company' ? 'company' : 'personal');
    setChargeModalOpen(true);
  }

  function openPaymentModal() {
    if (!stay) return;
    const targetSplit: 'personal' | 'company' = billView === 'company' ? 'company' : 'personal';
    const defaultAmt =
      billView === 'combined'
        ? stay.balance_due > 0
          ? stay.balance_due.toFixed(2)
          : ''
        : activeTotals.balanceDue > 0
          ? activeTotals.balanceDue.toFixed(2)
          : '';
    setPaymentLegs([{ amount: defaultAmt, method: 'card', reference: '', billing_split: targetSplit }]);
    setPaymentModalOpen(true);
  }

  function openRefundOrCreditModal(initialTab: 'refund' | 'credit_note' = 'refund') {
    if (!stay) return;
    setRefundTab(initialTab);
    const overpaid = stay.balance_due < 0 ? Math.abs(stay.balance_due).toFixed(2) : '';
    setRefundAmount(overpaid);
    setRefundMethod('cash');
    setRefundRef('');
    setRefundReason('');
    setRefundSplit(billView === 'company' ? 'company' : 'personal');

    setCreditCategory('tax_adjustment');
    setCreditDescription('');
    setCreditAmount('');
    setCreditApplyTax(false);
    setCreditRef('');
    setCreditSplit(billView === 'company' ? 'company' : 'personal');
    setRefundModalOpen(true);
  }

  function openExtendModal() {
    if (!stay) return;
    setExtendNewOutDate(addDaysIso(stay.check_out_date, 1));
    setExtendTargetRoomId('');
    setExtendRate(String(stay.nightly_rate));
    setExtendBillingSplit(defaultRoomBillingSplit);
    setExtendModalOpen(true);
  }

  function handleExtendRoomSelect(roomIdStr: string) {
    setExtendTargetRoomId(roomIdStr);
    if (!stay) return;
    if (!roomIdStr) {
      setExtendRate(String(stay.nightly_rate));
      return;
    }
    const target = rooms.find((r) => String(r.id) === roomIdStr);
    if (target) {
      setExtendRate(String(target.nightly_rate));
    }
  }

  function openMoveRoomModal() {
    if (!stay) return;
    const firstClean = moveRoomCandidates.find((c) => !c.disabled);
    setMoveTargetRoomId(firstClean ? String(firstClean.room.id) : '');
    setMoveUpdateRate(true);
    setMoveReason('');
    setMoveBillingSplit(defaultRoomBillingSplit);
    setMoveRoomModalOpen(true);
  }

  function addSplitPaymentLeg() {
    const entered = paymentLegs.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    const remaining = Math.max(0, Math.round((activeTotals.balanceDue - entered) * 100) / 100);
    const nextMethod: FolioPayment['method'] =
      paymentLegs[paymentLegs.length - 1]?.method === 'card' ? 'cash' : 'bank_transfer';
    setPaymentLegs((prev) => [
      ...prev,
      {
        amount: remaining > 0 ? remaining.toFixed(2) : '',
        method: nextMethod,
        reference: '',
        billing_split: billView === 'company' ? 'company' : 'personal',
      },
    ]);
  }

  function updatePaymentLeg(idx: number, patch: Partial<SplitPaymentLeg>) {
    setPaymentLegs((prev) => prev.map((leg, i) => (i === idx ? { ...leg, ...patch } : leg)));
  }

  function removePaymentLeg(idx: number) {
    setPaymentLegs((prev) => (prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  async function handlePostCharge(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        `/api/stays/${stay.id}/charges`,
        'POST',
        {
          category: chargeCategory,
          description: chargeDescription,
          reference_code: chargeRef,
          quantity: Number(chargeQty) || 1,
          unit_price: Number(chargeUnitPrice),
          billing_split: chargeSplit,
        },
        'Charge posted to guest folio'
      );
      if (ok) setChargeModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleChargeSplit(charge: FolioCharge) {
    const next: 'personal' | 'company' =
      (charge.billing_split ?? 'personal') === 'company' ? 'personal' : 'company';
    await mutate(
      `/api/charges/${charge.id}/split`,
      'PATCH',
      { billing_split: next },
      `Moved to ${next === 'company' ? 'Company Bill' : 'Personal Bill'}`
    );
  }

  async function handleAutoSplitCorporate() {
    if (!stay) return;
    await mutate(
      `/api/stays/${stay.id}/auto-split-folio`,
      'POST',
      {},
      'Room charges assigned to Company Bill; extras assigned to Personal Bill'
    );
  }

  function openVoidChargeModal(charge: FolioCharge) {
    if (!stay || !canFinancialControl) return;
    const lineTotal = charge.total_amount || charge.amount + charge.tax_amount;
    setVoidTarget({
      kind: 'charge',
      id: charge.id,
      summary: {
        entityLabel: lineTotal < 0 ? 'Folio Credit Note' : 'Folio Charge',
        title: charge.description,
        reference: charge.reference_code || stay.confirmation_code,
        party: `${stay.guest_name}${stay.room_id ? ` · Room ${stay.room_number}` : ''}`,
        amount: lineTotal,
        currency,
        warningNote:
          charge.category === 'restaurant_pos'
            ? 'This charge is linked to a Restaurant POS order. Voiding it will also void the linked POS order and post a contra journal entry.'
            : 'Voiding reverses this charge and any associated tax from the guest balance and General Ledger.',
      },
    });
  }

  function openVoidPaymentModal(pay: FolioPayment) {
    if (!stay || !canFinancialControl) return;
    const isRefund = pay.kind === 'refund';
    setVoidTarget({
      kind: 'payment',
      id: pay.id,
      summary: {
        entityLabel: isRefund ? 'Guest Refund' : 'Folio Payment',
        title: `${isRefund ? 'Refund' : 'Payment'} via ${pay.method.replace('_', ' ')}`,
        reference: pay.reference || stay.confirmation_code,
        party: `${stay.guest_name}${stay.room_id ? ` · Room ${stay.room_number}` : ''}`,
        amount: pay.amount,
        currency,
        warningNote: isRefund
          ? 'Voiding this refund restores the guest folio credit balance and reverses the cash/bank outflow in the ledger.'
          : 'Voiding this payment re-opens the corresponding folio balance and reverses the receipt in the General Ledger and shift drawer.',
      },
    });
  }

  async function handleConfirmVoid(reason: string) {
    if (!voidTarget) return;
    setVoidSubmitting(true);
    try {
      const ok =
        voidTarget.kind === 'charge'
          ? await mutate(
              `/api/charges/${voidTarget.id}`,
              'DELETE',
              { reason, confirmed: true },
              'Folio line item voided & reversed'
            )
          : await mutate(
              `/api/payments/${voidTarget.id}/void`,
              'POST',
              { reason, confirmed: true },
              'Folio payment voided & reversed'
            );
      if (ok) {
        setVoidTarget(null);
      }
    } finally {
      setVoidSubmitting(false);
    }
  }

  async function handlePostPayment(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    const validLegs = paymentLegs
      .map((l) => ({
        amount: Number(l.amount) || 0,
        method: l.method,
        reference: l.reference.trim(),
        billing_split: l.billing_split ?? 'personal',
      }))
      .filter((l) => l.amount > 0);
    if (validLegs.length === 0) return;

    setSubmitting(true);
    try {
      const ok = await mutate(
        `/api/stays/${stay.id}/payments`,
        'POST',
        { payments: validLegs },
        validLegs.length > 1
          ? `Split payment (${validLegs.length} methods) recorded on folio`
          : 'Payment recorded on folio'
      );
      if (ok) setPaymentModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmitRefundOrCredit(e: React.FormEvent) {
    e.preventDefault();
    if (!stay) return;
    setSubmitting(true);
    try {
      if (refundTab === 'refund') {
        const ok = await mutate(
          `/api/stays/${stay.id}/refunds`,
          'POST',
          {
            amount: Number(refundAmount),
            method: refundMethod,
            reference: refundRef.trim(),
            reason: refundReason.trim() || 'Guest refund',
            billing_split: refundSplit,
          },
          'Guest refund recorded and posted to ledger'
        );
        if (ok) setRefundModalOpen(false);
      } else {
        const ok = await mutate(
          `/api/stays/${stay.id}/credit-notes`,
          'POST',
          {
            category: creditCategory,
            description: creditDescription.trim(),
            amount: Number(creditAmount),
            apply_tax: creditApplyTax,
            reference_code: creditRef.trim(),
            billing_split: creditSplit,
          },
          'Credit note applied to guest folio'
        );
        if (ok) setRefundModalOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleExtendStay(e: React.FormEvent) {
    e.preventDefault();
    if (!stay || extendExtraNights <= 0) return;
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        new_check_out_date: extendNewOutDate,
        nightly_rate: effectiveExtendRate,
        billing_split: extendBillingSplit,
      };
      if (selectedExtendRoom) {
        payload.new_room_id = selectedExtendRoom.id;
      }
      const ok = await mutate(
        `/api/stays/${stay.id}/extend`,
        'POST',
        payload,
        selectedExtendRoom
          ? `Stay extended by ${extendExtraNights} ${extendExtraNights === 1 ? 'night' : 'nights'} in Room ${selectedExtendRoom.room_number}`
          : `Stay extended by ${extendExtraNights} ${extendExtraNights === 1 ? 'night' : 'nights'}`
      );
      if (ok) setExtendModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleMoveRoom(e: React.FormEvent) {
    e.preventDefault();
    if (!stay || !moveTargetRoomId) return;
    const isUpgrade = selectedMoveRoom ? selectedMoveRoom.nightly_rate > stay.nightly_rate : false;
    const isDowngrade = selectedMoveRoom ? selectedMoveRoom.nightly_rate < stay.nightly_rate : false;
    const effectiveUpdateRate = canFinancialControl
      ? moveUpdateRate
      : isUpgrade
        ? true
        : isDowngrade
          ? false
          : false;
    setSubmitting(true);
    try {
      const ok = await mutate(
        `/api/stays/${stay.id}/move-room`,
        'POST',
        {
          new_room_id: Number(moveTargetRoomId),
          update_rate: effectiveUpdateRate,
          billing_split: moveBillingSplit,
          reason: moveReason.trim(),
        },
        selectedMoveRoom
          ? `Guest moved to Room ${selectedMoveRoom.room_number}`
          : 'Room move completed'
      );
      if (ok) setMoveRoomModalOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  function openWaiveModal() {
    if (!canWaiveBill) return;
    setWaiveRoom(waiveBuckets.room.total > 0.01);
    setWaiveFood(waiveBuckets.food.total > 0.01);
    setWaiveServices(waiveBuckets.services.total > 0.01);
    setWaiveReason('');
    setWaiveRef('');
    setWaiveModalOpen(true);
  }

  async function handleSubmitWaive(e: React.FormEvent) {
    e.preventDefault();
    if (!stay || !canWaiveBill) return;
    if ((!waiveRoom && !waiveFood && !waiveServices) || waiveReason.trim().length < 4) return;
    setSubmitting(true);
    try {
      const ok = await mutate(
        `/api/stays/${stay.id}/waive`,
        'POST',
        {
          waive_room: waiveRoom && waiveBuckets.room.total > 0.01,
          waive_food: waiveFood && waiveBuckets.food.total > 0.01,
          waive_services: waiveServices && waiveBuckets.services.total > 0.01,
          reason: waiveReason.trim(),
          reference_code: waiveRef.trim(),
        },
        `Complimentary bill waiver posted (${currency}${selectedWaiveTotal.toFixed(2)})`
      );
      if (ok) {
        setWaiveModalOpen(false);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSendEmailSummary() {
    if (!stay || settings.email_enabled !== 1) return;
    await mutate(
      `/api/stays/${stay.id}/send-email`,
      'POST',
      { event_type: 'manual' },
      `Folio summary processed for ${stay.guest_email}`
    );
  }

  if (!stay) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/65 hover:text-ink"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Front Desk
        </button>
        <div className="rounded-2xl border border-ink/10 bg-surface py-16 text-center text-sm text-ink/55">
          Folio not found.
        </div>
      </div>
    );
  }

  const isEarlyDeparture = stay.status === 'checked_in' && today < stay.check_out_date;
  const splitLegsTotal =
    Math.round(paymentLegs.reduce((sum, l) => sum + (Number(l.amount) || 0), 0) * 100) / 100;

  return (
    <div className="max-w-4xl mx-auto space-y-5 print-full">
      {/* Top Return & Stay Modification Bar */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </button>

        {stay.status === 'checked_in' && (
          <div className="flex flex-wrap items-center gap-2">
            <HoverTip text="Extend this stay by one or more nights with automatic conflict check and room/tax posting.">
              <button
                type="button"
                onClick={openExtendModal}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors"
              >
                <CalendarPlus className="h-3.5 w-3.5" />
                Extend Stay
              </button>
            </HoverTip>

            <HoverTip text="Relocate guest to another clean room, mark the previous room Dirty, and optionally adjust rate.">
              <button
                type="button"
                onClick={openMoveRoomModal}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 bg-surface px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Move Room
              </button>
            </HoverTip>

            <HoverTip
              text={
                isEarlyDeparture
                  ? 'Check out early with automatic unused-nights credit recalculation and settlement.'
                  : 'Settle remaining folio balance, release room to housekeeping, and email receipt.'
              }
            >
              <button
                type="button"
                onClick={() => onRequestCheckOut(stay)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-4 py-2 text-xs font-medium text-canvas hover:opacity-85 transition-opacity"
              >
                <LogOut className="h-3.5 w-3.5" />
                {isEarlyDeparture ? 'Early Check-Out' : 'Check Out Guest'}
              </button>
            </HoverTip>
          </div>
        )}
      </div>

      {/* Single Folio Sheet */}
      <div className="rounded-2xl border border-ink/12 bg-surface p-6 sm:p-8 space-y-7">
        {/* Printable Hotel Masthead */}
        <div className="flex flex-wrap items-start justify-between gap-6 border-b border-ink/10 pb-6">
          <div>
            {settings.hotel_logo_url && (
              <img
                src={settings.hotel_logo_url}
                alt={settings.hotel_name}
                referrerPolicy="no-referrer"
                className="mb-3 max-h-10 max-w-[160px] object-contain"
              />
            )}
            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/60">
              <span className="h-2 w-2 rounded-full bg-[#6AD4B0]" />
              {settings.hotel_name} ·{' '}
              {billView === 'company'
                ? 'Company Bill'
                : billView === 'personal'
                  ? 'Personal Bill'
                  : 'Guest Folio'}
            </div>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-ink">
              {stay.guest_name}
            </h2>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-ink/60">
              <span className="font-mono tabular-nums">
                {stay.room_id ? `Room ${stay.room_number}` : 'Unassigned'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{stay.room_type}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">{stay.confirmation_code}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums">
                {stay.check_in_date} to {stay.check_out_date}
              </span>
            </div>
            {settings.tax_id && showTaxRow && (
              <div className="mt-1 font-mono text-[11px] text-ink/45">
                Tax ID: {settings.tax_id}
              </div>
            )}
          </div>

          <div className="text-left sm:text-right">
            <div className="text-xs text-ink/55">
              {billView === 'company'
                ? 'Company Balance'
                : billView === 'personal'
                  ? 'Personal Balance'
                  : activeTotals.balanceDue < 0
                    ? 'Overpayment Credit'
                    : 'Current Balance Due'}
            </div>
            <div
              className={`mt-1 font-mono text-3xl font-semibold tabular-nums ${
                activeTotals.balanceDue > 0
                  ? 'text-danger-ink'
                  : activeTotals.balanceDue < 0
                    ? 'text-accent-ink'
                    : 'text-ink'
              }`}
            >
              {activeTotals.balanceDue < 0 ? '−' : ''}
              {currency}
              {Math.abs(activeTotals.balanceDue).toFixed(2)}
            </div>
            <div className="mt-0.5 text-xs text-ink/50 capitalize">
              Status: {stay.status.replace('_', ' ')}
            </div>
          </div>
        </div>

        {/* Settle Later (Unpaid Check-Out) Banner */}
        {stay.status === 'checked_out' && stay.balance_due > 0.01 && (
          <div className="no-print flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#E05252]/35 bg-[#E05252]/[0.05] px-4 py-3 text-xs">
            <div className="flex items-start gap-2.5">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-danger-ink" />
              <div className="space-y-0.5">
                <div className="font-semibold text-danger-ink">
                  Checked Out Unpaid · Settle Later (City Ledger)
                </div>
                <div className="text-ink/75">
                  {stay.deferred_reason || 'Open balance carried after check-out.'}
                  {stay.deferred_authorized_by ? ` — Authorized by ${stay.deferred_authorized_by}` : ''}
                  {stay.deferred_due_date ? ` · Due ${stay.deferred_due_date}` : ''}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={openPaymentModal}
                className="rounded-lg bg-[#6AD4B0] px-3 py-1.5 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 whitespace-nowrap"
              >
                Settle Now
              </button>
              {canWaiveBill && waiveBuckets.anyWaivable && (
                <button
                  type="button"
                  onClick={openWaiveModal}
                  className="rounded-lg border border-ink/15 bg-surface px-3 py-1.5 text-xs font-medium text-ink hover:bg-ink/[0.04] whitespace-nowrap"
                >
                  Waive Remaining
                </button>
              )}
            </div>
          </div>
        )}

        {/* Action Bar + Split Bill Switcher */}
        <div className="no-print space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <HoverTip text="Post a manual restaurant paper ticket, extra room night, service fee, or adjustment to this folio.">
              <button
                type="button"
                onClick={() => openManualChargeModal('restaurant_manual')}
                className="inline-flex items-center gap-1.5 rounded-xl bg-[#6AD4B0] px-3.5 py-2 text-xs font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                Add Charge
              </button>
            </HoverTip>

            <HoverTip text="Record a single or split payment (e.g. Card + Cash) against this folio.">
              <button
                type="button"
                onClick={openPaymentModal}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors whitespace-nowrap shrink-0"
              >
                <CreditCard className="h-3.5 w-3.5" />
                Record Payment
              </button>
            </HoverTip>

            {canWaiveBill ? (
              <HoverTip
                text={
                  waiveBuckets.anyWaivable
                    ? 'Waive Accommodation, Food & Beverage, Services, or the entire bill as a complimentary contra-revenue credit with automatic tax reversal.'
                    : 'All billable accommodation, food, and service balances are already zero.'
                }
              >
                <button
                  type="button"
                  onClick={openWaiveModal}
                  disabled={!waiveBuckets.anyWaivable}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
                >
                  <Gift className="h-3.5 w-3.5" />
                  Waive Bill
                </button>
              </HoverTip>
            ) : (
              <HoverTip text="Complimentary bill waivers (Accommodation, Food, or Full Bill) are locked to Management and Accountant accounts.">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-ink/[0.03] px-3.5 py-2 text-xs font-medium text-ink/55 opacity-50 cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Waive Bill
                </button>
              </HoverTip>
            )}

            {canFinancialControl ? (
              <HoverTip text="Issue a guest cash/card refund for an overpaid balance or post an itemized credit note (Management, Accountant & Auditor only).">
                <button
                  type="button"
                  onClick={() => openRefundOrCreditModal(stay.balance_due < 0 ? 'refund' : 'credit_note')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors whitespace-nowrap shrink-0"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Refund / Credit
                </button>
              </HoverTip>
            ) : (
              <HoverTip text="Refunds and credit notes are locked to Management, Accountant, and Auditor accounts.">
                <button
                  type="button"
                  disabled
                  aria-disabled="true"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-ink/12 bg-ink/[0.03] px-3.5 py-2 text-xs font-medium text-ink/55 opacity-50 cursor-not-allowed whitespace-nowrap shrink-0"
                >
                  <Lock className="h-3.5 w-3.5" />
                  Refund / Credit
                </button>
              </HoverTip>
            )}

            <HoverTip
              text={
                settings.email_enabled !== 1
                  ? 'Email Service is turned off in Settings → Email Config.'
                  : !stay.guest_email
                    ? 'Add an email address to this guest profile to send folio summaries.'
                    : 'Send an itemized HTML folio summary to the guest via Resend.'
              }
            >
              <button
                type="button"
                onClick={handleSendEmailSummary}
                disabled={!stay.guest_email || settings.email_enabled !== 1}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] disabled:opacity-40 transition-colors whitespace-nowrap shrink-0"
              >
                <Mail className="h-3.5 w-3.5" />
                {settings.email_enabled !== 1 ? 'Email Off' : 'Email'}
              </button>
            </HoverTip>

            <HoverTip text="Print the currently selected bill view (Combined, Company Bill, or Personal Bill).">
              <button
                type="button"
                onClick={() => window.print()}
                className="inline-flex items-center gap-1.5 rounded-xl border border-ink/15 px-3 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors whitespace-nowrap shrink-0"
              >
                <Printer className="h-3.5 w-3.5" />
                Print {billView === 'company' ? 'Company' : billView === 'personal' ? 'Personal' : 'Invoice'}
              </button>
            </HoverTip>
          </div>

          {/* Split Bill Selector (Combined / Company / Personal) */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink/10 bg-ink/[0.02] px-3 py-2">
            <div className="inline-flex items-center gap-1 rounded-lg bg-ink/[0.05] p-0.5">
              {(
                [
                  ['combined', `Combined (${currency}${stay.balance_due.toFixed(0)})`],
                  ['company', `Company (${currency}${(stay.company_balance ?? 0).toFixed(0)})`],
                  ['personal', `Personal (${currency}${(stay.personal_balance ?? stay.balance_due).toFixed(0)})`],
                ] as Array<[BillView, string]>
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setBillView(id)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors whitespace-nowrap ${
                    billView === id
                      ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                      : 'text-ink/60 hover:text-ink'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            <HoverTip text="Assigns all Room charges to the Company Bill and all Restaurant/Service extras to the Personal Bill in one click.">
              <button
                type="button"
                onClick={handleAutoSplitCorporate}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-ink/70 hover:text-ink transition-colors whitespace-nowrap"
              >
                <Split className="h-3.5 w-3.5 text-accent-ink" />
                {hasCompanySplitItems ? 'Re-Apply Corporate Split' : 'Auto-Split Corporate'}
              </button>
            </HoverTip>
          </div>
        </div>

        {/* Itemized Charges Table */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">
            Itemized Charges
            {billView !== 'combined' && (
              <span className="ml-2 text-xs font-normal text-ink/50 capitalize">
                ({billView} bill)
              </span>
            )}
          </h3>
          <div className="overflow-x-auto border-t border-ink/10">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-ink/10 text-xs font-medium text-ink/50">
                  <th className="py-2.5 pr-3">Date</th>
                  <th className="py-2.5 px-3">Category</th>
                  <th className="py-2.5 px-3">Description</th>
                  <th className="no-print py-2.5 px-2">Bill</th>
                  <th className="py-2.5 px-3 text-right">Net</th>
                  {showTaxRow && <th className="py-2.5 px-3 text-right">Tax</th>}
                  <th className="py-2.5 pl-3 text-right">Total</th>
                  <th className="no-print py-2.5 pl-3 text-right w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink/8 text-sm">
                {visibleCharges.length === 0 ? (
                  <tr>
                    <td colSpan={showTaxRow ? 8 : 7} className="py-8 text-center text-xs text-ink/45">
                      No charges on this bill view yet.
                    </td>
                  </tr>
                ) : (
                  visibleCharges.map((charge) => {
                    const lineTotal = charge.total_amount || charge.amount + charge.tax_amount;
                    const isCredit = lineTotal < 0;
                    const isVoided = charge.voided === 1;
                    const splitTag = charge.billing_split ?? 'personal';
                    return (
                      <tr key={charge.id} className={isVoided ? 'opacity-60 bg-[#E05252]/[0.04]' : ''}>
                        <td className="py-3 pr-3 font-mono text-xs tabular-nums text-ink/55 whitespace-nowrap">
                          {charge.posted_at.slice(0, 10)}
                        </td>
                        <td className="py-3 px-3 text-xs text-ink/65 whitespace-nowrap">
                          {isCredit ? 'Credit Note' : CATEGORY_LABELS[charge.category]}
                        </td>
                        <td className="py-3 px-3 text-sm text-ink">
                          <div className={isVoided ? 'line-through text-ink/65' : ''}>
                            {charge.description}
                          </div>
                          <div className="font-mono text-[11px] text-ink/45">
                            {charge.posted_by_station}
                            {charge.reference_code ? ` · Ref: ${charge.reference_code}` : ''}
                          </div>
                          {isVoided && (
                            <div className="mt-0.5 text-[11px] font-medium text-danger-ink">
                              Voided
                              {charge.void_reason ? ` · ${charge.void_reason}` : ''}
                              {charge.voided_by ? ` — by ${charge.voided_by}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="no-print py-3 px-2 whitespace-nowrap">
                          {!isVoided ? (
                            <HoverTip text="Click to toggle this line between Personal Bill and Company Bill.">
                              <button
                                type="button"
                                onClick={() => handleToggleChargeSplit(charge)}
                                className={`rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors ${
                                  splitTag === 'company'
                                    ? 'border-[#6AD4B0] bg-[#6AD4B0]/18 text-ink'
                                    : 'border-ink/12 text-ink/55 hover:border-ink/30 hover:text-ink'
                                }`}
                              >
                                {splitTag === 'company' ? 'Company' : 'Personal'}
                              </button>
                            </HoverTip>
                          ) : (
                            <span className="text-[11px] text-ink/40 capitalize">{splitTag}</span>
                          )}
                        </td>
                        <td
                          className={`py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap ${
                            isVoided
                              ? 'line-through text-ink/45'
                              : isCredit
                                ? 'text-accent-ink'
                                : 'text-ink/70'
                          }`}
                        >
                          {charge.amount < 0 ? '−' : ''}
                          {currency}
                          {Math.abs(charge.amount).toFixed(2)}
                        </td>
                        {showTaxRow && (
                          <td
                            className={`py-3 px-3 text-right font-mono text-xs tabular-nums whitespace-nowrap ${
                              isVoided ? 'line-through text-ink/45' : 'text-ink/65'
                            }`}
                          >
                            {charge.tax_amount !== 0
                              ? `${charge.tax_amount < 0 ? '−' : ''}${currency}${Math.abs(charge.tax_amount).toFixed(2)}`
                              : '—'}
                          </td>
                        )}
                        <td
                          className={`py-3 pl-3 text-right font-mono text-sm tabular-nums whitespace-nowrap ${
                            isVoided
                              ? 'line-through text-ink/45'
                              : isCredit
                                ? 'font-medium text-accent-ink'
                                : 'text-ink'
                          }`}
                        >
                          {lineTotal < 0 ? '−' : ''}
                          {currency}
                          {Math.abs(lineTotal).toFixed(2)}
                        </td>
                        <td className="no-print py-3 pl-3 text-right">
                          {!isVoided &&
                            (canFinancialControl ? (
                              <HoverTip text="Void & reverse this charge with an audit reason and contra journal voucher.">
                                <button
                                  type="button"
                                  onClick={() => openVoidChargeModal(charge)}
                                  aria-label={`Void ${charge.description}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                            ) : (
                              <HoverTip text="Voiding charges is locked to Management, Accountant, and Auditor accounts.">
                                <button
                                  type="button"
                                  disabled
                                  aria-disabled="true"
                                  aria-label={`Void locked for ${charge.description}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/45 opacity-45 cursor-not-allowed"
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                            ))}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Payments & Refunds Ledger */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-ink">Payments, Deposits &amp; Refunds</h3>
          {visiblePayments.length === 0 ? (
            <p className="text-xs text-ink/45 border-t border-ink/10 pt-3">
              No payments or refunds recorded on this bill yet.
            </p>
          ) : (
            <div className="overflow-x-auto border-t border-ink/10">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-ink/10 text-xs font-medium text-ink/50">
                    <th className="py-2.5 pr-3">Date</th>
                    <th className="py-2.5 px-3">Type &amp; Method</th>
                    <th className="py-2.5 px-3">Reference</th>
                    <th className="py-2.5 px-3">Bill</th>
                    <th className="py-2.5 px-3">Recorded By</th>
                    <th className="py-2.5 pl-3 text-right">Amount</th>
                    <th className="no-print py-2.5 pl-3 text-right w-10"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink/8 text-sm">
                  {visiblePayments.map((pay) => {
                    const isRefund = pay.kind === 'refund';
                    const isVoided = pay.voided === 1;
                    return (
                      <tr
                        key={pay.id}
                        className={
                          isVoided
                            ? 'opacity-60 bg-[#E05252]/[0.04]'
                            : isRefund
                              ? 'bg-[#E05252]/[0.05]'
                              : ''
                        }
                      >
                        <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-ink/55 whitespace-nowrap">
                          {pay.recorded_at.slice(0, 10)}
                        </td>
                        <td className="py-2.5 px-3 text-xs whitespace-nowrap">
                          <span
                            className={`font-medium capitalize ${
                              isVoided
                                ? 'line-through text-ink/55'
                                : isRefund
                                  ? 'text-danger-ink'
                                  : 'text-ink'
                            }`}
                          >
                            {isRefund ? 'Refund · ' : ''}
                            {pay.method.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-xs text-ink/60">
                          <div className="font-mono">{pay.reference || '—'}</div>
                          {isVoided && (
                            <div className="mt-0.5 text-[11px] font-medium text-danger-ink">
                              Voided
                              {pay.void_reason ? ` · ${pay.void_reason}` : ''}
                              {pay.voided_by ? ` — by ${pay.voided_by}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-3 text-xs capitalize text-ink/55">
                          {pay.billing_split ?? 'personal'}
                        </td>
                        <td className="py-2.5 px-3 text-xs text-ink/55">{pay.recorded_by_station}</td>
                        <td
                          className={`py-2.5 pl-3 text-right font-mono text-sm tabular-nums whitespace-nowrap ${
                            isVoided
                              ? 'line-through text-ink/45'
                              : isRefund
                                ? 'font-medium text-danger-ink'
                                : 'text-ink'
                          }`}
                        >
                          {isRefund ? '+' : '−'}
                          {currency}
                          {pay.amount.toFixed(2)}
                        </td>
                        <td className="no-print py-2.5 pl-3 text-right">
                          {!isVoided &&
                            (canFinancialControl ? (
                              <HoverTip text="Void & reverse this payment/refund with an audit reason and contra journal voucher.">
                                <button
                                  type="button"
                                  onClick={() => openVoidPaymentModal(pay)}
                                  aria-label={`Void ${isRefund ? 'refund' : 'payment'} #${pay.id}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/40 hover:bg-[#E05252]/10 hover:text-danger-ink"
                                >
                                  <RotateCcw className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                            ) : (
                              <HoverTip text="Voiding payments or refunds is locked to Management, Accountant, and Auditor accounts.">
                                <button
                                  type="button"
                                  disabled
                                  aria-disabled="true"
                                  aria-label={`Void locked for ${isRefund ? 'refund' : 'payment'} #${pay.id}`}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-ink/45 opacity-45 cursor-not-allowed"
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                </button>
                              </HoverTip>
                            ))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Financial Summary Totals */}
        <div className="flex justify-end border-t border-ink/10 pt-6">
          <div className="w-full max-w-xs space-y-2 text-sm">
            <div className="flex justify-between text-ink/65">
              <span>Charges Subtotal{showTaxRow ? ' (Net)' : ''}</span>
              <span className="font-mono tabular-nums">
                {currency}
                {activeTotals.subtotal.toFixed(2)}
              </span>
            </div>
            {showTaxRow &&
              (folioTaxSummaryLines.length > 0 ? (
                folioTaxSummaryLines.map((line) => (
                  <div key={line.label} className="flex justify-between text-ink/65">
                    <span>{line.label}</span>
                    <span className="font-mono tabular-nums">
                      {line.amount < 0 ? '−' : ''}
                      {currency}
                      {Math.abs(line.amount).toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <div className="flex justify-between text-ink/65">
                  <span>{stay.tax_label || 'Taxes'}</span>
                  <span className="font-mono tabular-nums">
                    {currency}
                    {activeTotals.tax.toFixed(2)}
                  </span>
                </div>
              ))}
            <div className="flex justify-between font-medium text-ink border-t border-ink/8 pt-2">
              <span>Total Billed</span>
              <span className="font-mono tabular-nums">
                {currency}
                {activeTotals.totalBilled.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-ink/65">
              <span>Net Payments</span>
              <span className="font-mono tabular-nums">
                {currency}
                {activeTotals.totalPaid.toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between border-t border-ink/15 pt-2.5 text-base font-semibold text-ink">
              <span>{activeTotals.balanceDue < 0 ? 'Credit Balance' : 'Balance Due'}</span>
              <span
                className={`font-mono tabular-nums ${
                  activeTotals.balanceDue > 0
                    ? 'text-danger-ink'
                    : activeTotals.balanceDue < 0
                      ? 'text-accent-ink'
                      : 'text-ink'
                }`}
              >
                {activeTotals.balanceDue < 0 ? '−' : ''}
                {currency}
                {Math.abs(activeTotals.balanceDue).toFixed(2)}
              </span>
            </div>
          </div>
        </div>

        {/* Footer address + Powered by Hosila */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink/8 pt-4 text-xs text-ink/45">
          <span>
            {settings.hotel_name} · {settings.hotel_address} · {settings.hotel_phone}
          </span>
          <span className="font-medium">Powered by Hosila</span>
        </div>
      </div>

      {/* Post Manual Charge Modal */}
      <Modal
        open={chargeModalOpen}
        onClose={() => setChargeModalOpen(false)}
        title="Post Charge to Guest Folio"
        subtitle={`${stay.room_id ? `Room ${stay.room_number}` : 'Unassigned'} · ${stay.guest_name} (${stay.confirmation_code})`}
      >
        <form onSubmit={handlePostCharge} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Charge Category</label>
              <select
                value={chargeCategory}
                onChange={(e) => setChargeCategory(e.target.value as FolioCharge['category'])}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 text-sm text-ink"
              >
                <option value="restaurant_manual">Restaurant / Dining</option>
                <option value="room">Room Night / Extension</option>
                <option value="service">Laundry, Parking, Service</option>
                {canFinancialControl ? (
                  <option value="tax_adjustment">Manual Adjustment (No Tax)</option>
                ) : (
                  <option value="tax_adjustment" disabled>
                    Manual Adjustment (Locked · Finance Only)
                  </option>
                )}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Assign to Bill</label>
              <select
                value={chargeSplit}
                onChange={(e) => setChargeSplit(e.target.value as 'personal' | 'company')}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 text-sm text-ink"
              >
                <option value="personal">Personal Bill</option>
                <option value="company">Company Bill</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Description *</label>
            <input
              type="text"
              required
              value={chargeDescription}
              onChange={(e) => setChargeDescription(e.target.value)}
              placeholder={
                chargeCategory === 'restaurant_manual'
                  ? 'e.g. Dining Room — Dinner for 2 (Ticket #104)'
                  : 'e.g. Late Checkout Fee or Laundry Pressing'
              }
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Qty</label>
              <input
                type="number"
                min="1"
                required
                value={chargeQty}
                onChange={(e) => setChargeQty(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Unit Price ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={chargeUnitPrice}
                onChange={(e) => setChargeUnitPrice(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">Ticket / Ref #</label>
              <input
                type="text"
                value={chargeRef}
                onChange={(e) => setChargeRef(e.target.value)}
                placeholder="TKT-104"
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
              />
            </div>
          </div>

          <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-ink/65">
              <span>{showTaxRow ? 'Net Subtotal' : 'Subtotal'}</span>
              <span className="font-mono tabular-nums text-ink">
                {currency}
                {chargeTaxPreview.netAmount.toFixed(2)}
              </span>
            </div>
            {showTaxRow &&
              chargeTaxPreview.applicable &&
              chargeTaxPreview.breakdown.map((item) => (
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
              ))}
            <div className="flex justify-between border-t border-ink/10 pt-2 text-sm font-semibold text-ink">
              <span>Total Charge to Post</span>
              <span className="font-mono tabular-nums">
                {currency}
                {chargeTaxPreview.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setChargeModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting ? 'Posting...' : `Post ${currency}${chargeTaxPreview.totalAmount.toFixed(2)} to Folio`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Record Payment Modal (Supports Split Payments) */}
      <Modal
        open={paymentModalOpen}
        onClose={() => setPaymentModalOpen(false)}
        title="Record Folio Payment"
        subtitle={`${stay.room_id ? `Room ${stay.room_number}` : 'Unassigned'} · ${stay.guest_name} · Balance ${currency}${Math.max(0, activeTotals.balanceDue).toFixed(2)}`}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handlePostPayment} className="space-y-4">
          <div className="space-y-2.5">
            {paymentLegs.map((leg, idx) => (
              <div
                key={idx}
                className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink/55">
                    {paymentLegs.length > 1 ? `Payment Split #${idx + 1}` : 'Payment Details'}
                  </span>
                  {paymentLegs.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removePaymentLeg(idx)}
                      className="text-xs font-medium text-danger-ink hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                  <div>
                    <label className="block text-[11px] font-medium text-ink/60 mb-1">
                      Amount ({currency}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={leg.amount}
                      onChange={(e) => updatePaymentLeg(idx, { amount: e.target.value })}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 font-mono text-sm tabular-nums text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-medium text-ink/60 mb-1">Method</label>
                    <select
                      value={leg.method}
                      onChange={(e) =>
                        updatePaymentLeg(idx, { method: e.target.value as FolioPayment['method'] })
                      }
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-2.5 py-2 text-xs text-ink"
                    >
                      <option value="card">Card</option>
                      <option value="cash">Cash</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="corporate">Corporate</option>
                    </select>
                  </div>
                  <div className="col-span-2 sm:col-span-1">
                    <label className="block text-[11px] font-medium text-ink/60 mb-1">Bill</label>
                    <select
                      value={leg.billing_split ?? 'personal'}
                      onChange={(e) =>
                        updatePaymentLeg(idx, {
                          billing_split: e.target.value as 'personal' | 'company',
                        })
                      }
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-2.5 py-2 text-xs text-ink"
                    >
                      <option value="personal">Personal</option>
                      <option value="company">Company</option>
                    </select>
                  </div>
                </div>
                <input
                  type="text"
                  value={leg.reference}
                  onChange={(e) => updatePaymentLeg(idx, { reference: e.target.value })}
                  placeholder="Reference / Receipt # (e.g. POS-4210)"
                  className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-xs text-ink"
                />
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={addSplitPaymentLeg}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink underline decoration-[#6AD4B0] decoration-2 underline-offset-4 hover:opacity-80"
            >
              <Plus className="h-3.5 w-3.5" />
              Add Split Payment Method
            </button>
            <div className="text-xs text-ink/65">
              Total:{' '}
              <span className="font-mono font-semibold text-ink">
                {currency}
                {splitLegsTotal.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
            <button
              type="button"
              onClick={() => setPaymentModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || splitLegsTotal <= 0}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-50"
            >
              {submitting
                ? 'Recording...'
                : paymentLegs.length > 1
                  ? `Record Split (${currency}${splitLegsTotal.toFixed(2)})`
                  : 'Record Payment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Refund & Credit Note Modal */}
      <Modal
        open={refundModalOpen}
        onClose={() => setRefundModalOpen(false)}
        title="Guest Refund & Credit Note"
        subtitle={`${stay.room_id ? `Room ${stay.room_number}` : 'Unassigned'} · ${stay.guest_name}`}
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-ink/[0.05] p-1">
            <button
              type="button"
              onClick={() => setRefundTab('refund')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                refundTab === 'refund'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Guest Refund (Cash / Card)
            </button>
            <button
              type="button"
              onClick={() => setRefundTab('credit_note')}
              className={`rounded-lg py-1.5 text-xs font-semibold transition-colors ${
                refundTab === 'credit_note'
                  ? 'bg-surface text-ink shadow-[0_1px_2px_rgba(29,29,31,0.08)]'
                  : 'text-ink/60 hover:text-ink'
              }`}
            >
              Credit Note (Bill Rebate)
            </button>
          </div>

          <form onSubmit={handleSubmitRefundOrCredit} className="space-y-4">
            {refundTab === 'refund' ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Refund Amount ({currency}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={refundAmount}
                      onChange={(e) => setRefundAmount(e.target.value)}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Refund Method
                    </label>
                    <select
                      value={refundMethod}
                      onChange={(e) => setRefundMethod(e.target.value as FolioPayment['method'])}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 text-sm text-ink"
                    >
                      <option value="cash">Cash (Drawer)</option>
                      <option value="bank_transfer">Bank Transfer</option>
                      <option value="card">Card Reversal</option>
                      <option value="corporate">Corporate Credit</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">Reference</label>
                    <input
                      type="text"
                      value={refundRef}
                      onChange={(e) => setRefundRef(e.target.value)}
                      placeholder="Voucher / transfer ref"
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2 text-sm text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">Bill</label>
                    <select
                      value={refundSplit}
                      onChange={(e) => setRefundSplit(e.target.value as 'personal' | 'company')}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
                    >
                      <option value="personal">Personal Bill</option>
                      <option value="company">Company Bill</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Reason *</label>
                  <input
                    type="text"
                    required
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="e.g. Unused deposit return, early checkout overpayment"
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Credit Category
                    </label>
                    <select
                      value={creditCategory}
                      onChange={(e) => setCreditCategory(e.target.value as FolioCharge['category'])}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
                    >
                      <option value="tax_adjustment">General Credit / Rebate</option>
                      <option value="room">Room Rate Allowance</option>
                      <option value="restaurant_manual">Restaurant Allowance</option>
                      <option value="service">Service Allowance</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">Bill</label>
                    <select
                      value={creditSplit}
                      onChange={(e) => setCreditSplit(e.target.value as 'personal' | 'company')}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2 text-sm text-ink"
                    >
                      <option value="personal">Personal Bill</option>
                      <option value="company">Company Bill</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">Description *</label>
                  <input
                    type="text"
                    required
                    value={creditDescription}
                    onChange={(e) => setCreditDescription(e.target.value)}
                    placeholder="e.g. AC inconvenience discount or corporate rebate"
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">
                      Credit Amount ({currency}) *
                    </label>
                    <input
                      type="number"
                      step="0.01"
                      min="0.01"
                      required
                      value={creditAmount}
                      onChange={(e) => setCreditAmount(e.target.value)}
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm tabular-nums text-ink"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-ink/65 mb-1.5">Reference</label>
                    <input
                      type="text"
                      value={creditRef}
                      onChange={(e) => setCreditRef(e.target.value)}
                      placeholder="CN-001"
                      className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-sm text-ink"
                    />
                  </div>
                </div>
                {showTaxRow && creditCategory !== 'tax_adjustment' && (
                  <label className="inline-flex items-center gap-2 text-xs text-ink/75 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={creditApplyTax}
                      onChange={(e) => setCreditApplyTax(e.target.checked)}
                      className="h-4 w-4 rounded accent-[#6AD4B0]"
                    />
                    Reverse applicable tax proportionally on this credit note
                  </label>
                )}
              </>
            )}

            <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
              <button
                type="button"
                onClick={() => setRefundModalOpen(false)}
                className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className={`rounded-xl px-5 py-2 text-sm font-semibold disabled:opacity-50 ${
                  refundTab === 'refund'
                    ? 'bg-[#E05252] text-white hover:bg-[#E05252]/90'
                    : 'bg-[#6AD4B0] text-[#1D1D1F] hover:bg-[#6AD4B0]/85'
                }`}
              >
                {submitting
                  ? 'Processing...'
                  : refundTab === 'refund'
                    ? 'Issue Refund'
                    : 'Post Credit Note'}
              </button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Extend Stay Modal */}
      <Modal
        open={extendModalOpen}
        onClose={() => setExtendModalOpen(false)}
        title="Extend Stay"
        subtitle={`Room ${stay.room_number} · Current checkout ${stay.check_out_date}`}
      >
        <form onSubmit={handleExtendStay} className="space-y-4">
          <div className="grid grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                New Check-Out Date *
              </label>
              <input
                type="date"
                required
                min={addDaysIso(stay.check_out_date, 1)}
                value={extendNewOutDate}
                onChange={(e) => setExtendNewOutDate(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 font-mono text-sm tabular-nums text-ink"
              />
            </div>
            <div>
              <label className="flex items-center gap-1 text-xs font-medium text-ink/65 mb-1.5">
                {!canFinancialControl && <Lock className="h-3 w-3 text-ink/50" />}
                Nightly Rate ({currency})
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                required
                readOnly={!canFinancialControl}
                value={canFinancialControl ? extendRate : String(effectiveExtendRate)}
                onChange={(e) => canFinancialControl && setExtendRate(e.target.value)}
                className={`w-full rounded-xl border border-ink/15 px-3 py-2.5 font-mono text-sm tabular-nums text-ink ${
                  !canFinancialControl ? 'bg-ink/[0.04] text-ink/65 opacity-60 cursor-not-allowed' : 'bg-canvas'
                }`}
              />
              {!canFinancialControl && (
                <p className="mt-1 text-[11px] text-ink/45">
                  {selectedExtendRoom
                    ? `Locked · Catalog rate for Room ${selectedExtendRoom.room_number} (${selectedExtendRoom.room_type})`
                    : 'Locked · Current stay rate (Management/Accountant/Auditor required for custom overrides)'}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Room for Extended Nights
              </label>
              <select
                value={extendTargetRoomId}
                onChange={(e) => handleExtendRoomSelect(e.target.value)}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 text-sm text-ink"
              >
                <option value="">
                  Keep current Room {stay.room_number} ({currency}
                  {stay.nightly_rate.toFixed(2)}/nt)
                </option>
                {extendRoomCandidates.map(({ room, conflict, unclean, disabled }) => (
                  <option key={room.id} value={room.id} disabled={disabled}>
                    Move to Room {room.room_number} · {room.room_type} ({currency}
                    {room.nightly_rate.toFixed(2)}/nt)
                    {conflict ? ` — Occupied/Reserved (${conflict.guest_name})` : ''}
                    {unclean ? ` — ${room.housekeeping_status}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-ink/65 mb-1.5">
                Assign Extension Charge To
              </label>
              <select
                value={extendBillingSplit}
                onChange={(e) => setExtendBillingSplit(e.target.value as 'personal' | 'company')}
                className="w-full rounded-xl border border-ink/15 bg-canvas px-3 py-2.5 text-sm text-ink"
              >
                <option value="personal">Personal Bill (Guest pays)</option>
                <option value="company">Company Bill (Corporate account)</option>
              </select>
            </div>
          </div>

          {selectedExtendRoom && (
            <div className="rounded-xl border border-[#6AD4B0]/40 bg-[#6AD4B0]/[0.08] px-3.5 py-2.5 text-xs text-ink/80">
              Switching to <strong className="text-ink">Room {selectedExtendRoom.room_number}</strong> ({selectedExtendRoom.room_type}) will mark Room {stay.room_number} <strong className="text-ink">Dirty</strong> for housekeeping and bill the {extendExtraNights} extended {extendExtraNights === 1 ? 'night' : 'nights'} at{' '}
              <strong className="font-mono text-ink">
                {currency}
                {effectiveExtendRate.toFixed(2)}/night
              </strong>
              .
            </div>
          )}

          <div className="rounded-xl border border-ink/12 bg-ink/[0.02] p-3.5 space-y-1.5 text-xs">
            <div className="flex justify-between text-ink/65">
              <span>
                Additional Nights ({extendExtraNights} × {currency}
                {effectiveExtendRate.toFixed(2)})
              </span>
              <span className="font-mono tabular-nums text-ink">
                {currency}
                {extendTaxPreview.netAmount.toFixed(2)}
              </span>
            </div>
            {showTaxRow && extendTaxPreview.taxAmount > 0 && (
              <div className="flex justify-between text-ink/65">
                <span>Tax</span>
                <span className="font-mono tabular-nums text-ink">
                  {currency}
                  {extendTaxPreview.taxAmount.toFixed(2)}
                </span>
              </div>
            )}
            <div className="flex justify-between border-t border-ink/10 pt-2 text-sm font-semibold text-ink">
              <span>
                Additional Charge ({extendBillingSplit === 'company' ? 'Company Bill' : 'Personal Bill'})
              </span>
              <span className="font-mono tabular-nums">
                {currency}
                {extendTaxPreview.totalAmount.toFixed(2)}
              </span>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setExtendModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || extendExtraNights <= 0}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45"
            >
              {submitting
                ? 'Extending...'
                : selectedExtendRoom
                  ? `Extend +${extendExtraNights} & Move to ${selectedExtendRoom.room_number}`
                  : `Confirm +${extendExtraNights} Night${extendExtraNights === 1 ? '' : 's'}`}
            </button>
          </div>
        </form>
      </Modal>

      {/* Move Room Modal */}
      <Modal
        open={moveRoomModalOpen}
        onClose={() => setMoveRoomModalOpen(false)}
        title="Move Guest to Another Room"
        subtitle={`Currently in Room ${stay.room_number} (${currency}${stay.nightly_rate.toFixed(2)}/night)`}
      >
        <form onSubmit={handleMoveRoom} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Target Room (Clean &amp; Available) *
            </label>
            <select
              required
              value={moveTargetRoomId}
              onChange={(e) => setMoveTargetRoomId(e.target.value)}
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            >
              <option value="">Select clean target room...</option>
              {moveRoomCandidates.map(({ room, conflict, unclean, disabled }) => (
                <option key={room.id} value={room.id} disabled={disabled}>
                  Room {room.room_number} · {room.room_type} ({currency}
                  {room.nightly_rate}/nt)
                  {conflict ? ` — Occupied/Reserved (${conflict.guest_name})` : ''}
                  {unclean ? ` — ${room.housekeeping_status}` : ''}
                </option>
              ))}
            </select>
          </div>

          {selectedMoveRoom && remainingNightsForMove === 0 && (
            <div className="rounded-xl border border-ink/12 bg-ink/[0.03] p-3 text-xs text-ink/75">
              <strong className="text-ink">Checkout morning move</strong> — this stay checks out on{' '}
              <span className="font-mono">{stay.check_out_date}</span>, so moving rooms updates the active room with no retroactive charge for last night. Use{' '}
              <strong className="text-ink">Extend Stay</strong> if the guest is staying additional nights in the new room.
            </div>
          )}

          {selectedMoveRoom && selectedMoveRoom.nightly_rate !== stay.nightly_rate && remainingNightsForMove > 0 && (
            <div className="space-y-3">
              {canFinancialControl ? (
                <label className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.02] p-3 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={moveUpdateRate}
                    onChange={(e) => setMoveUpdateRate(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded accent-[#6AD4B0]"
                  />
                  <span className="text-ink/80">
                    Adjust stay rate to{' '}
                    <strong className="font-mono text-ink">
                      {currency}
                      {selectedMoveRoom.nightly_rate.toFixed(2)}/night
                    </strong>{' '}
                    and post the{' '}
                    <strong className="font-mono text-ink">
                      {selectedMoveRoom.nightly_rate > stay.nightly_rate ? '+' : '−'}
                      {currency}
                      {(
                        Math.abs(selectedMoveRoom.nightly_rate - stay.nightly_rate) *
                        remainingNightsForMove
                      ).toFixed(2)}
                    </strong>{' '}
                    difference for the remaining {remainingNightsForMove}{' '}
                    {remainingNightsForMove === 1 ? 'night' : 'nights'}. (Uncheck to waive / absorb at hotel expense.)
                  </span>
                </label>
              ) : (
                <div className="flex items-start gap-2.5 rounded-xl border border-ink/12 bg-ink/[0.03] p-3 text-xs text-ink/65 opacity-65 cursor-not-allowed select-none">
                  <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink/55" />
                  {selectedMoveRoom.nightly_rate > stay.nightly_rate ? (
                    <span>
                      Upgrade difference of{' '}
                      <strong className="font-mono text-ink">
                        +{currency}
                        {(
                          (selectedMoveRoom.nightly_rate - stay.nightly_rate) *
                          remainingNightsForMove
                        ).toFixed(2)}
                      </strong>{' '}
                      for {remainingNightsForMove} remaining {remainingNightsForMove === 1 ? 'night' : 'nights'} will be posted automatically. Waiving upgrade fees is locked to Management, Accountant, or Auditor.
                    </span>
                  ) : (
                    <span>
                      Current stay rate ({currency}
                      {stay.nightly_rate.toFixed(2)}/night) will be preserved. Issuing a downgrade
                      rate credit is locked to Management, Accountant, or Auditor.
                    </span>
                  )}
                </div>
              )}

              {((canFinancialControl && moveUpdateRate) ||
                (!canFinancialControl && selectedMoveRoom.nightly_rate > stay.nightly_rate)) && (
                <div>
                  <label className="block text-xs font-medium text-ink/65 mb-1.5">
                    {selectedMoveRoom.nightly_rate > stay.nightly_rate
                      ? 'Bill Upgrade Difference To'
                      : 'Apply Rate Credit To'}
                  </label>
                  <select
                    value={moveBillingSplit}
                    onChange={(e) => setMoveBillingSplit(e.target.value as 'personal' | 'company')}
                    className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
                  >
                    <option value="personal">Personal Bill (Guest pays)</option>
                    <option value="company">Company Bill (Corporate account)</option>
                  </select>
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">Reason (Optional)</label>
            <input
              type="text"
              value={moveReason}
              onChange={(e) => setMoveReason(e.target.value)}
              placeholder="e.g. Complimentary upgrade, AC issue, quieter floor"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setMoveRoomModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || !moveTargetRoomId}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45"
            >
              {submitting ? 'Moving...' : 'Confirm Room Move'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Complimentary Bill Waiver Modal — Management & Accountant ONLY */}
      <Modal
        open={waiveModalOpen}
        onClose={() => !submitting && setWaiveModalOpen(false)}
        title="Complimentary Bill Waiver"
        subtitle={`${stay.guest_name} · ${stay.confirmation_code} — Contra-Revenue & Tax Reversal`}
        maxWidthClass="max-w-lg"
      >
        <form onSubmit={handleSubmitWaive} className="space-y-4">
          <p className="text-xs text-ink/65">
            Select which bill sections to waive. Hosila posts itemized complimentary waiver credit
            lines and balanced double-entry contra-revenue vouchers with automatic tax reversal —
            preserving full audit integrity.
          </p>

          <div className="space-y-2.5">
            <label
              className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs ${
                waiveBuckets.room.total <= 0.01
                  ? 'border-ink/10 bg-ink/[0.02] opacity-45 cursor-not-allowed'
                  : waiveRoom
                    ? 'border-[#6AD4B0] bg-[#6AD4B0]/12 cursor-pointer'
                    : 'border-ink/12 bg-canvas cursor-pointer hover:bg-ink/[0.02]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  disabled={waiveBuckets.room.total <= 0.01}
                  checked={waiveRoom && waiveBuckets.room.total > 0.01}
                  onChange={(e) => setWaiveRoom(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#6AD4B0]"
                />
                <span>
                  <strong className="block text-sm font-medium text-ink">
                    Accommodation (Room &amp; Taxes)
                  </strong>
                  <span className="text-[11px] text-ink/55">
                    Net {currency}
                    {waiveBuckets.room.net.toFixed(2)}
                    {showTaxRow ? ` + Tax ${currency}${waiveBuckets.room.tax.toFixed(2)}` : ''}
                  </span>
                </span>
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                {currency}
                {waiveBuckets.room.total.toFixed(2)}
              </span>
            </label>

            <label
              className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs ${
                waiveBuckets.food.total <= 0.01
                  ? 'border-ink/10 bg-ink/[0.02] opacity-45 cursor-not-allowed'
                  : waiveFood
                    ? 'border-[#6AD4B0] bg-[#6AD4B0]/12 cursor-pointer'
                    : 'border-ink/12 bg-canvas cursor-pointer hover:bg-ink/[0.02]'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <input
                  type="checkbox"
                  disabled={waiveBuckets.food.total <= 0.01}
                  checked={waiveFood && waiveBuckets.food.total > 0.01}
                  onChange={(e) => setWaiveFood(e.target.checked)}
                  className="h-4 w-4 rounded accent-[#6AD4B0]"
                />
                <span>
                  <strong className="block text-sm font-medium text-ink">
                    Food &amp; Beverage (Restaurant POS &amp; Dining)
                  </strong>
                  <span className="text-[11px] text-ink/55">
                    Net {currency}
                    {waiveBuckets.food.net.toFixed(2)}
                    {showTaxRow ? ` + Tax ${currency}${waiveBuckets.food.tax.toFixed(2)}` : ''}
                  </span>
                </span>
              </span>
              <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                {currency}
                {waiveBuckets.food.total.toFixed(2)}
              </span>
            </label>

            {waiveBuckets.services.total > 0.01 && (
              <label
                className={`flex items-center justify-between gap-3 rounded-xl border p-3.5 text-xs ${
                  waiveServices
                    ? 'border-[#6AD4B0] bg-[#6AD4B0]/12 cursor-pointer'
                    : 'border-ink/12 bg-canvas cursor-pointer hover:bg-ink/[0.02]'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  <input
                    type="checkbox"
                    checked={waiveServices}
                    onChange={(e) => setWaiveServices(e.target.checked)}
                    className="h-4 w-4 rounded accent-[#6AD4B0]"
                  />
                  <span>
                    <strong className="block text-sm font-medium text-ink">
                      Ancillary Services (Laundry, Parking, etc.)
                    </strong>
                    <span className="text-[11px] text-ink/55">
                      Net {currency}
                      {waiveBuckets.services.net.toFixed(2)}
                      {showTaxRow ? ` + Tax ${currency}${waiveBuckets.services.tax.toFixed(2)}` : ''}
                    </span>
                  </span>
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-ink">
                  {currency}
                  {waiveBuckets.services.total.toFixed(2)}
                </span>
              </label>
            )}
          </div>

          <div className="flex items-center justify-between rounded-xl border border-ink/10 bg-ink/[0.02] px-4 py-2.5 text-xs">
            <span className="text-ink/65">Total Complimentary Waiver</span>
            <span className="font-mono text-base font-semibold tabular-nums text-accent-ink">
              −{currency}
              {selectedWaiveTotal.toFixed(2)}
            </span>
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Authorization Reason *
            </label>
            <input
              type="text"
              required
              minLength={4}
              value={waiveReason}
              onChange={(e) => setWaiveReason(e.target.value)}
              placeholder="e.g. Owner's guest — complimentary accommodation & dining"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink/65 mb-1.5">
              Approval Reference (Optional)
            </label>
            <input
              type="text"
              value={waiveRef}
              onChange={(e) => setWaiveRef(e.target.value)}
              placeholder="e.g. COMP-GM-2026"
              className="w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 font-mono text-xs text-ink"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-ink/8">
            <button
              type="button"
              onClick={() => setWaiveModalOpen(false)}
              className="rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting || selectedWaiveTotal <= 0.01 || waiveReason.trim().length < 4}
              className="rounded-xl bg-[#6AD4B0] px-5 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45"
            >
              {submitting ? 'Posting Waiver...' : `Post Waiver (−${currency}${selectedWaiveTotal.toFixed(2)})`}
            </button>
          </div>
        </form>
      </Modal>

      <VoidConfirmModal
        open={Boolean(voidTarget)}
        target={voidTarget?.summary ?? null}
        reasonPresets={voidReasonPresets}
        submitting={voidSubmitting}
        onClose={() => !voidSubmitting && setVoidTarget(null)}
        onConfirm={handleConfirmVoid}
      />
    </div>
  );
}
