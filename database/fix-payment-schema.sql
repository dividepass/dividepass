-- Minimal schema fix for payment inserts used by the current flows
ALTER TABLE payments ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS gateway_transaction_id TEXT;
