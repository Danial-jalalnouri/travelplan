// TravelPlan App - All Firestore operations go through backend API
(function() {
    'use strict';

    const API_URL = '/api';

    // ===== XSS Protection: escape HTML entities =====
    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ===== Private state =====
    let auth = null;
    let authProvider = null;
    let currentUser = null;
    let currentPlan = null;
    let currentUserData = null;

    // Firebase Auth SDK references
    let _signInWithPopup, _signOut, _onAuthStateChanged;

    // ===== Initialize Firebase Auth only =====
    async function initFirebase() {
        const { initializeApp } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const authModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');

        const firebaseConfig = {
            apiKey: "AIzaSyBtaVij_5LMX5kvX33u3rzVJCEQYQ0TUCk",
            authDomain: "coursebag-travelplan.firebaseapp.com",
            projectId: "coursebag-travelplan",
            storageBucket: "coursebag-travelplan.firebasestorage.app",
            messagingSenderId: "686867009032",
            appId: "1:686867009032:web:494988d8390720ff724bbd"
        };

        const firebaseApp = initializeApp(firebaseConfig);
        auth = authModule.getAuth(firebaseApp);
        authProvider = new authModule.GoogleAuthProvider();

        _signInWithPopup = authModule.signInWithPopup;
        _signOut = authModule.signOut;
        _onAuthStateChanged = authModule.onAuthStateChanged;

        // Start listening for auth changes
        _onAuthStateChanged(auth, async (user) => {
            currentUser = user;
            currentUserData = null;
            await updateAuthUI(user);
        });
    }

    // ===== Helper: get auth token =====
    async function getToken() {
        if (!auth || !auth.currentUser) return null;
        return await auth.currentUser.getIdToken();
    }

    // ===== Helper: fetch with auth =====
    async function apiFetch(url, options = {}) {
        const token = await getToken();
        if (!token) throw new Error('Not authenticated');

        const headers = {
            'Authorization': `Bearer ${token}`,
            ...options.headers
        };

        if (options.body && typeof options.body === 'object') {
            headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(options.body);
        }

        return fetch(url, { ...options, headers });
    }

    // ===== AUTHENTICATION =====

    async function isAdmin(user) {
        if (!user || !user.email) return false;
        try {
            const response = await apiFetch(`${API_URL}/admin/check`);
            if (response.ok) {
                const data = await response.json();
                return data.isAdmin;
            }
            return false;
        } catch (error) {
            console.error('Error checking admin status:', error);
            return false;
        }
    }

    async function updateAuthUI(user) {
        const loggedOut = document.getElementById('auth-logged-out');
        const loggedIn = document.getElementById('auth-logged-in');
        const userName = document.getElementById('user-name');
        const userAvatar = document.getElementById('user-avatar');
        const loginRequiredMsg = document.getElementById('login-required-msg');
        const planningForm = document.getElementById('planning-form');
        const adminBtn = document.getElementById('admin-btn');
        const adminSection = document.getElementById('admin-section');

        if (user) {
            loggedOut.classList.add('hidden');
            loggedIn.classList.remove('hidden');
            userName.textContent = user.displayName || user.email;
            userAvatar.src = user.photoURL || 'https://ui-avatars.com/api/?name=' + encodeURIComponent(user.displayName || user.email);

            loginRequiredMsg.classList.add('hidden');
            planningForm.classList.remove('hidden');

            const adminStatus = await isAdmin(user);
            if (adminStatus) {
                adminBtn.classList.remove('hidden');
            } else {
                adminBtn.classList.add('hidden');
                adminSection.classList.add('hidden');
            }

            setupUser(user);
            loadSavedPlans();
        } else {
            loggedOut.classList.remove('hidden');
            loggedIn.classList.add('hidden');
            userName.textContent = '';
            userAvatar.src = '';

            loginRequiredMsg.classList.remove('hidden');
            planningForm.classList.add('hidden');

            adminBtn.classList.add('hidden');
            adminSection.classList.add('hidden');

            document.getElementById('saved-plans').innerHTML = '<p class="no-plans">Sign in to see your saved plans.</p>';
        }
    }

    async function setupUser(user) {
        try {
            await apiFetch(`${API_URL}/users/setup`, { method: 'POST' });
        } catch (error) {
            console.error('Error setting up user:', error);
        }
    }

    async function getUserData() {
        if (currentUserData) return currentUserData;

        try {
            const response = await apiFetch(`${API_URL}/users/me`);
            if (response.ok) {
                currentUserData = await response.json();
                return currentUserData;
            }
            return null;
        } catch (error) {
            console.error('Error getting user data:', error);
            return null;
        }
    }

    window.loginWithGoogle = async function() {
        try {
            await _signInWithPopup(auth, authProvider);
        } catch (error) {
            console.error('Login error:', error);
            if (error.code !== 'auth/popup-closed-by-user') {
                alert('Error signing in. Please try again.');
            }
        }
    };

    window.logoutUser = async function() {
        try {
            await _signOut(auth);
        } catch (error) {
            console.error('Logout error:', error);
        }
    };

    // ========== SCROLL ==========

    window.scrollToPlanning = function() {
        document.getElementById('planning-section').scrollIntoView({ behavior: 'smooth' });
    };

    // ========== PLAN GENERATION ==========

    window.generatePlan = async function() {
        if (!currentUser) {
            alert('Please sign in to generate a travel plan');
            return;
        }

        const userData = await getUserData();
        if (userData) {
            const countResponse = await apiFetch(`${API_URL}/plans/count`);
            if (countResponse.ok) {
                const { count } = await countResponse.json();
                if (count >= userData.maxPlans) {
                    alert(`You have reached your plan limit (${userData.maxPlans} plans). Please delete some plans or contact admin to increase your limit.`);
                    return;
                }
            }
        }

        const city = document.getElementById('city').value.trim();
        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;

        if (!city) {
            alert('Please enter a destination city');
            return;
        }
        if (!startDate || !endDate) {
            alert('Please select both start and end dates');
            return;
        }
        if (new Date(endDate) < new Date(startDate)) {
            alert('End date must be after start date');
            return;
        }

        const start = new Date(startDate);
        const end = new Date(endDate);
        const days = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;

        document.getElementById('loading').classList.remove('hidden');
        document.getElementById('plan-section').classList.add('hidden');
        document.getElementById('generate-btn').disabled = true;

        try {
            const response = await apiFetch(`${API_URL}/generate-plan`, {
                method: 'POST',
                body: { city, days, startDate, endDate }
            });

            if (!response.ok) {
                const err = await response.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to generate plan');
            }

            const data = await response.json();
            const planData = parsePlanResponse(data.content);

            if (planData) {
                displayPlan(planData);
            } else {
                alert('Error parsing travel plan. Please try again.');
            }
        } catch (error) {
            console.error('Error generating plan:', error);
            alert(`Error generating travel plan: ${error.message}`);
        } finally {
            document.getElementById('loading').classList.add('hidden');
            document.getElementById('generate-btn').disabled = false;
        }
    };

    function parsePlanResponse(text) {
        try {
            if (!text) return null;

            const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
            if (jsonMatch) {
                text = jsonMatch[1].trim();
            }

            const startIndex = text.indexOf('{');
            const endIndex = text.lastIndexOf('}');

            if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
                text = text.substring(startIndex, endIndex + 1);
            }

            try {
                const parsed = JSON.parse(text);
                if (parsed.days && Array.isArray(parsed.days)) {
                    return parsed;
                }
            } catch (e) {
                let fixedText = text
                    .replace(/,\s*}/g, '}')
                    .replace(/,\s*]/g, ']')
                    .replace(/:\s*,/g, ': null,')
                    .replace(/"\s*"/g, '","');

                const parsed = JSON.parse(fixedText);
                if (parsed.days && Array.isArray(parsed.days)) {
                    return parsed;
                }
            }

            return null;
        } catch (e) {
            console.error('JSON parsing error:', e);
            return null;
        }
    }

    // ========== DISPLAY ==========

    function displayPlan(planData, autoSave = true) {
        currentPlan = planData;

        document.getElementById('plan-title').textContent = `Travel Plan: ${planData.destination}`;
        document.getElementById('plan-meta').textContent = `${planData.totalDays} days | ${planData.destination}`;
        document.getElementById('plan-overview').innerHTML = `<p>${escapeHtml(planData.overview)}</p>`;

        renderGeneralTips(planData.generalTips);

        document.getElementById('budget-card').innerHTML = `
            <h4>Estimated Budget</h4>
            <p>${escapeHtml(planData.budgetEstimate)}</p>
        `;

        renderDayTabs(planData.days);
        renderDayPanels(planData.days);

        document.getElementById('plan-section').classList.remove('hidden');
        document.getElementById('plan-section').scrollIntoView({ behavior: 'smooth' });

        if (planData.days.length > 0) {
            selectDay(1);
        }

        if (autoSave) {
            autoSavePlan(planData);
        }
    }

    function renderGeneralTips(tips) {
        if (!tips || tips.length === 0) return;

        const container = document.getElementById('general-tips');
        container.innerHTML = `
            <h4>General Tips</h4>
            <div class="tips-list">
                ${tips.map(tip => `
                    <div class="tip-item">
                        <div class="tip-icon">✓</div>
                        <div class="tip-text">${escapeHtml(tip)}</div>
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderDayTabs(days) {
        const container = document.getElementById('day-tabs');
        container.innerHTML = days.map(day => {
            const num = parseInt(day.dayNumber) || 0;
            return `
                <button class="day-tab" onclick="selectDay(${num})" data-day="${num}">
                    Day ${num}
                </button>
            `;
        }).join('');
    }

    function renderDayPanels(days) {
        const container = document.getElementById('day-panels');
        container.innerHTML = days.map(day => {
            const num = parseInt(day.dayNumber) || 0;
            return `
                <div class="day-panel" id="day-panel-${num}">
                    <div class="day-panel-header">
                        <h3>Day ${num}</h3>
                        <div class="day-theme">${escapeHtml(day.theme)}</div>
                        <div class="day-date">${escapeHtml(day.date)}</div>
                    </div>
                    <div class="day-panel-content">
                        ${renderTimeBlock('morning', 'Morning', day.morning)}
                        ${renderTimeBlock('afternoon', 'Afternoon', day.afternoon)}
                        ${renderTimeBlock('evening', 'Evening', day.evening)}

                        ${renderMeals(day.meals)}

                        <div class="info-cards">
                            <div class="info-card">
                                <h5>Transport Tips</h5>
                                <ul>
                                    ${day.transportTips.map(tip => `<li>${escapeHtml(tip)}</li>`).join('')}
                                </ul>
                            </div>
                            <div class="info-card">
                                <h5>Daily Budget</h5>
                                <p>${escapeHtml(day.dailyBudget)}</p>
                            </div>
                        </div>

                        <div class="highlights-section">
                            <h5>Day Highlights</h5>
                            <div class="highlights-list">
                                ${day.highlights.map(h => `<span class="highlight-tag">${escapeHtml(h)}</span>`).join('')}
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    function renderTimeBlock(type, title, data) {
        return `
            <div class="time-block ${type}">
                <div class="time-block-header">
                    <h4>${escapeHtml(title)}</h4>
                    <span class="time-range">${escapeHtml(data.time)}</span>
                </div>
                <div class="location">${escapeHtml(data.location)}</div>
                <div class="description">${escapeHtml(data.description)}</div>
                <div class="activities">
                    ${data.activities.map(a => `<span class="activity-tag">${escapeHtml(a)}</span>`).join('')}
                </div>
            </div>
        `;
    }

    function renderMeals(meals) {
        return `
            <div class="meals-section">
                <h4>Recommended Meals</h4>
                <div class="meals-grid">
                    <div class="meal-card">
                        <div class="meal-type">Breakfast</div>
                        <div class="meal-name">${escapeHtml(meals.breakfast.name)}</div>
                        <div class="meal-cuisine">${escapeHtml(meals.breakfast.cuisine)}</div>
                        <div class="meal-price">${escapeHtml(meals.breakfast.price)}</div>
                        <div class="meal-description">${escapeHtml(meals.breakfast.description)}</div>
                    </div>
                    <div class="meal-card">
                        <div class="meal-type">Lunch</div>
                        <div class="meal-name">${escapeHtml(meals.lunch.name)}</div>
                        <div class="meal-cuisine">${escapeHtml(meals.lunch.cuisine)}</div>
                        <div class="meal-price">${escapeHtml(meals.lunch.price)}</div>
                        <div class="meal-description">${escapeHtml(meals.lunch.description)}</div>
                    </div>
                    <div class="meal-card">
                        <div class="meal-type">Dinner</div>
                        <div class="meal-name">${escapeHtml(meals.dinner.name)}</div>
                        <div class="meal-cuisine">${escapeHtml(meals.dinner.cuisine)}</div>
                        <div class="meal-price">${escapeHtml(meals.dinner.price)}</div>
                        <div class="meal-description">${escapeHtml(meals.dinner.description)}</div>
                    </div>
                </div>
            </div>
        `;
    }

    window.selectDay = function(dayNumber) {
        document.querySelectorAll('.day-tab').forEach(tab => {
            tab.classList.remove('active');
            if (parseInt(tab.dataset.day) === dayNumber) {
                tab.classList.add('active');
            }
        });

        document.querySelectorAll('.day-panel').forEach(panel => {
            panel.classList.remove('active');
        });
        document.getElementById(`day-panel-${dayNumber}`).classList.add('active');
    };

    // ========== PLAN OPERATIONS (via backend API) ==========

    async function autoSavePlan(planData) {
        if (!currentUser) return;

        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;

        try {
            await apiFetch(`${API_URL}/plans`, {
                method: 'POST',
                body: {
                    city: planData.destination,
                    startDate,
                    endDate,
                    plan: planData
                }
            });
            loadSavedPlans();
        } catch (error) {
            console.error('Error saving plan:', error);
        }
    }

    window.savePlanToDB = async function() {
        if (!currentUser) {
            alert('Please sign in to save plans');
            return;
        }

        if (!currentPlan) {
            alert('No plan to save');
            return;
        }

        const startDate = document.getElementById('start-date').value;
        const endDate = document.getElementById('end-date').value;

        try {
            await apiFetch(`${API_URL}/plans`, {
                method: 'POST',
                body: {
                    city: currentPlan.destination,
                    startDate,
                    endDate,
                    plan: currentPlan
                }
            });
            loadSavedPlans();
            alert('Plan saved successfully!');
        } catch (error) {
            console.error('Error saving plan:', error);
            alert('Error saving plan. Please try again.');
        }
    };

    async function loadSavedPlans() {
        const container = document.getElementById('saved-plans');

        if (!currentUser) {
            container.innerHTML = '<p class="no-plans">Sign in to see your saved plans.</p>';
            return;
        }

        try {
            const plansResponse = await apiFetch(`${API_URL}/plans`);
            const { plans } = await plansResponse.json();

            const userData = await getUserData();
            let maxPlans = userData ? userData.maxPlans : 2;

            if (plans.length === 0) {
                container.innerHTML = '<p class="no-plans">No saved plans yet. Generate your first travel plan above!</p>';
                return;
            }

            let html = `<div class="plan-counter">Plans: ${plans.length} / ${maxPlans}</div>`;

            plans.forEach((data) => {
                let planData;
                try {
                    planData = JSON.parse(data.plan);
                } catch (e) {
                    planData = null;
                }

                const preview = planData ? escapeHtml(planData.overview) : escapeHtml(data.plan.substring(0, 200));
                const safeId = escapeHtml(data.id);

                html += `
                    <div class="saved-plan-card">
                        <h4>${escapeHtml(data.city)}</h4>
                        <div class="dates">${formatDate(data.startDate)} - ${formatDate(data.endDate)}</div>
                        <div class="plan-preview">${preview}...</div>
                        <div class="card-actions">
                            <button class="card-btn view-btn" onclick="viewPlan('${safeId}')">View Full Plan</button>
                        </div>
                    </div>
                `;
            });

            container.innerHTML = html;
        } catch (error) {
            console.error('Error loading plans:', error);
            container.innerHTML = '<p class="no-plans">Error loading plans.</p>';
        }
    }

    window.viewPlan = async function(id) {
        if (!currentUser) return;

        try {
            const response = await apiFetch(`${API_URL}/plans/${id}`);

            if (!response.ok) {
                alert('Plan not found');
                return;
            }

            const data = await response.json();
            const planData = JSON.parse(data.plan);
            displayPlan(planData, false);
        } catch (error) {
            console.error('Error viewing plan:', error);
            alert('Error loading plan');
        }
    };

    window.deletePlan = async function(id) {
        if (!currentUser) return;

        if (confirm('Are you sure you want to delete this plan?')) {
            try {
                await apiFetch(`${API_URL}/plans/${id}`, { method: 'DELETE' });
                loadSavedPlans();
            } catch (error) {
                console.error('Error deleting plan:', error);
                alert('Error deleting plan');
            }
        }
    };

    // ========== ADMIN PANEL ==========

    window.toggleAdminPanel = async function() {
        const adminSection = document.getElementById('admin-section');

        if (adminSection.classList.contains('hidden')) {
            adminSection.classList.remove('hidden');
            await loadAdminData();
            adminSection.scrollIntoView({ behavior: 'smooth' });
        } else {
            adminSection.classList.add('hidden');
        }
    };

    async function loadAdminData() {
        try {
            const usersResponse = await apiFetch(`${API_URL}/admin/users`);
            const { users } = await usersResponse.json();

            const plansResponse = await apiFetch(`${API_URL}/admin/plans`);
            const { plans } = await plansResponse.json();

            document.getElementById('total-users').textContent = users.length;
            document.getElementById('total-plans').textContent = plans.length;

            renderUsersTable(users, plans);
        } catch (error) {
            console.error('Error loading admin data:', error);
        }
    }

    function renderUsersTable(users, plans) {
        const tbody = document.getElementById('users-table-body');

        if (users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5">No users found</td></tr>';
            return;
        }

        tbody.innerHTML = users.map(user => {
            const userPlanCount = plans.filter(p => p.userId === user.userId).length;
            const safeId = escapeHtml(user.id);
            return `
                <tr>
                    <td>${escapeHtml(user.displayName) || 'N/A'}</td>
                    <td>${escapeHtml(user.email)}</td>
                    <td>${userPlanCount}</td>
                    <td>
                        <input type="number"
                               class="max-plans-input"
                               value="${parseInt(user.maxPlans) || 2}"
                               min="1"
                               data-user-id="${safeId}">
                    </td>
                    <td>
                        <button class="save-max-btn" onclick="updateMaxPlans('${safeId}')">Save</button>
                    </td>
                </tr>
            `;
        }).join('');
    }

    window.updateMaxPlans = async function(userId) {
        const input = document.querySelector(`input[data-user-id="${userId}"]`);
        const newMaxPlans = parseInt(input.value);

        if (isNaN(newMaxPlans) || newMaxPlans < 1) {
            alert('Please enter a valid number (minimum 1)');
            return;
        }

        try {
            const response = await apiFetch(`${API_URL}/admin/users/${userId}/max-plans`, {
                method: 'PUT',
                body: { maxPlans: newMaxPlans }
            });

            if (!response.ok) {
                throw new Error('Failed to update');
            }

            alert('Max plans updated successfully!');
            await loadAdminData();
        } catch (error) {
            console.error('Error updating max plans:', error);
            alert('Error updating max plans');
        }
    };

    // ========== UTILITIES ==========

    function formatDate(dateStr) {
        return new Date(dateStr).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    window.resetForm = function() {
        document.getElementById('city').value = '';
        document.getElementById('start-date').value = '';
        document.getElementById('end-date').value = '';
        document.getElementById('plan-section').classList.add('hidden');
        currentPlan = null;
        document.getElementById('planning-section').scrollIntoView({ behavior: 'smooth' });
    };

    // ========== INIT ==========
    document.addEventListener('DOMContentLoaded', () => {
        initFirebase();
    });

})();
