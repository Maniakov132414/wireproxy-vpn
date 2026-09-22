# Stop all wireproxy and rotator processes on Windows
Write-Host "[*] Stopping Wireproxy processes..." -ForegroundColor Yellow
Get-Process -Name wireproxy -ErrorAction SilentlyContinue | Stop-Process -Force
Write-Host "[+] All wireproxy instances stopped." -ForegroundColor Green
