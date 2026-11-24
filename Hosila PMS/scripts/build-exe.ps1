<#
.SYNOPSIS
  Builds the standalone Windows .exe package for Hosila PMS.

.DESCRIPTION
  Produces a self-contained portable Windows package in release\Hosila-PMS\:
    - Hosila PMS.exe            (Native Windows GUI + System Tray launcher with Hosila icon)
    - runtime\node.exe          (Bundled Node.js runtime — no Node install required on hotel PC)
    - app\dist\                 (Compiled offline-first frontend)
    - app\dist-server\server.mjs(Compiled production server bundle)
    - app\node_modules\         (Minimal server runtime dependencies + better-sqlite3 native binary)
    - Setup Windows Host (LAN Firewall).bat
  Also archives release\Hosila-PMS-Windows-x64.zip for distribution.
#>

$ErrorActionPreference = "Stop"
$rootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $rootDir

Write-Host "`n=== Building Hosila PMS Standalone Windows .exe Package ===`n" -ForegroundColor Cyan

# 1. Verify C# compiler & Node.js
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "Windows .NET Framework C# compiler (csc.exe) not found."
}

$nodeCmd = Get-Command node -ErrorAction Stop
$nodeExeSrc = $nodeCmd.Source
Write-Host "[1/6] Using Node.js runtime: $nodeExeSrc" -ForegroundColor Green

# 2. Build production frontend + backend
Write-Host "[2/6] Compiling frontend (Vite) & backend (esbuild)..." -ForegroundColor Green
& npm run build
if ($LASTEXITCODE -ne 0) {
  throw "npm run build failed with exit code $LASTEXITCODE"
}

# 3. Prepare clean release staging folder
$releaseRoot = Join-Path $rootDir "release"
$pkgDir = Join-Path $releaseRoot "Hosila-PMS"
$appDir = Join-Path $pkgDir "app"
$runtimeDir = Join-Path $pkgDir "runtime"

if (Test-Path $pkgDir) {
  Remove-Item -Recurse -Force $pkgDir
}
New-Item -ItemType Directory -Path $appDir, $runtimeDir, (Join-Path $appDir "dist-server"), (Join-Path $pkgDir "scripts") -Force | Out-Null

# 4. Generate 256x256 Hosila .ico & compile Hosila PMS.exe
Write-Host "[3/6] Generating Hosila icon & compiling Hosila PMS.exe..." -ForegroundColor Green
$icoPath = Join-Path $releaseRoot "hosila.ico"
$logoPng = Join-Path $rootDir "public\hosila-logo.png"
if (Test-Path $logoPng) {
  Add-Type -AssemblyName System.Drawing
  $srcImg = [System.Drawing.Image]::FromFile($logoPng)
  $bmp = New-Object System.Drawing.Bitmap(256, 256)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.Clear([System.Drawing.Color]::Transparent)
  $g.DrawImage($srcImg, 0, 0, 256, 256)
  $ms = New-Object System.IO.MemoryStream
  $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
  $pngBytes = $ms.ToArray()
  $g.Dispose(); $bmp.Dispose(); $srcImg.Dispose(); $ms.Dispose()

  $fs = [System.IO.File]::Create($icoPath)
  $bw = New-Object System.IO.BinaryWriter($fs)
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]1)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([Byte]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]32)
  $bw.Write([UInt32]$pngBytes.Length)
  $bw.Write([UInt32]22)
  $bw.Write($pngBytes)
  $bw.Close(); $fs.Close()
}

$outExe = Join-Path $pkgDir "Hosila PMS.exe"
$launcherSrc = Join-Path $rootDir "scripts\launcher\Program.cs"
$cscArgs = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/r:System.Windows.Forms.dll",
  "/r:System.Drawing.dll",
  "/out:$outExe"
)
if (Test-Path $icoPath) {
  $cscArgs += "/win32icon:$icoPath"
}
$cscArgs += $launcherSrc

& $csc @cscArgs
if ($LASTEXITCODE -ne 0) {
  throw "C# compilation of Hosila PMS.exe failed with exit code $LASTEXITCODE"
}

$manifestPath = Join-Path $rootDir "scripts\installer\admin.manifest"
$outUninstallExe = Join-Path $pkgDir "Uninstall Hosila PMS.exe"
$uninstallSrc = Join-Path $rootDir "scripts\installer\UninstallProgram.cs"
$uninstallArgs = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/r:System.Windows.Forms.dll",
  "/r:System.Drawing.dll",
  "/r:System.IO.Compression.dll",
  "/r:System.IO.Compression.FileSystem.dll",
  "/win32manifest:$manifestPath",
  "/out:$outUninstallExe"
)
if (Test-Path $icoPath) {
  $uninstallArgs += "/win32icon:$icoPath"
}
$uninstallArgs += $uninstallSrc

& $csc @uninstallArgs
if ($LASTEXITCODE -ne 0) {
  throw "C# compilation of Uninstall Hosila PMS.exe failed with exit code $LASTEXITCODE"
}

# 5. Copy bundled Node runtime, compiled frontend, server bundle, and minimal runtime node_modules
Write-Host "[4/6] Bundling Node.js runtime, dist/, server.mjs, and lean runtime node_modules..." -ForegroundColor Green
Copy-Item $nodeExeSrc (Join-Path $runtimeDir "node.exe") -Force
Copy-Item (Join-Path $rootDir "dist") (Join-Path $appDir "dist") -Recurse -Force
Copy-Item (Join-Path $rootDir "public") (Join-Path $appDir "public") -Recurse -Force
Copy-Item (Join-Path $rootDir "dist-server\server.mjs") (Join-Path $appDir "dist-server\server.mjs") -Force
Copy-Item (Join-Path $rootDir "scripts\setup-windows-host.ps1") (Join-Path $pkgDir "scripts\setup-windows-host.ps1") -Force

# Minimal runtime package.json (ESM)
@'
{
  "name": "hosila-pms",
  "private": true,
  "type": "module"
}
'@ | Set-Content -Path (Join-Path $appDir "package.json") -Encoding UTF8

# Copy only the transitive production dependencies required by dist-server/server.mjs
$copyDepsScript = @'
import fs from "node:fs";
import path from "node:path";

const rootModules = path.resolve(process.argv[2]);
const destModules = path.resolve(process.argv[3]);
const roots = ["dotenv", "express", "ws", "better-sqlite3", "resend"];

const visited = new Set();

function resolvePkgDir(name, fromDir) {
  let cur = fromDir;
  while (true) {
    const candidate = path.join(cur, "node_modules", name);
    if (fs.existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(cur);
    if (parent === cur) break;
    cur = parent;
  }
  const top = path.join(rootModules, name);
  return fs.existsSync(path.join(top, "package.json")) ? top : null;
}

function collect(pkgName, fromDir) {
  const pkgDir = resolvePkgDir(pkgName, fromDir);
  if (!pkgDir) return;
  const rel = path.relative(rootModules, pkgDir);
  if (visited.has(rel)) return;
  visited.add(rel);

  const target = path.join(destModules, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(pkgDir, target, {
    recursive: true,
    force: true,
    filter: (src) => {
      const base = path.basename(src);
      if (base === "node_modules" && src !== pkgDir) return false;
      return true;
    },
  });

  const pkgJson = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8"));
  const deps = {
    ...(pkgJson.dependencies || {}),
    ...(pkgJson.optionalDependencies || {}),
  };
  for (const depName of Object.keys(deps)) {
    collect(depName, pkgDir);
  }
}

for (const name of roots) {
  collect(name, path.dirname(rootModules));
}
console.log(`Bundled ${visited.size} runtime packages.`);
'@

$tmpDepScript = Join-Path $releaseRoot "_copy-runtime-deps.mjs"
$copyDepsScript | Set-Content -Path $tmpDepScript -Encoding UTF8
& $nodeExeSrc $tmpDepScript (Join-Path $rootDir "node_modules") (Join-Path $appDir "node_modules")
if ($LASTEXITCODE -ne 0) {
  throw "Failed to copy runtime dependencies."
}
Remove-Item $tmpDepScript -Force -ErrorAction SilentlyContinue

# Create Windows Host LAN Firewall helper launcher
@'
@echo off
title Hosila PMS - Windows Host LAN Setup
echo Running Hosila PMS Windows Host Setup (Firewall + Data Directory)...
powershell -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-ExecutionPolicy Bypass -NoExit -File \"%~dp0scripts\setup-windows-host.ps1\"'"
'@ | Set-Content -Path (Join-Path $pkgDir "Setup Windows Host (LAN Firewall).bat") -Encoding ASCII

# 6. Smoke-test the bundled server.mjs using the bundled runtime\node.exe
Write-Host "[5/6] Verifying bundled runtime\node.exe + app\dist-server\server.mjs..." -ForegroundColor Green
& (Join-Path $runtimeDir "node.exe") --check (Join-Path $appDir "dist-server\server.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "Bundled server.mjs syntax check failed!"
}

# Create distributable zip payload
Write-Host "[6/7] Creating distributable payload release\Hosila-PMS-Windows-x64.zip..." -ForegroundColor Green
$zipPath = Join-Path $releaseRoot "Hosila-PMS-Windows-x64.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}
Compress-Archive -Path $pkgDir -DestinationPath $zipPath -CompressionLevel Optimal

# 7. Compile single-file Windows Installer (Hosila-PMS-Setup.exe) with embedded payload
Write-Host "[7/7] Compiling single-file Windows Installer release\Hosila-PMS-Setup.exe..." -ForegroundColor Green
$pkgMeta = Get-Content (Join-Path $rootDir "package.json") -Raw | ConvertFrom-Json
$appVersion = if ($pkgMeta.version) { [string]$pkgMeta.version } else { "1.0.0" }
$verInfoCs = Join-Path $releaseRoot "_VersionInfo.cs"
@"
namespace HosilaPMSSetup
{
    internal static class BuildInfo
    {
        public const string Version = "$appVersion";
    }
}
"@ | Set-Content -Path $verInfoCs -Encoding UTF8

$setupExe = Join-Path $releaseRoot "Hosila-PMS-Setup.exe"
$setupSrc = Join-Path $rootDir "scripts\installer\SetupProgram.cs"
$setupArgs = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/r:System.Windows.Forms.dll",
  "/r:System.Drawing.dll",
  "/r:System.IO.Compression.dll",
  "/r:System.IO.Compression.FileSystem.dll",
  "/win32manifest:$manifestPath",
  "/resource:$zipPath,HosilaPayload.zip",
  "/out:$setupExe"
)
if (Test-Path $icoPath) {
  $setupArgs += "/win32icon:$icoPath"
}
$setupArgs += $setupSrc
$setupArgs += $verInfoCs

& $csc @setupArgs
Remove-Item $verInfoCs -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) {
  throw "C# compilation of Hosila-PMS-Setup.exe failed with exit code $LASTEXITCODE"
}

$exeSizeKb = [Math]::Round((Get-Item $outExe).Length / 1KB, 1)
$uninstallSizeKb = [Math]::Round((Get-Item $outUninstallExe).Length / 1KB, 1)
$setupSizeMb = [Math]::Round((Get-Item $setupExe).Length / 1MB, 2)
$zipSizeMb = [Math]::Round((Get-Item $zipPath).Length / 1MB, 2)
Write-Host "`n[SUCCESS] Hosila PMS Windows Installer & Package ready!" -ForegroundColor Cyan
Write-Host "  Installer   : $setupExe ($setupSizeMb MB — single-file setup)"
Write-Host "  App EXE     : $outExe ($exeSizeKb KB)"
Write-Host "  Uninstaller : $outUninstallExe ($uninstallSizeKb KB)"
Write-Host "  Portable Zip: $zipPath ($zipSizeMb MB)`n"

