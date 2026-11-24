# Hosila PMS — Design System & Strict UI Constitution

This document is the single source of truth for the visual language, design tokens, component patterns, and non-negotiable rules of **Hosila PMS**. Every new view, modal, drawer, table, chart, and email template must adhere strictly to these guidelines so the entire product feels cohesive, calm, and unmistakably crafted.

---

## 1. Design Language & Core Principles

Hosila PMS follows a **restrained Apple-inspired design language** engineered for high-throughput, high-stakes hospitality operations (front desk, restaurant POS, and double-entry accounting).

1. **Clarity & Generous White Space**: Every screen breathes. Rely on clean spacing, hairline dividers (`border-ink/10`), and typographic hierarchy rather than heavy boxes, nested cards, or decorative chrome.
2. **Flat, Solid Surfaces — Zero Gradients**: Never use CSS gradients (`bg-gradient-*`, `linear-gradient`, `radial-gradient`) anywhere in the application UI, charts, buttons, or email templates. Depth comes strictly from hairline borders, subtle opacity tints, and crisp elevation shadows on floating overlays (Modals, Drawers, HoverTips).
3. **Strict 3-Color Discipline (+ 1 Semantic Alert Color)**:
   - **Canvas / Surface** (background)
   - **Ink** (charcoal/white text & structural neutrals via opacity steps)
   - **Accent** (Soft Mint Green `#6AD4B0` for primary actions, active focus, positive indicators, and brand emphasis such as `Hosila` in the sidebar heading)
   - **Semantic Danger / Alert** (Soft Red `#E05252` reserved exclusively for unpaid balances, dirty/maintenance rooms, voids, refunds, overdue accounts, and destructive confirmations)
   - **Never introduce additional hues** (no blues, purples, oranges, yellows, or rainbow status palettes).
4. **Scannability Under Pressure**: Receptionists and cashiers must read room statuses, unpaid balances, and locked permissions in under one second using subtle left accent bars, tabular monospace numerals, and clear Lock cues.
5. **Context-Preserving Overlays**: Prefer right-side **Slide-Over Drawers** for inspecting records (Room Inspector, Order Settlement, Kitchen Docket/Receipt, Journal Voucher details) so the underlying board or ledger remains visible; reserve centered **Modals** for focused transactional forms and irreversible confirmations.
6. **Accessible Dual-Theme Parity**: Light Mode and Dark Mode are first-class citizens driven entirely by semantic CSS variables (`bg-canvas`, `bg-surface`, `text-ink`, `text-accent-ink`, `text-danger-ink`). Printed documents always force crisp Light Mode (`#FFFFFF` on `#1D1D1F`).

---

## 2. Color Tokens

All colors are defined in `src/index.css` via CSS custom properties and registered in Tailwind v4 `@theme inline`.

### Core Semantic Palette

| Token / Utility | Light Mode | Dark Mode | Purpose |
| --- | --- | --- | --- |
| `--color-canvas` (`bg-canvas`, `text-canvas`) | `#FFFFFF` | `#141416` | Primary page canvas, form input backgrounds, inverted button text on dark ink fills |
| `--color-surface` (`bg-surface`) | `#FFFFFF` | `#1C1C1F` | Cards, panels, modals, slide-over drawers, tooltips, table containers |
| `--color-ink` (`text-ink`, `bg-ink`, `border-ink`) | `#1D1D1F` | `#F2F2F7` | Primary text, headings, icons, borders, subtle tinted surfaces via opacity |
| `--color-accent` (`bg-[#6AD4B0]`, `border-[#6AD4B0]`) | `#6AD4B0` | `#6AD4B0` | Primary CTA fill, brand highlight, focus ring, available/clean indicators, active checkboxes |
| `--color-accent-ink` (`text-accent-ink`) | `#1E8665` | `#6AD4B0` | Contrast-safe accent text on light/dark backgrounds (e.g., `Hosila` brand wordmark, credits, positive variance) |
| `--color-danger` (`bg-[#E05252]`, `border-[#E05252]`) | `#E05252` | `#E05252` | Destructive CTA fill (Confirm Void), unpaid/dirty/overdue indicators |
| `--color-danger-ink` (`text-danger-ink`) | `#C83E3E` | `#F27272` | Contrast-safe alert text (open balance due, void reasons, unpaid POS tabs, validation errors) |

### Neutral Opacity Scale (Built from `--color-ink`)

Instead of hardcoded gray hexes (`gray-500`, `slate-200`, `zinc-800`), **always derive neutrals from `ink` opacity** so both Light and Dark themes remain optically balanced:

| Layer / Role | Utility Class | Usage |
| --- | --- | --- |
| Subtle tinted surface | `bg-ink/[0.02]` to `bg-ink/[0.04]` | Summary boxes, sidebar tint, hover states, disabled inputs |
| Segmented control track | `bg-ink/[0.05]` | Tab switchers, preset date ranges, Combined/Company/Personal toggle |
| Hairline divider | `border-ink/8` or `border-ink/10` | Table rows (`divide-ink/8`), modal header/footer separators, card borders |
| Interactive border | `border-ink/12` or `border-ink/15` | Secondary buttons, form inputs, modals, drawers |
| Muted / metadata text | `text-ink/45` or `text-ink/50` | Timestamps, helper captions, table column headers, empty states |
| Secondary body text | `text-ink/60` to `text-ink/70` | Subtitles, field labels, secondary descriptions |
| Primary text | `text-ink` | Headings, primary values, active tabs, table primary cells |

### Accent & Danger Surface Tints
- **Mint Highlight Fill**: `bg-[#6AD4B0]/12` or `bg-[#6AD4B0]/18` with `border-[#6AD4B0]/40` or `border-[#6AD4B0]/50`.
- **Mint Primary Button Text**: Always use explicit dark charcoal `#1D1D1F` (`text-[#1D1D1F]`) on `bg-[#6AD4B0]` in **both** Light and Dark modes to maintain WCAG AA contrast.
- **Danger Highlight Fill**: `bg-[#E05252]/[0.05]` to `bg-[#E05252]/[0.07]` with `border-[#E05252]/30` to `border-[#E05252]/40` and `text-danger-ink`.
- **Danger Primary Button Text**: Always `text-white` on `bg-[#E05252]`.

---

## 3. Typography & Optical Scaling

### Font Families
- **UI / Sans (`--font-sans`)**: `"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif`
  - Soft, geometric, warm legibility; weights `400`, `500`, `600`, `700`.
  - Enabled OpenType features: `font-feature-settings: "cv02", "cv03", "cv04", "cv11"`.
  - Dark mode body applies subtle `letter-spacing: 0.005em` to prevent halation on dark carbon surfaces.
- **Numbers / Codes / Accounting (`--font-mono`)**: `"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  - Weights `400`, `500`, `600`.
  - **Mandatory**: Every currency amount, room number, confirmation code, invoice/JV number, date (`YYYY-MM-DD`), tax percentage, and countdown MUST use `font-mono tabular-nums` so financial columns align vertically.

### Responsive Root Font Scaling
Defined on `html` in `src/index.css` so tablets stay crisp without horizontal crowding while large desktop monitors scale comfortably:

| Breakpoint | Root `font-size` | Target Device |
| --- | --- | --- |
| `< 960px` | `13.5px` | Portrait & compact tablets, POS terminals |
| `>= 960px` | `14.25px` | Landscape tablets & compact laptops |
| `>= 1200px` | `15px` | Standard desktop workstations |
| `>= 1440px` | `16px` | Wide reception & accounting monitors |

### Type Hierarchy
- **Page / Folio Title**: `text-2xl font-semibold tracking-tight text-ink`
- **Section / Modal Heading**: `text-base sm:text-lg font-semibold tracking-tight text-ink`
- **Card / Table Subheading**: `text-sm font-semibold text-ink`
- **KPI Metric Value**: `font-mono text-lg` (or `text-3xl` for primary Folio Balance) `font-semibold tabular-nums`
- **Body / Table Cells**: `text-sm text-ink` (secondary cells `text-xs text-ink/65`)
- **Form Labels**: `text-xs font-medium text-ink/65 mb-1.5`
- **Table Column Headers**: `text-xs font-medium text-ink/50`
- **Micro Labels / Section Tags**: `text-[11px] font-semibold uppercase tracking-wider text-ink/55` (use sparingly; never shout with all-caps across entire paragraphs).

---

## 4. Layout, Spacing, Radii & Elevation

### Application Shell
- **Sidebar**: Fixed sticky left rail (`w-56 xl:w-64`, collapsible to `w-[66px]`), `border-r border-ink/10`, `bg-ink/[0.025] dark:bg-surface`.
  - Brand heading displays `<span className="text-accent-ink">Hosila</span> PMS` above the active hotel name.
- **Main Content Area**: Clean `bg-canvas` workspace with generous padding and clear visual rhythm (`space-y-5` to `space-y-8` between major sections).
- **Tablet & Mobile Adaptation**: On `< md` viewports in Restaurant POS, replace side-by-side split panels with a **sticky bottom Current Ticket bar** that opens the ticket in a slide-over drawer on tap.

### Border Radius Scale
- **Small controls / inline chips / table action buttons**: `rounded-lg` (`8px`) or `rounded-md` (`6px`)
- **Primary buttons, form inputs, alerts, inner summary blocks**: `rounded-xl` (`12px`)
- **Cards, KPI tiles, modals, main folio sheet**: `rounded-2xl` (`16px`)
- **Status dots only**: `rounded-full` (`h-2 w-2` indicator dot). Avoid excessive floating pill badges everywhere—prefer clean text, subtle borders, or compact status bars.

### Elevation & Shadows
- **Static Cards / Tables**: No drop shadows (`shadow-none`). Rely purely on `border border-ink/10` or `border-ink/12`.
- **Segmented Active Tab**: Subtle lift `shadow-[0_1px_2px_rgba(29,29,31,0.08)]`.
- **HoverTip Tooltip**: `shadow-[0_10px_28px_rgba(29,29,31,0.14)] dark:shadow-[0_14px_36px_rgba(0,0,0,0.55)]`.
- **Slide-Over Drawer**: `shadow-[-16px_0_48px_rgba(0,0,0,0.16)] dark:shadow-[-16px_0_48px_rgba(0,0,0,0.55)]` with `backdrop-blur-[2px]` scrim (`bg-black/30 dark:bg-black/60`).
- **Modal Dialog**: `shadow-[0_24px_60px_rgba(0,0,0,0.18)] dark:shadow-[0_24px_60px_rgba(0,0,0,0.55)]` over `bg-black/40 dark:bg-black/65` scrim.

---

## 5. Component Patterns

### Buttons
- **Primary Action (Mint)**:
  `rounded-xl bg-[#6AD4B0] px-4 py-2 text-sm font-semibold text-[#1D1D1F] hover:bg-[#6AD4B0]/85 disabled:opacity-45 transition-colors`
- **Primary High-Contrast Neutral (e.g., Check Out Guest)**:
  `rounded-xl bg-ink px-4 py-2 text-xs font-medium text-canvas hover:opacity-85 transition-opacity`
- **Secondary / Outline**:
  `rounded-xl border border-ink/15 bg-surface px-3.5 py-2 text-xs font-medium text-ink hover:bg-ink/[0.04] transition-colors`
- **Ghost / Cancel**:
  `rounded-xl px-4 py-2 text-sm font-medium text-ink/65 hover:bg-ink/[0.05]`
- **Destructive Action (Void / Delete)**:
  - Confirmation CTA: `rounded-xl bg-[#E05252] px-4 py-2 text-sm font-semibold text-white hover:bg-[#E05252]/90`
  - Row trigger: `rounded-lg border border-[#E05252]/30 bg-surface text-danger-ink hover:bg-[#E05252]/10`
- **Locked / Role-Restricted Action (MANDATORY RULE)**:
  - Never silently vanish a core operational action blocked for Front Desk or Restaurant staff if they work on that screen.
  - Render the control **visible, dimmed, non-interactive (`disabled aria-disabled="true"`), with a `Lock` icon from `lucide-react`**, wrapped in a `<HoverTip>` stating which role is required:
    `rounded-xl border border-ink/12 bg-ink/[0.03] text-ink/55 opacity-50 cursor-not-allowed` (or `opacity-45` for compact icon-only table row actions).
  - Locked numeric inputs (e.g., catalog/nightly rates) use `readOnly`, `bg-ink/[0.04] text-ink/60 opacity-60 cursor-not-allowed`, and a `Lock` icon beside the field label.

### Room Board Status Bars (Fast-Scan Indicator)
Room cards use a compact vertical left accent bar so receptionists scan 30+ rooms instantly without reading every badge:
- **Soft Mint (`#6AD4B0`)**: Available & Clean (ready for immediate check-in)
- **Charcoal (`bg-ink`)**: Occupied & Clean (active stay in good standing)
- **Soft Red (`#E05252`)**: Dirty, Maintenance, or Occupied with overdue departure / open balance alert

### Forms & Inputs
- Standard input styling: `w-full rounded-xl border border-ink/15 bg-canvas px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/40`.
- Validation error border: `border-[#E05252]` accompanied by an inline message in `text-danger-ink` (never use `window.alert`).
- Focus ring: Global `:focus-visible` uses `outline: 2px solid var(--color-accent); outline-offset: 2px;`.
- Checkboxes & radio controls: `accent-[#6AD4B0]` (or `accent-[#E05252]` inside irreversible Void confirmation modals).

### Modals, Drawers & Keyboard Accessibility
- **Modals (`Modal.tsx`)**: Centered, `max-h-[92vh] overflow-y-auto`, close via backdrop click, top-right `X` button, or `Esc` key.
- **Drawers (`Drawer.tsx`)**: Right-aligned full-height panel (`max-w-lg` default), close via backdrop click, `X` button, or `Esc` key.
- **Global Shortcuts**: `Cmd/Ctrl + K` opens Global Quick Search; `Esc` closes the topmost overlay; `Enter` submits active forms or opens highlighted search results.
- **HoverTips (`HoverTip.tsx`)**: Portal-rendered tooltips with a `2000ms` intentional hover delay, viewport edge-flipping, and automatic light/dark surface styling so tooltips never clutter routine rapid clicking.

### Icons
- Use **`lucide-react`** exclusively for crisp, uniform 1.5–2px stroke line icons.
- Standard sizes: `h-3 w-3` (inline field lock cues), `h-3.5 w-3.5` (buttons & table actions), `h-4 w-4` (navigation, modal close, alert banners).
- Never use raw emojis in production UI controls, headings, or labels.

### Print & Thermal Receipt Styling
- Mark UI chrome (sidebar, action bars, filters, action columns, modals) with `.no-print`.
- Mark print-only mastheads/footers with `.print-only`.
- `@media print` forces Light Mode CSS tokens (`#FFFFFF` canvas, `#1D1D1F` ink), removes viewport scroll locks, and sizes thermal POS dockets/receipts cleanly via `.print-ticket-card` (`max-width: 340px`).

---

## 6. Strict Design Rules (Do / Don't Checklist)

| Rule | Mandatory Standard (DO) | Strictly Forbidden (DON'T) |
| --- | --- | --- |
| **Gradients** | Flat solid fills and subtle opacity tints (`bg-[#6AD4B0]/12`, `bg-ink/[0.03]`). | Any `bg-gradient-*`, `linear-gradient`, `radial-gradient`, or mesh background. |
| **Color Budget** | Canvas + Ink + Soft Mint `#6AD4B0` (+ Soft Red `#E05252` strictly for alerts/danger). | Adding blue, indigo, amber, yellow, purple, or multi-color status badges. |
| **Dark Mode** | Use semantic tokens (`bg-canvas`, `bg-surface`, `text-ink`, `text-accent-ink`, `text-danger-ink`). | Hardcoding `bg-white`, `text-black`, `bg-gray-100`, or `text-slate-600`. |
| **Financial Numbers** | `font-mono tabular-nums` right-aligned in tables with explicit `−` minus sign for credits/refunds. | Proportional sans-serif numerals or left-aligned currency columns. |
| **Inline Styles** | Tailwind CSS utility classes + CSS variables in `src/index.css`. | Arbitrary inline `style={{ ... }}` objects (only allowed for dynamic runtime coordinates such as fixed portal positioning or dynamic chart dimensions). |
| **Browser Dialogs** | Custom `Modal` / `VoidConfirmModal` components with clear consequence summaries. | `window.alert()`, `window.confirm()`, or `window.prompt()`. |
| **Blocked Actions** | Dimmed button/field (`opacity-45`–`60`, `cursor-not-allowed`) + `<Lock />` icon + `<HoverTip>`. | Leaving blocked controls unlabelled, silently failing on click, or hiding financial controls inconsistently across Front Desk screens. |
| **Empty States** | Calm, concise single-action empty state (e.g., *"No arrivals today"* + primary CTA). | Loud illustrations, placeholder lorem ipsum, or empty blank white boxes. |
| **Email Templates** | Table-based HTML matching the exact `#FFFFFF`, `#1D1D1F`, `#6AD4B0` palette, zero gradients, and inline CID or HTTPS hotel logo. | Heavy promotional graphics, unstyled raw links, or dark-only email HTML. |
| **Clean UI** | Show only hospitality-relevant metrics and workflows. | Developer telemetry, debug console logs, build hashes, or raw internal IDs in user-facing UI. |

---

## 7. Pre-Merge Visual QA Checklist

Before shipping any UI change in Hosila PMS, verify:
1. **Light & Dark Mode Check**: Toggle theme and inspect contrast on buttons, borders, table rows, inputs, dropdown `<option>` lists, HoverTips, and charts.
2. **Color & Gradient Audit**: Confirm zero gradients and zero stray colors outside Canvas, Ink, `#6AD4B0`, and `#E05252`.
3. **Typography Alignment**: Confirm every price, date, room number, and confirmation code uses `font-mono tabular-nums`.
4. **Role-Lock Audit**: View the screen as `front_desk` and `restaurant` to confirm every restricted action is dimmed with a `<Lock />` icon and helpful `<HoverTip>`.
5. **Responsive & Print Check**: Test at tablet portrait (`~768px`), standard desktop (`1280px`), and Print Preview (`Cmd/Ctrl + P`) to verify `.no-print` hides all UI chrome cleanly.
