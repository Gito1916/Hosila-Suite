# Hosila Suite — Offline Activation Key Engine Specification (AI Build Guide)

Hand this file directly to any AI coding assistant working on **Hosila IMS**, **Hosila POS**, or any future Hosila desktop/LAN product. Following this exact specification guarantees **100% compatibility** with the portable **Hosila KeyGen** (`hosila-keygen`).

---

## 1. Cryptographic Contract (DO NOT CHANGE)

- **Algorithm**: Ed25519 (Node.js built-in `node:crypto` — zero external dependencies).
- **Key String Format**:
  ```
  HSL1.<base64url-encoded-JSON-payload>.<base64url-encoded-Ed25519-signature>
  ```
- **Signing Input**: Exact UTF-8 bytes of `HSL1.<base64url-encoded-JSON-payload>`.
- **Embedded Public Key** (safe to hardcode in every Hosila product; **NEVER** embed the private key):
  ```pem
  -----BEGIN PUBLIC KEY-----
  MCowBQYDK2VwAyEAR27XVAxZEFcOz9eSFkR+W6DdRW4FAZKRqjttw4EiXzM=
  -----END PUBLIC KEY-----
  ```

---

## 2. Product IDs (Strict Product Isolation)

Each Hosila application MUST set its own `CURRENT_PRODUCT_ID`:
- **Hosila PMS**: `'hosila-pms'`
- **Hosila IMS**: `'hosila-ims'`
- **Hosila POS**: `'hosila-pos'`

**Isolation Rules:**
- A `commercial` key MUST have `payload.product === CURRENT_PRODUCT_ID` (never `'*'`). A Hosila PMS key must be rejected by Hosila IMS, and vice versa.
- A `master` key may have `payload.product === '*'` (activates any Hosila product) OR a specific product ID.

---

## 3. Payload JSON Schema

```ts
export type HosilaProductId = 'hosila-pms' | 'hosila-ims' | 'hosila-pos' | '*';

export interface LicensePayload {
  v: 1;
  id: string;                     // e.g. "IMS-2026-8F2A1B" or "MST-2026-4A1C9E"
  product?: HosilaProductId;      // Must match CURRENT_PRODUCT_ID (or '*' for master)
  type: 'commercial' | 'master';
  machineId: string;              // Exact "HSLA-XXXX-XXXX-XXXX", or '*' ONLY for master
  hotelName: string;              // Customer / Business Name
  issuedAt: string;               // ISO-8601 timestamp
  expiresAt: string | null;       // ISO-8601 timestamp, or null for LIFETIME
}
```
> Every active license grants **Full Access** to all features for the duration of the subscription (Monthly, Yearly, Custom, or Lifetime) — no feature tiers or artificial unit caps.

---

## 4. Machine ID Algorithm (Must Match Exactly Across All Hosila Products)

Every Hosila product computes the exact same Host PC Machine ID (`HSLA-XXXX-XXXX-XXXX`) so a customer's PC always reports a consistent ID:

```ts
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import os from 'node:os';

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

export function getMachineId(): string {
  const winGuid = readWindowsMachineGuid();
  const arch = os.arch();
  let seed: string;
  if (winGuid) {
    seed = `hosila-win-v1|${winGuid}|${arch}`;
  } else {
    const hostname = os.hostname().toLowerCase();
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
    seed = `hosila-gen-v1|${hostname}|${arch}|${cpuModel}|${uniqueMacs}`;
  }
  const hash = crypto.createHash('sha256').update(seed).digest('hex').toUpperCase();
  return `HSLA-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}`;
}
```

---

## 5. Verification Function (Drop-In Reference)

Replace `CURRENT_PRODUCT_ID` and `CURRENT_PRODUCT_NAME` for your target app (e.g. `'hosila-ims'` / `'Hosila IMS'`):

```ts
import crypto from 'node:crypto';

export const HOSILA_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAR27XVAxZEFcOz9eSFkR+W6DdRW4FAZKRqjttw4EiXzM=
-----END PUBLIC KEY-----`;

const CURRENT_PRODUCT_ID = 'hosila-ims'; // <-- Change per app: 'hosila-pms' | 'hosila-ims' | 'hosila-pos'
const CURRENT_PRODUCT_NAME = 'Hosila IMS';

export function verifyLicenseKeyString(rawKey: string, expectedMachineId: string) {
  const cleaned = rawKey.trim().replace(/\s+/g, '');
  const parts = cleaned.split('.');
  if (parts.length !== 3 || parts[0] !== 'HSL1') {
    return { ok: false as const, error: 'Invalid activation key format. Keys must begin with HSL1.' };
  }

  const [, payloadB64, sigB64] = parts;
  let signature: Buffer;
  let payloadRaw: string;
  try {
    signature = Buffer.from(sigB64, 'base64url');
    payloadRaw = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch {
    return { ok: false as const, error: 'Activation key is malformed.' };
  }

  const validSig = crypto.verify(
    null,
    Buffer.from(`HSL1.${payloadB64}`, 'utf8'),
    HOSILA_LICENSE_PUBLIC_KEY,
    signature
  );
  if (!validSig) {
    return { ok: false as const, error: 'Invalid activation key signature.' };
  }

  const p = JSON.parse(payloadRaw);
  const keyProduct = p.product ?? 'hosila-pms';

  if (p.type === 'commercial') {
    if (keyProduct === '*' || keyProduct !== CURRENT_PRODUCT_ID) {
      return { ok: false as const, error: `This key is for ${keyProduct} and cannot activate ${CURRENT_PRODUCT_NAME}.` };
    }
    if (p.machineId === '*' || p.machineId.toUpperCase() !== expectedMachineId.toUpperCase()) {
      return { ok: false as const, error: `This key is locked to Host PC ${p.machineId} and cannot be reused on ${expectedMachineId}.` };
    }
  } else if (p.type === 'master') {
    if (keyProduct !== '*' && keyProduct !== CURRENT_PRODUCT_ID) {
      return { ok: false as const, error: `This Master key is scoped to ${keyProduct}.` };
    }
    if (p.machineId !== '*' && p.machineId.toUpperCase() !== expectedMachineId.toUpperCase()) {
      return { ok: false as const, error: `This Master key is scoped to ${p.machineId}.` };
    }
  } else {
    return { ok: false as const, error: 'Unsupported license type.' };
  }

  return { ok: true as const, payload: p };
}
```

---

## 6. Lifecycle, Trial, Grace Period & Enforcement Rules

1. **Storage**: Store `license_key`, `trial_started_at`, `trial_expires_at`, `activated_at`, `activated_by`, and `last_seen_at` in a single-row SQLite table (`app_license`) on the Host PC so all LAN workstations share the host's license automatically.
2. **Clock-Tamper Guard**: Always compute `effectiveNow = Math.max(Date.now(), Date.parse(last_seen_at))` and periodically advance `last_seen_at`.
3. **14-Day Offline Trial**: Allowed once per Host PC (`trial_started_at IS NULL`).
4. **Lifetime Keys**: `expiresAt === null` → always `status: 'active'`, `readOnly: false`.
5. **Timed Keys (Monthly / Yearly / Custom)**:
   - Before `expiresAt`: `status: 'active'`, `readOnly: false`.
   - Up to **30 days** after `expiresAt`: `status: 'grace'`, `readOnly: false` (show renewal warning banner).
   - Beyond 30 days after `expiresAt`: `status: 'expired'`, `readOnly: true` (block `POST`/`PATCH`/`DELETE` operational endpoints with HTTP `402` while allowing `GET` reads, backups, and `/api/license/activate`).
6. **UI Integration**:
   - **Activation Gate**: Shown before Onboarding/Sign-In when `status === 'unlicensed'` (displays Host PC Machine ID with Copy button, key paste box, and optional 14-day Trial button).
   - **Settings → License & Activation**: Shows current license status, Machine ID, Customer Name, Full Access status, Expiry/Lifetime, and a Management-only form to apply/renew a key.

