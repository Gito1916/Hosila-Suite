import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ApiError_Serialize } from '../../bindings/bindings';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type CommandResult<T> =
  | { status: 'ok'; data: T }
  | { status: 'error'; error: ApiError_Serialize };

export function formatMilli(milli: number, maxDecimals = 3): string {
  const value = milli / 1000;
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  });
}

export function parseQtyToMilli(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 1000);
}

function stripCurrencyDecorations(raw: string): number {
  const cleaned = raw.replace(/[,₦$€£\s]/g, '').trim();
  if (!cleaned) return 0;
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : 0;
}

function formatScaledCurrency(value: number, symbol: string, prefix = ''): string {
  if (!Number.isFinite(value)) return `${symbol}0.00`;
  const abs = Math.abs(value).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${prefix}${symbol}${abs}`;
}

export function formatMinor(minor: number, symbol = '₦', signed = false): string {
  const prefix = minor < 0 ? '-' : signed && minor > 0 ? '+' : '';
  return formatScaledCurrency(minor / 100, symbol, prefix);
}

export function parseCurrencyToMinor(raw: string): number {
  return Math.round(stripCurrencyDecorations(raw) * 100);
}

export function formatMicroUnitCost(micro: number, symbol = '₦'): string {
  return formatScaledCurrency(micro / 1_000_000, symbol, micro < 0 ? '-' : '');
}

export function parseUnitCostToMicro(raw: string): number {
  return Math.round(stripCurrencyDecorations(raw) * 1_000_000);
}

function formatLocalIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayIso(): string {
  return formatLocalIsoDate(new Date());
}

export function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return formatLocalIsoDate(d);
}

export function formatDateTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDateShort(isoDate: string): string {
  if (!isoDate) return '—';
  const parts = isoDate.slice(0, 10).split('-');
  if (parts.length !== 3) return isoDate;
  const d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

async function encodeBinaryFileForBackend(file: File, mediaTag: string): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < buf.length; i += chunkSize) {
    const chunk = buf.subarray(i, i + chunkSize);
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  const b64 = btoa(binary);
  return `data:${mediaTag}/base64,${file.name}:::${b64}`;
}

export function encodeExcelFileForBackend(file: File): Promise<string> {
  return encodeBinaryFileForBackend(file, 'excel');
}

export function encodeBackupFileForBackend(file: File): Promise<string> {
  return encodeBinaryFileForBackend(file, 'backup');
}

export function printHtmlDocument(html: string) {
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.right = '0';
  iframe.style.bottom = '0';
  iframe.style.width = '0';
  iframe.style.height = '0';
  iframe.style.border = '0';
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  const doc = win?.document;
  if (!win || !doc) {
    document.body.removeChild(iframe);
    return;
  }
  const cleanup = () => {
    if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
  };
  win.addEventListener('afterprint', cleanup, { once: true });
  doc.open();
  doc.write(html);
  doc.close();
  setTimeout(() => {
    win.focus();
    win.print();
    setTimeout(cleanup, 60000);
  }, 150);
}
