---
product: "hosila-pms"
productLabel: "Hosila PMS"
version: "0.9.5"
publishedAt: "2026-10-18"
channel: "stable"
fileName: "Hosila-PMS-Setup.exe"
downloadUrl: "/api/download/hosila-pms"
summary: "Added clear staff permission locks, reliable hotel logo display in guest emails, and shift handover cash reconciliation."
highlights:
  - "Clear 5-role staff permissions with lock indicators and helpful tooltips"
  - "Shift Handover cash drawer counting with automatic over/short summary"
  - "Improved hotel logo rendering on mobile guest confirmation and receipt emails"
breakingChanges: false
---

### Improved
- **Clear Staff Permissions:** Restricted actions for front-desk and restaurant staff remain visible with a clear lock indicator and helpful note instead of vanishing unexpectedly.
- **Guest Email Presentation:** Your uploaded hotel logo displays reliably across phone and desktop email apps whenever guest confirmation or checkout receipt emails are enabled.

### Fixed
- Resolved a date-boundary issue when moving a guest to another room on the morning of checkout so no extra night is charged by mistake.
