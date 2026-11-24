# Hosila Suite — Production Build, Packaging, Verification & Deployment Guide

This guide documents the complete end-to-end engineering workflow for **Hosila Suite**: building Windows `.exe` installers (`Hosila PMS`, `Hosila IMS`, and internal `Hosila Keygen`), building and verifying the **Hosila Website**, committing safely to GitHub, uploading installers to **Vercel Blob**, and deploying live to **`https://hosila.com`** on **Vercel**.

---

## 1. Repository & Project Architecture

```text
Hosila Suite/
├── Hosila PMS/          # Hotel Management (React + Vite + Express + SQLite + C# Windows wrapper)
├── Hosila IMS/          # Central Store & Inventory (Tauri v2 + Rust hosila-core + React + SQLite)
├── Hosila Keygen/       # INTERNAL ONLY — Offline Ed25519 license signer (NEVER commit private .pem!)
├── Hosila Website/      # Pure Vanilla HTML5/CSS/JS + Three.js/GSAP + Markdown releases + Starlight docs
├── Hosila Releases/     # Local staging folder for built .exe installers (gitignored; hosted on Vercel Blob)
├── design.md            # Hosila Design Constitution
├── PRODUCTION_BUILD.md  # This runbook
└── .gitignore           # Blocks secrets (*.pem, *.key, .env), databases (*.db), node_modules, target, *.exe
```

### Live Production Infrastructure
- **GitHub Repository:** `https://github.com/Gito1916/Hosila-Suite` (branch: `main`)
- **Vercel Team:** `godstimes-projects-97b4170b` (`team_pAC1j0Rf07Rll8jTZ9n4Pbj5`)
- **Vercel Project:** `hosila-website` (`prj_uYtUaV3zUpHY5YikkB249tAeiEy6`)
  - **Root Directory:** `Hosila Website`
  - **Framework Preset:** `Other` (`null`)
  - **Build Command:** *(empty — pre-built static HTML/CSS/JS)*
  - **Output Directory:** `.`
- **Production Domains:** `https://hosila.com` (primary) and `https://www.hosila.com` (`301` → `https://hosila.com`)
  - *(Note: `app.hosila.com` and `admin.hosila.com` live on separate Vercel projects — do not alter them.)*
- **Vercel Blob Store:** `hosila-releases` (`store_sD6k88hbtArXLRqt`, public access)
- **Sales Contact Channels (Website):** WhatsApp `09063814659` (`https://wa.me/2349063814659`) · Email `Hosilateam@gmail.com`

---

## 2. Building Windows `.exe` Installers

### Prerequisites (Windows Build Machine)
- **Node.js 22+** & **npm** (if `node` is not on global PATH, the bundled runtime at `Hosila PMS\release\Hosila-PMS\runtime\node.exe` can run pure Node scripts).
- **Windows .NET Framework 4.x `csc.exe`** (`C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe` — built into Windows; used by PMS & Keygen launchers/installers).
- **Rust toolchain (`rustup`, `cargo`) + MSVC Build Tools + WebView2** (required for **Hosila IMS** Tauri v2 builds).

---

### A. Hosila PMS (`Hosila-PMS-Setup.exe`)
1. Bump `"version"` in `Hosila PMS/package.json` if shipping a new release.
2. Run typecheck and production verification:
   ```powershell
   cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila PMS"
   npm run lint
   npm test
   ```
3. Build the standalone portable package and single-file Windows installer:
   ```powershell
   npm run build:exe
   ```
   **What `scripts/build-exe.ps1` does automatically:**
   - Compiles the React/Vite frontend (`dist/`) and bundles `server.ts` via `esbuild` (`dist-server/server.mjs`).
   - Generates a 256×256 `.ico` from `public/hosila-logo.png` and compiles `Hosila PMS.exe` (system-tray launcher) + uninstaller via `csc.exe`.
   - Bundles `runtime\node.exe`, minimal production `node_modules` (including `better-sqlite3`), and `Setup Windows Host (LAN Firewall).bat`.
   - Zips `release\Hosila-PMS\` to `release\Hosila-PMS-Windows-x64.zip` and embeds it into **`release\Hosila-PMS-Setup.exe`**.
4. Copy the finished installer into local staging:
   ```powershell
   Copy-Item "release\Hosila-PMS-Setup.exe" "..\Hosila Releases\Hosila-PMS-Setup.exe" -Force
   ```

---

### B. Hosila IMS (`Hosila-IMS-Setup.exe`)
1. Bump `"version"` in `Hosila IMS/package.json`, `Hosila IMS/src-tauri/tauri.conf.json`, and `Hosila IMS/Cargo.toml` / `src-tauri/Cargo.toml`.
2. Run Rust core tests and frontend typecheck:
   ```powershell
   cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila IMS"
   cargo test
   npm run typecheck
   ```
3. Build the Tauri v2 NSIS Windows installer:
   ```powershell
   npm run tauri build
   ```
   **Output:** `Hosila IMS\src-tauri\target\release\bundle\nsis\Hosila IMS_<version>_x64-setup.exe`.
4. Copy and standardize the filename in local staging:
   ```powershell
   Copy-Item "src-tauri\target\release\bundle\nsis\Hosila IMS_*_x64-setup.exe" "..\Hosila Releases\Hosila-IMS-Setup.exe" -Force
   ```

---

### C. Hosila Keygen (`Hosila KeyGen.exe` — INTERNAL ONLY)
> **SECURITY RULE:** Never deploy `Hosila Keygen`, `Hosila KeyGen.exe`, or `hosila-master-private.pem` to the website, GitHub, or Vercel Blob. License signing is strictly offline on your authorized admin PC.

```powershell
cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila Keygen"
powershell -ExecutionPolicy Bypass -File .\build-exe.ps1
```
**Output:** `Hosila Keygen\Hosila KeyGen.exe` (also copy to `..\Hosila Releases\Hosila KeyGen.exe` for local backup only — never upload to Blob).

---

## 3. Uploading New Installers to Vercel Blob

Installers are served directly from the public **`hosila-releases`** Vercel Blob store (`store_sD6k88hbtArXLRqt`) and mapped behind clean URLs (`/api/download/hosila-pms` and `/api/download/hosila-ims`) in `Hosila Website/vercel.json`.

### Option 1 — Upload via Vercel Dashboard (No CLI needed)
1. Open **Vercel Dashboard → `hosila-website` → Storage → `hosila-releases` → Browser**.
2. Upload your new installers into versioned paths:
   - `hosila-pms/<version>/Hosila-PMS-Setup.exe`
   - `hosila-ims/<version>/Hosila-IMS-Setup.exe`
3. Copy each file's public **Download URL** (ending in `?download=1`).

### Option 2 — Upload via Node.js Script (Automated)
Set `BLOB_READ_WRITE_TOKEN` in your current PowerShell session (retrieve it from **Vercel Dashboard → `hosila-website` → Settings → Environment Variables** — never commit this token):

```powershell
$env:BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_..."
$version = "1.0.0"

node -e "
const fs = require('fs');
const path = require('path');
const token = process.env.BLOB_READ_WRITE_TOKEN;
const ver = process.env.version || '1.0.0';
const baseDir = 'c:\\\\Users\\\\Administrator\\\\Desktop\\\\Hosila Suite\\\\Hosila Releases';
const files = [
  { local: 'Hosila-PMS-Setup.exe', remote: 'hosila-pms/' + ver + '/Hosila-PMS-Setup.exe' },
  { local: 'Hosila-IMS-Setup.exe', remote: 'hosila-ims/' + ver + '/Hosila-IMS-Setup.exe' },
];
(async () => {
  for (const f of files) {
    const buf = fs.readFileSync(path.join(baseDir, f.local));
    const res = await fetch('https://blob.vercel-storage.com/' + f.remote, {
      method: 'PUT',
      headers: {
        Authorization: 'Bearer ' + token,
        'x-api-version': '7',
        'x-add-random-suffix': '0',
        'x-content-type': 'application/octet-stream',
        'content-type': 'application/octet-stream',
      },
      body: buf,
    });
    const json = await res.json();
    if (!res.ok) throw new Error(JSON.stringify(json));
    console.log('UPLOADED:', f.local, '->', json.downloadUrl);
  }
})();
"
```

### Wire New Blob URLs into `Hosila Website/vercel.json`
Update the two download redirect destinations in `Hosila Website/vercel.json` (and `Hosila Website/_redirects` for parity):
```json
{
  "source": "/api/download/hosila-pms",
  "destination": "https://sd6k88hbtarxlrqt.public.blob.vercel-storage.com/hosila-pms/<version>/Hosila-PMS-Setup.exe?download=1",
  "permanent": false
},
{
  "source": "/api/download/hosila-ims",
  "destination": "https://sd6k88hbtarxlrqt.public.blob.vercel-storage.com/hosila-ims/<version>/Hosila-IMS-Setup.exe?download=1",
  "permanent": false
}
```

---

## 4. Building & Verifying the Hosila Website

The website in `Hosila Website/` uses **pure Vanilla HTML5 + CSS + JS ES modules**, with **Three.js + GSAP** served locally from `/vendor/`, Markdown release notes in `releases-md/*.md`, and static **Astro Starlight** docs in `docs-starlight/`.

### Adding a New Product Release Note
1. Add or edit a Markdown file in `Hosila Website/releases-md/` (e.g., `pms-1.1.0.md` or `ims-1.1.0.md`).
   - Keep copy in **plain hospitality business language** (no developer/infrastructure jargon).
2. Rebuild/sync all static HTML pages, RSS feed, `robots.txt`, and `sitemap.xml`:
   ```powershell
   cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila Website"
   # If only marketing pages, CSS, JS, or releases-md changed:
   node .\scripts\sync-site.mjs

   # If docs-starlight/ guides also changed:
   npm run build
   ```
   *(If `npm` is not on PATH, run `node .\node_modules\astro\astro.js build --root .\docs-starlight`, then `node .\scripts\copy-docs.mjs`, then `node .\scripts\sync-site.mjs`.)*

### Updating Real App Screenshots (Optional, After Major UI Changes)
```powershell
cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila Website"
npm run mockups:update
```

### Local Preview & Verification Checklist
1. Start the local hardened static server:
   ```powershell
   cd "c:\Users\Administrator\Desktop\Hosila Suite\Hosila Website"
   $env:HOST = "127.0.0.1"; $env:PORT = "4321"
   node .\server\server.mjs
   ```
2. Verify before committing:
   - **Theme Default:** First visit loads **Dark theme** (`#141416`) cleanly; header Light/Dark toggle switches both UI and app screenshots smoothly.
   - **Mobile (`375px`):** Zero horizontal overflow across `/`, `/products/pms`, `/products/ims`, `/products/pos`, `/products/compare`, `/downloads`, `/releases`, `/pricing`, `/contact`; header logo has comfortable side padding (`>= 18px` mobile, `>= 24px` desktop).
   - **WhatsApp Sales Form (`/contact`):** Submitting opens `https://wa.me/2349063814659?text=...` with Name, Business Name, Product, Request Type, Plan, and optional Machine ID pre-filled; email fallback links to `Hosilateam@gmail.com`.
   - **SEO & Security:** `/robots.txt` (`200`), `/sitemap.xml` (`200`, 18 canonical URLs), `/activate` (`301` → `/contact`), `/releases/rss.xml` (`200`), zero developer jargon in customer-facing text.

---

## 5. Git Commit & Push Workflow

Always commit from the **`Hosila Suite/`** root folder.

```powershell
cd "c:\Users\Administrator\Desktop\Hosila Suite"

# 1. Inspect changes
git status

# 2. Stage updates
git add .

# 3. MANDATORY SAFETY AUDIT — Confirm ZERO private keys, DBs, or .exe binaries are staged
git diff --cached --name-only | Select-String -Pattern '\.(pem|key|db|sqlite|exe|msi|env)$|private'

# 4. Commit and push to main (triggers automatic Vercel production deployment)
git commit -m "Describe your change clearly"
git push origin main
```

> **Never force-add ignored files (`git add -f`).** `.gitignore` protects `*.pem`, `*.key`, `.env`, `*.db`, `node_modules/`, `target/`, `Hosila Releases/`, `Hosila PMS/release/`, and `*.exe`.

---

## 6. Post-Deploy Live Production Verification

Wait ~10–15 seconds after `git push origin main` for Vercel to finish deploying, then run this live smoke test against **`https://hosila.com`**:

```powershell
node -e "
(async () => {
  const urls = [
    'https://hosila.com/',
    'https://hosila.com/downloads',
    'https://hosila.com/pricing',
    'https://hosila.com/contact',
    'https://hosila.com/robots.txt',
    'https://hosila.com/sitemap.xml',
    'https://www.hosila.com/',
    'https://hosila.com/activate',
    'https://hosila.com/api/download/hosila-pms',
    'https://hosila.com/api/download/hosila-ims',
  ];
  for (const u of urls) {
    const r = await fetch(u, { method: 'HEAD', redirect: 'manual' });
    console.log(r.status, r.headers.get('location') || '', u);
  }
})();
"
```

**Expected Result:**
- Main pages, `robots.txt`, and `sitemap.xml` return **`200`**.
- `https://www.hosila.com/` returns **`301`** → `https://hosila.com/`.
- `https://hosila.com/activate` returns **`301`** → `/contact`.
- `/api/download/hosila-pms` and `/api/download/hosila-ims` return **`307`** → public Vercel Blob `?download=1` URLs.
