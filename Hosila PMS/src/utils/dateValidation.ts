export function getLocalTodayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function addDaysToIso(iso: string, days: number): string {
  if (!isValidIsoDate(iso)) return getLocalTodayIso();
  const dt = new Date(`${iso}T12:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

export function validateDateRange(
  fromDate: string,
  toDate: string,
  options?: { allowEmpty?: boolean; maxDays?: number }
): string | null {
  const allowEmpty = options?.allowEmpty ?? false;
  if (!fromDate && !toDate) {
    return allowEmpty ? null : 'Please select both start and end dates.';
  }
  if (fromDate && !isValidIsoDate(fromDate)) {
    return 'Start date is not a valid calendar date.';
  }
  if (toDate && !isValidIsoDate(toDate)) {
    return 'End date is not a valid calendar date.';
  }
  if (!allowEmpty && (!fromDate || !toDate)) {
    return 'Both start and end dates are required.';
  }
  if (fromDate && toDate && fromDate > toDate) {
    return 'Start date cannot be later than end date.';
  }
  if (fromDate && toDate && options?.maxDays) {
    const startMs = new Date(`${fromDate}T12:00:00Z`).getTime();
    const endMs = new Date(`${toDate}T12:00:00Z`).getTime();
    const diffDays = Math.round((endMs - startMs) / 86_400_000) + 1;
    if (diffDays > options.maxDays) {
      return `Date range cannot exceed ${options.maxDays} days.`;
    }
  }
  return null;
}

export function validateStayDates(
  checkIn: string,
  checkOut: string,
  options?: { allowPastCheckIn?: boolean; maxCheckOutDate?: string | null }
): string | null {
  if (!isValidIsoDate(checkIn)) {
    return 'Please select a valid check-in date.';
  }
  if (!isValidIsoDate(checkOut)) {
    return 'Please select a valid check-out date.';
  }
  const today = getLocalTodayIso();
  if (!options?.allowPastCheckIn && checkIn < today) {
    return `Check-in date cannot be in the past (earliest ${today}).`;
  }
  if (checkOut <= checkIn) {
    return 'Check-out date must be at least 1 night after check-in.';
  }
  if (options?.maxCheckOutDate && checkOut > options.maxCheckOutDate) {
    return `Check-out must be on or before ${options.maxCheckOutDate} due to the next reservation on this room.`;
  }
  return null;
}

export function validateTransactionDate(date: string, label = 'Transaction date'): string | null {
  if (!isValidIsoDate(date)) {
    return `${label} must be a valid calendar date.`;
  }
  const today = getLocalTodayIso();
  if (date > today) {
    return `${label} cannot be in the future (latest ${today}).`;
  }
  return null;
}
