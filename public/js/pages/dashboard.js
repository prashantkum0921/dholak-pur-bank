/* ═══ DASHBOARD PAGE ═══ */
const DashboardPage = {
    async render() {
        app.setContent(`
      <div class="page">
        <div class="page-header flex-between">
          <div>
            <h1 class="page-title">Dashboard</h1>
            <p class="page-subtitle">Your secure banking overview</p>
          </div>
          <div class="shield-animated" style="font-size:2rem" title="🔒 Connection Secured">🛡️</div>
        </div>

        <div id="dashboard-content">
          <div class="loader-container" style="min-height:200px">
            <div class="loader-spinner"></div>
          </div>
        </div>
      </div>
    `);

        await this.loadData();
    },

    async loadData() {
        try {
            const [userRes, txRes] = await Promise.all([
                app.api('/api/auth/me'),
                app.api('/api/transactions?limit=5')
            ]);

            if (userRes.error) {
                app.toast(userRes.error, 'error');
                return;
            }

            app.state.user = userRes;

            const laddooCoins = Math.max(50, Math.floor((userRes.balance || 1000) / 10));
            const content = document.getElementById('dashboard-content');
            content.innerHTML = `
        <!-- Dholakpur Royal Balance Card -->
        <div class="balance-card balance-card-dholakpur mb-3">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <span class="citizen-tag mb-2">👑 Royal Dholakpur Citizen</span>
              <div class="balance-label">Treasury Vault Balance</div>
            </div>
            <img src="/gold-coin-3d.jpg" alt="Gold Coin" class="coin-mini-3d" style="width:44px; height:44px;">
          </div>
          <div class="balance-amount">
            <span class="balance-currency">₹</span>${app.formatCurrency(userRes.balance)}
          </div>
          <div class="balance-actions mt-3">
            <a href="#/transfer" class="btn" style="background:var(--grad); color:#1e1b4b; font-weight:800;">💸 Send Arrow Money</a>
            <a href="#/beneficiaries" class="btn">👥 Royal Beneficiaries</a>
            <a href="#/transactions" class="btn">📜 Vault Ledger</a>
          </div>

          <!-- Quick Dholakpur Citizens -->
          <div class="quick-dholakpur-contacts">
            <div class="quick-contacts-title">⚡ Quick Send to Dholakpur Citizens</div>
            <div class="quick-contacts-list">
              <a href="#/transfer" class="quick-contact-btn">
                <img src="/tuntun-3d.jpg" alt="Tun Tun Mausi" class="contact-avatar-sm">
                <div>
                  <div style="font-weight:700; font-size:0.85rem">Tun Tun Mausi</div>
                  <div style="font-size:0.7rem; color:#fbbf24">Sweets & Laddoos</div>
                </div>
              </a>
              <a href="#/transfer" class="quick-contact-btn">
                <img src="/kalia-vault-3d.jpg" alt="Kalia Pahalwan" class="contact-avatar-sm">
                <div>
                  <div style="font-weight:700; font-size:0.85rem">Kalia Pahalwan</div>
                  <div style="font-size:0.7rem; color:#a5b4fc">Akhada & Gym</div>
                </div>
              </a>
              <a href="#/transfer" class="quick-contact-btn">
                <img src="/chutki-raju-3d.jpg" alt="Chutki" class="contact-avatar-sm">
                <div>
                  <div style="font-weight:700; font-size:0.85rem">Chutki & Raju</div>
                  <div style="font-size:0.7rem; color:#34d399">Village Club</div>
                </div>
              </a>
            </div>
          </div>
        </div>

        <!-- Laddoo Rewards Widget -->
        <div class="laddoo-widget">
          <div class="laddoo-info">
            <img src="/gold-coin-3d.jpg" alt="Laddoo Coin" class="laddoo-coin-img">
            <div>
              <div class="laddoo-title">Tun Tun Mausi's Laddoo Rewards</div>
              <div class="laddoo-count">${laddooCoins} <span style="font-size:1rem; color:#fbbf24">Laddoo Coins</span></div>
              <div class="laddoo-desc">Earn 1 Laddoo coin per ₹100 transferred &bull; Value: ₹${(laddooCoins * 0.5).toFixed(0)}</div>
            </div>
          </div>
          <button class="btn btn-sm" style="background:linear-gradient(135deg,#f59e0b,#ea580c); color:#1e1b4b; font-weight:800;" onclick="app.toast('🎉 ${laddooCoins} Laddoo Coins active! Enjoy delicious cashbacks on your next transfer.', 'success')">🟡 View Perks</button>
        </div>

        <!-- Quick Stats -->
        <div class="dashboard-grid">
          <div class="stat-card purple">
            <div class="stat-label">Bheem Shield Status</div>
            <div class="stat-value" style="font-size:1.3rem; color:var(--success)">
              ${userRes.isLocked ? '🔒 Locked by Guard' : '🛡️ Bheem Vault Active'}
            </div>
          </div>
          <div class="stat-card green">
            <div class="stat-label">Ledger Transactions</div>
            <div class="stat-value">${txRes.pagination?.total || 0}</div>
          </div>
          <div class="stat-card amber">
            <div class="stat-label">Kingdom Citizen Since</div>
            <div class="stat-value" style="font-size:1rem">${app.formatDate(userRes.createdAt)}</div>
          </div>
        </div>

        <!-- Recent Transactions -->
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">📜 Royal Vault Activity</h3>
            <a href="#/transactions" class="btn btn-ghost btn-sm">View All →</a>
          </div>
          <div id="recent-tx-list">
            ${this.renderTransactions(txRes.transactions || [])}
          </div>
        </div>

        <!-- Security Info -->
        <div class="card mt-2" style="border-color:rgba(245,158,11,0.3)">
          <div class="card-header" style="border:none; margin:0; padding:0">
            <h3 class="card-title" style="font-size:0.9rem">🔐 Security Status</h3>
          </div>
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(150px,1fr)); gap:12px; margin-top:12px">
            <div style="font-size:0.8rem; color:var(--text-muted)">
              <span style="color:var(--success)">●</span> MFA Enabled
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted)">
              <span style="color:var(--success)">●</span> AES-256 Encrypted
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted)">
              <span style="color:var(--success)">●</span> Session Active
            </div>
            <div style="font-size:0.8rem; color:var(--text-muted)">
              <span style="color:var(--success)">●</span> Fraud Monitoring
            </div>
          </div>
        </div>
      `;
        } catch (err) {
            app.toast('Failed to load dashboard', 'error');
        }
    },

    renderTransactions(transactions) {
        if (transactions.length === 0) {
            return `
        <div class="empty-state">
          <div class="empty-state-icon">📭</div>
          <div class="empty-state-title">No transactions yet</div>
          <div class="empty-state-desc">Make your first transfer to get started</div>
        </div>
      `;
        }

        return `<div class="tx-list">${transactions.map(tx => `
      <div class="tx-item">
        <div class="tx-icon ${tx.direction}">${tx.direction === 'sent' ? '↗️' : '↙️'}</div>
        <div class="tx-details">
          <div class="tx-name">${tx.direction === 'sent' ? 'To' : 'From'}: ${app.escapeHtml(tx.counterparty || 'System')}</div>
          <div class="tx-meta">${app.timeAgo(tx.timestamp)}</div>
        </div>
        <div>
          <div class="tx-amount ${tx.direction}">
            ${tx.direction === 'sent' ? '-' : '+'}₹${app.formatCurrency(tx.amount)}
          </div>
          <div class="tx-status ${tx.status}">${tx.status}</div>
        </div>
      </div>
    `).join('')}</div>`;
    }
};
