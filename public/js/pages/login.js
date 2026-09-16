/* ═══ LOGIN PAGE ═══ */
const LoginPage = {
  async render() {
    app.updateNav(false);
    app.setContent(`
      <div class="page-auth">
        <div class="auth-card">
          <div class="auth-logo">
            <img src="/logo.png" alt="Dholak Pur Bank" class="auth-logo-badge">
            <div class="auth-logo-text">DHOLAK PUR <span class="brand-accent">BANK</span></div>
            <div class="citizen-tag mt-1">🏰 Royal Citizen Portal</div>
            <p class="text-muted mt-1" style="font-size:0.8rem">Protected by Chhota Bheem's 256-Bit Vault</p>
          </div>

          <div id="login-step-1">
            <form id="login-form" method="post">
              <!-- Honeypot fields (hidden from humans, visible to bots) -->
              <div class="hp-field">
                <label>Email</label>
                <input type="email" id="hp-email" tabindex="-1" autocomplete="off">
              </div>
              <div class="hp-field">
                <label>Phone</label>
                <input type="tel" id="hp-phone" tabindex="-1" autocomplete="off">
              </div>

              <div class="form-group">
                <label class="form-label">Username</label>
                <input type="text" class="form-input" id="login-username" placeholder="Enter your username" required autocomplete="username" maxlength="50">
              </div>

              <div class="form-group">
                <label class="form-label">Password</label>
                <input type="password" class="form-input" id="login-password" placeholder="Enter your password" required autocomplete="current-password" maxlength="128">
              </div>

              <div class="form-group" id="captcha-box"></div>

              <button type="submit" class="btn btn-primary btn-block btn-lg" id="login-btn">
                🔐 Secure Login
              </button>
            </form>

            <div class="auth-footer mt-2">
              Don't have an account? <a href="#/signup">Create one</a>
            </div>
            <div class="auth-footer mt-1">
              <a href="#/admin" style="font-size:0.75rem; opacity:0.5">Admin Panel</a>
            </div>
          </div>

          <div id="login-step-2" class="hidden">
            <div class="text-center mb-3">
              <h3 style="font-size:1.1rem; margin-bottom:8px">Two-Factor Authentication</h3>
              <p class="text-muted" style="font-size:0.85rem">Enter the 6-digit OTP sent to your email address</p>
            </div>

            <div class="otp-container" id="otp-inputs">
              <input type="text" class="otp-input" maxlength="1" data-index="0">
              <input type="text" class="otp-input" maxlength="1" data-index="1">
              <input type="text" class="otp-input" maxlength="1" data-index="2">
              <input type="text" class="otp-input" maxlength="1" data-index="3">
              <input type="text" class="otp-input" maxlength="1" data-index="4">
              <input type="text" class="otp-input" maxlength="1" data-index="5">
            </div>

            <button class="btn btn-primary btn-block btn-lg mt-2" id="verify-otp-btn" onclick="LoginPage.verifyOtp()">
              ✅ Verify OTP
            </button>

            <div class="auth-footer mt-2">
              <a href="#" onclick="LoginPage.backToLogin()">← Back to login</a>
            </div>
          </div>
        </div>
      </div>
    `);

    await app.loadCaptcha('captcha-box');
    this.setupOtpInputs();

    // Bind form submit via addEventListener as safety net
    const form = document.getElementById('login-form');
    if (form) {
      form.addEventListener('submit', (e) => LoginPage.handleLogin(e));
    }

    // Bind verify OTP button
    const verifyBtn = document.getElementById('verify-otp-btn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', () => LoginPage.verifyOtp());
    }
  },

  setupOtpInputs() {
    const inputs = document.querySelectorAll('.otp-input');
    inputs.forEach((input, i) => {
      input.addEventListener('input', (e) => {
        if (e.target.value && i < 5) inputs[i + 1].focus();
        if (e.target.value && i === 5) document.getElementById('verify-otp-btn').focus();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && !e.target.value && i > 0) inputs[i - 1].focus();
      });
      // Allow only digits
      input.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
      });
    });
  },

  userId: null,

  async handleLogin(e) {
    e.preventDefault();
    const btn = document.getElementById('login-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    try {
      const data = await app.api('/api/auth/login', {
        method: 'POST',
        noAuth: true,
        body: {
          username: document.getElementById('login-username').value.trim(),
          password: document.getElementById('login-password').value,
          deviceFingerprint: app.getDeviceFingerprint(),
          _hp_email: document.getElementById('hp-email')?.value || '',
          _hp_phone: document.getElementById('hp-phone')?.value || '',
          ...app.getCaptchaData()
        }
      });

      if (data.error) {
        app.toast(data.error, 'error');
        await app.loadCaptcha('captcha-box');
        return;
      }

      if (data.requiresOtp) {
        this.userId = data.userId;
        document.getElementById('login-step-1').classList.add('hidden');
        document.getElementById('login-step-2').classList.remove('hidden');

        // Show anomaly warnings
        if (data.anomalies && data.anomalies.length > 0) {
          app.toast(`Security alert: ${data.anomalies.join(', ')}`, 'warning', 6000);
        }

        // Focus first OTP input
        setTimeout(() => document.querySelector('.otp-input')?.focus(), 100);

        // DEV MODE: auto-fill OTP if returned in response
        if (data.devOtp) {
          setTimeout(() => {
            const inputs = document.querySelectorAll('.otp-input');
            data.devOtp.toString().split('').forEach((digit, i) => {
              if (inputs[i]) inputs[i].value = digit;
            });
            app.toast(`🔑 OTP auto-filled (Dev Mode): ${data.devOtp}`, 'info', 8000);
          }, 300);
        }
      }
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  },

  async verifyOtp() {
    const inputs = document.querySelectorAll('.otp-input');
    const otp = Array.from(inputs).map(i => i.value).join('');

    if (otp.length !== 6) {
      app.toast('Please enter all 6 digits', 'warning');
      return;
    }

    const btn = document.getElementById('verify-otp-btn');
    btn.disabled = true;
    btn.classList.add('btn-loading');

    try {
      const data = await app.api('/api/auth/verify-otp', {
        method: 'POST',
        noAuth: true,
        body: {
          userId: this.userId,
          otp,
          deviceFingerprint: app.getDeviceFingerprint()
        }
      });

      if (data.error) {
        app.toast(data.error, 'error');
        inputs.forEach(i => i.value = '');
        inputs[0].focus();
        return;
      }

      app.setAuth(data.accessToken, data.refreshToken, data.user);
      app.toast('Welcome back! Login successful', 'success');
      app.navigate('/dashboard');
    } catch (err) {
      app.toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.classList.remove('btn-loading');
    }
  },

  backToLogin() {
    document.getElementById('login-step-1').classList.remove('hidden');
    document.getElementById('login-step-2').classList.add('hidden');
    this.userId = null;
  }
};
