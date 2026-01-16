import sqlite3
import hashlib
import uuid
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime, timedelta
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import socket
import resend # New: API-based email

# FORCE IPv4: This fixes "Network is unreachable" errors on cloud providers like Render
orig_getaddrinfo = socket.getaddrinfo
def getaddrinfo_ipv4(host, port, family=0, type=0, proto=0, flags=0):
    return orig_getaddrinfo(host, port, socket.AF_INET, type, proto, flags)
socket.getaddrinfo = getaddrinfo_ipv4

app = Flask(__name__, static_url_path='', static_folder='.')
CORS(app)

# Absolute path for the database to ensure it works on all platforms
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(BASE_DIR, "loanlink.db")

# Global error handler to catch crashes and return them as JSON
@app.errorhandler(Exception)
def handle_exception(e):
    print(f"CRITICAL ERROR: {str(e)}", flush=True)
    return jsonify({
        "error": "Server Error",
        "details": str(e)
    }), 500

@app.route('/uploads/<path:filename>')
def serve_upload(filename):
    uploads_dir = os.path.join(BASE_DIR, 'uploads')
    return send_from_directory(uploads_dir, filename)

@app.route('/api/debug-users')
def debug_users():
    conn = get_db_connection()
    users = conn.execute('SELECT email FROM users').fetchall()
    conn.close()
    return jsonify([u['email'] for u in users])

@app.route('/api/admin/nuke-database')
def nuke_database():
    try:
        if os.path.exists(DB_NAME):
            # Close any active connections if possible (not really possible here globally, but os.remove will try)
            os.remove(DB_NAME)
            # Re-init immediately
            init_db()
            return "💥 Database Nuked. Everything is fresh. Go to Signup now!"
        else:
            init_db()
            return "Database didn't exist, but I've initialized it anyway."
    except Exception as e:
        return f"Error during nuke: {str(e)}"

# Email Configuration (Gmail SMTP)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 465
SENDER_EMAIL = os.environ.get("EMAIL_ADDRESS", "onboarding@resend.dev")
SENDER_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")
RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")

if RESEND_API_KEY:
    resend.api_key = RESEND_API_KEY

def init_db():
    # Only the first worker to start should successfully run full initialization
    # We use a long timeout to wait for other workers to finish
    try:
        conn = sqlite3.connect(DB_NAME, timeout=60)
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=60000')
        c = conn.cursor()
        
        # User Table
        c.execute('''CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            name TEXT,
            token TEXT,
            alias TEXT,
            contact TEXT,
            dob TEXT
        )''')
        
        # Loan Table
        c.execute('''CREATE TABLE IF NOT EXISTS loans (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lender_email TEXT NOT NULL,
            borrower_email TEXT NOT NULL,
            creator_email TEXT,
            counterparty_name TEXT,
            asset_type TEXT DEFAULT 'currency',
            item_name TEXT,
            item_description TEXT,
            item_condition TEXT,
            amount REAL,
            rate REAL,
            months INTEGER,
            interest_type TEXT,
            monthly_payment REAL,
            total_repayment REAL,
            paid_amount REAL DEFAULT 0,
            status TEXT DEFAULT 'active',
            created_at TEXT
        )''')

        # Reset Tokens Table
        c.execute('''CREATE TABLE IF NOT EXISTS reset_tokens (
            email TEXT PRIMARY KEY,
            token TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            FOREIGN KEY(email) REFERENCES users(email)
        )''')

        # Payments Table
        c.execute('''CREATE TABLE IF NOT EXISTS payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            loan_id INTEGER,
            amount REAL,
            date TEXT,
            FOREIGN KEY(loan_id) REFERENCES loans(id)
        )''')

        # Listings (Marketplace) Table
        c.execute('''CREATE TABLE IF NOT EXISTS listings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_email TEXT NOT NULL,
            item_name TEXT NOT NULL,
            description TEXT,
            charge REAL,
            deposit REAL,
            location TEXT,
            tenure INTEGER,
            status TEXT DEFAULT 'active',
            created_at TEXT
        )''')

        # Migrations (Safe multi-run)
        for col in ['alias', 'contact', 'dob']:
            try: c.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
            except: pass

        for col in ['creator_email', 'asset_type', 'item_name', 'item_description', 'item_condition']:
            try: c.execute(f"ALTER TABLE loans ADD COLUMN {col} TEXT")
            except: pass
            
        try: c.execute("ALTER TABLE loans ADD COLUMN payment_frequency TEXT DEFAULT 'Monthly'")
        except: pass
            
        try: c.execute("ALTER TABLE payments ADD COLUMN method TEXT")
        except: pass

        try: c.execute("ALTER TABLE payments ADD COLUMN proof_image TEXT")
        except: pass

        try: c.execute("ALTER TABLE loans ADD COLUMN loan_date TEXT")
        except: pass

        try: c.execute("ALTER TABLE loans ADD COLUMN repayment_start_date TEXT")
        except: pass
        
        # Ensure asset_type defaults to currency if null
        c.execute("UPDATE loans SET asset_type = 'currency' WHERE asset_type IS NULL")

        # Ensure ALL emails are lowercased for stability (running every time for safety)
        c.execute("UPDATE users SET email = LOWER(email)")
        c.execute("UPDATE reset_tokens SET email = LOWER(email)")
        c.execute("PRAGMA user_version = 2")
        
        conn.commit()
        conn.close()
    except sqlite3.OperationalError as e:
        if "locked" in str(e).lower():
            print("ℹ️ Database busy during init, skipping (likely handled by another process).", flush=True)
        else:
            raise e
    except Exception as e:
        print(f"⚠️ Warning during init_db: {e}", flush=True)

def get_db_connection():
    conn = sqlite3.connect(DB_NAME, timeout=60)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute('PRAGMA journal_mode=WAL')
        conn.execute('PRAGMA busy_timeout=60000')
    except:
        pass
    return conn

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def send_loan_notification_email(recipient_email, loan_data):
    """Send email notification for new loan request"""
    if not RESEND_API_KEY and not SENDER_PASSWORD:
        msg = "Email not configured (RESEND_API_KEY or Gmail App Password missing)."
        print(f"⚠️ {msg}", flush=True)
        return False, msg
    
    try:
        # Create message details
        if loan_data.get('asset_type') == 'item':
            subject = f"New Loan Agreement Request - {loan_data['item_name']}"
        else:
            subject = f"New Loan Agreement Request - ${loan_data['amount']:,.2f}"
        role = loan_data['role']
        creator_name = loan_data.get('creator_name', 'A user')
        
        if role == 'borrower':
            action = f"{creator_name} is requesting to borrow from you"
        else:
            action = f"{creator_name} is offering to lend to you"

        # ... (Rest of HTML/Text generation is same, abbreviated for brevity)
        html = f"""
        <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
                <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                    <div style="background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); padding: 30px; border-radius: 10px; text-align: center;">
                        <h1 style="color: white; margin: 0;">💰 LoanLink</h1>
                        <p style="color: #e0e7ff; margin: 10px 0 0 0;">Peer-to-Peer Loan Management</p>
                    </div>
                    
                    <div style="background: #f8fafc; padding: 30px; border-radius: 10px; margin-top: 20px;">
                        <h2 style="color: #1e293b; margin-top: 0;">New Loan Request</h2>
                        <p style="font-size: 16px;">{action}</p>
                        
                        <div style="background: white; padding: 20px; border-radius: 8px; margin: 20px 0;">
                            <table style="width: 100%; border-collapse: collapse;">
                                {"""
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Item:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['item_name']}</td>
                                </tr>
                                """ if loan_data.get('asset_type') == 'item' else f"""
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Amount:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">${loan_data['amount']:,.2f}</td>
                                </tr>
                                """}
                                {"""
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Description:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['item_description']}</td>
                                </tr>
                                """ if loan_data.get('asset_type') == 'item' and loan_data.get('item_description') else ""}
                                {"""
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Condition:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['item_condition']}</td>
                                </tr>
                                """ if loan_data.get('asset_type') == 'item' and loan_data.get('item_condition') else ""}
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Interest Rate:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['rate']}% ({loan_data['interest_type']})</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Term:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['months']} months</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Loan Date:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data.get('loan_date', 'N/A')}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Start Payment:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data.get('repayment_start_date', 'N/A')}</td>
                                </tr>
                                <tr style="border-top: 2px solid #e2e8f0;">
                                    <td style="padding: 10px; color: #64748b;">{"Monthly Fee" if loan_data.get('asset_type') == 'item' else "Monthly Payment"}:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right; color: #10b981;">${loan_data['monthly']:,.2f}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Total Repayment:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right; color: #6366f1;">${loan_data['total']:,.2f}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Schedule:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data.get('payment_frequency', 'Monthly')}</td>
                                </tr>
                            </table>
                        </div>
                        
                        <p style="color: #64748b; font-size: 14px; margin: 20px 0;">
                            Please review this loan request and accept or reject it.
                        </p>
                        
                        <div style="margin-top: 25px;">
                            <a href="{request.host_url}#login" style="display: inline-block; background-color: #6366f1; background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%); color: #ffffff !important; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; margin-right: 10px; border: 1px solid #6366f1;">
                                Login to Review →
                            </a>
                            <a href="{request.host_url}#signup" style="display: inline-block; background-color: #ffffff; color: #6366f1 !important; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: bold; border: 1px solid #6366f1;">
                                Create Account
                            </a>
                        </div>
                    </div>
                    
                    <div style="text-align: center; margin-top: 30px; color: #94a3b8; font-size: 12px;">
                        <p>This is an automated notification from LoanLink.</p>
                        <p>If you are a new user, please use the "Create New Account" button above.</p>
                    </div>
                </div>
            </body>
        </html>
        """
        
        if loan_data.get('asset_type') == 'item':
            text = f"LoanLink - New Loan Request\n\n{action}\n\nItem: {loan_data['item_name']}\nTerm: {loan_data['months']} months"
        else:
            text = f"LoanLink - New Loan Request\n\n{action}\n\nAmount: ${loan_data['amount']:,.2f}\nInterest: {loan_data['rate']}%"

        # Use Resend if API Key is available
        if RESEND_API_KEY:
            try:
                print(f"DEBUG: Attempting to send email via Resend API to {recipient_email}", flush=True)
                r = resend.Emails.send({
                    "from": "LoanLink <onboarding@resend.dev>",
                    "to": [recipient_email],
                    "subject": subject,
                    "html": html,
                    "text": text
                })
                print(f"✅ Email successfully sent via Resend to {recipient_email}. ID: {r.get('id')}", flush=True)
                return True, "Success"
            except Exception as e:
                error_msg = f"Resend API Error: {str(e)}"
                print(f"❌ {error_msg}", flush=True)
                return False, error_msg

        # Fallback to SMTP (Gmail)
        print(f"DEBUG: Falling back to SMTP for {recipient_email}", flush=True)
        msg = MIMEMultipart('alternative')
        msg['Subject'] = subject
        msg['From'] = SENDER_EMAIL
        msg['To'] = recipient_email
        msg.attach(MIMEText(text, 'plain'))
        msg.attach(MIMEText(html, 'html'))
        
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.send_message(msg)
        
        print(f"✅ Email successfully sent via SMTP to {recipient_email}", flush=True)
        return True, "Success"
        
    except Exception as e:
        error_msg = f"Failed to send email: {str(e)}"
        print(f"❌ {error_msg}", flush=True)
        return False, error_msg

@app.route('/api/debug-email')
def debug_email():
    results = []
    tests = [
        ("Web Port 443 (Google)", "google.com", 443, "raw"),
        ("Gmail SSL", "smtp.gmail.com", 465, "ssl"),
        ("Gmail TLS", "smtp.gmail.com", 587, "tls"),
    ]
    
    for name, host, port, mode in tests:
        try:
            print(f"DEBUG: Testing {name} ({host}:{port})...", flush=True)
            if mode == "ssl":
                with smtplib.SMTP_SSL(host, port, timeout=5) as s:
                    s.noop()
            elif mode == "tls":
                with smtplib.SMTP(host, port, timeout=5) as s:
                    s.starttls()
                    s.noop()
            else:
                s = socket.create_connection((host, port), timeout=5)
                s.close()
            results.append(f"✅ {name}: SUCCESS")
        except Exception as e:
            results.append(f"❌ {name}: FAILED ({str(e)})")
            
    return jsonify({
        "summary": results,
        "env_check": {
            "address_set": bool(SENDER_EMAIL),
            "password_set": bool(SENDER_PASSWORD)
        }
    })

# --- Auth Routes ---

@app.route('/api/profile', methods=['GET'])
def get_profile():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    return jsonify({
        'email': user['email'],
        'name': user['name'],
        'alias': user['alias'],
        'contact': user['contact'],
        'dob': user['dob']
    })

@app.route('/api/profile', methods=['PUT'])
def update_profile():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.json
    name = data.get('name')
    alias = data.get('alias')
    contact = data.get('contact')
    dob = data.get('dob')
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('UPDATE users SET name = ?, alias = ?, contact = ?, dob = ? WHERE id = ?', 
              (name, alias, contact, dob, user['id']))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True, 'name': name})

@app.route('/api/register', methods=['POST'])
def register():
    data = request.json
    email = data.get('email', '').lower().strip()
    password = data.get('password')
    name = data.get('name')
    
    if not email or not password:
        return jsonify({'error': 'Email and password required'}), 400

    hashed = hash_password(password)
    
    try:
        conn = get_db_connection()
        c = conn.cursor()
        # Auto-login token
        token = str(uuid.uuid4())
        c.execute('INSERT INTO users (email, password, name, token) VALUES (?, ?, ?, ?)', 
                  (email, hashed, name, token))
        conn.commit()
        conn.close()
        return jsonify({'token': token, 'email': email, 'name': name})
    except sqlite3.IntegrityError:
        return jsonify({'error': 'Email already exists'}), 409
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email', '').lower().strip()
    password = data.get('password')
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ? COLLATE NOCASE', (email,)).fetchone()
    conn.close()
    
    if user and user['password'] == hash_password(password):
        token = str(uuid.uuid4())
        conn = get_db_connection()
        conn.execute('UPDATE users SET token = ? WHERE id = ?', (token, user['id']))
        conn.commit()
        conn.close()
        return jsonify({'token': token, 'email': user['email'], 'name': user['name']})
    else:
        # Debugging hash mismatch
        if user:
            print(f"DEBUG: Login failed for {email}. Password hash mismatch.", flush=True)
        else:
            print(f"DEBUG: Login failed. User {email} not found.", flush=True)
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json
    email = data.get('email', '').lower().strip()
    print(f"DEBUG: Forgot password request for: {email}", flush=True)
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ? COLLATE NOCASE', (email,)).fetchone()
    
    if not user:
        conn.close()
        return jsonify({'error': 'No user found with that email. Did the database restart?'}), 404

    # Generate token
    token = str(uuid.uuid4())
    expires_at = (datetime.now() + timedelta(hours=24)).isoformat()
    
    conn.execute('INSERT OR REPLACE INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)', 
                 (email, token, expires_at))
    conn.commit()
    conn.close()

    # Send reset email
    reset_url = f"{request.host_url}#reset?token={token}"
    print(f"DEBUG: Manual Reset Link for {email}: {reset_url}", flush=True)
    msg = MIMEMultipart()
    msg['Subject'] = "Reset Your LoanLink Password"
    msg['From'] = SENDER_EMAIL
    msg['To'] = email
    
    body = f"""
    <html>
        <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h2>Password Reset Request</h2>
            <p>You requested a password reset for your LoanLink account.</p>
            <p>Click the button below to set a new password:</p>
            <a href="{reset_url}" style="display: inline-block; background: #6366f1; color: white; padding: 12px 20px; text-decoration: none; border-radius: 8px; font-weight: bold;">Reset Password</a>
            <p style="color: #64748b; font-size: 12px; margin-top: 20px;">If you didn't request this, you can ignore this email.</p>
        </body>
    </html>
    """
    msg.attach(MIMEText(body, 'html'))
    
    if RESEND_API_KEY:
        try:
            print(f"DEBUG: Sending reset email via Resend to {email}", flush=True)
            r = resend.Emails.send({
                "from": "LoanLink <onboarding@resend.dev>",
                "to": [email],
                "subject": "Reset Your LoanLink Password",
                "html": body
            })
            print(f"✅ Reset email sent via Resend. ID: {r.get('id')}", flush=True)
            return jsonify({'success': True})
        except Exception as e:
            print(f"❌ Resend API Error: {str(e)}", flush=True)
            return jsonify({'error': 'Failed to send reset link', 'details': str(e)}), 500

    try:
        with smtplib.SMTP_SSL(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.set_debuglevel(1) # Enable verbose SMTP logs in Render
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.send_message(msg)
        print(f"✅ Reset email sent to {email}", flush=True)
        return jsonify({'success': True})
    except Exception as e:
        print(f"❌ Error sending reset email: {e}", flush=True)
        return jsonify({'error': 'Failed to send reset email', 'details': str(e)}), 500

@app.route('/api/reset-password', methods=['POST'])
def reset_password():
    data = request.json
    token = data.get('token')
    new_password = data.get('password')
    
    conn = get_db_connection()
    reset = conn.execute('SELECT * FROM reset_tokens WHERE token = ?', (token,)).fetchone()
    
    if not reset:
        conn.close()
        return jsonify({'error': 'Invalid or expired token'}), 400
        
    hashed = hash_password(new_password)
    conn.execute('UPDATE users SET password = ? WHERE email = ?', (hashed, reset['email']))
    conn.execute('DELETE FROM reset_tokens WHERE token = ?', (token,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/change-password', methods=['POST'])
def change_password():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
        
    data = request.json
    old_password = data.get('old_password')
    new_password = data.get('new_password')
    
    # Verify old password
    if hash_password(old_password) != user['password']:
        return jsonify({'error': 'Incorrect current password'}), 400
        
    conn = get_db_connection()
    conn.execute('UPDATE users SET password = ? WHERE email = ?', 
                 (hash_password(new_password), user['email']))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

# --- Middleware-like helper ---
def get_current_user():
    token = request.headers.get('Authorization')
    if not token:
        return None
    # Remove 'Bearer ' if present
    if token.startswith('Bearer '):
        token = token[7:]
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE token = ?', (token,)).fetchone()
    conn.close()
    return user

# --- Loan Routes ---

@app.route('/api/loans', methods=['GET'])
def get_loans():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    email = user['email']
    conn = get_db_connection()
    
    # Get all loans where user is lender OR borrower
    loans_cursor = conn.execute('''
        SELECT * FROM loans 
        WHERE lender_email = ? OR borrower_email = ? 
        ORDER BY created_at DESC
    ''', (email, email))
    
    loans = []
    for row in loans_cursor:
        loan = dict(row)
        # Fetch history
        payments_cur = conn.execute('SELECT * FROM payments WHERE loan_id = ? ORDER BY date', (loan['id'],))
        history = [dict(p) for p in payments_cur]
        
        # Transform for frontend compatibility
        loan['history'] = history
        loan['total'] = loan['total_repayment'] # Alias for frontend
        loan['monthly'] = loan['monthly_payment'] # Alias
        loan['paid'] = loan['paid_amount'] # Alias
        loan['interestType'] = loan['interest_type'] # Alias
        
        # Determine role relative to current user
        if loan['lender_email'] == email:
            loan['role'] = 'lender'
            loan['counterparty'] = loan['borrower_email'] 
        else:
            loan['role'] = 'borrower'
            loan['counterparty'] = loan['lender_email']
        
        # Pass creator_email implicitly
        
        loans.append(loan)
        
    conn.close()
    return jsonify(loans)

@app.route('/api/loans', methods=['POST'])
def create_loan():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.json
    
    # Data from frontend
    role = data.get('role') # 'lender' or 'borrower' (User's role)
    other_email = data.get('counterpartyEmail', '').lower().strip() # New field
    counterparty_name = data.get('counterpartyName') # Just for display if we want
    amount = data.get('amount')
    rate = data.get('rate')
    months = data.get('months')
    type = data.get('interestType')
    monthly = data.get('monthly')
    total = data.get('total')
    
    # New fields
    asset_type = data.get('assetType', 'currency')
    item_name = data.get('itemName')
    item_description = data.get('itemDescription')
    item_condition = data.get('itemCondition')
    payment_frequency = data.get('paymentFrequency', 'Monthly')
    loan_date = data.get('loanDate')
    repayment_start_date = data.get('repaymentStartDate')
    
    # Determine who is who
    if role == 'lender':
        lender_email = user['email']
        borrower_email = other_email
    else:
        borrower_email = user['email']
        lender_email = other_email
    
    creator_email = user['email']
    
    if lender_email.strip().lower() == borrower_email.strip().lower():
        return jsonify({'error': 'You cannot create a loan with yourself.'}), 400
        
    created_at = datetime.now().isoformat()
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        INSERT INTO loans (lender_email, borrower_email, creator_email, counterparty_name, asset_type, item_name, item_description, item_condition, amount, rate, months, interest_type, monthly_payment, total_repayment, created_at, status, payment_frequency, loan_date, repayment_start_date)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
    ''', (lender_email, borrower_email, creator_email, counterparty_name, asset_type, item_name, item_description, item_condition, amount, rate, months, type, monthly, total, created_at, payment_frequency, loan_date, repayment_start_date))
    conn.commit()
    conn.close()
    
    # Send email notification to counterpartyl
    email_data = {
        'asset_type': asset_type,
        'item_name': item_name,
        'item_description': item_description,
        'item_condition': item_condition,
        'amount': amount,
        'rate': rate,
        'months': months,
        'interest_type': type,
        'monthly': monthly,
        'total': total,
        'role': role,
        'payment_frequency': payment_frequency,
        'loan_date': loan_date,
        'repayment_start_date': repayment_start_date,
        'creator_name': user['name'] if user['name'] else user['email']
    }
    
    success, msg = send_loan_notification_email(other_email, email_data)
    if not success:
        return jsonify({'success': False, 'error': f"Loan created, but {msg}"}), 200 # Still return 200 since loan is created
    
    return jsonify({'success': True})

@app.route('/api/loans/<int:loan_id>/pay', methods=['POST'])
def make_payment(loan_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401

    # Safe extraction of amount
    if request.is_json:
        amount = request.json.get('amount')
    else:
        amount = request.form.get('amount')
        
    if amount:
        amount = float(amount)
        
    conn = get_db_connection()
    
    conn = get_db_connection()
    loan = conn.execute('SELECT * FROM loans WHERE id = ?', (loan_id,)).fetchone()
    
    if not loan:
        return jsonify({'error': 'Loan not found'}), 404
        
    # Validation?
    
    new_paid = loan['paid_amount'] + amount
    
    c = conn.cursor()
    
    # Check if fully paid
    if new_paid >= loan['total_repayment'] - 0.01: # Small epsilon for float logic
        c.execute("UPDATE loans SET paid_amount = ?, status = 'completed' WHERE id = ?", (new_paid, loan_id))
    else:
        c.execute('UPDATE loans SET paid_amount = ? WHERE id = ?', (new_paid, loan_id))
        
    # Get form data for mixed content (file + text)
    # If JSON is sent, request.form is empty, so we must support both or switch frontend to FormData exclusively.
    
    # Check if request is JSON or Multipart
    if request.is_json:
        req_data = request.json
        method = req_data.get('method', 'Unknown')
        date_str = req_data.get('date')
        proof_path = None
    else:
        req_data = request.form
        method = req_data.get('method', 'Unknown')
        date_str = req_data.get('date')
        
        # Handle File
        proof_path = None
        if 'proof' in request.files:
            file = request.files['proof']
            if file and file.filename != '':
                # Secure filename and save
                # Ensure uploads dir exists
                uploads_dir = os.path.join(BASE_DIR, 'uploads')
                if not os.path.exists(uploads_dir):
                    os.makedirs(uploads_dir)
                    
                ext = os.path.splitext(file.filename)[1]
                filename = f"{uuid.uuid4()}{ext}"
                file.save(os.path.join(uploads_dir, filename))
                proof_path = f"/uploads/{filename}"

    payment_date = date_str if date_str else datetime.now().isoformat()
        
    c.execute('INSERT INTO payments (loan_id, amount, date, method, proof_image) VALUES (?, ?, ?, ?, ?)', 
              (loan_id, amount, payment_date, method, proof_path))
    conn.commit()
    conn.close()
    
    
    return jsonify({'success': True, 'new_paid': new_paid})

@app.route('/api/loans/<int:loan_id>', methods=['PUT'])
def update_loan(loan_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = get_db_connection()
    loan = conn.execute('SELECT * FROM loans WHERE id = ?', (loan_id,)).fetchone()
    
    if not loan:
        conn.close()
        return jsonify({'error': 'Loan not found'}), 404
    
    # Only creator can edit
    if loan['creator_email'] != user['email']:
        conn.close()
        return jsonify({'error': 'Only the creator can edit this loan'}), 403
    
    # Only pending loans can be edited
    if loan['status'] != 'pending':
        conn.close()
        return jsonify({'error': 'Only pending loans can be edited'}), 400
    
    # Get updated data
    data = request.json
    amount = data.get('amount')
    rate = data.get('rate')
    months = data.get('months')
    interest_type = data.get('interestType')
    monthly = data.get('monthly')
    total = data.get('total')
    counterparty_name = data.get('counterpartyName')
    asset_type = data.get('assetType', 'currency')
    item_name = data.get('itemName')
    item_description = data.get('itemDescription')
    item_condition = data.get('itemCondition')
    
    # Update the loan
    c = conn.cursor()
    c.execute('''
        UPDATE loans 
        SET amount = ?, rate = ?, months = ?, interest_type = ?, 
            monthly_payment = ?, total_repayment = ?, counterparty_name = ?,
            asset_type = ?, item_name = ?, item_description = ?, item_condition = ?
        WHERE id = ?
    ''', (amount, rate, months, interest_type, monthly, total, counterparty_name, asset_type, item_name, item_description, item_condition, loan_id))
    conn.commit()
    
    # Get other party's email
    other_email = loan['borrower_email'] if loan['lender_email'] == user['email'] else loan['lender_email']
    role = 'lender' if loan['lender_email'] == user['email'] else 'borrower'
    
    # Send updated email notification
    email_data = {
        'asset_type': asset_type,
        'item_name': item_name,
        'item_description': item_description,
        'item_condition': item_condition,
        'amount': amount,
        'rate': rate,
        'months': months,
        'interest_type': interest_type,
        'monthly': monthly,
        'total': total,
        'role': role,
        'creator_name': user['name'] if user['name'] else user['email']
    }
    success, msg = send_loan_notification_email(other_email, email_data)
    
    conn.close()
    if not success:
        return jsonify({'success': False, 'error': f"Loan updated, but {msg}"}), 200
    
    return jsonify({'success': True})

@app.route('/api/loans/<int:loan_id>/accept', methods=['POST'])
def accept_loan(loan_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = get_db_connection()
    loan = conn.execute('SELECT * FROM loans WHERE id = ?', (loan_id,)).fetchone()
    
    if not loan:
        conn.close()
        return jsonify({'error': 'Loan not found'}), 404
        
    # Only the non-creator can accept.
    if user['email'] not in [loan['lender_email'], loan['borrower_email']]:
        conn.close()
        return jsonify({'error': 'Unauthorized for this loan'}), 403
        
    # Prevent self-acceptance
    # Check if creator_email matches current user
    # Handle legacy loans where creator_email might be null (assume anyone can accept if null? or stricter?)
    # Stricter: if null, fallback to old logic (anyone). If set, enforce.
    
    if loan['creator_email'] and loan['creator_email'] == user['email']:
        conn.close()
        return jsonify({'error': 'You created this loan request. The other party must accept it.'}), 403
        
    c = conn.cursor()
    c.execute("UPDATE loans SET status = 'active' WHERE id = ?", (loan_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/loans/<int:loan_id>/reject', methods=['POST'])
def reject_loan(loan_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = get_db_connection()
    # Delete the loan if rejected? Or set status 'rejected'? 
    # Let's delete to keep it clean, or set to 'rejected' for history.
    # 'rejected' is safer.
    c = conn.cursor()
    c.execute("UPDATE loans SET status = 'rejected' WHERE id = ?", (loan_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/loans/<int:loan_id>', methods=['DELETE'])
def delete_loan(loan_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = get_db_connection()
    loan = conn.execute('SELECT * FROM loans WHERE id = ?', (loan_id,)).fetchone()
    
    if not loan:
        conn.close()
        return jsonify({'error': 'Loan not found'}), 404
        
    can_delete = False
    
    # Creator can cancel pending request
    if loan['status'] == 'pending' and loan['creator_email'] == user['email']:
        can_delete = True
    # Participants can clear rejected/cancelled
    elif loan['status'] in ['rejected', 'cancelled'] and (loan['lender_email'] == user['email'] or loan['borrower_email'] == user['email']):
        can_delete = True
        
    if not can_delete:
         conn.close()
         return jsonify({'error': 'Cannot delete this loan. You can only cancel pending requests you created, or clear rejected loans.'}), 403

    c = conn.cursor()
    c.execute('DELETE FROM loans WHERE id = ?', (loan_id,))
    c.execute('DELETE FROM payments WHERE loan_id = ?', (loan_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})


# --- Marketplace Listings Routes ---

@app.route('/api/listings', methods=['GET'])
def get_listings():
    conn = get_db_connection()
    listings_cursor = conn.execute('''
        SELECT l.*, u.name as owner_name, u.alias as owner_alias 
        FROM listings l
        JOIN users u ON l.user_email = u.email
        WHERE l.status = 'active'
        ORDER BY l.created_at DESC
    ''')
    listings = [dict(row) for row in listings_cursor]
    conn.close()
    return jsonify(listings)

@app.route('/api/listings', methods=['POST'])
def create_listing():
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    data = request.json
    item_name = data.get('itemName')
    description = data.get('description')
    charge = data.get('charge')
    deposit = data.get('deposit')
    location = data.get('location')
    tenure = data.get('tenure')
    
    if not item_name:
        return jsonify({'error': 'Item name is required'}), 400
        
    created_at = datetime.now().isoformat()
    
    conn = get_db_connection()
    c = conn.cursor()
    c.execute('''
        INSERT INTO listings (user_email, item_name, description, charge, deposit, location, tenure, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (user['email'], item_name, description, charge, deposit, location, tenure, created_at))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})

@app.route('/api/listings/<int:listing_id>', methods=['DELETE'])
def delete_listing(listing_id):
    user = get_current_user()
    if not user:
        return jsonify({'error': 'Unauthorized'}), 401
    
    conn = get_db_connection()
    listing = conn.execute('SELECT * FROM listings WHERE id = ?', (listing_id,)).fetchone()
    
    if not listing:
        conn.close()
        return jsonify({'error': 'Listing not found'}), 404
        
    if listing['user_email'] != user['email']:
        conn.close()
        return jsonify({'error': 'You can only delete your own listings'}), 403
        
    c = conn.cursor()
    c.execute('DELETE FROM listings WHERE id = ?', (listing_id,))
    conn.commit()
    conn.close()
    
    return jsonify({'success': True})


# --- Static Files ---

@app.route('/')
def index():
    return send_from_directory('.', 'index.html')

# Professional initialization
init_db()
print("✅ LoanLink Database Initialized.", flush=True)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=True)
