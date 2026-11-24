import fs from 'node:fs';
import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(__dirname, '..');
const SUITE_ROOT = path.resolve(WEB_ROOT, '..');
const PMS_DIR = path.join(SUITE_ROOT, 'Hosila PMS');
const IMS_DIR = path.join(SUITE_ROOT, 'Hosila IMS');
const OUT_DIR = path.join(WEB_ROOT, 'public', 'mockups');
const TMP_DIR = path.join(WEB_ROOT, '.tmp-capture');
const PMS_DB_DIR = path.join(TMP_DIR, 'pms-db');
const CHROME_PROFILE = path.join(TMP_DIR, 'chrome-profile');
const CHROME_EXE = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const PMS_PORT = 3098;
const IMS_PORT = 1422;
const CDP_PORT = 9234;

const args = process.argv.slice(2);
const productFlagIdx = args.indexOf('--product');
const targetProduct = productFlagIdx !== -1 ? (args[productFlagIdx + 1] || 'all') : 'all';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(child) {
  if (!child || !child.pid) return;
  try {
    execSync(`taskkill /F /T /PID ${child.pid}`, { stdio: 'ignore' });
  } catch {
    try { child.kill('SIGKILL'); } catch {}
  }
}

async function waitForHttp(url, timeoutMs = 45000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await sleep(350);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.nextId = 1;
    this.pending = new Map();
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve);
      this.ws.addEventListener('error', reject);
    });
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(String(ev.data));
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
  }

  async connect() {
    await this.ready;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const res = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (res.exceptionDetails) {
      throw new Error(`Eval error: ${JSON.stringify(res.exceptionDetails)}`);
    }
    return res.result?.value;
  }

  async waitFor(fnStr, timeoutMs = 20000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const ok = await this.eval(`Boolean((${fnStr})())`);
      if (ok) return true;
      await sleep(250);
    }
    const text = await this.eval(`document.body?.innerText?.slice(0, 500) || ''`).catch(() => '');
    throw new Error(`Timed out waiting for: ${fnStr.slice(0, 120)}\nBody: ${text}`);
  }

  async captureOptimized(baseName) {
    const { data } = await this.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    const pngBuf = Buffer.from(data, 'base64');
    await sharp(pngBuf)
      .resize(2880, 1800, { fit: 'cover' })
      .webp({ quality: 88 })
      .toFile(path.join(OUT_DIR, `${baseName}-2x.webp`));
    await sharp(pngBuf)
      .resize(1440, 900, { fit: 'cover' })
      .webp({ quality: 86 })
      .toFile(path.join(OUT_DIR, `${baseName}-1x.webp`));
    console.log(`  [saved] ${baseName} (-1x.webp & -2x.webp)`);
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

async function seedPmsDemo() {
  const baseUrl = `http://127.0.0.1:${PMS_PORT}`;
  await fetch(`${baseUrl}/api/license/trial`, { method: 'POST' });

  const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      hotel_name: 'De Palms Boutique Hotel',
      hotel_tagline: 'Victoria Island, Lagos',
      hotel_address: '14 Adeola Odeku Street, Victoria Island, Lagos',
      hotel_phone: '+234 809 555 0190',
      hotel_email: 'reservations@depalms.ng',
      currency_symbol: '₦',
      tax_enabled: true,
      tax_name: 'VAT',
      tax_rate: 7.5,
      tax_mode: 'exclusive',
      tax_applies_to: 'both',
      full_name: 'Adaeze Okafor',
      username: 'admin',
      password: 'AdminPass2026!',
      create_team_profiles: true,
      team_password: 'StaffPass2026!',
    }),
  });
  const setupJson = await setupRes.json();
  const token = setupJson.session.token;
  const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

  const roomsToCreate = [
    { room_number: '101', floor: 1, room_type: 'Standard King', nightly_rate: 65000, capacity: 2 },
    { room_number: '102', floor: 1, room_type: 'Standard King', nightly_rate: 65000, capacity: 2 },
    { room_number: '103', floor: 1, room_type: 'Superior Twin', nightly_rate: 78000, capacity: 2 },
    { room_number: '104', floor: 1, room_type: 'Superior Twin', nightly_rate: 78000, capacity: 2 },
    { room_number: '201', floor: 2, room_type: 'Deluxe Suite', nightly_rate: 110000, capacity: 3 },
    { room_number: '202', floor: 2, room_type: 'Deluxe Suite', nightly_rate: 110000, capacity: 3 },
    { room_number: '203', floor: 2, room_type: 'Executive Suite', nightly_rate: 145000, capacity: 3 },
    { room_number: '204', floor: 2, room_type: 'Executive Suite', nightly_rate: 145000, capacity: 3 },
    { room_number: '301', floor: 3, room_type: 'Penthouse Suite', nightly_rate: 220000, capacity: 4 },
    { room_number: '302', floor: 3, room_type: 'Penthouse Suite', nightly_rate: 220000, capacity: 4 },
  ];
  for (const r of roomsToCreate) {
    await fetch(`${baseUrl}/api/rooms`, { method: 'POST', headers: auth, body: JSON.stringify(r) });
  }

  const boot = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: auth })).json();
  const byNum = Object.fromEntries(boot.state.rooms.map((r) => [r.room_number, r]));

  const guestDefs = [
    { full_name: 'Tunde Bakare', email: 'tunde.bakare@sterling.ng', phone: '+234 803 441 9920', company: 'Sterling Capital Ltd' },
    { full_name: 'Amaka Nwosu', email: 'amaka@veridian.io', phone: '+234 805 220 1833', company: 'Veridian Advisory' },
    { full_name: 'Ibrahim Musa', email: 'i.musa@northernenergy.ng', phone: '+234 809 881 7411', company: 'Northern Energy' },
    { full_name: 'Chioma Adeyemi', email: 'chioma@lagosdesign.co', phone: '+234 812 610 5542', company: '' },
    { full_name: 'Kolawole Balogun', email: 'kola@atlanticventures.ng', phone: '+234 802 901 3344', company: 'Atlantic Ventures' },
  ];
  const guests = [];
  for (const g of guestDefs) {
    const j = await (await fetch(`${baseUrl}/api/guests`, { method: 'POST', headers: auth, body: JSON.stringify(g) })).json();
    guests.push(j.guest);
  }

  const today = new Date().toISOString().slice(0, 10);
  const addDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  const stays = [
    { guest_id: guests[0].id, room_id: byNum['101'].id, check_in_date: today, check_out_date: addDays(3), adults: 1, immediate_check_in: true, deposit_amount: 140000, deposit_method: 'card' },
    { guest_id: guests[1].id, room_id: byNum['201'].id, check_in_date: today, check_out_date: addDays(4), adults: 2, immediate_check_in: true, deposit_amount: 200000, deposit_method: 'bank_transfer' },
    { guest_id: guests[2].id, room_id: byNum['301'].id, check_in_date: today, check_out_date: addDays(2), adults: 2, immediate_check_in: true, deposit_amount: 473000, deposit_method: 'corporate' },
    { guest_id: guests[3].id, room_id: byNum['203'].id, check_in_date: addDays(1), check_out_date: addDays(5), adults: 2, immediate_check_in: false, deposit_amount: 100000, deposit_method: 'card' },
    { guest_id: guests[4].id, room_id: byNum['104'].id, check_in_date: addDays(2), check_out_date: addDays(6), adults: 1, immediate_check_in: false, deposit_amount: 78000, deposit_method: 'bank_transfer' },
  ];
  for (const s of stays) {
    await fetch(`${baseUrl}/api/stays`, { method: 'POST', headers: auth, body: JSON.stringify(s) });
  }

  await fetch(`${baseUrl}/api/rooms/${byNum['103'].id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ housekeeping_status: 'dirty', notes: 'Checkout linen turnover in progress' }),
  });
  await fetch(`${baseUrl}/api/rooms/${byNum['202'].id}`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ housekeeping_status: 'maintenance', notes: 'AC filter servicing scheduled' }),
  });

  // Seed Restaurant POS menu items + a live Room Service & Dine-In order
  const menuItems = [
    { name: 'Jollof Rice & Grilled Chicken', category: 'Mains', price: 14500, description: 'Smoky party jollof with marinated chicken thigh' },
    { name: 'Pepper Soup (Goat Meat)', category: 'Starters', price: 11000, description: 'Spiced aromatic broth' },
    { name: 'Grilled Croaker & Plantain', category: 'Seafood', price: 22500, description: 'Whole spiced croaker with fried plantain' },
    { name: 'Club Sandwich & Fries', category: 'Light Bites', price: 12000, description: 'Toasted triple-decker with crispy fries' },
    { name: 'Chapman Cocktail', category: 'Drinks', price: 6500, description: 'Classic chilled citrus blend' },
    { name: 'Fresh Watermelon Juice', category: 'Drinks', price: 5000, description: 'Pressed daily, zero added sugar' },
  ];
  for (const m of menuItems) {
    await fetch(`${baseUrl}/api/menu`, { method: 'POST', headers: auth, body: JSON.stringify(m) });
  }
  const boot2 = await (await fetch(`${baseUrl}/api/bootstrap`, { headers: auth })).json();
  const firstMenu = boot2.state.menuItems?.[0];
  const fourthMenu = boot2.state.menuItems?.[4];
  const checkedInStay = boot2.state.stays.find((s) => s.status === 'checked_in');
  if (firstMenu && fourthMenu && checkedInStay) {
    await fetch(`${baseUrl}/api/pos/orders`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({
        dining_type: 'room_service',
        stay_id: checkedInStay.id,
        settlement: 'folio',
        items: [
          { menu_item_id: firstMenu.id, name: firstMenu.name, price: firstMenu.price, quantity: 2 },
          { menu_item_id: fourthMenu.id, name: fourthMenu.name, price: fourthMenu.price, quantity: 2 },
        ],
      }),
    });
  }
}

function buildImsPreloadScript() {
  return `(() => {
    try { localStorage.setItem('hosila_ui_scale', '0.95'); } catch {}
    const today = new Date().toISOString().slice(0, 10);
    const daysAgo = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

    const departments = [
      { id: 'd-kitchen', name: 'Kitchen', color: '#6AD4B0', sort_order: 1, is_active: true, staff_count: 6, item_count: 4, created_at: today },
      { id: 'd-fb', name: 'F&B', color: '#1D1D1F', sort_order: 2, is_active: true, staff_count: 4, item_count: 3, created_at: today },
      { id: 'd-hk', name: 'Housekeeping', color: '#1E8665', sort_order: 3, is_active: true, staff_count: 5, item_count: 2, created_at: today },
      { id: 'd-store', name: 'Store', color: '#8E8E93', sort_order: 4, is_active: true, staff_count: 2, item_count: 1, created_at: today },
    ];
    const storeSections = [
      { id: 'sec-protein', name: 'Protein', sort_order: 1, is_active: true, item_count: 2, created_at: today },
    ];
    const units = [
      { id: 'u-kg', code: 'KG', name: 'Kilogram', plural: 'Kilograms', dimension: 'mass', allows_decimals: true, factor_to_dim_base_milli: 1000000, is_system: true },
      { id: 'u-btl', code: 'BTL', name: 'Bottle', plural: 'Bottles', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
      { id: 'u-crate', code: 'CRATE', name: 'Crate', plural: 'Crates', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
      { id: 'u-bag', code: 'BAG', name: 'Bag', plural: 'Bags', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
      { id: 'u-pack', code: 'PACK', name: 'Pack', plural: 'Packs', dimension: 'count', allows_decimals: true, factor_to_dim_base_milli: 1000, is_system: true },
      { id: 'u-pcs', code: 'PCS', name: 'Piece', plural: 'Pieces', dimension: 'count', allows_decimals: false, factor_to_dim_base_milli: 1000, is_system: true },
    ];
    const staff = [
      { id: 'st-1', full_name: 'Chef Emeka Obi', staff_code: 'KIT-01', phone: null, is_store_staff: false, is_active: true, department_ids: ['d-kitchen'], department_names: ['Kitchen'], created_at: today },
      { id: 'st-2', full_name: 'Grace Okafor', staff_code: 'STR-01', phone: null, is_store_staff: true, is_active: true, department_ids: ['d-store'], department_names: ['Store'], created_at: today },
      { id: 'st-3', full_name: 'Sadiq Bello', staff_code: 'FB-02', phone: null, is_store_staff: false, is_active: true, department_ids: ['d-fb'], department_names: ['F&B'], created_at: today },
    ];
    const items = [
      {
        id: 'itm-1', sku: 'PRO-001', name: 'Goat Meat (Fresh Cut)', description: null,
        base_unit_id: 'u-kg', base_unit_code: 'KG', base_unit_name: 'Kilogram', base_unit_plural: 'Kilograms',
        display_unit_id: 'u-kg', default_issue_unit_id: 'u-kg', default_purchase_unit_id: 'u-kg',
        store_section_id: 'sec-protein', store_section_name: 'Protein',
        department_ids: ['d-kitchen'], department_names: ['Kitchen'],
        on_hand_milli: 48000, display_stock: '48 KG', avg_cost_micro: 7200000000, last_cost_micro: 7200000000,
        stock_value_minor: 34560000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 15000, par_level_milli: 60000, stock_status: 'in_stock',
        storage_location: 'Cold Room A', supplier_id: null, supplier_name: 'Mile 12 Meats', is_active: true, item_units: []
      },
      {
        id: 'itm-2', sku: 'KIT-004', name: 'Basmati Rice (50kg Bag)', description: null,
        base_unit_id: 'u-kg', base_unit_code: 'KG', base_unit_name: 'Kilogram', base_unit_plural: 'Kilograms',
        display_unit_id: 'u-bag', default_issue_unit_id: 'u-kg', default_purchase_unit_id: 'u-bag',
        store_section_id: null, store_section_name: null,
        department_ids: ['d-kitchen'], department_names: ['Kitchen'],
        on_hand_milli: 450000, display_stock: '9 BAG (450 KG)', avg_cost_micro: 1960000000, last_cost_micro: 1960000000,
        stock_value_minor: 88200000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 200000, par_level_milli: 600000, stock_status: 'in_stock',
        storage_location: 'Dry Store 1', supplier_id: null, supplier_name: 'Royal Grains', is_active: true, item_units: []
      },
      {
        id: 'itm-3', sku: 'FB-012', name: 'Heineken Lager (33cl Bottle)', description: null,
        base_unit_id: 'u-btl', base_unit_code: 'BTL', base_unit_name: 'Bottle', base_unit_plural: 'Bottles',
        display_unit_id: 'u-crate', default_issue_unit_id: 'u-btl', default_purchase_unit_id: 'u-crate',
        store_section_id: null, store_section_name: null,
        department_ids: ['d-fb'], department_names: ['F&B'],
        on_hand_milli: 96000, display_stock: '4 CRATE (96 BTL)', avg_cost_micro: 950000000, last_cost_micro: 950000000,
        stock_value_minor: 9120000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 48000, par_level_milli: 144000, stock_status: 'in_stock',
        storage_location: 'Beverage Cage', supplier_id: null, supplier_name: 'NB Plc Dist.', is_active: true, item_units: []
      },
      {
        id: 'itm-4', sku: 'FB-019', name: 'Fresh Pineapple', description: null,
        base_unit_id: 'u-pcs', base_unit_code: 'PCS', base_unit_name: 'Piece', base_unit_plural: 'Pieces',
        display_unit_id: 'u-pcs', default_issue_unit_id: 'u-pcs', default_purchase_unit_id: 'u-pcs',
        store_section_id: null, store_section_name: null,
        department_ids: ['d-fb', 'd-kitchen'], department_names: ['F&B', 'Kitchen'],
        on_hand_milli: 14000, display_stock: '14 PCS', avg_cost_micro: 1500000000, last_cost_micro: 1500000000,
        stock_value_minor: 2100000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 20000, par_level_milli: 45000, stock_status: 'low',
        storage_location: 'Produce Rack', supplier_id: null, supplier_name: 'Nina Market', is_active: true, item_units: []
      },
      {
        id: 'itm-5', sku: 'PRO-009', name: 'Atlantic Salmon Fillet', description: null,
        base_unit_id: 'u-kg', base_unit_code: 'KG', base_unit_name: 'Kilogram', base_unit_plural: 'Kilograms',
        display_unit_id: 'u-kg', default_issue_unit_id: 'u-kg', default_purchase_unit_id: 'u-kg',
        store_section_id: 'sec-protein', store_section_name: 'Protein',
        department_ids: ['d-kitchen'], department_names: ['Kitchen'],
        on_hand_milli: 4000, display_stock: '4 KG', avg_cost_micro: 24500000000, last_cost_micro: 24500000000,
        stock_value_minor: 9800000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 8000, par_level_milli: 20000, stock_status: 'low',
        storage_location: 'Cold Room A', supplier_id: null, supplier_name: 'Prime Seafoods', is_active: true, item_units: []
      },
      {
        id: 'itm-6', sku: 'HK-003', name: 'Guest Amenities Kit', description: null,
        base_unit_id: 'u-pack', base_unit_code: 'PACK', base_unit_name: 'Pack', base_unit_plural: 'Packs',
        display_unit_id: 'u-pack', default_issue_unit_id: 'u-pack', default_purchase_unit_id: 'u-pack',
        store_section_id: null, store_section_name: null,
        department_ids: ['d-hk'], department_names: ['Housekeeping'],
        on_hand_milli: 180000, display_stock: '180 PACK', avg_cost_micro: 1200000000, last_cost_micro: 1200000000,
        stock_value_minor: 21600000, cost_missing: false, is_returnable: false,
        reorder_point_milli: 50000, par_level_milli: 250000, stock_status: 'in_stock',
        storage_location: 'Linen & HK Store', supplier_id: null, supplier_name: 'Hospitality Direct', is_active: true, item_units: []
      },
    ];

    let appearance = { theme: 'light' };
    const settings = {
      business_profile: {
        name: 'De Palms Central Store',
        legal_name: 'De Palms Hospitality Ltd',
        address: '14 Adeola Odeku Street, Victoria Island, Lagos',
        phone: '+234 809 555 0140',
        email: 'store@depalms.ng',
        currency_symbol: '₦',
        currency_code: 'NGN',
        date_format: 'DD MMM YYYY',
        logo_data_url: null,
      },
      inventory_rules: {
        allow_negative_stock: false,
        costing_method: 'wac',
        require_storekeeper_pin_on_issue: false,
        require_manager_pin_above_minor: 5000000,
      },
      appearance,
    };

    window.__TAURI_INTERNALS__ = {
      transformCallback: () => 1,
      invoke: async (cmd, args = {}) => {
        switch (cmd) {
          case 'get_system_info':
            return {
              app_version: '1.0.0', run_mode: 'installed', db_path: 'C:\\\\ProgramData\\\\Hosila IMS\\\\hosila.db',
              is_network_path: false, schema_version: 3, needs_onboarding: false,
              user_count: 3, item_count: 370, unit_count: 29,
              integrity: { ok: true, sqlite_quick_check: 'ok', ledger_mismatches: 0, checked_at: new Date().toISOString() },
            };
          case 'get_current_session':
            return { id: 'usr-admin', username: 'admin', full_name: 'Chinedu Eze', role: 'admin' };
          case 'get_settings':
            return { ...settings, appearance };
          case 'update_appearance':
            appearance = args.appearance || appearance;
            return appearance;
          case 'get_license_status':
            return {
              state: 'active', machine_fingerprint: 'HSLA-7EF5-7360-C633',
              licensed_to: 'De Palms Hospitality Ltd', edition: 'Full Access',
              activated_at: daysAgo(12), trial_days_remaining: 0, is_read_only: false, message: 'Active local license.',
            };
          case 'list_departments': return departments;
          case 'list_store_sections': return storeSections;
          case 'list_units': return units;
          case 'list_staff': return staff;
          case 'list_suppliers': return [];
          case 'list_items': return items;
          case 'list_procurement_lists':
            return [
              { id: 'prl-1', number: 'PRL-0042', title: 'Week 4 Kitchen & F&B Restock', scope: 'low_stock', status: 'finalised', line_count: 18, est_total_minor: 48650000, created_at: daysAgo(1) },
            ];
          case 'list_receipts':
            return [
              { id: 'grn-62', number: 'GRN-0062', procurement_list_id: 'prl-1', supplier_id: null, invoice_ref: 'NINA-WK3', source_type: 'parsed_excel', source_filename: 'NINA_WEEK_3_LIST.xlsx', received_by_staff_id: 'st-1', received_by_name: 'Chef Emeka Obi', approved_by_staff_id: 'st-2', approved_by_name: 'Grace Okafor', posted_by_name: 'Chinedu Eze', received_at: daysAgo(1), total_minor: 42600000, status: 'posted', created_at: daysAgo(1), lines: [] },
            ];
          case 'list_collections':
            return [
              { id: 'col-148', number: 'COL-0148', department_id: 'd-kitchen', department_name: 'Kitchen', collector_staff_id: 'st-1', collector_name: 'Chef Emeka Obi', storekeeper_staff_id: 'st-2', storekeeper_name: 'Grace Okafor', created_by_name: 'Chinedu Eze', collection_date: today, notes: 'Dinner prep protein & dry issue', status: 'posted', total_value_minor: 18450000, posted_at: new Date().toISOString(), lines: [] },
            ];
          case 'get_weekly_stock_sheet':
            return {
              start_date: daysAgo(6),
              end_date: today,
              grand_total_minor: 165380000,
              rows: items.map((it) => ({
                section_label: it.store_section_name ? it.store_section_name.toUpperCase() : it.department_names[0].toUpperCase(),
                item_id: it.id,
                item_name: it.name,
                unit_code: it.base_unit_code,
                opening_milli: it.on_hand_milli,
                purchase_milli: 10000,
                available_milli: it.on_hand_milli + 10000,
                issued_milli: 10000,
                closing_milli: it.on_hand_milli,
                unit_cost_micro: it.avg_cost_micro,
                total_value_minor: it.stock_value_minor,
                cost_missing: false,
              })),
            };
          case 'get_stock_valuation_report':
            return {
              as_of_date: today,
              total_value_minor: 165380000,
              total_items: items.length,
              cost_missing_count: 0,
              by_department: [
                { department_id: 'd-kitchen', department_name: 'Kitchen', section_name: null, item_count: 4, total_value_minor: 132560000, cost_missing_count: 0 },
                { department_id: 'd-fb', department_name: 'F&B', section_name: null, item_count: 2, total_value_minor: 11220000, cost_missing_count: 0 },
                { department_id: 'd-hk', department_name: 'Housekeeping', section_name: null, item_count: 1, total_value_minor: 21600000, cost_missing_count: 0 },
              ],
            };
          case 'get_dashboard_kpis':
            return {
              total_inventory_value_minor: 719675812, total_active_items: 370, low_stock_count: 14,
              out_of_stock_count: 3, cost_missing_count: 0, consumed_today_minor: 18450000,
              received_today_minor: 42600000, outstanding_returns_count: 2, open_procurement_lists_count: 1, as_of_date: today,
            };
          case 'get_consumption_by_department':
            return [
              { department_id: 'd-kitchen', department_name: 'Kitchen', department_color: '#6AD4B0', consumed_minor: 94200000, issue_count: 34 },
              { department_id: 'd-fb', department_name: 'F&B', department_color: '#1D1D1F', consumed_minor: 58400000, issue_count: 22 },
              { department_id: 'd-hk', department_name: 'Housekeeping', department_color: '#1E8665', consumed_minor: 26800000, issue_count: 15 },
            ];
          case 'get_daily_consumption_series':
            return [
              12400000, 15800000, 11200000, 19400000, 22100000, 16500000, 14200000,
              18900000, 24300000, 17600000, 15200000, 21800000, 19600000, 18450000
            ].map((c, idx) => ({
              date: daysAgo(13 - idx),
              consumed_minor: c,
              received_minor: idx % 3 === 0 ? c + 12000000 : Math.round(c * 0.45),
            }));
          case 'list_activity_log':
            return [
              { id: 'act-1', at: new Date(Date.now() - 25 * 60000).toISOString(), user_id: 'u1', user_name: 'Chinedu Eze', action: 'collection.posted', entity: 'collection', entity_id: 'c1', summary: 'COL-0148 · Kitchen collected 12 KG Goat Meat & 2 BAG Basmati Rice (Approved by Grace O.)', meta: null },
              { id: 'act-2', at: new Date(Date.now() - 2 * 3600000).toISOString(), user_id: 'u1', user_name: 'Chinedu Eze', action: 'receipt.posted', entity: 'receipt', entity_id: 'r1', summary: 'GRN-0062 · Parsed Nina Market Excel list (28 lines reconciled, WAC updated)', meta: null },
              { id: 'act-3', at: new Date(Date.now() - 5 * 3600000).toISOString(), user_id: 'u1', user_name: 'Chinedu Eze', action: 'collection.posted', entity: 'collection', entity_id: 'c2', summary: 'COL-0147 · F&B Bar collected 3 CRATE Heineken Lager & 8 PCS Fresh Pineapple', meta: null },
            ];
          default:
            return [];
        }
      },
    };
  })();`;
}

async function capturePmsViews(cdp, suffix) {
  // 1. Room Board
  await cdp.eval(`(() => {
    const nav = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent?.includes('Front Desk'));
    if (nav) nav.click();
  })()`);
  await sleep(250);
  await cdp.eval(`(() => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === 'Room Board');
    if (tab) tab.click();
  })()`);
  await sleep(450);
  await cdp.captureOptimized(`pms-room-board-${suffix}`);

  // 2. Front Desk Dashboard
  await cdp.eval(`(() => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === 'Dashboard');
    if (tab) tab.click();
  })()`);
  await sleep(450);
  await cdp.captureOptimized(`pms-dashboard-${suffix}`);

  // 3. Reservations Tape Chart
  await cdp.eval(`(() => {
    const tab = Array.from(document.querySelectorAll('[role="tab"]')).find((b) => b.textContent?.trim() === 'Reservations');
    if (tab) tab.click();
  })()`);
  await sleep(500);
  await cdp.captureOptimized(`pms-reservations-${suffix}`);

  // 4. Integrated Restaurant Billing
  await cdp.eval(`(() => {
    const nav = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent?.includes('Restaurant'));
    if (nav) nav.click();
  })()`);
  await sleep(500);
  await cdp.captureOptimized(`pms-pos-${suffix}`);

  // 5. Finance & Accounting
  await cdp.eval(`(() => {
    const nav = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent?.includes('Finance'));
    if (nav) nav.click();
  })()`);
  await sleep(550);
  await cdp.captureOptimized(`pms-finance-${suffix}`);
}

async function captureImsViews(cdp, suffix) {
  const views = [
    ['Dashboard', `ims-dashboard-${suffix}`],
    ['Inventory', `ims-inventory-${suffix}`],
    ['Collect Stock', `ims-collection-${suffix}`],
    ['Procurement', `ims-procurement-${suffix}`],
    ['Reports', `ims-reports-${suffix}`],
  ];
  for (const [label, outName] of views) {
    await cdp.eval(`(() => {
      const btn = Array.from(document.querySelectorAll('nav button')).find((b) => b.textContent?.trim() === ${JSON.stringify(label)});
      if (btn) btn.click();
    })()`);
    await sleep(550);
    await cdp.captureOptimized(outName);
  }
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
  fs.mkdirSync(PMS_DB_DIR, { recursive: true });
  fs.mkdirSync(CHROME_PROFILE, { recursive: true });

  let pmsProc = null;
  let imsProc = null;
  let chromeProc = null;
  let cdp = null;

  try {
    const doPms = targetProduct === 'all' || targetProduct === 'pms';
    const doIms = targetProduct === 'all' || targetProduct === 'ims';

    if (doPms) {
      pmsProc = spawn('npx.cmd', ['tsx', 'server.ts'], {
        cwd: PMS_DIR,
        env: { ...process.env, PORT: String(PMS_PORT), HOSILA_DATA_DIR: PMS_DB_DIR },
        shell: true,
        stdio: 'pipe',
      });
      await waitForHttp(`http://127.0.0.1:${PMS_PORT}/api/health`);
      await seedPmsDemo();
      console.log('Hosila PMS seeded.');
    }

    if (doIms) {
      imsProc = spawn('npx.cmd', ['vite', '--host', '127.0.0.1', '--port', String(IMS_PORT)], {
        cwd: IMS_DIR,
        env: { ...process.env },
        shell: true,
        stdio: 'pipe',
      });
      await waitForHttp(`http://127.0.0.1:${IMS_PORT}`);
      console.log('Hosila IMS Vite server ready.');
    }

    chromeProc = spawn(CHROME_EXE, [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${CHROME_PROFILE}`,
      '--window-size=1440,900',
      '--force-device-scale-factor=2',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore' });

    await waitForHttp(`http://127.0.0.1:${CDP_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
    const pageTarget = targets.find((t) => t.type === 'page') || targets[0];

    cdp = new CDPClient(pageTarget.webSocketDebuggerUrl);
    await cdp.connect();
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 1440,
      height: 900,
      deviceScaleFactor: 2,
      mobile: false,
    });

    if (doPms) {
      console.log('Capturing Hosila PMS views...');
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PMS_PORT}` });
      await cdp.waitFor(`() => !!document.querySelector('input[type="password"]')`);
      await cdp.eval(`(() => {
        const staffBtn = Array.from(document.querySelectorAll('button')).find((b) => b.innerText.includes('Adaeze Okafor'));
        if (staffBtn) staffBtn.click();
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        const userInp = document.querySelector('input[type="text"]');
        if (userInp) { setter.call(userInp, 'admin'); userInp.dispatchEvent(new Event('input', { bubbles: true })); }
        const pw = document.querySelector('input[type="password"]');
        setter.call(pw, 'AdminPass2026!');
        pw.dispatchEvent(new Event('input', { bubbles: true }));
      })()`);
      await sleep(150);
      await cdp.eval(`document.querySelector('button[type="submit"]').click()`);
      await cdp.waitFor(`() => (document.body?.innerText || '').includes('De Palms Boutique Hotel') && (document.body?.innerText || '').includes('Room Board')`);
      await cdp.eval(`document.fonts.ready`);

      await capturePmsViews(cdp, 'light');
      await cdp.eval(`document.querySelector('button[aria-label="Switch to Dark Mode"]')?.click()`);
      await sleep(500);
      await capturePmsViews(cdp, 'dark');
    }

    if (doIms) {
      console.log('Capturing Hosila IMS views...');
      await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: buildImsPreloadScript() });
      await cdp.send('Page.navigate', { url: `http://127.0.0.1:${IMS_PORT}` });
      await cdp.waitFor(`() => (document.body?.innerText || '').includes('De Palms Central Store') && (document.body?.innerText || '').includes('Collect Stock')`);
      await cdp.eval(`document.fonts.ready`);

      await captureImsViews(cdp, 'light');
      await cdp.eval(`Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.trim() === 'Dark')?.click()`);
      await cdp.waitFor(`() => document.documentElement.classList.contains('dark')`);
      await sleep(500);
      await captureImsViews(cdp, 'dark');
    }

    console.log('Mockup capture complete!');
  } finally {
    if (cdp) cdp.close();
    killTree(chromeProc);
    killTree(pmsProc);
    killTree(imsProc);
    await sleep(600);
    try { fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 }); } catch {}
  }
}

run().catch((err) => {
  console.error('Mockup capture failed:', err);
  process.exit(1);
});
