/* ═══ BENEFICIARIES PAGE ═══ */
const BeneficiariesPage = {
    async render() {
        app.setContent(`
      <div class="page">
        <div class="page-header flex-between">
          <div>
            <h1 class="page-title">👥 Beneficiaries</h1>
            <p class="page-subtitle">Manage your trusted transfer recipients</p>
          </div>
          <button class="btn btn-primary" onclick="BeneficiariesPage.showAddForm()">+ Add New</button>
        </div>

        <!-- Add Beneficiary Form (hidden by default) -->
        <div id="add-beneficiary-form" class="hidden card mb-2">
          <h3 class="card-title mb-2">Add Beneficiary</h3>
          <form onsubmit="BeneficiariesPage.addBeneficiary(event)">
            <div class="hp-field">
              <input type="email" name="_hp_email" id="hp-ben-email" tabindex="-1" autocomplete="off">
            </div>
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px">
              <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" class="form-input" id="ben-username" placeholder="Recipient's username" required maxlength="50">
              </div>
              <div class="form-group">
                <label class="form-label">Nickname</label>
                <input type="text" class="form-input" id="ben-nickname" placeholder="e.g., Mom, Friend" maxlength="100">
              </div>
            </div>
            <div class="form-group" id="ben-captcha-box"></div>
            <div class="flex gap-1">
              <button type="submit" class="btn btn-success" id="add-ben-btn">✅ Add</button>
              <button type="button" class="btn btn-ghost" onclick="BeneficiariesPage.hideAddForm()">Cancel</button>
            </div>
          </form>
        </div>

        <div id="beneficiaries-list">
          <div class="loader-container" style="min-height:200px">
            <div class="loader-spinner"></div>
          </div>
        </div>
      </div>
    `);

        await this.loadBeneficiaries();
    },

    async loadBeneficiaries() {
        try {
            const data = await app.api('/api/beneficiaries');
            const container = document.getElementById('beneficiaries-list');

            if (!data.beneficiaries || data.beneficiaries.length === 0) {
                container.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">👥</div>
            <div class="empty-state-title">No beneficiaries yet</div>
            <div class="empty-state-desc">Add a beneficiary to start making quick transfers</div>
          </div>
        `;
                return;
            }

            container.innerHTML = `
        <div class="beneficiary-grid">
          ${data.beneficiaries.map(b => `
            <div class="beneficiary-card">
              <div class="beneficiary-avatar">${(b.nickname || b.username || '?').charAt(0).toUpperCase()}</div>
              <div class="beneficiary-info">
                <div class="beneficiary-name">${app.escapeHtml(b.nickname || b.username)}</div>
                <div class="beneficiary-username">@${app.escapeHtml(b.username)}</div>
                <div class="mt-1">
                  <span class="beneficiary-risk ${parseFloat(b.risk_score) > 0.7 ? 'high' : parseFloat(b.risk_score) > 0.5 ? 'medium' : 'low'}">
                    Risk: ${(parseFloat(b.risk_score) * 100).toFixed(0)}%
                  </span>
                </div>
              </div>
              <div class="beneficiary-actions" style="display:flex;flex-direction:column;gap:4px">
                <a href="#/transfer" class="btn btn-ghost btn-sm" onclick="document.getElementById('transfer-to')&&(document.getElementById('transfer-to').value='${app.escapeHtml(b.username)}')">Send</a>
                <button class="btn btn-ghost btn-sm text-danger" onclick="BeneficiariesPage.removeBeneficiary('${b.id}','${app.escapeHtml(b.nickname || b.username)}')">Remove</button>
              </div>
            </div>
          `).join('')}
        </div>
      `;
        } catch (err) {
            app.toast('Failed to load beneficiaries', 'error');
        }
    },

    async showAddForm() {
        document.getElementById('add-beneficiary-form').classList.remove('hidden');
        await app.loadCaptcha('ben-captcha-box');
        document.getElementById('ben-username').focus();
    },

    hideAddForm() {
        document.getElementById('add-beneficiary-form').classList.add('hidden');
    },

    async addBeneficiary(e) {
        e.preventDefault();
        const btn = document.getElementById('add-ben-btn');
        btn.disabled = true;
        btn.classList.add('btn-loading');

        try {
            const data = await app.api('/api/beneficiaries', {
                method: 'POST',
                body: {
                    beneficiaryUsername: document.getElementById('ben-username').value.trim(),
                    nickname: document.getElementById('ben-nickname').value.trim() || undefined,
                    _hp_email: document.getElementById('hp-ben-email')?.value || '',
                    ...app.getCaptchaData()
                }
            });

            if (data.error) {
                app.toast(data.error, 'error');
                await app.loadCaptcha('ben-captcha-box');
                return;
            }

            app.toast('Beneficiary added!', 'success');
            this.hideAddForm();
            await this.loadBeneficiaries();
        } catch (err) {
            app.toast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
        }
    },

    async removeBeneficiary(id, name) {
        if (!confirm(`Remove beneficiary "${name}"?`)) return;

        try {
            const data = await app.api(`/api/beneficiaries/${id}`, { method: 'DELETE' });
            if (data.error) {
                app.toast(data.error, 'error');
                return;
            }
            app.toast('Beneficiary removed', 'info');
            await this.loadBeneficiaries();
        } catch (err) {
            app.toast(err.message, 'error');
        }
    }
};
