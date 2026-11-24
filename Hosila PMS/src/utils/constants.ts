import type { StaffRole } from '../types';

export const STAFF_ROLE_LABELS: Record<StaffRole, string> = {
  management: 'Management',
  accountant: 'Accountant',
  auditor: 'Auditor',
  front_desk: 'Front Desk',
  restaurant: 'Restaurant',
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  folio_charge: 'Folio Charge',
  folio_payment: 'Guest Payment',
  deposit_received: 'Advance Deposit',
  deposit_transfer: 'Deposit Transfer',
  pos_sale: 'Restaurant Sale',
  pos_open_tab: 'Open Dining Tab',
  pos_settlement: 'Tab Settlement',
  extra_income: 'Extra Income',
  expense: 'Operating Expense',
  void_reversal: 'Void Reversal',
  night_audit_room_post: 'Night Audit Holdover',
};

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  revenue: 'Revenue',
  expense: 'Expense',
};

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function countNightsBetween(a: string, b: string): number {
  const start = new Date(`${a}T12:00:00Z`).getTime();
  const end = new Date(`${b}T12:00:00Z`).getTime();
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function isoDateDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function datesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && aEnd > bStart;
}
