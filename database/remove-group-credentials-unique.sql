-- Remove UNIQUE constraint on group_id to allow multiple credential profiles per group
ALTER TABLE group_credentials DROP CONSTRAINT group_credentials_group_id_key;

-- Add index for faster lookups (non-unique)
CREATE INDEX IF NOT EXISTS idx_group_credentials_group_id ON group_credentials(group_id);

-- Update RLS policy to allow admin insert/update of multiple rows
DROP POLICY IF EXISTS "Admins gerenciam credenciais" ON group_credentials;
CREATE POLICY "Admins gerenciam credenciais" ON group_credentials
    FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());
