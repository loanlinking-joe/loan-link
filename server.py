import sqlite3
import hashlib
import uuid
import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS

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

# Email Configuration (Gmail SMTP)
SMTP_SERVER = "smtp.gmail.com"
SMTP_PORT = 587
SENDER_EMAIL = os.environ.get("EMAIL_ADDRESS", "")  # Your Gmail address
SENDER_PASSWORD = os.environ.get("EMAIL_PASSWORD", "")  # App password

def init_db():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    # Users table
    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        token TEXT
    )''')
    # Loans table
    c.execute('''CREATE TABLE IF NOT EXISTS loans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lender_email TEXT NOT NULL,
        borrower_email TEXT NOT NULL,
        creator_email TEXT,
        counterparty_name TEXT,
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
    
    # Migration: Add creator_email if not exists
    try:
        c.execute("ALTER TABLE loans ADD COLUMN creator_email TEXT")
    except sqlite3.OperationalError:
        pass # Column likely exists

    # Migration: Add user profile fields
    for col in ['alias', 'contact', 'dob']:
        try:
            c.execute(f"ALTER TABLE users ADD COLUMN {col} TEXT")
        except sqlite3.OperationalError:
            pass

    # Payments/History table (stored as JSON string in original app, but better relational here)
    # Actually, for simplicity to match frontend "history" array structure, 
    # we can just store payments in a separate table
    c.execute('''CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        loan_id INTEGER,
        amount REAL,
        date TEXT,
        FOREIGN KEY(loan_id) REFERENCES loans(id)
    )''')
    conn.commit()
    conn.close()

def get_db_connection():
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    return conn

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def send_loan_notification_email(recipient_email, loan_data):
    """Send email notification for new loan request"""
    if not SENDER_EMAIL or not SENDER_PASSWORD:
        print("⚠️ Email not configured. Skipping notification.")
        return False
    
    try:
        # Create message
        msg = MIMEMultipart('alternative')
        msg['Subject'] = f"New Loan Agreement Request - ${loan_data['amount']:,.2f}"
        msg['From'] = SENDER_EMAIL
        msg['To'] = recipient_email
        
        # Get role-specific text
        role = loan_data['role']
        creator_name = loan_data.get('creator_name', 'A user')
        
        if role == 'borrower':
            # Creator is borrower, recipient is lender
            action = f"{creator_name} is requesting to borrow from you"
        else:
            # Creator is lender, recipient is borrower
            action = f"{creator_name} is offering to lend to you"
        
        # HTML email body
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
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Amount:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">${loan_data['amount']:,.2f}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Interest Rate:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['rate']}% ({loan_data['interest_type']})</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Term:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right;">{loan_data['months']} months</td>
                                </tr>
                                <tr style="border-top: 2px solid #e2e8f0;">
                                    <td style="padding: 10px; color: #64748b;">Monthly Payment:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right; color: #10b981;">${loan_data['monthly']:,.2f}</td>
                                </tr>
                                <tr>
                                    <td style="padding: 10px; color: #64748b;">Total Repayment:</td>
                                    <td style="padding: 10px; font-weight: bold; text-align: right; color: #6366f1;">${loan_data['total']:,.2f}</td>
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
        
        # Plain text fallback
        text = f"""
LoanLink - New Loan Request

{action}

Loan Details:
- Amount: ${loan_data['amount']:,.2f}
- Interest Rate: {loan_data['rate']}% ({loan_data['interest_type']})
- Term: {loan_data['months']} months
- Monthly Payment: ${loan_data['monthly']:,.2f}
- Total Repayment: ${loan_data['total']:,.2f}

Please visit {request.host_url} to review this request.

---
This is an automated notification from LoanLink.
        """
        
        part1 = MIMEText(text, 'plain')
        part2 = MIMEText(html, 'html')
        
        msg.attach(part1)
        msg.attach(part2)
        
        # Send email
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(SENDER_EMAIL, SENDER_PASSWORD)
            server.send_message(msg)
        
        print(f"✅ Email successfully sent to {recipient_email}", flush=True)
        return True, "Success"
        
    except Exception as e:
        error_msg = f"Failed to send email: {str(e)}"
        print(f"❌ {error_msg}", flush=True)
        return False, error_msg

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
    email = data.get('email')
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
    email = data.get('email')
    password = data.get('password')
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    conn.close()
    
    if user and user['password'] == hash_password(password):
        # Generate new token or update existing? Let's just return existing for now or update it.
        # Ideally update it.
        token = str(uuid.uuid4())
        conn = get_db_connection()
        conn.execute('UPDATE users SET token = ? WHERE id = ?', (token, user['id']))
        conn.commit()
        conn.close()
        return jsonify({'token': token, 'email': user['email'], 'name': user['name']})
    else:
        return jsonify({'error': 'Invalid credentials'}), 401

@app.route('/api/forgot-password', methods=['POST'])
def forgot_password():
    data = request.json
    email = data.get('email')
    print(f"DEBUG: Forgot password request for: {email}", flush=True)
    
    conn = get_db_connection()
    user = conn.execute('SELECT * FROM users WHERE email = ?', (email,)).fetchone()
    
    if not user:
        # For security, don't reveal if user exists. Just say "If account exists, email sent"
        conn.close()
        return jsonify({'success': True})

    # Generate token
    token = str(uuid.uuid4())
    expires_at = datetime.now().isoformat() # In a real app, add +1 hour. For now, simple.
    
    conn.execute('INSERT INTO reset_tokens (email, token, expires_at) VALUES (?, ?, ?)', 
                 (email, token, expires_at))
    conn.commit()
    conn.close()

    # Send reset email
    reset_url = f"{request.host_url}#reset?token={token}"
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
    
    try:
        with smtplib.SMTP(SMTP_SERVER, SMTP_PORT, timeout=10) as server:
            server.set_debuglevel(1) # Enable verbose SMTP logs in Render
            server.starttls()
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
    other_email = data.get('counterpartyEmail') # New field
    counterparty_name = data.get('counterpartyName') # Just for display if we want
    amount = data.get('amount')
    rate = data.get('rate')
    months = data.get('months')
    type = data.get('interestType')
    monthly = data.get('monthly')
    total = data.get('total')
    
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
        INSERT INTO loans (lender_email, borrower_email, creator_email, counterparty_name, amount, rate, months, interest_type, monthly_payment, total_repayment, created_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    ''', (lender_email, borrower_email, creator_email, counterparty_name, amount, rate, months, type, monthly, total, created_at))
    conn.commit()
    conn.close()
    
    # Send email notification to counterparty
    email_data = {
        'amount': amount,
        'rate': rate,
        'months': months,
        'interest_type': type,
        'monthly': monthly,
        'total': total,
        'role': role,
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
    
    data = request.json
    amount = data.get('amount')
    
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
        
    c.execute('INSERT INTO payments (loan_id, amount, date) VALUES (?, ?, ?)', 
              (loan_id, amount, datetime.now().isoformat()))
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
    
    # Update the loan
    c = conn.cursor()
    c.execute('''
        UPDATE loans 
        SET amount = ?, rate = ?, months = ?, interest_type = ?, 
            monthly_payment = ?, total_repayment = ?, counterparty_name = ?
        WHERE id = ?
    ''', (amount, rate, months, interest_type, monthly, total, counterparty_name, loan_id))
    conn.commit()
    
    # Get other party's email
    other_email = loan['borrower_email'] if loan['lender_email'] == user['email'] else loan['lender_email']
    role = 'lender' if loan['lender_email'] == user['email'] else 'borrower'
    
    # Send updated email notification
    email_data = {
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
