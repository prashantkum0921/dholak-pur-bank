/* ═══ ADMIN DASHBOARD PAGE ═══ */
const AdminPage = {
  async render() {
    app.updateNav(false);

    // Check if admin is logged in
    if (!app.state.adminToken) {
      this.renderLogin();
      return;
    }

    app.setContent(`
      <div class="page">
        <div class="page-header flex-between">
          <div>
            <h1 class="page-title">🛡️ Admin Security Dashboard</h1>
            <p class="page-subtitle">Real-time monitoring and threat intelligence</p>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-sm" onclick="AdminPage.refresh()">🔄 Refresh</button>
            <button class="btn btn-ghost btn-sm" onclick="AdminPage.logoutAdmin()">Logout</button>
          </div>
        </div>

        <div id="admin-content">
          <div class="loader-container" style="min-height:200px">
            <div class="loader-spinner"></div>
          </div>
        </div>
      </div>
    `);

    await this.loadDashboard();
  },

  renderLogin() {
    app.setContent(`
      <div class="page-auth">
        <div class="auth-card">
          <div class="auth-logo">
            <img src="/logo.png" alt="Dholak Pur Bank" class="auth-logo-badge">
            <div class="auth-logo-text">Admin <span class="brand-accent">Console</span></div>
          </div>

          <form id="admin-login-form" method="post">
            <div class="form-group">
              <label class="form-label">Admin Password</label>
              <input type="password" class="form-input" id="admin-password" placeholder="Enter admin password" required autocomplete="off">
            </div>
            <button type="submit" class="btn btn-primary btn-block btn-lg" id="admin-login-btn">🔐 Access Panel</button>
          </form>

          <div class="auth-footer mt-2">
            <a href="#/login">← Back to Banking</a>
          </div>
        </div>
      </div>
    `);

    // Bind form submit via addEventListener
    const form = document.getElementById('admin-login-form');
    if (form) {
      form.addEventListener('submit', (e) => AdminPage.handleLogin(e));
    }
  },

  async handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('admin-login-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    try {
      const data = await app.api('/api/admin/login', {
        method: 'POST',
        noAuth: true,
        body: { password: document.getElementById('admin-password').value }
      });

      if (data.error) {
        app.toast(data.error, 'error');
        return;
      }

      app.state.adminToken = data.adminToken;
      localStorage.setItem('dpb_admin_token', data.adminToken);
      app.toast('Admin access granted', 'success');
      this.render();
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  },

  async loadDashboard() {
    try {
      const [dashboard, alerts, logins, flaggedTx, ipAbuse, blockedUsers] = await Promise.all([
        app.api('/api/admin/dashboard'),
        app.api('/api/admin/fraud-alerts'),
        app.api('/api/admin/suspicious-logins'),
        app.api('/api/admin/flagged-transactions'),
        app.api('/api/admin/ip-abuse'),
        app.api('/api/admin/blocked-users')
      ]);

      if (dashboard.error) {
        app.toast(dashboard.error, 'error');
        if (dashboard.error.includes('Admin')) this.logoutAdmin();
        return;
      }

      const o = dashboard.overview;
      const content = document.getElementById('admin-content');

      content.innerHTML = `
        <!-- Overview Stats -->
        <div class="admin-grid">
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:var(--text-primary)">${o.totalUsers}</div>
            <div class="admin-stat-label">Total Users</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:${o.lockedAccounts > 0 ? 'var(--danger)' : 'var(--success)'}">${o.lockedAccounts}</div>
            <div class="admin-stat-label">Locked Accounts</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:var(--info)">${o.transactionsLast24h}</div>
            <div class="admin-stat-label">Transactions 24h</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:${o.unresolvedFraudEvents > 0 ? 'var(--danger)' : 'var(--success)'}">${o.unresolvedFraudEvents}</div>
            <div class="admin-stat-label">Fraud Alerts</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:${o.honeypotTriggersLast24h > 0 ? 'var(--warning)' : 'var(--success)'}">${o.honeypotTriggersLast24h}</div>
            <div class="admin-stat-label">Honeypot Hits 24h</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:var(--warning)">${o.rateLimitBreachesLast24h}</div>
            <div class="admin-stat-label">Rate Limit 24h</div>
          </div>
          <div class="admin-stat">
            <div class="admin-stat-value" style="color:var(--info)">${o.loginAnomaliesLast24h}</div>
            <div class="admin-stat-label">Login Anomalies 24h</div>
          </div>
        </div>

        <!-- Tabs for detailed views -->
        <div class="tabs">
          <button class="tab active" onclick="AdminPage.switchTab('fraud', this)">🚨 Fraud Alerts</button>
          <button class="tab" onclick="AdminPage.switchTab('blocked', this)">🚫 Blocked Users</button>
          <button class="tab" onclick="AdminPage.switchTab('logins', this)">🔑 Suspicious Logins</button>
          <button class="tab" onclick="AdminPage.switchTab('transactions', this)">💰 Flagged TX</button>
          <button class="tab" onclick="AdminPage.switchTab('ip', this)">🌐 IP Abuse</button>
          <button class="tab" onclick="AdminPage.switchTab('users', this)">👥 Users</button>
        </div>

        <div id="admin-tab-content" class="card">
          ${this.renderFraudAlerts(alerts.alerts || [])}
        </div>
      `;

      // Cache data for tabs
      this.tabData = { alerts, logins, flaggedTx, ipAbuse, blockedUsers };
    } catch (err) {
      app.toast('Failed to load admin dashboard', 'error');
    }
  },

  tabData: {},

  switchTab(tab, el) {
    // Update active tab
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');

    const container = document.getElementById('admin-tab-content');

    switch (tab) {
      case 'fraud':
        container.innerHTML = this.renderFraudAlerts(this.tabData.alerts?.alerts || []);
        break;
      case 'blocked':
        container.innerHTML = this.renderBlockedUsers(this.tabData.blockedUsers?.users || []);
        break;
      case 'logins':
        container.innerHTML = this.renderSuspiciousLogins(this.tabData.logins?.anomalies || []);
        break;
      case 'transactions':
        container.innerHTML = this.renderFlaggedTransactions(this.tabData.flaggedTx?.transactions || []);
        break;
      case 'ip':
        container.innerHTML = this.renderIpAbuse(this.tabData.ipAbuse || {});
        break;
      case 'users':
        this.loadUsers();
        break;
    }
  },

  renderFraudAlerts(alerts) {
    if (alerts.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No active fraud alerts</div></div>`;
    }
    return alerts.map(a => `
      <div class="alert-item ${a.severity}">
        <span class="alert-severity ${a.severity}">${a.severity}</span>
        <div style="flex:1">
          <div style="font-weight:600; font-size:0.85rem">${app.escapeHtml(a.event_type)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted)">
            ${a.username ? 'User: ' + app.escapeHtml(a.username) + ' · ' : ''}${app.timeAgo(a.created_at)}
          </div>
        </div>
        ${a.user_id ? `<button class="btn btn-danger btn-sm" onclick="AdminPage.freezeAccount('${a.user_id}')">Freeze</button>` : ''}
      </div>
    `).join('');
  },

  renderSuspiciousLogins(logins) {
    if (logins.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No suspicious logins</div></div>`;
    }
    return `<table class="data-table">
      <thead><tr><th>User</th><th>Anomaly</th><th>Details</th><th>Time</th></tr></thead>
      <tbody>${logins.map(l => `
        <tr>
          <td style="font-weight:500">${app.escapeHtml(l.username || 'Unknown')}</td>
          <td><span class="badge badge-warning">${app.escapeHtml(l.anomaly_type)}</span></td>
          <td style="font-size:0.8rem">${typeof l.details === 'string' ? app.escapeHtml(l.details) : JSON.stringify(l.details).substring(0, 60)}</td>
          <td style="font-size:0.8rem">${app.timeAgo(l.created_at)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  },

  renderFlaggedTransactions(txs) {
    if (txs.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No flagged transactions</div></div>`;
    }
    return `<table class="data-table">
      <thead><tr><th>From</th><th>To</th><th>Amount</th><th>Risk</th><th>Status</th><th>Time</th></tr></thead>
      <tbody>${txs.map(t => `
        <tr>
          <td>${app.escapeHtml(t.from_username || '?')}</td>
          <td>${app.escapeHtml(t.to_username || '?')}</td>
          <td style="font-family:var(--font-mono)">₹${app.formatCurrency(t.amount)}</td>
          <td><span class="badge ${t.riskScore > 0.5 ? 'badge-danger' : 'badge-warning'}">${(t.riskScore * 100).toFixed(0)}%</span></td>
          <td><span class="tx-status ${t.status}">${t.status}</span></td>
          <td style="font-size:0.8rem">${app.timeAgo(t.created_at)}</td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  },

  renderIpAbuse(data) {
    const { rateLimitAbuse = [], honeypotAbuse = [] } = data;
    if (rateLimitAbuse.length === 0 && honeypotAbuse.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No IP abuse detected</div></div>`;
    }
    let html = '';

    if (rateLimitAbuse.length > 0) {
      html += `<h4 style="font-size:0.9rem; margin-bottom:12px">⚡ Rate Limit Breaches</h4>
        <table class="data-table"><thead><tr><th>IP</th><th>Hits</th><th>Last Seen</th></tr></thead>
        <tbody>${rateLimitAbuse.map(r => `<tr>
          <td style="font-family:var(--font-mono); font-size:0.8rem">${app.escapeHtml(r.ip_address)}</td>
          <td><span class="badge badge-warning">${r.total_hits}</span></td>
          <td style="font-size:0.8rem">${app.timeAgo(r.last_seen)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    if (honeypotAbuse.length > 0) {
      html += `<h4 style="font-size:0.9rem; margin:20px 0 12px">🍯 Honeypot Triggers</h4>
        <table class="data-table"><thead><tr><th>IP</th><th>Triggers</th><th>Endpoints</th><th>Last Seen</th></tr></thead>
        <tbody>${honeypotAbuse.map(h => `<tr>
          <td style="font-family:var(--font-mono); font-size:0.8rem">${app.escapeHtml(h.ip_address)}</td>
          <td><span class="badge badge-danger">${h.trigger_count}</span></td>
          <td style="font-size:0.75rem">${Array.isArray(h.endpoints) ? h.endpoints.join(', ') : h.endpoints}</td>
          <td style="font-size:0.8rem">${app.timeAgo(h.last_seen)}</td>
        </tr>`).join('')}</tbody></table>`;
    }

    return html;
  },

  renderBlockedUsers(users) {
    if (users.length === 0) {
      return `<div class="empty-state"><div class="empty-state-icon">✅</div><div class="empty-state-title">No blocked users</div><div class="empty-state-subtitle">All accounts are active</div></div>`;
    }
    return `<div style="margin-bottom:12px;font-size:0.9rem;color:var(--text-muted)">${users.length} blocked account${users.length !== 1 ? 's' : ''}</div>
      <table class="data-table">
      <thead><tr><th>Username</th><th>Email</th><th>Lock Reason</th><th>Failed Logins</th><th>Blocked Since</th><th>Actions</th></tr></thead>
      <tbody>${users.map(u => `
        <tr>
          <td style="font-weight:600">${app.escapeHtml(u.username)}</td>
          <td style="font-size:0.85rem">${app.escapeHtml(u.email)}</td>
          <td><span class="badge badge-danger" style="font-size:0.75rem">${app.escapeHtml(u.lock_reason || 'Unknown')}</span></td>
          <td style="text-align:center">${u.failed_login_count || 0}</td>
          <td style="font-size:0.8rem">${app.timeAgo(u.updated_at || u.created_at)}</td>
          <td>
            <button class="btn btn-success btn-sm" onclick="AdminPage.unfreezeAccount('${u.id}')">
              🔓 Unblock
            </button>
          </td>
        </tr>
      `).join('')}</tbody>
    </table>`;
  },

  async loadUsers() {
    const container = document.getElementById('admin-tab-content');
    container.innerHTML = '<div class="loader-container" style="min-height:100px"><div class="loader-spinner"></div></div>';

    try {
      const data = await app.api('/api/admin/users');
      if (!data.users || data.users.length === 0) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">No users</div></div>`;
        return;
      }

      container.innerHTML = `<table class="data-table">
        <thead><tr><th>Username</th><th>Email</th><th>Status</th><th>Failed Logins</th><th>Joined</th><th>Actions</th></tr></thead>
        <tbody>${data.users.map(u => `
          <tr>
            <td style="font-weight:500">${app.escapeHtml(u.username)}</td>
            <td style="font-size:0.85rem">${app.escapeHtml(u.email)}</td>
            <td>${u.is_locked
          ? `<span class="badge badge-danger">Locked</span>`
          : `<span class="badge badge-success">Active</span>`}</td>
            <td>${u.failed_login_count || 0}</td>
            <td style="font-size:0.8rem">${app.formatDate(u.created_at)}</td>
            <td>
              ${u.is_locked
          ? `<button class="btn btn-success btn-sm" onclick="AdminPage.unfreezeAccount('${u.id}')">Unfreeze</button>`
          : `<button class="btn btn-danger btn-sm" onclick="AdminPage.freezeAccount('${u.id}')">Freeze</button>`}
            </td>
          </tr>
        `).join('')}</tbody>
      </table>`;
    } catch (err) {
      container.innerHTML = `<div class="text-center text-muted">Failed to load users</div>`;
    }
  },

  async freezeAccount(userId) {
    if (!confirm('Freeze this account? The user will be locked out immediately.')) return;
    try {
      const data = await app.api('/api/admin/freeze-account', {
        method: 'POST',
        body: { userId, reason: 'Frozen by admin via dashboard' }
      });
      if (data.error) { app.toast(data.error, 'error'); return; }
      app.toast('Account frozen', 'warning');
      this.loadDashboard();
    } catch (err) {
      app.toast(err.message, 'error');
    }
  },

  async unfreezeAccount(userId) {
    if (!confirm('Unfreeze this account?')) return;
    try {
      const data = await app.api('/api/admin/unfreeze-account', {
        method: 'POST',
        body: { userId }
      });
      if (data.error) { app.toast(data.error, 'error'); return; }
      app.toast('Account unfrozen', 'success');
      this.loadDashboard();
    } catch (err) {
      app.toast(err.message, 'error');
    }
  },

  refresh() {
    this.loadDashboard();
    app.toast('Dashboard refreshed', 'info');
  },

  logoutAdmin() {
    app.state.adminToken = null;
    localStorage.removeItem('dpb_admin_token');
    app.toast('Admin session ended', 'info');
    app.navigate('/login');
  }
};
