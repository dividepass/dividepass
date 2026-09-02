-- Add email_code_method and verification_email columns to groups table
-- email_code_method: 'imap' or 'webhook' (Cloudflare Worker)
-- verification_email: the email address used for webhook routing (e.g., verify-netflix@dividepass.com)

ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_code_method VARCHAR(10) DEFAULT 'imap';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS verification_email VARCHAR(255);

-- Backfill: set verification_email from existing email_address for groups using IMAP
UPDATE groups
SET verification_email = email_address
WHERE email_code_enabled = true
  AND verification_email IS NULL
  AND email_address IS NOT NULL;

-- Set default method for existing groups
UPDATE groups
SET email_code_method = 'imap'
WHERE email_code_enabled = true
  AND email_code_method IS NULL;
