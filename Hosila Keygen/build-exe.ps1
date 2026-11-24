$ErrorActionPreference = "Stop"
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if (-not (Test-Path $csc)) {
  $csc = "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
}
if (-not (Test-Path $csc)) {
  throw "Windows .NET Framework C# compiler (csc.exe) not found."
}

# Generate a proper Windows .ico from Hosila icon logo.png (PNG-in-ICO format, crisp 256x256)
$icoPath = Join-Path $dir "hosila.ico"
$logoPng = Resolve-Path (Join-Path $dir "..\public\hosila-logo.png") -ErrorAction SilentlyContinue
if ($logoPng) {
  Add-Type -AssemblyName System.Drawing
  $srcImg = [System.Drawing.Image]::FromFile($logoPng.Path)
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
  # ICONDIR header
  $bw.Write([UInt16]0)
  $bw.Write([UInt16]1)
  $bw.Write([UInt16]1)
  # ICONDIRENTRY (256x256 PNG)
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
  Write-Host "[OK] Created Hosila icon: $icoPath" -ForegroundColor Green
}

$srcFile = Join-Path $dir "src\Program.cs"
$outExe = Join-Path $dir "Hosila KeyGen.exe"

$args = @(
  "/nologo",
  "/target:winexe",
  "/optimize+",
  "/r:System.Windows.Forms.dll",
  "/out:$outExe"
)
if (Test-Path $icoPath) {
  $args += "/win32icon:$icoPath"
}
$args += $srcFile

& $csc @args
if ($LASTEXITCODE -ne 0) {
  throw "Compilation failed with exit code $LASTEXITCODE"
}

Write-Host "`n[SUCCESS] Built portable GUI executable: $outExe" -ForegroundColor Cyan
Write-Host "You can now double-click 'Hosila KeyGen.exe' directly (no CMD window, exact sticky-note size!)."

