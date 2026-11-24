import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.KEYGEN_PORT) || 4791;
const PRIV_KEY_PATH = path.join(__dirname, 'hosila-master-private.pem');
const UI_PATH = path.join(__dirname, 'ui.html');
const HISTORY_PATH = path.join(__dirname, 'issued-keys.json');

const VALID_PRODUCTS = new Set(['hosila-pms', 'hosila-ims', 'hosila-pos', '*']);

if (!fs.existsSync(PRIV_KEY_PATH)) {
  console.error(`ERROR: Missing private key at ${PRIV_KEY_PATH}`);
  process.exit(1);
}

const PRIVATE_KEY_PEM = fs.readFileSync(PRIV_KEY_PATH, 'utf8');

function readHistory() {
  try {
    if (!fs.existsSync(HISTORY_PATH)) return [];
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function appendHistory(entry) {
  const list = readHistory();
  list.unshift(entry);
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(list.slice(0, 200), null, 2), 'utf8');
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 64 * 1024) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  if (req.method === 'GET' && url.pathname === '/') {
    const html = fs.readFileSync(UI_PATH, 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(html);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/history') {
    sendJson(res, 200, { history: readHistory() });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/generate') {
    try {
      const body = await readJsonBody(req);
      const isMaster = body.type === 'master';
      const product = String(body.product || (isMaster ? '*' : 'hosila-pms')).trim();

      if (!VALID_PRODUCTS.has(product)) {
        return sendJson(res, 400, { error: 'Invalid Hosila product selected.' });
      }
      if (!isMaster && product === '*') {
        return sendJson(res, 400, { error: 'Customer keys must be locked to a single product (PMS, IMS, or POS).' });
      }

      const rawMachine = String(body.machineId || '').trim().toUpperCase();
      const machineId = isMaster ? (rawMachine || '*') : rawMachine;

      if (!isMaster && !/^HSLA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machineId)) {
        return sendJson(res, 400, {
          error: 'Enter a valid Machine ID (format: HSLA-XXXX-XXXX-XXXX).',
        });
      }

      const hotelName = String(body.customerName || '').trim().slice(0, 100) || (isMaster ? 'Hosila Master License' : '');
      if (!isMaster && !hotelName) {
        return sendJson(res, 400, { error: 'Customer / Business Name is required.' });
      }

      const durationMode = String(body.durationMode || 'lifetime');
      let expiresAt = null;
      let durationLabel = 'Lifetime';

      const now = new Date();
      if (durationMode !== 'lifetime') {
        const days = Math.max(1, Math.floor(Number(body.days || 365) || 365));
        expiresAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
        durationLabel = days === 30 ? 'Monthly (30d)' : days === 90 ? 'Quarterly (90d)' : days === 365 ? 'Yearly (365d)' : `${days} days`;
      }

      const prefixMap = { 'hosila-pms': 'PMS', 'hosila-ims': 'IMS', 'hosila-pos': 'POS', '*': 'ALL' };
      const prodCode = prefixMap[product] || 'HSL';
      const serial = `${isMaster ? 'MST' : prodCode}-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

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
      const sig = crypto.sign(null, Buffer.from(`HSL1.${payloadB64}`, 'utf8'), PRIVATE_KEY_PEM);
      const activationKey = `HSL1.${payloadB64}.${sig.toString('base64url')}`;

      const record = {
        id: serial,
        product,
        type: payload.type,
        customerName: hotelName,
        machineId,
        durationLabel,
        issuedAt: payload.issuedAt,
        expiresAt: payload.expiresAt,
        activationKey,
      };
      appendHistory(record);

      return sendJson(res, 200, { key: activationKey, record });
    } catch (err) {
      return sendJson(res, 400, { error: err instanceof Error ? err.message : 'Failed to generate key.' });
    }
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Hosila Suite KeyGen running locally at http://127.0.0.1:${PORT}`);
});

