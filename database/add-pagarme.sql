-- Add PagarMe customer_id column
ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id_pagarme TEXT;

-- Add PagarMe settings if not exists
INSERT INTO app_settings (key, value) VALUES
  ('pagarme_secret_key', ''),
  ('pagarme_public_key', '')
ON CONFLICT (key) DO NOTHING;

-- Clean up old key
DELETE FROM app_settings WHERE key = 'pagarme_api_key';
