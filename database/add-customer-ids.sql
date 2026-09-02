-- ============================================
-- Migration: Customer IDs per gateway
-- ============================================

-- Add customer_id columns for each gateway on users table
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id_iopay TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id_stripe TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id_asaas TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id_mercadopago TEXT;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_customer_id_iopay ON users(customer_id_iopay);
CREATE INDEX IF NOT EXISTS idx_users_customer_id_stripe ON users(customer_id_stripe);
CREATE INDEX IF NOT EXISTS idx_users_customer_id_asaas ON users(customer_id_asaas);
