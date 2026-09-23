taskkill /F /IM wireproxy.exe 2>$null
Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*rotator.js*" } | Stop-Process -Force
Write-Host "All Wireproxy and Rotator processes stopped." -ForegroundColor Green
