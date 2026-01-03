# Email Notification Setup Guide

## Setting Up Gmail SMTP for LoanLink

To enable email notifications when loan agreements are created, follow these steps:

### Step 1: Enable 2-Factor Authentication on Gmail
1. Go to https://myaccount.google.com/security
2. Under "How you sign in to Google", enable **2-Step Verification**

### Step 2: Generate an App Password
1. Visit https://myaccount.google.com/apppasswords
2. Select "Other (Custom name)"
3. Type "LoanLink" or any name you prefer
4. Click **Generate**
5. **Copy the 16-character password** (it looks like: `abcd efgh ijkl mnop`)

### Step 3: Set Environment Variables

#### On Windows (PowerShell):
```powershell
# Set environment variables for current session
$env:EMAIL_ADDRESS = "loan.linking@gmail.com"
$env:EMAIL_PASSWORD = "your-app-password-here"

# Or set them permanently (requires admin):
[System.Environment]::SetEnvironmentVariable("EMAIL_ADDRESS", "loan.linking@gmail.com", "User")
[System.Environment]::SetEnvironmentVariable("EMAIL_PASSWORD", "your-app-password-here", "User")
```

#### On Windows (Command Prompt):
```cmd
set EMAIL_ADDRESS=your.email@gmail.com
set EMAIL_PASSWORD=your-app-password-here
```

#### On macOS/Linux (Terminal):
```bash
export EMAIL_ADDRESS="your.email@gmail.com"
export EMAIL_PASSWORD="your-app-password-here"

# To make it permanent, add to ~/.bashrc or ~/.zshrc:
echo 'export EMAIL_ADDRESS="your.email@gmail.com"' >> ~/.bashrc
echo 'export EMAIL_PASSWORD="your-app-password-here"' >> ~/.bashrc
```

### Step 4: Restart the Server
After setting the environment variables, restart your Flask server:
```bash
# Stop current server (Ctrl+C)
# Then restart:
python server.py
```

### Step 5: Test Email Notifications
1. Create a new loan agreement
2. Enter a valid email address for the counterparty
3. Check the server console for:
   - ✅ Email sent to [email]
   - Or ⚠️ Email not configured (if variables not set)

## What Happens?

When you create a new loan agreement:
1. The counterparty receives a **professional HTML email** with:
   - Loan amount, interest rate, term
   - Monthly payment and total repayment
   - A "Review Loan Request" button linking to your app
   - Instructions for new users to sign up

2. Email will be sent from your Gmail address
3. Works for both existing users and new users (they'll need to sign up)

## Troubleshooting

### "Email not configured" message:
- Make sure environment variables are set correctly
- Restart the server after setting variables
- Check variable names are exact: `EMAIL_ADDRESS` and `EMAIL_PASSWORD`

### "Authentication failed" error:
- Verify you're using an **App Password**, not your regular Gmail password
- Double-check the app password (no spaces)
- Ensure 2-Factor Authentication is enabled on your Gmail account

### Email not received:
- Check spam/junk folder
- Verify the recipient email address is correct
- Gmail has a daily limit of ~100 emails for free accounts

## Security Notes

⚠️ **Never commit your actual credentials to version control!**
- Always use environment variables
- Add `.env` files to `.gitignore` if using them
- For production, use a service like SendGrid, Mailgun, or AWS SES

## Free Tier Limits

Gmail SMTP (Free):
- ~100 emails per day
- Perfect for testing and small-scale use
- For higher volume, consider SendGrid (100 emails/day free tier)
