require('dotenv').config();
const { neon } = require('@neondatabase/serverless');

async function initDatabase() {
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL not set in .env');
    process.exit(1);
  }

  const sql = neon(process.env.DATABASE_URL);
  console.log('🔌 Connecting to Neon PostgreSQL...');

  // Users table
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      username VARCHAR(50) UNIQUE NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      phone VARCHAR(20),
      device_fingerprint TEXT,
      last_known_ip VARCHAR(45),
      last_known_location TEXT,
      is_locked BOOLEAN DEFAULT FALSE,
      lock_reason TEXT,
      failed_login_count INTEGER DEFAULT 0,
      last_failed_login TIMESTAMPTZ,
      otp_secret TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ users table ready');

  // Sessions table
  await sql`
    CREATE TABLE IF NOT EXISTS sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_token_hash TEXT NOT NULL,
      device_info TEXT,
      ip_address VARCHAR(45),
      created_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      is_revoked BOOLEAN DEFAULT FALSE
    )
  `;
  console.log('✅ sessions table ready');

  // Wallets table
  await sql`
    CREATE TABLE IF NOT EXISTS wallets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      balance_encrypted TEXT NOT NULL,
      nonce INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ wallets table ready');

  // Transactions ledger (immutable)
  await sql`
    CREATE TABLE IF NOT EXISTS transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      from_user_id UUID REFERENCES users(id),
      to_user_id UUID REFERENCES users(id),
      amount_encrypted TEXT NOT NULL,
      amount_plain NUMERIC(15,2) NOT NULL,
      type VARCHAR(20) NOT NULL CHECK (type IN ('transfer', 'deposit', 'withdrawal', 'refund')),
      status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'completed', 'failed', 'flagged', 'reversed')),
      tx_hash TEXT UNIQUE NOT NULL,
      nonce TEXT NOT NULL,
      metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ transactions table ready');

  // Beneficiaries
  await sql`
    CREATE TABLE IF NOT EXISTS beneficiaries (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      beneficiary_user_id UUID NOT NULL REFERENCES users(id),
      nickname VARCHAR(100),
      risk_score NUMERIC(3,2) DEFAULT 0.50,
      is_verified BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, beneficiary_user_id)
    )
  `;
  console.log('✅ beneficiaries table ready');

  // Audit logs (immutable - no UPDATE/DELETE triggers)
  await sql`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID,
      action VARCHAR(100) NOT NULL,
      ip_address VARCHAR(45),
      user_agent TEXT,
      details JSONB DEFAULT '{}',
      severity VARCHAR(20) DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'critical', 'alert')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ audit_logs table ready');

  // Fraud events
  await sql`
    CREATE TABLE IF NOT EXISTS fraud_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      event_type VARCHAR(100) NOT NULL,
      severity VARCHAR(20) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
      details JSONB DEFAULT '{}',
      resolved BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ fraud_events table ready');

  // Honeypot triggers
  await sql`
    CREATE TABLE IF NOT EXISTS honeypot_triggers (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ip_address VARCHAR(45),
      endpoint TEXT NOT NULL,
      user_agent TEXT,
      headers JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ honeypot_triggers table ready');

  // Rate limit tracking
  await sql`
    CREATE TABLE IF NOT EXISTS rate_limit_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      ip_address VARCHAR(45) NOT NULL,
      user_id UUID,
      endpoint VARCHAR(200) NOT NULL,
      hit_count INTEGER DEFAULT 1,
      window_start TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ rate_limit_events table ready');

  // Login anomalies
  await sql`
    CREATE TABLE IF NOT EXISTS login_anomalies (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      anomaly_type VARCHAR(100) NOT NULL,
      details JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ login_anomalies table ready');

  // Transaction tokens (one-time use, signed with nonce + timestamp)
  await sql`
    CREATE TABLE IF NOT EXISTS transaction_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      token_hash TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL,
      to_user_id UUID NOT NULL,
      nonce TEXT NOT NULL,
      signed_at TIMESTAMPTZ NOT NULL,
      signature TEXT NOT NULL,
      is_used BOOLEAN DEFAULT FALSE,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ transaction_tokens table ready');

  // OTP tracking
  await sql`
    CREATE TABLE IF NOT EXISTS otp_records (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      otp_hash TEXT NOT NULL,
      purpose VARCHAR(50) DEFAULT 'login',
      is_used BOOLEAN DEFAULT FALSE,
      attempts INTEGER DEFAULT 0,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  console.log('✅ otp_records table ready');

  // Create indexes
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(refresh_token_hash)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_from ON transactions(from_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_to ON transactions(to_user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_fraud_user ON fraud_events(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_honeypot_ip ON honeypot_triggers(ip_address)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_limit_ip ON rate_limit_events(ip_address)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_rate_limit_window ON rate_limit_events(window_start)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_beneficiaries_user ON beneficiaries(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_otp_user ON otp_records(user_id)`;
  await sql`CREATE INDEX IF NOT EXISTS idx_tx_tokens_user ON transaction_tokens(user_id)`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_tx_tokens_hash ON transaction_tokens(token_hash)`;
  console.log('✅ indexes created');

  // Stored procedure for atomic transfers
  await sql`
    CREATE OR REPLACE FUNCTION execute_transfer(
      p_from_user_id UUID,
      p_to_user_id UUID,
      p_token_id UUID,
      p_amount_plain NUMERIC,
      p_sender_nonce INTEGER,
      p_enc_sender_bal TEXT,
      p_enc_recipient_bal TEXT,
      p_tx_hash TEXT,
      p_tx_nonce TEXT,
      p_tx_status VARCHAR,
      p_tx_metadata JSONB
    )
    RETURNS UUID
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_tx_id UUID;
      v_sender_updated INTEGER;
      v_token_updated INTEGER;
      v_dup_tx INTEGER;
    BEGIN
      -- 1. Check for replay
      SELECT COUNT(*) INTO v_dup_tx FROM transactions WHERE tx_hash = p_tx_hash;
      IF v_dup_tx > 0 THEN
        RAISE EXCEPTION 'DUPLICATE_TX';
      END IF;

      -- 2. Mark token
      UPDATE transaction_tokens SET is_used = TRUE WHERE id = p_token_id AND is_used = FALSE;
      GET DIAGNOSTICS v_token_updated = ROW_COUNT;
      IF v_token_updated = 0 THEN
        RAISE EXCEPTION 'TOKEN_USED';
      END IF;

      -- 3. Update sender (optimistic locking)
      UPDATE wallets SET balance_encrypted = p_enc_sender_bal, nonce = nonce + 1, updated_at = NOW()
      WHERE user_id = p_from_user_id AND nonce = p_sender_nonce;
      GET DIAGNOSTICS v_sender_updated = ROW_COUNT;
      IF v_sender_updated = 0 THEN
        RAISE EXCEPTION 'CONCURRENT_UPDATE';
      END IF;

      -- 4. Update recipient
      UPDATE wallets SET balance_encrypted = p_enc_recipient_bal, nonce = nonce + 1, updated_at = NOW()
      WHERE user_id = p_to_user_id;

      -- 5. Insert transaction
      INSERT INTO transactions (from_user_id, to_user_id, amount_encrypted, amount_plain, type, status, tx_hash, nonce, metadata)
      VALUES (p_from_user_id, p_to_user_id, 'hidden', p_amount_plain, 'transfer', p_tx_status, p_tx_hash, p_tx_nonce, p_tx_metadata)
      RETURNING id INTO v_tx_id;

      RETURN v_tx_id;
    END;
    $$;
  `;
  console.log('✅ stored procedures created');

  // Prevent DELETE on audit_logs via a trigger
  await sql`
    CREATE OR REPLACE FUNCTION prevent_audit_delete()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Audit logs are immutable and cannot be deleted';
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DROP TRIGGER IF EXISTS no_delete_audit ON audit_logs
  `;
  await sql`
    CREATE TRIGGER no_delete_audit
    BEFORE DELETE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_delete()
  `;

  // Prevent UPDATE on audit_logs
  await sql`
    CREATE OR REPLACE FUNCTION prevent_audit_update()
    RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'Audit logs are immutable and cannot be updated';
    END;
    $$ LANGUAGE plpgsql
  `;

  await sql`
    DROP TRIGGER IF EXISTS no_update_audit ON audit_logs
  `;
  await sql`
    CREATE TRIGGER no_update_audit
    BEFORE UPDATE ON audit_logs
    FOR EACH ROW EXECUTE FUNCTION prevent_audit_update()
  `;

  console.log('✅ immutability triggers created');
  console.log('🏦 Dholak Pur Bank database initialization complete!');
}

initDatabase().catch(err => {
  console.error('❌ Database initialization failed:', err);
  process.exit(1);
});
