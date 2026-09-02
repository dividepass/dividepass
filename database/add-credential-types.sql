-- Add credential_type and credential_url columns to group_credentials
-- Supports: email_password (default), link, code, custom

ALTER TABLE group_credentials
  ADD COLUMN IF NOT EXISTS credential_type VARCHAR(50) NOT NULL DEFAULT 'email_password',
  ADD COLUMN IF NOT EXISTS credential_url TEXT,
  ADD COLUMN IF NOT EXISTS credential_notes TEXT;

-- Make login_email and login_password nullable (link-type credentials don't need them)
ALTER TABLE group_credentials
  ALTER COLUMN login_email DROP NOT NULL,
  ALTER COLUMN login_password DROP NOT NULL;

-- Set existing email/password credentials to the correct type
UPDATE group_credentials
  SET credential_type = 'email_password'
  WHERE credential_type = 'email_password'
    AND login_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_group_credentials_type ON group_credentials(credential_type);
