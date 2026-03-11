-- Migration: Billing transactions audit trail
-- Logs every balance change (charges, credits, transfers) as a line item.

CREATE TABLE IF NOT EXISTS billing_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,            -- 'charge', 'credit', 'transfer'
  category TEXT NOT NULL,        -- 'hosting', 'data_storage', 'deposit', 'auto_topup', 'call_charge', 'earning'
  description TEXT NOT NULL,     -- e.g. "Hosting: 8 apps (1.2 MB)", "Deposit via Stripe"
  app_id UUID REFERENCES apps(id) ON DELETE SET NULL,
  app_name TEXT,                 -- denormalized for display (app may be deleted later)
  amount_cents FLOAT NOT NULL,   -- positive = credit, negative = charge
  balance_after FLOAT,           -- snapshot of balance after this transaction
  metadata JSONB,                -- flexible: { storage_mb, hours, rate, stripe_session_id, ... }
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_tx_user_created ON billing_transactions (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_tx_category ON billing_transactions (user_id, category);
