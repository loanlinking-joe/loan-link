# LoanLink Startup Script
# Run this to start the server with email notifications enabled

# Set email credentials
$env:EMAIL_ADDRESS = "loan.linking@gmail.com"
$env:EMAIL_PASSWORD = "your-new-app-password-here"

# Start the server
Write-Host "Starting LoanLink server with email notifications..." -ForegroundColor Green
Write-Host "Email: $env:EMAIL_ADDRESS" -ForegroundColor Cyan
Write-Host ""

# Ensure we are in the correct directory
Set-Location $PSScriptRoot

python server.py
