// Global variables
const room = new WebsimSocket();
let currentUser = null;
let projectCreator = null;
let membershipConfig = null;
let members = [];
let payments = [];

// Initialize the application
async function init() {
    try {
        currentUser = await window.websim.getCurrentUser();
        projectCreator = await window.websim.getCreatedBy();
        
        // Check if current user is the creator
        if (currentUser.id !== projectCreator.id) {
            showAccessDenied();
            return;
        }
        
        document.getElementById('admin-name').textContent = `@${currentUser.username}`;
        
        await loadMembershipConfig();
        await loadMembers();
        await loadPayments();
        
        setupEventListeners();
        setupRealtimeUpdates();
        updateDashboard();
        
    } catch (error) {
        console.error('Initialization error:', error);
        showError('Failed to initialize application');
    }
}

function showAccessDenied() {
    document.body.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; text-align: center; padding: 2rem;">
            <h1 style="color: #e74c3c; margin-bottom: 1rem;">❌ Access Denied</h1>
            <p style="color: #7f8c8d; font-size: 1.1rem;">Only the project creator can access this membership management system.</p>
        </div>
    `;
}

// Load membership configuration
async function loadMembershipConfig() {
    const configs = room.collection('membership_config').getList();
    if (configs.length > 0) {
        membershipConfig = configs[0];
    } else {
        // Create default config
        membershipConfig = await room.collection('membership_config').create({
            pricing_model: 'monthly',
            price_amount: 100,
            membership_title: 'Premium Membership',
            membership_description: 'Access to exclusive content and features',
            grace_days: 3,
            notify_expiring: true,
            notify_new_members: true
        });
    }
    
    // Update settings form
    document.getElementById('pricing-model').value = membershipConfig.pricing_model;
    document.getElementById('price-amount').value = membershipConfig.price_amount;
    document.getElementById('membership-title').value = membershipConfig.membership_title;
    document.getElementById('membership-description').value = membershipConfig.membership_description;
    document.getElementById('grace-days').value = membershipConfig.grace_days;
    document.getElementById('notify-expiring').checked = membershipConfig.notify_expiring;
    document.getElementById('notify-new-members').checked = membershipConfig.notify_new_members;
}

// Load members from database
async function loadMembers() {
    members = room.collection('membership_member').getList();
}

// Load payments from database
async function loadPayments() {
    payments = room.collection('membership_payment').getList();
}

// Setup event listeners
function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });
    
    // Settings form
    document.getElementById('save-settings').addEventListener('click', saveSettings);
    
    // Filters
    document.getElementById('status-filter').addEventListener('change', filterMembers);
    document.getElementById('search-members').addEventListener('input', filterMembers);
    document.getElementById('filter-payments').addEventListener('click', filterPayments);
    
    // Modal close
    document.querySelector('.close-btn').addEventListener('click', closeModal);
    document.getElementById('member-modal').addEventListener('click', (e) => {
        if (e.target === e.currentTarget) closeModal();
    });
}

// Setup real-time updates
function setupRealtimeUpdates() {
    // Listen for new tip comments (payments)
    window.websim.addEventListener('comment:created', async (data) => {
        if (data.comment.card_data && data.comment.card_data.type === 'tip_comment') {
            await handleNewPayment(data.comment);
        }
    });
    
    // Subscribe to database changes
    room.collection('membership_member').subscribe(() => {
        loadMembers();
        updateDashboard();
        renderMembers();
    });
    
    room.collection('membership_payment').subscribe(() => {
        loadPayments();
        updateDashboard();
        renderPayments();
    });
}

// Handle new payment from tip comment
async function handleNewPayment(comment) {
    const creditsSpent = comment.card_data.credits_spent;
    const userId = comment.author.id;
    const username = comment.author.username;
    
    // Find existing member or create new one
    let member = members.find(m => m.user_id === userId);
    
    if (!member) {
        member = await room.collection('membership_member').create({
            user_id: userId,
            username: username,
            avatar_url: comment.author.avatar_url || `https://images.websim.com/avatar/${username}`,
            total_paid: creditsSpent,
            membership_start: new Date().toISOString(),
            membership_end: calculateMembershipEnd(creditsSpent),
            status: 'active',
            payment_count: 1
        });
    } else {
        const newTotalPaid = member.total_paid + creditsSpent;
        const newMembershipEnd = calculateMembershipEnd(creditsSpent, member.membership_end);
        
        await room.collection('membership_member').update(member.id, {
            total_paid: newTotalPaid,
            membership_end: newMembershipEnd,
            status: 'active',
            payment_count: member.payment_count + 1
        });
    }
    
    // Create payment record
    await room.collection('membership_payment').create({
        user_id: userId,
        username: username,
        amount: creditsSpent,
        comment_id: comment.id,
        payment_date: comment.created_at,
        pricing_model: membershipConfig.pricing_model
    });
    
    // Show notification
    showNotification(`New payment of ${creditsSpent} credits from @${username}`, 'success');
}

// Calculate membership end date based on payment
function calculateMembershipEnd(creditsSpent, currentEnd = null) {
    const priceAmount = membershipConfig.price_amount;
    const pricingModel = membershipConfig.pricing_model;
    
    // Calculate how many periods this payment covers
    const periods = Math.floor(creditsSpent / priceAmount);
    
    if (periods === 0) return currentEnd; // Partial payment
    
    const startDate = currentEnd ? new Date(currentEnd) : new Date();
    
    switch (pricingModel) {
        case 'daily':
            startDate.setDate(startDate.getDate() + periods);
            break;
        case 'weekly':
            startDate.setDate(startDate.getDate() + (periods * 7));
            break;
        case 'biweekly':
            startDate.setDate(startDate.getDate() + (periods * 14));
            break;
        case 'monthly':
            startDate.setMonth(startDate.getMonth() + periods);
            break;
        case 'oneday':
            startDate.setDate(startDate.getDate() + 1);
            break;
    }
    
    return startDate.toISOString();
}

// Switch tabs
function switchTab(tabName) {
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
    
    if (tabName === 'members') renderMembers();
    if (tabName === 'payments') renderPayments();
    if (tabName === 'dashboard') updateDashboard();
}

// Update dashboard statistics
function updateDashboard() {
    const now = new Date();
    const activeMembers = members.filter(m => new Date(m.membership_end) > now).length;
    const expiredMembers = members.filter(m => new Date(m.membership_end) <= now).length;
    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    
    document.getElementById('total-members').textContent = members.length;
    document.getElementById('active-members').textContent = activeMembers;
    document.getElementById('total-revenue').textContent = totalRevenue;
    document.getElementById('expired-members').textContent = expiredMembers;
    
    renderRecentActivity();
    renderRevenueChart();
}

// Render recent activity
function renderRecentActivity() {
    const activityFeed = document.getElementById('activity-feed');
    const recentItems = [...payments, ...members]
        .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        .slice(0, 10);
    
    activityFeed.innerHTML = recentItems.map(item => {
        if (item.amount) { // Payment
            return `
                <div class="activity-item">
                    <div class="activity-icon payment">💰</div>
                    <div class="activity-info">
                        <strong>@${item.username}</strong> paid ${item.amount} credits
                        <div class="activity-time">${formatTimeAgo(item.created_at)}</div>
                    </div>
                </div>
            `;
        } else { // Member
            return `
                <div class="activity-item">
                    <div class="activity-icon member">👤</div>
                    <div class="activity-info">
                        <strong>@${item.username}</strong> joined as member
                        <div class="activity-time">${formatTimeAgo(item.created_at)}</div>
                    </div>
                </div>
            `;
        }
    }).join('');
}

// Render revenue chart
function renderRevenueChart() {
    const ctx = document.getElementById('revenueChart').getContext('2d');
    
    // Group payments by date
    const dateGroups = {};
    payments.forEach(payment => {
        const date = new Date(payment.payment_date).toLocaleDateString();
        dateGroups[date] = (dateGroups[date] || 0) + payment.amount;
    });
    
    const dates = Object.keys(dateGroups).sort();
    const revenues = dates.map(date => dateGroups[date]);
    
    new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Revenue (Credits)',
                data: revenues,
                borderColor: '#667eea',
                backgroundColor: 'rgba(102, 126, 234, 0.1)',
                tension: 0.4,
                fill: true
            }]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: true
                }
            }
        }
    });
}

// Render members list
function renderMembers() {
    const membersList = document.getElementById('members-list');
    const statusFilter = document.getElementById('status-filter').value;
    const searchTerm = document.getElementById('search-members').value.toLowerCase();
    
    let filteredMembers = members.filter(member => {
        const matchesSearch = member.username.toLowerCase().includes(searchTerm);
        const now = new Date();
        const membershipEnd = new Date(member.membership_end);
        const gracePeriodEnd = new Date(membershipEnd);
        gracePeriodEnd.setDate(gracePeriodEnd.getDate() + membershipConfig.grace_days);
        
        let matchesStatus = true;
        if (statusFilter === 'active') {
            matchesStatus = membershipEnd > now;
        } else if (statusFilter === 'expired') {
            matchesStatus = gracePeriodEnd < now;
        } else if (statusFilter === 'due') {
            matchesStatus = membershipEnd <= now && gracePeriodEnd >= now;
        }
        
        return matchesSearch && matchesStatus;
    });
    
    membersList.innerHTML = filteredMembers.map(member => {
        const now = new Date();
        const membershipEnd = new Date(member.membership_end);
        const status = membershipEnd > now ? 'active' : 'expired';
        
        return `
            <div class="member-card">
                <img src="${member.avatar_url}" alt="${member.username}" class="member-avatar">
                <div class="member-info">
                    <div class="member-name">@${member.username}</div>
                    <div class="member-meta">
                        Joined: ${formatDate(member.membership_start)} • 
                        Expires: ${formatDate(member.membership_end)} • 
                        Total Paid: ${member.total_paid} credits
                    </div>
                </div>
                <div class="member-status status-${status}">${status}</div>
                <div class="member-actions">
                    <button class="action-btn view" onclick="viewMemberDetails('${member.id}')">View</button>
                    <button class="action-btn extend" onclick="extendMembership('${member.id}')">Extend</button>
                </div>
            </div>
        `;
    }).join('');
}

// Render payments list
function renderPayments() {
    const paymentsList = document.getElementById('payments-list');
    
    paymentsList.innerHTML = payments.map(payment => `
        <div class="payment-card">
            <div class="member-info">
                <div class="member-name">@${payment.username}</div>
                <div class="member-meta">
                    ${formatDate(payment.payment_date)} • 
                    ${payment.pricing_model} plan • 
                    Comment ID: ${payment.comment_id}
                </div>
            </div>
            <div class="payment-amount">${payment.amount} credits</div>
        </div>
    `).join('');
}

// View member details
function viewMemberDetails(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    
    const memberPayments = payments.filter(p => p.user_id === member.user_id);
    const totalPayments = memberPayments.reduce((sum, p) => sum + p.amount, 0);
    
    document.getElementById('member-details').innerHTML = `
        <div class="member-profile">
            <img src="${member.avatar_url}" alt="${member.username}" style="width: 80px; height: 80px; border-radius: 50%; margin-bottom: 1rem;">
            <h3>@${member.username}</h3>
            <div class="member-stats">
                <p><strong>Member Since:</strong> ${formatDate(member.membership_start)}</p>
                <p><strong>Membership Expires:</strong> ${formatDate(member.membership_end)}</p>
                <p><strong>Total Payments:</strong> ${member.payment_count}</p>
                <p><strong>Total Amount:</strong> ${member.total_paid} credits</p>
                <p><strong>Status:</strong> ${new Date(member.membership_end) > new Date() ? 'Active' : 'Expired'}</p>
            </div>
            
            <h4 style="margin-top: 2rem; margin-bottom: 1rem;">Payment History</h4>
            <div class="payment-history">
                ${memberPayments.map(payment => `
                    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid #eee;">
                        <span>${formatDate(payment.payment_date)}</span>
                        <span>${payment.amount} credits</span>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    
    document.getElementById('member-modal').classList.add('active');
}

// Close modal
function closeModal() {
    document.getElementById('member-modal').classList.remove('active');
}

// Extend membership (manual extension)
async function extendMembership(memberId) {
    const member = members.find(m => m.id === memberId);
    if (!member) return;
    
    const extensionDays = prompt('Enter number of days to extend membership:', '30');
    if (!extensionDays || isNaN(extensionDays)) return;
    
    const currentEnd = new Date(member.membership_end);
    currentEnd.setDate(currentEnd.getDate() + parseInt(extensionDays));
    
    await room.collection('membership_member').update(member.id, {
        membership_end: currentEnd.toISOString(),
        status: 'active'
    });
    
    showNotification(`Extended @${member.username}'s membership by ${extensionDays} days`, 'success');
}

// Filter members
function filterMembers() {
    renderMembers();
}

// Filter payments
function filterPayments() {
    const dateFrom = document.getElementById('date-from').value;
    const dateTo = document.getElementById('date-to').value;
    
    // Implementation for date filtering
    renderPayments();
}

// Save settings
async function saveSettings() {
    const pricingModel = document.getElementById('pricing-model').value;
    const priceAmount = parseInt(document.getElementById('price-amount').value);
    const membershipTitle = document.getElementById('membership-title').value;
    const membershipDescription = document.getElementById('membership-description').value;
    const graceDays = parseInt(document.getElementById('grace-days').value);
    const notifyExpiring = document.getElementById('notify-expiring').checked;
    const notifyNewMembers = document.getElementById('notify-new-members').checked;
    
    if (!priceAmount || priceAmount < 10) {
        showError('Price must be at least 10 credits');
        return;
    }
    
    await room.collection('membership_config').update(membershipConfig.id, {
        pricing_model: pricingModel,
        price_amount: priceAmount,
        membership_title: membershipTitle,
        membership_description: membershipDescription,
        grace_days: graceDays,
        notify_expiring: notifyExpiring,
        notify_new_members: notifyNewMembers
    });
    
    membershipConfig = { ...membershipConfig, pricing_model: pricingModel, price_amount: priceAmount, membership_title: membershipTitle, membership_description: membershipDescription, grace_days: graceDays, notify_expiring: notifyExpiring, notify_new_members: notifyNewMembers };
    
    showNotification('Settings saved successfully', 'success');
}

// Utility functions
function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
}

function formatTimeAgo(dateString) {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 1rem 1.5rem;
        background: ${type === 'success' ? '#27ae60' : type === 'error' ? '#e74c3c' : '#3498db'};
        color: white;
        border-radius: 6px;
        box-shadow: 0 4px 15px rgba(0,0,0,0.2);
        z-index: 1001;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.remove();
    }, 4000);
}

function showError(message) {
    showNotification(message, 'error');
}

// Initialize the application when the page loads
document.addEventListener('DOMContentLoaded', init);

