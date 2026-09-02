-- ============================================
-- Migration: User Groups, Wallets & Custom Cycles
-- ============================================

-- 1. Relax billing_cycle CHECK constraints to allow 'custom'
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_billing_cycle_check;
ALTER TABLE groups ADD CONSTRAINT groups_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom'));

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_billing_cycle_check;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual', 'custom'));

-- 2. Add custom cycle columns
ALTER TABLE groups ADD COLUMN IF NOT EXISTS custom_cycle_months INTEGER;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS custom_cycle_label VARCHAR(50);
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS custom_cycle_months INTEGER;

-- 3. Add is_official to groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT FALSE;
UPDATE groups SET is_official = TRUE WHERE owner_id IN (SELECT id FROM users WHERE role = 'admin');

-- 4. User Wallets
CREATE TABLE IF NOT EXISTS user_wallets (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance DECIMAL(10,2) DEFAULT 0,
  total_earned DECIMAL(10,2) DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Wallet Transactions
CREATE TABLE IF NOT EXISTS wallet_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL CHECK (type IN ('credit', 'debit', 'withdrawal', 'refund')),
  amount DECIMAL(10,2) NOT NULL,
  description TEXT,
  reference_type VARCHAR(50),
  reference_id UUID,
  status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'cancelled')),
  admin_notes TEXT,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Wallet Withdrawals
CREATE TABLE IF NOT EXISTS wallet_withdrawals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'rejected')),
  payment_method VARCHAR(50),
  payment_details TEXT,
  processed_by UUID REFERENCES users(id),
  notes TEXT,
  requested_at TIMESTAMPTZ DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

-- 7. Indexes
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user ON wallet_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_status ON wallet_withdrawals(status);

-- 8. RLS
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_withdrawals ENABLE ROW LEVEL SECURITY;

-- Users see their own wallet
CREATE POLICY "Users see own wallet" ON user_wallets
  FOR SELECT USING (auth.uid() = user_id);

-- Users see their own transactions
CREATE POLICY "Users see own transactions" ON wallet_transactions
  FOR SELECT USING (auth.uid() = user_id);

-- Users see their own withdrawals
CREATE POLICY "Users see own withdrawals" ON wallet_withdrawals
  FOR SELECT USING (auth.uid() = user_id);

-- Users can request withdrawals
CREATE POLICY "Users request withdrawals" ON wallet_withdrawals
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Admins see all wallets
CREATE POLICY "Admins see all wallets" ON user_wallets
  FOR SELECT USING (public.is_admin());

-- Admins see all transactions
CREATE POLICY "Admins see all transactions" ON wallet_transactions
  FOR SELECT USING (public.is_admin());

-- Admins manage all withdrawals
CREATE POLICY "Admins manage withdrawals" ON wallet_withdrawals
  FOR ALL USING (public.is_admin());

-- Users can create their own groups
CREATE POLICY "Users create own groups" ON groups
  FOR INSERT WITH CHECK (auth.uid() = owner_id);

-- Users can update their own groups
CREATE POLICY "Users update own groups" ON groups
  FOR UPDATE USING (auth.uid() = owner_id);

-- Users can delete their own groups
CREATE POLICY "Users delete own groups" ON groups
  FOR DELETE USING (auth.uid() = owner_id);

-- 9. App Settings defaults
INSERT INTO app_settings (key, value) VALUES
  ('gateway_fee_percent', '4.98'),
  ('platform_fee_percent', '3.95'),
  ('default_entrance_fee', '15.00')
ON CONFLICT (key) DO NOTHING;

-- 10. Function to credit wallet
CREATE OR REPLACE FUNCTION credit_wallet(
  p_user_id UUID,
  p_amount DECIMAL,
  p_description TEXT,
  p_reference_type TEXT DEFAULT NULL,
  p_reference_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_wallets (user_id, balance, total_earned, updated_at)
  VALUES (p_user_id, p_amount, p_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_wallets.balance + p_amount,
    total_earned = user_wallets.total_earned + p_amount,
    updated_at = NOW();

  INSERT INTO wallet_transactions (user_id, type, amount, description, reference_type, reference_id, status, created_at)
  VALUES (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id, 'completed', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
