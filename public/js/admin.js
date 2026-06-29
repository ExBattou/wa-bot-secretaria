document.addEventListener('DOMContentLoaded', () => {
    const authContainer = document.getElementById('auth-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const passInput = document.getElementById('pass-input');
    const loginBtn = document.getElementById('login-btn');
    const errorMsg = document.getElementById('error-msg');
    
    let adminToken = sessionStorage.getItem('adminToken') || '';

    // Si ya hay token, intentamos cargar
    if (adminToken) {
        loadDashboard();
    } else {
        passInput.focus();
    }

    loginBtn.addEventListener('click', async () => {
        const password = passInput.value.trim();
        if (!password) return;

        loginBtn.textContent = 'Verificando...';
        errorMsg.textContent = '';

        try {
            const res = await fetch('/api/admin/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });
            const data = await res.json();

            if (data.success) {
                adminToken = data.token;
                sessionStorage.setItem('adminToken', adminToken);
                loadDashboard();
            } else {
                errorMsg.textContent = 'Clave incorrecta.';
                passInput.value = '';
                passInput.focus();
            }
        } catch (e) {
            errorMsg.textContent = 'Error de conexión.';
        } finally {
            loginBtn.textContent = 'Acceder al Sistema';
        }
    });

    passInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        sessionStorage.removeItem('adminToken');
        window.location.reload();
    });

    async function loadDashboard() {
        authContainer.classList.add('hidden');
        dashboardContainer.classList.remove('hidden');

        try {
            const headers = { 'Authorization': `Bearer ${adminToken}` };
            
            const [statsRes, usersRes] = await Promise.all([
                fetch('/api/admin/stats', { headers }),
                fetch('/api/admin/users', { headers })
            ]);

            if (statsRes.status === 401) {
                // Token inválido o expirado (reinicio del bot)
                sessionStorage.removeItem('adminToken');
                window.location.reload();
                return;
            }

            const statsData = await statsRes.json();
            const usersData = await usersRes.json();

            if (statsData.success) {
                renderStats(statsData.data);
            }
            if (usersData.success) {
                renderUsers(usersData.data);
            }
        } catch (e) {
            console.error('Error cargando dashboard', e);
        }
    }

    function renderStats(stats) {
        document.getElementById('stat-users-total').textContent = stats.users.total;
        document.getElementById('stat-users-premium').textContent = stats.users.premium;
        
        document.getElementById('stat-msg-today').textContent = stats.messages.today.total;
        document.getElementById('stat-today-user').textContent = stats.messages.today.received_from_user;
        document.getElementById('stat-today-bot').textContent = stats.messages.today.sent_by_bot;

        document.getElementById('stat-msg-month').textContent = stats.messages.month.total;
        document.getElementById('stat-month-user').textContent = stats.messages.month.received_from_user;
        document.getElementById('stat-month-bot').textContent = stats.messages.month.sent_by_bot;
    }

    function renderUsers(users) {
        const tbody = document.getElementById('users-tbody');
        tbody.innerHTML = '';
        const now = new Date();

        users.forEach(u => {
            const isPremium = u.is_premium_until && new Date(u.is_premium_until) > now;
            const badge = isPremium 
                ? '<span class="badge premium">PREMIUM</span>' 
                : '<span class="badge free">FREE</span>';
            
            const btn = isPremium 
                ? '' 
                : `<button class="btn-premium" onclick="makePremium('${u.phone}')">Hacer Premium (30 días)</button>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${u.phone}</strong></td>
                <td>${u.messages_count} / 20</td>
                <td>${badge}</td>
                <td>${btn}</td>
            `;
            tbody.appendChild(tr);
        });
    }

    window.makePremium = async (phone) => {
        if (!confirm(`¿Estás seguro de hacer Premium al usuario ${phone} por 30 días?`)) return;

        try {
            const res = await fetch('/api/admin/set-premium', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${adminToken}`
                },
                body: JSON.stringify({ phone })
            });
            const data = await res.json();
            if (data.success) {
                loadDashboard(); // Recargar la tabla silenciosamente
            } else {
                alert('Error: ' + data.message);
            }
        } catch (e) {
            alert('Error de red.');
        }
    };
});
