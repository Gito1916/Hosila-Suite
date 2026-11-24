import crypto from 'node:crypto';
import { readJsonBody, sendJson, verifySessionCookie } from './_session.js';

const HOSILA_LICENSE_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAR27XVAxZEFcOz9eSFkR+W6DdRW4FAZKRqjttw4EiXzM=
-----END PUBLIC KEY-----`;

const VALID_PRODUCTS = new Set(['hosila-pms', 'hosila-ims', 'hosila-pos', '*']);
const MACHINE_ID_RE = /^HSLA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

export function signHosilaKey(body, privateKeyPem) {
  const isMaster = body.type === 'master';
  const product = String(body.product || (isMaster ? '*' : 'hosila-pms')).trim();

  if (!VALID_PRODUCTS.has(product)) {
    throw new Error('Invalid Hosila product selected.');
  }
  if (!isMaster && product === '*') {
    throw new Error('Commercial keys must be locked to a single product (PMS, IMS, or POS).');
  }

  const rawMachine = String(body.machineId || '').trim().toUpperCase();
  const machineId = isMaster ? rawMachine || '*' : rawMachine;

  if (!isMaster && !MACHINE_ID_RE.test(machineId)) {
    throw new Error('Enter a valid Machine ID (format: HSLA-XXXX-XXXX-XXXX).');
  }

  const hotelName =
    String(body.customerName || '').trim().slice(0, 100) || (isMaster ? 'Hosila Master License' : '');
  if (!isMaster && !hotelName) {
    throw new Error('Customer / Hotel Name is required.');
  }

  const durationMode = String(body.durationMode || 'yearly');
  let expiresAt = null;
  let durationLabel = 'Lifetime';

  const now = new Date();
  if (durationMode !== 'lifetime') {
    const days = Math.max(1, Math.min(3650, Math.floor(Number(body.days || 365) || 365)));
    expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
    durationLabel =
      days === 30
        ? 'Monthly (30d)'
        : days === 90
          ? 'Quarterly (90d)'
          : days === 365
            ? 'Annual (365d)'
            : `${days} days`;
  }

  const prefixMap = { 'hosila-pms': 'PMS', 'hosila-ims': 'IMS', 'hosila-pos': 'POS', '*': 'ALL' };
  const prodCode = prefixMap[product] || 'HSL';
  const serial = `${isMaster ? 'MST' : prodCode}-${now.getFullYear()}-${crypto
    .randomBytes(3)
    .toString('hex')
    .toUpperCase()}`;

  const payload = {
    v: 1,
    id: serial,
    product,
    type: isMaster ? 'master' : 'commercial',
    machineId,
    hotelName,
    issuedAt: now.toISOString(),
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = Buffer.from(`HSL1.${payloadB64}`, 'utf8');
  const sig = crypto.sign(null, signingInput, privateKeyPem);

  // Self-verify against the exact public key embedded in Hosila PMS & Hosila IMS
  const valid = crypto.verify(null, signingInput, HOSILA_LICENSE_PUBLIC_KEY, sig);
  if (!valid) {
    throw new Error('Server signing key does not match the official Hosila public key.');
  }

  const activationKey = `HSL1.${payloadB64}.${sig.toString('base64url')}`;
  return {
    key: activationKey,
    record: {
      id: serial,
      product,
      type: payload.type,
      customerName: hotelName,
      machineId,
      durationLabel,
      issuedAt: payload.issuedAt,
      expiresAt: payload.expiresAt,
      activationKey,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'Method not allowed.' });
  }

  if (!verifySessionCookie(req)) {
    return sendJson(res, 401, { error: 'Session locked. Please unlock with your passcode.' });
  }

  const rawPem = process.env.HOSILA_MASTER_PRIVATE_PEM?.trim();
  if (!rawPem) {
    return sendJson(res, 503, { error: 'HOSILA_MASTER_PRIVATE_PEM is not configured on the server.' });
  }
  const privateKeyPem = rawPem.replace(/\\n/g, '\n');

  try {
    const body = await readJsonBody(req);
    const result = signHosilaKey(body, privateKeyPem);
    return sendJson(res, 200, result);
  } catch (err) {
    return sendJson(res, 400, { error: err instanceof Error ? err.message : 'Failed to generate key.' });
  }
}
