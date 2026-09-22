# Add a new WireGuard server configuration to the Wireproxy pool
param (
    [Parameter(Mandatory=$true)]
    [string]$FilePath,

    [Parameter(Mandatory=$false)]
    [string]$Name,

    [Parameter(Mandatory=$false)]
    [switch]$Push
)

$currentDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $currentDir
$configsDir = Join-Path $currentDir "configs"

if (-not (Test-Path $FilePath)) {
    Write-Host "[!] Error: File '$FilePath' not found!" -ForegroundColor Red
    exit 1
}

$raw = Get-Content $FilePath -Raw

# Extract Interface and Peer
if ($raw -notmatch "\[Interface\]" -or $raw -notmatch "\[Peer\]") {
    Write-Host "[!] Error: File does not appear to be a valid WireGuard configuration!" -ForegroundColor Red
    exit 1
}

# Determine next available ports
$existing = Get-ChildItem -Path $configsDir -Filter "*.conf" | ForEach-Object { Get-Content $_.FullName }
$usedPorts = @()
foreach ($line in $existing) {
    if ($line -match "BindAddress\s*=\s*[\w\.:]+:(\d+)") {
        $usedPorts += [int]$matches[1]
    }
}

$nextSocks = 25344
while ($usedPorts -contains $nextSocks) { $nextSocks += 2 }
$nextHttp = $nextSocks + 1

if (-not $Name) {
    $Name = [System.IO.Path]::GetFileNameWithoutExtension($FilePath).Replace("wg-", "").Replace("wireproxy-", "")
}

$targetConf = Join-Path $configsDir "wireproxy-$Name.conf"

# Remove any existing [Socks5] or [http] in source file
$cleanConfig = $raw -replace "(?ms)\[Socks5\].*", ""
$cleanConfig = $cleanConfig -replace "(?ms)\[http\].*", ""
$cleanConfig = $cleanConfig.Trim()

$proxyBlock = @"


[Socks5]
BindAddress = 0.0.0.0:$nextSocks

[http]
BindAddress = 0.0.0.0:$nextHttp
"@

$finalContent = $cleanConfig + $proxyBlock
Set-Content -Path $targetConf -Value $finalContent -Encoding utf8

Write-Host "==========================================================" -ForegroundColor Green
Write-Host " Server added successfully!" -ForegroundColor Green
Write-Host " - Name:       $Name" -ForegroundColor Cyan
Write-Host " - Config:     $targetConf" -ForegroundColor Cyan
Write-Host " - SOCKS5:     0.0.0.0:$nextSocks" -ForegroundColor Cyan
Write-Host " - HTTP:       0.0.0.0:$nextHttp" -ForegroundColor Cyan
Write-Host " - Pool:       Will be auto-included on port 10800" -ForegroundColor Green

# If Wireproxy pool is currently running locally, start the new instance immediately
$runningWireproxies = Get-Process wireproxy -ErrorAction SilentlyContinue
if ($runningWireproxies) {
    $wireproxyBin = Join-Path $currentDir "wireproxy.exe"
    if (Test-Path $wireproxyBin) {
        Write-Host " [*] Local pool is active - starting wireproxy for $Name..." -ForegroundColor Yellow
        Start-Process -FilePath $wireproxyBin -ArgumentList "-c `"$targetConf`"" -WindowStyle Hidden
        Write-Host " [+] New instance launched and active in local pool!" -ForegroundColor Green
    }
}

# If -Push switch provided or user wants to sync to Railway
if ($Push) {
    Write-Host " [*] Auto-pushing to GitHub for Railway auto-deployment..." -ForegroundColor Yellow
    git add $targetConf
    git commit -m "feat: add $Name wireproxy server"
    git push origin main
    Write-Host " [+] Pushed to GitHub! Railway will automatically rebuild and deploy." -ForegroundColor Green
} else {
    Write-Host " [*] To push to Railway automatically, run: git commit -am 'add server'; git push" -ForegroundColor Gray
}

Write-Host "==========================================================" -ForegroundColor Green
