/**
 * Hosila PMS — Automated Production Readiness & Accounting Invariant Tests
 * Run via: npm test
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, initDatabase } from '../server/db.ts';
import { initAccountingTables } from '../server/accounting.ts';
import {
  getMachineId,
  initLicenseTable,
  verifyLicenseKeyString,
  type LicensePayload,
} from '../server/license.ts';

function signPayload(payload: LicensePayload, privateKeyPem: string): string {
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.sign(null, Buffer.from(`HSL1.${payloadB64}`, 'utf8'), privateKeyPem);
  return `HSL1.${payloadB64}.${sig.toString('base64url')}`;
}

async function runTests() {
  let passed = 0;
  function test(name: string, fn: () => void) {
    fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  }

  console.log('\n=== Hosila PMS Production Verification Suite ===\n');

  initDatabase();
  initAccountingTables();
  initLicenseTable();

  const machineId = getMachineId();
  const privKeyPath = path.resolve(process.cwd(), 'keys', 'hosila-master-private.pem');
  const hasLocalPrivKey = fs.existsSync(privKeyPath);
  const { publicKey: testPub, privateKey: testPriv } = hasLocalPrivKey
    ? {
        publicKey: undefined, // Uses embedded HOSILA_LICENSE_PUBLIC_KEY in server/license.ts
        privateKey: fs.readFileSync(privKeyPath, 'utf8'),
      }
    : crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

  test('Machine ID has valid HSLA-XXXX-XXXX-XXXX format', () => {
    assert.match(machineId, /^HSLA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  });

  test('Commercial license verifies on matching Host PC Machine ID', () => {
    const key = signPayload(
      {
        v: 1,
        id: 'LIC-TEST-001',
        product: 'hosila-pms',
        type: 'commercial',
        machineId,
        hotelName: 'Grand Palms Hotel',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(),
      },
      testPriv
    );
    const res = verifyLicenseKeyString(key, machineId, testPub);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.payload.hotelName, 'Grand Palms Hotel');
    }
  });

  test('Commercial license is REJECTED on a different PC (cannot be reused)', () => {
    const key = signPayload(
      {
        v: 1,
        id: 'LIC-TEST-002',
        product: 'hosila-pms',
        type: 'commercial',
        machineId: 'HSLA-AAAA-BBBB-CCCC',
        hotelName: 'Other Hotel',
        issuedAt: new Date().toISOString(),
        expiresAt: null,
      },
      testPriv
    );
    const res = verifyLicenseKeyString(key, 'HSLA-1111-2222-3333', testPub);
    assert.equal(res.ok, false);
  });

  test('Tampered license payload is REJECTED by Ed25519 signature check', () => {
    const key = signPayload(
      {
        v: 1,
        id: 'LIC-TEST-003',
        product: 'hosila-pms',
        type: 'commercial',
        machineId,
        hotelName: 'Honest Hotel',
        issuedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      },
      testPriv
    );
    const [prefix, payloadB64, sig] = key.split('.');
    const decoded = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    decoded.expiresAt = null; // Attacker tries to convert 30-day key to Lifetime
    const tamperedB64 = Buffer.from(JSON.stringify(decoded), 'utf8').toString('base64url');
    const res = verifyLicenseKeyString(`${prefix}.${tamperedB64}.${sig}`, machineId, testPub);
    assert.equal(res.ok, false);
  });

  test('Hosila IMS key is REJECTED by Hosila PMS (strict product isolation)', () => {
    const imsKey = signPayload(
      {
        v: 1,
        id: 'LIC-IMS-001',
        product: 'hosila-ims',
        type: 'commercial',
        machineId,
        hotelName: 'Grand Warehouse',
        issuedAt: new Date().toISOString(),
        expiresAt: null,
      },
      testPriv
    );
    const res = verifyLicenseKeyString(imsKey, machineId, testPub);
    assert.equal(res.ok, false);
  });

  test('Master license with wildcard (*) verifies on any Host PC and product', () => {
    const masterKey = signPayload(
      {
        v: 1,
        id: 'MST-TEST-001',
        product: '*',
        type: 'master',
        machineId: '*',
        hotelName: 'Hosila Master License',
        issuedAt: new Date().toISOString(),
        expiresAt: null,
      },
      testPriv
    );
    const res = verifyLicenseKeyString(masterKey, 'HSLA-9999-8888-7777', testPub);
    assert.equal(res.ok, true);
    if (res.ok) {
      assert.equal(res.payload.type, 'master');
    }
  });

  test('SQLite database passes PRAGMA integrity_check', () => {
    const rows = db.pragma('integrity_check') as Array<{ integrity_check?: string }>;
    assert.ok(rows.length > 0 && rows.every((r) => r.integrity_check === 'ok'));
  });

  test('Double-entry General Journal Trial Balance invariant (SUM(debit) === SUM(credit))', () => {
    const totals = db
      .prepare(
        `SELECT ROUND(COALESCE(SUM(debit), 0), 2) AS total_debit,
                ROUND(COALESCE(SUM(credit), 0), 2) AS total_credit
         FROM accounting_journal_lines`
      )
      .get() as { total_debit: number; total_credit: number };
    assert.equal(totals.total_debit, totals.total_credit);
  });

  test('Offline assets: index.html has zero Google Fonts CDN links and public/ icons exist', () => {
    const html = fs.readFileSync(path.resolve(process.cwd(), 'index.html'), 'utf8');
    assert.equal(html.includes('fonts.googleapis.com'), false);
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'hosila-logo.png')));
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'favicon.png')));
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'icon-192.png')));
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'icon-512.png')));
    assert.ok(fs.existsSync(path.resolve(process.cwd(), 'public', 'manifest.json')));
  });

  console.log(`\nAll ${passed} production verification checks passed!\n`);
}

runTests().catch((err) => {
  console.error('\nVerification FAILED:', err);
  process.exit(1);
});

