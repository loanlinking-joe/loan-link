
// Configuration
const API_URL = '/api';

// State
const state = {
    loans: [],
    view: 'auth', // 'auth', 'dashboard', 'create', 'reset'
    user: JSON.parse(localStorage.getItem('loanLink_user')) || null,
    token: localStorage.getItem('loanLink_token') || null,
    authMode: 'login' // 'login', 'signup', or 'forgot'
};

// Utils
const formatMoney = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
};

const apiRequest = async (endpoint, method = 'GET', body = null) => {
    const headers = { 'Content-Type': 'application/json' };
    if (state.token) {
        headers['Authorization'] = `Bearer ${state.token}`;
    }

    const config = { method, headers };
    if (body) config.body = JSON.stringify(body);

    try {
        const response = await fetch(`${API_URL}${endpoint}`, config);
        const contentType = response.headers.get("content-type");

        if (contentType && contentType.indexOf("application/json") !== -1) {
            const data = await response.json();
            if (!response.ok) {
                const errorMsg = data.details ? `${data.error}: ${data.details}` : (data.error || 'API Request Failed');
                throw new Error(errorMsg);
            }
            return data;
        } else {
            const text = await response.text();
            console.error("Server returned non-JSON response:", text);
            throw new Error(`Server Error: Received HTML instead of data. Check the app logs on Render.`);
        }
    } catch (error) {
        console.error(error);
        if (error.message === 'Unauthorized' || error.message.includes('401')) {
            logout();
        }
        throw error;
    }
};

// Auth Actions
const login = async (email, password) => {
    try {
        const data = await apiRequest('/login', 'POST', { email, password });
        finishAuth(data);
    } catch (e) {
        alert(e.message);
    }
};

const register = async (email, password, name) => {
    try {
        const data = await apiRequest('/register', 'POST', { email, password, name });
        finishAuth(data);
    } catch (e) {
        alert(e.message);
    }
};

const finishAuth = (data) => {
    state.token = data.token;
    state.user = { email: data.email, name: data.name };
    localStorage.setItem('loanLink_token', state.token);
    localStorage.setItem('loanLink_user', JSON.stringify(state.user));
    navigate('dashboard');
    fetchLoans();
};

const logout = () => {
    state.token = null;
    state.user = null;
    state.loans = [];
    localStorage.removeItem('loanLink_token');
    localStorage.removeItem('loanLink_user');
    navigate('auth');
};

// Loan Actions
const fetchLoans = async () => {
    try {
        const loans = await apiRequest('/loans');
        state.loans = loans;
        if (state.view === 'dashboard') renderDashboard();
    } catch (e) {
        console.error("Failed to fetch loans", e);
    }
};

const createLoan = async (loanData) => {
    try {
        const res = await apiRequest('/loans', 'POST', loanData);
        if (res.success === false) {
            alert('Warning: ' + res.error);
        } else {
            alert('Loan proposal sent successfully! The other party needs to accept it.');
        }
        navigate('dashboard');
        fetchLoans();
    } catch (e) {
        alert("Failed to create loan: " + e.message);
    }
};

const acceptLoan = async (id) => {
    try {
        await apiRequest(`/loans/${id}/accept`, 'POST');
        document.getElementById('review-modal').classList.add('hidden');
        fetchLoans();
    } catch (e) {
        alert("Failed to accept loan: " + e.message);
    }
};

const rejectLoan = async (id) => {
    if (!confirm("Are you sure you want to reject this loan proposal?")) return;
    try {
        await apiRequest(`/loans/${id}/reject`, 'POST');
        document.getElementById('review-modal').classList.add('hidden');
        fetchLoans();
    } catch (e) {
        alert("Failed to reject loan: " + e.message);
    }
};

const recordPayment = async (loanId, amount) => {
    try {
        await apiRequest(`/loans/${loanId}/pay`, 'POST', { amount });
        document.getElementById('payment-modal').classList.add('hidden');
        document.getElementById('payment-amount').value = '';
        fetchLoans();
        alert('Payment recorded!'); // Simple feedback
    } catch (e) {
        alert("Failed to pay: " + e.message);
    }
};

const fetchProfile = async () => {
    try {
        const data = await apiRequest('/profile');
        // Update local user state might not be enough if we want to separate 'profile' data from 'auth' data
        // For simplicity, extend state.user
        state.user = { ...state.user, ...data };
        localStorage.setItem('loanLink_user', JSON.stringify(state.user));
        return data;
    } catch (e) {
        console.error("Failed to fetch profile", e);
    }
};

const updateProfile = async (profileData) => {
    try {
        const res = await apiRequest('/profile', 'PUT', profileData);
        if (res.success) {
            alert('Profile updated successfully!');
            fetchProfile(); // Refresh
        }
    } catch (e) {
        alert("Failed to update profile: " + e.message);
    }
};

const changePassword = async (oldPassword, newPassword) => {
    try {
        const res = await apiRequest('/change-password', 'POST', {
            old_password: oldPassword,
            new_password: newPassword
        });
        if (res.success) {
            alert('Password changed successfully!');
            document.getElementById('current-password').value = '';
            document.getElementById('new-password').value = '';
        }
    } catch (e) {
        alert("Failed to change password: " + e.message);
    }
};

window.cancelLoan = async (id) => {
    if (!confirm("Are you sure you want to cancel this loan request?")) return;
    try {
        await apiRequest(`/loans/${id}`, 'DELETE');
        fetchLoans();
        alert("Loan request cancelled.");
    } catch (e) {
        alert("Failed to cancel loan: " + e.message);
    }
};

window.editLoan = (id) => {
    const loan = state.loans.find(l => l.id === id);
    if (!loan) return;

    // Navigate to create view and pre-fill with loan data
    state.editingLoanId = id;
    navigate('create');
};

// Navigation & Routing
const appRoot = document.getElementById('app-root');

const navigate = (view) => {
    state.view = view;
    // Handle deep links via hash
    if (view === 'auth') {
        if (window.location.hash === '#signup') {
            state.authMode = 'signup';
        } else if (window.location.hash === '#login') {
            state.authMode = 'login';
        }
    } else if (view === 'reset') {
        const urlParams = new URLSearchParams(window.location.hash.split('?')[1]);
        state.resetToken = urlParams.get('token');
    }

    // Guard
    if (!state.token && view !== 'auth' && view !== 'reset') {
        state.view = 'auth';
    }
    render();
};

// Initial navigation based on current hash or default
window.addEventListener('hashchange', () => {
    if (window.location.hash.includes('#reset')) {
        navigate('reset');
    } else if (state.view === 'auth') {
        render();
    }
});

const render = () => {
    appRoot.innerHTML = '';

    if (state.view === 'auth') {
        const template = document.getElementById('view-auth');
        appRoot.appendChild(template.content.cloneNode(true));
        initAuthListeners();
    } else if (state.view === 'reset') {
        const resetTemplate = document.getElementById('view-reset-password');
        appRoot.appendChild(resetTemplate.content.cloneNode(true));
        initResetListeners();
    } else {
        // App Layout (Requires state.user to be logged in)
        const layoutTemplate = document.getElementById('layout-app');
        const layout = layoutTemplate.content.cloneNode(true);

        // Sidebar Content
        const nameEl = layout.getElementById('sidebar-username');
        const emailEl = layout.getElementById('sidebar-email');
        if (nameEl && state.user) nameEl.textContent = state.user.name || 'User';
        if (emailEl && state.user) emailEl.textContent = state.user.email;

        // Active Nav State
        const navDash = layout.getElementById('nav-dashboard');
        const navCreate = layout.getElementById('nav-create');
        const navProfile = layout.getElementById('nav-profile');
        const navArchive = layout.getElementById('nav-archive');

        if (state.view === 'dashboard') navDash.classList.add('active');
        else navDash.classList.remove('active');

        if (state.view === 'create') navCreate.classList.add('active');
        else navCreate.classList.remove('active');

        if (state.view === 'profile') navProfile.classList.add('active');
        else navProfile.classList.remove('active');

        if (state.view === 'archive') navArchive.classList.add('active');
        else navArchive.classList.remove('active');

        // Main Content Injection
        const mainContent = layout.getElementById('main-content-area');

        if (state.view === 'dashboard') {
            const dashTemplate = document.getElementById('view-dashboard');
            mainContent.appendChild(dashTemplate.content.cloneNode(true));
        } else if (state.view === 'create') {
            const createTemplate = document.getElementById('view-create');
            mainContent.appendChild(createTemplate.content.cloneNode(true));
        } else if (state.view === 'profile') {
            const profileTemplate = document.getElementById('view-profile');
            mainContent.appendChild(profileTemplate.content.cloneNode(true));
        } else if (state.view === 'archive') {
            const archiveTemplate = document.getElementById('view-archive');
            mainContent.appendChild(archiveTemplate.content.cloneNode(true));
        }

        appRoot.appendChild(layout);

        // listeners
        document.getElementById('nav-dashboard').addEventListener('click', () => navigate('dashboard'));
        document.getElementById('nav-create').addEventListener('click', () => navigate('create'));
        document.getElementById('nav-profile').addEventListener('click', () => navigate('profile'));
        document.getElementById('nav-archive').addEventListener('click', () => navigate('archive'));
        document.getElementById('nav-logout').addEventListener('click', logout);

        if (state.view === 'dashboard') {
            renderDashboard();
        } else if (state.view === 'create') {
            initCreateListeners();
        } else if (state.view === 'profile') {
            initProfileListeners();
        } else if (state.view === 'archive') {
            renderArchive();
        }
    }
};

const initProfileListeners = async () => {
    // Load data
    const user = await fetchProfile();
    if (user) {
        document.getElementById('profile-name').value = user.name || '';
        document.getElementById('profile-email').value = user.email || '';
        document.getElementById('profile-alias').value = user.alias || '';
        document.getElementById('profile-contact').value = user.contact || '';
        document.getElementById('profile-dob').value = user.dob || '';
    }

    document.getElementById('profile-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const updatedData = {
            name: document.getElementById('profile-name').value,
            alias: document.getElementById('profile-alias').value,
            contact: document.getElementById('profile-contact').value,
            dob: document.getElementById('profile-dob').value
        };
        updateProfile(updatedData);
    });

    document.getElementById('change-password-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const oldPass = document.getElementById('current-password').value;
        const newPass = document.getElementById('new-password').value;

        if (newPass.length < 6) {
            alert("New password must be at least 6 characters long.");
            return;
        }

        changePassword(oldPass, newPass);
    });
};


const renderDashboard = () => {
    const pendingContainer = document.getElementById('pending-container');
    const activeContainer = document.getElementById('active-container');
    const pendingSection = document.getElementById('pending-section');

    if (!activeContainer) return; // Guard if DOM not ready

    pendingContainer.innerHTML = '';
    activeContainer.innerHTML = '';

    let totalOwed = 0;
    let totalLent = 0;
    let hasPending = false;

    // Helper for display name
    const getLoanTitle = (loan) => {
        if (loan.creator_email === state.user.email && loan.counterparty_name) {
            return loan.counterparty_name; // Use alias if I created it
        }
        return loan.counterparty; // Fallback to email
    };

    state.loans.forEach(loan => {
        const displayTitle = getLoanTitle(loan);

        // Status checks
        if (loan.status === 'pending') {
            const isCreator = loan.creator_email === state.user.email;
            const isMyRole = loan.role === 'lender' ? 'Lending' : 'Borrowing';

            let actionHtml = '';
            if (isCreator) {
                actionHtml = `
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <span class="loan-status" style="background: var(--glass-border); color: var(--text-secondary); margin-right:8px;">Waiting</span>
                        <button class="btn btn-secondary" style="padding: 6px 10px; font-size: 0.8em;" onclick="cancelLoan(${loan.id})">Cancel</button>
                    </div>
                `;
            } else {
                actionHtml = `<button class="btn btn-primary" onclick="window.openReview(${loan.id})">Review Request</button>`;
            }

            const div = document.createElement('div');
            div.className = 'loan-item';
            div.innerHTML = `
                <div class="loan-icon"><ion-icon name="time-outline"></ion-icon></div>
                <div class="loan-details">
                    <div class="loan-title">${formatMoney(loan.amount)}</div>
                    <div class="loan-subtitle">${isMyRole} to/from ${displayTitle}</div>
                </div>
                <div>${actionHtml}</div>
            `;
            pendingContainer.appendChild(div);
            hasPending = true;

        } else if (loan.status === 'active') {
            // Calculate stats
            const remaining = loan.total - loan.paid;
            if (loan.role === 'borrower') totalOwed += remaining;
            else totalLent += remaining;

            const div = document.createElement('div');
            div.className = 'loan-item ' + (loan.role === 'borrower' ? 'owed' : '');
            div.style.cursor = 'pointer';
            div.setAttribute('onclick', `openLoanDetails(${loan.id})`);

            div.innerHTML = `
                <div class="loan-icon">
                    <ion-icon name="${loan.role === 'borrower' ? 'arrow-down-outline' : 'arrow-up-outline'}"></ion-icon>
                </div>
                <div class="loan-details">
                    <div class="loan-title">${displayTitle}</div>
                    <div class="loan-subtitle">
                        <span class="loan-status status-active">Active</span>
                        ${loan.months}mo Term
                    </div>
                   <div style="margin-top: 8px;">
                        <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8em;" onclick="event.stopPropagation(); openPayment(${loan.id})">
                             ${loan.role === 'borrower' ? 'Pay' : 'Record'}
                        </button>
                   </div>
                </div>
                <div class="loan-values">
                    <span class="loan-amount">${formatMoney(remaining)}</span>
                    <span style="font-size:0.8em; color:var(--text-secondary);">of ${formatMoney(loan.total)}</span>
                </div>
            `;
            activeContainer.appendChild(div);
        }
    });

    if (hasPending) pendingSection.classList.remove('hidden');
    else pendingSection.classList.add('hidden');

    document.getElementById('total-owed').textContent = formatMoney(totalOwed);
    document.getElementById('total-lent').textContent = formatMoney(totalLent);
};

const renderArchive = () => {
    const archiveContainer = document.getElementById('archive-container');
    if (!archiveContainer) return;

    archiveContainer.innerHTML = '';

    // Helper for display name (duplicated for now or scope issue)
    const getLoanTitle = (loan) => {
        if (loan.creator_email === state.user.email && loan.counterparty_name) {
            return loan.counterparty_name;
        }
        return loan.counterparty;
    };

    const completedLoans = state.loans.filter(l => l.status === 'completed');

    if (completedLoans.length === 0) {
        archiveContainer.innerHTML = `
            <div class="glass-panel text-center" style="opacity: 0.6; padding: 40px;">
                <p>No archived loans found.</p>
            </div>
        `;
        return;
    }

    completedLoans.forEach(loan => {
        const displayTitle = getLoanTitle(loan);
        const div = document.createElement('div');
        div.className = 'loan-item';
        div.style.opacity = '0.6';
        div.style.cursor = 'pointer';
        div.setAttribute('onclick', `openLoanDetails(${loan.id})`);

        div.innerHTML = `
            <div class="loan-icon"><ion-icon name="checkmark-done-circle-outline" style="color: var(--success);"></ion-icon></div>
            <div class="loan-details">
                <div class="loan-title">${displayTitle}</div>
                <div class="loan-subtitle">Loan Repaid • ${formatMoney(loan.total)}</div>
            </div>
            <div class="loan-values">
                <span class="loan-status" style="background: rgba(16, 185, 129, 0.2); color: var(--success);">Completed</span>
            </div>
         `;
        archiveContainer.appendChild(div);
    });
};
const initAuthListeners = () => {
    const form = document.getElementById('auth-form');
    const switchBtn = document.getElementById('auth-switch-btn');
    const title = document.getElementById('auth-title');
    const nameGroup = document.getElementById('name-group');
    const submitBtn = document.getElementById('auth-submit');
    const switchText = document.getElementById('auth-switch-text');

    const updateUI = () => {
        if (state.authMode === 'login') {
            title.textContent = 'Welcome Back';
            nameGroup.style.display = 'none';
            submitBtn.textContent = 'Login';
            switchText.textContent = "Don't have an account?";
            switchBtn.textContent = 'Sign Up';
            document.getElementById('forgot-password-container').style.display = 'block';
        } else if (state.authMode === 'signup') {
            title.textContent = 'Create Account';
            nameGroup.style.display = 'block';
            submitBtn.textContent = 'Sign Up';
            switchText.textContent = "Already have an account?";
            switchBtn.textContent = 'Login';
            document.getElementById('forgot-password-container').style.display = 'none';
        } else if (state.authMode === 'forgot') {
            title.textContent = 'Reset Password';
            nameGroup.style.display = 'none';
            submitBtn.textContent = 'Send Reset Link';
            switchText.textContent = "Remembered it?";
            switchBtn.textContent = 'Login';
            document.getElementById('auth-email').placeholder = "Enter your email";
            document.getElementById('auth-password').closest('.form-group').style.display = 'none';
            document.getElementById('auth-password').required = false;
            document.getElementById('forgot-password-container').style.display = 'none';
        }
    };
    updateUI();

    document.getElementById('forgot-password-btn').addEventListener('click', (e) => {
        e.preventDefault();
        state.authMode = 'forgot';
        updateUI();
    });

    switchBtn.addEventListener('click', (e) => {
        e.preventDefault();
        if (state.authMode === 'forgot') {
            state.authMode = 'login';
            document.getElementById('auth-password').closest('.form-group').style.display = 'block';
            document.getElementById('auth-password').required = true;
        } else {
            state.authMode = state.authMode === 'login' ? 'signup' : 'login';
        }
        updateUI();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('auth-email').value;
        const password = document.getElementById('auth-password').value;
        console.log("Form submitted. Mode:", state.authMode, "Email:", email);

        if (state.authMode === 'login') {
            login(email, password);
        } else if (state.authMode === 'signup') {
            const name = document.getElementById('auth-name').value;
            register(email, password, name);
        } else if (state.authMode === 'forgot') {
            try {
                await apiRequest('/forgot-password', 'POST', { email });
                alert('If an account exists for ' + email + ', a reset link has been sent.');
                state.authMode = 'login';
                document.getElementById('auth-password').closest('.form-group').style.display = 'block';
                updateUI();
            } catch (err) {
                alert(err.message);
            }
        }
    });
};

const initResetListeners = () => {
    const form = document.getElementById('reset-password-form');
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const password = document.getElementById('reset-new-password').value;
        try {
            await apiRequest('/reset-password', 'POST', {
                token: state.resetToken,
                password
            });
            alert('Password updated successfully! Please login.');
            window.location.hash = ''; // Clear token
            navigate('auth');
        } catch (err) {
            alert(err.message);
        }
    });
};

const initCreateListeners = () => {
    const form = document.getElementById('create-loan-form');
    const inputs = ['amount', 'interest', 'tenure', 'interest-type'];

    const updatePreview = () => {
        const amount = parseFloat(document.getElementById('amount').value) || 0;
        const rate = parseFloat(document.getElementById('interest').value) || 0;
        const months = parseInt(document.getElementById('tenure').value) || 12;
        const type = document.getElementById('interest-type').value;

        // Simple calc (reused)
        let monthly = 0;
        let total = 0;
        if (type === 'simple') {
            const years = months / 12;
            total = amount + (amount * (rate / 100) * years);
            monthly = total / months;
        } else {
            const i = (rate / 100) / 12;
            if (i === 0) {
                total = amount;
                monthly = amount / months;
            } else {
                monthly = amount * (i * Math.pow(1 + i, months)) / (Math.pow(1 + i, months) - 1);
                total = monthly * months;
            }
        }

        document.getElementById('preview-monthly').textContent = formatMoney(monthly);
        document.getElementById('preview-total').textContent = formatMoney(total);
    };

    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updatePreview);
    });

    // Check radio buttons helper
    const radios = form.querySelectorAll('input[name="role"]');
    const updateRadios = () => {
        radios.forEach(r => {
            const parent = r.closest('label');
            if (r.checked) {
                parent.classList.remove('btn-secondary');
                parent.classList.add('btn-primary');
            } else {
                parent.classList.add('btn-secondary');
                parent.classList.remove('btn-primary');
            }
        });
    };
    radios.forEach(radio => {
        radio.addEventListener('change', updateRadios);
    });
    // Init state
    updateRadios();

    // Cancel Button
    document.getElementById('create-cancel').addEventListener('click', () => {
        navigate('dashboard');
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const role = form.querySelector('input[name="role"]:checked').value;
        const amount = parseFloat(document.getElementById('amount').value);
        // Recalc for safety
        updatePreview();
        const monthly = parseFloat(document.getElementById('preview-monthly').textContent.replace(/[^0-9.-]+/g, ""));
        const total = parseFloat(document.getElementById('preview-total').textContent.replace(/[^0-9.-]+/g, ""));

        const loanData = {
            role,
            counterpartyEmail: document.getElementById('counterparty-email').value,
            counterpartyName: document.getElementById('counterparty').value,
            amount,
            rate: parseFloat(document.getElementById('interest').value),
            months: parseInt(document.getElementById('tenure').value),
            interestType: document.getElementById('interest-type').value,
            monthly,
            total
        };
        createLoan(loanData);
    });
};



// Modal Logic
window.openReview = (id) => {
    const loan = state.loans.find(l => l.id === id);
    if (!loan) return;

    const modal = document.getElementById('review-modal');
    const content = document.getElementById('review-content');

    // We need to define who is who for the review text.
    // "User X is proposing to [Lend/Borrow] $Y to/from You."
    const isMeLender = loan.role === 'lender';

    content.innerHTML = `
        <p style="font-size: 1.2rem; margin-bottom: 12px;">
            <strong>${loan.counterparty}</strong> wants to 
            ${isMeLender ? 'BORROW from you' : 'LEND to you'}:
        </p>
        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>Principal Amount:</span>
                <strong>${formatMoney(loan.amount)}</strong>
            </div>
             <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>Interest:</span>
                <strong>${loan.rate}% (${loan.interestType})</strong>
            </div>
             <div style="display:flex; justify-content:space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px;">
                <span>Total Repayment:</span>
                <strong style="color: var(--accent);">${formatMoney(loan.total)}</strong>
            </div>
        </div>
    `;

    document.getElementById('accept-btn').onclick = () => acceptLoan(id);
    document.getElementById('reject-btn').onclick = () => rejectLoan(id);
    document.getElementById('close-review').onclick = () => modal.classList.add('hidden');

    modal.classList.remove('hidden');
};

let currentPaymentLoanId = null;
window.openPayment = (id) => {
    currentPaymentLoanId = id;
    document.getElementById('payment-modal').classList.remove('hidden');
};

// Chart instance
let detailsChart = null;

window.openLoanDetails = (id) => {
    const loan = state.loans.find(l => l.id === id);
    if (!loan) return;

    const modal = document.getElementById('details-modal');
    modal.classList.remove('hidden');

    // Fill Stats
    // Logic for display title
    let displayTitle = loan.counterparty;
    if (loan.creator_email === state.user.email && loan.counterparty_name) {
        displayTitle = loan.counterparty_name;
    }

    document.getElementById('details-title').textContent = `${loan.role === 'lender' ? 'Lending to' : 'Borrowing from'} ${displayTitle}`;
    document.getElementById('details-total').textContent = formatMoney(loan.total);
    document.getElementById('details-paid').textContent = formatMoney(loan.paid);
    document.getElementById('details-remaining').textContent = formatMoney(loan.total - loan.paid);

    // Fill History
    const historyList = document.getElementById('details-history-list');
    historyList.innerHTML = '';

    if (loan.history && loan.history.length > 0) {
        loan.history.forEach(payment => {
            const div = document.createElement('div');
            div.style.background = 'rgba(255,255,255,0.05)';
            div.style.padding = '12px';
            div.style.borderRadius = '8px';
            div.style.display = 'flex';
            div.style.justifyContent = 'space-between';
            const date = new Date(payment.date).toLocaleDateString();
            div.innerHTML = `<span>${date}</span><span style="color: var(--success);">+${formatMoney(payment.amount)}</span>`;
            historyList.appendChild(div);
        });
    } else {
        historyList.innerHTML = '<p style="color: var(--text-secondary); font-style: italic;">No payments recorded yet.</p>';
    }

    // Render Chart
    renderChart(loan);
};

const renderChart = (loan) => {
    const ctx = document.getElementById('details-chart').getContext('2d');

    if (detailsChart) {
        detailsChart.destroy();
    }

    // Prepare Data
    // Target: Linear line from Start Date (Created) to End Date (Created + Months)
    // Actual: Cumulative payments

    const startDate = new Date(loan.created_at);
    // End date is roughly startDate + months
    const endDate = new Date(startDate);
    endDate.setMonth(startDate.getMonth() + loan.months);

    const today = new Date();

    // Generate labels (Months)
    const labels = [];
    const targetData = []; // Ideal linear repayment
    const actualData = []; // Actual cumulative

    // Helper to get month diff
    const monthDiff = (d1, d2) => {
        let months = (d2.getFullYear() - d1.getFullYear()) * 12;
        months -= d1.getMonth();
        months += d2.getMonth();
        return months <= 0 ? 0 : months;
    };

    // Create points for every month from start to end
    for (let i = 0; i <= loan.months; i++) {
        const d = new Date(startDate);
        d.setMonth(startDate.getMonth() + i);
        labels.push(`Month ${i}`);

        // Target: Total / Months * i
        targetData.push((loan.total / loan.months) * i);
    }

    // Map actual payments to these buckets? 
    // Just mapping cumulative paid over time is complex if dates don't align.
    // Simplified: Just 0 to Current Month Index

    // Calculate current month index relative to start
    let currentMonthIndex = monthDiff(startDate, today);
    if (currentMonthIndex > loan.months) currentMonthIndex = loan.months; // Cap if overdue

    // Build actual data array (cumulative)
    let runningTotal = 0;
    // We need to bucket payments by month index
    const paymentsByMonth = new Array(loan.months + 1).fill(0);

    if (loan.history) {
        loan.history.forEach(p => {
            const pDate = new Date(p.date);
            const idx = monthDiff(startDate, pDate);
            if (idx >= 0 && idx <= loan.months) {
                paymentsByMonth[idx] += p.amount;
            } else if (idx > loan.months) {
                paymentsByMonth[loan.months] += p.amount; // Add to last if late
            }
        });
    }

    // Calculate cumulative for actualData up to current index (or last payment)
    for (let i = 0; i <= loan.months; i++) {
        runningTotal += paymentsByMonth[i];
        // Only push if i <= currentMonthIndex OR if we have data (showing future as flat is wrong, usually stop at today)
        if (i <= currentMonthIndex + 1) { // Show up to current + 1 for context
            actualData.push(runningTotal);
        }
    }

    // If loan is completed, ensure we show full line
    if (loan.status === 'completed' && actualData.length < labels.length) {
        // Extend the last value to the end?
        // No, just show what we have.
    }

    detailsChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Target Repayment',
                    data: targetData,
                    borderColor: 'rgba(255, 255, 255, 0.3)',
                    borderDash: [5, 5],
                    tension: 0.1,
                    pointRadius: 0
                },
                {
                    label: 'Actual Repayment',
                    data: actualData,
                    borderColor: '#818cf8',
                    backgroundColor: 'rgba(129, 140, 248, 0.2)',
                    tension: 0.2,
                    fill: true
                }
            ]
        },
        options: {
            responsive: true,
            interaction: {
                intersect: false,
                mode: 'index',
            },
            plugins: {
                legend: {
                    labels: { color: 'white' }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(255,255,255,0.1)' },
                    ticks: { color: 'rgba(255,255,255,0.7)' }
                },
                x: {
                    grid: { display: false },
                    ticks: { color: 'rgba(255,255,255,0.7)' }
                }
            }
        }
    });
};

document.getElementById('close-details').addEventListener('click', () => {
    document.getElementById('details-modal').classList.add('hidden');
});

// Global Listeners for Payment Modal (outside render loop)
document.getElementById('cancel-payment').addEventListener('click', () => {
    document.getElementById('payment-modal').classList.add('hidden');
});

document.getElementById('confirm-payment').addEventListener('click', () => {
    const amount = parseFloat(document.getElementById('payment-amount').value);
    if (amount > 0 && currentPaymentLoanId) {
        recordPayment(currentPaymentLoanId, amount);
    }
});


// Start
if (state.token) {
    navigate('dashboard');
    fetchLoans();
} else if (window.location.hash.includes('#reset')) {
    navigate('reset');
} else {
    navigate('auth');
}
