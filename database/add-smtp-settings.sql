INSERT INTO app_settings (key, value) VALUES
  ('smtp_host', 'mail.dividepass.com'),
  ('smtp_port', '465'),
  ('smtp_user_support', 'suporte@dividepass.com'),
  ('smtp_user_noreply', 'noreply@dividepass.com'),
  ('smtp_from_support', 'DividePass Suporte <suporte@dividepass.com>'),
  ('smtp_from_noreply', 'DividePass <noreply@dividepass.com>')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
