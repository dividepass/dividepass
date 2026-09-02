-- ============================================
-- Migration: Multi-Gateway Payment System
-- ============================================

-- 1. Gateway column on payments table
ALTER TABLE payments ADD COLUMN IF NOT EXISTS gateway TEXT DEFAULT 'mercadopago';

-- 2. Gateway columns on user_subscriptions (generalize MP-specific columns)
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS gateway TEXT DEFAULT 'mercadopago';
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS gateway_subscription_id TEXT;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS gateway_status TEXT;

-- 3. Gateway payment ID on group_members
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS gateway_payment_id TEXT;

-- 4. Insert default active_gateway setting (only if not exists)
INSERT INTO app_settings (key, value)
VALUES ('active_gateway', 'mercadopago')
ON CONFLICT (key) DO NOTHING;

-- 5. Gateway-specific config keys (only if not exists)
INSERT INTO app_settings (key, value) VALUES
  ('mercadopago_access_token', ''),
  ('stripe_secret_key', ''),
  ('stripe_webhook_secret', ''),
  ('asaas_api_key', ''),
  ('asaas_env', 'sandbox'),
  ('iopay_secret', ''),
  ('iopay_email', ''),
  ('iopay_seller_id', '')
ON CONFLICT (key) DO NOTHING;
