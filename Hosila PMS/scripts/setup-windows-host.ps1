<#
.SYNOPSIS
  Hosila PMS — Windows Host PC Setup Helper (Run as Administrator)

.DESCRIPTION
  Prepares a Windows Host PC for single-host LAN distribution:
  1. Creates the persistent data directory under C:\ProgramData\Hosila PMS\data
  2. Adds a Windows Defender Firewall inbound rule allowing LAN workstations on TCP port 3000
  3. Checks Windows sleep settings and advises disabling sleep on AC power so LAN terminals stay connected
#>

param(
  [int]$Port = 3000,
  [string]$DataDir = "C:\ProgramData\Hosila PMS\data"
)

$ErrorActionPreference = "Stop"

Write-Host "=== Hosila PMS Windows Host Setup ===" -ForegroundColor Cyan

# 1. Persistent Data Directory
if (-not (Test-Path $DataDir)) {
  New-Item -ItemType Directory -Path $DataDir -Force | Out-Null
  Write-Host "[OK] Created data directory: $DataDir" -ForegroundColor Green
} else {
  Write-Host "[OK] Data directory exists: $DataDir" -ForegroundColor Green
}

# 2. Windows Firewall Rule for LAN Access
$ruleName = "Hosila PMS Local Network (TCP $Port)"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if (-not $existing) {
  New-NetFirewallRule `
    -DisplayName $ruleName `
    -Direction Inbound `
    -Protocol TCP `
    -LocalPort $Port `
    -Profile Private `
    -Action Allow `
    -Description "Allows front-desk, restaurant POS, and management devices on the hotel LAN to access Hosila PMS." | Out-Null
  Write-Host "[OK] Added Windows Firewall inbound rule for TCP port $Port (Private LAN)." -ForegroundColor Green
} else {
  Write-Host "[OK] Windows Firewall rule already exists: $ruleName" -ForegroundColor Green
}

# 3. Prevent Host PC from sleeping on AC power
try {
  powercfg /change standby-timeout-ac 0 | Out-Null
  Write-Host "[OK] Disabled AC sleep timeout so LAN workstations remain connected." -ForegroundColor Green
} catch {
  Write-Host "[WARN] Could not adjust sleep policy automatically. Please disable Sleep on AC power in Windows Settings." -ForegroundColor Yellow
}

Write-Host "`nHosila PMS Host PC setup complete." -ForegroundColor Cyan
Write-Host "Tip: Set a static IP or DHCP reservation for this PC on your hotel router so the LAN link never changes."

