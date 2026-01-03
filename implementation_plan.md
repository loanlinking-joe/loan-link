---
description: Redesign Loan Link to Dark Glass Theme + Add Loan Approval Workflow
---

# 1. Backend Updates (server.py)
- [x] Change `create_loan` default status to `'pending'`.
- [x] Add `POST /api/loans/<id>/accept` endpoint to flip status to `'active'`.
- [x] Add `POST /api/loans/<id>/reject` endpoint.
- [x] Ensure `get_loans` returns the correct status for filtering.

# 2. Frontend Logic (app.js)
- [x] Update `fetchLoans` to separate loans into `pending` and `active` buckets.
- [x] Add `acceptLoan(id)` and `rejectLoan(id)` functions.
- [x] Update `nav-create` flow: Explain to user that this sends a request.

# 3. Frontend UI (index.html)
- [x] **Redesign**: Apply "Dark Glass" structure (Sidebar + Dashboard Content).
- [x] **Dashboard View**:
    - Add "Pending Requests" section at the top.
    - Add "Active Loans" section below.
- [x] **Loan Request Modal**:
    - New modal to view details of a pending loan.
    - "Accept Terms" checkbox.
    - "Confirm" and "Reject" buttons.

# 4. Styling (style.css)
- [x] Implement new Variable Colors (Deep Slate, Neon Purple, Neon Cyan).
- [x] Layout: Sidebar + Main Content Grid.
- [x] Components:
    - Glassmorphism Cards (Frosted effect).
    - Modern Tables/Lists.
    - Status Badges (Pending = Orange, Active = Green).
