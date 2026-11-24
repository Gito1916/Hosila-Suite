import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';
import { db } from './db.ts';

/**
 * Hosila PMS Ed25519 Public Verification Key.
 * Safe to ship inside the application binary — can ONLY verify signatures, never forge them.
 * The matching private key lives strictly in the vendor's private `keys/hosila-master-private.pem`.
 */
export const HOSILA_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAR27XVAxZEFcOz9eSFkR+W6DdRW4FAZKRqjttw4EiXzM=
-----END PUBLIC KEY-----`;

export type HosilaProductId = 'hosila-pms' | 'hosila-ims' | 'hosila-pos' | '*';
export const CURRENT_PRODUCT_ID: Exclude<HosilaProductId, '*'> = 'hosila-pms';
export const CURRENT_PRODUCT_NAME = 'Hosila PMS';

export const PRODUCT_LABELS: Record<HosilaProductId, string> = {
  'hosila-pms': 'Hosila PMS',
  'hosila-ims': 'Hosila IMS',
  'hosila-pos': 'Hosila POS',
  '*': 'All Hosila Products',
};

export type LicenseMode = 'unlicensed' | 'trial' | 'commercial' | 'master';
export type LicenseStateStatus = 'unlicensed' | 'trial' | 'active' | 'grace' | 'expired';

export interface LicensePayload {
  v: 1;
  id: string;
  product?: HosilaProductId;
  type: 'commercial' | 'master';
  machineId: string;
  hotelName: string;
  issuedAt: string;
  expiresAt: string | null;
}

export interface LicenseStatusResponse {
  status: LicenseStateStatus;
  mode: LicenseMode;
  machineId: string;
  licenseId: string | null;
  hotelName: string | null;
  issuedAt: string | null;
  expiresAt: string | null;
  daysRemaining: number | null;
  graceDaysRemaining: number | null;
  readOnly: boolean;
  trialAvailable: boolean;
  message: string;
}

const TRIAL_DURATION_DAYS = 14;
const GRACE_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

let cachedMachineId: string | null = null;

function readWindowsMachineGuid(): string {
  if (process.platform !== 'win32') return '';
  try {
    const out = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2500 }
    );
    const match = out.match(/MachineGuid\s+REG_SZ\s+([0-9a-fA-F-]+)/);
    return match?.[1]?.trim().toLowerCase() ?? '';
  } catch {
    return '';
  }
}

function getStableHardwareSeed(): string {
  const winGuid = readWindowsMachineGuid();
  const hostname = os.hostname().toLowerCase();
  const arch = os.arch();
  const cpuModel = (os.cpus()?.[0]?.model ?? '').trim().toLowerCase();
  const ifaces = os.networkInterfaces();
  const macs: string[] = [];
  for (const name of Object.keys(ifaces).sort()) {
    for (const entry of ifaces[name] ?? []) {
      if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
        macs.push(entry.mac.toLowerCase());
      }
    }
  }
  const uniqueMacs = Array.from(new Set(macs)).sort().slice(0, 2).join(',');
  // Prefer Windows MachineGuid when available so network adapter swaps don't invalidate the license
  if (winGuid) {
    return `hosila-win-v1|${winGuid}|${arch}`;
  }
  return `hosila-gen-v1|${hostname}|${arch}|${cpuModel}|${uniqueMacs}`;
}

/**
 * Returns a deterministic, human-readable Machine ID for this Host PC:
 * e.g. HSLA-8F3A-92C1-4D0E
 */
export function getMachineId(): string {
  if (cachedMachineId) return cachedMachineId;
  const hash = crypto.createHash('sha256').update(getStableHardwareSeed()).digest('hex').toUpperCase();
  cachedMachineId = `HSLA-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
  return cachedMachineId;
}

export function initLicenseTable(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_license (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      license_key TEXT NOT NULL DEFAULT '',
      trial_started_at TEXT,
      trial_expires_at TEXT,
      activated_at TEXT,
      activated_by TEXT NOT NULL DEFAULT '',
      last_seen_at TEXT NOT NULL DEFAULT ''
    );
  `);
  const existing = db.prepare('SELECT id FROM app_license WHERE id = 1').get();
  if (!existing) {
    db.prepare(
      `INSERT INTO app_license (id, license_key, last_seen_at) VALUES (1, '', ?)`
    ).run(new Date().toISOString());
  }
}

export function verifyLicenseKeyString(
  rawKey: string,
  expectedMachineId: string,
  publicKeyPem: string = HOSILA_LICENSE_PUBLIC_KEY
): { ok: true; payload: LicensePayload } | { ok: false; error: string } {
  const cleaned = rawKey.trim().replace(/\s+/g, '');
  if (!cleaned) {
    return { ok: false, error: 'Activation key is required.' };
  }
  const parts = cleaned.split('.');
  if (parts.length !== 3 || parts[0] !== 'HSL1') {
    return { ok: false, error: 'Invalid activation key format. Keys must begin with HSL1.' };
  }

  const [, payloadB64, sigB64] = parts;
  let signature: Buffer;
  let payloadRaw: string;
  try {
    signature = Buffer.from(sigB64, 'base64url');
    payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return { ok: false, error: 'Activation key is malformed or corrupted.' };
  }

  const signingInput = Buffer.from(`HSL1.${payloadB64}`, 'utf8');
  let validSig = false;
  try {
    validSig = crypto.verify(null, signingInput, publicKeyPem, signature);
  } catch {
    validSig = false;
  }

  if (!validSig) {
    return { ok: false, error: 'Activation key signature is invalid. This key cannot be verified.' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadRaw);
  } catch {
    return { ok: false, error: 'Activation key payload could not be decoded.' };
  }

  const p = parsed as Partial<LicensePayload>;
  if (
    p.v !== 1 ||
    typeof p.id !== 'string' ||
    !p.id.trim() ||
    (p.type !== 'commercial' && p.type !== 'master') ||
    typeof p.machineId !== 'string' ||
    !p.machineId.trim() ||
    typeof p.hotelName !== 'string' ||
    typeof p.issuedAt !== 'string'
  ) {
    return { ok: false, error: 'Activation key is missing required license fields.' };
  }

  // Enforce product binding (e.g. a Hosila IMS key cannot activate Hosila PMS)
  const keyProduct: HosilaProductId = p.product ?? 'hosila-pms';
  if (p.type === 'commercial') {
    if (keyProduct === '*' || keyProduct !== CURRENT_PRODUCT_ID) {
      const targetName = PRODUCT_LABELS[keyProduct] ?? keyProduct;
      return {
        ok: false,
        error: `This activation key is for ${targetName} and cannot activate ${CURRENT_PRODUCT_NAME}.`,
      };
    }
    if (p.machineId === '*' || p.machineId.toUpperCase() !== expectedMachineId.toUpperCase()) {
      return {
        ok: false,
        error: `This activation key is locked to a different Host PC (${p.machineId}) and cannot be reused on this machine (${expectedMachineId}).`,
      };
    }
  } else if (p.type === 'master') {
    if (keyProduct !== '*' && keyProduct !== CURRENT_PRODUCT_ID) {
      const targetName = PRODUCT_LABELS[keyProduct] ?? keyProduct;
      return {
        ok: false,
        error: `This Master key is scoped to ${targetName} and cannot activate ${CURRENT_PRODUCT_NAME}.`,
      };
    }
    if (p.machineId !== '*' && p.machineId.toUpperCase() !== expectedMachineId.toUpperCase()) {
      return {
        ok: false,
        error: `This Master key is scoped to Host PC ${p.machineId} and cannot be used on ${expectedMachineId}.`,
      };
    }
  }

  return {
    ok: true,
    payload: {
      v: 1,
      id: p.id,
      product: keyProduct,
      type: p.type,
      machineId: p.machineId,
      hotelName: p.hotelName,
      issuedAt: p.issuedAt,
      expiresAt: p.expiresAt ?? null,
    },
  };
}

interface LicenseRow {
  license_key: string;
  trial_started_at: string | null;
  trial_expires_at: string | null;
  activated_at: string | null;
  activated_by: string;
  last_seen_at: string;
}

function getEffectiveNowMs(row: LicenseRow): number {
  const realNow = Date.now();
  const lastSeenMs = Date.parse(row.last_seen_at || '');
  // Guard against backward system-clock tampering by taking the max of wall clock and last seen time
  const effectiveNow = Number.isFinite(lastSeenMs) && lastSeenMs > realNow ? lastSeenMs : realNow;
  if (!Number.isFinite(lastSeenMs) || realNow > lastSeenMs + 60_000) {
    try {
      db.prepare('UPDATE app_license SET last_seen_at = ? WHERE id = 1').run(
        new Date(effectiveNow).toISOString()
      );
    } catch {
      // Non-fatal if DB is busy
    }
  }
  return effectiveNow;
}

export function getLicenseStatus(): LicenseStatusResponse {
  initLicenseTable();
  const machineId = getMachineId();
  const row = db.prepare('SELECT * FROM app_license WHERE id = 1').get() as LicenseRow | undefined;
  const trialAvailable = !row?.trial_started_at;

  if (!row) {
    return {
      status: 'unlicensed',
      mode: 'unlicensed',
      machineId,
      licenseId: null,
      hotelName: null,
      issuedAt: null,
      expiresAt: null,
      daysRemaining: null,
      graceDaysRemaining: null,
      readOnly: true,
      trialAvailable: true,
      message: 'Hosila PMS requires a valid activation key or trial to operate.',
    };
  }

  const nowMs = getEffectiveNowMs(row);

  // 1. Check signed Commercial or Master activation key first
  if (row.license_key && row.license_key.trim().length > 0) {
    const check = verifyLicenseKeyString(row.license_key, machineId);
    if (check.ok) {
      const p = check.payload;
      if (!p.expiresAt) {
        return {
          status: 'active',
          mode: p.type,
          machineId,
          licenseId: p.id,
          hotelName: p.hotelName,
          issuedAt: p.issuedAt,
          expiresAt: null,
          daysRemaining: null,
          graceDaysRemaining: null,
          readOnly: false,
          trialAvailable: false,
          message:
            p.type === 'master'
              ? 'Hosila Master License active (Lifetime).'
              : `Licensed to ${p.hotelName} (Lifetime).`,
        };
      }

      const expMs = Date.parse(p.expiresAt);
      if (Number.isFinite(expMs)) {
        const diffMs = expMs - nowMs;
        if (diffMs >= 0) {
          const daysRemaining = Math.ceil(diffMs / DAY_MS);
          return {
            status: 'active',
            mode: p.type,
            machineId,
            licenseId: p.id,
            hotelName: p.hotelName,
            issuedAt: p.issuedAt,
            expiresAt: p.expiresAt,
            daysRemaining,
            graceDaysRemaining: null,
            readOnly: false,
            trialAvailable: false,
            message:
              daysRemaining <= 14
                ? `License expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}. Renew in Settings.`
                : `Licensed to ${p.hotelName}.`,
          };
        }

        const expiredDays = Math.floor(Math.abs(diffMs) / DAY_MS);
        const graceDaysRemaining = Math.max(0, GRACE_PERIOD_DAYS - expiredDays);
        if (graceDaysRemaining > 0) {
          return {
            status: 'grace',
            mode: p.type,
            machineId,
            licenseId: p.id,
            hotelName: p.hotelName,
            issuedAt: p.issuedAt,
            expiresAt: p.expiresAt,
            daysRemaining: 0,
            graceDaysRemaining,
            readOnly: false,
            trialAvailable: false,
            message: `License expired. ${graceDaysRemaining} grace day${graceDaysRemaining === 1 ? '' : 's'} remaining before Read-Only mode.`,
          };
        }

        return {
          status: 'expired',
          mode: p.type,
          machineId,
          licenseId: p.id,
          hotelName: p.hotelName,
          issuedAt: p.issuedAt,
          expiresAt: p.expiresAt,
          daysRemaining: 0,
          graceDaysRemaining: 0,
          readOnly: true,
          trialAvailable: false,
          message: 'License expired. System is in Read-Only mode until a renewal key is activated.',
        };
      }
    }
  }

  // 2. Check active local 14-day Trial
  if (row.trial_started_at && row.trial_expires_at) {
    const trialExpMs = Date.parse(row.trial_expires_at);
    if (Number.isFinite(trialExpMs) && trialExpMs > nowMs) {
      const daysRemaining = Math.ceil((trialExpMs - nowMs) / DAY_MS);
      return {
        status: 'trial',
        mode: 'trial',
        machineId,
        licenseId: 'TRIAL-14D',
        hotelName: 'Evaluation Trial',
        issuedAt: row.trial_started_at,
        expiresAt: row.trial_expires_at,
        daysRemaining,
        graceDaysRemaining: null,
        readOnly: false,
        trialAvailable: false,
        message: `14-Day Free Trial active (${daysRemaining} day${daysRemaining === 1 ? '' : 's'} remaining).`,
      };
    }

    return {
      status: 'expired',
      mode: 'trial',
      machineId,
      licenseId: 'TRIAL-14D',
      hotelName: 'Evaluation Trial',
      issuedAt: row.trial_started_at,
      expiresAt: row.trial_expires_at,
      daysRemaining: 0,
      graceDaysRemaining: 0,
      readOnly: true,
      trialAvailable: false,
      message: 'Your 14-day trial has ended. Enter a Hosila PMS activation key to continue.',
    };
  }

  return {
    status: 'unlicensed',
    mode: 'unlicensed',
    machineId,
    licenseId: null,
    hotelName: null,
    issuedAt: null,
    expiresAt: null,
    daysRemaining: null,
    graceDaysRemaining: null,
    readOnly: true,
    trialAvailable,
    message: 'Enter your Hosila PMS activation key or start a 14-day free trial.',
  };
}

export function activateLicenseKey(
  rawKey: string,
  activatedBy = 'Setup'
): { ok: true; status: LicenseStatusResponse } | { ok: false; error: string } {
  initLicenseTable();
  const machineId = getMachineId();
  const check = verifyLicenseKeyString(rawKey, machineId);
  if (!check.ok) {
    return check;
  }

  const nowIso = new Date().toISOString();
  db.prepare(
    `UPDATE app_license
     SET license_key = ?, activated_at = ?, activated_by = ?, last_seen_at = ?
     WHERE id = 1`
  ).run(rawKey.trim().replace(/\s+/g, ''), nowIso, activatedBy.slice(0, 80), nowIso);

  return { ok: true, status: getLicenseStatus() };
}

export function startLocalTrial(): { ok: true; status: LicenseStatusResponse } | { ok: false; error: string } {
  initLicenseTable();
  const row = db.prepare('SELECT trial_started_at FROM app_license WHERE id = 1').get() as
    | { trial_started_at: string | null }
    | undefined;
  if (row?.trial_started_at) {
    return { ok: false, error: 'A free trial has already been used on this Host PC.' };
  }

  const now = Date.now();
  const startedAt = new Date(now).toISOString();
  const expiresAt = new Date(now + TRIAL_DURATION_DAYS * DAY_MS).toISOString();
  db.prepare(
    `UPDATE app_license
     SET trial_started_at = ?, trial_expires_at = ?, last_seen_at = ?
     WHERE id = 1`
  ).run(startedAt, expiresAt, startedAt);

  return { ok: true, status: getLicenseStatus() };
}

