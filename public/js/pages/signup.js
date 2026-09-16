/* ═══ SIGNUP PAGE ═══ */
const SignupPage = {
    async render() {
        app.updateNav(false);
        app.setContent(`
      <div class="page-auth">
        <div class="auth-card">
          <div class="auth-logo">
            <img src="/logo.png" alt="Dholak Pur Bank" class="auth-logo-badge">
            <div class="auth-logo-text">DHOLAK PUR <span class="brand-accent">BANK</span></div>
            <div class="citizen-tag mt-1">👑 New Citizen Registration</div>
            <p class="text-muted mt-1" style="font-size:0.8rem">Get 50 Welcome Laddoo Coins from Tun Tun Mausi!</p>
          </div>

          <form id="signup-form" method="post">
            <!-- Honeypot fields -->
            <div class="hp-field">
              <input type="email" id="hp-email-signup" tabindex="-1" autocomplete="off">
            </div>
            <div class="hp-field">
              <input type="tel" id="hp-phone-signup" tabindex="-1" autocomplete="off">
            </div>

            <div class="form-group">
              <label class="form-label">Username</label>
              <input type="text" class="form-input" id="signup-username" placeholder="Choose a username" required minlength="3" maxlength="30" pattern="[a-zA-Z0-9_]+" autocomplete="username">
              <div class="form-hint">3-30 characters, letters, numbers, underscores only</div>
            </div>

            <div class="form-group">
              <label class="form-label">Email</label>
              <input type="email" class="form-input" id="signup-email" placeholder="your@email.com" required maxlength="255" autocomplete="email">
            </div>

            <div class="form-group">
              <label class="form-label">Phone (optional)</label>
              <input type="tel" class="form-input" id="signup-phone" placeholder="+91 XXXXX XXXXX" maxlength="20" autocomplete="tel">
            </div>

            <div class="form-group">
              <label class="form-label">Password</label>
              <input type="password" class="form-input" id="signup-password" placeholder="Min 8 characters" required minlength="8" maxlength="128" autocomplete="new-password">
              <div class="form-hint">Minimum 8 characters, include numbers and symbols for strength</div>
            </div>

            <div class="form-group">
              <label class="form-label">Confirm Password</label>
              <input type="password" class="form-input" id="signup-confirm" placeholder="Re-enter password" required maxlength="128" autocomplete="new-password">
            </div>

            <div class="form-group" id="signup-captcha-box"></div>

            <!-- Identity Verification Simulation -->
            <div class="card mb-2" style="padding:16px; background:rgba(99,102,241,0.05); border-color:rgba(99,102,241,0.2)">
              <div class="flex gap-1" style="align-items:center">
                <span>🛡️</span>
                <div>
                  <div style="font-size:0.85rem; font-weight:600; color:var(--text-accent)">Identity Verification</div>
                  <div style="font-size:0.75rem; color:var(--text-muted)">Your identity will be verified using our secure simulation protocol</div>
                </div>
              </div>
            </div>

            <button type="submit" class="btn btn-primary btn-block btn-lg" id="signup-btn">
              🚀 Create Secure Account
            </button>
          </form>

          <div class="auth-footer mt-2">
            Already have an account? <a href="#/login">Sign in</a>
          </div>
        </div>
      </div>
    `);

        await app.loadCaptcha('signup-captcha-box');

        // Bind form submit via addEventListener as safety net
        const form = document.getElementById('signup-form');
        if (form) {
            form.addEventListener('submit', (e) => SignupPage.handleSignup(e));
        }
    },

    async handleSignup(e) {
        e.preventDefault();
        const password = document.getElementById('signup-password').value;
        const confirm = document.getElementById('signup-confirm').value;

        if (password !== confirm) {
            app.toast('Passwords do not match', 'error');
            return;
        }

        const btn = document.getElementById('signup-btn');
        btn.disabled = true;
        btn.classList.add('btn-loading');

        try {
            const data = await app.api('/api/auth/signup', {
                method: 'POST',
                noAuth: true,
                body: {
                    username: document.getElementById('signup-username').value.trim(),
                    email: document.getElementById('signup-email').value.trim(),
                    password,
                    phone: document.getElementById('signup-phone').value.trim() || undefined,
                    deviceFingerprint: app.getDeviceFingerprint(),
                    _hp_email: document.getElementById('hp-email-signup')?.value || '',
                    _hp_phone: document.getElementById('hp-phone-signup')?.value || '',
                    ...app.getCaptchaData()
                }
            });

            if (data.error) {
                app.toast(data.error + (data.details ? ': ' + data.details.join(', ') : ''), 'error');
                await app.loadCaptcha('signup-captcha-box');
                return;
            }

            app.toast('Account created successfully! Identity verified ✅', 'success', 5000);
            app.navigate('/login');
        } catch (err) {
            app.toast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.classList.remove('btn-loading');
        }
    }
};
