-- Fix missing columns in user_subscriptions and payments tables

-- Add custom_months to user_subscriptions if it doesn't exist
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS custom_months INTEGER DEFAULT NULL;

-- Add custom_months to payments if it doesn't exist
ALTER TABLE payments ADD COLUMN IF NOT EXISTS custom_months INTEGER DEFAULT NULL;
