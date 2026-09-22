# Multi-Country Wireproxy + Auto-Rotating Proxy Launcher for Windows
$ErrorActionPreference = "Stop"

$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $currentDir

$exePath = Join-Path $currentDir "wireproxy.exe"

# 1. Download wireproxy if missing
if (-not (Test-Path $exePath)) {
    Write-Host "[*] wireproxy.exe not found. Downloading..." -ForegroundColor Cyan
    $zipUrl = "https://github.com/pufferffish/wireproxy/releases/download/v1.0.8/wireproxy_windows_amd64.tar.gz"
    $tarPath = Join-Path $currentDir "wireproxy.tar.gz"
    Invoke-WebRequest -Uri $zipUrl -OutFile $tarPath
    tar -xzf $tarPath -C $currentDir
    Remove-Item $tarPath -Force
}

# 2. Stop any old wireproxy or rotator instances
Get-Process -Name wireproxy -ErrorAction SilentlyContinue | Stop-Process -Force
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*rotator.js*" } | Stop-Process -Force
Start-Sleep -Milliseconds 500

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Launching Dynamic Wireproxy Country Instances..." -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green

$configDir = Join-Path $currentDir "configs"
$configFiles = Get-ChildItem -Path $configDir -Filter "*.conf" -ErrorAction SilentlyContinue

if ($configFiles.Count -eq 0) {
    Write-Host "[!] No .conf files found in configs/ folder!" -ForegroundColor Red
    exit 1
}

$jobs = @()
foreach ($file in $configFiles) {
    Write-Host " [+] Starting $($file.Name)..." -ForegroundColor Cyan
    $proc = Start-Process -FilePath $exePath -ArgumentList "-s -c `"$($file.FullName)`"" -PassThru -WindowStyle Hidden
    $jobs += $proc
}

Start-Sleep -Seconds 2

Write-Host "`nAll $($configFiles.Count) Wireproxy country instances are running!" -ForegroundColor Green
Write-Host "Starting Dynamic Rotating Pool on Port 10800..." -ForegroundColor Cyan

try {
    & node "$currentDir\rotator.js"
} finally {
    Write-Host "`nCleaning up wireproxy processes..." -ForegroundColor Yellow
    foreach ($j in $jobs) {
        if (-not $j.HasExited) { Stop-Process -Id $j.Id -Force }
    }
}
