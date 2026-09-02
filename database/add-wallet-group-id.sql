-- Add group_id to wallet_transactions for proper linking
ALTER TABLE wallet_transactions
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- Update credit_wallet to accept optional group_id
CREATE OR REPLACE FUNCTION credit_wallet(
  p_user_id UUID, p_amount DECIMAL, p_description TEXT,
  p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
  p_group_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
  INSERT INTO user_wallets (user_id, balance, total_earned, updated_at)
  VALUES (p_user_id, p_amount, p_amount, NOW())
  ON CONFLICT (user_id) DO UPDATE SET
    balance = user_wallets.balance + p_amount,
    total_earned = user_wallets.total_earned + p_amount, updated_at = NOW();

  INSERT INTO wallet_transactions (user_id, type, amount, description, reference_type, reference_id, group_id, status, created_at)
  VALUES (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id, p_group_id, 'completed', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
