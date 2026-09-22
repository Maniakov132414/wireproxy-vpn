# Automated launcher for Wireproxy on Windows
$ErrorActionPreference = "Stop"

$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $currentDir

$exePath = Join-Path $currentDir "wireproxy.exe"
$confPath = Join-Path $currentDir "wireproxy.conf"

# 1. Check if wireproxy.exe exists, download if missing
if (-not (Test-Path $exePath)) {
    Write-Host "[*] wireproxy.exe not found. Downloading official release..." -ForegroundColor Cyan
    $zipUrl = "https://github.com/pufferffish/wireproxy/releases/download/v1.0.8/wireproxy_windows_amd64.tar.gz"
    $tarPath = Join-Path $currentDir "wireproxy.tar.gz"
    
    Invoke-WebRequest -Uri $zipUrl -OutFile $tarPath
    Write-Host "[*] Extracting..." -ForegroundColor Cyan
    tar -xzf $tarPath -C $currentDir
    Remove-Item $tarPath -Force
}

# 2. Check configuration
if (-not (Test-Path $confPath)) {
    Write-Host "[!] wireproxy.conf not found! Creating from template..." -ForegroundColor Yellow
    Copy-Item (Join-Path $currentDir "protonvpn.conf.example") $confPath
    Write-Host "[!] Please edit wireproxy.conf with your WireGuard PrivateKey & PublicKey before running." -ForegroundColor Yellow
    notepad.exe $confPath
    exit
}

# Check if placeholder keys exist
$content = Get-Content $confPath -Raw
if ($content -match "YOUR_PRIVATE_KEY_HERE") {
    Write-Host "[!] You need to replace YOUR_PRIVATE_KEY_HERE with your real ProtonVPN WireGuard keys!" -ForegroundColor Yellow
    notepad.exe $confPath
    exit
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Starting Wireproxy..." -ForegroundColor Green
Write-Host " SOCKS5 Proxy: socks5://127.0.0.1:25344" -ForegroundColor Cyan
Write-Host " HTTP Proxy:   http://127.0.0.1:25345" -ForegroundColor Cyan
Write-Host " Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Green

& $exePath -c $confPath
