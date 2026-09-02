-- Allow authenticated users to read only non-sensitive settings
-- (active_gateway, default_entrance_fee)
-- All other keys (credentials, tokens) remain admin-only

CREATE POLICY "Usuarios leem settings publicas"
  ON app_settings
  FOR SELECT
  TO authenticated
  USING (key IN ('active_gateway', 'default_entrance_fee'));
