$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Push-Location $RootDir
try {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

    Write-Host "Building frontend production assets..." -ForegroundColor Cyan
    pnpm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }

    Write-Host "Building hosila-ims release binary..." -ForegroundColor Cyan
    cargo build --release -p hosila-ims
    if ($LASTEXITCODE -ne 0) { throw "Cargo release build failed" }

    $ExePath = Join-Path $RootDir "target\release\hosila-ims.exe"
    if (-not (Test-Path $ExePath)) {
        throw "Expected release binary not found at $ExePath"
    }

    $OutRoot = Join-Path $RootDir "dist-portable"
    $BundleDir = Join-Path $OutRoot "Hosila-IMS-Portable"
    $ZipPath = Join-Path $OutRoot "Hosila-IMS-Portable.zip"

    if (Test-Path $BundleDir) { Remove-Item -Recurse -Force $BundleDir }
    if (Test-Path $ZipPath) { Remove-Item -Force $ZipPath }
    New-Item -ItemType Directory -Force -Path $BundleDir | Out-Null

    Copy-Item $ExePath (Join-Path $BundleDir "Hosila IMS.exe")
    New-Item -ItemType File -Force -Path (Join-Path $BundleDir "portable.flag") | Out-Null

    $Readme = @"
Hosila IMS - Portable Edition
=============================

Because `portable.flag` sits beside `Hosila IMS.exe`, the database, daily
backups, and logs are stored locally inside `.\data\` in this folder rather than
%LOCALAPPDATA%.

Requirements:
- Windows 10 / 11 (x64) with Microsoft Edge WebView2 Runtime installed.
- Run from a fast local SSD/NVMe drive (not a network UNC share).

To back up or move the installation cleanly:
1. Close Hosila IMS.
2. Copy the entire `Hosila-IMS-Portable` folder (including `data\hosila.db`).
"@
    Set-Content -Path (Join-Path $BundleDir "README-PORTABLE.txt") -Value $Readme -Encoding UTF8

    Compress-Archive -Path "$BundleDir\*" -DestinationPath $ZipPath -Force
    Write-Host "Portable bundle created: $ZipPath" -ForegroundColor Green
}
finally {
    Pop-Location
}
