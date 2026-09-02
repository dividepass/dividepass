-- Store payment method on subscriptions for clearer admin/history views
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS payment_method TEXT;
