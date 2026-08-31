// TravelPlan Admin Panel - Admin-specific logic
(function() {
    'use strict';

    const API_URL = '/api';

    function escapeHtml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function getToken() {
        const authModule = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js');
        const { getAuth } = authModule;
        const auth = getAuth();
        if (!auth || !auth.currentUser) return null;
        return await auth.currentUser.getIdToken();
    }

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

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => {
            loadAdminData();
        }, 500);
    });

})();
