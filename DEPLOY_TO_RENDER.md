# Deploying to Render
1. Create a GitHub repository and push your code.
2. Go to Render.com and create a new "Web Service".
3. Set the following:
   - Environment: Python
   - Build Command: pip install -r requirements.txt
   - Start Command: gunicorn server:app
   - Port: 10000 (Render uses this by default)

# Database Note
Since you are using SQLite, your data will be erased every time the server restarts on free tiers. 
For a permanent site, you should:
1. Use Render's "Disk" feature to store the .db file.
2. OR switch to a managed DB like PostgreSQL (Render provides this).

# Environment Variables
Make sure to add these in the Render Dashboard:
- EMAIL_ADDRESS: loan.linking@gmail.com
- EMAIL_PASSWORD: your-app-password
- PORT: 10000
