import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMMERCIAL_CATALOG, formatMoneyAmount } from '../server/commercial-catalog.mjs';
import { appWindowFrame, escHtml, icon, renderHtmlDocument, SITE_URL } from './layout-helpers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASES_DIR = path.join(ROOT, 'releases-md');

function parseReleaseFile(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error(`Invalid frontmatter in ${filePath}`);
  }
  const fmRaw = match[1];
  const bodyMd = match[2].trim();
  const data = {};
  let currentKey = null;

  for (const line of fmRaw.split(/\r?\n/)) {
    const listMatch = line.match(/^\s+-\s+(.*)$/);
    if (listMatch && currentKey) {
      if (!Array.isArray(data[currentKey])) data[currentKey] = [];
      data[currentKey].push(stripQuotes(listMatch[1].trim()));
      continue;
    }
    const kvMatch = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const val = kvMatch[2].trim();
      if (!val) {
        data[currentKey] = [];
      } else if (val === 'true') {
        data[currentKey] = true;
      } else if (val === 'false') {
        data[currentKey] = false;
      } else {
        data[currentKey] = stripQuotes(val);
      }
    }
  }

  return {
    id: path.basename(filePath, '.md'),
    data,
    bodyHtml: renderReleaseMarkdown(bodyMd),
  };
}

function stripQuotes(str) {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1);
  }
  return str;
}

function inlineMd(text) {
  let s = escHtml(text);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

function renderReleaseMarkdown(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      out.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    const t = line.trim();
    if (!t) {
      closeList();
      continue;
    }
    if (t.startsWith('### ')) {
      closeList();
      out.push(`<h3>${inlineMd(t.slice(4))}</h3>`);
    } else if (t.startsWith('- ')) {
      if (!inList) {
        out.push('<ul>');
        inList = true;
      }
      out.push(`<li>${inlineMd(t.slice(2))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inlineMd(t)}</p>`);
    }
  }
  closeList();
  return out.join('\n');
}

function loadAllReleases() {
  const files = fs.readdirSync(RELEASES_DIR).filter((f) => f.endsWith('.md'));
  return files
    .map((f) => parseReleaseFile(path.join(RELEASES_DIR, f)))
    .sort((a, b) => String(b.data.publishedAt).localeCompare(String(a.data.publishedAt)));
}

function writeOut(relPath, content) {
  const abs = path.join(ROOT, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf8');
}

function breadcrumbSchema(items) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: `${SITE_URL}${item.path}`,
    })),
  };
}

function buildHomepage(pmsRel, imsRel) {
  const pmsVer = pmsRel?.data.version || '1.0.0';
  const imsVer = imsRel?.data.version || '1.0.0';

  const heroHtml = `<section class="hero-stage" data-hero-stage>
  <canvas class="hero-field-canvas" data-hero-field aria-hidden="true"></canvas>
  <div class="container hero-grid">
    <div class="hero-copy" data-hero-copy>
      <div class="eyebrow">
        <span class="accent-dot accent-dot-live"></span>
        <span>Hosila Hospitality Suite</span>
      </div>
      <h1 class="display-xl" style="margin-block-start:1rem;">
        Business software.<br />
        Without the complexity.
      </h1>
      <p style="font-size:1.15rem;max-inline-size:36rem;margin-block-start:1.25rem;color:var(--ink-80);">
        Fast, offline-ready software for hotels, restaurants, and central stores.
      </p>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-block-start:1.75rem;">
        <a href="/products/compare" class="btn btn-primary btn-lg icon-trigger">
          <span>Explore Products</span>
          ${icon('arrow-right', 18)}
        </a>
        <a href="/downloads" class="btn btn-secondary btn-lg icon-trigger">
          ${icon('download-tray', 18)}
          <span>Download for Windows</span>
        </a>
      </div>
      <div class="hero-trust-strip">
        <span class="badge">${icon('offline-db', 14)}<span>Works Without Internet</span></span>
        <span class="badge">${icon('lan-sync', 14)}<span>Connects Every Desk Over Hotel Wi-Fi</span></span>
        <span class="badge">${icon('key-ed25519', 14)}<span>No Per-Staff Fees</span></span>
      </div>
    </div>
    <div class="hero-emblem-wrap">
      <div class="hero-emblem-card">
        <canvas class="hero-emblem-canvas" data-hero-emblem aria-label="Interactive 3D Hosila brand emblem"></canvas>
        <div class="hero-emblem-fallback" data-hero-fallback>
          <img src="/hosila-icon.svg" alt="Hosila emblem" width="220" height="220" fetchpriority="high" />
        </div>
        <button type="button" class="btn btn-secondary btn-sm hero-pause-btn" data-hero-pause aria-label="Pause hero animation" aria-pressed="false">
          <span data-icon-pause style="display:inline-flex;">${icon('pause', 14)}</span>
          <span data-icon-play hidden style="display:inline-flex;">${icon('play', 14)}</span>
          <span data-pause-label>Pause motion</span>
        </button>
      </div>
    </div>
  </div>
</section>`;

  const ecosystemHtml = `<div class="ecosystem-shell card" data-ecosystem-diagram data-animate-in>
  <div style="display:grid;gap:1.5rem;">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:1rem;">
      <div>
        <div class="eyebrow"><span class="accent-dot"></span><span>The Hosila Suite</span></div>
        <h3 class="heading-md" style="margin-block-start:0.4rem;">Three focused applications. Built to stay calm on busy days.</h3>
      </div>
      <a href="/products/compare" class="btn btn-secondary btn-sm icon-trigger">
        <span>Compare capabilities</span>
        ${icon('arrow-right', 15)}
      </a>
    </div>
    <div class="eco-grid" data-stagger-group>
      <a href="/products/pms" class="card-subtle card-interactive icon-trigger" data-stagger-item data-eco-node style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          ${icon('hotel-pms', 24, { drawn: true })}
          <span class="badge badge-mint">Available</span>
        </div>
        <h4>Hosila PMS</h4>
        <p style="font-size:0.9375rem;">Complete hotel operations: fast room check-ins, live housekeeping status, corporate split bills, integrated restaurant billing, and daily accounting.</p>
        <div style="font-size:0.84rem;font-weight:600;color:var(--color-accent-ink);">For Hotels, Resorts &amp; Guest Houses</div>
      </a>
      <a href="/products/ims" class="card-subtle card-interactive icon-trigger" data-stagger-item data-eco-node style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          ${icon('cube-ims', 24, { drawn: true })}
          <span class="badge badge-mint">Available</span>
        </div>
        <h4>Hosila IMS</h4>
        <p style="font-size:0.9375rem;">Track every ingredient, beverage, and amenity from supplier delivery to kitchen or bar issue—converting crates, bags, and bottles automatically.</p>
        <div style="font-size:0.84rem;font-weight:600;color:var(--color-accent-ink);">For Central Stores, Kitchens &amp; Bars</div>
      </a>
      <a href="/products/pos" class="card-subtle card-interactive icon-trigger" data-stagger-item data-eco-node style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          ${icon('pos-terminal', 24, { drawn: true })}
          <span class="badge">Coming Soon</span>
        </div>
        <h4>Hosila POS</h4>
        <p style="font-size:0.9375rem;">Dedicated counter and table billing for standalone restaurants, bars, lounges, and retail outlets that do not manage hotel rooms.</p>
        <div style="font-size:0.84rem;font-weight:600;color:var(--ink-45);">For Restaurants, Bars &amp; Retail</div>
      </a>
    </div>
    <div class="eco-core">
      <div class="eco-core-pill icon-trigger">${icon('offline-db', 16)}<span>Works Offline</span></div>
      <div class="eco-core-pill icon-trigger">${icon('night-audit', 16)}<span>Fast Shift Handover</span></div>
      <div class="eco-core-pill icon-trigger">${icon('shield-audit', 16)}<span>Clear Audit Trail</span></div>
      <div class="eco-core-pill icon-trigger">${icon('lock-rbac', 16)}<span>Easy for New Staff</span></div>
    </div>
  </div>
</div>`;

  const bodyHtml = `${heroHtml}
<section class="section content-deferred">
  <div class="container" style="display:grid;gap:2rem;">
    <div style="display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:1.5rem;">
      <div style="max-inline-size:40rem;display:grid;gap:0.65rem;">
        <div class="eyebrow"><span class="accent-dot"></span><span>Inside the Software</span></div>
        <h2 class="heading-lg">Designed to feel clear at midnight and at noon.</h2>
        <p>Actual screens from Hosila PMS and Hosila IMS in Dark and Light modes.</p>
      </div>
      <div class="segmented" role="tablist" aria-label="Choose Hosila application">
        <button type="button" role="tab" class="segmented-btn is-active" aria-selected="true" data-showcase-app="pms">
          Hosila PMS <span class="mono" style="font-size:0.78rem;color:var(--ink-45);">v${escHtml(pmsVer)}</span>
        </button>
        <button type="button" role="tab" class="segmented-btn" aria-selected="false" data-showcase-app="ims">
          Hosila IMS <span class="mono" style="font-size:0.78rem;color:var(--ink-45);">v${escHtml(imsVer)}</span>
        </button>
      </div>
    </div>

    <div data-showcase-panel="pms" style="display:grid;gap:1.25rem;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem;">
        <div class="segmented" role="tablist" aria-label="Hosila PMS views">
          <button type="button" class="segmented-btn is-active" data-view-tab="pms:room-board">Room Board</button>
          <button type="button" class="segmented-btn" data-view-tab="pms:reservations">Booking Chart</button>
          <button type="button" class="segmented-btn" data-view-tab="pms:dashboard">Front Desk</button>
          <button type="button" class="segmented-btn" data-view-tab="pms:pos">Hotel Restaurant</button>
          <button type="button" class="segmented-btn" data-view-tab="pms:finance">Daily Accounts</button>
        </div>
        <a href="/products/pms" class="btn btn-secondary btn-sm icon-trigger"><span>Explore Hosila PMS</span>${icon('arrow-right', 15)}</a>
      </div>
      <div data-view-pane="pms:room-board">${appWindowFrame({ baseName: 'pms-room-board', title: 'Hosila PMS · Live Room Board', alt: 'Hosila PMS Room Board showing clean, occupied, dirty, and maintenance rooms', eager: true })}</div>
      <div data-view-pane="pms:reservations" hidden>${appWindowFrame({ baseName: 'pms-reservations', title: 'Hosila PMS · 14-Day Reservation Chart', alt: 'Hosila PMS horizontal Room by Date reservations chart' })}</div>
      <div data-view-pane="pms:dashboard" hidden>${appWindowFrame({ baseName: 'pms-dashboard', title: 'Hosila PMS · Front Desk Overview', alt: 'Hosila PMS Front Desk Dashboard with arrivals, departures, and occupancy' })}</div>
      <div data-view-pane="pms:pos" hidden>${appWindowFrame({ baseName: 'pms-pos', title: 'Hosila PMS · Integrated Restaurant Billing', alt: 'Hosila PMS hotel restaurant billing and room service bill posting' })}</div>
      <div data-view-pane="pms:finance" hidden>${appWindowFrame({ baseName: 'pms-finance', title: 'Hosila PMS · Revenue & Daily Accounts', alt: 'Hosila PMS Finance overview and accounting records' })}</div>
    </div>

    <div data-showcase-panel="ims" hidden style="display:grid;gap:1.25rem;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem;">
        <div class="segmented" role="tablist" aria-label="Hosila IMS views">
          <button type="button" class="segmented-btn is-active" data-view-tab="ims:dashboard">Store Overview</button>
          <button type="button" class="segmented-btn" data-view-tab="ims:inventory">Stock Catalog</button>
          <button type="button" class="segmented-btn" data-view-tab="ims:collection">Issue Stock</button>
          <button type="button" class="segmented-btn" data-view-tab="ims:procurement">Market Purchasing</button>
          <button type="button" class="segmented-btn" data-view-tab="ims:reports">Weekly Stock Sheet</button>
        </div>
        <a href="/products/ims" class="btn btn-secondary btn-sm icon-trigger"><span>Explore Hosila IMS</span>${icon('arrow-right', 15)}</a>
      </div>
      <div data-view-pane="ims:dashboard">${appWindowFrame({ baseName: 'ims-dashboard', title: 'Hosila IMS · Store Value & Stock Movement', alt: 'Hosila IMS Dashboard displaying total store value and 14-day stock usage' })}</div>
      <div data-view-pane="ims:inventory" hidden>${appWindowFrame({ baseName: 'ims-inventory', title: 'Hosila IMS · Department Stock Catalog', alt: 'Hosila IMS Stock Catalog grouped by Kitchen, Bar, Housekeeping, and Protein' })}</div>
      <div data-view-pane="ims:collection" hidden>${appWindowFrame({ baseName: 'ims-collection', title: 'Hosila IMS · Fast Counter Stock Issue', alt: 'Hosila IMS Stock Collection counter screen' })}</div>
      <div data-view-pane="ims:procurement" hidden>${appWindowFrame({ baseName: 'ims-procurement', title: 'Hosila IMS · Market List & Restocking', alt: 'Hosila IMS Procurement list builder and market Excel import' })}</div>
      <div data-view-pane="ims:reports" hidden>${appWindowFrame({ baseName: 'ims-reports', title: 'Hosila IMS · Weekly Stock Sheet Report', alt: 'Hosila IMS Weekly Stock Sheet valuation report' })}</div>
    </div>
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:2.25rem;">
    <div style="max-inline-size:40rem;display:grid;gap:0.65rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Why Hosila</span></div>
      <h2 class="heading-lg">Reliable at the front desk. Clear in the back office.</h2>
    </div>
    <div class="proof-grid" data-stagger-group data-animate-in>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.85rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="icon-frame">${icon('offline-db', 22, { drawn: true })}</span>
          <span class="mono" style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">01</span>
        </div>
        <h3>Works Without Internet</h3>
        <p style="font-size:0.9375rem;">Check in guests, take orders, and issue stock smoothly even when internet drops.</p>
      </article>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.85rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="icon-frame">${icon('lan-sync', 22)}</span>
          <span class="mono" style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">02</span>
        </div>
        <h3>Every Desk in Sync</h3>
        <p style="font-size:0.9375rem;">Reception, bar, restaurant, and accounts stay updated live over your property Wi-Fi.</p>
      </article>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.85rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="icon-frame">${icon('shield-audit', 22, { drawn: true })}</span>
          <span class="mono" style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">03</span>
        </div>
        <h3>Full Accountability</h3>
        <p style="font-size:0.9375rem;">Every bill, void, night audit, and store issue is tracked automatically.</p>
      </article>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.85rem;align-content:start;">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <span class="icon-frame">${icon('key-ed25519', 22, { drawn: true })}</span>
          <span class="mono" style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">04</span>
        </div>
        <h3>Zero Per-Staff Fees</h3>
        <p style="font-size:0.9375rem;">One straightforward license unlocks every feature with no per-room charges.</p>
      </article>
    </div>
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container">${ecosystemHtml}</div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:2.25rem;">
    <div style="max-inline-size:38rem;display:grid;gap:0.65rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Built For Busy Shifts</span></div>
      <h2 class="heading-lg">Faster work across every department.</h2>
    </div>
    <div class="workflows-grid" data-stagger-group data-animate-in>
      <div class="card-subtle icon-trigger" data-stagger-item style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;align-items:center;gap:0.6rem;color:var(--color-accent-ink);">${icon('room-board', 20)}<span class="mono" style="font-size:0.8rem;font-weight:700;">FRONT DESK</span></div>
        <h3>Instant Room Visibility</h3>
        <p style="font-size:0.9375rem;">Color-coded rooms, fast guest lookup, and automatic dirty-room protection.</p>
      </div>
      <div class="card-subtle icon-trigger" data-stagger-item style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;align-items:center;gap:0.6rem;color:var(--color-accent-ink);">${icon('excel-parser', 20, { drawn: true })}<span class="mono" style="font-size:0.8rem;font-weight:700;">CENTRAL STORE</span></div>
        <h3>Smart Market Import</h3>
        <p style="font-size:0.9375rem;">Import buyer Excel lists directly and flag price jumps before stock updates.</p>
      </div>
      <div class="card-subtle icon-trigger" data-stagger-item style="display:grid;gap:0.75rem;align-content:start;">
        <div style="display:flex;align-items:center;gap:0.6rem;color:var(--color-accent-ink);">${icon('night-audit', 20)}<span class="mono" style="font-size:0.8rem;font-weight:700;">ACCOUNTS</span></div>
        <h3>Clean Shift Handovers</h3>
        <p style="font-size:0.9375rem;">Permanent audit trails, Night Audit backups, and corporate City Ledger tracking.</p>
      </div>
    </div>
  </div>
</section>

<section class="section section-bordered">
  <div class="container">
    <div class="card" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.5rem;padding:2.25rem;">
      <div style="max-inline-size:34rem;display:grid;gap:0.45rem;">
        <h2 class="heading-md">Ready to try Hosila at your property?</h2>
        <p style="font-size:0.95rem;">Download a 14-day free trial for Windows or chat directly with our sales team.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
        <a href="/downloads" class="btn btn-primary icon-trigger">${icon('download-tray', 16)}<span>Download for Windows</span></a>
        <a href="/contact" class="btn btn-secondary icon-trigger">${icon('whatsapp', 16)}<span>Contact Sales</span></a>
      </div>
    </div>
  </div>
</section>`;

  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Hosila Software',
      url: SITE_URL,
      logo: `${SITE_URL}/Hosila-icon-logo.png`,
      description: 'Dependable software for hotels, restaurants, bars, and central stores—designed to run smoothly without internet.',
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Hosila Hospitality Suite',
      url: SITE_URL,
      potentialAction: {
        '@type': 'SearchAction',
        target: `${SITE_URL}/docs/?q={search_term_string}`,
        'query-input': 'required name=search_term_string',
      },
    },
  ];

  writeOut(
    'index.html',
    renderHtmlDocument({
      title: 'Hosila — Business software. Without the complexity.',
      description:
        'Dependable hospitality software for hotels, restaurants, and central stores. Manage room check-ins, guest bills, hotel dining, and store inventory smoothly without internet.',
      canonicalPath: '/',
      schemas,
      pageScripts: ['/js/home.js'],
      bodyHtml,
    })
  );
}

function buildPmsPage(pmsRel) {
  const ver = pmsRel?.data.version || '1.0.0';
  const dl = pmsRel?.data.downloadUrl || '/api/download/hosila-pms';

  const bodyHtml = `<section class="section" style="border-block-end:1px solid var(--ink-10);">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div style="display:grid;gap:1.1rem;max-inline-size:48rem;">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem;">
        <span class="badge badge-mint">Hosila PMS · Version ${escHtml(ver)}</span>
        <span class="badge">For Hotels, Resorts &amp; Guest Houses</span>
      </div>
      <h1 class="display-xl" style="font-size:clamp(2.2rem,4.5vw,3.6rem);">Hotel management built for calm, fast front desks.</h1>
      <p style="font-size:1.1rem;color:var(--ink-80);">Rooms, housekeeping, restaurant billing, and daily accounts connected live across your hotel Wi-Fi.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-block-start:0.5rem;">
        <a href="${escHtml(dl)}" class="btn btn-primary btn-lg icon-trigger">${icon('download-tray', 18)}<span>Download Hosila PMS</span></a>
        <a href="/pricing" class="btn btn-secondary btn-lg icon-trigger"><span>View Pricing</span>${icon('arrow-right', 16)}</a>
      </div>
    </div>
    ${appWindowFrame({ baseName: 'pms-room-board', title: `Hosila PMS · Live Room Board`, alt: 'Hosila PMS Room Board with clean, occupied, dirty, and maintenance rooms', eager: true })}
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:1.75rem;">
    <div style="max-inline-size:42rem;display:grid;gap:0.55rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Interactive Preview</span></div>
      <h2 class="heading-lg">Housekeeping Check-In Guard.</h2>
      <p>Click any room to see how Hosila PMS blocks check-ins into dirty or maintenance rooms.</p>
    </div>
    <div class="pms-sandbox-layout card">
      <div class="pms-sandbox-grid" role="list" aria-label="Sample hotel rooms">
        <button type="button" class="sandbox-room is-selected" data-sb-room="102" data-sb-status="clean" data-sb-guest="" data-sb-rate="&#8358;65,000/nt" data-sb-type="Standard King">
          <span class="sb-bar sb-bar-mint"></span>
          <div class="sb-body">
            <div class="sb-top"><strong class="mono">102</strong><span class="mono">&#8358;65,000/nt</span></div>
            <div style="font-size:0.84rem;color:var(--ink-65);">Standard King · Clean</div>
            <div style="font-size:0.84rem;color:var(--color-accent-ink);font-weight:600;">Available</div>
          </div>
        </button>
        <button type="button" class="sandbox-room" data-sb-room="101" data-sb-status="occupied" data-sb-guest="Tunde Bakare · Balance &#8358;69,625" data-sb-rate="&#8358;65,000/nt" data-sb-type="Standard King">
          <span class="sb-bar sb-bar-ink"></span>
          <div class="sb-body">
            <div class="sb-top"><strong class="mono">101</strong><span class="mono">&#8358;65,000/nt</span></div>
            <div style="font-size:0.84rem;color:var(--ink-65);">Standard King · Clean</div>
            <div style="font-size:0.84rem;font-weight:600;">Occupied · Tunde Bakare</div>
          </div>
        </button>
        <button type="button" class="sandbox-room" data-sb-room="103" data-sb-status="dirty" data-sb-guest="" data-sb-rate="&#8358;78,000/nt" data-sb-type="Superior Twin">
          <span class="sb-bar sb-bar-red"></span>
          <div class="sb-body">
            <div class="sb-top"><strong class="mono">103</strong><span class="mono">&#8358;78,000/nt</span></div>
            <div style="font-size:0.84rem;color:var(--color-danger-ink);">Superior Twin · Dirty</div>
            <div style="font-size:0.84rem;color:var(--color-danger-ink);font-weight:600;">Needs cleaning</div>
          </div>
        </button>
        <button type="button" class="sandbox-room" data-sb-room="202" data-sb-status="maintenance" data-sb-guest="" data-sb-rate="&#8358;110,000/nt" data-sb-type="Deluxe Suite">
          <span class="sb-bar sb-bar-red"></span>
          <div class="sb-body">
            <div class="sb-top"><strong class="mono">202</strong><span class="mono">&#8358;110,000/nt</span></div>
            <div style="font-size:0.84rem;color:var(--color-danger-ink);">Deluxe Suite · Maintenance</div>
            <div style="font-size:0.84rem;color:var(--color-danger-ink);font-weight:600;">Out of service</div>
          </div>
        </button>
      </div>
      <aside class="pms-inspector" aria-live="polite" data-sb-inspector>
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <strong class="mono" style="font-size:1.05rem;" data-ins-title>Room 102 · Standard King</strong>
          <span class="badge badge-mint" data-ins-badge>Clean &amp; Ready</span>
        </div>
        <div class="mono" style="font-size:0.88rem;color:var(--ink-65);" data-ins-meta>Rate: &#8358;65,000/nt</div>
        <p style="font-size:0.92rem;" data-ins-note>Ready for immediate walk-in check-in or reservation assignment.</p>
        <div style="display:flex;flex-wrap:wrap;gap:0.5rem;">
          <button type="button" class="btn btn-primary btn-sm" data-ins-checkin>Check In Guest</button>
          <button type="button" class="btn btn-secondary btn-sm" data-ins-clean hidden>Mark Room Clean</button>
        </div>
        <div data-ins-feedback style="font-size:0.86rem;font-weight:600;min-block-size:1.25rem;color:var(--color-accent-ink);"></div>
      </aside>
    </div>
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div class="pms-features-grid" data-stagger-group data-animate-in>
      <div class="card icon-trigger" data-stagger-item style="display:grid;gap:0.65rem;">
        ${icon('tape-chart', 22, { drawn: true })}
        <h3>14/21-Day Booking Chart</h3>
        <p style="font-size:0.92rem;">See upcoming arrivals, group blocks, and room availability by floor across two or three weeks at a glance—click any empty slot to create a booking.</p>
      </div>
      <div class="card icon-trigger" data-stagger-item style="display:grid;gap:0.65rem;">
        ${icon('folio-split', 22, { drawn: true })}
        <h3>Split Bills &amp; City Ledger</h3>
        <p style="font-size:0.92rem;">Separate Company vs. Personal charges in one click, extend stays, move rooms cleanly, approve complimentary waivers, and track corporate unpaid check-outs.</p>
      </div>
      <div class="card icon-trigger" data-stagger-item style="display:grid;gap:0.65rem;">
        ${icon('restaurant-docket', 22, { drawn: true })}
        <h3>Hotel Restaurant &amp; Bar</h3>
        <p style="font-size:0.92rem;">Open restaurant tables, post room-service orders straight to guest room bills, print kitchen order dockets, or turn the dining module off for room-only lodges.</p>
      </div>
      <div class="card icon-trigger" data-stagger-item style="display:grid;gap:0.65rem;">
        ${icon('lock-rbac', 22, { drawn: true })}
        <h3>Clear Staff Permissions</h3>
        <p style="font-size:0.92rem;">Dedicated roles for Management, Accountant, Auditor, Front Desk, and Restaurant. Sensitive actions like voids and waivers stay protected behind manager approval.</p>
      </div>
    </div>

    <div class="card-subtle" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;">
      <div style="max-inline-size:44rem;">
        <strong style="color:var(--color-ink);">Running a standalone restaurant, lounge, or retail shop without hotel rooms?</strong>
        <p style="font-size:0.92rem;margin-block-start:0.25rem;">
          Hosila PMS&rsquo;s restaurant module is made for hotel dining and guest room bills. For standalone venues, see our upcoming <a href="/products/pos" style="color:var(--color-accent-ink);font-weight:600;text-decoration:underline;">Hosila POS</a>.
        </p>
      </div>
      <a href="/products/compare" class="btn btn-secondary btn-sm">Compare Products</a>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:1.5rem;">
      ${appWindowFrame({ baseName: 'pms-reservations', title: 'Hosila PMS · 14-Day Booking Chart', alt: 'Hosila PMS Reservation Chart' })}
      ${appWindowFrame({ baseName: 'pms-finance', title: 'Hosila PMS · Revenue & Daily Accounts', alt: 'Hosila PMS Finance and Daily Accounts Ledger' })}
    </div>
  </div>
</section>`;

  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Hosila PMS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows 10, Windows 11',
      softwareVersion: ver,
      downloadUrl: `${SITE_URL}${dl}`,
      description: 'Hotel property management software with fast room check-ins, booking chart, corporate split bills, integrated hotel restaurant billing, and daily accounting.',
      offers: {
        '@type': 'Offer',
        price: '35000',
        priceCurrency: 'NGN',
        url: `${SITE_URL}/pricing`,
      },
    },
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Hosila PMS', path: '/products/pms' },
    ]),
  ];

  writeOut(
    'products/pms/index.html',
    renderHtmlDocument({
      title: 'Hosila PMS — Hotel Management, Restaurant Billing & Accounting',
      description:
        'Hotel property management software built for fast front desks. Connect reception, housekeeping, hotel dining, and accounts over property Wi-Fi without needing internet.',
      canonicalPath: '/products/pms',
      schemas,
      pageScripts: ['/js/pms-sandbox.js'],
      bodyHtml,
    })
  );
}

function buildImsPage(imsRel) {
  const ver = imsRel?.data.version || '1.0.0';
  const dl = imsRel?.data.downloadUrl || '/api/download/hosila-ims';

  const bodyHtml = `<section class="section" style="border-block-end:1px solid var(--ink-10);">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div style="display:grid;gap:1.1rem;max-inline-size:48rem;">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem;">
        <span class="badge badge-mint">Hosila IMS · Version ${escHtml(ver)}</span>
        <span class="badge">For Hotel Stores, Kitchens, Bars &amp; Supermarkets</span>
      </div>
      <h1 class="display-xl" style="font-size:clamp(2.2rem,4.5vw,3.6rem);">Know what came in, what went out, and what remains.</h1>
      <p style="font-size:1.1rem;color:var(--ink-80);">Offline inventory control for central stores, kitchens, and bars with exact stock valuation.</p>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;margin-block-start:0.5rem;">
        <a href="${escHtml(dl)}" class="btn btn-primary btn-lg icon-trigger">${icon('download-tray', 18)}<span>Download Hosila IMS</span></a>
        <a href="/pricing" class="btn btn-secondary btn-lg icon-trigger"><span>View Pricing</span>${icon('arrow-right', 16)}</a>
      </div>
    </div>
    ${appWindowFrame({ baseName: 'ims-dashboard', title: 'Hosila IMS · Store Overview & Stock Value', alt: 'Hosila IMS Dashboard showing total stock value, 14-day movement, and activity log', eager: true })}
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:2rem;">
    <div style="max-inline-size:42rem;display:grid;gap:0.6rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Smart Unit Conversion</span></div>
      <h2 class="heading-lg">Buy in crates or bags. Issue in bottles or kilos.</h2>
      <p>Stock balances stay crystal clear—never showing confusing decimals like <span class="mono">0.33 crate</span>. Slide below to see how Hosila IMS automatically displays bulk crates alongside loose bottles and exact value.</p>
    </div>
    <div class="card ims-uom-sandbox">
      <div style="display:grid;gap:1rem;">
        <label for="uom-bottles-range" style="font-size:0.9375rem;font-weight:600;display:flex;justify-content:space-between;flex-wrap:wrap;gap:0.5rem;color:var(--color-ink);">
          <span>Heineken Lager Stock On Hand (24 Bottles per Crate)</span>
          <span class="mono" data-uom-bottles>76 Bottles</span>
        </label>
        <input id="uom-bottles-range" type="range" min="0" max="168" value="76" data-uom-slider style="inline-size:100%;" />
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(13rem,1fr));gap:0.85rem;">
          <div class="card-subtle" style="padding:1rem;">
            <div style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">Shelf Display</div>
            <div class="mono" style="font-size:1.15rem;font-weight:700;color:var(--color-accent-ink);margin-block-start:0.25rem;" data-uom-upscaled>3 Crates + 4 Bottles</div>
          </div>
          <div class="card-subtle" style="padding:1rem;">
            <div style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">Unit Cost</div>
            <div class="mono" style="font-size:1.05rem;font-weight:600;margin-block-start:0.25rem;" data-uom-rate>&#8358;950 / Bottle (&#8358;22,800 / Crate)</div>
          </div>
          <div class="card-subtle" style="padding:1rem;">
            <div style="font-size:0.8rem;font-weight:600;color:var(--ink-45);">Total Stock Value</div>
            <div class="mono" style="font-size:1.15rem;font-weight:700;margin-block-start:0.25rem;" data-uom-val>&#8358;72,200.00</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section section-bordered content-deferred">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div class="ims-grid" data-stagger-group data-animate-in>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.7rem;">
        ${icon('excel-parser', 22, { drawn: true })}
        <h3>Market Excel Import &amp; Review</h3>
        <p style="font-size:0.92rem;">Import weekly buyer market spreadsheets directly—no internet needed. Highlights sudden price jumps, unit mix-ups, and total mismatches for storekeeper confirmation before stock updates.</p>
      </article>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.7rem;">
        ${icon('uom-scale', 22, { drawn: true })}
        <h3>Departments &amp; Protein Control</h3>
        <p style="font-size:0.92rem;">Track Kitchen, F&amp;B Bar, and Housekeeping cleanly in one place while separating high-value Protein items cleanly on Weekly Stock Sheets and purchasing lists.</p>
      </article>
      <article class="card icon-trigger" data-stagger-item style="display:grid;gap:0.7rem;">
        ${icon('shield-audit', 22, { drawn: true })}
        <h3>Blocks Over-Issuing Automatically</h3>
        <p style="font-size:0.92rem;">Every collection captures both collector and storekeeper sign-off, prevents issuing more stock than exists on the shelf, and tracks returnable trays and equipment.</p>
      </article>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:1.5rem;">
      ${appWindowFrame({ baseName: 'ims-inventory', title: 'Hosila IMS · Department Stock Catalog', alt: 'Hosila IMS Inventory Catalog' })}
      ${appWindowFrame({ baseName: 'ims-procurement', title: 'Hosila IMS · Market Purchasing & Restock', alt: 'Hosila IMS Purchasing and Excel Import' })}
    </div>
  </div>
</section>`;

  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Hosila IMS',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Windows 10, Windows 11',
      softwareVersion: ver,
      downloadUrl: `${SITE_URL}${dl}`,
      description: 'Hospitality inventory and central store software for kitchens, bars, and hotels—with crate-to-bottle conversions, weighted stock valuation, and market Excel import.',
      offers: {
        '@type': 'Offer',
        price: '20000',
        priceCurrency: 'NGN',
        url: `${SITE_URL}/pricing`,
      },
    },
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Hosila IMS', path: '/products/ims' },
    ]),
  ];

  writeOut(
    'products/ims/index.html',
    renderHtmlDocument({
      title: 'Hosila IMS — Kitchen, Bar & Central Store Inventory Software',
      description:
        'Control kitchen, bar, and central store inventory offline. Convert crates to bottles automatically, verify market Excel lists, and track exact stock value.',
      canonicalPath: '/products/ims',
      schemas,
      pageScripts: ['/js/ims-sandbox.js'],
      bodyHtml,
    })
  );
}

function buildPosPage() {
  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2.5rem;max-inline-size:52rem;">
    <div style="display:grid;gap:1rem;">
      <div style="display:flex;gap:0.6rem;align-items:center;">
        <span class="badge">Coming Soon</span>
        <span class="badge">Standalone Restaurant, Bar &amp; Retail POS</span>
      </div>
      <h1 class="display-xl" style="font-size:clamp(2.2rem,4.4vw,3.5rem);">Hosila POS for independent restaurants, bars, and retail.</h1>
      <p style="font-size:1.08rem;color:var(--ink-80);">While <strong>Hosila PMS</strong> includes a built-in restaurant module specifically for hotel dining and guest room bills, <strong>Hosila POS</strong> is designed as a standalone sales system for restaurants, lounges, and stores without hotel rooms.</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;">
      <div class="card icon-trigger" style="display:grid;gap:0.6rem;">
        ${icon('pos-terminal', 22, { drawn: true })}
        <h3>Fast Counter &amp; Table Orders</h3>
        <p style="font-size:0.92rem;">Quick order entry, open bar tabs, split payments across cash, card, and transfer, plus clean kitchen order tickets.</p>
      </div>
      <div class="card icon-trigger" style="display:grid;gap:0.6rem;">
        ${icon('offline-db', 22, { drawn: true })}
        <h3>Runs Smoothly Offline</h3>
        <p style="font-size:0.92rem;">Your counter stays fast during peak Friday service even when internet drops.</p>
      </div>
      <div class="card icon-trigger" style="display:grid;gap:0.6rem;">
        ${icon('key-ed25519', 22, { drawn: true })}
        <h3>Simple Single-Store Licensing</h3>
        <p style="font-size:0.92rem;">Clear annual or lifetime options with no hidden percentage fees on your daily sales.</p>
      </div>
    </div>

    <div class="card" style="display:grid;gap:1.25rem;">
      <div>
        <h2 class="heading-md">Join the Hosila POS early-access list</h2>
        <p style="font-size:0.92rem;margin-block-start:0.25rem;">Be the first to know when Hosila POS opens for hospitality venues.</p>
      </div>
      <form id="pos-waitlist-form" style="display:grid;gap:1rem;" novalidate>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem;">
          <div class="field">
            <label for="wl-email">Work Email *</label>
            <span id="wl-email-hint" class="field-hint">Format: owner@venue.com</span>
            <input id="wl-email" name="email" type="email" required autocomplete="email" class="input" aria-describedby="wl-email-hint" data-error="wl-email-error" placeholder="you@business.com" />
            <div id="wl-email-error" class="error-msg">Enter a valid email address such as you@business.com.</div>
          </div>
          <div class="field">
            <label for="wl-biz">Business / Venue Name</label>
            <span class="field-hint">Optional</span>
            <input id="wl-biz" name="businessName" type="text" class="input" placeholder="e.g. Palms Lounge &amp; Grill" />
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap;">
          <button type="submit" class="btn btn-primary">Notify Me at Launch</button>
          <span id="wl-status" role="status" aria-live="polite" style="font-size:0.88rem;font-weight:600;color:var(--color-accent-ink);"></span>
        </div>
      </form>
    </div>
  </div>
</section>`;

  const schemas = [
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Hosila POS', path: '/products/pos' },
    ]),
  ];

  writeOut(
    'products/pos/index.html',
    renderHtmlDocument({
      title: 'Hosila POS — Standalone Restaurant, Bar & Retail Point of Sale',
      description: 'Upcoming standalone point-of-sale software from Hosila for independent restaurants, bars, lounges, and retail venues.',
      canonicalPath: '/products/pos',
      schemas,
      pageScripts: ['/js/pos-waitlist.js'],
      bodyHtml,
    })
  );
}

function buildComparePage() {
  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div style="max-inline-size:44rem;display:grid;gap:0.75rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Product Comparison</span></div>
      <h1 class="display-xl" style="font-size:clamp(2.1rem,4.2vw,3.4rem);">Choose the right Hosila application for your business.</h1>
      <p style="font-size:1.08rem;color:var(--ink-80);">Each Hosila product is purpose-built for a specific job—so your front desk, kitchen store, and restaurant counter stay fast and uncluttered.</p>
    </div>
    <div tabindex="0" role="region" aria-labelledby="compare-caption" class="table-wrapper">
      <table class="compare-table">
        <caption id="compare-caption">Hosila Product Capability Comparison</caption>
        <thead>
          <tr>
            <th scope="col">Capability</th>
            <th scope="col"><span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('hotel-pms', 16)}Hosila PMS</span></th>
            <th scope="col"><span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('cube-ims', 16)}Hosila IMS</span></th>
            <th scope="col"><span style="display:inline-flex;align-items:center;gap:0.4rem;">${icon('pos-terminal', 16)}Hosila POS <span class="badge" style="margin-inline-start:0.25rem;">Coming Soon</span></span></th>
          </tr>
        </thead>
        <tbody>
          <tr><th scope="row">Hotel rooms, check-ins &amp; guest bills</th><td><span class="badge badge-mint">Included</span></td><td style="color:var(--ink-45);">&#8212;</td><td style="color:var(--ink-45);">&#8212;</td></tr>
          <tr><th scope="row">Central store &amp; kitchen stock control</th><td style="color:var(--ink-45);">&#8212;</td><td><span class="badge badge-mint">Included</span></td><td style="color:var(--ink-45);">&#8212;</td></tr>
          <tr>
            <th scope="row">Restaurant &amp; bar billing</th>
            <td><div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.45rem;"><span class="badge badge-mint">Included</span><span style="font-size:0.84rem;color:var(--ink-65);">Hotel dining &amp; room posting</span></div></td>
            <td style="color:var(--ink-45);">&#8212;</td>
            <td><span class="badge">Planned</span></td>
          </tr>
          <tr><th scope="row">Market list &amp; supplier receiving</th><td style="color:var(--ink-45);">&#8212;</td><td><span class="badge badge-mint">Included</span></td><td><span class="badge">Planned</span></td></tr>
          <tr><th scope="row">Standalone counter &amp; retail sales</th><td style="color:var(--ink-45);">&#8212;</td><td style="color:var(--ink-45);">&#8212;</td><td><span class="badge">Planned</span></td></tr>
          <tr>
            <th scope="row">Runs without internet</th>
            <td><div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.45rem;"><span class="badge badge-mint">Included</span><span style="font-size:0.84rem;color:var(--ink-65);">Main reception PC + property Wi-Fi</span></div></td>
            <td><div style="display:flex;flex-wrap:wrap;align-items:center;gap:0.45rem;"><span class="badge badge-mint">Included</span><span style="font-size:0.84rem;color:var(--ink-65);">Single store computer</span></div></td>
            <td><span class="badge">Planned</span></td>
          </tr>
        </tbody>
      </table>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:1rem;">
      <a href="/products/pms" class="card card-interactive icon-trigger" style="display:grid;gap:0.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">${icon('hotel-pms', 22, { drawn: true })}${icon('arrow-right', 16)}</div>
        <h3>Choose Hosila PMS if...</h3>
        <p style="font-size:0.92rem;">You run a hotel, resort, or guest house needing room management, booking charts, guest bills, hotel dining, and daily accounting across desks.</p>
      </a>
      <a href="/products/ims" class="card card-interactive icon-trigger" style="display:grid;gap:0.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">${icon('cube-ims', 22, { drawn: true })}${icon('arrow-right', 16)}</div>
        <h3>Choose Hosila IMS if...</h3>
        <p style="font-size:0.92rem;">You want strict storehouse control, crate-to-bottle unit conversions, department stock issues, and accurate weekly stock valuation reports.</p>
      </a>
      <a href="/products/pos" class="card card-interactive icon-trigger" style="display:grid;gap:0.6rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;">${icon('pos-terminal', 22, { drawn: true })}${icon('arrow-right', 16)}</div>
        <h3>Follow Hosila POS if...</h3>
        <p style="font-size:0.92rem;">You operate a standalone restaurant, bar, lounge, or retail shop without hotel rooms and want fast counter billing.</p>
      </a>
    </div>
  </div>
</section>`;

  writeOut(
    'products/compare/index.html',
    renderHtmlDocument({
      title: 'Compare Hosila Products — PMS, IMS & POS',
      description: 'Compare capabilities across Hosila PMS for hotels, Hosila IMS for stores and kitchens, and upcoming Hosila POS.',
      canonicalPath: '/products/compare',
      schemas: [
        breadcrumbSchema([
          { name: 'Home', path: '/' },
          { name: 'Compare Products', path: '/products/compare' },
        ]),
      ],
      bodyHtml,
    })
  );
}

function downloadCardHtml(rel, productHref) {
  const d = rel.data;
  const iconName = d.product === 'hosila-pms' ? 'hotel-pms' : 'cube-ims';
  return `<article class="card" style="display:grid;gap:1.15rem;align-content:start;">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:1rem;">
    <div style="display:flex;align-items:center;gap:0.75rem;">
      <div class="icon-frame" style="padding:0.65rem;">${icon(iconName, 24, { drawn: true })}</div>
      <div>
        <h2 class="heading-md">${escHtml(d.productLabel)}</h2>
        <div class="mono" style="font-size:0.84rem;color:var(--ink-65);">Version ${escHtml(d.version)} · ${escHtml(d.publishedAt)}</div>
      </div>
    </div>
    <span class="badge badge-mint">Windows</span>
  </div>
  <p style="font-size:0.95rem;">${escHtml(d.summary)}</p>
  <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
    <a href="${escHtml(d.downloadUrl)}" class="btn btn-primary icon-trigger">${icon('download-tray', 17)}<span>Download for Windows</span></a>
    <a href="${escHtml(productHref)}" class="btn btn-secondary">Features</a>
  </div>
</article>`;
}

function buildDownloadsPage(pmsRel, imsRel, allReleases) {
  const archiveRows = allReleases
    .map(
      (r) => `<tr>
  <th scope="row">${escHtml(r.data.productLabel)}</th>
  <td class="mono">v${escHtml(r.data.version)}</td>
  <td class="mono">${escHtml(r.data.publishedAt)}</td>
  <td style="color:var(--ink-80);">${escHtml(r.data.summary)}</td>
  <td><a href="/releases#${escHtml(r.id)}" class="btn btn-secondary btn-sm">Details</a></td>
</tr>`
    )
    .join('\n');

  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2.25rem;">
    <div style="max-inline-size:40rem;display:grid;gap:0.75rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Downloads</span></div>
      <h1 class="display-xl" style="font-size:clamp(2.1rem,4.2vw,3.4rem);">Download Hosila for Windows</h1>
      <p style="font-size:1.06rem;color:var(--ink-80);">Includes a 14-day free trial. Compatible with Windows 10 and Windows 11.</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,21rem),1fr));gap:1.5rem;">
      ${pmsRel ? downloadCardHtml(pmsRel, '/products/pms') : ''}
      ${imsRel ? downloadCardHtml(imsRel, '/products/ims') : ''}
    </div>

    <div class="card card-mint-edge" style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1.25rem;background-color:var(--mint-12);">
      <div style="display:grid;gap:0.3rem;max-inline-size:36rem;">
        <h2 class="heading-md">Ready to activate your license?</h2>
        <p style="font-size:0.94rem;color:var(--ink-80);">Message Hosila Sales on WhatsApp (<strong>09063814659</strong>) or email <strong>Hosilateam@gmail.com</strong>.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
        <a href="/contact?intent=license" class="btn btn-primary icon-trigger">${icon('whatsapp', 17)}<span>Message Sales on WhatsApp</span></a>
        <a href="mailto:Hosilateam@gmail.com?subject=Hosila%20License%20Request" class="btn btn-secondary icon-trigger">${icon('mail', 16)}<span>Email Sales</span></a>
      </div>
    </div>

    <div class="card" style="display:grid;gap:1.25rem;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1rem;">
        <div>
          <h2 class="heading-md">Version History</h2>
          <p style="font-size:0.9rem;">See what was added or improved in recent Hosila releases.</p>
        </div>
        <a href="/releases" class="btn btn-secondary btn-sm icon-trigger">${icon('sparkles-release', 15)}<span>All Updates</span></a>
      </div>
      <div class="table-wrapper">
        <table class="compare-table releases-archive-table" style="font-size:0.88rem;">
          <caption class="visually-hidden">Recent Hosila releases</caption>
          <thead>
            <tr>
              <th scope="col">Application</th>
              <th scope="col">Version</th>
              <th scope="col">Released</th>
              <th scope="col">Summary</th>
              <th scope="col">Updates</th>
            </tr>
          </thead>
          <tbody>${archiveRows}</tbody>
        </table>
      </div>
    </div>
  </div>
</section>`;

  writeOut(
    'downloads/index.html',
    renderHtmlDocument({
      title: 'Download Hosila for Windows — Hosila PMS & Hosila IMS',
      description: 'Download official Windows installers for Hosila PMS (hotels and resorts) and Hosila IMS (central kitchens and hospitality stores).',
      canonicalPath: '/downloads',
      schemas: [
        breadcrumbSchema([
          { name: 'Home', path: '/' },
          { name: 'Downloads', path: '/downloads' },
        ]),
      ],
      pageScripts: ['/js/downloads.js'],
      bodyHtml,
    })
  );
}

function buildReleasesPage(allReleases) {
  const articles = allReleases
    .map(
      (entry) => `<article id="${escHtml(entry.id)}" class="card release-row" data-rel-product="${escHtml(entry.data.product)}">
  <aside class="release-rail">
    <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
      <span class="badge badge-mint mono">Version ${escHtml(entry.data.version)}</span>
    </div>
    <div style="font-weight:700;font-size:1.05rem;color:var(--color-ink);margin-block-start:0.5rem;">${escHtml(entry.data.productLabel)}</div>
    <div class="mono" style="font-size:0.84rem;color:var(--ink-65);margin-block-start:0.15rem;">${escHtml(entry.data.publishedAt)}</div>
    <a href="${escHtml(entry.data.downloadUrl)}" class="btn btn-secondary btn-sm icon-trigger" style="margin-block-start:0.9rem;justify-self:start;">
      ${icon('download-tray', 14)}<span>Download Update</span>
    </a>
  </aside>
  <div class="release-body">
    <p style="font-size:1.04rem;color:var(--color-ink);font-weight:600;">${escHtml(entry.data.summary)}</p>
    <div class="release-markdown">${entry.bodyHtml}</div>
  </div>
</article>`
    )
    .join('\n');

  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:1.5rem;">
      <div style="max-inline-size:42rem;display:grid;gap:0.75rem;">
        <div class="eyebrow"><span class="accent-dot"></span><span>Product Updates</span></div>
        <h1 class="display-xl" style="font-size:clamp(2.1rem,4.2vw,3.4rem);">What&rsquo;s New in Hosila</h1>
        <p style="font-size:1.08rem;color:var(--ink-80);">New hospitality workflows, clearer reports, and everyday improvements across Hosila PMS and Hosila IMS.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
        <div class="segmented" role="tablist" aria-label="Filter updates by product">
          <button type="button" class="segmented-btn is-active" data-rel-filter="all">All</button>
          <button type="button" class="segmented-btn" data-rel-filter="hosila-pms">Hosila PMS</button>
          <button type="button" class="segmented-btn" data-rel-filter="hosila-ims">Hosila IMS</button>
        </div>
        <a href="/releases/rss.xml" class="btn btn-secondary btn-sm">Update Feed</a>
      </div>
    </div>
    <div style="display:grid;gap:2rem;">${articles}</div>
  </div>
</section>`;

  writeOut(
    'releases/index.html',
    renderHtmlDocument({
      title: "What's New & Product Updates — Hosila Software",
      description: 'New features, improvements, and product updates for Hosila PMS and Hosila IMS.',
      canonicalPath: '/releases',
      schemas: [
        breadcrumbSchema([
          { name: 'Home', path: '/' },
          { name: 'Updates', path: '/releases' },
        ]),
      ],
      pageScripts: ['/js/releases.js'],
      bodyHtml,
    })
  );
}

function buildPricingPage() {
  const pms = COMMERCIAL_CATALOG['hosila-pms'];
  const ims = COMMERCIAL_CATALOG['hosila-ims'];
  const terms = ['monthly', 'yearly', 'lifetime'];

  const termButtons = terms
    .map(
      (t) =>
        `<button type="button" class="${t === 'yearly' ? 'is-active' : ''}" data-term-btn="${t}" aria-pressed="${t === 'yearly' ? 'true' : 'false'}">${escHtml(pms.terms[t].label)}</button>`
    )
    .join('\n          ');

  const cards = [pms, ims]
    .map((plan, idx) => {
      const featureList =
        plan.product === 'hosila-pms'
          ? `<li>Front Desk, Interactive Room Board, Booking Chart &amp; Split Folios</li>
            <li>Built-in Hotel Restaurant &amp; Bar Billing with Room Posting</li>
            <li>Night Audit, Daily Cash Handover &amp; Accounts Reports</li>
            <li>Connect front desk, bar &amp; office staff over your hotel Wi-Fi</li>`
          : `<li>Automatic crate, bag, pack &amp; single-bottle unit conversions</li>
            <li>Weighted stock valuation updated automatically on every delivery</li>
            <li>Signed department stock issues &amp; returnable item tracking</li>
            <li>Import &amp; check market Excel lists before updating store balances</li>`;

      return `<article class="card ${idx === 0 ? 'card-mint-edge' : ''}" style="display:flex;flex-direction:column;justify-content:space-between;gap:1.5rem;">
  <div style="display:grid;gap:0.9rem;">
    <div style="display:flex;justify-content:space-between;align-items:center;gap:0.75rem;">
      <div style="display:inline-flex;align-items:center;gap:0.65rem;">
        <span class="icon-frame">${icon(plan.product === 'hosila-pms' ? 'hotel-pms' : 'cube-ims', 20)}</span>
        <h2 class="heading-md">${escHtml(plan.name)}</h2>
      </div>
      <span class="badge badge-mint">100% Full Access</span>
    </div>
    <p style="font-size:0.95rem;">${escHtml(plan.tagline)}</p>
    <div style="padding-block:0.85rem;border-block:1px solid var(--ink-08);display:flex;align-items:baseline;justify-content:space-between;gap:1rem;flex-wrap:wrap;">
      <div>
        <span class="mono display-xl" style="font-size:2.15rem;" data-price-display="${plan.product}" data-ngn-monthly="${escHtml(formatMoneyAmount(plan.terms.monthly.ngn, 'NGN'))}" data-ngn-yearly="${escHtml(formatMoneyAmount(plan.terms.yearly.ngn, 'NGN'))}" data-ngn-lifetime="${escHtml(formatMoneyAmount(plan.terms.lifetime.ngn, 'NGN'))}" data-usd-monthly="${escHtml(formatMoneyAmount(plan.terms.monthly.usd, 'USD'))}" data-usd-yearly="${escHtml(formatMoneyAmount(plan.terms.yearly.usd, 'USD'))}" data-usd-lifetime="${escHtml(formatMoneyAmount(plan.terms.lifetime.usd, 'USD'))}">${escHtml(formatMoneyAmount(plan.terms.yearly.ngn, 'NGN'))}</span>
        <span class="mono" style="font-size:0.84rem;font-weight:600;color:var(--ink-65);margin-inline-start:0.35rem;" data-term-suffix="${plan.product}">/ year</span>
      </div>
      <span class="badge" data-term-note="${plan.product}">${escHtml(plan.terms.yearly.note)}</span>
    </div>
    <p style="font-size:0.88rem;color:var(--ink-80);font-weight:500;">${escHtml(plan.architectureNote)}</p>
    <ul style="margin:0;padding-inline-start:1.15rem;display:grid;gap:0.45rem;font-size:0.92rem;color:var(--ink-80);">${featureList}</ul>
  </div>
  <div style="display:flex;flex-wrap:wrap;gap:0.65rem;">
    <a href="/contact?product=${plan.product}&amp;term=yearly&amp;intent=license" class="btn btn-primary icon-trigger" data-whatsapp-buy="${plan.product}" style="flex:1;justify-content:center;">${icon('whatsapp', 16)}<span>Pay &amp; Get License via WhatsApp</span></a>
    <a href="/downloads" class="btn btn-secondary btn-sm">Download Free Trial</a>
  </div>
</article>`;
    })
    .join('\n');

  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2.25rem;">
    <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:flex-end;gap:1.5rem;">
      <div style="max-inline-size:42rem;display:grid;gap:0.75rem;">
        <div class="eyebrow"><span class="accent-dot"></span><span>Simple Pricing</span></div>
        <h1 class="display-xl" style="font-size:clamp(2.1rem,4.2vw,3.35rem);">Pay for the product you run. Zero per-staff fees.</h1>
        <p style="font-size:1.08rem;color:var(--ink-80);">Download and test free for 14 days, then contact our sales team to pay and receive your official offline license key. Every plan unlocks <strong>100% of every feature</strong>.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;">
        <div class="segmented" role="group" aria-label="Currency selector">
          <button type="button" class="is-active" data-currency-btn="NGN" aria-pressed="true">NGN (&#8358;)</button>
          <button type="button" data-currency-btn="USD" aria-pressed="false">USD ($)</button>
        </div>
        <div class="segmented" role="group" aria-label="Billing term selector">${termButtons}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,20rem),1fr));gap:1.5rem;align-items:stretch;">${cards}</div>

    <div class="card card-elevated" style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:1.5rem;">
      <div style="display:grid;gap:0.35rem;max-inline-size:36rem;">
        <div class="eyebrow"><span class="accent-dot"></span><span>Sales &amp; Support</span></div>
        <h2 class="heading-md">Ready to get licensed?</h2>
        <p style="font-size:0.95rem;">Message us on WhatsApp (<strong>09063814659</strong>) or email <strong>Hosilateam@gmail.com</strong>.</p>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:0.75rem;">
        <a href="/contact?intent=license" class="btn btn-primary btn-lg icon-trigger">${icon('whatsapp', 17)}<span>Open Sales Form</span></a>
        <a href="mailto:Hosilateam@gmail.com?subject=Hosila%20Pricing%20Inquiry" class="btn btn-secondary btn-lg icon-trigger">${icon('mail', 17)}<span>Hosilateam@gmail.com</span></a>
      </div>
    </div>
  </div>
</section>`;

  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: 'Hosila Software Licenses',
      description: 'Straightforward property and store licenses for Hosila PMS and Hosila IMS with full feature access and no per-staff fees.',
      offers: {
        '@type': 'AggregateOffer',
        priceCurrency: 'NGN',
        lowPrice: '20000',
        highPrice: '950000',
        offerCount: 6,
      },
    },
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Pricing', path: '/pricing' },
    ]),
  ];

  writeOut(
    'pricing/index.html',
    renderHtmlDocument({
      title: 'Pricing & Plans — Hosila PMS & Hosila IMS',
      description: 'Transparent pricing for Hosila PMS and Hosila IMS. Download free for 14 days, then contact Hosila Sales on WhatsApp or email to pay and activate.',
      canonicalPath: '/pricing',
      schemas,
      pageScripts: ['/js/pricing.js'],
      bodyHtml,
    })
  );
}

function buildContactPage() {
  const bodyHtml = `<section class="section">
  <div class="container" style="display:grid;gap:2rem;max-inline-size:62rem;">
    <div style="display:grid;gap:0.65rem;max-inline-size:40rem;">
      <div class="eyebrow"><span class="accent-dot"></span><span>Sales &amp; Support</span></div>
      <h1 class="display-xl" style="font-size:clamp(2rem,4vw,3.2rem);">Contact Hosila Sales</h1>
      <p style="font-size:1.06rem;color:var(--ink-80);">Message us on WhatsApp or email to pay for a license, request support, or book a demo.</p>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,17rem),1fr));gap:1rem;">
      <a href="https://wa.me/2349063814659" target="_blank" rel="noopener noreferrer" class="card card-interactive icon-trigger" style="display:flex;align-items:flex-start;gap:0.9rem;">
        <span class="icon-frame" style="padding:0.65rem;">${icon('whatsapp', 22)}</span>
        <div style="display:grid;gap:0.2rem;">
          <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-accent-ink);">Sales WhatsApp</div>
          <div class="mono" style="font-size:1.1rem;font-weight:700;color:var(--color-ink);">09063814659</div>
          <div style="font-size:0.88rem;color:var(--ink-65);">Fastest way to pay for a license or ask for support.</div>
        </div>
      </a>
      <a href="mailto:Hosilateam@gmail.com" class="card card-interactive icon-trigger" style="display:flex;align-items:flex-start;gap:0.9rem;">
        <span class="icon-frame" style="padding:0.65rem;">${icon('mail', 22)}</span>
        <div style="display:grid;gap:0.2rem;">
          <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-accent-ink);">Sales Email</div>
          <div style="font-size:1.05rem;font-weight:700;color:var(--color-ink);word-break:break-word;">Hosilateam@gmail.com</div>
          <div style="font-size:0.88rem;color:var(--ink-65);">Send invoices, multi-property requests, or inquiries.</div>
        </div>
      </a>
    </div>

    <div class="card card-elevated" style="display:grid;gap:1.5rem;">
      <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:0.75rem;">
        <div>
          <h2 class="heading-md">Send a Pre-filled WhatsApp Message</h2>
          <p style="font-size:0.92rem;margin-block-start:0.2rem;">Complete the fields below and jump straight into WhatsApp DM with all your details ready.</p>
        </div>
        <span class="badge badge-mint">Instant WhatsApp DM</span>
      </div>

      <form id="contact-whatsapp-form" novalidate style="display:grid;gap:1.15rem;">
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:1rem;">
          <div class="form-field">
            <label for="ct-name">Your Full Name *</label>
            <input id="ct-name" name="name" type="text" class="input" autocomplete="name" placeholder="e.g. Chinedu Okafor" required />
            <span id="ct-name-err" data-error class="field-error" hidden>Please enter your full name.</span>
          </div>
          <div class="form-field">
            <label for="ct-business">Hotel, Restaurant or Store Name *</label>
            <input id="ct-business" name="business" type="text" class="input" autocomplete="organization" placeholder="e.g. De Palms Boutique Hotel" required />
            <span id="ct-business-err" data-error class="field-error" hidden>Please enter your hotel, restaurant, or store name.</span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:1rem;">
          <div class="form-field">
            <label for="ct-product">Which Hosila App Are You Interested In? *</label>
            <select id="ct-product" name="product" class="input" required>
              <option value="hosila-pms">Hosila PMS (Hotels &amp; Resorts)</option>
              <option value="hosila-ims">Hosila IMS (Central Stores &amp; Kitchens)</option>
              <option value="both">Both Hosila PMS &amp; Hosila IMS</option>
              <option value="hosila-pos">Hosila POS (Early Access)</option>
            </select>
          </div>
          <div class="form-field">
            <label for="ct-intent">How Can We Help You? *</label>
            <select id="ct-intent" name="intent" class="input" required>
              <option value="license">Pay for a License &amp; Activate</option>
              <option value="support">Ask for Support / Help</option>
              <option value="demo">Book a Demo or Setup Guidance</option>
              <option value="transfer">Move License to a New Computer</option>
              <option value="other">General Inquiry</option>
            </select>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15rem),1fr));gap:1rem;">
          <div id="ct-plan-field" class="form-field">
            <label for="ct-plan">Preferred License Plan</label>
            <select id="ct-plan" name="plan" class="input">
              <option value="yearly" selected>Annual Plan (1 Year — Save 2 Months)</option>
              <option value="monthly">Monthly Plan (30 Days)</option>
              <option value="lifetime">Lifetime Plan (One-time)</option>
              <option value="undecided">Not sure yet — advise me</option>
            </select>
          </div>
          <div class="form-field">
            <label for="ct-machine">Computer Machine ID (Optional)</label>
            <input id="ct-machine" name="machineId" type="text" class="input mono" placeholder="e.g. HSLA-A1B2-C3D4-E5F6" />
            <span class="field-hint">Already installed Hosila? Paste the Machine ID shown on your Activation screen.</span>
          </div>
        </div>

        <div class="form-field">
          <label for="ct-note">Additional Details (Optional)</label>
          <textarea id="ct-note" name="note" rows="3" class="input" placeholder="Tell us your number of rooms, store departments, or any question you have..."></textarea>
        </div>

        <div style="display:flex;flex-wrap:wrap;gap:0.75rem;align-items:center;padding-block-start:0.5rem;border-block-start:1px solid var(--ink-08);">
          <button type="submit" id="ct-submit" class="btn btn-primary btn-lg icon-trigger">${icon('whatsapp', 18)}<span>Continue to WhatsApp Chat</span></button>
          <a id="ct-email-btn" href="mailto:Hosilateam@gmail.com" class="btn btn-secondary btn-lg icon-trigger">${icon('mail', 17)}<span>Send via Email Instead</span></a>
        </div>
      </form>

      <p id="ct-live-status" aria-live="polite" style="font-size:0.9rem;font-weight:600;color:var(--color-accent-ink);margin:0;min-block-size:1.25rem;"></p>

      <div id="ct-preview-box" hidden class="card-subtle" style="display:grid;gap:0.5rem;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-45);">Your Pre-filled WhatsApp Message</div>
        <pre id="ct-preview-text" class="mono" style="margin:0;white-space:pre-wrap;font-size:0.85rem;line-height:1.55;color:var(--color-ink);"></pre>
      </div>
    </div>
  </div>
</section>`;

  const schemas = [
    {
      '@context': 'https://schema.org',
      '@type': 'ContactPage',
      name: 'Contact Hosila Sales & Support',
      url: `${SITE_URL}/contact`,
      description: 'Contact Hosila Sales via WhatsApp (09063814659) or email (Hosilateam@gmail.com) to purchase a license, activate Hosila PMS or IMS, or request support.',
    },
    breadcrumbSchema([
      { name: 'Home', path: '/' },
      { name: 'Contact Sales', path: '/contact' },
    ]),
  ];

  writeOut(
    'contact/index.html',
    renderHtmlDocument({
      title: 'Contact Sales & Support — Hosila Software',
      description: 'Message Hosila Sales on WhatsApp (09063814659) or email Hosilateam@gmail.com to pay for a license, request support, or book a setup demo.',
      canonicalPath: '/contact',
      schemas,
      pageScripts: ['/js/contact.js'],
      bodyHtml,
    })
  );
}

function build404Page() {
  const bodyHtml = `<section class="section">
  <div class="container" style="max-inline-size:38rem;display:grid;gap:1.1rem;text-align:center;justify-items:center;">
    <span class="badge mono">Page Not Found</span>
    <h1 class="display-xl" style="font-size:clamp(2.2rem,5vw,3.5rem);">We could not find that page</h1>
    <p>Choose where you would like to go next using the links below.</p>
    <div style="display:flex;flex-wrap:wrap;gap:0.75rem;justify-content:center;margin-block-start:0.5rem;">
      <a href="/" class="btn btn-primary">Return Home</a>
      <a href="/downloads" class="btn btn-secondary">Download Centre</a>
      <a href="/docs/" class="btn btn-secondary">User Guides</a>
    </div>
  </div>
</section>`;

  writeOut(
    '404.html',
    renderHtmlDocument({
      title: 'Page Not Found — Hosila Software',
      description: 'The requested page could not be found on hosila.com.',
      canonicalPath: '',
      robots: 'noindex, nofollow',
      bodyHtml,
    })
  );
}

function writeRssFeed(allReleases) {
  const items = allReleases
    .map(
      (r) => `    <item>
      <title>${escHtml(`${r.data.productLabel} v${r.data.version}`)}</title>
      <link>${SITE_URL}/releases#${escHtml(r.id)}</link>
      <guid isPermaLink="true">${SITE_URL}/releases#${escHtml(r.id)}</guid>
      <pubDate>${new Date(String(r.data.publishedAt)).toUTCString()}</pubDate>
      <description>${escHtml(r.data.summary)}</description>
    </item>`
    )
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Hosila Software — Product Updates</title>
    <link>${SITE_URL}/releases</link>
    <atom:link href="${SITE_URL}/releases/rss.xml" rel="self" type="application/rss+xml" />
    <description>New hospitality features and updates for Hosila PMS and Hosila IMS.</description>
    <language>en-us</language>
${items}
  </channel>
</rss>
`;
  writeOut('releases/rss.xml', xml);
}

function writeRobotsAndSitemap(latestDate) {
  const robots = `User-agent: *
Allow: /
Disallow: /api/

Sitemap: ${SITE_URL}/sitemap.xml
`;
  writeOut('robots.txt', robots);

  const entries = [
    { loc: `${SITE_URL}/`, priority: '1.0', changefreq: 'weekly', lastmod: latestDate },
    { loc: `${SITE_URL}/products/pms`, priority: '0.9', changefreq: 'monthly', lastmod: latestDate },
    { loc: `${SITE_URL}/products/ims`, priority: '0.9', changefreq: 'monthly', lastmod: latestDate },
    { loc: `${SITE_URL}/products/pos`, priority: '0.7', changefreq: 'monthly', lastmod: latestDate },
    { loc: `${SITE_URL}/products/compare`, priority: '0.85', changefreq: 'monthly', lastmod: latestDate },
    { loc: `${SITE_URL}/downloads`, priority: '0.9', changefreq: 'weekly', lastmod: latestDate },
    { loc: `${SITE_URL}/releases`, priority: '0.85', changefreq: 'weekly', lastmod: latestDate },
    { loc: `${SITE_URL}/pricing`, priority: '0.9', changefreq: 'monthly', lastmod: latestDate },
    { loc: `${SITE_URL}/contact`, priority: '0.85', changefreq: 'monthly', lastmod: latestDate },
  ];

  const docsDir = path.join(ROOT, 'docs');
  function walkDocs(dir) {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, item.name);
      if (item.isDirectory()) {
        walkDocs(abs);
      } else if (item.name === 'index.html') {
        const relDir = path.relative(ROOT, path.dirname(abs)).replace(/\\/g, '/');
        entries.push({
          loc: `${SITE_URL}/${relDir}/`,
          priority: relDir === 'docs' ? '0.85' : '0.75',
          changefreq: 'monthly',
          lastmod: fs.statSync(abs).mtime.toISOString().slice(0, 10),
        });
      }
    }
  }
  walkDocs(docsDir);

  const xmlUrls = entries
    .map(
      (e) => `  <url>
    <loc>${escHtml(e.loc)}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`
    )
    .join('\n');

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${xmlUrls}
</urlset>
`;
  writeOut('sitemap.xml', sitemap);
  return entries.length;
}

const allReleases = loadAllReleases();
const pmsRel = allReleases.find((r) => r.data.product === 'hosila-pms');
const imsRel = allReleases.find((r) => r.data.product === 'hosila-ims');
const latestDate = String(allReleases[0]?.data.publishedAt || new Date().toISOString().slice(0, 10));

buildHomepage(pmsRel, imsRel);
buildPmsPage(pmsRel);
buildImsPage(imsRel);
buildPosPage();
buildComparePage();
buildDownloadsPage(pmsRel, imsRel, allReleases);
buildReleasesPage(allReleases);
buildPricingPage();
buildContactPage();
build404Page();
writeRssFeed(allReleases);
const urlCount = writeRobotsAndSitemap(latestDate);

console.log(`Synced 10 HTML pages, RSS feed, robots.txt, and sitemap.xml (${urlCount} canonical URLs).`);
