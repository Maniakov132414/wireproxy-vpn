# Multi-Country Wireproxy + Dynamic Shift Rotator Launcher for Windows
$ErrorActionPreference = "SilentlyContinue"

$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $currentDir

$exePath = Join-Path $currentDir "wireproxy.exe"

# 1. Download wireproxy if missing
if (-not (Test-Path $exePath)) {
    Write-Host "[*] wireproxy.exe not found. Downloading..." -ForegroundColor Cyan
    $zipUrl = "https://github.com/windtf/wireproxy/releases/download/v1.1.3/wireproxy_windows_amd64.tar.gz"
    $tarPath = Join-Path $currentDir "wireproxy.tar.gz"
    Invoke-WebRequest -Uri $zipUrl -OutFile $tarPath
    tar -xzf $tarPath -C $currentDir
    Remove-Item $tarPath -Force
}

# 2. Stop any lingering wireproxy or rotator instances
taskkill /F /IM wireproxy.exe 2>$null
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*rotator.js*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500

# 3. Launch Master Supervisor Rotator
& node "$currentDir\rotator.js"
