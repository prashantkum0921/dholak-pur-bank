/* ═══════════════════════════════════════════════
   DHOLAK PUR BANK — Core SPA Framework
   ═══════════════════════════════════════════════ */

const app = {
    state: {
        user: null,
        accessToken: null,
        refreshToken: null,
        adminToken: null,
        currentPage: null
    },

    // === INITIALIZATION ===
    init() {
        // Restore tokens from localStorage
        this.state.accessToken = localStorage.getItem('dpb_access_token');
        this.state.refreshToken = localStorage.getItem('dpb_refresh_token');
        this.state.adminToken = localStorage.getItem('dpb_admin_token');

        // Setup hash-based router
        window.addEventListener('hashchange', () => this.router());
        this.router();
    },

    // === ROUTER ===
    router() {
        const hash = window.location.hash.slice(1) || '/';
        const routes = {
            '/': () => this.state.accessToken ? this.navigate('/dashboard') : this.navigate('/login'),
            '/login': () => LoginPage.render(),
            '/signup': () => SignupPage.render(),
            '/dashboard': () => this.requireAuth(() => DashboardPage.render()),
            '/transfer': () => this.requireAuth(() => TransferPage.render()),
            '/beneficiaries': () => this.requireAuth(() => BeneficiariesPage.render()),
            '/transactions': () => this.requireAuth(() => TransactionsPage.render()),
            '/admin': () => AdminPage.render()
        };

        const handler = routes[hash];
        if (handler) {
            handler();
        } else {
            this.navigate('/');
        }
    },

    navigate(path) {
        if (window.location.hash !== `#${path}`) {
            window.location.hash = path;
        } else {
            this.router();
        }
    },

    requireAuth(callback) {
        if (!this.state.accessToken) {
            this.navigate('/login');
            return;
        }
        this.updateNav(true);
        callback();
    },

    // === API CLIENT ===
    async api(endpoint, options = {}) {
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (this.state.accessToken && !options.noAuth) {
            headers['Authorization'] = `Bearer ${this.state.accessToken}`;
        }

        if (this.state.adminToken && endpoint.startsWith('/api/admin/') && endpoint !== '/api/admin/login') {
            headers['X-Admin-Token'] = this.state.adminToken;
        }

        try {
            const res = await fetch(endpoint, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                credentials: 'include'
            });

            // Handle token expiration
            if (res.status === 401) {
                const data = await res.json();

                // Admin endpoint auth failures should NOT trigger user logout
                if (endpoint.startsWith('/api/admin/')) {
                    return data;
                }

                if (data.code === 'TOKEN_EXPIRED' && this.state.refreshToken) {
                    const refreshed = await this.refreshAccessToken();
                    if (refreshed) {
                        // Retry the original request with new token
                        headers['Authorization'] = `Bearer ${this.state.accessToken}`;
                        const retryRes = await fetch(endpoint, {
                            method: options.method || 'GET',
                            headers,
                            body: options.body ? JSON.stringify(options.body) : undefined,
                            credentials: 'include'
                        });
                        return await retryRes.json();
                    }
                }
                this.logout();
                throw new Error('Authentication required');
            }

            return await res.json();
        } catch (err) {
            if (err.message === 'Authentication required') throw err;
            console.error('API error:', err);
            throw new Error('Network error. Please try again.');
        }
    },

    async refreshAccessToken() {
        try {
            const res = await fetch('/api/auth/refresh', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken: this.state.refreshToken })
            });

            if (!res.ok) return false;

            const data = await res.json();
            this.state.accessToken = data.accessToken;
            this.state.refreshToken = data.refreshToken;
            localStorage.setItem('dpb_access_token', data.accessToken);
            localStorage.setItem('dpb_refresh_token', data.refreshToken);
            return true;
        } catch {
            return false;
        }
    },

    // === AUTH ===
    setAuth(accessToken, refreshToken, user) {
        this.state.accessToken = accessToken;
        this.state.refreshToken = refreshToken;
        this.state.user = user;
        localStorage.setItem('dpb_access_token', accessToken);
        localStorage.setItem('dpb_refresh_token', refreshToken);
        if (user) localStorage.setItem('dpb_user', JSON.stringify(user));
    },

    logout() {
        // Try to revoke on server
        if (this.state.accessToken) {
            this.api('/api/auth/logout', {
                method: 'POST',
                body: { refreshToken: this.state.refreshToken, logoutAll: false }
            }).catch(() => { });
        }

        this.state.accessToken = null;
        this.state.refreshToken = null;
        this.state.user = null;
        this.state.adminToken = null;
        localStorage.removeItem('dpb_access_token');
        localStorage.removeItem('dpb_refresh_token');
        localStorage.removeItem('dpb_user');
        localStorage.removeItem('dpb_admin_token');

        this.updateNav(false);
        this.navigate('/login');
        this.toast('Logged out securely', 'info');
    },

    // === CAPTCHA ===
    async loadCaptcha(containerId) {
        try {
            const data = await this.api('/api/captcha', { noAuth: true });
            const container = document.getElementById(containerId);
            if (!container) return data;

            container.innerHTML = `
        <div class="captcha-container">
          <div class="captcha-image">
            <div id="captcha-svg">${data.svg}</div>
            <button type="button" class="captcha-refresh" onclick="app.refreshCaptcha('${containerId}')" title="Refresh CAPTCHA">🔄</button>
          </div>
          <input type="text" class="form-input" id="captcha-answer" placeholder="Enter CAPTCHA text" autocomplete="off" maxlength="5">
          <input type="hidden" id="captcha-id" value="${data.id}">
        </div>
      `;
            return data;
        } catch (err) {
            console.error('CAPTCHA load error:', err);
            return null;
        }
    },

    async refreshCaptcha(containerId) {
        await this.loadCaptcha(containerId);
    },

    getCaptchaData() {
        return {
            captchaId: document.getElementById('captcha-id')?.value,
            captchaAnswer: document.getElementById('captcha-answer')?.value
        };
    },

    // === DEVICE FINGERPRINT ===
    getDeviceFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('DPB-fingerprint', 2, 2);
        const canvasHash = canvas.toDataURL().slice(-50);

        const components = [
            navigator.userAgent,
            navigator.language,
            screen.width + 'x' + screen.height,
            screen.colorDepth,
            new Date().getTimezoneOffset(),
            navigator.hardwareConcurrency || 'unknown',
            canvasHash
        ].join('|');

        // Simple hash
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            const char = components.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return 'dpb_' + Math.abs(hash).toString(36);
    },

    // === NAV ===
    updateNav(isLoggedIn) {
        const nav = document.getElementById('main-nav');
        const navLinks = document.getElementById('nav-links');
        const navUsername = document.getElementById('nav-username');

        if (isLoggedIn) {
            nav.classList.remove('hidden');
            const user = this.state.user || JSON.parse(localStorage.getItem('dpb_user') || '{}');
            navUsername.textContent = user.username || '';

            navLinks.innerHTML = `
        <a href="#/dashboard" class="nav-link ${location.hash === '#/dashboard' ? 'active' : ''}">Dashboard</a>
        <a href="#/transfer" class="nav-link ${location.hash === '#/transfer' ? 'active' : ''}">Transfer</a>
        <a href="#/beneficiaries" class="nav-link ${location.hash === '#/beneficiaries' ? 'active' : ''}">Beneficiaries</a>
        <a href="#/transactions" class="nav-link ${location.hash === '#/transactions' ? 'active' : ''}">History</a>
        <a href="#/admin" class="nav-link ${location.hash === '#/admin' ? 'active' : ''}">Admin</a>
      `;
        } else {
            nav.classList.add('hidden');
        }
    },

    // === TOAST NOTIFICATIONS ===
    toast(message, type = 'info', duration = 4000) {
        const container = document.getElementById('toast-container');
        const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
      <span class="toast-icon">${icons[type] || icons.info}</span>
      <span class="toast-message">${this.escapeHtml(message)}</span>
    `;
        container.appendChild(toast);

        setTimeout(() => {
            toast.classList.add('removing');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    // === CONTENT RENDERING ===
    setContent(html) {
        document.getElementById('main-content').innerHTML = html;
    },

    // === SECURITY: HTML ESCAPE ===
    escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    },

    // === UTILITY ===
    formatCurrency(amount) {
        return new Intl.NumberFormat('en-IN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(amount);
    },

    formatDate(date) {
        return new Date(date).toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    },

    timeAgo(date) {
        const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }
};

// Boot
document.addEventListener('DOMContentLoaded', () => app.init());
