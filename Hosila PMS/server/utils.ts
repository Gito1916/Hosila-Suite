import { roundMoneyValue } from './tax.ts';

export function roundMoney(value: number): number {
  return roundMoneyValue(value);
}

/**
 * Returns today's calendar date in the server's local timezone as YYYY-MM-DD.
 * Avoids UTC midnight drift when the hotel timezone is ahead of or behind UTC.
 */
export function getServerLocalIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Adds or subtracts whole calendar days from a YYYY-MM-DD date string safely (noon UTC avoids DST issues).
 */
export function addDaysLocalIso(baseIso: string, deltaDays: number): string {
  const d = new Date(`${baseIso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

export function formatDateOffsetLocal(offsetDays: number): string {
  return addDaysLocalIso(getServerLocalIsoDate(), offsetDays);
}

export function computeNights(checkInDate: string, checkOutDate: string): number {
  return Math.max(
    1,
    Math.round(
      (new Date(`${checkOutDate}T12:00:00Z`).getTime() - new Date(`${checkInDate}T12:00:00Z`).getTime()) /
        86_400_000
    )
  );
}
