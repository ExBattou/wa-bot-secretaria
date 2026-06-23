document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');

    const authContainer = document.getElementById('auth-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const pinInput = document.getElementById('pin-input');
    const loginBtn = document.getElementById('login-btn');
    const errorMsg = document.getElementById('error-msg');
    
    if (!token) {
        errorMsg.textContent = 'Enlace inválido. Pídele a Karl un nuevo link seguro.';
        pinInput.disabled = true;
        loginBtn.disabled = true;
        return;
    }

    pinInput.focus();

    loginBtn.addEventListener('click', async () => {
        const pin = pinInput.value.trim();
        if (pin.length !== 6) {
            errorMsg.textContent = 'El código PIN debe tener exactamente 6 dígitos.';
            return;
        }

        loginBtn.textContent = 'Verificando...';
        loginBtn.disabled = true;
        errorMsg.textContent = '';

        try {
            const res = await fetch('/api/web/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, pin })
            });
            const result = await res.json();

            if (result.success) {
                // Autenticación exitosa
                authContainer.classList.add('hidden');
                dashboardContainer.classList.remove('hidden');
                renderData(result.data.tasks, result.data.reminders);
            } else {
                // PIN incorrecto o expirado
                errorMsg.textContent = result.message || 'Código incorrecto.';
                pinInput.value = '';
                pinInput.focus();
            }
        } catch (e) {
            errorMsg.textContent = 'Error de conexión con el servidor.';
        } finally {
            loginBtn.textContent = 'Desbloquear Dashboard';
            loginBtn.disabled = false;
        }
    });

    pinInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginBtn.click();
    });

    document.getElementById('logout-btn').addEventListener('click', () => {
        window.location.reload();
    });

    function renderData(tasks, reminders) {
        const tasksList = document.getElementById('tasks-list');
        const remindersList = document.getElementById('reminders-list');

        tasksList.innerHTML = '';
        remindersList.innerHTML = '';

        if (tasks.length === 0) {
            tasksList.innerHTML = '<div class="empty-state">No tienes tareas pendientes</div>';
        } else {
            tasks.forEach(t => {
                const li = document.createElement('li');
                li.className = 'item-task';
                li.innerHTML = `
                    <div class="item-title">${t.title}</div>
                    ${t.due_date ? '<div class="item-meta">📅 Límite: ' + t.due_date + '</div>' : ''}
                `;
                tasksList.appendChild(li);
            });
        }

        if (reminders.length === 0) {
            remindersList.innerHTML = '<div class="empty-state">No hay alarmas programadas</div>';
        } else {
            reminders.forEach(r => {
                const li = document.createElement('li');
                li.className = 'item-reminder';
                const date = new Date(r.execute_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
                li.innerHTML = `
                    <div class="item-title">${r.message}</div>
                    <div class="item-meta">⏰ Sonará: ${date}</div>
                `;
                remindersList.appendChild(li);
            });
        }
    }
});
