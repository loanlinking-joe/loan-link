import os
import smtplib
from email.mime.text import MIMEText

def test_email_config():
    email = os.environ.get("EMAIL_ADDRESS")
    password = os.environ.get("EMAIL_PASSWORD")
    
    if not email or not password:
        print("❌ Error: EMAIL_ADDRESS or EMAIL_PASSWORD environment variables not set.")
        return

    print(f"Attempting to connect to Gmail SMTP with: {email}")
    
    try:
        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(email, password)
        print("✅ Success! SMTP login successful.")
        server.quit()
    except Exception as e:
        print(f"❌ Failed to connect/login: {str(e)}")
        print("\nPossible solutions:")
        print("1. Ensure '2-Step Verification' is ON in your Google Account.")
        print("2. Use a unique 16-character 'App Password' (not your normal password).")
        print("3. Check if your antivirus/firewall is blocking port 587.")

if __name__ == "__main__":
    test_email_config()
