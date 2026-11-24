import crypto from 'node:crypto';

export const COOKIE_NAME = 'hosila_kg_session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 days

function getSessionSecret() {
  const secret = process.env.KEYGEN_SESSION_SECRET?.trim();
  if (!secret || secret.length < 16) {
    throw new Error('KEYGEN_SESSION_SECRET is not configured on the server.');
  }
  return secret;
}

export function timingSafePasscodeEqual(input, expected) {
  const a = crypto.createHash('sha256').update(String(input || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createSessionToken() {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SEC;
  const nonce = crypto.randomBytes(12).toString('base64url');
  const data = `${exp}.${nonce}`;
  const sig = crypto.createHmac('sha256', getSessionSecret()).update(data).digest('base64url');
  return `${data}.${sig}`;
}

export function verifySessionCookie(req) {
  try {
    const rawCookie = String(req.headers?.cookie || '');
    const match = rawCookie.split(';').map((s) => s.trim()).find((s) => s.startsWith(`${COOKIE_NAME}=`));
    if (!match) return false;
    const token = decodeURIComponent(match.slice(COOKIE_NAME.length + 1));
    const parts = token.split('.');
    if (parts.length !== 3) return false;
    const [expStr, nonce, sig] = parts;
    const exp = Number(expStr);
    if (!Number.isFinite(exp) || exp < Math.floor(Date.now() / 1000)) return false;
    const expectedSig = crypto
      .createHmac('sha256', getSessionSecret())
      .update(`${expStr}.${nonce}`)
      .digest('base64url');
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedSig, 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

export function buildSetCookieHeader(token, clear = false) {
  const isProd = process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
  const attrs = [
    `${COOKIE_NAME}=${clear ? '' : encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${clear ? 0 : SESSION_TTL_SEC}`,
  ];
  if (isProd) attrs.push('Secure');
  return attrs.join('; ');
}

export function sendJson(res, status, data, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 64 * 1024) throw new Error('Payload too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}
