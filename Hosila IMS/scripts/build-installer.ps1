$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$SuiteRoot = Split-Path -Parent $RootDir
$ReleaseOut = Join-Path $SuiteRoot "Hosila Releases\Hosila-IMS-Setup.exe"

Push-Location $RootDir
try {
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"

    $NodeExe = $null
    $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($NodeCmd) {
        $NodeExe = $NodeCmd.Source
    } elseif (Test-Path (Join-Path $SuiteRoot "Hosila PMS\release\Hosila-PMS\runtime\node.exe")) {
        $NodeExe = Join-Path $SuiteRoot "Hosila PMS\release\Hosila-PMS\runtime\node.exe"
    } elseif (Test-Path "$env:LOCALAPPDATA\Programs\Antigravity IDE\Antigravity IDE.exe") {
        $NodeExe = "$env:LOCALAPPDATA\Programs\Antigravity IDE\Antigravity IDE.exe"
        $env:ELECTRON_RUN_AS_NODE = "1"
    } else {
        throw "No Node.js runtime found to run Vite and Tauri CLI."
    }

    $TauriConf = Get-Content (Join-Path $RootDir "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
    $Version = [string]$TauriConf.version

    Write-Host "Building Hosila IMS v$Version frontend (TypeScript + Vite)..." -ForegroundColor Cyan
    & $NodeExe ".\node_modules\typescript\bin\tsc" --noEmit
    if ($LASTEXITCODE -ne 0) { throw "TypeScript check failed with exit code $LASTEXITCODE" }

    & $NodeExe ".\node_modules\vite\bin\vite.js" build
    if ($LASTEXITCODE -ne 0) { throw "Vite production build failed with exit code $LASTEXITCODE" }

    Write-Host "Building Hosila IMS v$Version NSIS installer (.exe)..." -ForegroundColor Cyan
    $TmpTauriConfig = Join-Path $env:TEMP "hosila-ims-tauri-release.json"
    '{"build":{"beforeBuildCommand":""}}' | Set-Content -Path $TmpTauriConfig -Encoding ASCII
    try {
        & $NodeExe ".\node_modules\@tauri-apps\cli\tauri.js" build --bundles nsis --config $TmpTauriConfig
        if ($LASTEXITCODE -ne 0) { throw "Tauri NSIS bundle failed with exit code $LASTEXITCODE" }
    }
    finally {
        Remove-Item $TmpTauriConfig -Force -ErrorAction SilentlyContinue
    }

    $NsisDir = Join-Path $RootDir "target\release\bundle\nsis"
    $ExpectedSetup = Join-Path $NsisDir "Hosila IMS_${Version}_x64-setup.exe"
    if (-not (Test-Path $ExpectedSetup)) {
        $Found = Get-ChildItem -Path $NsisDir -Filter "*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $Found) {
            throw "Expected NSIS setup installer not found in $NsisDir"
        }
        $ExpectedSetup = $Found.FullName
    }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $ReleaseOut) | Out-Null
    Copy-Item $ExpectedSetup $ReleaseOut -Force

    $Item = Get-Item $ReleaseOut
    Write-Host "Released v$Version setup: $($Item.FullName) ($([Math]::Round($Item.Length / 1MB, 2)) MB)" -ForegroundColor Green
}
finally {
    Pop-Location
}
