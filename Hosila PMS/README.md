# Hosila PMS

**Hosila PMS** is a lightweight, offline-first, LAN-synchronized Property Management System built for independent hotels, boutique properties, and guest houses. It unifies front desk operations, reservations, guest folios, restaurant point-of-sale, hospitality accounting, night audit automation, and automated guest emails in a single local server that runs reliably across front desk, restaurant, and management workstations—even without an internet connection.

---

## Key Capabilities

### 1. Front Desk Operations
- **Dashboard**: Live property overview featuring occupancy, arrivals, departures, in-house guests, room housekeeping breakdown, and quick operational actions.
- **Room Board**: Interactive visual grid of all hotel rooms showing room type, nightly rate, occupancy state (`Available`, `Occupied`, `Reserved`, `Maintenance`), and housekeeping status (`Clean` / `Dirty`). Enforces housekeeping hygiene by preventing check-in into rooms not marked clean.
- **Reservations**: Calendar and list management for upcoming bookings, room assignment, check-in/check-out workflows, deposit recording, date validation, and boarding-pass-style reservation confirmations.
- **Guest Directory**: Searchable registry of current and returning guests with stay history, contact profiles, and direct access to individual folios.
- **Guest Folio**: Per-stay itemized billing view for room charges, taxes, restaurant room-service transfers, manual adjustments, partial or full payments, balance tracking, and print-ready guest invoices.

### 2. Restaurant POS *(Toggleable Module)*
- **Point of Sale**: Fast menu browsing by category with instant `Sold` / `Restore` item availability toggles.
- **Dine-In & Room Service Flows**:
  - **Dine-In**: Optional guest details; place open tabs (`Place Order`) for guests to pay after dining, or collect payment immediately (`Take Payment`).
  - **Room Service**: Requires selecting an active checked-in room; posts charges directly to the guest's folio with automatic tax calculation and kitchen docket printing.
- **Order History & Settlement**: Tracks all orders with unpaid tabs highlighted in soft red and paid orders clearly marked in mint green. Supports settling open tabs and reprinting kitchen dockets or customer receipts at any time.
- **Module Toggle**: Can be enabled or disabled from **Settings → Restaurant Menu** for lodging-only properties.

### 3. Finance, Accounting & Audit
- **Overview & Departments**: Executive KPIs (Total Revenue, Net Operating Income, Occupancy, ADR, RevPAR, Open Folio Balance, Unsettled Payments, and conditional Tax Collected), departmental breakdown, and interactive daily revenue & occupancy charts.
- **Ledger & Audit**:
  - **Charge & Payment Ledger**: Tracks every billable charge and links each payment directly to the specific charge(s) it clears (`Cleared`, `Partial`, `Unpaid`), creating an intuitive, transparent audit trail.
  - **Tax Register** *(shown when tax is enabled)*: Dedicated table tracking taxable base, tax rule applied, rate, tax mode (`Exclusive` / `Inclusive`), and collected tax amounts per transaction.
  - **General Journal**: Immutable double-entry accounting journal recording every financial event. Entries cannot be silently deleted—corrections use explicit **Void & Reverse** entries with reasons and staff attribution.
  - **Trial Balance**: Live verification that total debits equal total credits across all accounts.
- **Expenses & Extra Income**: Dedicated tracking for operating expenses (utilities, payroll, kitchen, maintenance, supplies, etc.) and non-folio income (conference halls, events, parking, spa, commissions).
- **Night Audit & Automated Backups**:
  - Scheduled or manual **Night Audit** rolls the hotel business date forward, reconciles open folios and daily revenue, posts nightly room charges, and snapshots the day's accounting state.
  - Automatic SQLite database backup triggered after each Night Audit with configurable retention count and one-click `.sqlite` backup downloads.
- **Context-Aware CSV Export & Print**: Export structured CSV spreadsheets or print clean reports tailored to whichever Finance tab or sub-view is currently active.

### 4. Multi-Rule Tax Engine
- Master on/off toggle—when disabled, all tax KPIs, tax registers, and tax lines automatically hide across the application.
- Supports **multiple concurrent tax rules** (e.g., VAT, Service Charge, Consumption Tax).
- Configurable per rule: tax name, percentage rate, **Exclusive** (added on top) vs. **Inclusive** (extracted from price), and scope (`Accommodation`, `Restaurant`, or `Both`).

### 5. Automated Guest Emails *(Optional)*
- Master email service toggle with per-event triggers for **Reservation Confirmation**, **Check-In Welcome**, and **Check-Out Receipt**.
- Integrates with **Resend** via an API key and verified sender address configured either in **Settings → Email Config** or environment variables.
- Customizable subject lines, headlines, body copy, and live HTML preview—including a structured boarding-pass-style stay summary card with deposit paid and balance due on reservation confirmations.
- Offline-resilient delivery queue logs sent, queued, and failed messages with one-click retry once connectivity returns.

### 6. Staff Roles, Shifts & LAN Sync
- **Role-Based Access Control**:
  - **Management & Accountant**: Full access to Front Desk, Restaurant POS, Finance & Accounting, Night Audit, and Settings.
  - **Front Desk**: Front Desk operations, Reservations, Guest Directory, Guest Folios, and Restaurant POS.
  - **Restaurant**: Focused access to Restaurant POS and Front Desk room lookup.
- **Shift Tracking**: Staff open a shift on sign-in and close out with closing cash reconciliation and shift notes.
- **Real-Time LAN Synchronization**: Multiple workstations on the same local network stay instantaneously synchronized via WebSockets, with a live LAN directory and workstation role tags (`Front Desk`, `Restaurant POS`, `Management Office`).

### 7. Interface & Ergonomics
- **Light & Dark Themes**: Soft neutral canvas paired with a soft mint green accent (`#6AD4B0`) and soft red (`#E05252`) for alerts, unsettled balances, expenses, and dirty rooms.
- **Adaptive Tablet-to-Desktop Scaling**: Automatically collapses the sidebar on tablet screens, scales typography optically by viewport width, locks top navigation tabs while scrolling view content, and provides 2-second hover tooltips on key controls.
- **Native Print Support**: Clean print layouts for guest folios, thermal kitchen dockets, customer receipts, guest directories, and financial reports.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Recharts
- **Backend**: Node.js, Express, WebSockets (`ws`)
- **Database**: Embedded SQLite (`better-sqlite3` in WAL mode) stored locally in `./data/`
- **Email Delivery**: Resend SDK (`resend`) *(optional; core operations run 100% offline)*

---

## Getting Started

### Prerequisites
- Node.js 20+ (with `npm`)

### Installation
```bash
npm install
```

### Environment Variables *(Optional)*
Copy `.env.example` to `.env` if you want to supply Resend credentials via environment variables (these can also be entered directly in **Settings → Email Config**):

```env
RESEND_API_KEY=re_xxxxxxxxx
RESEND_FROM_EMAIL="Your Hotel <reservations@yourdomain.com>"
```

### Running in Development
```bash
npm run dev
```
The server starts on **port 3000** (`http://localhost:3000`). On first launch, Hosila PMS opens the **Setup Wizard** to configure your hotel profile, currency, tax rules, and initial Management administrator account.

### Production Build & Start
```bash
npm run build
npm start
```

### Type Checking
```bash
npm run lint
```

---

## Local Network Access
Because Hosila PMS runs on a single host machine with an embedded SQLite database:
1. Run the server on one dedicated reception PC or mini-server on your hotel Wi-Fi/LAN.
2. Open **Settings → LAN Sync** to view the host machine's local IP address (e.g., `http://192.168.x.x:3000`).
3. Open that URL in any browser on tablets, restaurant terminals, or office computers connected to the same network—changes sync automatically in real time.

---

## Data & Backups
- The live SQLite database is stored in the local `data/` directory.
- Automated backups are generated after each Night Audit (and can also be triggered manually from **Finance → Night Audit & Backups**) and downloaded directly as `.sqlite` files for off-site archival.
