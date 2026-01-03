
import sqlite3
import hashlib
import uuid

DB_NAME = "loanlink.db"

def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()

def create_users():
    conn = sqlite3.connect(DB_NAME)
    c = conn.cursor()
    
    users = [
        ("user1@example.com", "password123", "User One"),
        ("user2@example.com", "password123", "User Two")
    ]
    
    for email, password, name in users:
        hashed = hash_password(password)
        token = str(uuid.uuid4())
        try:
            c.execute('INSERT INTO users (email, password, name, token) VALUES (?, ?, ?, ?)', 
                      (email, hashed, name, token))
            print(f"Created user: {email}")
        except sqlite3.IntegrityError:
            print(f"User already exists: {email}")
            # Optional: reset password if user exists to ensure known state
            c.execute('UPDATE users SET password = ? WHERE email = ?', (hashed, email))
            print(f"Updated password for: {email}")

    conn.commit()
    conn.close()

if __name__ == "__main__":
    create_users()
