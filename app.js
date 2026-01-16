
// Configuration
const API_URL = '/api';

// State
const state = {
    loans: [],
    listings: [],
    view: 'auth', // 'auth', 'dashboard', 'create', 'reset', 'marketplace'
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

const recordPayment = async (loanId, amount, method, date) => {
    try {
        await apiRequest(`/loans/${loanId}/pay`, 'POST', { amount, method, date });
        document.getElementById('payment-modal').classList.add('hidden');
        document.getElementById('payment-amount').value = '';
        fetchLoans();
        alert('Payment recorded!');
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

// Marketplace Actions
const fetchListings = async () => {
    try {
        const listings = await apiRequest('/listings');
        state.listings = listings;
        if (state.view === 'marketplace') renderMarketplace();
    } catch (e) {
        console.error("Failed to fetch listings", e);
    }
};

const createListingPost = async (listingData) => {
    try {
        await apiRequest('/listings', 'POST', listingData);
        document.getElementById('listing-modal').classList.add('hidden');
        document.getElementById('listing-form').reset();
        fetchListings();
        alert('Listing posted successfully!');
    } catch (e) {
        alert("Failed to post listing: " + e.message);
    }
};

const deleteListingPost = async (id) => {
    if (!confirm("Delete this listing?")) return;
    try {
        await apiRequest(`/listings/${id}`, 'DELETE');
        fetchListings();
    } catch (e) {
        alert("Failed to delete listing: " + e.message);
    }
};

window.requestFromListing = (listingId) => {
    const listing = state.listings.find(l => l.id === listingId);
    if (!listing) return;

    // Pre-fill "New Agreement" with listing data
    state.preFillListing = listing;
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
        const navMarketplace = layout.getElementById('nav-marketplace');
        const navProfile = layout.getElementById('nav-profile');
        const navArchive = layout.getElementById('nav-archive');

        if (state.view === 'dashboard') navDash.classList.add('active');
        else navDash.classList.remove('active');

        if (state.view === 'create') navCreate.classList.add('active');
        else navCreate.classList.remove('active');

        if (state.view === 'marketplace') navMarketplace.classList.add('active');
        else navMarketplace.classList.remove('active');

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
        } else if (state.view === 'marketplace') {
            const marketplaceTemplate = document.getElementById('view-marketplace');
            mainContent.appendChild(marketplaceTemplate.content.cloneNode(true));
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
        document.getElementById('nav-marketplace').addEventListener('click', () => navigate('marketplace'));
        document.getElementById('nav-profile').addEventListener('click', () => navigate('profile'));
        document.getElementById('nav-archive').addEventListener('click', () => navigate('archive'));
        document.getElementById('nav-logout').addEventListener('click', logout);

        if (state.view === 'dashboard') {
            renderDashboard();
        } else if (state.view === 'create') {
            initCreateListeners();
        } else if (state.view === 'marketplace') {
            renderMarketplace();
            initMarketplaceListeners();
        } else if (state.view === 'profile') {
            initProfileListeners();
        } else if (state.view === 'archive') {
            renderArchive();
        }
    }
};


const renderMarketplace = async () => {
    const container = document.getElementById('listings-container');
    if (!container) return;

    container.innerHTML = '<div class="glass-panel text-center" style="grid-column: 1/-1; padding: 40px; opacity: 0.6;"><p>Loading listings...</p></div>';

    await fetchListings();

    container.innerHTML = '';

    if (state.listings.length === 0) {
        container.innerHTML = '<div class="glass-panel text-center" style="grid-column: 1/-1; padding: 40px; opacity: 0.6;"><p>No items listed yet. Be the first to post!</p></div>';
        return;
    }

    state.listings.forEach(listing => {
        const isOwner = listing.user_email === state.user.email;
        const div = document.createElement('div');
        div.className = 'glass-panel listing-card';
        div.style.padding = '24px';
        div.style.display = 'flex';
        div.style.flexDirection = 'column';
        div.style.gap = '15px';

        div.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: start;">
                <div class="brand-icon" style="width: 40px; height: 40px; font-size: 1rem;">${listing.item_name.substring(0, 2).toUpperCase()}</div>
                ${isOwner ? '<span class="loan-status" style="background: var(--glass-border); color: var(--text-secondary);">Your Post</span>' : ''}
            </div>
            
            <div>
                <h3 style="margin: 0; font-size: 1.2rem;">${listing.item_name}</h3>
                <p style="color: var(--text-secondary); font-size: 0.9rem; margin-top: 5px;">${listing.description || 'No description provided.'}</p>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem;">
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                    <div style="color: var(--text-secondary);">Charge</div>
                    <div style="font-weight: 700; color: var(--success); font-size: 1.1rem;">${formatMoney(listing.charge || 0)}</div>
                </div>
                <div style="background: rgba(255,255,255,0.05); padding: 10px; border-radius: 8px;">
                    <div style="color: var(--text-secondary);">Deposit</div>
                    <div style="font-weight: 700; font-size: 1.1rem;">${formatMoney(listing.deposit || 0)}</div>
                </div>
            </div>

            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.85rem; color: var(--text-secondary);">
                <div style="display: flex; align-items: center; gap: 8px;">
                    <ion-icon name="location-outline"></ion-icon>
                    <span>${listing.location || 'N/A'}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <ion-icon name="time-outline"></ion-icon>
                    <span>${listing.tenure || 'Flexible'} Month(s) Tenure</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <ion-icon name="person-outline"></ion-icon>
                    <span>Posted by: ${listing.owner_alias || listing.owner_name || listing.user_email}</span>
                </div>
            </div>

            <div style="margin-top: auto; padding-top: 15px;">
                ${isOwner ? `
                    <button class="btn btn-danger" style="width: 100%;" onclick="deleteListingPost(${listing.id})">Remove Listing</button>
                ` : `
                    <button class="btn btn-primary" style="width: 100%; font-weight: 700;" onclick="requestFromListing(${listing.id})">Request to Borrow</button>
                `}
            </div>
        `;
        container.appendChild(div);
    });
};

const initMarketplaceListeners = () => {
    const modal = document.getElementById('listing-modal');
    const openBtn = document.getElementById('btn-open-listing');
    const cancelBtn = document.getElementById('cancel-listing');
    const form = document.getElementById('listing-form');

    window.openListingModal = () => modal.classList.remove('hidden');

    if (openBtn) openBtn.onclick = openListingModal;
    if (cancelBtn) {
        cancelBtn.onclick = () => {
            modal.classList.add('hidden');
            form.reset();
        };
    }

    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            const listingData = {
                itemName: document.getElementById('listing-name').value,
                description: document.getElementById('listing-desc').value,
                charge: parseFloat(document.getElementById('listing-charge').value) || 0,
                deposit: parseFloat(document.getElementById('listing-deposit').value) || 0,
                location: document.getElementById('listing-location').value,
                tenure: parseInt(document.getElementById('listing-tenure').value) || 0
            };
            createListingPost(listingData);
        };
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
        const isItem = loan.asset_type === 'item';

        // Status checks
        if (loan.status === 'pending') {
            const isCreator = loan.creator_email === state.user.email;
            const isMyRole = loan.role === 'lender' ? 'Lending' : 'Borrowing';

            let displayAmount = isItem ? loan.item_name : formatMoney(loan.amount);

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
                <div class="loan-icon"><ion-icon name="${isItem ? 'cube-outline' : 'time-outline'}"></ion-icon></div>
                <div class="loan-details">
                    <div class="loan-title">${displayAmount}</div>
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

            let iconName = isItem ? 'cube-outline' : (loan.role === 'borrower' ? 'arrow-down-outline' : 'arrow-up-outline');
            let displayHeader = isItem ? `${loan.item_name} (${displayTitle})` : displayTitle;

            div.innerHTML = `
                <div class="loan-icon">
                    <ion-icon name="${iconName}"></ion-icon>
                </div>
                <div class="loan-details">
                    <div class="loan-title">${displayHeader}</div>
                    <div class="loan-subtitle">
                        <span class="loan-status status-active">Active</span>
                        ${loan.months}mo Term
                    </div>
                   <div style="margin-top: 8px;">
                        <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.8em;" onclick="event.stopPropagation(); openPayment(${loan.id})">
                             ${loan.role === 'borrower' ? (isItem ? 'Pay Fee' : 'Pay') : (isItem ? 'Record Fee' : 'Record')}
                        </button>
                   </div>
                </div>
                <div class="loan-values">
                    <span class="loan-amount">${isItem ? 'Fee: ' : ''}${formatMoney(remaining)}</span>
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
        const isItem = loan.asset_type === 'item';
        const div = document.createElement('div');
        div.className = 'loan-item';
        div.style.opacity = '0.6';
        div.style.cursor = 'pointer';
        div.setAttribute('onclick', `openLoanDetails(${loan.id})`);

        let displaySub = isItem ? `Item Returned • ${loan.item_name}` : `Loan Repaid • ${formatMoney(loan.total)}`;

        div.innerHTML = `
            <div class="loan-icon"><ion-icon name="${isItem ? 'cube-outline' : 'checkmark-done-circle-outline'}" style="color: var(--success);"></ion-icon></div>
            <div class="loan-details">
                <div class="loan-title">${displayTitle}</div>
                <div class="loan-subtitle">${displaySub}</div>
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

    // Asset Type Radios
    const assetRadios = form.querySelectorAll('input[name="assetType"]');
    const itemFields = document.getElementById('item-fields');
    const amountLabel = document.getElementById('amount-label');
    const previewMonthlyLabel = document.getElementById('preview-monthly-label');
    const previewTotalLabel = document.getElementById('preview-total-label');

    const updateAssetType = () => {
        const val = form.querySelector('input[name="assetType"]:checked').value;
        if (val === 'item') {
            itemFields.classList.remove('hidden');
            amountLabel.textContent = "Rental Fee / Deposit ($)";
            previewMonthlyLabel.textContent = "Monthly Fee:";
            previewTotalLabel.textContent = "Total Fees:";
            document.getElementById('item-name').required = true;
        } else {
            itemFields.classList.add('hidden');
            amountLabel.textContent = "Amount ($)";
            previewMonthlyLabel.textContent = "Monthly Payment:";
            previewTotalLabel.textContent = "Total Repayment:";
            document.getElementById('item-name').required = false;
        }
        updateAssetRadios();
        updatePreview();
    };

    const updateAssetRadios = () => {
        assetRadios.forEach(r => {
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

    assetRadios.forEach(radio => {
        radio.addEventListener('change', updateAssetType);
    });

    // Check Role radio buttons helper
    const radios = form.querySelectorAll('input[name="role"]');
    const updateRadios = () => {
        radios.forEach(r => {
            const parent = r.closest('label');
            if (r.checked) {
                parent.classList.remove('btn-secondary');
                parent.classList.add('btn-primary');

                // Update Icon/Labels based on checked role
                const label = document.getElementById('counterparty-label');
                const nameLabel = document.getElementById('counterparty-name-label');

                if (label) {
                    if (r.value === 'borrower') {
                        label.textContent = "Lender's Email";
                        if (nameLabel) nameLabel.textContent = "Lender's Name";
                    } else {
                        label.textContent = "Borrower's Email";
                        if (nameLabel) nameLabel.textContent = "Borrower's Name";
                    }
                }
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
    updateAssetRadios();

    // Cancel Button
    document.getElementById('create-cancel').addEventListener('click', () => {
        navigate('dashboard');
    });

    // Pre-fill if editing
    if (state.editingLoanId) {
        const loan = state.loans.find(l => l.id === state.editingLoanId);
        if (loan) {
            // Set Role
            form.querySelector(`input[name="role"][value="${loan.role}"]`).checked = true;
            updateRadios();

            // Set Asset Type
            form.querySelector(`input[name="assetType"][value="${loan.asset_type}"]`).checked = true;
            updateAssetType();

            // Set fields
            document.getElementById('counterparty-email').value = loan.counterparty;
            document.getElementById('counterparty').value = loan.counterparty_name || '';
            document.getElementById('amount').value = loan.amount;
            document.getElementById('interest').value = loan.rate;
            document.getElementById('tenure').value = loan.months;
            document.getElementById('interest-type').value = loan.interestType;

            if (loan.asset_type === 'item') {
                document.getElementById('item-name').value = loan.item_name || '';
                document.getElementById('item-description').value = loan.item_description || '';
                document.getElementById('item-condition').value = loan.item_condition || '';
            }

            // Update header
            const header = document.querySelector('.page-title');
            if (header) header.textContent = "Edit Agreement";

            updatePreview();
        }
    }

    // Pre-fill if from Marketplace
    if (state.preFillListing) {
        const listing = state.preFillListing;
        // Marketplace requests are always "I am Borrowing"
        form.querySelector('input[name="role"][value="borrower"]').checked = true;
        updateRadios();

        // Marketplace items are always "Physical Item"
        form.querySelector('input[name="assetType"][value="item"]').checked = true;
        updateAssetType();

        // Fill fields
        document.getElementById('counterparty-email').value = listing.user_email;
        document.getElementById('counterparty').value = listing.owner_name || '';
        document.getElementById('item-name').value = listing.item_name;
        document.getElementById('item-description').value = listing.description || '';
        document.getElementById('amount').value = (listing.charge || 0) + (listing.deposit || 0);
        document.getElementById('tenure').value = listing.tenure || 1;

        // Reset so it doesn't persist
        state.preFillListing = null;
        updatePreview();
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const role = form.querySelector('input[name="role"]:checked').value;
        const assetType = form.querySelector('input[name="assetType"]:checked').value;
        const amount = parseFloat(document.getElementById('amount').value);

        // Recalc for safety
        updatePreview();
        const monthly = parseFloat(document.getElementById('preview-monthly').textContent.replace(/[^0-9.-]+/g, ""));
        const total = parseFloat(document.getElementById('preview-total').textContent.replace(/[^0-9.-]+/g, ""));

        const loanData = {
            role,
            assetType,
            itemName: document.getElementById('item-name').value,
            itemDescription: document.getElementById('item-description').value,
            itemCondition: document.getElementById('item-condition').value,
            counterpartyEmail: document.getElementById('counterparty-email').value,
            counterpartyName: document.getElementById('counterparty').value,
            amount,
            rate: parseFloat(document.getElementById('interest').value),
            months: parseInt(document.getElementById('tenure').value),
            interestType: document.getElementById('interest-type').value,
            monthly,
            total
        };

        try {
            if (state.editingLoanId) {
                await apiRequest(`/loans/${state.editingLoanId}`, 'PUT', loanData);
                alert('Loan agreement updated!');
                state.editingLoanId = null;
                navigate('dashboard');
                fetchLoans();
            } else {
                await createLoan(loanData);
            }
        } catch (err) {
            alert(err.message);
        }
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
    const isItem = loan.asset_type === 'item';

    content.innerHTML = `
        <p style="font-size: 1.2rem; margin-bottom: 12px;">
            <strong>${loan.counterparty}</strong> wants to 
            ${isMeLender ? 'BORROW from you' : 'LEND to you'}:
        </p>
        <div style="background: rgba(0,0,0,0.2); padding: 12px; border-radius: 8px;">
            ${isItem ? `
            <div style="display:flex; justify-content:space-between; margin-bottom: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 8px;">
                <span>Item:</span>
                <strong>${loan.item_name}</strong>
            </div>
            ${loan.item_description ? `
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>Description:</span>
                <span style="font-size: 0.9em; text-align: right; max-width: 60%;">${loan.item_description}</span>
            </div>` : ''}
            ${loan.item_condition ? `
            <div style="display:flex; justify-content:space-between; margin-bottom: 8px;">
                <span>Condition:</span>
                <strong>${loan.item_condition}</strong>
            </div>` : ''}
            ` : ''}
            <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>${isItem ? 'Rental/Deposit:' : 'Principal Amount:'}</span>
                <strong>${formatMoney(loan.amount)}</strong>
            </div>
             <div style="display:flex; justify-content:space-between; margin-bottom: 4px;">
                <span>Interest:</span>
                <strong>${loan.rate}% (${loan.interestType})</strong>
            </div>
             <div style="display:flex; justify-content:space-between; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 4px; margin-top: 4px;">
                <span>Total ${isItem ? 'Fees' : 'Repayment'}:</span>
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

    // Reset fields
    document.getElementById('payment-amount').value = '';
    document.getElementById('payment-method').value = 'Cash';
    document.getElementById('payment-method-other').classList.add('hidden');
    document.getElementById('payment-method-other').value = '';

    // Set Date to Today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('payment-date').value = today;

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

    const isItem = loan.asset_type === 'item';
    let detailsText = `${loan.role === 'lender' ? 'Lending to' : 'Borrowing from'} ${displayTitle}`;
    if (isItem) detailsText = `${loan.item_name} - ${detailsText}`;

    document.getElementById('details-title').textContent = detailsText;
    document.getElementById('details-total').textContent = formatMoney(loan.total);
    document.getElementById('details-paid').textContent = formatMoney(loan.paid);
    document.getElementById('details-remaining').textContent = formatMoney(loan.total - loan.paid);

    // If item, add item details to the modal?
    if (isItem) {
        const historyHeader = document.querySelector('#details-history-list').previousElementSibling;
        const itemInfoDivId = 'details-item-info';
        let itemInfoDiv = document.getElementById(itemInfoDivId);
        if (!itemInfoDiv) {
            itemInfoDiv = document.createElement('div');
            itemInfoDiv.id = itemInfoDivId;
            itemInfoDiv.style.marginBottom = '20px';
            itemInfoDiv.style.padding = '15px';
            itemInfoDiv.style.background = 'rgba(255,255,255,0.05)';
            itemInfoDiv.style.borderRadius = '12px';
            historyHeader.parentNode.insertBefore(itemInfoDiv, historyHeader);
        }
        itemInfoDiv.innerHTML = `
            <h4 style="margin-top:0; margin-bottom:10px; color:var(--text-secondary);">Item Details</h4>
            <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
                <div><span style="color:var(--text-secondary); font-size:0.9em;">Condition:</span> <br><strong>${loan.item_condition || 'N/A'}</strong></div>
                <div><span style="color:var(--text-secondary); font-size:0.9em;">Description:</span> <br><strong>${loan.item_description || 'N/A'}</strong></div>
            </div>
        `;
    } else {
        const itemInfoDiv = document.getElementById('details-item-info');
        if (itemInfoDiv) itemInfoDiv.remove();
    }

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
            const method = payment.method ? ` <span style="font-size:0.8em; color:var(--text-secondary);">(${payment.method})</span>` : '';
            div.innerHTML = `<span>${date}${method}</span><span style="color: var(--success);">+${formatMoney(payment.amount)}</span>`;
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

    const methodSelect = document.getElementById('payment-method').value;
    let method = methodSelect;
    if (method === 'Other') {
        method = document.getElementById('payment-method-other').value || 'Other';
    }

    const date = document.getElementById('payment-date').value;

    if (amount > 0 && currentPaymentLoanId) {
        const loan = state.loans.find(l => l.id === currentPaymentLoanId);
        if (loan) {
            const remaining = loan.total - loan.paid;
            // Use a small epsilon for float comparison safety
            if (amount > remaining + 0.01) {
                alert(`Caution: Payment amount ($${amount.toFixed(2)}) exceeds the remaining balance ($${remaining.toFixed(2)}). Please adjust the amount.`);
                return;
            }
        }
        recordPayment(currentPaymentLoanId, amount, method, date);
    } else {
        alert("Please enter a valid amount.");
    }
});

document.getElementById('payment-method').addEventListener('change', (e) => {
    const otherInput = document.getElementById('payment-method-other');
    if (e.target.value === 'Other') {
        otherInput.classList.remove('hidden');
    } else {
        otherInput.classList.add('hidden');
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
