-- Add PIX data columns to custom_charges
ALTER TABLE custom_charges ADD COLUMN IF NOT EXISTS pix_copy_paste TEXT;
ALTER TABLE custom_charges ADD COLUMN IF NOT EXISTS pix_qrcode_url TEXT;
ALTER TABLE custom_charges ADD COLUMN IF NOT EXISTS pix_qrcode_base64 TEXT;
