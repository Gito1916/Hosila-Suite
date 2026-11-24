import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import crypto from 'node:crypto';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  closeDatabaseGracefully,
  computeNights,
  computeReports,
  DATA_DIR,
  db,
  DB_FILE_PATH,
  deleteStaffSessionByToken,
  deleteStaffSessionsForUser,
  getAppCategories,
  getEmailTemplates,
  getFullBootstrapState,
  getNextSequenceValue,
  getPublicStaffUsers,
  getSettings,
  getStaffSessionByToken,
  getStayById,
  getTaxRules,
  initDatabase,
  pruneExpiredStaffSessions,
  roundMoney,
  saveStaffSession,
  syncLegacyTaxSettingsFromRules,
  touchStaffSessionExpiry,
  updateStaffSessionsRole,
  upsertAppCategory,
  type AppCategoryKind,
  type StaffRole,
  type StaffUserRow,
} from './server/db.ts';
import { addDaysLocalIso, getServerLocalIsoDate } from './server/utils.ts';
import {
  dispatchStayEmail,
  isEmailServiceEnabled,
  isResendConfigured,
  isSafeLogoUrl,
  retryQueuedEmails,
} from './server/email.ts';
import fs from 'node:fs';
import {
  checkScheduledNightAudit,
  createDatabaseBackup,
  getAccountingOverview,
  initAccountingTables,
  recordDepositTransferToGuestLedger,
  recordExpenseJournal,
  recordExpenseVoidJournal,
  recordExtraIncomeJournal,
  recordExtraIncomeVoidJournal,
  recordFolioChargeJournal,
  recordFolioChargeVoidJournal,
  recordFolioCreditNoteJournal,
  recordFolioPaymentJournal,
  recordFolioPaymentVoidJournal,
  recordFolioRefundJournal,
  recordPosOrderJournal,
  recordPosOrderVoidJournal,
  recordPosTabSettlementJournal,
  recordVoidAuditLog,
  reconcileStayAllocations,
  resolveBackupPath,
  restoreDatabaseFromBackup,
  runNightAudit,
  type DatabaseBackupRow,
} from './server/accounting.ts';
import {
  calculateTransactionTax,
  domainForChargeCategory,
  type TaxAppliesTo,
  type TaxMode,
} from './server/tax.ts';
import {
  activateLicenseKey,
  getLicenseStatus,
  initLicenseTable,
  startLocalTrial,
} from './server/license.ts';

initDatabase();
initAccountingTables();
initLicenseTable();

const PORT = Number(process.env.PORT) || 3000;
const IS_PRODUCTION =
  process.env.NODE_ENV === 'production' ||
  Boolean(process.argv[1]?.toLowerCase().endsWith('.mjs'));

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));

// Security headers for LAN & production hardening
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// ---------------- AUTH & SESSION MANAGEMENT ----------------

interface ActiveSession {
  token: string;
  userId: number;
  fullName: string;
  username: string;
  role: StaffRole;
  shiftId: number;
  shiftOpenedAt: string;
  stationName: string;
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12-hour sliding TTL

function resolveActiveSession(token: string): ActiveSession | undefined {
  const row = getStaffSessionByToken(token);
  if (!row) return undefined;
  const now = Date.now();
  const expiresMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresMs) || expiresMs <= now) {
    deleteStaffSessionByToken(token);
    return undefined;
  }
  // Ensure the underlying staff account is still active
  const user = db.prepare('SELECT active, role, full_name FROM staff_users WHERE id = ?').get(row.user_id) as
    | { active: number; role: StaffRole; full_name: string }
    | undefined;
  if (!user || user.active !== 1) {
    deleteStaffSessionByToken(token);
    return undefined;
  }
  // Sliding expiration refresh when more than 30 minutes have elapsed
  if (expiresMs - now < SESSION_TTL_MS - 30 * 60 * 1000) {
    touchStaffSessionExpiry(token, new Date(now + SESSION_TTL_MS).toISOString());
  }
  return {
    token: row.token,
    userId: row.user_id,
    fullName: user.full_name || row.full_name,
    username: row.username,
    role: user.role,
    shiftId: row.shift_id,
    shiftOpenedAt: row.shift_opened_at,
    stationName: row.station_name,
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, storedHash: string): boolean {
  const [salt, expectedHex] = storedHash.split(':');
  if (!salt || !expectedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

const SESSION_COOKIE_NAME = 'hosila_session';

function extractCookieToken(req: Request): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rest] = part.trim().split('=');
    if (rawName === SESSION_COOKIE_NAME) {
      const value = rest.join('=').trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

function extractBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) {
    const token = header.slice(7).trim();
    if (token) return token;
  }
  return extractCookieToken(req);
}

function setSessionCookie(req: Request, res: Response, token: string): void {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  const parts = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isHttps) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res: Response): void {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

// In-memory brute-force protection for /api/auth/login (5 failed attempts -> 10 min lockout)
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCKOUT_MS = 10 * 60 * 1000;
const loginFailures = new Map<string, { count: number; lockedUntil: number }>();

function getLoginAttemptKey(req: Request, username: string): string {
  const ip = (req.ip || req.socket.remoteAddress || '127.0.0.1').replace(/^::ffff:/, '');
  return `${ip}::${username.toLowerCase()}`;
}

function checkLoginLockout(key: string): number {
  const rec = loginFailures.get(key);
  if (!rec) return 0;
  const now = Date.now();
  if (rec.lockedUntil > now) {
    return Math.ceil((rec.lockedUntil - now) / 1000);
  }
  if (rec.lockedUntil > 0 && rec.lockedUntil <= now) {
    loginFailures.delete(key);
  }
  return 0;
}

function recordLoginFailure(key: string): void {
  const current = loginFailures.get(key) ?? { count: 0, lockedUntil: 0 };
  const nextCount = current.count + 1;
  if (nextCount >= LOGIN_MAX_ATTEMPTS) {
    loginFailures.set(key, { count: nextCount, lockedUntil: Date.now() + LOGIN_LOCKOUT_MS });
  } else {
    loginFailures.set(key, { count: nextCount, lockedUntil: 0 });
  }
}

function clearLoginFailures(key: string): void {
  loginFailures.delete(key);
}

interface AuthedRequest extends Request {
  session?: ActiveSession;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = extractBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  const session = resolveActiveSession(token);
  if (!session) return res.status(401).json({ error: 'Session expired. Please sign in again.' });
  req.session = session;
  return next();
}

function isManagementOrAccountant(role: StaffRole): boolean {
  return role === 'management' || role === 'accountant';
}

function isFinancialControlRole(role: StaffRole): boolean {
  return role === 'management' || role === 'accountant' || role === 'auditor';
}

function requireFinanceOrSettings(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  if (!isManagementOrAccountant(req.session.role)) {
    return res.status(403).json({ error: 'Access restricted to Management and Accountant accounts' });
  }
  return next();
}

function requireFinancialControl(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  if (!isFinancialControlRole(req.session.role)) {
    return res.status(403).json({
      error: 'Action blocked: only Management, Accountant, or Auditor accounts can void or adjust financial records',
    });
  }
  return next();
}

function validateVoidPayload(body: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  if (payload.confirmed !== true) {
    return { ok: false, error: 'Explicit confirmation is required before voiding a financial transaction' };
  }
  const reason = String(payload.reason ?? '').trim().slice(0, 200);
  if (reason.length < 4) {
    return { ok: false, error: 'A clear void reason (at least 4 characters) is required for the audit trail' };
  }
  return { ok: true, reason };
}

function requireFrontDeskAccess(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.role === 'restaurant') {
    return res.status(403).json({ error: 'Restaurant staff accounts are scoped to Restaurant POS only' });
  }
  return next();
}

function requireManagementOnly(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.session) return res.status(401).json({ error: 'Authentication required' });
  if (req.session.role !== 'management') {
    return res.status(403).json({ error: 'This action is restricted to Management accounts only' });
  }
  return next();
}

function createSessionForUser(user: StaffUserRow, stationName: string, openingCash = 0): ActiveSession {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const expiresAt = new Date(now + SESSION_TTL_MS).toISOString();
  const shiftInfo = db
    .prepare(
      `INSERT INTO shifts (user_id, user_name, user_role, station_name, opened_at, opening_cash, status)
       VALUES (?, ?, ?, ?, ?, ?, 'open')`
    )
    .run(user.id, user.full_name, user.role, stationName, nowIso, openingCash);

  const token = crypto.randomBytes(32).toString('hex');
  const shiftId = Number(shiftInfo.lastInsertRowid);
  saveStaffSession({
    token,
    user_id: user.id,
    full_name: user.full_name,
    username: user.username,
    role: user.role,
    shift_id: shiftId,
    shift_opened_at: nowIso,
    station_name: stationName,
    created_at: nowIso,
    expires_at: expiresAt,
  });

  return {
    token,
    userId: user.id,
    fullName: user.full_name,
    username: user.username,
    role: user.role,
    shiftId,
    shiftOpenedAt: nowIso,
    stationName,
  };
}

// ---------------- WEBSOCKET LAN SYNC ----------------

interface ConnectedStation {
  id: string;
  stationName: string;
  role: 'Front Desk' | 'Restaurant POS' | 'Management Office';
  userRole: StaffRole | null;
  userName: string;
  ip: string;
  connectedAt: string;
}

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const stationMap = new Map<WebSocket, ConnectedStation>();

function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const entries = interfaces[name] ?? [];
    for (const entry of entries) {
      if (entry.family === 'IPv4' && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }
  return addresses;
}

function getNetworkInfo() {
  const lanAddresses = getLanAddresses();
  const stations = Array.from(stationMap.values());
  return {
    hostname: os.hostname(),
    port: PORT,
    lanUrls: lanAddresses.map((ip) => `http://${ip}:${PORT}`),
    localUrl: `http://localhost:${PORT}`,
    databaseFile: path.basename(DB_FILE_PATH),
    resendConfigured: isResendConfigured(),
    emailEnabled: isEmailServiceEnabled(),
    connectedStations: stations,
  };
}

function broadcastPresence() {
  const payload = {
    connectedStations: Array.from(stationMap.values()),
  };
  const message = JSON.stringify({
    type: 'presence:update',
    payload,
    timestamp: new Date().toISOString(),
  });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

function broadcastStateSync(reason: string) {
  const network = getNetworkInfo();
  const timestamp = new Date().toISOString();
  const serializedByRole = new Map<StaffRole, string>();

  for (const client of wss.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    const station = stationMap.get(client);
    if (!station?.userRole) continue;
    let payloadStr = serializedByRole.get(station.userRole);
    if (!payloadStr) {
      payloadStr = JSON.stringify({
        type: 'state:sync',
        payload: {
          reason,
          state: getFullBootstrapState(station.userRole),
          network,
        },
        timestamp,
      });
      serializedByRole.set(station.userRole, payloadStr);
    }
    client.send(payloadStr);
  }
}

let stationCounter = 1;

wss.on('connection', (ws, req) => {
  const remoteIp = (req.socket.remoteAddress ?? '127.0.0.1').replace(/^::ffff:/, '');
  const id = `ws-${Date.now()}-${stationCounter++}`;
  stationMap.set(ws, {
    id,
    stationName: `Workstation ${stationCounter - 1}`,
    role: 'Front Desk',
    userRole: null,
    userName: '',
    ip: remoteIp,
    connectedAt: new Date().toISOString(),
  });

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(String(raw)) as { type?: string; payload?: Record<string, unknown> };
      if (msg.type === 'station:identify' && msg.payload) {
        const current = stationMap.get(ws);
        if (!current) return;

        const token = typeof msg.payload.token === 'string' ? msg.payload.token : '';
        const session = token ? resolveActiveSession(token) : undefined;
        const validRoles = ['Front Desk', 'Restaurant POS', 'Management Office'] as const;
        const requestedRole = String(msg.payload.role ?? '');
        const role = (validRoles as readonly string[]).includes(requestedRole)
          ? (requestedRole as ConnectedStation['role'])
          : current.role;
        const stationName =
          String(msg.payload.stationName ?? current.stationName).trim().slice(0, 48) || current.stationName;

        stationMap.set(ws, {
          ...current,
          role,
          stationName,
          userRole: session ? session.role : null,
          userName: session ? session.fullName : '',
        });

        if (session) {
          ws.send(
            JSON.stringify({
              type: 'state:init',
              payload: {
                stationId: id,
                state: getFullBootstrapState(session.role),
                network: getNetworkInfo(),
              },
              timestamp: new Date().toISOString(),
            })
          );
        }
        broadcastPresence();
      } else if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      }
    } catch {
      // Ignore malformed messages
    }
  });

  ws.on('close', () => {
    stationMap.delete(ws);
    broadcastPresence();
  });
});

// ---------------- VALIDATORS ----------------

function parsePositiveInt(val: unknown): number | null {
  const n = Number(val);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

function parseMoney(val: unknown): number | null {
  const n = Number(val);
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000_000) return null;
  return roundMoney(n);
}

function isValidIsoDate(val: unknown): val is string {
  if (typeof val !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(val)) return false;
  const [y, m, d] = val.split('-').map(Number);
  if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isValidTime(val: unknown): val is string {
  return typeof val === 'string' && /^\d{2}:\d{2}$/.test(val);
}

const VALID_STAFF_ROLES = new Set<StaffRole>(['management', 'accountant', 'auditor', 'front_desk', 'restaurant']);
const VALID_PAYMENT_METHODS = new Set(['cash', 'card', 'bank_transfer', 'corporate']);
const VALID_TAX_MODES = new Set<TaxMode>(['exclusive', 'inclusive']);
const VALID_TAX_SCOPES = new Set<TaxAppliesTo>(['accommodation', 'restaurant', 'both']);

// ---------------- LICENSE, HEALTH & DIAGNOSTICS ROUTES ----------------

app.get('/api/health', (_req, res) => {
  let dbIntegrity = 'ok';
  try {
    const check = db.pragma('quick_check') as Array<{ quick_check?: string }>;
    dbIntegrity = check.length > 0 && check.every((r) => r.quick_check === 'ok') ? 'ok' : 'error';
  } catch {
    dbIntegrity = 'error';
  }
  const license = getLicenseStatus();
  const lastBackup = db
    .prepare('SELECT filename, created_at, size_bytes FROM database_backups ORDER BY created_at DESC, id DESC LIMIT 1')
    .get() as { filename: string; created_at: string; size_bytes: number } | undefined;

  return res.json({
    ok: dbIntegrity === 'ok',
    app: 'Hosila PMS',
    uptimeSeconds: Math.floor(process.uptime()),
    dbIntegrity,
    licenseStatus: license.status,
    licenseMode: license.mode,
    connectedStations: stationMap.size,
    lastBackupAt: lastBackup?.created_at ?? null,
  });
});

app.get('/api/license/status', (_req, res) => {
  return res.json({ license: getLicenseStatus() });
});

app.post('/api/license/trial', (_req, res) => {
  const result = startLocalTrial();
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }
  broadcastStateSync('license:trial_started');
  return res.json({ license: result.status });
});

app.post('/api/license/activate', (req: AuthedRequest, res) => {
  const rawKey = String(req.body?.license_key ?? req.body?.key ?? '').trim();
  const staffCount = (db.prepare('SELECT COUNT(*) as count FROM staff_users').get() as { count: number }).count;

  // Once staff accounts exist, require Management authentication unless the license is currently expired/unlicensed
  const currentStatus = getLicenseStatus();
  let activatedBy = 'Initial Setup';
  if (staffCount > 0 && !currentStatus.readOnly) {
    const token = extractBearerToken(req);
    const session = token ? resolveActiveSession(token) : undefined;
    if (!session) {
      return res.status(401).json({ error: 'Management sign-in required to change an active license.' });
    }
    if (session.role !== 'management') {
      return res.status(403).json({ error: 'Only Management accounts can update the license key.' });
    }
    activatedBy = session.fullName;
  } else {
    const token = extractBearerToken(req);
    const session = token ? resolveActiveSession(token) : undefined;
    if (session) activatedBy = session.fullName;
  }

  const result = activateLicenseKey(rawKey, activatedBy);
  if (!result.ok) {
    return res.status(400).json({ error: result.error });
  }

  broadcastStateSync('license:activated');
  return res.json({ license: result.status });
});

app.get('/api/system/diagnostics', requireAuth, requireManagementOnly, (_req: AuthedRequest, res) => {
  const license = getLicenseStatus();
  const migrations = db.prepare('SELECT version, description, applied_at FROM schema_migrations ORDER BY applied_at DESC').all();
  const recentBackups = db
    .prepare('SELECT filename, trigger_type, business_date, size_bytes, created_at FROM database_backups ORDER BY created_at DESC LIMIT 10')
    .all();
  let dbSizeBytes = 0;
  try {
    dbSizeBytes = fs.statSync(DB_FILE_PATH).size;
  } catch {
    dbSizeBytes = 0;
  }
  return res.json({
    generatedAt: new Date().toISOString(),
    app: 'Hosila PMS',
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    uptimeSeconds: Math.floor(process.uptime()),
    dataDir: DATA_DIR,
    dbSizeBytes,
    backupMirrorConfigured: Boolean(process.env.HOSILA_BACKUP_MIRROR_DIR?.trim()),
    connectedStations: stationMap.size,
    license: {
      status: license.status,
      mode: license.mode,
      machineId: license.machineId,
      expiresAt: license.expiresAt,
      readOnly: license.readOnly,
    },
    migrations,
    recentBackups,
  });
});

// Enforce Read-Only mode on operational writes when license is unlicensed or expired past grace period
app.use('/api', (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    return next();
  }
  const p = req.path;
  if (
    p.startsWith('/auth/') ||
    p.startsWith('/license/') ||
    p === '/health' ||
    p === '/system/diagnostics'
  ) {
    return next();
  }
  const license = getLicenseStatus();
  if (license.readOnly) {
    return res.status(402).json({
      error: license.message || 'Hosila PMS is in Read-Only mode. Activate a valid license key in Settings.',
      code: 'LICENSE_REQUIRED',
    });
  }
  return next();
});

// ---------------- AUTH & ONBOARDING ROUTES (PUBLIC) ----------------

app.get('/api/auth/status', (_req, res) => {
  const settings = getSettings();
  const users = getPublicStaffUsers().filter((u) => u.active === 1);
  return res.json({
    needsSetup: users.length === 0,
    hotelName: settings.hotel_name,
    hotelLogoUrl: settings.hotel_logo_url,
    license: getLicenseStatus(),
    staffDirectory: users.map((u) => ({
      username: u.username,
      full_name: u.full_name,
      role: u.role,
    })),
  });
});

app.post('/api/auth/setup', (req, res) => {
  const existingCount = (db.prepare('SELECT COUNT(*) as count FROM staff_users').get() as { count: number }).count;
  if (existingCount > 0) {
    return res.status(409).json({ error: 'Initial onboarding has already been completed' });
  }

  const fullName = String(req.body.full_name ?? '').trim().slice(0, 80);
  const username = String(req.body.username ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
  const password = String(req.body.password ?? '');
  const createTeamProfiles = Boolean(req.body.create_team_profiles);
  const teamPassword = String(req.body.team_password ?? '');

  if (!fullName || !username) {
    return res.status(400).json({ error: 'Administrator full name and username are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Administrator password must be at least 8 characters' });
  }
  if (createTeamProfiles && teamPassword.length < 6) {
    return res.status(400).json({ error: 'Staff team password must be at least 6 characters' });
  }

  // Validate hotel onboarding details
  const current = getSettings();
  const hotelName = String(req.body.hotel_name ?? current.hotel_name).trim().slice(0, 100);
  if (!hotelName) {
    return res.status(400).json({ error: 'Hotel name is required' });
  }
  const hotelTagline = String(req.body.hotel_tagline ?? current.hotel_tagline).trim().slice(0, 140);
  const hotelAddress = String(req.body.hotel_address ?? current.hotel_address).trim().slice(0, 180);
  const hotelPhone = String(req.body.hotel_phone ?? current.hotel_phone).trim().slice(0, 48);
  const hotelEmail = String(req.body.hotel_email ?? current.hotel_email).trim().slice(0, 120);
  const hotelWebsite = String(req.body.hotel_website ?? current.hotel_website).trim().slice(0, 140);
  const hotelLogoUrl = String(req.body.hotel_logo_url ?? '').trim();
  if (!isSafeLogoUrl(hotelLogoUrl)) {
    return res.status(400).json({
      error: 'Logo must be a valid http(s) URL or a PNG/JPEG/WebP image upload under 500 KB',
    });
  }

  const checkInTime = isValidTime(req.body.check_in_time) ? req.body.check_in_time : current.check_in_time;
  const checkOutTime = isValidTime(req.body.check_out_time) ? req.body.check_out_time : current.check_out_time;
  const currencySymbol =
    String(req.body.currency_symbol ?? current.currency_symbol).trim().slice(0, 4) || current.currency_symbol;
  const taxId = String(req.body.tax_id ?? '').trim().slice(0, 64);

  const taxEnabled = req.body.tax_enabled !== undefined ? (req.body.tax_enabled ? 1 : 0) : current.tax_enabled;
  const taxName = String(req.body.tax_name ?? current.tax_name).trim().slice(0, 40) || 'VAT';
  const taxRate =
    req.body.tax_rate !== undefined && Number.isFinite(Number(req.body.tax_rate))
      ? Math.max(0, Math.min(50, Number(req.body.tax_rate)))
      : current.tax_rate;
  const taxMode: TaxMode = VALID_TAX_MODES.has(req.body.tax_mode) ? req.body.tax_mode : current.tax_mode;
  const taxAppliesTo: TaxAppliesTo = VALID_TAX_SCOPES.has(req.body.tax_applies_to)
    ? req.body.tax_applies_to
    : current.tax_applies_to;

  const nowIso = new Date().toISOString();
  const managerHash = hashPassword(password);

  const createdUser = db.transaction(() => {
    // Re-check atomically inside transaction
    const check = (db.prepare('SELECT COUNT(*) as count FROM staff_users').get() as { count: number }).count;
    if (check > 0) return null;

    db.prepare(
      `UPDATE settings
       SET hotel_name = ?, hotel_tagline = ?, hotel_address = ?, hotel_phone = ?, hotel_email = ?, hotel_website = ?,
           hotel_logo_url = ?, check_in_time = ?, check_out_time = ?, tax_id = ?, currency_symbol = ?,
           tax_enabled = ?, tax_name = ?, tax_rate = ?, tax_mode = ?, tax_applies_to = ?
       WHERE id = 1`
    ).run(
      hotelName,
      hotelTagline,
      hotelAddress,
      hotelPhone,
      hotelEmail,
      hotelWebsite,
      hotelLogoUrl,
      checkInTime,
      checkOutTime,
      taxId,
      currencySymbol,
      taxEnabled,
      taxName,
      taxRate,
      taxMode,
      taxAppliesTo
    );

    // Sync initial tax rule during onboarding
    const existingRule = db.prepare('SELECT id FROM tax_rules ORDER BY sort_order ASC, id ASC LIMIT 1').get() as
      | { id: number }
      | undefined;
    if (existingRule) {
      db.prepare('UPDATE tax_rules SET name = ?, rate = ?, mode = ?, applies_to = ?, enabled = 1 WHERE id = ?').run(
        taxName,
        taxRate,
        taxMode,
        taxAppliesTo,
        existingRule.id
      );
    } else if (taxRate > 0) {
      db.prepare(
        'INSERT INTO tax_rules (name, rate, mode, applies_to, enabled, sort_order, created_at) VALUES (?, ?, ?, ?, 1, 0, ?)'
      ).run(taxName, taxRate, taxMode, taxAppliesTo, nowIso);
    }

    const info = db
      .prepare(
        `INSERT INTO staff_users (full_name, username, role, password_hash, active, created_at)
         VALUES (?, ?, 'management', ?, 1, ?)`
      )
      .run(fullName, username, managerHash, nowIso);

    if (createTeamProfiles) {
      const staffHash = hashPassword(teamPassword);
      const insertStaff = db.prepare(
        `INSERT OR IGNORE INTO staff_users (full_name, username, role, password_hash, active, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`
      );
      insertStaff.run('Accountant', 'accountant', 'accountant', staffHash, nowIso);
      insertStaff.run('Front Desk', 'frontdesk', 'front_desk', staffHash, nowIso);
      insertStaff.run('Restaurant Staff', 'restaurant', 'restaurant', staffHash, nowIso);
    }

    return db.prepare('SELECT * FROM staff_users WHERE id = ?').get(Number(info.lastInsertRowid)) as StaffUserRow;
  })();

  if (!createdUser) {
    return res.status(409).json({ error: 'Initial onboarding has already been completed' });
  }

  const session = createSessionForUser(createdUser, 'Management Office PC', 0);
  setSessionCookie(req, res, session.token);
  return res.status(201).json({
    session: {
      token: session.token,
      userId: session.userId,
      fullName: session.fullName,
      username: session.username,
      role: session.role,
      shiftId: session.shiftId,
      shiftOpenedAt: session.shiftOpenedAt,
    },
  });
});

app.post('/api/auth/login', (req, res) => {
  const username = String(req.body.username ?? '').trim().toLowerCase();
  const password = String(req.body.password ?? '');
  const stationName = String(req.body.station_name ?? 'Desk Terminal').trim().slice(0, 48) || 'Desk Terminal';
  const openingCash = parseMoney(req.body.opening_cash ?? 0) ?? 0;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required' });
  }

  const attemptKey = getLoginAttemptKey(req, username);
  const lockedSeconds = checkLoginLockout(attemptKey);
  if (lockedSeconds > 0) {
    const mins = Math.ceil(lockedSeconds / 60);
    return res.status(429).json({
      error: `Too many failed sign-in attempts. Please wait ${mins} minute${mins === 1 ? '' : 's'} before trying again.`,
    });
  }

  const user = db.prepare('SELECT * FROM staff_users WHERE username = ? AND active = 1').get(username) as
    | StaffUserRow
    | undefined;

  if (!user || !verifyPassword(password, user.password_hash)) {
    recordLoginFailure(attemptKey);
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  clearLoginFailures(attemptKey);
  const session = createSessionForUser(user, stationName, openingCash);
  setSessionCookie(req, res, session.token);
  return res.json({
    session: {
      token: session.token,
      userId: session.userId,
      fullName: session.fullName,
      username: session.username,
      role: session.role,
      shiftId: session.shiftId,
      shiftOpenedAt: session.shiftOpenedAt,
    },
  });
});

app.post('/api/auth/logout', requireAuth, (req: AuthedRequest, res) => {
  const session = req.session!;
  deleteStaffSessionByToken(session.token);
  clearSessionCookie(res);
  return res.json({ ok: true });
});

function computeShiftCashSummary(shiftId: number) {
  const shift = db.prepare('SELECT * FROM shifts WHERE id = ?').get(shiftId) as
    | {
        id: number;
        user_name: string;
        station_name: string;
        opened_at: string;
        opening_cash: number;
        status: string;
      }
    | undefined;

  if (!shift) {
    return {
      shiftId,
      openingCash: 0,
      cashFolioPayments: 0,
      cashPosSales: 0,
      cashExtraIncome: 0,
      cashExpenses: 0,
      cashRefunds: 0,
      expectedCash: 0,
      cardCollected: 0,
      bankTransferCollected: 0,
      corporateBilled: 0,
      transactionCount: 0,
    };
  }

  const folioRows = db
    .prepare(
      `SELECT method, COALESCE(kind, 'payment') AS kind, COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
       FROM folio_payments
       WHERE shift_id = ? AND COALESCE(voided, 0) = 0
       GROUP BY method, COALESCE(kind, 'payment')`
    )
    .all(shiftId) as Array<{ method: string; kind: string; total: number; cnt: number }>;

  const posRows = db
    .prepare(
      `SELECT settlement, COALESCE(SUM(total_amount), 0) AS total, COUNT(*) AS cnt
       FROM pos_orders
       WHERE shift_id = ? AND payment_status = 'paid' AND settlement != 'folio' AND COALESCE(voided, 0) = 0
       GROUP BY settlement`
    )
    .all(shiftId) as Array<{ settlement: string; total: number; cnt: number }>;

  const extraCash = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
         FROM extra_income
         WHERE shift_id = ? AND voided = 0 AND payment_method = 'cash'`
      )
      .get(shiftId) as { total: number; cnt: number }
  );

  const expenseCash = (
    db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS cnt
         FROM expenses
         WHERE shift_id = ? AND voided = 0 AND payment_method = 'cash'`
      )
      .get(shiftId) as { total: number; cnt: number }
  );

  let cashFolioPayments = 0;
  let cashRefunds = 0;
  let cardCollected = 0;
  let bankTransferCollected = 0;
  let corporateBilled = 0;
  let transactionCount = extraCash.cnt + expenseCash.cnt;

  for (const r of folioRows) {
    transactionCount += r.cnt;
    if (r.kind === 'refund') {
      if (r.method === 'cash') cashRefunds = roundMoney(cashRefunds + r.total);
      else if (r.method === 'card') cardCollected = roundMoney(cardCollected - r.total);
      else if (r.method === 'bank_transfer') bankTransferCollected = roundMoney(bankTransferCollected - r.total);
    } else {
      if (r.method === 'cash') cashFolioPayments = roundMoney(cashFolioPayments + r.total);
      else if (r.method === 'card') cardCollected = roundMoney(cardCollected + r.total);
      else if (r.method === 'bank_transfer') bankTransferCollected = roundMoney(bankTransferCollected + r.total);
      else if (r.method === 'corporate') corporateBilled = roundMoney(corporateBilled + r.total);
    }
  }

  let cashPosSales = 0;
  for (const r of posRows) {
    transactionCount += r.cnt;
    if (r.settlement === 'cash') cashPosSales = roundMoney(cashPosSales + r.total);
    else if (r.settlement === 'card') cardCollected = roundMoney(cardCollected + r.total);
    else if (r.settlement === 'bank_transfer') bankTransferCollected = roundMoney(bankTransferCollected + r.total);
  }

  const openingCash = roundMoney(shift.opening_cash || 0);
  const cashExtraIncome = roundMoney(extraCash.total || 0);
  const cashExpenses = roundMoney(expenseCash.total || 0);
  const expectedCash = roundMoney(
    openingCash + cashFolioPayments + cashPosSales + cashExtraIncome - cashExpenses - cashRefunds
  );

  return {
    shiftId: shift.id,
    openedAt: shift.opened_at,
    openingCash,
    cashFolioPayments,
    cashPosSales,
    cashExtraIncome,
    cashExpenses,
    cashRefunds,
    expectedCash,
    cardCollected,
    bankTransferCollected,
    corporateBilled,
    transactionCount,
  };
}

app.get('/api/auth/shift-summary', requireAuth, (req: AuthedRequest, res) => {
  return res.json(computeShiftCashSummary(req.session!.shiftId));
});

app.post('/api/auth/close-shift', requireAuth, (req: AuthedRequest, res) => {
  const session = req.session!;
  const closingCash = parseMoney(req.body.closing_cash ?? 0);
  if (closingCash === null) return res.status(400).json({ error: 'Invalid closing cash amount' });
  const notes = String(req.body.notes ?? '').trim().slice(0, 300);

  const summary = computeShiftCashSummary(session.shiftId);
  const cashVariance = roundMoney(closingCash - summary.expectedCash);

  db.prepare(
    "UPDATE shifts SET closed_at = ?, closing_cash = ?, expected_cash = ?, cash_variance = ?, notes = ?, status = 'closed' WHERE id = ?"
  ).run(new Date().toISOString(), closingCash, summary.expectedCash, cashVariance, notes, session.shiftId);

  deleteStaffSessionByToken(session.token);
  broadcastStateSync('shift:closed');
  return res.json({ ok: true, expectedCash: summary.expectedCash, cashVariance });
});

// ---------------- PROTECTED OPERATIONAL ROUTES ----------------

app.get('/api/bootstrap', requireAuth, (req: AuthedRequest, res) => {
  res.json({
    state: getFullBootstrapState(req.session!.role),
    network: getNetworkInfo(),
  });
});

app.get('/api/system/network', requireAuth, (_req, res) => {
  res.json(getNetworkInfo());
});

// Rooms
app.post('/api/rooms', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const roomNumber = String(req.body.room_number ?? '').trim().slice(0, 20);
  const floor = Number(req.body.floor);
  const roomType = String(req.body.room_type ?? '').trim().slice(0, 60);
  const nightlyRate = parseMoney(req.body.nightly_rate);
  const capacity = parsePositiveInt(req.body.capacity ?? 2) ?? 2;
  const notes = String(req.body.notes ?? '').trim().slice(0, 240);

  if (!roomNumber || !roomType) {
    return res.status(400).json({ error: 'Room number and room type/category are required' });
  }
  if (!Number.isInteger(floor) || floor < 0 || floor > 100) {
    return res.status(400).json({ error: 'Floor must be a valid integer' });
  }
  if (nightlyRate === null || nightlyRate <= 0) {
    return res.status(400).json({ error: 'Positive nightly rate is required' });
  }

  const dup = db.prepare('SELECT id FROM rooms WHERE room_number = ?').get(roomNumber);
  if (dup) {
    return res.status(409).json({ error: `Room ${roomNumber} already exists` });
  }

  db.prepare(
    `INSERT INTO rooms (room_number, floor, room_type, nightly_rate, capacity, housekeeping_status, notes)
     VALUES (?, ?, ?, ?, ?, 'clean', ?)`
  ).run(roomNumber, floor, roomType, nightlyRate, Math.min(capacity, 12), notes);

  broadcastStateSync('room:created');
  return res.status(201).json({ ok: true });
});

app.patch('/api/rooms/bulk-rate', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const roomType = String(req.body.room_type ?? '').trim().slice(0, 60);
  const nightlyRate = parseMoney(req.body.nightly_rate);
  if (!roomType || nightlyRate === null || nightlyRate <= 0) {
    return res.status(400).json({ error: 'Valid room type and nightly rate are required' });
  }

  const info = db.prepare('UPDATE rooms SET nightly_rate = ? WHERE room_type = ?').run(nightlyRate, roomType);
  if (info.changes === 0) return res.status(404).json({ error: 'No rooms found for that category' });

  broadcastStateSync('room:rates_updated');
  return res.json({ updated: info.changes });
});

app.patch('/api/rooms/:id', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const roomId = parsePositiveInt(req.params.id);
  if (!roomId) return res.status(400).json({ error: 'Invalid room ID' });

  const existing = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Room not found' });

  const canManageStructure = isManagementOrAccountant(req.session!.role);

  const allowedStatuses = new Set(['clean', 'dirty', 'inspecting', 'maintenance']);
  const housekeepingStatus =
    typeof req.body.housekeeping_status === 'string' && allowedStatuses.has(req.body.housekeeping_status)
      ? req.body.housekeeping_status
      : String(existing.housekeeping_status);

  const notes = typeof req.body.notes === 'string' ? req.body.notes.trim().slice(0, 240) : String(existing.notes ?? '');

  let roomNumber = String(existing.room_number);
  let floor = Number(existing.floor);
  let roomType = String(existing.room_type);
  let nightlyRate = Number(existing.nightly_rate);
  let capacity = Number(existing.capacity);

  const structuralFieldsSent =
    req.body.room_number !== undefined ||
    req.body.floor !== undefined ||
    req.body.room_type !== undefined ||
    req.body.capacity !== undefined ||
    req.body.nightly_rate !== undefined;

  if (structuralFieldsSent) {
    if (!canManageStructure) {
      return res.status(403).json({ error: 'Only Management or Accountant accounts can edit room setup or pricing' });
    }
    if (typeof req.body.room_number === 'string' && req.body.room_number.trim()) {
      const nextNum = req.body.room_number.trim().slice(0, 20);
      const dup = db.prepare('SELECT id FROM rooms WHERE room_number = ? AND id != ?').get(nextNum, roomId);
      if (dup) return res.status(409).json({ error: `Room ${nextNum} already exists` });
      roomNumber = nextNum;
    }
    if (req.body.floor !== undefined) {
      const nextFloor = Number(req.body.floor);
      if (!Number.isInteger(nextFloor) || nextFloor < 0 || nextFloor > 100) {
        return res.status(400).json({ error: 'Invalid floor number' });
      }
      floor = nextFloor;
    }
    if (typeof req.body.room_type === 'string' && req.body.room_type.trim()) {
      roomType = req.body.room_type.trim().slice(0, 60);
    }
    if (req.body.nightly_rate !== undefined) {
      const parsed = parseMoney(req.body.nightly_rate);
      if (parsed === null || parsed <= 0) return res.status(400).json({ error: 'Invalid nightly rate' });
      nightlyRate = parsed;
    }
    if (req.body.capacity !== undefined) {
      const parsedCap = parsePositiveInt(req.body.capacity);
      if (!parsedCap) return res.status(400).json({ error: 'Invalid room capacity' });
      capacity = Math.min(parsedCap, 12);
    }
  }

  db.prepare(
    `UPDATE rooms
     SET room_number = ?, floor = ?, room_type = ?, nightly_rate = ?, capacity = ?, housekeeping_status = ?, notes = ?
     WHERE id = ?`
  ).run(roomNumber, floor, roomType, nightlyRate, capacity, housekeepingStatus, notes, roomId);

  broadcastStateSync('room:updated');
  return res.json({ ok: true });
});

app.delete('/api/rooms/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const roomId = parsePositiveInt(req.params.id);
  if (!roomId) return res.status(400).json({ error: 'Invalid room ID' });

  const linkedStay = db.prepare('SELECT id FROM stays WHERE room_id = ? LIMIT 1').get(roomId);
  if (linkedStay) {
    return res.status(409).json({
      error: 'Cannot delete a room that has active or historical stay records. Mark it Maintenance instead.',
    });
  }

  const info = db.prepare('DELETE FROM rooms WHERE id = ?').run(roomId);
  if (info.changes === 0) return res.status(404).json({ error: 'Room not found' });

  broadcastStateSync('room:deleted');
  return res.json({ ok: true });
});

// Guests
app.get('/api/guests/paginated', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page ?? 1) ?? 1);
  const pageSize = Math.min(100, Math.max(10, parsePositiveInt(req.query.pageSize ?? 25) ?? 25));
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const from = isValidIsoDate(req.query.from) ? req.query.from : '';
  const to = isValidIsoDate(req.query.to) ? req.query.to : '';

  const whereClauses: string[] = [];
  const params: unknown[] = [];

  if (q) {
    const like = `%${q}%`;
    whereClauses.push(
      `(LOWER(g.full_name) LIKE ? OR LOWER(g.email) LIKE ? OR LOWER(g.phone) LIKE ? OR LOWER(g.company) LIKE ? OR LOWER(g.id_number) LIKE ?)`
    );
    params.push(like, like, like, like, like);
  }

  if (from || to) {
    const subParts: string[] = ["s2.guest_id = g.id", "s2.status != 'cancelled'"];
    if (from) {
      subParts.push('s2.check_out_date >= ?');
      params.push(from);
    }
    if (to) {
      subParts.push('s2.check_in_date <= ?');
      params.push(to);
    }
    whereClauses.push(`EXISTS (SELECT 1 FROM stays s2 WHERE ${subParts.join(' AND ')})`);
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM guests g ${whereSql}`).get(...params) as { count: number }
  ).count;

  const offset = (page - 1) * pageSize;
  const guests = db
    .prepare(
      `SELECT
         g.*,
         (SELECT COUNT(*) FROM stays s WHERE s.guest_id = g.id AND s.status != 'cancelled') AS stay_count,
         COALESCE((
           SELECT SUM(fc.total_amount)
           FROM folio_charges fc
           JOIN stays s ON s.id = fc.stay_id
           WHERE s.guest_id = g.id AND fc.voided = 0
         ), 0) AS lifetime_spend
       FROM guests g
       ${whereSql}
       ORDER BY g.full_name ASC
       LIMIT ? OFFSET ?`
    )
    .all(...params, pageSize, offset);

  return res.json({ guests, total, page, pageSize });
});

app.post('/api/guests', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const fullName = String(req.body.full_name ?? '').trim().slice(0, 120);
  if (!fullName) return res.status(400).json({ error: 'Guest full name is required' });

  const email = String(req.body.email ?? '').trim().slice(0, 160);
  const phone = String(req.body.phone ?? '').trim().slice(0, 48);
  const idNumber = String(req.body.id_number ?? '').trim().slice(0, 64);
  const company = String(req.body.company ?? '').trim().slice(0, 120);
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);

  const info = db
    .prepare(
      'INSERT INTO guests (full_name, email, phone, id_number, company, notes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(fullName, email, phone, idNumber, company, notes, new Date().toISOString());

  const guest = db.prepare('SELECT * FROM guests WHERE id = ?').get(Number(info.lastInsertRowid));
  broadcastStateSync('guest:created');
  return res.status(201).json({ guest });
});

app.patch('/api/guests/:id', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const guestId = parsePositiveInt(req.params.id);
  if (!guestId) return res.status(400).json({ error: 'Invalid guest ID' });

  const existing = db.prepare('SELECT * FROM guests WHERE id = ?').get(guestId);
  if (!existing) return res.status(404).json({ error: 'Guest not found' });

  const fullName = String(req.body.full_name ?? '').trim().slice(0, 120);
  if (!fullName) return res.status(400).json({ error: 'Guest full name is required' });

  const email = String(req.body.email ?? '').trim().slice(0, 160);
  const phone = String(req.body.phone ?? '').trim().slice(0, 48);
  const idNumber = String(req.body.id_number ?? '').trim().slice(0, 64);
  const company = String(req.body.company ?? '').trim().slice(0, 120);
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);

  db.prepare(
    'UPDATE guests SET full_name = ?, email = ?, phone = ?, id_number = ?, company = ?, notes = ? WHERE id = ?'
  ).run(fullName, email, phone, idNumber, company, notes, guestId);

  broadcastStateSync('guest:updated');
  return res.json({ ok: true });
});

// Stays & Reservations
app.post('/api/stays', requireAuth, requireFrontDeskAccess, async (req: AuthedRequest, res) => {
  const settings = getSettings();
  const guestId = parsePositiveInt(req.body.guest_id);
  const rawRoomId = req.body.room_id;
  const roomId = rawRoomId === null || rawRoomId === undefined || rawRoomId === '' ? null : parsePositiveInt(rawRoomId);
  const requestedRoomTypeInput = String(req.body.room_type ?? '').trim().slice(0, 60);
  const checkInDate = req.body.check_in_date;
  const checkOutDate = req.body.check_out_date;
  const adults = parsePositiveInt(req.body.adults ?? 1) ?? 1;
  const immediateCheckIn = Boolean(req.body.immediate_check_in);
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const notes = String(req.body.notes ?? '').trim().slice(0, 500);

  const depositAmount = req.body.deposit_amount !== undefined ? parseMoney(req.body.deposit_amount) : 0;
  const depositMethod = VALID_PAYMENT_METHODS.has(req.body.deposit_method) ? String(req.body.deposit_method) : 'card';
  const depositRef = String(req.body.deposit_reference ?? '').trim().slice(0, 64);

  if (!guestId) return res.status(400).json({ error: 'Valid guest is required' });
  if (!isValidIsoDate(checkInDate) || !isValidIsoDate(checkOutDate) || checkOutDate <= checkInDate) {
    return res.status(400).json({ error: 'Check-out date must be after check-in date' });
  }
  if (depositAmount === null) return res.status(400).json({ error: 'Invalid deposit amount' });

  const guest = db.prepare('SELECT id, full_name FROM guests WHERE id = ?').get(guestId) as
    | { id: number; full_name: string }
    | undefined;
  if (!guest) return res.status(404).json({ error: 'Guest not found' });

  let room:
    | { id: number; room_number: string; room_type: string; nightly_rate: number; housekeeping_status: string }
    | undefined;

  if (immediateCheckIn && !roomId) {
    return res.status(400).json({ error: 'Select a specific room to check a guest in immediately' });
  }

  let resolvedRoomType = requestedRoomTypeInput;
  let defaultRate = 0;

  if (roomId !== null) {
    room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as
      | { id: number; room_number: string; room_type: string; nightly_rate: number; housekeeping_status: string }
      | undefined;
    if (!room) return res.status(404).json({ error: 'Room not found' });
    if (immediateCheckIn && room.housekeeping_status !== 'clean') {
      return res.status(409).json({
        error: `Room ${room.room_number} is marked ${room.housekeeping_status}. Mark it Clean before checking a guest in.`,
      });
    }
    resolvedRoomType = room.room_type;
    defaultRate = room.nightly_rate;

    // Overlap check: strictly allows check-in up until the day before a reserved guest arrives
    // (because check_out_date === nextReservation.check_in_date is NOT an overlap!)
    const conflict = db
      .prepare(
        `SELECT id, confirmation_code, check_in_date, check_out_date FROM stays
         WHERE room_id = ?
           AND status IN ('reserved', 'checked_in')
           AND check_in_date < ?
           AND check_out_date > ?`
      )
      .get(roomId, checkOutDate, checkInDate) as
      | { id: number; confirmation_code: string; check_in_date: string; check_out_date: string }
      | undefined;

    if (conflict) {
      return res.status(409).json({
        error: `Room ${room.room_number} overlaps booking ${conflict.confirmation_code} (${conflict.check_in_date} to ${conflict.check_out_date})`,
      });
    }
  } else {
    if (!resolvedRoomType) {
      return res.status(400).json({ error: 'Select either a specific room or a room type/category' });
    }
    const sampleRoom = db
      .prepare('SELECT nightly_rate FROM rooms WHERE room_type = ? ORDER BY nightly_rate ASC LIMIT 1')
      .get(resolvedRoomType) as { nightly_rate: number } | undefined;
    defaultRate = sampleRoom?.nightly_rate ?? 0;
  }

  const nightlyRate =
    req.body.nightly_rate !== undefined && req.body.nightly_rate !== ''
      ? parseMoney(req.body.nightly_rate)
      : defaultRate;
  if (nightlyRate === null || nightlyRate <= 0) {
    return res.status(400).json({ error: 'Valid positive nightly rate is required' });
  }
  if (!isFinancialControlRole(req.session!.role) && defaultRate > 0 && Math.abs(nightlyRate - defaultRate) > 0.01) {
    return res.status(403).json({
      error: 'Only Management, Accountant, or Auditor accounts can override standard room rates',
    });
  }

  const nowIso = new Date().toISOString();
  const nights = computeNights(checkInDate, checkOutDate);
  const rawRoomTotal = roundMoney(nights * nightlyRate);
  const taxCalc = calculateTransactionTax(rawRoomTotal, 'accommodation', settings);
  const taxLabel = taxCalc.applicable ? taxCalc.taxLabel : '';
  const taxBreakdownJson = JSON.stringify(taxCalc.breakdown);

  const stayId = db.transaction(() => {
    const existingMaxRow = db
      .prepare(
        "SELECT COALESCE(MAX(CAST(substr(confirmation_code, 5) AS INTEGER)), 3000) AS max_num FROM stays WHERE confirmation_code LIKE 'HSL-%'"
      )
      .get() as { max_num: number };
    const nextCodeNum = getNextSequenceValue('stay_confirmation', Math.max(3000, existingMaxRow.max_num || 3000));
    const confirmationCode = `HSL-${nextCodeNum}`;

    const info = db
      .prepare(
        `INSERT INTO stays (
          confirmation_code, guest_id, room_id, requested_room_type, check_in_date, check_out_date,
          actual_check_in, actual_check_out, nightly_rate, adults, status, notes,
          estimated_subtotal, estimated_tax, estimated_total, tax_label, tax_mode, tax_breakdown_json, created_at
        )
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        confirmationCode,
        guestId,
        roomId,
        resolvedRoomType,
        checkInDate,
        checkOutDate,
        immediateCheckIn ? nowIso : null,
        nightlyRate,
        Math.min(adults, 8),
        immediateCheckIn ? 'checked_in' : 'reserved',
        notes,
        taxCalc.netAmount,
        taxCalc.taxAmount,
        taxCalc.totalAmount,
        taxLabel,
        taxCalc.taxMode,
        taxBreakdownJson,
        nowIso
      );
    const createdStayId = Number(info.lastInsertRowid);

    if (immediateCheckIn && room) {
      const chgRes = db.prepare(
        `INSERT INTO folio_charges (
          stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount, tax_label, tax_breakdown_json, posted_by_station, posted_at
        )
         VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        createdStayId,
        `Room ${room.room_number} — ${room.room_type} (${nights} ${nights === 1 ? 'night' : 'nights'})`,
        `RM-${room.room_number}`,
        nights,
        nightlyRate,
        taxCalc.netAmount,
        taxCalc.taxAmount,
        taxCalc.totalAmount,
        taxLabel,
        taxBreakdownJson,
        station,
        nowIso
      );

      recordFolioChargeJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: 'room',
        description: `Room ${room.room_number} — ${room.room_type} (${nights} ${nights === 1 ? 'night' : 'nights'})`,
        referenceCode: confirmationCode,
        netAmount: taxCalc.netAmount,
        taxAmount: taxCalc.taxAmount,
        totalAmount: taxCalc.totalAmount,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    if (depositAmount > 0) {
      const payRef = depositRef || (immediateCheckIn ? 'Check-In Payment' : 'Reservation Deposit');
      const payRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'payment', 'personal', ?)`
      ).run(
        createdStayId,
        depositAmount,
        depositMethod,
        payRef,
        station,
        nowIso,
        req.session!.shiftId
      );

      recordFolioPaymentJournal({
        paymentId: Number(payRes.lastInsertRowid),
        stayStatus: immediateCheckIn ? 'checked_in' : 'reserved',
        amount: depositAmount,
        method: depositMethod,
        reference: payRef,
        confirmationCode,
        guestName: guest.full_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    reconcileStayAllocations(createdStayId);
    return createdStayId;
  })();

  const emailLog = isEmailServiceEnabled()
    ? await dispatchStayEmail(stayId, immediateCheckIn ? 'checkin' : 'reservation')
    : null;
  broadcastStateSync(immediateCheckIn ? 'stay:checked_in' : 'stay:reserved');
  return res.status(201).json({ stay: getStayById(stayId), emailLog });
});

app.patch('/api/stays/:id/assign-room', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  const roomId = parsePositiveInt(req.body.room_id);
  if (!stayId || !roomId) return res.status(400).json({ error: 'Valid reservation and room ID are required' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Reservation not found' });
  if (stay.status !== 'reserved') return res.status(400).json({ error: 'Only reserved stays can be reassigned' });

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId) as
    | { id: number; room_number: string; room_type: string }
    | undefined;
  if (!room) return res.status(404).json({ error: 'Room not found' });

  const conflict = db
    .prepare(
      `SELECT confirmation_code FROM stays
       WHERE room_id = ? AND id != ? AND status IN ('reserved', 'checked_in')
         AND check_in_date < ? AND check_out_date > ?`
    )
    .get(roomId, stayId, stay.check_out_date, stay.check_in_date) as { confirmation_code: string } | undefined;

  if (conflict) {
    return res.status(409).json({
      error: `Room ${room.room_number} overlaps booking ${conflict.confirmation_code}`,
    });
  }

  db.prepare('UPDATE stays SET room_id = ?, requested_room_type = ? WHERE id = ?').run(roomId, room.room_type, stayId);
  broadcastStateSync('stay:room_assigned');
  return res.json({ stay: getStayById(stayId) });
});

app.post('/api/stays/:id/checkin', requireAuth, requireFrontDeskAccess, async (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Reservation not found' });
  if (stay.status !== 'reserved') return res.status(400).json({ error: 'Only reserved stays can be checked in' });

  const requestedRoomId = req.body.room_id !== undefined && req.body.room_id !== '' ? parsePositiveInt(req.body.room_id) : stay.room_id;
  if (!requestedRoomId) {
    return res.status(400).json({ error: 'Assign an available room before checking this guest in' });
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(requestedRoomId) as
    | { id: number; room_number: string; room_type: string; nightly_rate: number; housekeeping_status: string }
    | undefined;
  if (!room) return res.status(404).json({ error: 'Assigned room not found' });
  if (room.housekeeping_status !== 'clean') {
    return res.status(409).json({
      error: `Room ${room.room_number} is marked ${room.housekeeping_status}. Mark it Clean before checking a guest in.`,
    });
  }

  const activeOccupant = db
    .prepare("SELECT confirmation_code FROM stays WHERE room_id = ? AND status = 'checked_in' AND id != ?")
    .get(requestedRoomId, stayId) as { confirmation_code: string } | undefined;
  if (activeOccupant) {
    return res.status(409).json({
      error: `Room ${room.room_number} is currently occupied by ${activeOccupant.confirmation_code}`,
    });
  }

  const dateConflict = db
    .prepare(
      `SELECT confirmation_code FROM stays
       WHERE room_id = ? AND id != ? AND status = 'reserved'
         AND check_in_date < ? AND check_out_date > ?`
    )
    .get(requestedRoomId, stayId, stay.check_out_date, stay.check_in_date) as { confirmation_code: string } | undefined;
  if (dateConflict) {
    return res.status(409).json({
      error: `Room ${room.room_number} overlaps reservation ${dateConflict.confirmation_code}`,
    });
  }

  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const paymentAmount = req.body.payment_amount !== undefined ? parseMoney(req.body.payment_amount) : 0;
  if (paymentAmount === null) return res.status(400).json({ error: 'Invalid check-in payment amount' });
  const paymentMethod = VALID_PAYMENT_METHODS.has(req.body.payment_method) ? String(req.body.payment_method) : 'card';
  const paymentRef = String(req.body.payment_reference ?? '').trim().slice(0, 64);

  const nowIso = new Date().toISOString();
  const nights = computeNights(stay.check_in_date, stay.check_out_date);

  // Preserve the exact pre-calculated subtotal, tax, and total from the reservation
  const settings = getSettings();
  const fallbackCalc = calculateTransactionTax(nights * stay.nightly_rate, 'accommodation', settings);
  const netAmount = stay.estimated_total > 0 ? stay.estimated_subtotal : fallbackCalc.netAmount;
  const taxAmount = stay.estimated_total > 0 ? stay.estimated_tax : fallbackCalc.taxAmount;
  const totalAmount = stay.estimated_total > 0 ? stay.estimated_total : fallbackCalc.totalAmount;
  const taxLabel = stay.tax_label || (fallbackCalc.applicable ? fallbackCalc.taxLabel : '');
  const taxBreakdownJson =
    stay.tax_breakdown_json && stay.tax_breakdown_json !== '[]'
      ? stay.tax_breakdown_json
      : JSON.stringify(fallbackCalc.breakdown);

  db.transaction(() => {
    // Transfer net non-voided advance deposits from Liability (2100) into active Guest Ledger (1100)
    const priorDeposits = roundMoney(
      (
        db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN kind = 'refund' THEN -amount ELSE amount END), 0) AS total
             FROM folio_payments
             WHERE stay_id = ? AND COALESCE(voided, 0) = 0`
          )
          .get(stayId) as { total: number }
      ).total
    );

    if (priorDeposits > 0) {
      recordDepositTransferToGuestLedger({
        stayId,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        depositTotal: priorDeposits,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    db.prepare(
      "UPDATE stays SET room_id = ?, requested_room_type = ?, status = 'checked_in', actual_check_in = ? WHERE id = ?"
    ).run(requestedRoomId, room.room_type, nowIso, stayId);

    const existingRoomCharges = (
      db
        .prepare("SELECT COUNT(*) as count FROM folio_charges WHERE stay_id = ? AND category = 'room' AND voided = 0")
        .get(stayId) as { count: number }
    ).count;

    if (existingRoomCharges === 0) {
      const chgDesc = `Room ${room.room_number} — ${room.room_type} (${nights} ${nights === 1 ? 'night' : 'nights'})`;
      const chgRes = db.prepare(
        `INSERT INTO folio_charges (
          stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount, tax_label, tax_breakdown_json, posted_by_station, posted_at
        )
         VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stayId,
        chgDesc,
        `RM-${room.room_number}`,
        nights,
        stay.nightly_rate,
        netAmount,
        taxAmount,
        totalAmount,
        taxLabel,
        taxBreakdownJson,
        station,
        nowIso
      );

      recordFolioChargeJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: 'room',
        description: chgDesc,
        referenceCode: stay.confirmation_code,
        netAmount,
        taxAmount,
        totalAmount,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    if (paymentAmount > 0) {
      const payRef = paymentRef || 'Check-In Payment';
      const payRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'payment', 'personal', ?)`
      ).run(stayId, paymentAmount, paymentMethod, payRef, station, nowIso, req.session!.shiftId);

      recordFolioPaymentJournal({
        paymentId: Number(payRes.lastInsertRowid),
        stayStatus: 'checked_in',
        amount: paymentAmount,
        method: paymentMethod,
        reference: payRef,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    reconcileStayAllocations(stayId);
  })();

  const emailLog = isEmailServiceEnabled() ? await dispatchStayEmail(stayId, 'checkin') : null;
  broadcastStateSync('stay:checked_in');
  return res.json({ stay: getStayById(stayId), emailLog });
});

// Helper to normalize single or split payment payloads
function parsePaymentLegs(
  body: Record<string, unknown>,
  defaultRef: string
): Array<{ amount: number; method: string; reference: string; billing_split: 'personal' | 'company' }> | null {
  if (Array.isArray(body.payments) && body.payments.length > 0) {
    const legs: Array<{ amount: number; method: string; reference: string; billing_split: 'personal' | 'company' }> = [];
    for (const raw of body.payments) {
      if (!raw || typeof raw !== 'object') return null;
      const item = raw as Record<string, unknown>;
      const amt = parseMoney(item.amount);
      if (amt === null || amt <= 0) return null;
      const method = VALID_PAYMENT_METHODS.has(String(item.method ?? '')) ? String(item.method) : 'card';
      const reference = String(item.reference ?? defaultRef).trim().slice(0, 80) || defaultRef;
      const billing_split = item.billing_split === 'company' ? 'company' : 'personal';
      legs.push({ amount: amt, method, reference, billing_split });
    }
    return legs;
  }
  const singleRaw = body.payment_amount !== undefined ? body.payment_amount : body.amount;
  const amt = singleRaw !== undefined && singleRaw !== '' ? parseMoney(singleRaw) : 0;
  if (amt === null) return null;
  if (amt <= 0) return [];
  const rawMethod = body.payment_method !== undefined ? body.payment_method : body.method;
  const method = VALID_PAYMENT_METHODS.has(String(rawMethod ?? '')) ? String(rawMethod) : 'card';
  const rawRef = body.payment_reference !== undefined ? body.payment_reference : body.reference;
  const reference = String(rawRef ?? '').trim().slice(0, 80) || defaultRef;
  const billing_split = body.billing_split === 'company' ? 'company' : 'personal';
  return [{ amount: amt, method, reference, billing_split }];
}

app.post('/api/stays/:id/checkout', requireAuth, requireFrontDeskAccess, async (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });
  if (stay.status !== 'checked_in') return res.status(400).json({ error: 'Only checked-in stays can be checked out' });

  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const paymentLegs = parsePaymentLegs(req.body, 'Checkout Settlement');
  if (paymentLegs === null) return res.status(400).json({ error: 'Invalid payment breakdown' });

  const refundRaw = req.body.refund as Record<string, unknown> | undefined;
  let refundLeg: { amount: number; method: string; reference: string } | null = null;
  if (refundRaw && typeof refundRaw === 'object' && Number(refundRaw.amount) > 0) {
    if (!isFinancialControlRole(req.session!.role)) {
      return res.status(403).json({
        error: 'Only Management, Accountant, or Auditor accounts can issue guest refunds',
      });
    }
    const rAmt = parseMoney(refundRaw.amount);
    if (rAmt === null || rAmt <= 0) return res.status(400).json({ error: 'Invalid refund amount' });
    const rMethod = VALID_PAYMENT_METHODS.has(String(refundRaw.method ?? '')) ? String(refundRaw.method) : 'cash';
    const rRef = String(refundRaw.reference ?? 'Checkout Overpayment Refund').trim().slice(0, 80);
    refundLeg = { amount: rAmt, method: rMethod, reference: rRef };
  }

  const paymentTotal = roundMoney(paymentLegs.reduce((sum, leg) => sum + leg.amount, 0));
  const projectedBalance = roundMoney(stay.balance_due - paymentTotal + (refundLeg ? refundLeg.amount : 0));
  let deferredSettlement = 0;
  let deferredReason = '';
  let deferredDueDate = '';
  let deferredAuthorizedBy = '';

  if (projectedBalance > 0.01) {
    if (!isManagementOrAccountant(req.session!.role)) {
      return res.status(403).json({
        error: 'Action blocked: only Management or Accountant accounts can authorize an unpaid (Settle Later) check-out',
      });
    }
    if (req.body.allow_deferred_settlement !== true) {
      return res.status(400).json({
        error: `Outstanding balance of ${projectedBalance.toFixed(2)} remains. Collect full payment, waive the bill, or explicitly authorize Settle Later.`,
      });
    }
    deferredReason = String(req.body.deferred_reason ?? '').trim().slice(0, 200);
    if (deferredReason.length < 4) {
      return res.status(400).json({
        error: 'A clear reason or guarantor note (at least 4 characters) is required for Settle Later check-out',
      });
    }
    const rawDue = String(req.body.deferred_due_date ?? '').trim();
    if (rawDue && !isValidIsoDate(rawDue)) {
      return res.status(400).json({ error: 'Invalid expected settlement date' });
    }
    deferredSettlement = 1;
    deferredDueDate = rawDue;
    deferredAuthorizedBy = req.session!.fullName;
  }

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    for (const leg of paymentLegs) {
      const payRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?)`
      ).run(stayId, leg.amount, leg.method, leg.reference, station, nowIso, leg.billing_split, req.session!.shiftId);

      recordFolioPaymentJournal({
        paymentId: Number(payRes.lastInsertRowid),
        stayStatus: 'checked_in',
        amount: leg.amount,
        method: leg.method,
        reference: leg.reference,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    if (refundLeg) {
      const refRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'refund', 'personal', ?)`
      ).run(stayId, refundLeg.amount, refundLeg.method, refundLeg.reference, station, nowIso, req.session!.shiftId);

      recordFolioRefundJournal({
        paymentId: Number(refRes.lastInsertRowid),
        stayStatus: 'checked_in',
        amount: refundLeg.amount,
        method: refundLeg.method,
        reference: refundLeg.reference,
        reason: 'Overpayment refund at checkout',
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    const deferredNote = deferredSettlement
      ? `Settle Later authorized by ${deferredAuthorizedBy}: ${deferredReason}${deferredDueDate ? ` (due ${deferredDueDate})` : ''}`
      : '';
    const updatedNotes = deferredNote
      ? [stay.notes, deferredNote].filter(Boolean).join(' | ')
      : stay.notes;

    db.prepare(
      `UPDATE stays
       SET status = 'checked_out', actual_check_out = ?,
           deferred_settlement = ?, deferred_reason = ?, deferred_due_date = ?, deferred_authorized_by = ?, notes = ?
       WHERE id = ?`
    ).run(nowIso, deferredSettlement, deferredReason, deferredDueDate, deferredAuthorizedBy, updatedNotes, stayId);
    if (stay.room_id) {
      db.prepare("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = ?").run(stay.room_id);
    }
    reconcileStayAllocations(stayId);
  })();

  const emailLog = isEmailServiceEnabled() ? await dispatchStayEmail(stayId, 'checkout') : null;
  broadcastStateSync('stay:checked_out');
  return res.json({ stay: getStayById(stayId), emailLog });
});

// Stay Modifications: Extend Stay (with optional Room Change), Room Move, Early Checkout
app.post('/api/stays/:id/extend', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });
  if (stay.status !== 'checked_in' && stay.status !== 'reserved') {
    return res.status(400).json({ error: 'Only active or reserved stays can be extended' });
  }

  const newCheckOutDate = req.body.new_check_out_date;
  if (!isValidIsoDate(newCheckOutDate) || newCheckOutDate <= stay.check_out_date) {
    return res.status(400).json({ error: `New check-out date must be after ${stay.check_out_date}` });
  }

  const today = getServerLocalIsoDate();
  const requestedNewRoomId =
    req.body.new_room_id !== undefined && req.body.new_room_id !== '' && req.body.new_room_id !== null
      ? parsePositiveInt(req.body.new_room_id)
      : null;
  if (
    req.body.new_room_id !== undefined &&
    req.body.new_room_id !== '' &&
    req.body.new_room_id !== null &&
    !requestedNewRoomId
  ) {
    return res.status(400).json({ error: 'Invalid target room selection' });
  }

  const isChangingRoom = Boolean(requestedNewRoomId && requestedNewRoomId !== stay.room_id);
  let targetRoom: {
    id: number;
    room_number: string;
    room_type: string;
    nightly_rate: number;
    housekeeping_status: string;
  } | null = null;

  if (isChangingRoom && requestedNewRoomId) {
    const found = db.prepare('SELECT * FROM rooms WHERE id = ?').get(requestedNewRoomId) as
      | { id: number; room_number: string; room_type: string; nightly_rate: number; housekeeping_status: string }
      | undefined;
    if (!found) return res.status(404).json({ error: 'Target room not found' });
    if (stay.status === 'checked_in' && found.housekeeping_status !== 'clean') {
      return res.status(409).json({
        error: `Room ${found.room_number} is marked ${found.housekeeping_status}. Mark it Clean before moving a guest in.`,
      });
    }
    if (stay.status === 'checked_in') {
      const activeOccupant = db
        .prepare("SELECT confirmation_code FROM stays WHERE room_id = ? AND status = 'checked_in' AND id != ?")
        .get(requestedNewRoomId, stayId) as { confirmation_code: string } | undefined;
      if (activeOccupant) {
        return res.status(409).json({
          error: `Room ${found.room_number} is currently occupied by ${activeOccupant.confirmation_code}`,
        });
      }
    }
    const checkStart =
      stay.status === 'checked_in'
        ? today > stay.check_in_date
          ? today
          : stay.check_in_date
        : stay.check_in_date;
    const conflict = db
      .prepare(
        `SELECT confirmation_code, check_in_date, check_out_date FROM stays
         WHERE room_id = ? AND id != ? AND status IN ('reserved', 'checked_in')
           AND check_in_date < ? AND check_out_date > ?`
      )
      .get(requestedNewRoomId, stayId, newCheckOutDate, checkStart) as
      | { confirmation_code: string; check_in_date: string; check_out_date: string }
      | undefined;
    if (conflict) {
      return res.status(409).json({
        error: `Room ${found.room_number} overlaps booking ${conflict.confirmation_code} (${conflict.check_in_date} to ${conflict.check_out_date})`,
      });
    }
    targetRoom = found;
  } else if (stay.room_id) {
    const conflict = db
      .prepare(
        `SELECT confirmation_code, check_in_date, check_out_date FROM stays
         WHERE room_id = ? AND id != ? AND status IN ('reserved', 'checked_in')
           AND check_in_date < ? AND check_out_date > ?`
      )
      .get(stay.room_id, stayId, newCheckOutDate, stay.check_out_date) as
      | { confirmation_code: string; check_in_date: string; check_out_date: string }
      | undefined;

    if (conflict) {
      return res.status(409).json({
        error: `Room ${stay.room_number} is booked by ${conflict.confirmation_code} (${conflict.check_in_date} to ${conflict.check_out_date}). Select another room for the extended nights.`,
      });
    }
  }

  const extraNights = computeNights(stay.check_out_date, newCheckOutDate);
  // Standard baseline rate is the target room's catalog rate when moving rooms, or the current stay rate when keeping the same room
  const standardRateForExtension = targetRoom ? targetRoom.nightly_rate : stay.nightly_rate;
  const nightlyRate =
    req.body.nightly_rate !== undefined && req.body.nightly_rate !== ''
      ? parseMoney(req.body.nightly_rate)
      : standardRateForExtension;
  if (nightlyRate === null || nightlyRate <= 0) {
    return res.status(400).json({ error: 'Valid positive nightly rate is required' });
  }
  if (!isFinancialControlRole(req.session!.role) && Math.abs(nightlyRate - standardRateForExtension) > 0.01) {
    return res.status(403).json({
      error: 'Only Management, Accountant, or Auditor accounts can override standard nightly rates on stay extensions',
    });
  }

  const explicitSplit =
    req.body.billing_split === 'company'
      ? 'company'
      : req.body.billing_split === 'personal'
        ? 'personal'
        : null;

  const settings = getSettings();
  const extraRaw = roundMoney(extraNights * nightlyRate);
  const extraTax = calculateTransactionTax(extraRaw, 'accommodation', settings);
  const extraTaxLabel = extraTax.applicable ? extraTax.taxLabel : '';
  const extraTaxBreakdownJson = JSON.stringify(extraTax.breakdown);

  // Add extension estimate onto existing estimated totals rather than multiplying total nights by a single rate
  const updatedEstSubtotal = roundMoney((stay.estimated_subtotal || 0) + extraTax.netAmount);
  const updatedEstTax = roundMoney((stay.estimated_tax || 0) + extraTax.taxAmount);
  const updatedEstTotal = roundMoney((stay.estimated_total || 0) + extraTax.totalAmount);

  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const nowIso = new Date().toISOString();
  const activeRoomNumber = targetRoom ? targetRoom.room_number : stay.room_number;

  db.transaction(() => {
    if (targetRoom) {
      const moveNote = `Extended +${extraNights} ${extraNights === 1 ? 'night' : 'nights'} in Rm ${targetRoom.room_number} (moved from Rm ${stay.room_number})`;
      const updatedNotes = (stay.notes ? `${stay.notes} · ${moveNote}` : moveNote).slice(0, 500);
      db.prepare(
        `UPDATE stays
         SET room_id = ?, requested_room_type = ?, nightly_rate = ?, check_out_date = ?,
             estimated_subtotal = ?, estimated_tax = ?, estimated_total = ?, notes = ?
         WHERE id = ?`
      ).run(
        targetRoom.id,
        targetRoom.room_type,
        nightlyRate,
        newCheckOutDate,
        updatedEstSubtotal,
        updatedEstTax,
        updatedEstTotal,
        updatedNotes,
        stayId
      );
      if (stay.status === 'checked_in' && stay.room_id) {
        db.prepare("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = ?").run(stay.room_id);
      }
    } else {
      db.prepare(
        `UPDATE stays
         SET check_out_date = ?, estimated_subtotal = ?, estimated_tax = ?, estimated_total = ?
         WHERE id = ?`
      ).run(newCheckOutDate, updatedEstSubtotal, updatedEstTax, updatedEstTotal, stayId);
    }

    if (stay.status === 'checked_in') {
      const existingRoomSplit = db
        .prepare(
          "SELECT billing_split FROM folio_charges WHERE stay_id = ? AND category = 'room' AND voided = 0 ORDER BY id ASC LIMIT 1"
        )
        .get(stayId) as { billing_split?: string } | undefined;
      const splitVal = explicitSplit ?? (existingRoomSplit?.billing_split === 'company' ? 'company' : 'personal');

      const desc = targetRoom
        ? `Stay Extension — Moved to Room ${targetRoom.room_number} (${targetRoom.room_type}, +${extraNights} ${extraNights === 1 ? 'night' : 'nights'}, until ${newCheckOutDate})`
        : `Stay Extension — Room ${activeRoomNumber} (+${extraNights} ${extraNights === 1 ? 'night' : 'nights'}, until ${newCheckOutDate})`;
      const chgRes = db
        .prepare(
          `INSERT INTO folio_charges (
            stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
            tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
          )
          VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          stayId,
          desc,
          `EXT-${activeRoomNumber}`,
          extraNights,
          nightlyRate,
          extraTax.netAmount,
          extraTax.taxAmount,
          extraTax.totalAmount,
          extraTaxLabel,
          extraTaxBreakdownJson,
          station,
          nowIso,
          splitVal
        );

      recordFolioChargeJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: 'room',
        description: desc,
        referenceCode: stay.confirmation_code,
        netAmount: extraTax.netAmount,
        taxAmount: extraTax.taxAmount,
        totalAmount: extraTax.totalAmount,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
      reconcileStayAllocations(stayId);
    }
  })();

  broadcastStateSync('stay:extended');
  return res.json({ stay: getStayById(stayId), extraNights, movedRoom: Boolean(targetRoom) });
});

app.post('/api/stays/:id/move-room', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  const newRoomId = parsePositiveInt(req.body.new_room_id);
  if (!stayId || !newRoomId) return res.status(400).json({ error: 'Valid stay and target room are required' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });
  if (stay.status !== 'checked_in') {
    return res.status(400).json({ error: 'Room Move is available for checked-in stays only' });
  }
  if (stay.room_id === newRoomId) {
    return res.status(400).json({ error: 'Guest is already in this room' });
  }

  const newRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(newRoomId) as
    | { id: number; room_number: string; room_type: string; nightly_rate: number; housekeeping_status: string }
    | undefined;
  if (!newRoom) return res.status(404).json({ error: 'Target room not found' });
  if (newRoom.housekeeping_status !== 'clean') {
    return res.status(409).json({
      error: `Room ${newRoom.room_number} is marked ${newRoom.housekeeping_status}. Mark it Clean before moving a guest in.`,
    });
  }

  const activeOccupant = db
    .prepare("SELECT confirmation_code FROM stays WHERE room_id = ? AND status = 'checked_in' AND id != ?")
    .get(newRoomId, stayId) as { confirmation_code: string } | undefined;
  if (activeOccupant) {
    return res.status(409).json({ error: `Room ${newRoom.room_number} is currently occupied by ${activeOccupant.confirmation_code}` });
  }

  const today = getServerLocalIsoDate();
  const effectiveStart = today > stay.check_in_date ? today : stay.check_in_date;
  const conflict = db
    .prepare(
      `SELECT confirmation_code, check_in_date, check_out_date FROM stays
       WHERE room_id = ? AND id != ? AND status = 'reserved'
         AND check_in_date < ? AND check_out_date > ?`
    )
    .get(newRoomId, stayId, stay.check_out_date, effectiveStart) as
    | { confirmation_code: string; check_in_date: string; check_out_date: string }
    | undefined;
  if (conflict) {
    return res.status(409).json({
      error: `Room ${newRoom.room_number} overlaps reservation ${conflict.confirmation_code} (${conflict.check_in_date} to ${conflict.check_out_date})`,
    });
  }

  // On checkout morning (today >= stay.check_out_date), 0 nights remain — never post a phantom charge for last night
  const remainingNights =
    stay.check_out_date > effectiveStart ? computeNights(effectiveStart, stay.check_out_date) : 0;

  const updateRate = Boolean(req.body.update_rate);
  if (remainingNights > 0 && !isFinancialControlRole(req.session!.role)) {
    if (!updateRate && newRoom.nightly_rate > stay.nightly_rate + 0.01) {
      return res.status(403).json({
        error: 'Only Management, Accountant, or Auditor accounts can waive rate increases on room upgrades',
      });
    }
    if (updateRate && newRoom.nightly_rate < stay.nightly_rate - 0.01) {
      return res.status(403).json({
        error: 'Only Management, Accountant, or Auditor accounts can post room rate credit reductions',
      });
    }
  }
  const explicitSplit =
    req.body.billing_split === 'company'
      ? 'company'
      : req.body.billing_split === 'personal'
        ? 'personal'
        : null;
  const reason = String(req.body.reason ?? '').trim().slice(0, 140);
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const nowIso = new Date().toISOString();
  const rateDiffPerNight = updateRate && remainingNights > 0 ? roundMoney(newRoom.nightly_rate - stay.nightly_rate) : 0;
  const totalRateDiff = roundMoney(rateDiffPerNight * remainingNights);
  const settings = getSettings();

  db.transaction(() => {
    const moveNote = `Moved from Rm ${stay.room_number} to Rm ${newRoom.room_number}${reason ? ` (${reason})` : ''}`;
    const updatedNotes = stay.notes ? `${stay.notes} · ${moveNote}` : moveNote;

    db.prepare(
      'UPDATE stays SET room_id = ?, requested_room_type = ?, nightly_rate = ?, notes = ? WHERE id = ?'
    ).run(
      newRoomId,
      newRoom.room_type,
      updateRate && remainingNights > 0 ? newRoom.nightly_rate : stay.nightly_rate,
      updatedNotes.slice(0, 500),
      stayId
    );

    if (stay.room_id) {
      db.prepare("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = ?").run(stay.room_id);
    }

    if (updateRate && remainingNights > 0 && Math.abs(totalRateDiff) >= 0.01) {
      const existingRoomSplit = db
        .prepare(
          "SELECT billing_split FROM folio_charges WHERE stay_id = ? AND category = 'room' AND voided = 0 ORDER BY id ASC LIMIT 1"
        )
        .get(stayId) as { billing_split?: string } | undefined;
      const splitVal = explicitSplit ?? (existingRoomSplit?.billing_split === 'company' ? 'company' : 'personal');

      const absDiff = Math.abs(totalRateDiff);
      const calc = calculateTransactionTax(absDiff, 'accommodation', settings);
      const taxLabel = calc.applicable ? calc.taxLabel : '';
      const taxBreakdownJson = JSON.stringify(calc.breakdown);
      const sign = totalRateDiff > 0 ? 1 : -1;

      db.prepare(
        'UPDATE stays SET estimated_subtotal = ?, estimated_tax = ?, estimated_total = ? WHERE id = ?'
      ).run(
        roundMoney((stay.estimated_subtotal || 0) + sign * calc.netAmount),
        roundMoney((stay.estimated_tax || 0) + sign * calc.taxAmount),
        roundMoney((stay.estimated_total || 0) + sign * calc.totalAmount),
        stayId
      );

      if (totalRateDiff > 0) {
        const desc = `Room Upgrade Adjustment — Rm ${stay.room_number} → Rm ${newRoom.room_number} (${remainingNights} ${remainingNights === 1 ? 'night' : 'nights'})`;
        const chgRes = db
          .prepare(
            `INSERT INTO folio_charges (
              stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
              tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
            )
            VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            stayId,
            desc,
            `MOV-${newRoom.room_number}`,
            remainingNights,
            rateDiffPerNight,
            calc.netAmount,
            calc.taxAmount,
            calc.totalAmount,
            taxLabel,
            taxBreakdownJson,
            station,
            nowIso,
            splitVal
          );
        recordFolioChargeJournal({
          chargeId: Number(chgRes.lastInsertRowid),
          category: 'room',
          description: desc,
          referenceCode: stay.confirmation_code,
          netAmount: calc.netAmount,
          taxAmount: calc.taxAmount,
          totalAmount: calc.totalAmount,
          postedBy: req.session!.fullName,
          stationName: station,
          createdAt: nowIso,
        });
      } else {
        const desc = `Room Rate Credit — Rm ${stay.room_number} → Rm ${newRoom.room_number} (${remainingNights} ${remainingNights === 1 ? 'night' : 'nights'})`;
        const chgRes = db
          .prepare(
            `INSERT INTO folio_charges (
              stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
              tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
            )
            VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            stayId,
            desc,
            `CR-MOV-${newRoom.room_number}`,
            remainingNights,
            rateDiffPerNight,
            -calc.netAmount,
            -calc.taxAmount,
            -calc.totalAmount,
            taxLabel,
            taxBreakdownJson,
            station,
            nowIso,
            splitVal
          );
        recordFolioCreditNoteJournal({
          chargeId: Number(chgRes.lastInsertRowid),
          category: 'room',
          description: desc,
          referenceCode: stay.confirmation_code,
          netAmount: calc.netAmount,
          taxAmount: calc.taxAmount,
          totalAmount: calc.totalAmount,
          postedBy: req.session!.fullName,
          stationName: station,
          createdAt: nowIso,
        });
      }
      reconcileStayAllocations(stayId);
    }
  })();

  broadcastStateSync('stay:room_moved');
  return res.json({ stay: getStayById(stayId), remainingNights });
});

app.post('/api/stays/:id/early-checkout', requireAuth, requireFrontDeskAccess, async (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });
  if (stay.status !== 'checked_in') {
    return res.status(400).json({ error: 'Only checked-in stays can be checked out early' });
  }

  const today = getServerLocalIsoDate();
  const requestedDate = isValidIsoDate(req.body.actual_checkout_date) ? req.body.actual_checkout_date : today;
  const bookedNights = computeNights(stay.check_in_date, stay.check_out_date);
  const elapsedRaw =
    requestedDate <= stay.check_in_date ? 1 : computeNights(stay.check_in_date, requestedDate);
  const actualNights = Math.max(1, Math.min(bookedNights, elapsedRaw));
  const unusedNights = Math.max(0, bookedNights - actualNights);
  const creditUnusedNights = req.body.refund_unused_nights !== false;
  if (creditUnusedNights && unusedNights > 0 && !isFinancialControlRole(req.session!.role)) {
    return res.status(403).json({
      error: 'Only Management, Accountant, or Auditor accounts can issue early-checkout credit adjustments',
    });
  }

  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const paymentLegs = parsePaymentLegs(req.body, 'Early Checkout Settlement');
  if (paymentLegs === null) return res.status(400).json({ error: 'Invalid payment breakdown' });

  const refundRaw = req.body.refund as Record<string, unknown> | undefined;
  let refundLeg: { amount: number; method: string; reference: string } | null = null;
  if (refundRaw && typeof refundRaw === 'object' && Number(refundRaw.amount) > 0) {
    if (!isFinancialControlRole(req.session!.role)) {
      return res.status(403).json({
        error: 'Only Management, Accountant, or Auditor accounts can issue guest refunds',
      });
    }
    const rAmt = parseMoney(refundRaw.amount);
    if (rAmt === null || rAmt <= 0) return res.status(400).json({ error: 'Invalid refund amount' });
    const rMethod = VALID_PAYMENT_METHODS.has(String(refundRaw.method ?? '')) ? String(refundRaw.method) : 'cash';
    const rRef = String(refundRaw.reference ?? 'Early Checkout Refund').trim().slice(0, 80);
    refundLeg = { amount: rAmt, method: rMethod, reference: rRef };
  }

  const settings = getSettings();
  const earlyCreditCalc =
    creditUnusedNights && unusedNights > 0
      ? calculateTransactionTax(roundMoney(unusedNights * stay.nightly_rate), 'accommodation', settings)
      : null;

  const paymentTotal = roundMoney(paymentLegs.reduce((sum, leg) => sum + leg.amount, 0));
  const projectedBalance = roundMoney(
    stay.balance_due - (earlyCreditCalc ? earlyCreditCalc.totalAmount : 0) - paymentTotal + (refundLeg ? refundLeg.amount : 0)
  );

  let deferredSettlement = 0;
  let deferredReason = '';
  let deferredDueDate = '';
  let deferredAuthorizedBy = '';

  if (projectedBalance > 0.01) {
    if (!isManagementOrAccountant(req.session!.role)) {
      return res.status(403).json({
        error: 'Action blocked: only Management or Accountant accounts can authorize an unpaid (Settle Later) check-out',
      });
    }
    if (req.body.allow_deferred_settlement !== true) {
      return res.status(400).json({
        error: `Outstanding balance of ${projectedBalance.toFixed(2)} remains. Collect full payment, waive the bill, or explicitly authorize Settle Later.`,
      });
    }
    deferredReason = String(req.body.deferred_reason ?? '').trim().slice(0, 200);
    if (deferredReason.length < 4) {
      return res.status(400).json({
        error: 'A clear reason or guarantor note (at least 4 characters) is required for Settle Later check-out',
      });
    }
    const rawDue = String(req.body.deferred_due_date ?? '').trim();
    if (rawDue && !isValidIsoDate(rawDue)) {
      return res.status(400).json({ error: 'Invalid expected settlement date' });
    }
    deferredSettlement = 1;
    deferredDueDate = rawDue;
    deferredAuthorizedBy = req.session!.fullName;
  }

  const nowIso = new Date().toISOString();

  // Compute effective new check-out date based on actualNights
  const effectiveOutDateObj = new Date(`${stay.check_in_date}T12:00:00Z`);
  effectiveOutDateObj.setUTCDate(effectiveOutDateObj.getUTCDate() + actualNights);
  const effectiveOutDate = effectiveOutDateObj.toISOString().slice(0, 10);

  db.transaction(() => {
    if (earlyCreditCalc && unusedNights > 0) {
      const calc = earlyCreditCalc;
      const taxLabel = calc.applicable ? calc.taxLabel : '';
      const taxBreakdownJson = JSON.stringify(calc.breakdown);
      const existingRoomSplit = db
        .prepare(
          "SELECT billing_split FROM folio_charges WHERE stay_id = ? AND category = 'room' AND voided = 0 ORDER BY id ASC LIMIT 1"
        )
        .get(stayId) as { billing_split?: string } | undefined;
      const splitVal = existingRoomSplit?.billing_split === 'company' ? 'company' : 'personal';

      const desc = `Early Checkout Credit — ${unusedNights} unused ${unusedNights === 1 ? 'night' : 'nights'} (Room ${stay.room_number})`;
      const chgRes = db
        .prepare(
          `INSERT INTO folio_charges (
            stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
            tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
          )
          VALUES (?, 'room', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          stayId,
          desc,
          `EARLY-CR-${stay.room_number}`,
          unusedNights,
          -stay.nightly_rate,
          -calc.netAmount,
          -calc.taxAmount,
          -calc.totalAmount,
          taxLabel,
          taxBreakdownJson,
          station,
          nowIso,
          splitVal
        );

      recordFolioCreditNoteJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: 'room',
        description: desc,
        referenceCode: stay.confirmation_code,
        netAmount: calc.netAmount,
        taxAmount: calc.taxAmount,
        totalAmount: calc.totalAmount,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    for (const leg of paymentLegs) {
      const payRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?)`
      ).run(stayId, leg.amount, leg.method, leg.reference, station, nowIso, leg.billing_split, req.session!.shiftId);

      recordFolioPaymentJournal({
        paymentId: Number(payRes.lastInsertRowid),
        stayStatus: 'checked_in',
        amount: leg.amount,
        method: leg.method,
        reference: leg.reference,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    if (refundLeg) {
      const refRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'refund', 'personal', ?)`
      ).run(stayId, refundLeg.amount, refundLeg.method, refundLeg.reference, station, nowIso, req.session!.shiftId);

      recordFolioRefundJournal({
        paymentId: Number(refRes.lastInsertRowid),
        stayStatus: 'checked_in',
        amount: refundLeg.amount,
        method: refundLeg.method,
        reference: refundLeg.reference,
        reason: `Early checkout refund (${unusedNights} unused nights)`,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }

    const deferredNote = deferredSettlement
      ? `Settle Later authorized by ${deferredAuthorizedBy}: ${deferredReason}${deferredDueDate ? ` (due ${deferredDueDate})` : ''}`
      : '';
    const updatedNotes = deferredNote
      ? [stay.notes, deferredNote].filter(Boolean).join(' | ')
      : stay.notes;

    db.prepare(
      `UPDATE stays
       SET status = 'checked_out', check_out_date = ?, actual_check_out = ?,
           deferred_settlement = ?, deferred_reason = ?, deferred_due_date = ?, deferred_authorized_by = ?, notes = ?
       WHERE id = ?`
    ).run(effectiveOutDate, nowIso, deferredSettlement, deferredReason, deferredDueDate, deferredAuthorizedBy, updatedNotes, stayId);
    if (stay.room_id) {
      db.prepare("UPDATE rooms SET housekeeping_status = 'dirty' WHERE id = ?").run(stay.room_id);
    }
    reconcileStayAllocations(stayId);
  })();

  const emailLog = isEmailServiceEnabled() ? await dispatchStayEmail(stayId, 'checkout') : null;
  broadcastStateSync('stay:early_checked_out');
  return res.json({ stay: getStayById(stayId), unusedNights, emailLog });
});

app.post('/api/stays/:id/cancel', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Reservation not found' });
  if (stay.status !== 'reserved') return res.status(400).json({ error: 'Only upcoming reservations can be cancelled' });

  db.prepare("UPDATE stays SET status = 'cancelled' WHERE id = ?").run(stayId);
  broadcastStateSync('stay:cancelled');
  return res.json({ ok: true });
});

// Folio Charges, Credit Notes, Split Billing & Payments/Refunds
app.post('/api/stays/:id/charges', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  const allowedCategories = new Set(['room', 'restaurant_pos', 'restaurant_manual', 'service', 'tax_adjustment']);
  const category = allowedCategories.has(req.body.category) ? String(req.body.category) : 'restaurant_manual';
  if (category === 'tax_adjustment' && !isFinancialControlRole(req.session!.role)) {
    return res.status(403).json({
      error: 'Only Management, Accountant, or Auditor accounts can post tax adjustment entries',
    });
  }
  const description = String(req.body.description ?? '').trim().slice(0, 180);
  if (!description) return res.status(400).json({ error: 'Charge description is required' });

  const quantity = parsePositiveInt(req.body.quantity ?? 1);
  const unitPrice = parseMoney(req.body.unit_price);
  if (!quantity || unitPrice === null || unitPrice <= 0) {
    return res.status(400).json({ error: 'Quantity and positive unit price are required' });
  }

  const referenceCode = String(req.body.reference_code ?? '').trim().slice(0, 40);
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const billingSplit = req.body.billing_split === 'company' ? 'company' : 'personal';

  const settings = getSettings();
  const baseAmount = roundMoney(quantity * unitPrice);
  const taxCalc = calculateTransactionTax(baseAmount, domainForChargeCategory(category), settings);
  const taxLabel = taxCalc.applicable ? taxCalc.taxLabel : '';
  const taxBreakdownJson = JSON.stringify(taxCalc.breakdown);

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    const chgRes = db.prepare(
      `INSERT INTO folio_charges (
        stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
        tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      stayId,
      category,
      description,
      referenceCode,
      quantity,
      unitPrice,
      taxCalc.netAmount,
      taxCalc.taxAmount,
      taxCalc.totalAmount,
      taxLabel,
      taxBreakdownJson,
      station,
      nowIso,
      billingSplit
    );

    recordFolioChargeJournal({
      chargeId: Number(chgRes.lastInsertRowid),
      category,
      description,
      referenceCode: referenceCode || stay.confirmation_code,
      netAmount: taxCalc.netAmount,
      taxAmount: taxCalc.taxAmount,
      totalAmount: taxCalc.totalAmount,
      postedBy: req.session!.fullName,
      stationName: station,
      createdAt: nowIso,
    });

    reconcileStayAllocations(stayId);
  })();

  broadcastStateSync('folio:charge_added');
  return res.status(201).json({ stay: getStayById(stayId) });
});

app.post('/api/stays/:id/credit-notes', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  const allowedCategories = new Set(['room', 'restaurant_pos', 'restaurant_manual', 'service']);
  const category = allowedCategories.has(req.body.category) ? String(req.body.category) : 'room';
  const description = String(req.body.description ?? '').trim().slice(0, 180);
  if (!description) return res.status(400).json({ error: 'Credit note reason/description is required' });

  const amount = parseMoney(req.body.amount);
  if (amount === null || amount <= 0) {
    return res.status(400).json({ error: 'Positive credit note amount is required' });
  }

  const applyTax = req.body.apply_tax !== false;
  const referenceCode = String(req.body.reference_code ?? '').trim().slice(0, 40) || `CN-${stay.confirmation_code}`;
  const billingSplit = req.body.billing_split === 'company' ? 'company' : 'personal';
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);

  const settings = getSettings();
  const calc = applyTax
    ? calculateTransactionTax(amount, domainForChargeCategory(category), settings)
    : { netAmount: amount, taxAmount: 0, totalAmount: amount, applicable: false, taxLabel: '', breakdown: [] };
  const taxLabel = calc.applicable ? calc.taxLabel : '';
  const taxBreakdownJson = JSON.stringify(calc.breakdown);
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    const chgRes = db.prepare(
      `INSERT INTO folio_charges (
        stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
        tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
      )
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      stayId,
      category,
      `Credit Note — ${description}`,
      referenceCode,
      -amount,
      -calc.netAmount,
      -calc.taxAmount,
      -calc.totalAmount,
      taxLabel,
      taxBreakdownJson,
      station,
      nowIso,
      billingSplit
    );

    recordFolioCreditNoteJournal({
      chargeId: Number(chgRes.lastInsertRowid),
      category,
      description,
      referenceCode,
      netAmount: calc.netAmount,
      taxAmount: calc.taxAmount,
      totalAmount: calc.totalAmount,
      postedBy: req.session!.fullName,
      stationName: station,
      createdAt: nowIso,
    });
    reconcileStayAllocations(stayId);
  })();

  broadcastStateSync('folio:credit_note_added');
  return res.status(201).json({ stay: getStayById(stayId) });
});

// Complimentary Bill Waiver (Accommodation, Food & Beverage, Ancillary Services, or Full Bill)
// Strictly restricted to Management and Accountant accounts — posts Contra-Revenue + proportional VAT/Tax reversal.
app.post('/api/stays/:id/waive', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  const waiveRoom = Boolean(req.body.waive_room);
  const waiveFood = Boolean(req.body.waive_food);
  const waiveServices = Boolean(req.body.waive_services);

  if (!waiveRoom && !waiveFood && !waiveServices) {
    return res.status(400).json({ error: 'Select at least one bill section to waive (Accommodation, Food, or Services)' });
  }

  const reason = String(req.body.reason ?? '').trim().slice(0, 180);
  if (reason.length < 4) {
    return res.status(400).json({ error: 'A waiver reason (at least 4 characters) is required for the audit trail' });
  }

  const refPrefix = String(req.body.reference_code ?? '').trim().slice(0, 36) || `COMP-${stay.confirmation_code}`;
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);

  const activeCharges = db
    .prepare('SELECT * FROM folio_charges WHERE stay_id = ? AND voided = 0 ORDER BY id ASC')
    .all(stayId) as Array<{
      id: number;
      category: string;
      amount: number;
      tax_amount: number;
      total_amount: number;
      tax_label: string;
      tax_breakdown_json?: string;
      billing_split?: string;
    }>;

  type WaiverBucketSpec = {
    key: 'room' | 'food' | 'services';
    label: string;
    chargeCategory: 'room' | 'restaurant_manual' | 'service';
    matches: (cat: string) => boolean;
    selected: boolean;
  };

  const buckets: WaiverBucketSpec[] = [
    { key: 'room', label: 'Accommodation', chargeCategory: 'room', matches: (c) => c === 'room', selected: waiveRoom },
    {
      key: 'food',
      label: 'Food & Beverage',
      chargeCategory: 'restaurant_manual',
      matches: (c) => c === 'restaurant_pos' || c === 'restaurant_manual',
      selected: waiveFood,
    },
    { key: 'services', label: 'Ancillary Services', chargeCategory: 'service', matches: (c) => c === 'service', selected: waiveServices },
  ];

  interface ComputedWaiverLine {
    label: string;
    chargeCategory: 'room' | 'restaurant_manual' | 'service';
    netAmount: number;
    taxAmount: number;
    totalAmount: number;
    taxLabel: string;
    taxBreakdownJson: string;
    billingSplit: 'personal' | 'company';
  }

  const linesToPost: ComputedWaiverLine[] = [];

  for (const bucket of buckets) {
    if (!bucket.selected) continue;
    const rows = activeCharges.filter((c) => bucket.matches(c.category));
    const netSum = roundMoney(rows.reduce((s, r) => s + Number(r.amount || 0), 0));
    const taxSum = roundMoney(rows.reduce((s, r) => s + Number(r.tax_amount || 0), 0));
    const totalSum = roundMoney(
      rows.reduce((s, r) => s + Number(r.total_amount || r.amount + r.tax_amount), 0)
    );
    if (totalSum <= 0.005) continue;

    // Aggregate per-rule tax breakdown so Tax Register reverses each tax rule accurately
    const ruleMap = new Map<string, { name: string; rate: number; mode: string; amount: number }>();
    let firstTaxLabel = '';
    for (const r of rows) {
      if (!firstTaxLabel && r.tax_label) firstTaxLabel = r.tax_label;
      if (r.tax_breakdown_json) {
        try {
          const parsed = JSON.parse(r.tax_breakdown_json) as Array<{
            name: string;
            rate: number;
            mode: string;
            amount: number;
          }>;
          if (Array.isArray(parsed)) {
            const sign = (r.tax_amount || 0) < 0 ? -1 : 1;
            for (const item of parsed) {
              const key = `${item.name}|${item.rate}|${item.mode}`;
              const prev = ruleMap.get(key) ?? { name: item.name, rate: item.rate, mode: item.mode, amount: 0 };
              prev.amount = roundMoney(prev.amount + sign * Math.abs(Number(item.amount || 0)));
              ruleMap.set(key, prev);
            }
          }
        } catch {
          // ignore malformed breakdown JSON
        }
      }
    }
    const breakdown = Array.from(ruleMap.values()).filter((b) => b.amount > 0.005);
    const hasCompany = rows.some((r) => r.billing_split === 'company');

    linesToPost.push({
      label: bucket.label,
      chargeCategory: bucket.chargeCategory,
      netAmount: Math.max(0, netSum),
      taxAmount: Math.max(0, taxSum),
      totalAmount: totalSum,
      taxLabel: taxSum > 0 ? firstTaxLabel || 'Tax' : '',
      taxBreakdownJson: JSON.stringify(breakdown),
      billingSplit: hasCompany ? 'company' : 'personal',
    });
  }

  if (linesToPost.length === 0) {
    return res.status(400).json({ error: 'Selected bill sections have no remaining balance to waive' });
  }

  const nowIso = new Date().toISOString();
  let totalWaived = 0;

  db.transaction(() => {
    for (const line of linesToPost) {
      const desc = `Complimentary Waiver (${line.label}) — ${reason}`;
      const chgRes = db
        .prepare(
          `INSERT INTO folio_charges (
            stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount,
            tax_label, tax_breakdown_json, posted_by_station, posted_at, billing_split
          )
          VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          stayId,
          line.chargeCategory,
          desc,
          refPrefix,
          -line.totalAmount,
          -line.netAmount,
          -line.taxAmount,
          -line.totalAmount,
          line.taxLabel,
          line.taxBreakdownJson,
          station,
          nowIso,
          line.billingSplit
        );

      recordFolioCreditNoteJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: line.chargeCategory,
        description: desc,
        referenceCode: refPrefix,
        netAmount: line.netAmount,
        taxAmount: line.taxAmount,
        totalAmount: line.totalAmount,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });

      totalWaived = roundMoney(totalWaived + line.totalAmount);
    }

    const waiverSummaryNote = `Bill Waiver (${linesToPost.map((l) => l.label).join(' + ')}) by ${req.session!.fullName}: ${reason}`;
    const updatedNotes = [stay.notes, waiverSummaryNote].filter(Boolean).join(' | ');
    db.prepare('UPDATE stays SET notes = ? WHERE id = ?').run(updatedNotes, stayId);

    reconcileStayAllocations(stayId);
  })();

  broadcastStateSync('folio:bill_waived');
  return res.status(201).json({
    stay: getStayById(stayId),
    waivedSections: linesToPost.map((l) => l.label),
    totalWaived,
  });
});

app.patch('/api/charges/:chargeId/split', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const chargeId = parsePositiveInt(req.params.chargeId);
  if (!chargeId) return res.status(400).json({ error: 'Invalid charge ID' });
  const split = req.body.billing_split === 'company' ? 'company' : 'personal';
  const info = db.prepare('UPDATE folio_charges SET billing_split = ? WHERE id = ?').run(split, chargeId);
  if (info.changes === 0) return res.status(404).json({ error: 'Charge not found' });
  broadcastStateSync('folio:split_updated');
  return res.json({ ok: true, billing_split: split });
});

app.post('/api/stays/:id/auto-split-folio', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });
  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  db.transaction(() => {
    db.prepare("UPDATE folio_charges SET billing_split = 'company' WHERE stay_id = ? AND category = 'room' AND voided = 0").run(stayId);
    db.prepare("UPDATE folio_charges SET billing_split = 'personal' WHERE stay_id = ? AND category != 'room' AND voided = 0").run(stayId);
  })();

  broadcastStateSync('folio:auto_split');
  return res.json({ stay: getStayById(stayId) });
});

app.delete('/api/charges/:chargeId', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const chargeId = parsePositiveInt(req.params.chargeId);
  if (!chargeId) return res.status(400).json({ error: 'Invalid charge ID' });

  const validation = validateVoidPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { reason } = validation;

  const existing = db
    .prepare(
      `SELECT fc.*, s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_charges fc
       JOIN stays s ON s.id = fc.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE fc.id = ?`
    )
    .get(chargeId) as
    | {
        id: number;
        stay_id: number;
        category: string;
        description: string;
        reference_code: string;
        amount: number;
        tax_amount: number;
        total_amount: number;
        voided: number;
        confirmation_code: string;
        guest_name: string;
        room_number: string;
      }
    | undefined;

  if (!existing) return res.status(404).json({ error: 'Charge not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Charge has already been voided' });

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      'UPDATE folio_charges SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ? WHERE id = ?'
    ).run(reason, req.session!.fullName, req.session!.role, nowIso, chargeId);

    if (existing.category === 'restaurant_pos' && existing.reference_code) {
      db.prepare(
        `UPDATE pos_orders
         SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ?, status = 'closed'
         WHERE stay_id = ? AND order_number = ? AND COALESCE(voided, 0) = 0`
      ).run(reason, req.session!.fullName, req.session!.role, nowIso, existing.stay_id, existing.reference_code);
    }

    const voidJournalId = recordFolioChargeVoidJournal({
      chargeId,
      category: existing.category,
      description: existing.description,
      referenceCode: existing.reference_code || existing.confirmation_code,
      netAmount: existing.amount,
      taxAmount: existing.tax_amount,
      totalAmount: existing.total_amount,
      reason,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
    });

    recordVoidAuditLog({
      entityType: 'folio_charge',
      entityId: chargeId,
      referenceCode: existing.reference_code || existing.confirmation_code,
      description: existing.description,
      partyName: `${existing.guest_name} (Rm ${existing.room_number})`,
      department:
        existing.category === 'restaurant_pos' || existing.category === 'restaurant_manual'
          ? 'Restaurant'
          : 'Front Desk',
      originalAmount: existing.amount,
      taxAmount: existing.tax_amount,
      totalAmount: existing.total_amount,
      voidReason: reason,
      voidedBy: req.session!.fullName,
      voidedByRole: req.session!.role,
      stationName: req.session!.stationName,
      voidJournalId,
      createdAt: nowIso,
    });

    reconcileStayAllocations(existing.stay_id);
  })();

  broadcastStateSync('folio:charge_voided');
  return res.json({ ok: true });
});

app.post('/api/payments/:paymentId/void', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const paymentId = parsePositiveInt(req.params.paymentId);
  if (!paymentId) return res.status(400).json({ error: 'Invalid payment ID' });

  const validation = validateVoidPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { reason } = validation;

  const existing = db
    .prepare(
      `SELECT fp.*, s.status AS stay_status, s.confirmation_code, g.full_name AS guest_name, COALESCE(r.room_number, 'Unassigned') AS room_number
       FROM folio_payments fp
       JOIN stays s ON s.id = fp.stay_id
       JOIN guests g ON g.id = s.guest_id
       LEFT JOIN rooms r ON r.id = s.room_id
       WHERE fp.id = ?`
    )
    .get(paymentId) as
    | {
        id: number;
        stay_id: number;
        amount: number;
        method: string;
        reference: string;
        kind?: string;
        voided?: number;
        stay_status: string;
        confirmation_code: string;
        guest_name: string;
        room_number: string;
      }
    | undefined;

  if (!existing) return res.status(404).json({ error: 'Payment record not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Payment has already been voided' });

  const kind: 'payment' | 'refund' = existing.kind === 'refund' ? 'refund' : 'payment';
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      'UPDATE folio_payments SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ? WHERE id = ?'
    ).run(reason, req.session!.fullName, req.session!.role, nowIso, paymentId);

    const voidJournalId = recordFolioPaymentVoidJournal({
      paymentId,
      stayStatus: existing.stay_status,
      kind,
      amount: existing.amount,
      method: existing.method,
      reference: existing.reference,
      confirmationCode: existing.confirmation_code,
      guestName: existing.guest_name,
      reason,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
    });

    recordVoidAuditLog({
      entityType: 'folio_payment',
      entityId: paymentId,
      referenceCode: existing.reference || existing.confirmation_code,
      description: `${kind === 'refund' ? 'Guest Refund' : 'Folio Payment'} (${existing.method.replace('_', ' ')})`,
      partyName: `${existing.guest_name} (Rm ${existing.room_number})`,
      department: 'Front Desk',
      originalAmount: existing.amount,
      taxAmount: 0,
      totalAmount: existing.amount,
      voidReason: reason,
      voidedBy: req.session!.fullName,
      voidedByRole: req.session!.role,
      stationName: req.session!.stationName,
      voidJournalId,
      createdAt: nowIso,
    });

    reconcileStayAllocations(existing.stay_id);
  })();

  broadcastStateSync('folio:payment_voided');
  return res.json({ ok: true });
});

app.post('/api/stays/:id/payments', requireAuth, requireFrontDeskAccess, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  const paymentLegs = parsePaymentLegs(req.body, '');
  if (paymentLegs === null || paymentLegs.length === 0) {
    return res.status(400).json({ error: 'Positive payment amount is required' });
  }

  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    for (const leg of paymentLegs) {
      const payRes = db.prepare(
        `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
         VALUES (?, ?, ?, ?, ?, ?, 'payment', ?, ?)`
      ).run(stayId, leg.amount, leg.method, leg.reference, station, nowIso, leg.billing_split, req.session!.shiftId);

      recordFolioPaymentJournal({
        paymentId: Number(payRes.lastInsertRowid),
        stayStatus: stay.status,
        amount: leg.amount,
        method: leg.method,
        reference: leg.reference,
        confirmationCode: stay.confirmation_code,
        guestName: stay.guest_name,
        postedBy: req.session!.fullName,
        stationName: station,
        createdAt: nowIso,
      });
    }
    reconcileStayAllocations(stayId);
  })();

  broadcastStateSync('folio:payment_added');
  return res.status(201).json({ stay: getStayById(stayId) });
});

app.post('/api/stays/:id/refunds', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const stay = getStayById(stayId);
  if (!stay) return res.status(404).json({ error: 'Stay not found' });

  const amount = parseMoney(req.body.amount);
  if (amount === null || amount <= 0) {
    return res.status(400).json({ error: 'Positive refund amount is required' });
  }
  if (amount > Math.max(0, stay.total_paid) + 0.01) {
    return res.status(400).json({
      error: `Refund cannot exceed net amount paid on this folio (${stay.total_paid.toFixed(2)})`,
    });
  }

  const method = VALID_PAYMENT_METHODS.has(req.body.method) ? String(req.body.method) : 'cash';
  const reference = String(req.body.reference ?? '').trim().slice(0, 80) || `REF-${stay.confirmation_code}`;
  const reason = String(req.body.reason ?? 'Guest refund').trim().slice(0, 140) || 'Guest refund';
  const billingSplit = req.body.billing_split === 'company' ? 'company' : 'personal';
  const station = String(req.body.station ?? req.session!.fullName).trim().slice(0, 48);
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    const payRes = db.prepare(
      `INSERT INTO folio_payments (stay_id, amount, method, reference, recorded_by_station, recorded_at, kind, billing_split, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, 'refund', ?, ?)`
    ).run(stayId, amount, method, `${reference}${reason ? ` · ${reason}` : ''}`.slice(0, 80), station, nowIso, billingSplit, req.session!.shiftId);

    recordFolioRefundJournal({
      paymentId: Number(payRes.lastInsertRowid),
      stayStatus: stay.status,
      amount,
      method,
      reference,
      reason,
      confirmationCode: stay.confirmation_code,
      guestName: stay.guest_name,
      postedBy: req.session!.fullName,
      stationName: station,
      createdAt: nowIso,
    });
    reconcileStayAllocations(stayId);
  })();

  broadcastStateSync('folio:refund_issued');
  return res.status(201).json({ stay: getStayById(stayId) });
});

app.post('/api/stays/:id/send-email', requireAuth, requireFrontDeskAccess, async (req: AuthedRequest, res) => {
  if (!isEmailServiceEnabled()) {
    return res.status(400).json({ error: 'Email service is turned off. Enable it in Settings → Email Config.' });
  }

  const stayId = parsePositiveInt(req.params.id);
  if (!stayId) return res.status(400).json({ error: 'Invalid stay ID' });

  const allowedTypes = new Set(['reservation', 'checkin', 'checkout', 'manual']);
  const eventType = allowedTypes.has(req.body.event_type)
    ? (req.body.event_type as 'reservation' | 'checkin' | 'checkout' | 'manual')
    : 'manual';

  const log = await dispatchStayEmail(stayId, eventType, true);
  if (!log) {
    return res.status(400).json({ error: 'Guest has no valid email address on file' });
  }

  broadcastStateSync('email:logged');
  return res.json({ log });
});

// Restaurant Menu & POS
app.post('/api/menu', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 100);
  const rawCategory = String(req.body.category ?? '').trim().slice(0, 64);
  const price = parseMoney(req.body.price);
  const description = String(req.body.description ?? '').trim().slice(0, 180);

  if (!name || price === null || price <= 0) {
    return res.status(400).json({ error: 'Menu item name and valid price are required' });
  }
  const dbMenuCats = getAppCategories('menu');
  const category = rawCategory || dbMenuCats[0]?.name || 'General';
  upsertAppCategory('menu', category);

  db.prepare('INSERT INTO menu_items (name, category, price, available, description) VALUES (?, ?, ?, 1, ?)').run(
    name,
    category,
    price,
    description
  );
  broadcastStateSync('menu:updated');
  return res.status(201).json({ ok: true });
});

app.patch('/api/menu/:id', requireAuth, (req: AuthedRequest, res) => {
  const itemId = parsePositiveInt(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'Invalid menu item ID' });

  const existing = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(itemId) as Record<string, unknown> | undefined;
  if (!existing) return res.status(404).json({ error: 'Menu item not found' });

  const editingCatalogFields =
    req.body.name !== undefined ||
    req.body.category !== undefined ||
    req.body.price !== undefined ||
    req.body.description !== undefined;

  if (editingCatalogFields && !isManagementOrAccountant(req.session!.role)) {
    return res.status(403).json({ error: 'Only Management or Accountant accounts can edit menu pricing and items' });
  }

  const name = req.body.name !== undefined ? String(req.body.name).trim().slice(0, 100) : String(existing.name);
  const rawCategory =
    req.body.category !== undefined ? String(req.body.category).trim().slice(0, 64) : String(existing.category);
  const category = rawCategory || String(existing.category);
  if (rawCategory) upsertAppCategory('menu', category);
  const price = req.body.price !== undefined ? parseMoney(req.body.price) : Number(existing.price);
  const available = req.body.available !== undefined ? (req.body.available ? 1 : 0) : Number(existing.available);
  const description =
    req.body.description !== undefined ? String(req.body.description).trim().slice(0, 180) : String(existing.description);

  if (!name || price === null || price <= 0) return res.status(400).json({ error: 'Invalid item fields' });

  db.prepare('UPDATE menu_items SET name = ?, category = ?, price = ?, available = ?, description = ? WHERE id = ?').run(
    name,
    category,
    price,
    available,
    description,
    itemId
  );
  broadcastStateSync('menu:updated');
  return res.json({ ok: true });
});

app.delete('/api/menu/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const itemId = parsePositiveInt(req.params.id);
  if (!itemId) return res.status(400).json({ error: 'Invalid menu item ID' });

  const info = db.prepare('DELETE FROM menu_items WHERE id = ?').run(itemId);
  if (info.changes === 0) return res.status(404).json({ error: 'Menu item not found' });

  broadcastStateSync('menu:deleted');
  return res.json({ ok: true });
});

app.get('/api/pos/orders', requireAuth, (req: AuthedRequest, res) => {
  const page = Math.max(1, parsePositiveInt(req.query.page ?? 1) ?? 1);
  const pageSize = Math.min(100, Math.max(10, parsePositiveInt(req.query.pageSize ?? 25) ?? 25));
  const filter = String(req.query.filter ?? 'all');
  const q = String(req.query.q ?? '').trim().toLowerCase();
  const from = isValidIsoDate(req.query.from) ? req.query.from : '';
  const to = isValidIsoDate(req.query.to) ? req.query.to : '';

  const whereParts: string[] = [];
  const params: unknown[] = [];

  if (from) {
    whereParts.push('substr(created_at, 1, 10) >= ?');
    params.push(from);
  }
  if (to) {
    whereParts.push('substr(created_at, 1, 10) <= ?');
    params.push(to);
  }
  if (filter === 'unpaid') {
    whereParts.push("payment_status = 'unpaid' AND COALESCE(voided, 0) = 0");
  } else if (filter === 'paid') {
    whereParts.push("payment_status != 'unpaid' AND COALESCE(voided, 0) = 0");
  } else if (filter === 'room_service') {
    whereParts.push("dining_type = 'room_service' AND COALESCE(voided, 0) = 0");
  } else if (filter === 'dine_in') {
    whereParts.push("dining_type = 'dine_in' AND COALESCE(voided, 0) = 0");
  } else if (filter === 'voided') {
    whereParts.push('COALESCE(voided, 0) = 1');
  }
  if (q) {
    const like = `%${q}%`;
    whereParts.push(
      '(LOWER(order_number) LIKE ? OR LOWER(guest_name) LIKE ? OR LOWER(room_number) LIKE ? OR LOWER(table_number) LIKE ?)'
    );
    params.push(like, like, like, like);
  }

  const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(' AND ')}` : '';
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM pos_orders ${whereSql}`).get(...params) as { count: number }
  ).count;

  const statsDateParts: string[] = [];
  const statsDateParams: unknown[] = [];
  if (from) {
    statsDateParts.push('substr(created_at, 1, 10) >= ?');
    statsDateParams.push(from);
  }
  if (to) {
    statsDateParts.push('substr(created_at, 1, 10) <= ?');
    statsDateParams.push(to);
  }
  const statsWhere = statsDateParts.length > 0 ? `WHERE ${statsDateParts.join(' AND ')}` : '';
  const summaryRow = db
    .prepare(
      `SELECT
         SUM(CASE WHEN payment_status = 'unpaid' AND COALESCE(voided, 0) = 0 THEN 1 ELSE 0 END) AS unpaid_count,
         COALESCE(SUM(CASE WHEN payment_status = 'unpaid' AND COALESCE(voided, 0) = 0 THEN total_amount ELSE 0 END), 0) AS unpaid_total,
         SUM(CASE WHEN payment_status != 'unpaid' AND COALESCE(voided, 0) = 0 THEN 1 ELSE 0 END) AS paid_count,
         SUM(CASE WHEN COALESCE(voided, 0) = 1 THEN 1 ELSE 0 END) AS voided_count
       FROM pos_orders ${statsWhere}`
    )
    .get(...statsDateParams) as {
    unpaid_count: number | null;
    unpaid_total: number;
    paid_count: number | null;
    voided_count: number | null;
  };

  const offset = (page - 1) * pageSize;
  const orders = db
    .prepare(`SELECT * FROM pos_orders ${whereSql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...params, pageSize, offset);

  return res.json({
    orders,
    total,
    page,
    pageSize,
    unpaidCount: summaryRow.unpaid_count ?? 0,
    unpaidTotal: roundMoney(summaryRow.unpaid_total ?? 0),
    paidCount: summaryRow.paid_count ?? 0,
    voidedCount: summaryRow.voided_count ?? 0,
  });
});

app.post('/api/pos/orders', requireAuth, (req: AuthedRequest, res) => {
  const settings = getSettings();
  if (!settings.pos_enabled) {
    return res.status(400).json({
      error: 'Restaurant POS is disabled. Post restaurant charges manually in Guest Folio or enable POS in Settings.',
    });
  }

  const rawItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (rawItems.length === 0) return res.status(400).json({ error: 'Add at least one menu item to the order' });

  const normalizedItems: Array<{ name: string; qty: number; price: number }> = [];
  for (const raw of rawItems) {
    const qty = parsePositiveInt(raw?.qty);
    const price = parseMoney(raw?.price);
    const name = String(raw?.name ?? '').trim().slice(0, 100);
    if (!qty || price === null || !name) {
      return res.status(400).json({ error: 'Invalid order line item' });
    }
    normalizedItems.push({ name, qty, price });
  }

  const diningType = ['dine_in', 'room_service', 'takeaway'].includes(req.body.dining_type)
    ? (req.body.dining_type as 'dine_in' | 'room_service' | 'takeaway')
    : 'dine_in';

  const tableNumber = String(req.body.table_number ?? '').trim().slice(0, 24);
  const notes = String(req.body.notes ?? '').trim().slice(0, 240);
  const stationName = String(req.body.station ?? 'Restaurant').trim().slice(0, 48);
  const paymentReference = String(req.body.payment_reference ?? '').trim().slice(0, 80);

  let settlement: 'folio' | 'cash' | 'card' | 'bank_transfer' | 'unpaid';
  let paymentStatus: 'paid' | 'unpaid';
  let stayId: number | null = null;
  let roomNumber = '';
  let guestName = String(req.body.guest_name ?? '').trim().slice(0, 100) || 'Dine-In Guest';

  if (diningType === 'room_service') {
    const requestedStayId = parsePositiveInt(req.body.stay_id);
    if (!requestedStayId) {
      return res.status(400).json({ error: 'Select a checked-in room before placing a Room Service order' });
    }
    const stay = getStayById(requestedStayId);
    if (!stay || stay.status !== 'checked_in') {
      return res.status(400).json({ error: 'Selected room does not have an active checked-in guest' });
    }
    stayId = stay.id;
    roomNumber = stay.room_number;
    guestName = stay.guest_name;
    settlement = 'folio';
    paymentStatus = 'paid';
  } else {
    const requestedPayStatus = req.body.payment_status === 'unpaid' ? 'unpaid' : 'paid';
    if (requestedPayStatus === 'unpaid') {
      settlement = 'unpaid';
      paymentStatus = 'unpaid';
    } else {
      const allowedPaidSettlements = new Set(['folio', 'cash', 'card', 'bank_transfer']);
      settlement = allowedPaidSettlements.has(req.body.settlement)
        ? (req.body.settlement as 'folio' | 'cash' | 'card' | 'bank_transfer')
        : 'card';
      paymentStatus = 'paid';
      if (settlement === 'folio') {
        const requestedStayId = parsePositiveInt(req.body.stay_id);
        if (!requestedStayId) {
          return res.status(400).json({ error: 'Select a checked-in guest room to post to folio' });
        }
        const stay = getStayById(requestedStayId);
        if (!stay || stay.status !== 'checked_in') {
          return res.status(400).json({ error: 'Selected guest stay is not currently checked in' });
        }
        stayId = stay.id;
        roomNumber = stay.room_number;
        guestName = stay.guest_name;
      }
    }
  }

  const rawSubtotal = roundMoney(normalizedItems.reduce((sum, item) => sum + item.qty * item.price, 0));
  const taxCalc = calculateTransactionTax(rawSubtotal, 'restaurant', settings);
  const taxLabel = taxCalc.applicable ? taxCalc.taxLabel : '';
  const taxBreakdownJson = JSON.stringify(taxCalc.breakdown);

  const nowIso = new Date().toISOString();
  const initialStatus = paymentStatus === 'paid' && diningType !== 'room_service' ? 'closed' : 'open';
  const paidAt = paymentStatus === 'paid' ? nowIso : null;

  let insertedOrderId = 0;
  let orderNumber = '';

  db.transaction(() => {
    const existingMaxRow = db
      .prepare(
        "SELECT COALESCE(MAX(CAST(substr(order_number, 5) AS INTEGER)), 1000) AS max_num FROM pos_orders WHERE order_number LIKE 'POS-%'"
      )
      .get() as { max_num: number };
    const nextOrderNum = getNextSequenceValue('pos_order', Math.max(1000, existingMaxRow.max_num || 1000));
    orderNumber = `POS-${nextOrderNum}`;

    const insertResult = db.prepare(
      `INSERT INTO pos_orders (
        order_number, stay_id, room_number, guest_name, dining_type, table_number,
        items_json, subtotal, tax_amount, total_amount, tax_breakdown_json,
        settlement, payment_status, payment_reference, paid_at, status, notes, station_name, created_at, shift_id
      )
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      orderNumber,
      stayId,
      roomNumber,
      guestName,
      diningType,
      tableNumber,
      JSON.stringify(normalizedItems),
      taxCalc.netAmount,
      taxCalc.taxAmount,
      taxCalc.totalAmount,
      taxBreakdownJson,
      settlement,
      paymentStatus,
      paymentReference,
      paidAt,
      initialStatus,
      notes,
      stationName,
      nowIso,
      paymentStatus === 'paid' ? req.session!.shiftId : null
    );
    insertedOrderId = Number(insertResult.lastInsertRowid);

    if (settlement === 'folio' && stayId !== null) {
      const summaryLabel = normalizedItems
        .map((i) => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name))
        .join(', ')
        .slice(0, 130);
      const chgRes = db.prepare(
        `INSERT INTO folio_charges (
          stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount, tax_label, tax_breakdown_json, posted_by_station, posted_at
        )
         VALUES (?, 'restaurant_pos', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stayId,
        `${orderNumber} — ${summaryLabel}`,
        orderNumber,
        rawSubtotal,
        taxCalc.netAmount,
        taxCalc.taxAmount,
        taxCalc.totalAmount,
        taxLabel,
        taxBreakdownJson,
        stationName,
        nowIso
      );

      recordFolioChargeJournal({
        chargeId: Number(chgRes.lastInsertRowid),
        category: 'restaurant_pos',
        description: `${orderNumber} — ${summaryLabel}`,
        referenceCode: orderNumber,
        netAmount: taxCalc.netAmount,
        taxAmount: taxCalc.taxAmount,
        totalAmount: taxCalc.totalAmount,
        postedBy: req.session!.fullName,
        stationName,
        createdAt: nowIso,
      });
      reconcileStayAllocations(stayId);
    } else {
      recordPosOrderJournal({
        orderId: insertedOrderId,
        orderNumber,
        diningType,
        guestName,
        subtotal: taxCalc.netAmount,
        taxAmount: taxCalc.taxAmount,
        totalAmount: taxCalc.totalAmount,
        settlement,
        paymentStatus,
        postedBy: req.session!.fullName,
        stationName,
        createdAt: nowIso,
      });
    }
  })();

  const createdOrder = db.prepare('SELECT * FROM pos_orders WHERE id = ?').get(insertedOrderId);
  broadcastStateSync('pos:order_created');
  return res.status(201).json({
    order: createdOrder,
    orderNumber,
    subtotal: taxCalc.netAmount,
    taxAmount: taxCalc.taxAmount,
    totalAmount: taxCalc.totalAmount,
  });
});

app.post('/api/pos/orders/:id/settle', requireAuth, (req: AuthedRequest, res) => {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Invalid order ID' });

  const existing = db.prepare('SELECT * FROM pos_orders WHERE id = ?').get(orderId) as
    | {
        id: number;
        order_number: string;
        items_json: string;
        subtotal: number;
        tax_amount: number;
        total_amount: number;
        tax_breakdown_json: string;
        payment_status: string;
        station_name: string;
        created_at: string;
        voided?: number;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (existing.voided === 1) {
    return res.status(400).json({ error: 'Cannot settle a voided order' });
  }
  if (existing.payment_status === 'paid') {
    return res.status(400).json({ error: 'Order is already settled and marked as paid' });
  }

  const allowedSettlements = new Set(['card', 'cash', 'bank_transfer', 'folio']);
  if (!allowedSettlements.has(req.body.settlement)) {
    return res.status(400).json({ error: 'Select a valid payment method (card, cash, bank transfer, or guest folio)' });
  }
  const settlement = req.body.settlement as 'card' | 'cash' | 'bank_transfer' | 'folio';
  const paymentReference = String(req.body.payment_reference ?? '').trim().slice(0, 80);
  const nowIso = new Date().toISOString();

  let stayId: number | null = null;
  let roomNumber = '';
  let guestName = '';

  if (settlement === 'folio') {
    const requestedStayId = parsePositiveInt(req.body.stay_id);
    if (!requestedStayId) {
      return res.status(400).json({ error: 'Select a checked-in room to post this order to a guest folio' });
    }
    const stay = getStayById(requestedStayId);
    if (!stay || stay.status !== 'checked_in') {
      return res.status(400).json({ error: 'Selected guest stay is not currently checked in' });
    }
    stayId = stay.id;
    roomNumber = stay.room_number;
    guestName = stay.guest_name;
  }

  db.transaction(() => {
    if (settlement === 'folio' && stayId !== null) {
      db.prepare(
        `UPDATE pos_orders
         SET settlement = 'folio', payment_status = 'paid', payment_reference = ?, paid_at = ?,
             stay_id = ?, room_number = ?, guest_name = ?, status = 'closed'
         WHERE id = ?`
      ).run(paymentReference, nowIso, stayId, roomNumber, guestName, orderId);

      let parsedItems: Array<{ name: string; qty: number }> = [];
      try {
        parsedItems = JSON.parse(existing.items_json) as Array<{ name: string; qty: number }>;
      } catch {
        parsedItems = [];
      }
      const summaryLabel = parsedItems
        .map((i) => (i.qty > 1 ? `${i.qty}x ${i.name}` : i.name))
        .join(', ')
        .slice(0, 130);

      let taxLabel = '';
      try {
        const tb = JSON.parse(existing.tax_breakdown_json || '[]') as Array<{ name?: string; rate?: number }>;
        taxLabel = tb.map((t) => `${t.name ?? 'Tax'} (${t.rate ?? 0}%)`).join(' + ');
      } catch {
        taxLabel = '';
      }

      // Preserve the original order's created_at date so historical restaurant revenue stays on the day served
      db.prepare(
        `INSERT INTO folio_charges (
          stay_id, category, description, reference_code, quantity, unit_price, amount, tax_amount, total_amount, tax_label, tax_breakdown_json, posted_by_station, posted_at
        )
         VALUES (?, 'restaurant_pos', ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        stayId,
        `${existing.order_number} — ${summaryLabel}`,
        existing.order_number,
        existing.subtotal,
        existing.subtotal,
        existing.tax_amount,
        existing.total_amount,
        taxLabel,
        existing.tax_breakdown_json || '[]',
        existing.station_name || 'Restaurant',
        existing.created_at || nowIso
      );

      // Reclassify open restaurant tab receivable (1120) -> Guest Ledger (1100) without double-counting revenue
      recordPosTabSettlementJournal({
        orderId,
        orderNumber: existing.order_number,
        guestName: guestName || 'Room Guest',
        totalAmount: existing.total_amount,
        settlement: 'folio',
        postedBy: req.session!.fullName,
        stationName: existing.station_name || 'Restaurant',
        createdAt: nowIso,
      });
      reconcileStayAllocations(stayId);
    } else {
      db.prepare(
        `UPDATE pos_orders
         SET settlement = ?, payment_status = 'paid', payment_reference = ?, paid_at = ?, status = 'closed', shift_id = ?
         WHERE id = ?`
      ).run(settlement, paymentReference, nowIso, req.session!.shiftId, orderId);

      recordPosTabSettlementJournal({
        orderId,
        orderNumber: existing.order_number,
        guestName: 'Dine-In Guest',
        totalAmount: existing.total_amount,
        settlement,
        postedBy: req.session!.fullName,
        stationName: existing.station_name || 'Restaurant',
        createdAt: nowIso,
      });
    }
  })();

  const updatedOrder = db.prepare('SELECT * FROM pos_orders WHERE id = ?').get(orderId);
  broadcastStateSync('pos:order_settled');
  return res.json({ ok: true, order: updatedOrder });
});

app.patch('/api/pos/orders/:id/status', requireAuth, (req: AuthedRequest, res) => {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Invalid order ID' });

  const existing = db.prepare('SELECT id, voided FROM pos_orders WHERE id = ?').get(orderId) as
    | { id: number; voided?: number }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Cannot update status of a voided order' });

  const allowed = new Set(['open', 'preparing', 'served', 'closed']);
  if (!allowed.has(req.body.status)) return res.status(400).json({ error: 'Invalid order status' });

  db.prepare('UPDATE pos_orders SET status = ? WHERE id = ?').run(req.body.status, orderId);
  broadcastStateSync('pos:order_updated');
  return res.json({ ok: true });
});

app.post('/api/pos/orders/:id/void', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const orderId = parsePositiveInt(req.params.id);
  if (!orderId) return res.status(400).json({ error: 'Invalid order ID' });

  const validation = validateVoidPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { reason } = validation;

  const existing = db.prepare('SELECT * FROM pos_orders WHERE id = ?').get(orderId) as
    | {
        id: number;
        order_number: string;
        stay_id: number | null;
        room_number: string;
        guest_name: string;
        dining_type: string;
        table_number: string;
        subtotal: number;
        tax_amount: number;
        total_amount: number;
        settlement: string;
        payment_status: string;
        voided?: number;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Order not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Order has already been voided' });

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      `UPDATE pos_orders
       SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ?, status = 'closed'
       WHERE id = ?`
    ).run(reason, req.session!.fullName, req.session!.role, nowIso, orderId);

    let voidJournalId: number | null = null;

    if (existing.settlement === 'folio' && existing.stay_id) {
      // Also void the linked guest folio charge so Guest Folio & General Ledger stay 100% reconciled
      const linkedCharge = db
        .prepare(
          `SELECT * FROM folio_charges
           WHERE stay_id = ? AND reference_code = ? AND voided = 0
           ORDER BY id DESC LIMIT 1`
        )
        .get(existing.stay_id, existing.order_number) as
        | {
            id: number;
            category: string;
            description: string;
            reference_code: string;
            amount: number;
            tax_amount: number;
            total_amount: number;
          }
        | undefined;

      if (linkedCharge) {
        db.prepare(
          'UPDATE folio_charges SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ? WHERE id = ?'
        ).run(reason, req.session!.fullName, req.session!.role, nowIso, linkedCharge.id);

        voidJournalId = recordFolioChargeVoidJournal({
          chargeId: linkedCharge.id,
          category: linkedCharge.category,
          description: linkedCharge.description,
          referenceCode: linkedCharge.reference_code || existing.order_number,
          netAmount: linkedCharge.amount,
          taxAmount: linkedCharge.tax_amount,
          totalAmount: linkedCharge.total_amount,
          reason,
          postedBy: req.session!.fullName,
          stationName: req.session!.stationName,
        });
        reconcileStayAllocations(existing.stay_id);
      }
    } else {
      voidJournalId = recordPosOrderVoidJournal({
        orderId,
        orderNumber: existing.order_number,
        guestName: existing.guest_name || 'Dine-In Guest',
        subtotal: existing.subtotal,
        taxAmount: existing.tax_amount,
        totalAmount: existing.total_amount,
        settlement: existing.settlement,
        paymentStatus: existing.payment_status,
        reason,
        postedBy: req.session!.fullName,
        stationName: req.session!.stationName,
      });
    }

    const partyLabel = existing.room_number
      ? `${existing.guest_name} (Rm ${existing.room_number})`
      : existing.table_number
        ? `${existing.guest_name} (${existing.table_number})`
        : existing.guest_name || 'Walk-In Guest';

    recordVoidAuditLog({
      entityType: 'pos_order',
      entityId: orderId,
      referenceCode: existing.order_number,
      description: `Restaurant ${existing.dining_type.replace('_', ' ')} order ${existing.order_number}`,
      partyName: partyLabel,
      department: 'Restaurant',
      originalAmount: existing.subtotal,
      taxAmount: existing.tax_amount,
      totalAmount: existing.total_amount,
      voidReason: reason,
      voidedBy: req.session!.fullName,
      voidedByRole: req.session!.role,
      stationName: req.session!.stationName,
      voidJournalId,
      createdAt: nowIso,
    });
  })();

  broadcastStateSync('pos:order_voided');
  return res.json({ ok: true });
});

// ---------------- RESTRICTED FINANCE & SETTINGS ROUTES ----------------

app.get('/api/reports/summary', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const today = getServerLocalIsoDate();
  const defaultFrom = addDaysLocalIso(today, -6);

  if (req.query.from !== undefined && !isValidIsoDate(req.query.from)) {
    return res.status(400).json({ error: 'Start date must be a valid YYYY-MM-DD calendar date' });
  }
  if (req.query.to !== undefined && !isValidIsoDate(req.query.to)) {
    return res.status(400).json({ error: 'End date must be a valid YYYY-MM-DD calendar date' });
  }

  const from = typeof req.query.from === 'string' ? req.query.from : defaultFrom;
  const to = typeof req.query.to === 'string' ? req.query.to : today;

  if (to < from) {
    return res.status(400).json({ error: 'End date must be on or after start date' });
  }

  return res.json(computeReports(from, to));
});

// Expenses (Finance)
app.post('/api/expenses', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const today = getServerLocalIsoDate();
  if (req.body.expense_date !== undefined && !isValidIsoDate(req.body.expense_date)) {
    return res.status(400).json({ error: 'Expense date must be a valid calendar date' });
  }
  const expenseDate = isValidIsoDate(req.body.expense_date) ? req.body.expense_date : today;
  if (expenseDate > today) {
    return res.status(400).json({ error: `Expense date cannot be in the future (latest ${today})` });
  }

  const rawCategory = String(req.body.category ?? '').trim().slice(0, 64);
  const dbExpenseCats = getAppCategories('expense');
  const category = rawCategory || dbExpenseCats[0]?.name || 'Other';
  upsertAppCategory('expense', category, '5900');
  const description = String(req.body.description ?? '').trim().slice(0, 180);
  if (!description) return res.status(400).json({ error: 'Expense description is required' });

  const amount = parseMoney(req.body.amount);
  if (amount === null || amount <= 0) return res.status(400).json({ error: 'Positive expense amount is required' });

  const vendor = String(req.body.vendor ?? '').trim().slice(0, 120);
  const paymentMethod = VALID_PAYMENT_METHODS.has(req.body.payment_method)
    ? String(req.body.payment_method)
    : 'bank_transfer';
  const reference = String(req.body.reference ?? '').trim().slice(0, 64);

  const nowIso = new Date().toISOString();
  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO expenses (expense_date, category, description, vendor, payment_method, reference, amount, recorded_by, created_at, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      expenseDate,
      category,
      description,
      vendor,
      paymentMethod,
      reference,
      amount,
      req.session!.fullName,
      nowIso,
      req.session!.shiftId
    );

    recordExpenseJournal({
      expenseId: Number(info.lastInsertRowid),
      expenseDate,
      category,
      description,
      vendor,
      paymentMethod,
      reference,
      amount,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
      createdAt: nowIso,
    });
  })();

  broadcastStateSync('expense:created');
  return res.status(201).json({ ok: true });
});

app.delete('/api/expenses/:id', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const expenseId = parsePositiveInt(req.params.id);
  if (!expenseId) return res.status(400).json({ error: 'Invalid expense ID' });

  const validation = validateVoidPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { reason } = validation;

  const existing = db.prepare('SELECT * FROM expenses WHERE id = ?').get(expenseId) as
    | {
        id: number;
        category: string;
        description: string;
        vendor: string;
        payment_method: string;
        reference: string;
        amount: number;
        voided: number;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Expense not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Expense has already been reversed' });

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      'UPDATE expenses SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ? WHERE id = ?'
    ).run(reason, req.session!.fullName, req.session!.role, nowIso, expenseId);

    const voidJournalId = recordExpenseVoidJournal({
      expenseId,
      category: existing.category,
      description: existing.description,
      paymentMethod: existing.payment_method,
      reference: existing.reference,
      amount: existing.amount,
      reason,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
    });

    recordVoidAuditLog({
      entityType: 'expense',
      entityId: expenseId,
      referenceCode: existing.reference || `EXP-${expenseId}`,
      description: `${existing.category} — ${existing.description}`,
      partyName: existing.vendor || 'Supplier',
      department: existing.category,
      originalAmount: existing.amount,
      taxAmount: 0,
      totalAmount: existing.amount,
      voidReason: reason,
      voidedBy: req.session!.fullName,
      voidedByRole: req.session!.role,
      stationName: req.session!.stationName,
      voidJournalId,
      createdAt: nowIso,
    });
  })();

  broadcastStateSync('expense:voided');
  return res.json({ ok: true });
});

// Extra Income (Finance)
app.post('/api/extra-income', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const today = getServerLocalIsoDate();
  if (req.body.income_date !== undefined && !isValidIsoDate(req.body.income_date)) {
    return res.status(400).json({ error: 'Income date must be a valid calendar date' });
  }
  const incomeDate = isValidIsoDate(req.body.income_date) ? req.body.income_date : today;
  if (incomeDate > today) {
    return res.status(400).json({ error: `Income date cannot be in the future (latest ${today})` });
  }

  const rawCategory = String(req.body.category ?? '').trim().slice(0, 64);
  const dbIncomeCats = getAppCategories('extra_income');
  const category = rawCategory || dbIncomeCats[0]?.name || 'Other Income';
  upsertAppCategory('extra_income', category, '4400');
  const description = String(req.body.description ?? '').trim().slice(0, 180);
  if (!description) return res.status(400).json({ error: 'Income description is required' });

  const amount = parseMoney(req.body.amount);
  if (amount === null || amount <= 0) return res.status(400).json({ error: 'Positive income amount is required' });

  const payer = String(req.body.payer ?? '').trim().slice(0, 120);
  const paymentMethod = VALID_PAYMENT_METHODS.has(req.body.payment_method)
    ? String(req.body.payment_method)
    : 'bank_transfer';
  const reference = String(req.body.reference ?? '').trim().slice(0, 64);
  const nowIso = new Date().toISOString();

  db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO extra_income (income_date, category, description, payer, payment_method, reference, amount, recorded_by, created_at, shift_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      incomeDate,
      category,
      description,
      payer,
      paymentMethod,
      reference,
      amount,
      req.session!.fullName,
      nowIso,
      req.session!.shiftId
    );

    recordExtraIncomeJournal({
      incomeId: Number(info.lastInsertRowid),
      incomeDate,
      category,
      description,
      payer,
      paymentMethod,
      reference,
      amount,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
      createdAt: nowIso,
    });
  })();

  broadcastStateSync('extra_income:created');
  return res.status(201).json({ ok: true });
});

app.delete('/api/extra-income/:id', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const incomeId = parsePositiveInt(req.params.id);
  if (!incomeId) return res.status(400).json({ error: 'Invalid extra income ID' });

  const validation = validateVoidPayload(req.body);
  if (!validation.ok) return res.status(400).json({ error: validation.error });
  const { reason } = validation;

  const existing = db.prepare('SELECT * FROM extra_income WHERE id = ?').get(incomeId) as
    | {
        id: number;
        category: string;
        description: string;
        payer: string;
        payment_method: string;
        reference: string;
        amount: number;
        voided: number;
      }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Extra income entry not found' });
  if (existing.voided === 1) return res.status(400).json({ error: 'Extra income entry has already been reversed' });

  const nowIso = new Date().toISOString();

  db.transaction(() => {
    db.prepare(
      'UPDATE extra_income SET voided = 1, void_reason = ?, voided_by = ?, voided_by_role = ?, voided_at = ? WHERE id = ?'
    ).run(reason, req.session!.fullName, req.session!.role, nowIso, incomeId);

    const voidJournalId = recordExtraIncomeVoidJournal({
      incomeId,
      category: existing.category,
      description: existing.description,
      paymentMethod: existing.payment_method,
      reference: existing.reference,
      amount: existing.amount,
      reason,
      postedBy: req.session!.fullName,
      stationName: req.session!.stationName,
    });

    recordVoidAuditLog({
      entityType: 'extra_income',
      entityId: incomeId,
      referenceCode: existing.reference || `INC-${incomeId}`,
      description: `${existing.category} — ${existing.description}`,
      partyName: existing.payer || 'Direct Client',
      department: 'Other Income',
      originalAmount: existing.amount,
      taxAmount: 0,
      totalAmount: existing.amount,
      voidReason: reason,
      voidedBy: req.session!.fullName,
      voidedByRole: req.session!.role,
      stationName: req.session!.stationName,
      voidJournalId,
      createdAt: nowIso,
    });
  })();

  broadcastStateSync('extra_income:voided');
  return res.json({ ok: true });
});

// Accounting Audit Trail, Trial Balance, Night Audit & Backups (Management, Accountant & Auditor)
app.get('/api/accounting/overview', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const today = getServerLocalIsoDate();
  const defaultFrom = addDaysLocalIso(today, -6);

  if (req.query.from !== undefined && !isValidIsoDate(req.query.from)) {
    return res.status(400).json({ error: 'Start date must be a valid YYYY-MM-DD calendar date' });
  }
  if (req.query.to !== undefined && !isValidIsoDate(req.query.to)) {
    return res.status(400).json({ error: 'End date must be a valid YYYY-MM-DD calendar date' });
  }

  const from = typeof req.query.from === 'string' ? req.query.from : defaultFrom;
  const to = typeof req.query.to === 'string' ? req.query.to : today;

  if (to < from) {
    return res.status(400).json({ error: 'End date must be on or after start date' });
  }

  return res.json(getAccountingOverview(from, to));
});

app.post('/api/night-audit/run', requireAuth, requireFinanceOrSettings, async (req: AuthedRequest, res) => {
  try {
    const notes = String(req.body?.notes ?? '').trim().slice(0, 300);
    const result = await runNightAudit({
      triggerType: 'manual',
      triggeredBy: req.session!.fullName,
      notes,
    });
    broadcastStateSync('night_audit:completed');
    return res.status(201).json(result);
  } catch (err) {
    return res.status(409).json({
      error: err instanceof Error ? err.message : 'Unable to complete Night Audit',
    });
  }
});

app.post('/api/backups/create', requireAuth, requireFinanceOrSettings, async (req: AuthedRequest, res) => {
  try {
    const settings = getSettings();
    const backup = await createDatabaseBackup({
      triggerType: 'manual',
      triggeredBy: req.session!.fullName,
      businessDate: settings.business_date,
    });
    broadcastStateSync('backup:created');
    return res.status(201).json({ backup });
  } catch (err) {
    return res.status(500).json({
      error: err instanceof Error ? err.message : 'Failed to create database backup',
    });
  }
});

app.get('/api/backups/:id/download', requireAuth, requireFinancialControl, (req: AuthedRequest, res) => {
  const backupId = parsePositiveInt(req.params.id);
  if (!backupId) return res.status(400).json({ error: 'Invalid backup ID' });

  const row = db.prepare('SELECT * FROM database_backups WHERE id = ?').get(backupId) as
    | DatabaseBackupRow
    | undefined;
  if (!row) return res.status(404).json({ error: 'Backup record not found' });

  const resolvedPath = resolveBackupPath(row.filename);
  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    return res.status(404).json({ error: 'Backup file no longer exists on disk' });
  }

  res.setHeader('Content-Type', 'application/x-sqlite3');
  res.setHeader('Content-Disposition', `attachment; filename="${row.filename}"`);
  return res.sendFile(resolvedPath);
});

app.post('/api/backups/:id/restore', requireAuth, requireManagementOnly, async (req: AuthedRequest, res) => {
  const backupId = parsePositiveInt(req.params.id);
  if (!backupId) return res.status(400).json({ error: 'Invalid backup ID' });

  const confirmPhrase = String(req.body?.confirm ?? '').trim();
  if (confirmPhrase !== 'RESTORE') {
    return res.status(400).json({ error: 'Type RESTORE in uppercase to confirm database restoration' });
  }

  try {
    const result = await restoreDatabaseFromBackup(backupId, req.session!.fullName);
    broadcastStateSync('backup:restored');
    return res.json({
      ok: true,
      restoredBackup: result.restoredBackup,
      safetySnapshot: result.safetySnapshot,
    });
  } catch (err) {
    return res.status(400).json({
      error: err instanceof Error ? err.message : 'Unable to restore database backup',
    });
  }
});

// Settings, Policies & Tax Config
app.patch('/api/settings', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const current = getSettings();
  const hotelName =
    typeof req.body.hotel_name === 'string' && req.body.hotel_name.trim()
      ? req.body.hotel_name.trim().slice(0, 100)
      : current.hotel_name;
  const hotelTagline =
    typeof req.body.hotel_tagline === 'string' ? req.body.hotel_tagline.trim().slice(0, 140) : current.hotel_tagline;
  const hotelAddress =
    typeof req.body.hotel_address === 'string' ? req.body.hotel_address.trim().slice(0, 180) : current.hotel_address;
  const hotelPhone =
    typeof req.body.hotel_phone === 'string' ? req.body.hotel_phone.trim().slice(0, 48) : current.hotel_phone;
  const hotelEmail =
    typeof req.body.hotel_email === 'string' ? req.body.hotel_email.trim().slice(0, 120) : current.hotel_email;
  const hotelWebsite =
    typeof req.body.hotel_website === 'string' ? req.body.hotel_website.trim().slice(0, 140) : current.hotel_website;

  let hotelLogoUrl = current.hotel_logo_url;
  if (typeof req.body.hotel_logo_url === 'string') {
    const candidate = req.body.hotel_logo_url.trim();
    if (!isSafeLogoUrl(candidate)) {
      return res.status(400).json({
        error: 'Logo must be a valid http(s) URL or a PNG/JPEG/WebP image upload under 500 KB',
      });
    }
    hotelLogoUrl = candidate;
  }

  const checkInTime = isValidTime(req.body.check_in_time) ? req.body.check_in_time : current.check_in_time;
  const checkOutTime = isValidTime(req.body.check_out_time) ? req.body.check_out_time : current.check_out_time;
  const taxId = typeof req.body.tax_id === 'string' ? req.body.tax_id.trim().slice(0, 64) : current.tax_id;

  const currencySymbol =
    typeof req.body.currency_symbol === 'string' && req.body.currency_symbol.trim()
      ? req.body.currency_symbol.trim().slice(0, 4)
      : current.currency_symbol;

  const taxEnabled = req.body.tax_enabled !== undefined ? (req.body.tax_enabled ? 1 : 0) : current.tax_enabled;
  const taxName =
    typeof req.body.tax_name === 'string' && req.body.tax_name.trim()
      ? req.body.tax_name.trim().slice(0, 40)
      : current.tax_name;
  const taxRate =
    req.body.tax_rate !== undefined && Number.isFinite(Number(req.body.tax_rate))
      ? Math.max(0, Math.min(50, Number(req.body.tax_rate)))
      : current.tax_rate;
  const taxMode: TaxMode = VALID_TAX_MODES.has(req.body.tax_mode) ? req.body.tax_mode : current.tax_mode;
  const taxAppliesTo: TaxAppliesTo = VALID_TAX_SCOPES.has(req.body.tax_applies_to)
    ? req.body.tax_applies_to
    : current.tax_applies_to;

  const posEnabled = req.body.pos_enabled !== undefined ? (req.body.pos_enabled ? 1 : 0) : current.pos_enabled;
  const emailEnabled = req.body.email_enabled !== undefined ? (req.body.email_enabled ? 1 : 0) : current.email_enabled;
  const emailOnReservation =
    req.body.email_on_reservation !== undefined ? (req.body.email_on_reservation ? 1 : 0) : current.email_on_reservation;
  const emailOnCheckin =
    req.body.email_on_checkin !== undefined ? (req.body.email_on_checkin ? 1 : 0) : current.email_on_checkin;
  const emailOnCheckout =
    req.body.email_on_checkout !== undefined ? (req.body.email_on_checkout ? 1 : 0) : current.email_on_checkout;

  const resendFromEmail =
    typeof req.body.resend_from_email === 'string'
      ? req.body.resend_from_email.replace(/[\r\n]/g, '').trim().slice(0, 160)
      : current.resend_from_email;

  const nightAuditEnabled =
    req.body.night_audit_enabled !== undefined
      ? req.body.night_audit_enabled
        ? 1
        : 0
      : current.night_audit_enabled;
  const nightAuditTime = isValidTime(req.body.night_audit_time)
    ? req.body.night_audit_time
    : current.night_audit_time;
  const autoBackupAfterAudit =
    req.body.auto_backup_after_audit !== undefined
      ? req.body.auto_backup_after_audit
        ? 1
        : 0
      : current.auto_backup_after_audit;
  const parsedRetention = parsePositiveInt(req.body.backup_retention_count);
  const backupRetentionCount = parsedRetention
    ? Math.max(3, Math.min(365, parsedRetention))
    : current.backup_retention_count;

  db.prepare(
    `UPDATE settings
     SET hotel_name = ?, hotel_tagline = ?, hotel_address = ?, hotel_phone = ?, hotel_email = ?, hotel_website = ?,
         hotel_logo_url = ?, check_in_time = ?, check_out_time = ?, tax_id = ?, currency_symbol = ?,
         tax_enabled = ?, tax_name = ?, tax_rate = ?, tax_mode = ?, tax_applies_to = ?,
         pos_enabled = ?, email_enabled = ?, email_on_reservation = ?, email_on_checkin = ?, email_on_checkout = ?,
         resend_from_email = ?,
         night_audit_enabled = ?, night_audit_time = ?, auto_backup_after_audit = ?, backup_retention_count = ?
     WHERE id = 1`
  ).run(
    hotelName,
    hotelTagline,
    hotelAddress,
    hotelPhone,
    hotelEmail,
    hotelWebsite,
    hotelLogoUrl,
    checkInTime,
    checkOutTime,
    taxId,
    currencySymbol,
    taxEnabled,
    taxName,
    taxRate,
    taxMode,
    taxAppliesTo,
    posEnabled,
    emailEnabled,
    emailOnReservation,
    emailOnCheckin,
    emailOnCheckout,
    resendFromEmail,
    nightAuditEnabled,
    nightAuditTime,
    autoBackupAfterAudit,
    backupRetentionCount
  );

  // Write-only Resend API key update (never returned in API responses)
  if (req.body.clear_resend_api_key === true) {
    db.prepare("UPDATE settings SET resend_api_key = '' WHERE id = 1").run();
  } else if (typeof req.body.resend_api_key === 'string' && req.body.resend_api_key.trim().length > 0) {
    const cleanKey = req.body.resend_api_key.replace(/[\r\n\s]/g, '').slice(0, 160);
    db.prepare('UPDATE settings SET resend_api_key = ? WHERE id = 1').run(cleanKey);
  }

  broadcastStateSync('settings:updated');
  return res.json({ settings: getSettings() });
});

// Multi-Tax Rules CRUD (Management & Accountant Only)
app.post('/api/taxes', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const name = String(req.body.name ?? '').trim().slice(0, 60);
  const rate = Number(req.body.rate);
  const mode: TaxMode = VALID_TAX_MODES.has(req.body.mode) ? req.body.mode : 'exclusive';
  const appliesTo: TaxAppliesTo = VALID_TAX_SCOPES.has(req.body.applies_to) ? req.body.applies_to : 'both';
  const enabled = req.body.enabled === false || req.body.enabled === 0 ? 0 : 1;

  if (!name) return res.status(400).json({ error: 'Tax name is required' });
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return res.status(400).json({ error: 'Tax percentage must be greater than 0 and up to 100%' });
  }

  const maxSort = (
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM tax_rules').get() as { m: number }
  ).m;

  db.prepare(
    `INSERT INTO tax_rules (name, rate, mode, applies_to, enabled, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(name, roundMoney(rate), mode, appliesTo, enabled, maxSort + 1, new Date().toISOString());

  syncLegacyTaxSettingsFromRules();
  broadcastStateSync('tax:created');
  return res.status(201).json({ taxRules: getTaxRules(), settings: getSettings() });
});

app.patch('/api/taxes/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const taxId = parsePositiveInt(req.params.id);
  if (!taxId) return res.status(400).json({ error: 'Invalid tax rule ID' });

  const existing = db.prepare('SELECT * FROM tax_rules WHERE id = ?').get(taxId) as
    | { id: number; name: string; rate: number; mode: TaxMode; applies_to: TaxAppliesTo; enabled: number }
    | undefined;
  if (!existing) return res.status(404).json({ error: 'Tax rule not found' });

  const name =
    req.body.name !== undefined ? String(req.body.name).trim().slice(0, 60) : existing.name;
  const rate =
    req.body.rate !== undefined ? Number(req.body.rate) : existing.rate;
  const mode: TaxMode =
    req.body.mode !== undefined && VALID_TAX_MODES.has(req.body.mode) ? req.body.mode : existing.mode;
  const appliesTo: TaxAppliesTo =
    req.body.applies_to !== undefined && VALID_TAX_SCOPES.has(req.body.applies_to)
      ? req.body.applies_to
      : existing.applies_to;
  const enabled =
    req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : existing.enabled;

  if (!name) return res.status(400).json({ error: 'Tax name is required' });
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
    return res.status(400).json({ error: 'Tax percentage must be greater than 0 and up to 100%' });
  }

  db.prepare('UPDATE tax_rules SET name = ?, rate = ?, mode = ?, applies_to = ?, enabled = ? WHERE id = ?').run(
    name,
    roundMoney(rate),
    mode,
    appliesTo,
    enabled,
    taxId
  );

  syncLegacyTaxSettingsFromRules();
  broadcastStateSync('tax:updated');
  return res.json({ taxRules: getTaxRules(), settings: getSettings() });
});

app.delete('/api/taxes/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const taxId = parsePositiveInt(req.params.id);
  if (!taxId) return res.status(400).json({ error: 'Invalid tax rule ID' });

  const info = db.prepare('DELETE FROM tax_rules WHERE id = ?').run(taxId);
  if (info.changes === 0) return res.status(404).json({ error: 'Tax rule not found' });

  syncLegacyTaxSettingsFromRules();
  broadcastStateSync('tax:deleted');
  return res.json({ taxRules: getTaxRules(), settings: getSettings() });
});

// Editable HTML Email Templates
app.patch('/api/email-templates/:eventType', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const eventType = String(req.params.eventType);
  if (!['reservation', 'checkin', 'checkout'].includes(eventType)) {
    return res.status(400).json({ error: 'Invalid template event type' });
  }

  const subject = String(req.body.subject ?? '').trim().slice(0, 180);
  const headline = String(req.body.headline ?? '').trim().slice(0, 140);
  const introText = String(req.body.intro_text ?? '').trim().slice(0, 600);
  const bodyText = String(req.body.body_text ?? '').trim().slice(0, 1600);
  const closingText = String(req.body.closing_text ?? '').trim().slice(0, 500);

  if (!subject || !headline) {
    return res.status(400).json({ error: 'Subject and headline are required' });
  }

  db.prepare(
    `UPDATE email_templates
     SET subject = ?, headline = ?, intro_text = ?, body_text = ?, closing_text = ?,
         show_logo = ?, show_stay_details = ?, show_folio_summary = ?, show_contact_footer = ?
     WHERE event_type = ?`
  ).run(
    subject,
    headline,
    introText,
    bodyText,
    closingText,
    req.body.show_logo ? 1 : 0,
    req.body.show_stay_details ? 1 : 0,
    req.body.show_folio_summary ? 1 : 0,
    req.body.show_contact_footer ? 1 : 0,
    eventType
  );

  broadcastStateSync('email_template:updated');
  return res.json({ templates: getEmailTemplates() });
});

app.post('/api/emails/retry', requireAuth, requireFinanceOrSettings, async (_req, res) => {
  if (!isEmailServiceEnabled()) {
    return res.status(400).json({ error: 'Email service is turned off. Enable it in Settings → Email Config.' });
  }
  const result = await retryQueuedEmails();
  broadcastStateSync('email:retried');
  return res.json(result);
});

// DB-Driven Operational Categories (Expense, Extra Income, Menu, Void Reasons)
const VALID_CATEGORY_KINDS = new Set<AppCategoryKind>(['expense', 'extra_income', 'menu', 'void_reason']);

app.get('/api/categories', requireAuth, (req: AuthedRequest, res) => {
  const rawKind = typeof req.query.kind === 'string' ? (req.query.kind as AppCategoryKind) : undefined;
  if (rawKind && !VALID_CATEGORY_KINDS.has(rawKind)) {
    return res.status(400).json({ error: 'Invalid category kind' });
  }
  return res.json({ categories: getAppCategories(rawKind) });
});

app.post('/api/categories', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const kind = String(req.body.kind ?? '') as AppCategoryKind;
  const name = String(req.body.name ?? '').trim().slice(0, 64);
  if (!VALID_CATEGORY_KINDS.has(kind)) return res.status(400).json({ error: 'Invalid category type' });
  if (!name) return res.status(400).json({ error: 'Category name is required' });
  const defaultCode = kind === 'expense' ? '5900' : kind === 'extra_income' ? '4400' : '';
  const created = upsertAppCategory(kind, name, defaultCode);
  broadcastStateSync('categories:updated');
  return res.status(201).json({ category: created, categories: getAppCategories() });
});

app.delete('/api/categories/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const categoryId = parsePositiveInt(req.params.id);
  if (!categoryId) return res.status(400).json({ error: 'Invalid category ID' });
  const info = db.prepare('UPDATE app_categories SET active = 0 WHERE id = ?').run(categoryId);
  if (info.changes === 0) return res.status(404).json({ error: 'Category not found' });
  broadcastStateSync('categories:updated');
  return res.json({ ok: true, categories: getAppCategories() });
});

// Staff User Accounts Management
app.post('/api/users', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const fullName = String(req.body.full_name ?? '').trim().slice(0, 80);
  const username = String(req.body.username ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '')
    .slice(0, 40);
  const role = String(req.body.role ?? 'front_desk') as StaffRole;
  const password = String(req.body.password ?? '');

  if (!fullName || !username) return res.status(400).json({ error: 'Full name and username are required' });
  if (!VALID_STAFF_ROLES.has(role)) return res.status(400).json({ error: 'Invalid staff role' });
  if (role === 'management' && req.session!.role !== 'management') {
    return res.status(403).json({ error: 'Only Management accounts can create Management users' });
  }
  if (password.length < 4) return res.status(400).json({ error: 'Password must be at least 4 characters' });

  const exists = db.prepare('SELECT id FROM staff_users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: 'Username already exists' });

  db.prepare(
    `INSERT INTO staff_users (full_name, username, role, password_hash, active, created_at)
     VALUES (?, ?, ?, ?, 1, ?)`
  ).run(fullName, username, role, hashPassword(password), new Date().toISOString());

  broadcastStateSync('users:updated');
  return res.status(201).json({ users: getPublicStaffUsers() });
});

app.patch('/api/users/:id', requireAuth, requireFinanceOrSettings, (req: AuthedRequest, res) => {
  const userId = parsePositiveInt(req.params.id);
  if (!userId) return res.status(400).json({ error: 'Invalid user ID' });

  if (userId === req.session!.userId && req.body.active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own active account' });
  }

  const existing = db.prepare('SELECT * FROM staff_users WHERE id = ?').get(userId) as StaffUserRow | undefined;
  if (!existing) return res.status(404).json({ error: 'User not found' });

  const active = req.body.active !== undefined ? (req.body.active ? 1 : 0) : existing.active;
  const role = VALID_STAFF_ROLES.has(req.body.role) ? (req.body.role as StaffRole) : existing.role;

  if ((existing.role === 'management' || role === 'management') && req.session!.role !== 'management') {
    return res.status(403).json({
      error: 'Only Management accounts can modify or promote Management users',
    });
  }

  db.prepare('UPDATE staff_users SET active = ?, role = ? WHERE id = ?').run(active, role, userId);

  if (active === 0) {
    deleteStaffSessionsForUser(userId);
  } else if (role !== existing.role) {
    updateStaffSessionsRole(userId, role);
  }

  broadcastStateSync('users:updated');
  return res.json({ users: getPublicStaffUsers() });
});

// Global API error handler — prevents stack trace leakage or hanging responses
app.use('/api', (err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Unhandled API error:', err);
  if (res.headersSent) return;
  res.status(500).json({ error: 'An unexpected server error occurred. Please try again.' });
});

// Mount Vite in dev or serve static dist in production
async function startServer() {
  if (IS_PRODUCTION) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    const lanIps = getLanAddresses();
    console.log(`Hosila PMS local server running on http://localhost:${PORT}`);
    if (lanIps.length > 0) {
      console.log(`LAN / WLAN workstations can connect at: ${lanIps.map((ip) => `http://${ip}:${PORT}`).join(', ')}`);
    }

    // Prune expired sessions on startup and every 15 minutes
    pruneExpiredStaffSessions();
    setInterval(() => {
      try {
        pruneExpiredStaffSessions();
      } catch (err) {
        console.error('Session pruning failed:', err);
      }
    }, 15 * 60 * 1000);

    // Background Night Audit automation checker (every 30 seconds)
    const runSchedulerCheck = async () => {
      try {
        const ran = await checkScheduledNightAudit();
        if (ran) {
          broadcastStateSync('night_audit:auto_completed');
        }
      } catch (err) {
        console.error('Automatic Night Audit check failed:', err);
      }
    };
    setInterval(runSchedulerCheck, 30_000);
  });
}

startServer().catch((err) => {
  console.error('Failed to start Hosila PMS server:', err);
  process.exit(1);
});

let shuttingDown = false;
function handleGracefulShutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\nReceived ${signal}. Flushing SQLite WAL and shutting down Hosila PMS cleanly...`);
  try {
    wss.close();
  } catch {
    // Ignore
  }
  server.close(() => {
    closeDatabaseGracefully();
    process.exit(0);
  });
  setTimeout(() => {
    closeDatabaseGracefully();
    process.exit(0);
  }, 4000).unref();
}

process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
