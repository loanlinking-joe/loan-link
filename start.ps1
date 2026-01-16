# LoanLink Startup Script
# Run this to start the server with email notifications enabled

# Set email credentials
$env:EMAIL_ADDRESS = "loanlinking@gmail.com"
$env:EMAIL_PASSWORD = "vfpm kyvs hwxa iykh"

# Start the server
Write-Host "Starting LoanLink server with email notifications..." -ForegroundColor Green
Write-Host "Email: $env:EMAIL_ADDRESS" -ForegroundColor Cyan
Write-Host ""

# Ensure we are in the correct directory
Set-Location $PSScriptRoot

python server.py
