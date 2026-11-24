================================================================================
HOSILA PMS — HOTEL PROPERTY MANAGEMENT, RESTAURANT POS & ACCOUNTING SUITE
================================================================================

1. WHAT HOSILA PMS DOES
--------------------------------------------------------------------------------
Hosila PMS is an all-in-one, local-first Hotel Property Management System built
for boutique hotels, resorts, and serviced residences. It runs on a local server
with real-time LAN/WLAN multi-workstation sync (WebSockets) and a single
self-contained SQLite database—so Front Desk, Housekeeping, Restaurant POS,
Accountants, Auditors, and Management all stay in sync in real time.

Core Capabilities:
  - Front Desk & Room Board: Live room occupancy, housekeeping readiness checks
    (check-in is blocked unless a room is marked Clean), color-coded status bars
    (soft mint green = available & clean, charcoal = occupied, soft red = dirty,
    maintenance, or overdue balance), and a right-side Room Inspector drawer.
  - Reservations & Room-Blocking Tape Chart: Visual horizontal Room x Date
    Tape Chart (14-day / 21-day views, floor filter, clickable empty cells to
    book immediately) plus a monthly Room Calendar.
  - Guest Folios & Stay Modifications:
    * Extend Stay: Extend by 1+ nights in the same room OR switch to a higher-
      or lower-rate clean room for the extended nights, assigning the extension
      charge to Personal Bill or Company Bill.
    * Move Room: Relocate an in-house guest to another clean room, automatically
      marking the old room Dirty, calculating upgrade/downgrade rate differences
      for remaining nights (with checkout-morning protection), and choosing
      Personal vs. Company billing.
    * Early Check-Out: Check out before the planned departure date with optional
      unused-night credit note recalculation.
    * Settle Later (Unpaid Check-Out / City Ledger): Management and Accountants
      can authorize checking out a guest with an open unpaid balance (e.g., VIP,
      corporate account, or friend of the hotel) with a mandatory authorization
      reason and optional due date. The open account surfaces automatically in
      Finance -> Unpaid Check-Outs so an Accountant can settle or waive it later.
    * Complimentary Bill Waivers: Management and Accountants can waive
      Accommodation, Food & Beverage, Ancillary Services, or the Full Bill in
      one click. Hosila posts itemized Contra-Revenue waiver lines and balanced
      double-entry vouchers with automatic VAT/Tax reversal.
    * Split Bills (Company vs. Personal) & Split Payments (Card + Cash + Bank
      Transfer in one checkout), Guest Refunds, and Credit Notes.
  - Restaurant POS & Order History: Touch-friendly menu catalog (with sticky
    bottom Current Ticket bar on portrait tablets), quick Sold / Restore stock
    toggles, Dine-In ("Place Order" unpaid tab vs. "Take Payment" immediate
    settlement), Room Service (post directly to checked-in guest folio), Kitchen
    Dockets, Guest Receipts, and paginated Order History (Last 30 Days default).
  - Double-Entry Accounting, Immutable Voiding & Audit Reports:
    * Balanced General Journal vouchers (Debits = Credits, sequential JV numbers,
      SHA-256 chain hashes), Charge-to-Payment Clearing, Trial Balance,
      transaction-level Tax Register (hidden when Tax is disabled), Expenses,
      and Extra Income.
    * Strict Anti-Tampering & Void Audit Report: Every void requires a reason
      (from customizable database presets or custom text) and explicit
      confirmation. Original records are never deleted—Hosila marks them voided,
      posts a balanced contra journal voucher, and logs every void in Finance ->
      Ledger & Audit -> Void Audit Report (exportable to Excel).
  - Database-Driven Custom Categories: Management can add, rename, or deactivate
    Expense categories, Extra Income categories, Restaurant Menu categories, and
    Void Reason presets in Settings -> Categories (zero hardcoded lists).
  - Night Audit & Disaster Recovery: Scheduled or manual Night Audit that rolls
    holdover room nights, locks daily snapshots, advances the hotel business
    date, and saves automatic SHA-256 verified SQLite backups. Management can
    download backups or perform a safeguarded Restore (which saves a Pre-Restore
    Snapshot first).
  - Staff Shift Handover & Cash Reconciliation: Opening float, live expected
    cash calculation (opening cash + cash received - cash refunds - cash
    expenses), and Over/Short variance tracking when closing a shift.
  - Guest Email Automation & Mobile-Reliable Branding: Customizable Reservation,
    Check-In, and Check-Out email templates via Resend. Both public HTTPS logo
    links and uploaded PNG/JPEG/WebP logos render reliably on phones (uploaded
    images are embedded automatically as inline CID email attachments).


2. STAFF ROLES, ACCESS CONTROL & LOCKED CONTROLS
--------------------------------------------------------------------------------
Hosila enforces role-based access control on both the server API and the user
interface. Whenever an action is blocked for Front Desk or Restaurant staff,
the button or control remains visible as a dimmed control with a Lock icon and
an explanatory hover tooltip so staff immediately know who to call for approval.

  - Management:
      Full access to all modules, Finance, Complimentary Bill Waivers, Unpaid
      Check-Outs (Settle Later), Transaction Voiding & Refunds, Night Audit,
      Backup Download & Safeguarded Backup Restore, Custom Categories, Staff
      Accounts, and Hotel Settings.
  - Accountant:
      Full access to Front Desk, Reservations, Guests, Restaurant, Finance,
      Accounting Ledgers, Trial Balance, Tax Register, Void Audit Report,
      Complimentary Bill Waivers, Unpaid Check-Outs (Settle Later), Transaction
      Voiding & Refunds, Night Audit, and Backup Download.
  - Auditor:
      Read-only Finance & Audit oversight plus financial review controls (can
      inspect all ledgers, Trial Balance, Tax Register, Void Audit Report, and
      void/reverse erroneous entries with an audit trail). Cannot record new
      expenses/income, authorize Settle Later unpaid check-outs, post
      complimentary bill waivers, run Night Audit, or restore backups.
  - Front Desk:
      Access to Front Desk (Dashboard & Room Board), Reservations (Tape Chart &
      Calendar), Guest Directory, Guest Folios, and Restaurant POS.
      Explicitly BLOCKED (dimmed with a Lock icon) from:
        * Checking out a guest with an unpaid balance (Settle Later)
        * Waiving bills (Accommodation, Food, Services, or Full Bill)
        * Issuing Refunds or Credit Notes
        * Voiding Folio Charges, Folio Payments, or Restaurant POS Orders
        * Overriding room catalog rates or stay nightly rates
        * Waiving room-upgrade fees or issuing downgrade/early-checkout credits
        * Accessing Finance or Hotel Settings
  - Restaurant:
      Scoped strictly to Restaurant POS & Order History (with a read-only
      in-house room picker for posting Room Service orders). Cannot open Guest
      Folios, void orders (dimmed + Lock icon), Finance, or Hotel Settings.


3. KEYBOARD SHORTCUTS & QUICK NAVIGATION
--------------------------------------------------------------------------------
  - Cmd + K (macOS) or Ctrl + K (Windows/Linux):
      Opens the Global Quick Search palette from anywhere in the app. Search
      instantly by Guest Name, Room Number (e.g., 204), Confirmation Code, or
      Phone Number, then use Up/Down arrows and press Enter to jump straight to
      the Guest Folio, Room Inspector, or Guest Profile.
  - Esc:
      Closes any open Modal, Slide-Over Drawer, or Global Quick Search.
  - Enter:
      Submits the active form or opens the highlighted item in Quick Search.
  - Hover Tips:
      Hover over unfamiliar buttons, locked controls, or accounting fields to
      read a concise explanation matching the active light/dark theme.


4. HOW TO USE HOSILA PMS — STEP BY STEP
--------------------------------------------------------------------------------

A. SIGNING IN & SHIFT HANDOVER
  1. Sign in with your staff username and password.
  2. Enter your Station Name (e.g., "Front Desk 1", "Bar Tablet") and your
     Opening Cash Drawer float to start your shift.
  3. To hand over at the end of your shift, click "Close Shift" in the sidebar:
     - Review the Shift Handover Summary showing Opening Cash, Cash Received,
       Cash Refunds, Cash Expenses, and Expected Cash in Drawer.
     - Count your physical drawer and enter Closing Cash. Hosila immediately
       flags Cash Exact, Cash Over, or Cash Short before you confirm.

B. RESERVATIONS & ROOM-BLOCKING TAPE CHART
  1. Open Reservations from the sidebar.
  2. Use the Tape Chart (default) to scan room availability horizontally across
     14 or 21 days. Filter by floor or shift dates with < 7d / Today / 7d >.
  3. Click any open cell on a room row to open New Reservation with that room
     and check-in date prefilled.
  4. Click any stay bar to open the Guest Folio directly.
  5. Toggle to "Room Calendar" at the top right for a monthly volume calendar.

C. CHECK-IN, ROOM BOARD & HOUSEKEEPING
  1. Open Front Desk -> Room Board.
  2. Scan room cards instantly using the left status bar:
     - Soft Mint Green = Available & Clean (ready for check-in)
     - Charcoal = Occupied & Clean
     - Soft Red = Dirty, Maintenance, or Occupied with overdue/unpaid checkout
  3. Click any room card to open the right-side Room Inspector drawer to toggle
     Clean / Dirty / Maintenance, inspect the active guest, start a walk-in
     booking, or open the Guest Folio.
  4. Check-in is automatically blocked if the assigned room is Dirty or under
     Maintenance—mark it Clean first, then check the guest in.

D. GUEST FOLIO: EXTEND STAY, MOVE ROOM, SPLIT BILLS, WAIVE BILL & SETTLE LATER
  Open any reservation, in-house stay, or checked-out stay to view its Folio:

  - Extend Stay (Same Room or Different Room):
    1. Click "Extend Stay" in the top bar and pick the new Check-Out Date.
    2. Keep the current room OR pick another clean, conflict-free room (higher
       or lower rate) from "Room for Extended Nights".
    3. Choose whether to bill the extension to "Personal Bill" or "Company Bill".
    4. Review the automatic nightly rate & tax preview and confirm. (If moving
       to a new room, the old room is automatically marked Dirty.)

  - Move Room (Upgrade / Downgrade / Maintenance Move):
    1. Click "Move Room" and pick a clean target room.
    2. For mid-stay moves with a rate difference, Management/Accountant/Auditor
       can choose whether to charge the upgrade/credit the downgrade (and assign
       it to Personal Bill or Company Bill) or uncheck the box to absorb the
       upgrade as complimentary. Front Desk moves automatically bill upgrades at
       catalog rate and lock complimentary waivers with a Lock icon.
    3. On checkout morning (0 remaining nights), Hosila relocates the guest
       without posting a retroactive charge for last night.

  - Complimentary Bill Waiver (Management & Accountant ONLY):
    1. Open the Guest Folio and click "Waive Bill" in the action bar.
    2. Tick Accommodation (Room & Taxes), Food & Beverage (Restaurant POS &
       Dining), Ancillary Services, or all sections for a full waiver.
    3. Enter the mandatory Authorization Reason (e.g., "Owner's guest — comp
       stay & dining") and optional approval reference, then click "Post Waiver".
    4. Hosila posts itemized negative Contra-Revenue lines and balanced journal
       vouchers with automatic VAT/Tax reversal. Front Desk sees a dimmed Lock
       button.

  - Check-Out & Settle Later (Pay After Check-Out):
    1. Click "Check Out Guest" (or "Early Check-Out" before the departure date).
    2. Normal Paid Check-Out: Enter the final payment (or click "Split Payment
       Across Methods" for Card + Cash + Transfer) so the balance reaches 0,
       then click "Complete Check-Out".
    3. Unpaid Check-Out ("Settle Later" — Management & Accountant ONLY):
       - Front Desk is blocked from checking out with an unpaid balance (the
         Settle Later section and Complete Check-Out button appear dimmed with
         a Lock icon).
       - Management or Accountant can tick "Allow Unpaid Check-Out (Settle
         Later / City Ledger)", enter the mandatory Authorization Reason /
         Guarantor Note and optional Expected Settlement Date, and complete the
         check-out. The room is released immediately as Dirty so the next guest
         can book it, while the folio remains open in Finance.
    4. Settling a "Settle Later" Account Days Later:
       - Open Finance -> Overview -> "Unpaid Check-Outs · Settle Later (City
         Ledger)" and click "Open Folio & Settle" on the guest's row.
       - Click "Settle Now" / "Record Payment" to log their Cash/Transfer/Card
         payment (or "Waive Remaining"), then optionally click "Email" to send
         the updated paid receipt.

  - Split Bills (Company vs. Personal):
    * Click "Auto-Split Corporate" to assign Room & Tax charges to Company and
      Restaurant/Services to Personal automatically, or click any charge's
      "Company / Personal" toggle individually.
    * Switch between Combined | Company | Personal tabs to inspect and print
      separate Company and Personal invoices.

  - Refunds, Credit Notes & Voiding (Management, Accountant & Auditor ONLY):
    * Click "Refund / Credit" to issue a Cash/Card/Transfer refund or post an
      itemized credit note.
    * Click the trash/undo icon on any Folio Charge, Folio Payment, POS Order,
      Expense, or Extra Income entry, choose or enter a Void Reason, and confirm.
      Front Desk and Restaurant accounts see a dimmed Lock icon on all void and
      refund controls.

E. RESTAURANT POS & ORDER HISTORY
  1. Open Restaurant -> POS.
  2. Tap menu items to add them to the Current Ticket. Click "Sold" on a dish
     card to temporarily mark an item out of stock ("Restore" to bring it back).
  3. On portrait tablets or smaller screens, tap the sticky bottom bar
     ("Current Ticket · N items") to open the ticket slide-over drawer.
  4. Choose Service Type:
     - Dine-In: Table # and Guest Name are optional. Click "Place Order" to
       open an unpaid tab (highlighted in soft red in Order History) or click
       "Take Payment" to record immediate payment.
     - Room Service: Select a Checked-In Room, then click "Post to Guest Folio"
       or "Post to Folio & Print Docket".
  5. Open Order History (Last 30 Days default with pagination):
     - Click "Settle" on any unpaid tab to open the settlement drawer.
     - Click "Docket" or "Receipt" to preview and print.

F. FINANCE, ACCOUNTING, VOID AUDIT REPORT & NIGHT AUDIT
  1. Open Finance (Management, Accountant, and Auditor roles).
  2. Overview & Departments:
     - KPI Strip: Revenue, Tax Collected (when Tax is enabled), Expenses, Net
       Operating Income, Avg Occupancy / ADR / RevPAR, Open Folio Balances, and
       Unpaid POS Tabs.
     - Unpaid Check-Outs (Settle Later / City Ledger): Lists every checked-out
       guest carrying an unpaid balance with one-click "Open Folio & Settle".
     - Revenue by Department & Trend Charts.
  3. Ledger & Audit:
     - Charge Clearing: Trace how each payment clears specific charges.
     - Double-Entry Journal: Sequential vouchers (JV-000001+) with SHA-256 chain
       hashes; click any voucher to inspect Debit/Credit lines.
     - Trial Balance: All-time balanced Debits = Credits verification.
     - Tax Register: Transaction-level tax ledger per rule (hidden if Tax is off).
     - Void Audit Report: Complete register of every voided folio charge,
       payment, POS order, expense, and extra income with original vs. voided
       timestamps, staff actor, reason, and linked contra journal voucher.
  4. Night Audit & Backups:
     - Review readiness and click "Run Night Audit" to close the hotel day.
     - Click "Backup Now" or ".db" to download verified backups. Management can
       click "Restore" (type RESTORE to confirm) with automatic Pre-Restore
       Snapshot protection.
  5. Use "Export Excel (.xlsx)" to export the active tab or "Print Report".

G. SETTINGS, HOTEL LOGO, EMAILS, CATEGORIES & LAN SYNC
  1. Settings -> Hotel Profile:
     - Upload a PNG/JPEG/WebP Hotel Logo (up to 500 KB) OR paste a public
       https:// logo URL. Both work in guest emails on mobile phones (uploaded
       logos are sent automatically as inline email attachments).
     - Set hotel name, address, currency symbol, Night Audit schedule, and
       backup retention.
  2. Settings -> Rooms & Rates / Restaurant Menu / Categories / Tax Rules /
     Email Templates / Staff Accounts / LAN Sync:
     - Customize all room types, menu items, Expense/Income/Menu/Void Reason
       categories, multi-rule taxes, Resend API email templates, and staff logins.
     - Open the LAN URL shown in Settings -> LAN Sync (e.g.,
       http://192.168.x.x:3000) on other computers/tablets on the same Wi-Fi to
       collaborate live via WebSockets.


5. RUNNING & BUILDING LOCALLY
--------------------------------------------------------------------------------
  - Install dependencies:   npm install
  - Development server:     npm run dev    (runs on http://localhost:3000)
  - Production build:       npm run build
  - Production server:      npm start

================================================================================
Powered by Hosila PMS
================================================================================
