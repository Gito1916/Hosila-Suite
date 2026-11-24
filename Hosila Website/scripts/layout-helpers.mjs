// Shared Vanilla HTML/SVG/SEO layout helpers for scripts/sync-site.mjs

export const SITE_URL = 'https://hosila.com';

const ICON_BODIES = {
  'hotel-pms': `<rect x="4" y="3" width="16" height="18" rx="2" data-draw /><path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h6" /><path d="M10 21v-3h4v3" stroke="var(--color-accent-ink)" />`,
  'cube-ims': `<path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" data-draw /><path d="M12 12v9M12 12l8-4.5M12 12 4 7.5" stroke="var(--color-accent-ink)" />`,
  'pos-terminal': `<rect x="4" y="4" width="16" height="10" rx="2" data-draw /><path d="M8 8h8M6 18h12l1 3H5l1-3Z" stroke="var(--color-accent-ink)" />`,
  'lan-sync': `<circle cx="12" cy="18" r="1.5" fill="var(--color-accent-ink)" stroke="none" /><path d="M8.5 14.5a5 5 0 0 1 7 0" class="wave-1" /><path d="M5 11a10 10 0 0 1 14 0" class="wave-2" /><path d="M2 7.5a14 14 0 0 1 20 0" class="wave-2" opacity="0.55" />`,
  'offline-db': `<ellipse cx="12" cy="6" rx="8" ry="3" data-draw /><path d="M4 6v6c0 1.66 3.58 3 8 3s8-1.34 8-3V6" class="db-ring-2" /><path d="M4 12v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" stroke="var(--color-accent-ink)" />`,
  'shield-audit': `<path d="M12 3 4 6.5v5.5c0 4.8 3.4 8.7 8 9.8 4.6-1.1 8-5 8-9.8V6.5L12 3Z" data-draw /><path d="m9 12 2 2 4-4" class="shield-check" stroke="var(--color-accent-ink)" />`,
  'key-ed25519': `<g class="key-body"><circle cx="8" cy="14" r="4.5" data-draw /><path d="m11.5 10.5 7.5-7.5M16 6l2.5 2.5M14 8l2 2" stroke="var(--color-accent-ink)" /></g>`,
  'excel-parser': `<rect x="4" y="3" width="16" height="18" rx="2.5" data-draw /><path d="M8 8h8" class="row-1" stroke="var(--color-accent-ink)" /><path d="M8 12h6" class="row-2" /><path d="M8 16h8" class="row-1" stroke="var(--color-accent-ink)" />`,
  'uom-scale': `<path d="M12 4v16M8 20h8" /><g class="scale-beam"><path d="M5 7h14" stroke="var(--color-accent-ink)" /><path d="m5 7-2 5h4L5 7ZM19 7l-2 5h4l-2-5Z" /></g>`,
  'room-board': `<rect x="3" y="4" width="8" height="7" rx="1.5" /><rect x="13" y="4" width="8" height="7" rx="1.5" /><rect x="3" y="13" width="8" height="7" rx="1.5" /><rect x="13" y="13" width="8" height="7" rx="1.5" /><path d="M5 6v3" class="bar-active" stroke="var(--color-accent-ink)" stroke-width="2.2" /><path d="M15 15v3" class="bar-active" stroke="var(--color-accent-ink)" stroke-width="2.2" />`,
  'tape-chart': `<rect x="3" y="4" width="18" height="16" rx="2" data-draw /><path d="M3 9h18" /><path d="M7 13h7" class="tape-bar" stroke="var(--color-accent-ink)" stroke-width="2.2" /><path d="M10 17h6" class="tape-bar" />`,
  'folio-split': `<rect x="4" y="3" width="16" height="18" rx="2" data-draw /><path d="M12 7v10" stroke="var(--color-accent-ink)" stroke-dasharray="2 2" /><path d="M7 9h3M7 13h3M14 9h3M14 13h3" />`,
  'restaurant-docket': `<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" data-draw /><path d="M9 8h6M9 12h6M9 16h3" stroke="var(--color-accent-ink)" />`,
  'night-audit': `<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" class="moon-body" stroke="var(--color-accent-ink)" />`,
  'lock-rbac': `<rect x="5" y="11" width="14" height="9" rx="2" data-draw /><path d="M8 11V7a4 4 0 0 1 8 0v4" class="lock-shackle" stroke="var(--color-accent-ink)" /><circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />`,
  'download-tray': `<g class="tray-arrow"><path d="M12 4v11" /><path d="m7.5 10.5 4.5 4.5 4.5-4.5" /></g><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />`,
  'sha-verified': `<path d="M12 3 4 7v5c0 5 3.5 9 8 10 4.5-1 8-5 8-10V7l-8-4Z" data-draw /><path d="m8.5 12.5 2.5 2.5 4.5-5" stroke="var(--color-accent-ink)" />`,
  'book-docs': `<path d="M4 5a2 2 0 0 1 2-2h5v16H6a2 2 0 0 0-2 2V5Z" /><path d="M20 5a2 2 0 0 0-2-2h-5v16h5a2 2 0 0 1 2 2V5Z" class="book-leaf" stroke="var(--color-accent-ink)" />`,
  'sparkles-release': `<path d="m12 3 1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8L12 3Z" class="spark-top" stroke="var(--color-accent-ink)" /><path d="m18.5 14 1 2.2 2.2 1-2.2 1-1 2.2-1-2.2-2.2-1 2.2-1 1-2.2Z" />`,
  'arrow-right': `<g class="arrow-shaft"><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></g>`,
  pause: `<path d="M9 5v14M15 5v14" />`,
  play: null,
  sun: `<circle cx="12" cy="12" r="4" stroke="var(--color-accent-ink)" /><g class="sun-rays"><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></g>`,
  moon: `<path d="M20.5 14.5A8.5 8.5 0 0 1 9.5 3.5a8.5 8.5 0 1 0 11 11Z" />`,
  menu: `<path d="M4 7h16M4 12h16M4 17h16" />`,
  close: `<path d="M6 6l12 12M18 6 6 18" />`,
  'check-circle': `<circle cx="12" cy="12" r="9" /><path d="m8.5 12.2 2.4 2.4 4.8-4.8" stroke="var(--color-accent-ink)" />`,
  'swap-pc': `<rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="m9 10 2-2 4 4" class="swap-arrows" stroke="var(--color-accent-ink)" />`,
  copy: `<rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />`,
  whatsapp: `<path d="M21 11.5a8.5 8.5 0 0 1-12.55 7.47L3 20.5l1.6-5.15A8.5 8.5 0 1 1 21 11.5Z" /><path d="M9.5 9.2c.2-.4.5-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.6c.1.2.1.5-.1.7l-.5.6c.5.9 1.3 1.7 2.2 2.2l.6-.5c.2-.2.5-.2.7-.1l1.6.7c.3.1.4.3.4.5v.5c0 .2 0 .5-.4.7-.5.3-1.4.5-2.6.1-1.6-.6-3.4-2.1-4.3-3.9-.6-1.2-.5-2.2 0-3Z" stroke="var(--color-accent-ink)" />`,
  mail: `<rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" stroke="var(--color-accent-ink)" />`,
};

export function icon(name, size = 20, { drawn = false } = {}) {
  let svg;
  if (name === 'play') {
    svg = `<svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5.5v13l11-6.5-11-6.5Z" /></svg>`;
  } else {
    svg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${ICON_BODIES[name] || ''}</svg>`;
  }
  return `<span class="hosila-icon${drawn ? ' icon-drawn' : ''}" data-name="${name}" style="width:${size}px;height:${size}px;" aria-hidden="true">${svg}</span>`;
}

export function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function appWindowFrame({ baseName, title, alt, eager = false, caption = '' }) {
  const dialogId = `dlg-${baseName.replace(/[^a-z0-9-]/gi, '-')}`;
  const loading = eager ? 'eager' : 'lazy';
  const fetchPri = eager ? ' fetchpriority="high"' : '';
  return `<div class="window-stage">
  <div class="app-window" data-perspective-card>
    <div class="window-chrome">
      <div class="window-dots" aria-hidden="true">
        <span class="window-dot"></span>
        <span class="window-dot"></span>
        <span class="window-dot"></span>
      </div>
      <div class="window-title">${escHtml(title)}</div>
      <button type="button" class="btn btn-ghost btn-sm" style="padding:0.25rem 0.55rem;font-size:0.78rem;font-weight:600;color:var(--ink-80);" data-open-dialog="${dialogId}" aria-label="Expand ${escHtml(title)} screenshot">Zoom</button>
    </div>
    <div class="window-viewport">
      <picture class="theme-img-light">
        <source type="image/webp" srcset="/mockups/${baseName}-light-1x.webp 1x, /mockups/${baseName}-light-2x.webp 2x" />
        <img src="/mockups/${baseName}-light-1x.webp" alt="${escHtml(alt)} (Light Mode)" width="1440" height="900" loading="${loading}"${fetchPri} />
      </picture>
      <picture class="theme-img-dark">
        <source type="image/webp" srcset="/mockups/${baseName}-dark-1x.webp 1x, /mockups/${baseName}-dark-2x.webp 2x" />
        <img src="/mockups/${baseName}-dark-1x.webp" alt="${escHtml(alt)} (Dark Mode)" width="1440" height="900" loading="${loading}"${fetchPri} />
      </picture>
    </div>
  </div>${caption ? `\n  <p style="font-size:0.875rem;margin-block-start:0.65rem;">${escHtml(caption)}</p>` : ''}
</div>
<dialog id="${dialogId}" class="hosila-dialog" closedby="any" aria-labelledby="${dialogId}-title">
  <div class="window-chrome">
    <span id="${dialogId}-title" class="window-title" style="font-weight:600;color:var(--color-ink);">${escHtml(title)}</span>
    <form method="dialog">
      <button type="submit" class="btn btn-secondary btn-sm" aria-label="Close preview">${icon('close', 14)}<span>Close</span></button>
    </form>
  </div>
  <div style="padding:0;background:var(--color-canvas);">
    <img src="/mockups/${baseName}-light-2x.webp" alt="${escHtml(alt)} (Light Mode Zoom)" width="2880" height="1800" loading="lazy" class="theme-img-light" style="inline-size:100%;block-size:auto;" />
    <img src="/mockups/${baseName}-dark-2x.webp" alt="${escHtml(alt)} (Dark Mode Zoom)" width="2880" height="1800" loading="lazy" class="theme-img-dark" style="inline-size:100%;block-size:auto;" />
  </div>
</dialog>`;
}

export function renderHeader(canonicalPath) {
  const navCurrent = (href) => {
    if (canonicalPath === '/' && href === '/') return ' aria-current="page"';
    if (href !== '/' && canonicalPath.startsWith(href)) return ' aria-current="page"';
    return '';
  };

  return `<header class="site-header is-wide" data-site-header>
  <div class="container header-inner" data-header-inner>
    <a href="/" class="brand-link" aria-label="Hosila home">
      <img src="/hosila-icon.svg" alt="" width="24" height="24" />
      <span><span class="brand-wordmark-accent">Hosila</span></span>
    </a>

    <nav class="site-nav" aria-label="Primary">
      <ul class="site-menu">
        <li class="nav-dropdown" data-nav-dropdown>
          <button class="dropdown-trigger" type="button" popovertarget="products-menu" aria-expanded="false" aria-controls="products-menu" data-dropdown-trigger>
            <span>Products</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          <ul id="products-menu" class="dropdown-list" popover="auto" data-dropdown-list>
            <li>
              <a href="/products/pms" class="dropdown-item icon-trigger">
                ${icon('hotel-pms', 20)}
                <div>
                  <div class="dropdown-item-title">Hosila PMS <span class="badge badge-mint">Available</span></div>
                  <div class="dropdown-item-desc">Front desk, reservations, guest bills &amp; hotel dining.</div>
                </div>
              </a>
            </li>
            <li>
              <a href="/products/ims" class="dropdown-item icon-trigger">
                ${icon('cube-ims', 20)}
                <div>
                  <div class="dropdown-item-title">Hosila IMS <span class="badge badge-mint">Available</span></div>
                  <div class="dropdown-item-desc">Kitchen, bar &amp; storehouse stock control.</div>
                </div>
              </a>
            </li>
            <li>
              <a href="/products/pos" class="dropdown-item icon-trigger">
                ${icon('pos-terminal', 20)}
                <div>
                  <div class="dropdown-item-title">Hosila POS <span class="badge">Coming Soon</span></div>
                  <div class="dropdown-item-desc">Standalone point-of-sale for restaurants, bars &amp; retail.</div>
                </div>
              </a>
            </li>
            <li style="border-block-start:1px solid var(--ink-08);padding-block-start:0.25rem;margin-block-start:0.15rem;">
              <a href="/products/compare" class="dropdown-item icon-trigger">
                ${icon('uom-scale', 20)}
                <div>
                  <div class="dropdown-item-title">Compare Products</div>
                  <div class="dropdown-item-desc">Find the right fit for your property or venue.</div>
                </div>
              </a>
            </li>
          </ul>
        </li>
        <li><a href="/downloads" class="nav-link"${navCurrent('/downloads')}>Downloads</a></li>
        <li><a href="/releases" class="nav-link"${navCurrent('/releases')}>Updates</a></li>
        <li><a href="/pricing" class="nav-link"${navCurrent('/pricing')}>Pricing</a></li>
        <li><a href="/contact" class="nav-link"${navCurrent('/contact')}>Contact Sales</a></li>
      </ul>
    </nav>

    <div class="header-actions">
      <button type="button" class="theme-toggle icon-trigger" data-theme-toggle aria-label="Toggle color theme" title="Switch dark or light theme">
        <span class="theme-icon-dark" aria-hidden="true">${icon('moon', 16)}</span>
        <span class="theme-icon-light" aria-hidden="true">${icon('sun', 16)}</span>
        <span class="theme-label-dark">Dark</span>
        <span class="theme-label-light">Light</span>
      </button>
      <a href="/downloads" class="btn btn-primary btn-sm icon-trigger header-download-cta">
        ${icon('download-tray', 15)}
        <span>Download</span>
      </a>
      <button id="drawer-open" class="btn btn-secondary btn-sm menu-button" type="button" aria-label="Open navigation menu" aria-expanded="false" aria-controls="mobile-drawer">
        ${icon('menu', 18)}
      </button>
    </div>
  </div>
</header>

<dialog class="Drawer" id="mobile-drawer" aria-label="Mobile navigation">
  <div class="Drawer-scroller" data-drawer-scroller>
    <nav class="Drawer-sheet" data-drawer-sheet aria-label="Mobile links">
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <a href="/" class="brand-link">
          <img src="/hosila-icon.svg" alt="" width="22" height="22" />
          <span><span class="brand-wordmark-accent">Hosila</span></span>
        </a>
        <button id="drawer-close" type="button" class="btn btn-ghost btn-sm" aria-label="Close menu" autofocus>${icon('close', 18)}</button>
      </div>
      <ul style="list-style:none;margin:0;padding:0;display:grid;gap:0.35rem;align-content:start;">
        <li><a href="/" class="nav-link" style="width:100%;"${navCurrent('/')}>Home</a></li>
        <li><a href="/products/pms" class="nav-link" style="width:100%;"${navCurrent('/products/pms')}>Hosila PMS</a></li>
        <li><a href="/products/ims" class="nav-link" style="width:100%;"${navCurrent('/products/ims')}>Hosila IMS</a></li>
        <li><a href="/products/pos" class="nav-link" style="width:100%;"${navCurrent('/products/pos')}>Hosila POS (Coming Soon)</a></li>
        <li><a href="/products/compare" class="nav-link" style="width:100%;"${navCurrent('/products/compare')}>Compare Products</a></li>
        <li><a href="/downloads" class="nav-link" style="width:100%;"${navCurrent('/downloads')}>Downloads</a></li>
        <li><a href="/releases" class="nav-link" style="width:100%;"${navCurrent('/releases')}>What&rsquo;s New</a></li>
        <li><a href="/pricing" class="nav-link" style="width:100%;"${navCurrent('/pricing')}>Pricing</a></li>
        <li><a href="/contact" class="nav-link" style="width:100%;"${navCurrent('/contact')}>Contact Sales</a></li>
      </ul>
      <div style="display:grid;gap:0.6rem;border-block-start:1px solid var(--ink-10);padding-block-start:1rem;">
        <a href="/downloads" class="btn btn-primary" style="width:100%;">Download for Windows</a>
        <a href="/contact" class="btn btn-secondary" style="width:100%;">Contact Sales on WhatsApp</a>
      </div>
    </nav>
  </div>
</dialog>`;
}

export function renderFooter() {
  const year = new Date().getFullYear();
  return `<footer class="site-footer">
  <div class="container" style="display:grid;gap:2.5rem;">
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:2rem;">
      <div style="display:grid;gap:0.85rem;align-content:start;">
        <a href="/" class="brand-link">
          <img src="/hosila-icon.svg" alt="" width="24" height="24" />
          <span><span class="brand-wordmark-accent">Hosila</span></span>
        </a>
        <p style="font-size:0.9rem;max-inline-size:21rem;">
          Calm, dependable operational software built for hotels, restaurants, central kitchens, and hospitality stores.
        </p>
        <div class="badge" style="justify-self:start;">
          <span class="accent-dot accent-dot-live"></span>
          <span>Works smoothly without internet</span>
        </div>
      </div>

      <div style="display:grid;gap:0.6rem;align-content:start;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-45);">Applications</div>
        <a href="/products/pms" class="nav-link" style="padding:0.2rem 0;">Hosila PMS</a>
        <a href="/products/ims" class="nav-link" style="padding:0.2rem 0;">Hosila IMS</a>
        <a href="/products/pos" class="nav-link" style="padding:0.2rem 0;">Hosila POS (Coming Soon)</a>
        <a href="/products/compare" class="nav-link" style="padding:0.2rem 0;">Compare Products</a>
      </div>

      <div style="display:grid;gap:0.6rem;align-content:start;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-45);">Resources</div>
        <a href="/downloads" class="nav-link" style="padding:0.2rem 0;">Downloads</a>
        <a href="/releases" class="nav-link" style="padding:0.2rem 0;">What&rsquo;s New</a>
        <a href="/releases/rss.xml" class="nav-link" style="padding:0.2rem 0;">Update Feed</a>
      </div>

      <div style="display:grid;gap:0.6rem;align-content:start;">
        <div style="font-size:0.8rem;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:var(--ink-45);">Sales &amp; Support</div>
        <a href="/pricing" class="nav-link" style="padding:0.2rem 0;">Pricing &amp; Plans</a>
        <a href="/contact" class="nav-link" style="padding:0.2rem 0;">Contact Sales Form</a>
        <a href="https://wa.me/2349063814659" target="_blank" rel="noopener noreferrer" class="nav-link" style="padding:0.2rem 0;">WhatsApp: 09063814659</a>
        <a href="mailto:Hosilateam@gmail.com" class="nav-link" style="padding:0.2rem 0;">Hosilateam@gmail.com</a>
      </div>
    </div>

    <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:1rem;border-block-start:1px solid var(--ink-08);padding-block-start:1.5rem;font-size:0.875rem;color:var(--ink-45);">
      <span>&copy; ${year} Hosila Software. Built for dependable daily hospitality operations.</span>
      <span style="display:inline-flex;align-items:center;gap:0.45rem;color:var(--ink-80);font-weight:600;">
        ${icon('sha-verified', 15)}
        <span>Hospitality Suite</span>
      </span>
    </div>
  </div>
</footer>`;
}

export function renderHtmlDocument({
  title,
  description,
  canonicalPath,
  robots = 'index, follow, max-image-preview:large',
  ogType = 'website',
  schemas = [],
  pageScripts = [],
  bodyHtml,
}) {
  const canonicalUrl = canonicalPath ? `${SITE_URL}${canonicalPath}` : '';
  const ldJson = schemas
    .map((obj) => `<script type="application/ld+json">\n${JSON.stringify(obj, null, 2)}\n</script>`)
    .join('\n    ');
  const scriptTags = [
    `<script type="module" src="/js/main.js"></script>`,
    ...pageScripts.map((src) => `<script type="module" src="${src}"></script>`),
  ].join('\n    ');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="dark" />
    <script>
      try {
        var saved = localStorage.getItem('color-scheme');
        if (saved === 'light' || saved === 'dark') {
          document.querySelector('meta[name="color-scheme"]').content = saved;
        }
        if (localStorage.getItem('hosila-motion') === 'paused') {
          document.documentElement.dataset.motion = 'paused';
        }
      } catch (e) {}
    </script>
    <title>${escHtml(title)}</title>
    <meta name="description" content="${escHtml(description)}" />
    <meta name="robots" content="${escHtml(robots)}" />
    ${canonicalUrl ? `<link rel="canonical" href="${canonicalUrl}" />` : ''}
    <meta property="og:site_name" content="Hosila Software" />
    <meta property="og:title" content="${escHtml(title)}" />
    <meta property="og:description" content="${escHtml(description)}" />
    <meta property="og:type" content="${ogType}" />
    ${canonicalUrl ? `<meta property="og:url" content="${canonicalUrl}" />` : ''}
    <meta property="og:image" content="${SITE_URL}/og-cover.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="Hosila Hospitality Software — Hotels, Restaurants &amp; Central Stores" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escHtml(title)}" />
    <meta name="twitter:description" content="${escHtml(description)}" />
    <meta name="twitter:image" content="${SITE_URL}/og-cover.png" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="apple-touch-icon" href="/favicon.png" />
    <link rel="alternate" type="application/rss+xml" title="Hosila Product Updates" href="/releases/rss.xml" />
    <link rel="sitemap" type="application/xml" title="Sitemap" href="/sitemap.xml" />
    <link rel="preload" href="/fonts/plus-jakarta-sans-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/plus-jakarta-sans-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/plus-jakarta-sans-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="preload" href="/fonts/ibm-plex-mono-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/css/tokens.css" />
    <link rel="stylesheet" href="/css/base.css" />
    <link rel="stylesheet" href="/css/components.css" />
    <link rel="stylesheet" href="/css/animated-icons.css" />
    ${ldJson}
  </head>
  <body>
    <a href="#main-content" class="visually-hidden">Skip to content</a>
    ${renderHeader(canonicalPath || '/')}
    <main id="main-content" style="padding-block-start: var(--header-height);">
      ${bodyHtml}
    </main>
    ${renderFooter()}
    ${scriptTags}
  </body>
</html>
`;
}
