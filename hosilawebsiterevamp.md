# Hosila Website Revamp — Architectural, Design & Product Masterplan (v2)

> **Status:** v2 Locked Implementation Specification (Post-Review Revisions Applied · No Application Code Written)  
> **Target Deliverable:** Ultra-modern, Linear × Raycast × Apple-caliber commercial software website (`\$100,000` agency execution standard)  
> **Core Stack:** Astro 5 (HTML / Vanilla CSS / Vanilla ES Modules) · GSAP + ScrollTrigger · Three.js (Hero Brand Emblem) · Astro Starlight (Docs) · Markdown Content Collections (Release Notes) · Serverless Ed25519 Licensing API  
> **Design Constitution:** `design.md` (Strict UI Constitution) + `apple-design` (WWDC Fluid Interfaces & Foundations) + `modern-web-guidance` (Modern Web Platform Standards)

---

## 1. Executive Vision & Brand Positioning

### 1.1 Positioning: *A Modern Software Company — Linear × Raycast × Apple Hardware*
Hosila's website must look and read like an **established, disciplined software company**—never a generic SaaS template and **never a "hotel management website" that happens to sell software**. Hotel management and inventory control are simply the first two vertical applications in a growing operational software suite.

- **Primary Hero Headline:** *"Business software. Without the complexity."*
- **Supporting Thesis:** *"Local-first operational software engineered for real businesses—running on your own hardware without cloud outages or unnecessary bloat. Built to stay fast under daily operational pressure."*
- **Emotional Target (`apple-design` §16 — Delight):** **Calm authority and mechanical precision.** Every pixel, hairline divider, spring curve, and tabular number signals that the company building the website builds reliable financial and operational software.

### 1.2 Brand Narrative ("One Software House, Independent Products")
Visitors must immediately understand Hosila as **one unified software brand shipping independent, commercial desktop and local-network applications**—with clear, non-overlapping boundaries between products:

| Product | Status | Positioning |
| --- | --- | --- |
| **Hosila PMS** | Production (`Hosila-PMS-Setup.exe`, 44.8 MB) | Hotel property management with an **integrated restaurant billing module**, reservations tape chart, guest folios, and double-entry accounting running on a Host PC + real-time LAN sync. |
| **Hosila IMS** | Production (`Hosila-IMS-Setup.exe`, 5.6 MB) | Dedicated **inventory, storehouse, and stock procurement** software built in Rust + Tauri 2 + SQLite FTS5 for single-PC local operation. |
| **Hosila POS** | Future (`hosila-pos`) | Dedicated **standalone sales and point-of-sale software** built for independent restaurants, bars, lounges, and retail businesses that do not manage hotel rooms. |

---

## 2. Forensic Audit of Current `Hosila Website` ("Everything That Is Wrong")

Inspection of `c:\Users\Administrator\Desktop\Hosila Suite\Hosila Website` reveals that the current directory is **not a public product website at all**—it is a deprecated cloud-SaaS React SPA prototype (`hotelflow@1.0.0` legacy) that actively blocks visitors and violates every rule in `design.md`, `apple-design`, and `modern-web-guidance`.

### 2.1 Fundamental Identity Crisis (Zero Public Marketing Presence)
- **Immediate Login Wall:** In `src/App.tsx` (lines 108–110, 191–243), unauthenticated visitors hitting `/` hit `ProtectedRoute` and are immediately redirected to `/login` (`src/pages/Login.tsx`: *"Sign in to your hotel"* + *"Hotel Code"*), preceded by a full-screen `Loader2` spinner while `supabase.auth.getSession()` resolves.
- **SPA Catch-All Routing:** `vercel.json` rewrites `/(.*)` to `/index.html`, meaning search engines and prospective buyers see nothing except a login prompt.
- **Zero Product Discovery or Downloads:** There are no landing pages for **Hosila PMS** or **Hosila IMS**, no documentation portal, no release notes, no online keygen/licensing flow, and no links to the real installers sitting in `c:\Users\Administrator\Desktop\Hosila Suite\Hosila Releases\` (`Hosila-PMS-Setup.exe` at 44.8 MB and `Hosila-IMS-Setup.exe` at 5.6 MB).

### 2.2 SEO, Metadata & Crawlability Collapse
- **Empty Root Shell (`index.html`):** Ships `<div id="root"></div>` with a single generic `<meta name="description" content="Hosila - Smart property management for modern hospitality" />`. Zero semantic `<main>`/`<article>` HTML, zero OpenGraph/Twitter cards, zero `SoftwareApplication` JSON-LD structured data, and no `sitemap.xml` or `robots.txt`.
- **Conflicting Theme Metadata:** `index.html` hardcodes `<meta name="theme-color" content="#16243D" />` (dark navy), while `vite.config.ts` declares `theme_color: '#21C29C'` and `background_color: '#0f172a'`.
- **Unnecessary Render-Blocking/External Script:** `index.html` line 10 loads `<script src="https://accounts.google.com/gsi/client" async defer></script>` on every page load for Google Identity Services, which has no place on a public product marketing site.

### 2.3 Architectural Obsolescence & Dead Legacy Baggage
- **Contradicts Hosila's Real Commercial Model:** `src/components/subscription/SubscriptionGate.tsx` and `src/hooks/useSubscription.ts` enforce deprecated cloud SaaS tiers (`Starter` capped at 15 rooms, `Pro`, `Enterprise`). By contrast, `Hosila Keygen/HOSILA_ACTIVATION_ENGINE_SPEC.md` defines Hosila's actual local `HSL1` activation engine: **every active license grants 100% Full Access with zero artificial feature paywalls or room caps** (final public pricing and trial terms will only be published in Phase 5 once the commercial model is locked).
- **60-Second Cold-Start Warning Banner:** `src/App.tsx` (lines 171–175) and `src/lib/apiClient.ts` (lines 39–89) ping a sleeping Render free-tier FastAPI backend and flash a blue banner: *"Connecting to server… This may take up to 60 seconds on first visit."* Nothing undermines software credibility faster than telling a first-time visitor your site takes 60 seconds to wake up.
- **Broken & Bloated `package.json`:** Declares `"main": "electron/main.js"` even though no `electron/` directory exists in `Hosila Website`, and pulls in `electron ^40.2.1`, `electron-builder`, `bcryptjs`, `@supabase/supabase-js`, `@tanstack/react-query`, `recharts`, and `motion`.
- **Legacy `"hotelflow"` Artifacts:** `lint.txt` reports `> hotelflow@1.0.0 lint`, and both `src/lib/apiClient.ts` (line 99) and `src/lib/supabase.ts` (line 22) read `localStorage.getItem('hotelflow-auth')`.
- **Aggressive PWA Service Worker Caching Hazard:** `vite.config.ts` uses `vite-plugin-pwa` (`workbox`) with `globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}']`. If the revamped website deploys to the same domain without a Service Worker cleanup script, returning visitors with the old SW installed will continue seeing the cached legacy login shell!
  - **Migration Fix Required:** Ship a tiny one-time `/sw.js` cleanup stub (or inline registration killer) on launch that calls `navigator.serviceWorker.getRegistrations()` -> `registration.unregister()` and clears old Workbox caches.

### 2.4 Direct Violations of `design.md`, `apple-design` & Modern Web Standards
1. **Forbidden Gradients, Inline Styles & Raw Emojis:** `src/components/subscription/SubscriptionGate.tsx` (lines 78, 82, 124, 128) uses `linear-gradient(135deg, #7f1d1d 0%, #991b1b 100%)`, extensive inline `style={{ ... }}` objects, and raw `🔒` / `⚠️` emojis—all explicitly banned by `design.md` §6.
2. **Broken Color Discipline:** `tailwind.config.js` and `src/index.css` introduce banned rainbow hues (`#3B82F6` blue, `#F59E0B` amber, `#64748B` slate, `bg-blue-600/90`, `bg-amber-600` in `App.tsx`) and tint dark mode surfaces green (`--surface-raised: #11332D`, `--surface-inset: #08221D`, `--text-body: #CDEDE7`, `--text-muted: #7DD3C6`), violating `design.md`'s neutral-ink + single mint accent + single danger red discipline.
3. **WCAG AA Contrast Failure on Primary Buttons:** In `src/index.css` (lines 208–211), `.btn-primary` pairs `#FFFFFF` white text with `#21C29C` (~2.28:1 contrast ratio, failing WCAG AA 4.5:1). `design.md` §2 mandates `#1D1D1F` dark charcoal ink on mint primary fills in **both** light and dark themes.
4. **Broken Theme Engine & FOUC:** `src/stores/themeStore.ts` only supports `'light' | 'dark'`, ignores `prefers-color-scheme` (hardcoding `applyTheme('light')` when `localStorage` is empty), mutates `.light-mode` / `.dark-mode` classes via JS after load (causing Flash of Unstyled Content), omits `<meta name="color-scheme" content="light dark">` and `:root { color-scheme: light dark; }`, and declares global `::-webkit-scrollbar` styles without `@supports not (scrollbar-color: auto)`.
5. **Typography & Numeral Alignment Gaps:** Uses `Inter` instead of `Plus Jakarta Sans` + `IBM Plex Mono`, shrinks `html` to `13px` at `<= 480px` (`src/index.css:392`), omits size-specific negative tracking on display text (`apple-design` §15), and does not enforce `tabular-nums` on figures.
6. **Motion & Accessibility Deficits:** `.btn` uses `transition-all duration-200` (`src/index.css:201`, anti-pattern per `apple-design` and `Hosila IMS/PLAN.md`), `@keyframes slide-in-right` forces a 60% bounce (`-4px`) on non-momentum transitions, there is no `:active { transform: scale(0.97); }` press feedback, and **zero `@media (prefers-reduced-motion)` support** exists anywhere in CSS.
7. **Broken CorelDRAW Wordmark SVG:** `public/hosila-logo.svg` is a CorelDRAW export relying on a deprecated SVG `<font id="FontID0" font-family="Prototype">` element and hardcoded `.fil0 { fill: black }`—rendering incorrectly when Prototype isn't available and disappearing completely on dark backgrounds.

---

## 3. Hosila Product Suite Review (Features, Architecture & Use Cases — Excluding Keygen)

Every product section, feature badge, interactive preview, and documentation page on the revamped website should be grounded in the **real engineering capabilities** verified in `Hosila PMS` and `Hosila IMS`.

### 3.1 Hosila PMS (`Hosila-PMS-Setup.exe` — 44.8 MB)
- **Target Audience:** Independent hotels, boutique properties, resorts, guest houses, and serviced apartments.
- **Core Architectural Differentiator (Be Precise — Host PC + Local Network Sync):**
  - **One Host PC stores the database:** Installed on a dedicated reception Host PC (Node.js + Express + embedded SQLite in WAL mode).
  - **Local Network (LAN) Multi-Device Access:** Front Desk desks, Restaurant/Bar tablets, Accountants, Auditors, and Management open the Host PC's local URL (e.g. `http://192.168.x.x:3000`) in any browser on the same Wi-Fi/LAN; WebSocket (`ws`) connections synchronize activity across workstations in real time. *(Note for website copy: PMS does **not** sync separate standalone databases across disconnected computers without a local host and network.)*
  - **Internet Independence vs. Optional Email:** Internet is **not** required for core hotel, front desk, restaurant billing, or accounting workflows. **Optional** automated guest email delivery via Resend requires internet access (and queues messages locally until connectivity returns).
- **Verified Capabilities & Use Cases:**
  1. **Front Desk & Fast-Scan Room Board:** Visual room grid with vertical left status bars (`#6AD4B0` Mint = Available & Clean, Charcoal = Occupied & Clean, `#E05252` Soft Red = Dirty, Maintenance, or Overdue/Unpaid balance). Slide-over **Room Inspector Drawer** preserves context; **Housekeeping Hygiene Guard** physically blocks checking a guest into a `Dirty` or `Maintenance` room.
  2. **Reservations & 14/21-Day Tape Chart:** Horizontal `Room × Date` Tape Chart with floor filters, `< 7d / Today / 7d >` shifting, click-any-empty-cell booking prefill, click-any-stay-bar folio access, monthly Room Calendar toggle, and boarding-pass-style reservation summaries.
  3. **Real-World Guest Folios & Stay Modifications:**
     - **Extend Stay:** Extend in the same room or switch to a higher/lower-rate clean room for extended nights, assigning charges to `Personal Bill` or `Company Bill`.
     - **Move Room:** Mid-stay upgrades/downgrades with automatic old-room `Dirty` marking, rate difference math, and checkout-morning protection (`0` remaining nights = no retroactive last-night charge).
     - **Early Check-Out:** Optional unused-night credit note recalculation.
     - **Corporate vs. Personal Split Bills & Split Payments:** One-click `Auto-Split Corporate` (`Combined | Company | Personal` folio views and printouts) plus multi-method checkout payments (`Cash + Card + Bank Transfer` in one settlement), Refunds, and Credit Notes.
     - **Complimentary Bill Waivers & Settle Later (City Ledger):** Management/Accountant can waive Accommodation, F&B, Services, or Full Bills (posting contra-revenue + automatic VAT/Tax reversal) or authorize **Unpaid Check-Out ("Settle Later")** with mandatory reason & due date—releasing the room while tracking the receivable in `Finance -> Unpaid Check-Outs`.
  4. **Integrated Restaurant Billing Module *(Toggleable)*:** Built specifically for hotel dining rooms, bars, and room service—can be disabled completely for lodging-only properties. Features instant `Sold` / `Restore` toggles, portrait-tablet sticky bottom `Current Ticket` drawer, **Dine-In** (open unpaid tabs in soft red vs. immediate payment) and **Room Service** (post directly to checked-in guest folio), plus `340px` thermal Kitchen Dockets and Customer Receipts. *(Clearly distinct from standalone **Hosila POS** for non-hotel businesses.)*
  5. **Immutable Double-Entry Accounting, Tax Engine & Void Audit:**
     - Sequential General Journal (`JV-000001+`) linked with **SHA-256 chain hashes** (`Debits = Credits`), Charge-to-Payment Clearing (`Cleared`, `Partial`, `Unpaid`), live Trial Balance, Expenses, Extra Income, and customizable database categories.
     - **Multi-Rule Tax Engine:** Master on/off toggle (hides all tax registers/lines when off), multiple concurrent rules (VAT, Service Charge, Consumption/TDL), `Exclusive` vs. `Inclusive` calculation, scoped to `Accommodation`, `Restaurant`, or `Both`.
     - **Strict Anti-Tampering Void Audit Report:** Zero silent deletions—voids require a reason, mark the original record, post a balanced contra journal voucher, and log everything to an Excel-exportable Void Audit Report.
     - **Night Audit, Shift Handover & Disaster Recovery:** Opening float + live expected cash (`Opening + Cash Received - Refunds - Expenses`) + Over/Short variance on close; Night Audit rolls holdovers, advances business date, and saves **SHA-256 verified `.sqlite` backups** with safeguarded Pre-Restore Snapshots.
     - **Automated Guest Emails (Optional — Requires Internet):** Resend integration with offline retry queue and mobile-reliable inline CID hotel logo embedding.
  6. **5-Role RBAC with Transparent Lock UX:** `Management`, `Accountant`, `Auditor`, `Front Desk`, and `Restaurant`. Restricted controls (voids, waivers, Settle Later, rate overrides) remain visible, dimmed with a `<Lock />` icon and `<HoverTip>` rather than vanishing mysteriously.
  7. **Keyboard Speed:** Global `Cmd/Ctrl + K` Quick Search by guest name, room number, confirmation code, or phone.

### 3.2 Hosila IMS (`Hosila-IMS-Setup.exe` — 5.6 MB + Portable `.zip`)
- **Target Audience:** Hotel back-of-house stores, central kitchens, F&B directors, restaurants, bars, clubs, supermarkets, and multi-department operations battling stock shrinkage, unit-conversion errors, and messy market spreadsheets.
- **Core Architectural Differentiator (Single-PC Local Desktop Architecture):**
  - Built with **Tauri 2 + Rust (`hosila-core`) + embedded SQLite WAL + FTS5**—shipping in a **5.6 MB** Windows installer (and portable `.zip` mode).
  - Operates **purely locally on a single Windows machine** (no LAN host/client server, no cloud sync, and no internet connection required).
  - **Zero floating-point math:** Quantities stored in integer milli-units (`×1,000`), money in integer minor/kobo units (`×100`), unit costs in micro-naira (`×1,000,000`) so per-gram/per-ml costs never drift.
- **Verified Capabilities & Use Cases:**
  1. **Multi-Department & Store Section Catalog:** Departments (`Kitchen`, `F&B`, `Housekeeping`, `Maintenance`, `Store`) plus Store Sections (e.g. `Protein`, collected by Kitchen yet grouped separately in exports). Shared items (e.g. `Pineapple` across `F&B` + `Kitchen`) stay single-source-of-truth without duplicate SKUs. Instant sub-10ms **SQLite FTS5** search across names, SKUs, and learned market aliases.
  2. **Two-Tier Units of Measure (UoM) & Weighted Average Costing (WAC):**
     - Locked base stocking unit per item (`BOTTLE`, `PCS`, `KG`/`G`, `LITRE`/`ML`)—stock never displays nonsensical `0.33 crate`.
     - Global physical conversions (`KG <-> G`, `L <-> ML`, `DOZEN <-> PCS`) + per-item local market packaging conversions (`CRATE`, `CARTON`, `PACK`, `BAG`, `PAINT`, `CUP`, `PORTION`, `BALL`, `BASKET`, `WHOLE`, `ROLL`) with `can_purchase` / `can_issue` flags and human-friendly upscaling (`76 btl -> 3 crates + 4 btl`).
     - Automatic **Weighted Average Cost (WAC)** updated on receipt and snapshotted onto every movement in an append-only `stock_movements` ledger (`Reversal` documents instead of silent edits).
  3. **Keyboard-First Counter Collections & Returnables:** Zero-animation high-speed issue counter capturing Department, Collector (filtered by dept), Storekeeper (Store team), Entered-by user, and editable Collection Date (supporting back-dated entries). Enforces a hard **server/Rust-level `INSUFFICIENT_STOCK` block** (*"Quantity is more than available. Only X [unit] in stock."*). Supports `is_returnable` equipment/tools Check-Out, partial/full Check-In, and damaged-return adjustment logging.
  4. **Smart Procurement List Builder & Offline Rust Excel Parser (`hosila-core::parser`):**
     - **Export:** Builds Low-Stock / Full / Custom par-based procurement lists rounded up to purchase units, split into one sheet per buyer plus master with live Excel `=D*E` and `=SUM(...)` formulas and a hidden `_hosila_meta` worksheet for deterministic round-trips.
     - **Offline Parsing (`calamine` + `strsim`):** Parses both Hosila-exported workbooks (Tier 1) and arbitrary multi-sheet market buyer Excel files (Tier 2—detecting buyer sheets, extra transport/POS/bank charges, and cash controller disbursement/refund summaries) with zero external AI/HTTP APIs.
     - **Mandatory Storekeeper Confirmation Gate & Anomaly Detector:** Flags real-world market spreadsheet errors before updating stock—`AMOUNT_MISMATCH` (e.g. keg total typed in unit price), `AMOUNT_ONLY` (lump sum with blank qty), `UNIT_CONVERSION_NEEDED` (saves `"Remember for future uploads"`), `UNMATCHED_ITEM` (saves trained `item_aliases`), and `PRICE_JUMP` (`> 50%` cost variance)—then posts an atomic GRN + WAC + cash reconciliation transaction.
  5. **Stock Take, PIN-Guarded Adjustments & Weekly Stock Sheets:** Count sheets -> variance review -> `count_correction`, Wastage/Spoilage/Damage adjustments with optional Manager PIN, rotating hot backups, and familiar `OPENING · PURCHASE · TOTAL · ISSUED · CLOSING · UNIT COST · AMOUNT` Weekly/Monthly `.xlsx` reports.

### 3.3 Hosila POS (`hosila-pos` — Future Standalone Product)
- Already architected into `Hosila Keygen/HOSILA_ACTIVATION_ENGINE_SPEC.md` (`'hosila-pms' | 'hosila-ims' | 'hosila-pos'`).
- **Website Role & Product Boundary:** Positioned clearly as **dedicated standalone sales and point-of-sale software for independent restaurants, bars, lounges, and retail businesses**—so customers never confuse it with Hosila PMS's integrated hotel restaurant billing module. Displayed as the third ecosystem pillar (`Future / Planned`) with early-access interest capture.

---

## 4. Critical Evaluation of Recommendations & Curated Three.js Strategy

Addressing the user's Three.js recommendations and `@hosila-logo.png` request directly: **restraint separates a `\$100,000` software site from a sluggish WebGL tech demo**. We will **deploy Three.js in exactly one unforgettable place**—the interactive 3D Hosila Emblem in the hero—and use crisp native HTML/CSS/SVG/GSAP everywhere else so product screenshots and typography stay razor-sharp.

### 4.1 Decision Matrix

| Proposed Application | Decision | Rationale & Execution |
| --- | --- | --- |
| **A. Interactive 3D Hero Emblem (`hosila-logo.png` / `hosila-icon.svg`)** | **ADOPT (Signature Experience)** | Establishes instant hardware-grade identity using Hosila's actual 4-slab isometric `"H"` mark (`public/hosila-icon.svg`), rendered via procedural Three.js extruded geometry with physical lighting and spring-damped pointer response. |
| **B. Product Showcase (Floating 3D App Windows)** | **ADAPT -> Native HTML/CSS Perspective + Retina `<picture>`** | *Do NOT render UI screenshots inside WebGL textures*—small `IBM Plex Mono` numbers blur under mipmapping, accessibility breaks, and GPU memory spikes. Instead, frame crisp `2x` AVIF/WebP Retina screenshots inside native HTML window shells with subtle CSS `perspective(1200px)` tilt, spring tab switching, and zero-latency Light/Dark parity. |
| **C. Product Ecosystem Visualization** | **ADAPT -> Interactive Isometric SVG + GSAP ScrollTrigger** | Shows **Hosila PMS**, **Hosila IMS**, and **Hosila POS** as three independent isometric blocks linked to a shared **Local-First Core** (`SQLite WAL · LAN/Local Speed · Ed25519 Offline Licensing`). Zero extra WebGL contexts; razor-sharp at any zoom level. |
| **D. 3D Section Transitions** | **REJECT** | Distracts from product clarity, hurts mobile battery/INP, and violates `design.md` restraint. Replace with `1px` `border-ink/10` architectural grid dividers, generous whitespace, CSS scroll-driven subtle reveals, and Cross-Document View Transitions (`@view-transition`). |

### 4.2 Deep Spec: The 3D Animated Hosila Emblem (`hosila-logo.png` / `hosila-icon.svg`)
Inspection of `hosila-logo.png` and `Hosila Website/public/hosila-icon.svg` shows the exact geometry of the Hosila mark: **4 crisp sheared parallelogram slabs** forming an isometric `"H"` (1 left vertical slab, 2 stacked center slabs separated by a crisp horizontal negative-space gap, 1 right vertical slab).

1. **Zero-Bloat Procedural Geometry (`THREE.ExtrudeGeometry`):**
   - Extract the 4 exact 2D polygon paths from `public/hosila-icon.svg` (normalized around origin `(0, 0, 0)`). No heavy external multi-megabyte `.glb` download needed—total geometry setup is `< 4 KB` of JS!
   - Extrude each slab with precision micro-chamfered edges (`depth: 0.42`, `bevelEnabled: true`, `bevelThickness: 0.045`, `bevelSize: 0.035`, `bevelSegments: 4`) so specular highlights catch every beveled edge like machined anodized aluminum or ceramic.
   - Stagger the 4 slabs subtly along the `Z` axis (e.g., Left `-0.18`, Center-Top `+0.10`, Center-Bottom `+0.10`, Right `+0.26`) so from the default camera angle they lock cleanly into the recognizable `"H"`, while cursor parallax reveals true 3D depth separation between the 4 pillars.
2. **Dual-Theme Physical Materials (`MeshPhysicalMaterial` — Zero Neon Glow):**
   - **Dark Mode Palette (`#141416` canvas):** Main slab faces in satin carbon-obsidian (`#1F2024`, roughness `0.38`, metalness `0.65`, clearcoat `0.35`) paired with Mint (`#21C29C` -> lit bevel highlight `#6AD4B0`) inner extruded side-walls/chamfers and subtle studio rim lighting.
   - **Light Mode Palette (`#FFFFFF` canvas):** Main slab faces in machined satin ceramic/silver-white (`#F4F5F7`, roughness `0.28`, metalness `0.15`, clearcoat `0.5`) paired with crisp Brand Mint (`#21C29C`) extruded inner walls and soft ground contact shadow (`#1D1D1F` at `6%` opacity).
   - Theme switches update material uniforms/colors smoothly on `meta[name="color-scheme"]` or OS `prefers-color-scheme` change without recreating the WebGL context.
3. **Apple-Style Spring & Interruptible Physics:**
   - **Initial Reveal:** Critically damped spring (`damping: 1.0`, `response: 0.45`) settles the 4 slabs smoothly along their `30°` isometric axis on first load (no bouncing/cartoony overshoot).
   - **Cursor Interaction:** Pointer coordinates smoothly drive a target tilt (`±8°` X/Y rotation + subtle Z-layer parallax between slabs) via frame-rate-independent spring interpolation (`requestAnimationFrame` clamped `dt`), remaining 100% interruptible at any moment.
   - **Scroll Choreography:** As the user scrolls past the hero, subtle scroll progress (`0 -> 1`) gracefully parts or rotates the 4 slabs slightly before the canvas pauses off-screen.
4. **Performance, Battery & Accessibility Guardrails:**
   - **Asynchronous Loading:** Hero headline, CTAs, and a crisp inline SVG/poster of `hosila-icon.svg` paint at `t = 0`. Three.js (`three` core only—tree-shaken ES module import, no bloated `examples` addons) loads asynchronously via dynamic `import()` after first paint / `requestIdleCallback`.
   - **Hardware & Motion Degradation:** Skip WebGL entirely and keep the crisp static vector/AVIF emblem when `prefers-reduced-motion: reduce`, `Save-Data: on`, or WebGL context creation fails, or simplify lighting/DPR (`Math.min(window.devicePixelRatio, 2)`) on low-core devices (`navigator.hardwareConcurrency <= 2`).
   - **Pause Control (WCAG 2.2.2) & Off-Screen Pause (`efficient-background-processing`):** Provide a subtle, keyboard-accessible **Pause / Play** icon button next to the 3D stage (since continuous subtle ambient drift exceeds 5 seconds), and pause the `requestAnimationFrame` loop immediately via a direct `contentvisibilityautostatechange` listener on the hero canvas container (plus `IntersectionObserver` fallback and `document.visibilitychange`).

---

## 5. Unified Design Constitution (`design.md` × `apple-design` × `modern-web-guidance`)

### 5.1 Strict Color Token Matrix (Zero Gradients, 3+1 Color Discipline)
Harmonizes `design.md` (`#6AD4B0` Soft Mint) with the `hosila-icon.svg` brand mark (`#21C29C`):

| Semantic Token | Light Mode Value | Dark Mode Value | Usage & Contrast Rule |
| --- | --- | --- | --- |
| `--color-canvas` | `#FFFFFF` | `#141416` | Page background, inputs, inverted neutral button text |
| `--color-surface` | `#FFFFFF` | `#1C1C1F` | Cards, window frames, dialogs, drawers, dropdown panels |
| `--color-ink` | `#1D1D1F` | `#F2F2F7` | Primary headings, body text, icons, opacity-derived neutrals |
| `--color-accent` | `#6AD4B0` | `#6AD4B0` | Primary CTA fills, focus outline, active indicator bars |
| `--color-accent-text-on-fill` | `#1D1D1F` | `#1D1D1F` | **Mandatory** text color on `#6AD4B0` buttons in *both* themes (WCAG AA compliant; never `#FFFFFF`) |
| `--color-accent-ink` | `#1E8665` | `#6AD4B0` | Contrast-safe accent text, links, and `Hosila` wordmark highlight |
| `--color-accent-mark` | `#21C29C` | `#21C29C` | Brand emblem primary mint face (`hosila-icon.svg`) |
| `--color-danger` | `#E05252` | `#E05252` | Reserved strictly for errors, invalid Machine IDs, and expired states |
| `--color-danger-ink` | `#C83E3E` | `#F27272` | Contrast-safe inline validation & alert copy |

**Strict Rules Enforced Across All Website Pages:**
- **Zero CSS Gradients:** No `linear-gradient`, `radial-gradient`, or glowing SaaS hero blobs anywhere in page CSS.
- **Neutral Opacity Scale from `--color-ink`:** Subtle tinted blocks use `color-mix(in oklab, var(--color-ink) 3%, transparent)` (never `in oklch` with neutrals, avoiding Chromium's low-chroma magenta hue bug). Hairline borders use `8%–12%` ink opacity; secondary text uses `65%–70%` ink opacity; metadata uses `45%–50%`.
- **Forced Colors Mode:** Include `@media (forced-colors: active)` rules mapping hairline borders and active cards to `CanvasText`, `Highlight`, and `ButtonText` so Windows High Contrast remains legible.

### 5.2 System-First Dual Theme Architecture (`dark-mode` & `dark-mode-toggle`)
Both Light and Dark modes follow the user's OS default out of the box with zero flash of wrong theme, plus an unobtrusive override toggle:

```html
<!-- Inside <head> immediately before any stylesheet -->
<meta name="color-scheme" content="light dark">
<script>
  try {
    const saved = localStorage.getItem("color-scheme");
    if (saved === "light" || saved === "dark") {
      document.querySelector('meta[name="color-scheme"]').content = saved;
    }
  } catch {}
</script>
```

```css
:root {
  color-scheme: light dark;

  --canvas-light: #FFFFFF;
  --canvas-dark: #141416;
  --surface-light: #FFFFFF;
  --surface-dark: #1C1C1F;
  --ink-light: #1D1D1F;
  --ink-dark: #F2F2F7;
  --accent-ink-light: #1E8665;
  --accent-ink-dark: #6AD4B0;

  /* Baseline fallback for browsers without light-dark() */
  --color-canvas: var(--canvas-light);
  --color-surface: var(--surface-light);
  --color-ink: var(--ink-light);
  --color-accent-ink: var(--accent-ink-light);

  @media (prefers-color-scheme: dark) {
    --color-canvas: var(--canvas-dark);
    --color-surface: var(--surface-dark);
    --color-ink: var(--ink-dark);
    --color-accent-ink: var(--accent-ink-dark);
  }

  @supports (color: light-dark(white, black)) {
    --color-canvas: light-dark(var(--canvas-light), var(--canvas-dark));
    --color-surface: light-dark(var(--surface-light), var(--surface-dark));
    --color-ink: light-dark(var(--ink-light), var(--ink-dark));
    --color-accent-ink: light-dark(var(--accent-ink-light), var(--accent-ink-dark));
  }

  /* Reflect manual <meta> override back onto :root so CSS doesn't ignore it */
  &:has(> head > meta[name="color-scheme"][content="dark"]) {
    color-scheme: dark;
  }
  &:has(> head > meta[name="color-scheme"][content="light"]) {
    color-scheme: light;
  }

  /* Theme-aware scrollbars (NEVER animate or transition scrollbar-color) */
  --scrollbar-track: light-dark(#F2F2F7, #1C1C1F);
  --scrollbar-thumb: light-dark(#AEAEB2, #48484A);
  scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track);
}

@supports not (scrollbar-color: auto) {
  ::-webkit-scrollbar { width: 10px; height: 10px; }
  ::-webkit-scrollbar-track { background: var(--scrollbar-track); }
  ::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 9999px; }
}
```

- **Toggle Behavior:** Clicking the header theme switch checks the *currently rendered* scheme and sets the opposite. If the target matches the live OS preference, `localStorage.removeItem("color-scheme")` restores `"light dark"` (System); otherwise it stores `"light"` or `"dark"`. **Never** attach a `matchMedia` listener that deletes stored user preferences when OS time-of-day shifts happen to match. Sync across open tabs via `window.addEventListener('storage', ...)`.

### 5.3 Typography & Optical Scaling (`design.md` §3 + `apple-design` §15)
- **Self-Hosted WOFF2 Subsets:** `Plus Jakarta Sans` (`400, 500, 600, 700` with `font-feature-settings: "cv02", "cv03", "cv04", "cv11"`) + `IBM Plex Mono` (`400, 500, 600`). Preloaded in `<head>` with `crossorigin` (even same-origin, without `fetchpriority="high"`).
- **Size-Specific Optical Tracking & Inverse Leading:**
  - *Hero Display:* `clamp(2.5rem, 5.2vw, 4.5rem)`, weight `700`, `line-height: 1.04`, `letter-spacing: -0.03em`.
  - *Section Heading:* `clamp(1.75rem, 3vw, 2.5rem)`, weight `600`, `line-height: 1.12`, `letter-spacing: -0.02em`.
  - *Subheading / Card Title:* `1.125rem` (`18px`), weight `600`, `line-height: 1.3`, `letter-spacing: -0.01em`.
  - *Body Copy:* `1rem` (`16px`), `line-height: 1.6`, `letter-spacing: 0em` (`+0.005em` in dark mode to prevent white-on-carbon halation).
  - *Micro Section Tags:* `0.6875rem` (`11px`), weight `600`, uppercase, `letter-spacing: +0.06em`.
- **Mandatory `font-mono tabular-nums`:** Every price (`₦`, `\$`), installer version (`v1.0.0`), file size (`44.8 MB`), SHA-256 hash, date (`YYYY-MM-DD`), and Machine ID (`HSLA-XXXX-XXXX-XXXX`).

### 5.4 Fluid Motion, Translucent Chrome & Native Platform Patterns
- **Apple Translucent Sticky Navigation:** Uses `backdrop-filter: blur(20px) saturate(180%)` over semi-transparent canvas (`rgba(255,255,255,0.72)` / `rgba(20,20,22,0.72)`) with a crisp `1px` edge highlight and `@media (prefers-reduced-transparency: reduce)` solid fallback.
- **Scroll-Driven Shrinking Header:** Implemented natively via CSS `animation-timeline: scroll(block root)` + `animation-range: 0px 120px` declared **after** the `animation` shorthand, gated behind `@supports ((animation-timeline: scroll()) and (animation-range: 0% 100%))` with a lightweight scroll fallback and dynamic `scroll-padding-top` (WCAG 2.4.11 Focus Not Obscured).
- **Instant Tactile Feedback & Springs:** Every interactive button responds on pointer-down (`.btn:active { transform: scale(0.97); transition: transform 100ms ease-out; }`). Interactive product tab indicators and drawers use critically damped spring motion (`damping: 1.0`, `response: 0.35`, interruptible); hover treatments are gated behind `@media (hover: hover) and (pointer: fine)`.
- **Native Light-Dismiss Modals (`<dialog closedby="any">`):** Used for full-screen screenshot zoom lightboxes and license key confirmation modals, opened with `showModal()`, styled via `::backdrop` + `@starting-style` + `transition-behavior: allow-discrete`, plus the mandatory bounding-box backdrop click fallback for Safari.
- **Cross-Document View Transitions:** Enabled inside `@media (prefers-reduced-motion: no-preference) { @view-transition { navigation: auto; } }` so navigating `/ -> /products/pms -> /downloads -> /releases` feels seamless in Chromium/Safari and falls back to instant navigation elsewhere.
- **Scoped Reduced Motion:** Apply motion selectively inside `@media (prefers-reduced-motion: no-preference)` or slow/cross-fade inside `@media (prefers-reduced-motion: reduce)`—never use global `* { animation-duration: 0.01ms !important; }`.

---

## 6. Target Tech Stack & Repository Architecture

### 6.1 Stack Selection Rationale
- **Astro 5 (Static + On-Demand Server Endpoints):** Outputs pure semantic HTML, Vanilla CSS, and zero-framework Vanilla JS islands on every marketing, download, and changelog page.
- **Vanilla CSS:** Native CSS layers (`@layer tokens, base, layout, components, utilities`), CSS nesting, `light-dark()`, container queries, and `@starting-style`—no heavy Tailwind runtime or utility bloat on the marketing site.
- **GSAP (`gsap` + `ScrollTrigger`):** Orchestrates scrolled product reveals, bento counter choreography, and the isometric ecosystem SVG sequence (deferred cleanly so LCP isn't blocked).
- **Three.js (`three`):** Tree-shaken ES module loaded dynamically *only* for the Homepage Hero 3D Hosila Emblem.
- **Astro Starlight (`@astrojs/starlight`):** Powers `/docs/*` with built-in Pagefind static full-text search, keyboard `Ctrl+K` navigation, code blocks, and `<Steps>` tutorials, themed with `design.md` CSS overrides.
- **Markdown Content Collections (`src/content/releases/` + `src/lib/releases.ts`):** Single source of truth! Publishing a Markdown release file automatically updates all **five** surfaces across the site:
  1. **Download Centre** (`/downloads`)
  2. **Product Page Version Metadata** (`/products/pms`, `/products/ims`)
  3. **Release History & Changelog** (`/releases`)
  4. **Download SHA-256 Checksum & Verification Command**
  5. **Changelog RSS Feed** (`/releases/rss.xml`)
- **Serverless API (`/api/*` via Vercel/Cloudflare Adapter + Postgres/Turso/Supabase):** Isolated strictly to Phase 5 (Paystack/Stripe payment webhooks, Order Token verification, and server-side Ed25519 `HSL1` key signing).

### 6.2 Target Directory Structure (`Hosila Website/`)
```text
Hosila Website/
├─ legacy-cloud-pms/                  # Archived old React/Supabase SPA during transition
├─ public/
│  ├─ fonts/                          # Self-hosted Plus Jakarta Sans + IBM Plex Mono (.woff2)
│  ├─ mockups/                        # Sharp-optimized 1x/2x AVIF & WebP (light + dark pairs)
│  ├─ hosila-icon.svg                 # Clean 4-slab vector emblem
│  ├─ hosila-wordmark.svg             # Fixed path-outlined wordmark (uses currentColor, no Corel FontID)
│  ├─ robots.txt
│  └─ sw.js                           # One-time Workbox SW self-unregister script for domain migration
├─ scripts/
│  ├─ capture-mockups.mjs             # Version-reusable Playwright 2x Retina dual-theme capture CLI
│  └─ optimize-mockups.mjs            # Sharp AVIF/WebP + 1x/2x responsive image pipeline
├─ src/
│  ├─ content/
│  │  ├─ config.ts                    # Zod schemas for releases & docs
│  │  ├─ docs/                        # Astro Starlight Markdown/MDX documentation portal
│  │  │  ├─ getting-started/
│  │  │  ├─ pms/
│  │  │  ├─ ims/
│  │  │  └─ licensing/
│  │  └─ releases/                    # Markdown release notes (pms-v1.0.0.md, ims-v1.0.0.md, ...)
│  ├─ lib/
│  │  └─ releases.ts                  # Single-source-of-truth resolver for downloads, product pages, checksums, RSS
│  ├─ styles/
│  │  ├─ tokens.css                   # design.md palette, light-dark(), typography, spacing
│  │  ├─ base.css                     # Reset, focus-visible, scrollbars, view-transitions, reduced-motion
│  │  ├─ components.css               # Buttons, window mockups, cards, native <dialog>, nav
│  │  └─ starlight-hosila.css         # Starlight token overrides matching design.md
│  ├─ scripts/
│  │  ├─ theme.js                     # System-first theme controller + cross-tab storage sync
│  │  ├─ hero-emblem-3d.js            # Lazy Three.js 4-slab extruded Hosila logo + Pause/Battery guard
│  │  ├─ animations.js                # GSAP ScrollTrigger timelines (respecting prefers-reduced-motion)
│  │  ├─ interactive-demos.js         # Lightweight Vanilla JS Room Board & UoM mini-sandboxes
│  │  └─ activate-portal.js           # Client validation & fetch flow for /activate & /pricing
│  ├─ components/
│  │  ├─ SiteHeader.astro             # Translucent shrinking header + Products menu + Theme toggle
│  │  ├─ SiteFooter.astro             # Clean architectural footer
│  │  ├─ Hero3D.astro                 # 3D canvas shell + static SVG fallback + Pause/Play button
│  │  ├─ AppWindowFrame.astro         # Light/Dark <picture> switcher + optional lightbox <dialog>
│  │  ├─ ProductEcosystem.astro       # Isometric PMS / IMS / POS + Shared Core SVG diagram
│  │  └─ DownloadCard.astro           # Version, OS, size, SHA-256 copy box (from releases.ts)
│  ├─ layouts/
│  │  └─ BaseLayout.astro             # <meta color-scheme>, FOUC script, SEO/JSON-LD, View Transitions
│  └─ pages/
│     ├─ index.astro                  # Main Hosila Homepage
│     ├─ products/
│     │  ├─ pms.astro                 # Hosila PMS landing page
│     │  ├─ ims.astro                 # Hosila IMS landing page
│     │  ├─ pos.astro                 # Hosila POS (Future preview + waitlist)
│     │  └─ compare.astro             # Product Comparison Matrix (/products/compare)
│     ├─ downloads.astro              # Phase 2: Product Download Centre
│     ├─ releases/
│     │  ├─ index.astro               # Phase 4: Filterable Markdown Changelog
│     │  └─ rss.xml.ts                # Changelog RSS feed
│     ├─ pricing.astro                # Phase 5: Finalized Pricing & Checkout
│     ├─ activate.astro               # Phase 5: Online Self-Service Keygen Portal
│     └─ api/                         # Phase 5: Serverless endpoints (Private key stays here!)
│        ├─ checkout/create.ts
│        ├─ webhooks/paystack.ts
│        ├─ webhooks/stripe.ts
│        ├─ license/verify-order.ts
│        ├─ license/generate.ts       # Ed25519 HSL1 signer (commercial keys only)
│        └─ license/transfer.ts       # Verified hardware replacement flow
└─ astro.config.mjs
```

---

## 7. Automated Native App Screenshot & Mockup Pipeline

Instead of hand-drawing fake UI mockups or taking blurry manual screenshots, we can capture **pixel-perfect, deterministic Retina screenshots directly from the real Hosila PMS and Hosila IMS applications**:

### 7.1 Why Both Apps Are Ready for Automated Headless Capture
1. **Hosila PMS (`Hosila PMS/`):** Runs locally on `http://localhost:3000` (`npm run dev`) with an embedded SQLite database. A dedicated capture-seed helper populates a realistic boutique property (*"De Palms Boutique Hotel"*—zero placeholder text, authentic `₦` / `\$` folios, clean/dirty/occupied rooms, active restaurant tabs, and balanced `JV-000001+` accounting entries).
2. **Hosila IMS (`Hosila IMS/`):** Already ships `src/lib/browserMock.ts` (`installBrowserPreviewFallbackIfNeeded()`), which mocks Tauri IPC inside a standard browser at `http://localhost:5173` (`npm run dev`), rendering the exact production React 19 UI—including realistic stock balances, collections, and Procurement Excel parser anomalies—without requiring a compiled Tauri window.

### 7.2 Reusable Version-Driven Capture & Optimization Workflow
Make this pipeline **permanently reusable (`npm run mockups:update -- --product all|pms|ims`)** whenever a new PMS or IMS release changes its UI, so website screenshots never drift behind shipped installers:

1. **Playwright Script (`scripts/capture-mockups.mjs`):**
   - Accepts `--product pms|ims|all` and boots or connects to the seeded app dev server cleanly.
   - Launches Chromium at `1440×900` with `deviceScaleFactor: 2` (`2880×1800` Retina output), plus `834×1194` portrait tablet for Hosila PMS's sticky POS ticket drawer.
   - Waits for `document.fonts.ready` (`Plus Jakarta Sans` / `Inter Variable` + `IBM Plex Mono`), hides scrollbars and caret blink, and walks through every flagship view:
     - **PMS Views:** `Room Board + Room Inspector Drawer`, `14-Day Tape Chart`, `Guest Folio (Split Company/Personal Bill)`, `Integrated Restaurant Billing`, `Finance -> General Journal & Void Audit`.
     - **IMS Views:** `Dashboard KPIs & Activity Timeline`, `Multi-Dept Inventory (Kitchen + Protein)`, `Counter Collection`, `Procurement Excel Anomaly Confirmation Gate`.
   - Captures **every screen twice**: once in **Light Mode** (`*-light.png`) and once in **Dark Mode** (`*-dark.png`).
2. **Image Pipeline (`scripts/optimize-mockups.mjs` via `sharp`):**
   - Automatically processes captured PNGs into `1x` (`1440w`) and `2x` (`2880w`) **AVIF** and **WebP** files alongside PNG fallbacks in `public/mockups/`.
3. **Dual-Theme HTML `<picture>` Rendering:**
   - Because `<picture>` `<source media="(prefers-color-scheme: dark)">` cannot react to a manual `<meta name="color-scheme">` override on its own (`dark-mode-toggle` guidance), `AppWindowFrame.astro` renders cleanly synchronized light and dark `<picture>` elements toggled via CSS `:root:has(> head > meta[name="color-scheme"][content="dark"])` + `@media (prefers-color-scheme: dark)`, wrapped in a crisp CSS-engineered native desktop window bar (`1px` `border-ink/12`, zero stock laptop photos).
   - **Image Priority Rules (`optimize-image-priority`):** The hero showcase mockup gets `fetchpriority="high"` and `loading="eager"`; all below-the-fold mockups use `loading="lazy"` **without** `fetchpriority="low"` so scrolled assets download at full priority when entering the viewport.
4. **Bonus Interactive Micro-Sandboxes:** Pair the static Retina frames with 2 lightweight Vanilla JS interactive sandboxes on the product pages (e.g., clicking PMS Room Status bars to inspect a live room drawer, or toggling IMS `1 Crate = 24 Bottles` live UoM conversion) so prospects experience Hosila's instant responsiveness firsthand.

---

## 8. Phased Build Roadmap (Approved 5-Phase Execution Order)

> [!IMPORTANT]
> **Phase-Gated Execution Rule:** Build and ship strictly **one phase at a time**. Do not attempt to build the entire five-phase ecosystem in one pass. Ship **Phase 1 (Brand & Marketing Foundation)** first so Hosila immediately has a clean, sellable software-company website, then execute Phases 2–5 sequentially.
>
> **Commercial Model Guardrail (Phases 1–4):** Do **not** publish unfinalized pricing tables, subscription intervals (`Monthly` / `Yearly` / `Lifetime`), or guaranteed trial durations in public copy until the commercial model is locked in Phase 5.

| Priority | Phase | Scope |
| --- | --- | --- |
| **1st** | **Brand & Marketing Foundation** | Astro foundation, `design.md` CSS system, navigation, homepage, Three.js 4-slab H hero emblem, PMS & IMS product pages, POS preview, and `/products/compare`. |
| **2nd** | **Product Distribution** | Download Centre (`/downloads`), single-source version metadata, R2/CDN artifacts, and SHA-256 verification. |
| **3rd** | **Customer Education** | Astro Starlight documentation (`/docs/*`), installation guides, LAN setup tutorials, and troubleshooting. |
| **4th** | **Product Updates** | Markdown release management (`/releases`), automated 5-surface metadata sync, and RSS feed (`/releases/rss.xml`). |
| **5th** | **Commercial Infrastructure** | Finalized pricing (`/pricing`), Paystack/Stripe checkout, *"Buy Now, Bind PC Later"* order tokens, server-only Ed25519 `HSL1` key generation (`/activate`), and delivery. |

---

### Phase 1: Brand & Marketing Foundation

#### 1.1 Global Navigation & Architectural Footer
- **Header (`SiteHeader.astro`):** Translucent shrinking sticky header (`height: 72px -> 56px` on scroll) containing:
  - Fixed vector `Hosila` logo (`hosila-icon.svg` + `currentColor` wordmark)
  - Links: `Products ▾` (Hosila PMS, Hosila IMS, Hosila POS *Future*, **Compare Products**), `Downloads`, `Docs`, `Releases`, `Activate` *(or `Pricing` once Phase 5 opens)*
  - Right cluster: Subtle 2-state Theme Switch (follows system by default) and Primary Mint CTA (`Explore Products` -> `/products/compare` in Phase 1, switching to `Download` -> `/downloads` in Phase 2, `#1D1D1F` text on `#6AD4B0`).
  - Mobile: Native accessible slide-over navigation drawer (`Esc`, backdrop tap, swipe-aware close).

#### 1.2 Homepage (`/`) — Section-by-Section Wireframe
1. **Hero Section:**
   - **Left Column:** Eyebrow badge (`Hosila Software Suite`), Display Headline (*"Business software. Without the complexity."*), concise software-company value prop, Primary Mint CTA (`Explore Products`), Secondary Outline CTA (`Compare Applications`), and accurate trust micro-line (`Windows Desktop & LAN · Local SQLite Storage · Zero Cloud Lock-In`).
   - **Right Column:** **Interactive 3D Hosila Emblem (`Hero3D.astro`)** with subtle ambient drift, pointer-responsive parallax, and bottom-right accessible **Pause / Play** toggle.
2. **Flagship Product Showcase (Dual-App Switcher):**
   - Segmented switcher (`Hosila PMS` | `Hosila IMS`) with critically damped sliding indicator (`damping: 1.0`, `response: 0.35`), plus module sub-tabs (`Room Board`, `Tape Chart`, `Guest Folio`, `Double-Entry Audit` / `Inventory`, `Counter Collection`, `Excel Procurement Parser`) displaying Retina Light/Dark screenshots inside clean desktop window frames.
3. **Why Local-First Wins (4 Architectural Proof Cards — Accurate Connectivity Copy):**
   - `01 · Local Data Ownership` — PMS stores its database on your reception Host PC; IMS runs directly on your local Windows workstation. Core daily operations never halt when internet drops.
   - `02 · Real-Time LAN Sync (PMS)` — Multiple Front Desk, Restaurant Billing, and Accounting stations collaborate live over your local Wi-Fi/LAN via WebSockets—no separate disconnected copies.
   - `03 · Audit-Grade Financial & Stock Math` — SHA-256 chained journal vouchers, immutable void trails, and integer-only kobo/milli-unit IMS costing.
   - `04 · Independent Products, One Craft` — Adopt PMS, IMS, or future Hosila POS independently with consistent ergonomics, keyboard shortcuts (`Ctrl+K`), and unified offline licensing.
4. **Suite Ecosystem Diagram (`ProductEcosystem.astro`):**
   - Isometric SVG + GSAP ScrollTrigger architectural visual showing **Hosila PMS**, **Hosila IMS**, and **Hosila POS *(Future)*** operating as independent apps over shared Hosila pillars (`design.md` Ergonomics · `SQLite WAL` Engine · `HSL1` Ed25519 Licensing).
5. **Operational Precision Across Workflows:**
   - Three crisp scenario columns highlighting software engineering craft across distinct teams: *Front-of-House Speed*, *Back-of-House Inventory Control*, and *Financial & Audit Integrity*.
6. **Calm Conversion Footer Strip:**
   - *"See how each Hosila application fits your operation."* + `[Compare Products]` + `[Explore Hosila PMS / IMS]`.

#### 1.3 Dedicated Product Landing Pages
- **`/products/pms` (Hosila PMS):** Hero + interactive Room Board / Folio / Night Audit showcase, clear **Host PC + LAN Sync** topology diagram (`1 Host PC -> Browser Terminals on Local Network`, clarifying internet is only needed for optional Resend guest emails), explicit framing of the **Integrated Restaurant Billing Module** (hotel dining & room-folio charges vs. standalone POS), 5-Role RBAC Lock UX showcase, multi-rule tax engine breakdown, dynamic version/download block (wired to `src/lib/releases.ts` in Phase 2/4), and system specs.
- **`/products/ims` (Hosila IMS):** Hero highlighting native Rust + Tauri 2 **Single-PC Local Desktop** speed (`5.6 MB` installer, zero LAN server or cloud dependency), interactive walkthrough of the **Offline Procurement Excel Parser** (showing how `AMOUNT_MISMATCH`, `AMOUNT_ONLY`, `UNIT_CONVERSION_NEEDED`, and `UNMATCHED_ITEM` flags protect stock valuation), Two-Tier UoM math preview, and dynamic version/download block.
- **`/products/pos` (Hosila POS — Future):** Clean architectural preview positioning it clearly as **dedicated standalone sales & POS software for independent restaurants, bars, and retail businesses**, with early-access waitlist capture.

#### 1.4 Product Comparison Page (`/products/compare`)
Because Hosila ships three distinct applications (with PMS also offering an integrated hotel dining module), `/products/compare` eliminates buyer confusion immediately. **Rule:** Only publish verified capabilities, visually separating `Built-in` production capabilities from `Future` / `Planned` roadmap items.

| Capability | Hosila PMS | Hosila IMS | Hosila POS *(Planned)* |
| --- | --- | --- | --- |
| **Hotel operations** | Built-in | — | — |
| **Inventory management** | — | Built-in | — |
| **Restaurant billing** | Built-in *(hotel dining & room-folio module)* | — | Future |
| **Stock procurement** | — | Built-in | Future |
| **Standalone sales** | — | — | Future |
| **Local data storage** | Built-in *(Host PC SQLite + LAN sync)* | Built-in *(Single-PC SQLite)* | Planned |

Include a concise **"Which Hosila product do you need?"** selector guide below the table (e.g., *Managing rooms + hotel dining? -> PMS*, *Controlling kitchen/bar/store stock & market Excel sheets? -> IMS*, *Running a standalone restaurant or retail counter? -> Join Hosila POS updates*).

---

### Phase 2: Product Distribution (`/downloads`)
- **OS Detection Banner:** Detects Windows x64 client-side and highlights the primary installer while keeping all platforms/formats clearly accessible.
- **Product Download Cards (`Hosila PMS` & `Hosila IMS` — Driven by `src/lib/releases.ts`):**
  - Displays current version (`font-mono`), release date, installer format (`Windows NSIS Setup.exe` and `Portable .zip` for IMS), exact file size (`44.8 MB` / `5.6 MB`), and local-first architecture summary (without publishing unconfirmed trial promises until finalized).
  - **Expandable Verification Drawer / Accordion:** Full `SHA-256` checksum (`font-mono tabular-nums`), one-click Copy button, and exact verification command:
    ```powershell
    Get-FileHash .\Hosila-PMS-Setup.exe -Algorithm SHA256
    ```
  - Links directly to `Quick-Start Guide (/docs/...)` and `Release Notes (/releases/...)`, plus an **Older Versions** archive list.
- **Binary CDN Hosting Rule:** Never commit `.exe`/`.zip` binaries into Git. Host release artifacts on **Cloudflare R2** (zero egress fees) or GitHub Releases behind clean `/downloads/latest/...` redirects driven by release frontmatter.

---

### Phase 3: Customer Education (`/docs/*` via Astro Starlight)
Integrated seamlessly at `/docs` with `starlight-hosila.css` enforcing `design.md` parity (zero gradients, `Plus Jakarta Sans` + `IBM Plex Mono`, Light/Dark auto-sync, Pagefind `Ctrl+K` instant search):

- **01 · Getting Started:** Installing Hosila on Windows, Locating Your Host PC Machine ID (`HSLA-XXXX-XXXX-XXXX`), Activating with an `HSL1` Key.
- **02 · Hosila PMS Playbook:** First-Run Setup Wizard, Configuring Rooms & Multi-Rule Taxes, Connecting Reception & Restaurant Tablets over LAN (`http://192.168.x.x:3000` + Windows Firewall port `3000` guide, clarifying Host PC vs. LAN browser client roles), Front Desk Operations (Room Board, Tape Chart, Extend/Move/Split/Settle Later), Integrated Restaurant Billing & Thermal Dockets, Accountant & Auditor Guide (General Journal, Void Audit Report, Night Audit, Automated `.sqlite` Backups & Safeguarded Restore), Configuring Resend Guest Emails (noting internet requirement for email delivery).
- **03 · Hosila IMS Playbook:** Single-PC Setup, Departments, Store Sections (`Protein`) & Staff Setup, Units of Measure & Local Market Packaging Conversions, Counter Collections & Returnables, Exporting & Uploading Filled Procurement Excel Sheets (Resolving Parser Anomalies), Stock Takes, Adjustments & Weekly Stock Sheets.
- **04 · Licensing & Recovery:** Hardware Replacement / Host PC Migration, Clock-Tamper Guard FAQ, Off-Site Backup Best Practices.

---

### Phase 4: Product Updates (`/releases`)
- **Single-Source-of-Truth Markdown Content Collection (`src/content/releases/*.md` -> `src/lib/releases.ts`):**
  ```yaml
  ---
  product: "hosila-pms"       # hosila-pms | hosila-ims | hosila-pos
  version: "1.0.0"
  publishedAt: "2026-11-23"
  channel: "stable"
  fileName: "Hosila-PMS-Setup.exe"
  fileSize: "44.8 MB"
  sha256: "..."
  downloadUrl: "https://releases.hosila.com/pms/1.0.0/Hosila-PMS-Setup.exe"
  summary: "Initial commercial release with LAN WebSocket sync, SHA-256 General Journal, and Settle Later City Ledger."
  ---
  ```
- **5-Surface Automated Propagation:** Adding one `.md` release file automatically updates (1) `/downloads`, (2) `/products/pms` & `/products/ims` version/size badges, (3) `/releases` changelog history, (4) SHA-256 checksum & verification blocks, and (5) `/releases/rss.xml`—eliminating manual multi-file updates.
- **Changelog UI:** Linear-inspired vertical timeline with sticky left date/version column (`font-mono tabular-nums`), instant vanilla-JS filter tabs (`All | Hosila PMS | Hosila IMS`), categorized sections (`Added`, `Improved`, `Fixed`, `Security & Integrity`), and per-release **"Download vX.Y.Z"** link.

---

### Phase 5: Commercial Infrastructure (`/pricing` & `/activate`)

This phase unlocks commercial checkout and puts **Hosila KeyGen online** for customers safely—maintaining **100% cryptographic compatibility** with `Hosila Keygen/HOSILA_ACTIVATION_ENGINE_SPEC.md` (`Ed25519` `HSL1.<payloadB64>.<sigB64>`) without ever exposing `hosila-master-private.pem`. **Publish pricing tiers and trial terms here only after the commercial model is finalized.**

#### 5.1 Non-Negotiable Cryptographic Security Rule
- **NEVER sign keys in client-side browser JavaScript.** Because every installed `.exe` verifies keys offline using the embedded public key (`MCowBQYDK2VwAyEAR27XVAxZEFcOz9eSFkR+W6DdRW4FAZKRqjttw4EiXzM=`), shipping `hosila-master-private.pem` to the browser would let anyone extract it and mint unlimited `master` keys.
- **Architecture:** The interactive **Self-Service Keygen UI** runs in the browser at `/activate`, while the actual `crypto.sign(null, Buffer.from("HSL1." + payloadB64), privKey)` runs exclusively inside the **server-side Astro API endpoint (`/api/license/generate`)** using an encrypted server environment secret (`HOSILA_MASTER_PRIVATE_PEM`).
- **Master Key Isolation:** Public web endpoints are strictly hardcoded to issue **`type: 'commercial'`** keys bound to a specific `product` (`hosila-pms` or `hosila-ims`) and specific `HSLA-XXXX-XXXX-XXXX` Machine ID—**never** `type: 'master'` or `machineId: '*'`. Personal Master keys remain exclusively in the offline `Hosila KeyGen.exe`.

#### 5.2 Commercial Checkout & Dual Payment Gateways (`/pricing`)
Matching `HOSILA_ACTIVATION_ENGINE_SPEC.md`: every active license unlocks **100% Full Access** with no artificial feature gates. Supported commercial terms (`Monthly`, `Yearly`, `Lifetime`, and optional `Trial`) are configured in one server/product catalog once finalized.

- **Currency & Payment Gateways:**
  - **Paystack** (primary for Nigeria/Africa: NGN `₦` Cards, Bank Transfer, USSD).
  - **Stripe / LemonSqueezy** (international USD `\$` cards).
- **Two Frictionless Customer Flows:**
  1. **"Buy Now, Bind PC Later" (Primary Recommended Flow):** Buyer pays from their phone or laptop -> webhook mints an **Order License Entitlement (`ORD-2026-XXXXXX`)** and emails it immediately -> later at the actual reception or store PC, they visit `/activate`, enter their Order Token + `HSLA-XXXX-XXXX-XXXX` Machine ID, and generate their signed `HSL1...` key.
  2. **"Already Installed — Instant Key":** Buyer already has the app running and their `HSLA-XXXX-XXXX-XXXX` Machine ID ready -> enters Business Name + Machine ID right inside checkout -> webhook immediately binds and delivers the signed `HSL1...` key on the confirmation screen and email.

#### 5.3 Online Self-Service Key Generation Portal (`/activate`)
Designed with the exact visual clarity of `Hosila PMS/src/components/ActivationGate.tsx`:
1. **Step 1 — Order Verification:** Customer enters their `Order ID / License Token` (`ORD-...`) and Purchase Email (verified via 6-digit email OTP or signed magic link so strangers cannot hijack an Order ID).
2. **Step 2 — Host PC Details:**
   - Displays Entitlement Summary (`Product: Hosila PMS`, `Term: 1 Year / Lifetime`, `Status: Ready to Bind`).
   - **Business / Hotel Name** input (`hotelName`, e.g., `"Grand Palms Hotel"`).
   - **Host PC Machine ID** input (`machineId`) with auto-uppercase formatting, live regex validation (`/^HSLA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/`), and an inline collapsible guide showing where to copy the ID inside `ActivationGate` or `Settings -> License & Activation`.
3. **Step 3 — Server-Side Signing (`POST /api/license/generate`):**
   - Validates entitlement ownership, active status, non-wildcard `product`, and strict `HSLA-...` format.
   - Atomically locks the entitlement to `machineId` (preventing one purchase from activating 50 hotels) and signs the exact `LicensePayload` contract:
     ```json
     {
       "v": 1,
       "id": "PMS-2026-8F2A1B",
       "product": "hosila-pms",
       "type": "commercial",
       "machineId": "HSLA-8F3A-92C1-4D0E",
       "hotelName": "Grand Palms Hotel",
       "issuedAt": "2026-11-23T22:00:00.000Z",
       "expiresAt": "2027-11-23T22:00:00.000Z"
     }
     ```
   - Logs issuance in `license_issuances` database table for support and auditability.
4. **Step 4 — Key Output & Guided Activation:**
   - Renders the generated `HSL1.<payload>.<sig>` token in `font-mono` with **Copy Activation Key** and **Download `.txt` Key Backup** buttons.
   - Shows decoded verification badges (`Product`, `Customer`, `Locked Machine ID`, `Expiry / Lifetime`) and 3 numbered steps to paste into the desktop app.
5. **Re-Retrieval, Renewals & Hardware Replacement Guardrails:**
   - **Lost Key Re-Display:** Re-authenticating with the same Order + `HSLA-...` Machine ID returns the valid key anytime without consuming a transfer.
   - **Subscription Renewal:** Extending an existing entitlement mints a fresh `HSL1` key with the new `expiresAt` for the bound `machineId`.
   - **Self-Service Hardware Migration (1/Year):** If a reception PC crashes and is replaced, allow **1 verified email-OTP Machine ID reassignment per 12 months** (recording old -> new `machineId` in the audit table); subsequent hardware changes route to Hosila Support.

#### 5.4 Minimal Relational Schema for Phase 5 (`license_orders` & `license_issuances`)
- `license_orders(id, order_code UNIQUE, gateway[paystack|stripe], gateway_ref UNIQUE, customer_email, product[hosila-pms|hosila-ims], term[monthly|yearly|lifetime], amount_minor, currency, bound_machine_id NULL, hotel_name NULL, expires_at NULL, transfers_used DEFAULT 0, status[paid|refunded|disputed], created_at)`
- `license_issuances(id, order_id FK, serial UNIQUE, product, machine_id, hotel_name, issued_at, expires_at NULL, ip_hash, user_agent)`
- **Security Controls:** Paystack `x-paystack-signature` (HMAC-SHA512) & Stripe webhook signature verification, idempotent webhook processing (`gateway_ref UNIQUE`), IP + email rate limiting on `/api/license/*`, and strict `Cache-Control: no-store` on `/api/license/*` responses ONLY.

---

## 9. Performance, Core Web Vitals & Accessibility Engineering Aspirations

> **Pragmatic Benchmarking Principle:** Treat the figures below as **engineering aspirations and design budgets**, not rigid synthetic guarantees. Always test on real mid-range Windows laptops and mobile phones, prioritizing genuine perceived speed and smooth interaction over chasing perfect synthetic Lighthouse scores. Keep the initial Phase 1 implementation clean and maintainable.

| Metric / Budget | Target Aspiration | Implementation Mechanism |
| --- | --- | --- |
| **Lighthouse Scores** | `95–100` (Perf, A11y, BP, SEO) | Static Astro HTML, zero React/framework hydration on marketing routes |
| **LCP (Largest Contentful Paint)** | `~1.5s–2.0s` on 4G/broadband | Inline critical CSS, hero headline + SVG poster at `t=0`, `fetchpriority="high"` on primary showcase frame, zero render-blocking scripts |
| **INP (Interaction to Next Paint)** | Crisp `< 50ms–100ms` feel | No main-thread JS frameworks; `scheduler.yield()` fallback for any heavy batch task; compositor-only (`transform`, `opacity`) animations |
| **CLS (Cumulative Layout Shift)** | Near-zero (`< 0.01`) | Explicit `width`/`height` on every `<img>`/`<picture>`, preloaded `woff2` fonts with `crossorigin`, `contain-intrinsic-size` on deferred sections |
| **Off-Screen GPU Conservation** | Minimal idle WebGL draw | `content-visibility: auto` + direct `contentvisibilityautostatechange` listener (+ `IntersectionObserver` fallback) pausing Three.js off-screen |
| **Navigation Speed** | Instant `bfcache` | Never use `Cache-Control: no-store` on public HTML pages; use `no-cache` / revalidation headers instead |

---

## 10. Pre-Launch QA & Design Constitution Verification Checklist

Before shipping each phase, verify every item below:
1. **Software Company Tone Audit:** Confirm the homepage and navigation read unmistakably as a **commercial software company** (not a hotel website), accurately distinguish **PMS Host-PC + LAN sync** (optional internet for Resend emails) from **IMS single-PC local storage**, clearly separate **PMS Integrated Restaurant Billing** from **Future Standalone Hosila POS**, and avoid publishing unfinalized pricing/trial promises before Phase 5.
2. **Dual-Theme & System Parity:** Test OS Light, OS Dark, manual Light override, and manual Dark override in Chrome, Firefox, and Safari—verify zero FOUC, crisp scrollbars (no WebKit flicker), and automatic Light/Dark mockup image switching.
3. **Design Constitution Audit (`design.md`):** Confirm **zero CSS gradients**, zero stray hues outside Canvas/Ink/`#6AD4B0`/`#E05252`, `#1D1D1F` text on every Mint primary CTA, `font-mono tabular-nums` on every price/version/checksum/Machine ID, and zero raw emojis in UI controls.
4. **Apple Fluidity & Reduced Motion Check (`apple-design`):** Verify `:active` pointer-down press feedback, critically damped tab/drawer transitions, Pause/Play control on the 3D Hosila emblem, and graceful static fallbacks under `prefers-reduced-motion: reduce`, `prefers-reduced-transparency: reduce`, and `prefers-contrast: more`.
5. **Browser & Dialog Edge Cases:** Test `<dialog closedby="any">` light-dismiss in Safari (verifying the bounding-box click fallback), shrinking header `scroll-padding-top` keyboard focus visibility, and Windows High Contrast (`forced-colors: active`).
6. **Service Worker Migration Check:** Verify `/sw.js` cleanly unregisters the legacy `vite-plugin-pwa` Workbox worker on browsers that previously visited the old site.
7. **Release Metadata & Cryptographic Verification (Phases 2, 4 & 5):** Verify publishing one Markdown release updates all 5 surfaces (`/downloads`, product pages, `/releases`, SHA-256 checksum, RSS), every download URL matches its published `SHA-256` hash, and real `HSL1` keys minted by `/api/license/generate` pass verification in both `Hosila PMS` (`server/license.ts`) and `Hosila IMS` (`crates/hosila-core/src/license/`)—confirming PMS rejects IMS keys, wrong-machine keys fail, and valid commercial keys activate cleanly offline.

---

## 11. Modern Web Guidance Compliance Reference

Key modern web platform decisions applied throughout this architecture (from `modern-web-guidance`):
- **`dark-mode`**: Set `color-scheme: light dark` on `:root` alongside `<meta name="color-scheme" content="light dark">`, `@media (prefers-color-scheme: dark)` custom-property fallbacks for `light-dark()`, and non-transitioned `scrollbar-color` with `@supports not (scrollbar-color: auto)` legacy fallbacks.
- **`dark-mode-toggle`**: Map `<meta name="color-scheme">` overrides back onto `:root` using `:has(> head > meta[name="color-scheme"][content="dark"|"light"])` and never erase stored overrides inside `matchMedia` listeners.
- **`motion`**: Provide an explicit Pause/Play button for the >5-second Three.js hero emblem, keep motion on `transform`/`opacity`, and scope reduced-motion rules per component rather than global millisecond overrides.
- **`efficient-background-processing`**: Attach `contentvisibilityautostatechange` directly to the heavy 3D/showcase containers (because the event does not bubble in some browsers) with an `IntersectionObserver` fallback to pause rendering off-screen.
- **`optimize-image-priority`**: Elevate the primary hero showcase mockup with `fetchpriority="high"` + eager loading, while omitting `fetchpriority="low"` on standard below-the-fold `loading="lazy"` mockups.
- **`cross-document-transitions`**: Opt in via `@view-transition { navigation: auto; }` inside `@media (prefers-reduced-motion: no-preference)`, relying on standard instant navigation in unsupported browsers.
- **`shrinking-header-on-scroll`**: Gate scroll-driven header shrinking behind `@supports ((animation-timeline: scroll()) and (animation-range: 0% 100%))`, declare timeline/range after the `animation` shorthand, and set `scroll-padding-top`.
- **`light-dismiss-a-dialog`**: Use native `<dialog closedby="any">` via `showModal()` paired with a bounding-box backdrop click listener for Safari.
- **`color`**: Use `color-mix(in oklab, ...)` instead of `in oklch` for neutral mixes, maintain >= 4.5:1 text / >= 3:1 UI contrast, and support `@media (forced-colors: active)`.
- **`performance`**: Preload self-hosted `.woff2` fonts with `crossorigin`, apply `content-visibility: auto` + `contain-intrinsic-size` to off-screen sections, and avoid `Cache-Control: no-store` on public pages to preserve `bfcache`.

