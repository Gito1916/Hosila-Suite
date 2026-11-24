/**
 * Hosila PMS — Private Offline Activation Key Generator (Owner / Vendor Tool ONLY)
 *
 * NEVER distribute this script or `keys/hosila-master-private.pem` to customers!
 *
 * Examples:
 *   # Generate a 1-year Commercial key locked to a customer's Host PC Machine ID:
 *   npm run license:gen -- --machine HSLA-8F3A-92C1-4D0E --hotel "Grand Palms Hotel" --tier standard --rooms 50 --days 365
 *
 *   # Generate a Lifetime Commercial key locked to a customer's Host PC:
 *   npm run license:gen -- --machine HSLA-8F3A-92C1-4D0E --hotel "Grand Palms Hotel" --tier enterprise --rooms 0 --lifetime
 *
 *   # Generate your personal Owner Master Key (works on any Host PC, lifetime):
 *   npm run license:gen -- --master --lifetime
 *
 *   # Generate a 7-day Technician Master Key (for demos/setup):
 *   npm run license:gen -- --master --days 7
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { LicensePayload } from '../server/license.ts';

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const privKeyPath = path.resolve(
    String(args.key || path.join(process.cwd(), 'keys', 'hosila-master-private.pem'))
  );

  if (!fs.existsSync(privKeyPath)) {
    console.error(`ERROR: Private signing key not found at ${privKeyPath}`);
    console.error('Keep your Ed25519 private key in keys/hosila-master-private.pem (never ship it to customers).');
    process.exit(1);
  }

  const isMaster = Boolean(args.master);
  const product = String(args.product || (isMaster ? '*' : 'hosila-pms')).trim();
  const machineId = isMaster
    ? String(args.machine || '*').trim().toUpperCase()
    : String(args.machine || '').trim().toUpperCase();

  if (!isMaster && !/^HSLA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/.test(machineId)) {
    console.error('ERROR: Commercial keys require a valid --machine ID (format: HSLA-XXXX-XXXX-XXXX).');
    console.error('Ask the hotel to copy their Machine ID from the Hosila PMS Activation screen.');
    process.exit(1);
  }

  const hotelName = isMaster
    ? String(args.hotel || 'Hosila Master License').trim()
    : String(args.hotel || '').trim();

  if (!isMaster && !hotelName) {
    console.error('ERROR: Commercial keys require --hotel "Hotel Name".');
    process.exit(1);
  }

  const isLifetime = Boolean(args.lifetime);
  const days = Math.max(1, Number(args.days ?? 365) || 365);

  const now = new Date();
  const issuedAt = now.toISOString();
  const expiresAt = isLifetime ? null : new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
  const serial = `${isMaster ? 'MST' : 'LIC'}-${now.getFullYear()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;

  const payload: LicensePayload = {
    v: 1,
    id: serial,
    product: product as LicensePayload['product'],
    type: isMaster ? 'master' : 'commercial',
    machineId,
    hotelName,
    issuedAt,
    expiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signingInput = Buffer.from(`HSL1.${payloadB64}`, 'utf8');
  const privateKeyPem = fs.readFileSync(privKeyPath, 'utf8');
  const signature = crypto.sign(null, signingInput, privateKeyPem);
  const sigB64 = signature.toString('base64url');

  const activationKey = `HSL1.${payloadB64}.${sigB64}`;

  console.log('\n==============================================================');
  console.log('  HOSILA SUITE — SIGNED OFFLINE ACTIVATION KEY');
  console.log('==============================================================');
  console.log(`  License ID : ${payload.id}`);
  console.log(`  Product    : ${payload.product}`);
  console.log(`  Type       : ${payload.type.toUpperCase()} (Full Access)`);
  console.log(`  Customer   : ${payload.hotelName}`);
  console.log(`  Machine ID : ${payload.machineId}`);
  console.log(`  Expires    : ${payload.expiresAt ? payload.expiresAt.slice(0, 10) : 'LIFETIME'}`);
  console.log('--------------------------------------------------------------');
  console.log('\nACTIVATION KEY (Copy & send to customer):\n');
  console.log(activationKey);
  console.log('\n==============================================================\n');
}

main();

