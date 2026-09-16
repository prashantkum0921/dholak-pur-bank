/* ═══ TRANSFER PAGE ═══ */
const TransferPage = {
  transactionToken: null,

  async render() {
    app.setContent(`
      <div class="page" style="max-width:600px">
        <div class="page-header">
          <div class="citizen-tag mb-2">🏹 Raju's Arrow Transfer Network</div>
          <h1 class="page-title">⚡ Send Money Instantly</h1>
          <p class="page-subtitle">Transfers protected by Bheem's vault cryptographic signature</p>
        </div>

        <!-- Laddoo Cashback Banner -->
        <div class="laddoo-widget mb-3" style="padding:14px 18px">
          <div class="laddoo-info">
            <img src="/gold-coin-3d.jpg" alt="Coin" style="width:34px; height:34px; border-radius:50%; border:1px solid #fde047">
            <div style="font-size:0.85rem">
              <strong style="color:#fbbf24">Tun Tun Mausi Cashback:</strong> Earn 1 Laddoo Coin per ₹100 transferred!
            </div>
          </div>
        </div>

        <div class="card">
          <div id="transfer-step-1">
            <h3 style="font-size:1rem; margin-bottom:20px">Step 1: Transfer Details</h3>
            
            <div class="form-group">
              <label class="form-label">Recipient Username</label>
              <input type="text" class="form-input" id="transfer-to" placeholder="Enter recipient username" required maxlength="50">
            </div>

            <div class="form-group">
              <label class="form-label">Amount (₹)</label>
              <input type="number" class="form-input" id="transfer-amount" placeholder="0.00" required min="0.01" max="1000000" step="0.01" style="font-family:var(--font-mono); font-size:1.2rem">
            </div>

            <div class="form-group">
              <label class="form-label">Note (optional)</label>
              <input type="text" class="form-input" id="transfer-note" placeholder="Add a note..." maxlength="200">
            </div>

            <div class="form-group" id="transfer-captcha-box"></div>

            <button class="btn btn-primary btn-block btn-lg" id="sign-tx-btn" onclick="TransferPage.signTransaction()">
              🔏 Sign Transaction
            </button>
          </div>

          <div id="transfer-step-2" class="hidden">
            <h3 style="font-size:1rem; margin-bottom:20px">Step 2: Confirm & Send</h3>
            
            <div class="card" style="background:rgba(99,102,241,0.05); border-color:rgba(99,102,241,0.2); margin-bottom:20px">
              <div style="display:grid; gap:12px">
                <div class="flex-between">
                  <span class="text-muted" style="font-size:0.85rem">To</span>
                  <span style="font-weight:600" id="confirm-to"></span>
                </div>
                <div class="flex-between">
                  <span class="text-muted" style="font-size:0.85rem">Amount</span>
                  <span style="font-weight:700; font-family:var(--font-mono); font-size:1.2rem" id="confirm-amount"></span>
                </div>
                <div class="flex-between">
                  <span class="text-muted" style="font-size:0.85rem">Token Expires</span>
                  <span style="font-size:0.85rem; color:var(--warning)" id="confirm-expiry"></span>
                </div>
              </div>
            </div>
            
            <div style="background:var(--warning-bg); padding:12px; border-radius:var(--radius-sm); margin-bottom:20px; font-size:0.8rem; color:var(--warning); display:flex; gap:8px; align-items:center">
              <span>⚠️</span>
              <span>This transaction is cryptographically signed. The amount and recipient cannot be altered.</span>
            </div>

            <button class="btn btn-success btn-block btn-lg" id="send-btn" onclick="TransferPage.executeTransfer()">
              ✅ Confirm & Send
            </button>
            <button class="btn btn-ghost btn-block mt-1" onclick="TransferPage.cancelTransfer()">
              Cancel
            </button>
          </div>

          <div id="transfer-step-3" class="hidden text-center" style="padding:40px 0">
            <div style="font-size:3rem; margin-bottom:16px">✅</div>
            <h3 style="font-size:1.2rem; margin-bottom:8px; color:var(--success)">Transfer Successful!</h3>
            <p class="text-muted mb-2" id="success-details"></p>
            <div class="flex gap-1" style="justify-content:center">
              <a href="#/dashboard" class="btn btn-primary">Dashboard</a>
              <button class="btn btn-ghost" onclick="TransferPage.newTransfer()">New Transfer</button>
            </div>
          </div>
        </div>
      </div>
    `);

    await app.loadCaptcha('transfer-captcha-box');
  },

  async signTransaction() {
    const to = document.getElementById('transfer-to').value.trim();
    const amount = parseFloat(document.getElementById('transfer-amount').value);

    if (!to) return app.toast('Enter recipient username', 'warning');
    if (!amount || amount <= 0) return app.toast('Enter a valid amount', 'warning');

    const btn = document.getElementById('sign-tx-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    try {
      const data = await app.api('/api/transactions/sign', {
        method: 'POST',
        body: {
          toUsername: to,
          amount,
          ...app.getCaptchaData()
        }
      });

      if (data.error) {
        app.toast(data.error, 'error');
        await app.loadCaptcha('transfer-captcha-box');
        return;
      }

      this.transactionToken = data.transactionToken;

      document.getElementById('confirm-to').textContent = data.toUsername;
      document.getElementById('confirm-amount').textContent = `₹${app.formatCurrency(data.amount)}`;
      document.getElementById('confirm-expiry').textContent = `${data.expiresIn}s`;

      document.getElementById('transfer-step-1').classList.add('hidden');
      document.getElementById('transfer-step-2').classList.remove('hidden');

      // Countdown timer (uses server-provided expiry, now 120s)
      let timeLeft = data.expiresIn;
      this.expiryTimer = setInterval(() => {
        timeLeft--;
        const el = document.getElementById('confirm-expiry');
        if (el) el.textContent = `${timeLeft}s`;
        if (timeLeft <= 0) {
          clearInterval(this.expiryTimer);
          app.toast('Transaction token expired. Please try again.', 'warning');
          this.cancelTransfer();
        }
      }, 1000);

      app.toast('Transaction signed! Confirm to proceed.', 'info');
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  },

  async executeTransfer() {
    const btn = document.getElementById('send-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    try {
      const data = await app.api('/api/wallet/transfer', {
        method: 'POST',
        body: {
          toUsername: document.getElementById('transfer-to').value.trim(),
          amount: parseFloat(document.getElementById('transfer-amount').value),
          transactionToken: this.transactionToken,
          note: document.getElementById('transfer-note').value.trim()
        }
      });

      if (data.error) {
        app.toast(data.error, 'error');
        if (data.code === 'FRAUD_BLOCKED') {
          app.toast('Transaction blocked by fraud detection. Contact support.', 'warning', 8000);
        }
        return;
      }

      clearInterval(this.expiryTimer);

      document.getElementById('transfer-step-2').classList.add('hidden');
      document.getElementById('transfer-step-3').classList.remove('hidden');
      document.getElementById('success-details').innerHTML = `
        Sent <strong>₹${app.formatCurrency(data.transaction.amount)}</strong> to <strong>${app.escapeHtml(data.transaction.to)}</strong><br>
        <span class="text-mono" style="font-size:0.7rem; opacity:0.5">TX: ${data.transaction.txHash?.substring(0, 16)}...</span>
      `;

      app.toast('Transfer completed successfully!', 'success');
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  },

  cancelTransfer() {
    clearInterval(this.expiryTimer);
    this.transactionToken = null;
    document.getElementById('transfer-step-1').classList.remove('hidden');
    document.getElementById('transfer-step-2').classList.add('hidden');
    app.loadCaptcha('transfer-captcha-box');
  },

  newTransfer() {
    this.transactionToken = null;
    this.render();
  }
};
