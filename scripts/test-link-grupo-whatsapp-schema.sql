-- ============================================================================
-- Schema de TESTE para o arquivo que o Gabriel executa no SQL Editor:
--   database/EXECUTAR-2026-11-01-link-grupo-whatsapp.sql
--
-- Reproduz o mínimo do banco de produção para o arquivo inteiro rodar sem
-- erro de sintaxe e para os asserts de comportamento serem reais:
-- a tabela `app_settings` com RLS ligado, as policies que existem em
-- produção e os papéis `anon` / `authenticated`.
--
-- Uso (Postgres local):
--   psql -U postgres -d postgres -f scripts/test-link-grupo-whatsapp-schema.sql
--   psql -U postgres -d postgres -f database/EXECUTAR-2026-11-01-link-grupo-whatsapp.sql
--   psql -U postgres -d postgres -f scripts/test-link-grupo-whatsapp-asserts.sql
-- ============================================================================

DROP TABLE IF EXISTS public.app_settings CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END
$$;

CREATE TABLE public.app_settings (
  key   text PRIMARY KEY,
  value text
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy de admin (como em produção: `is_admin()` existe em produção; aqui
-- basta o papel service_role para simular quem administra).
GRANT ALL ON public.app_settings TO service_role;
CREATE POLICY "Admins can read app_settings"
  ON public.app_settings FOR SELECT TO service_role USING (true);
CREATE POLICY "Admins can update app_settings"
  ON public.app_settings FOR UPDATE TO service_role USING (true);
CREATE POLICY "Admins can insert app_settings"
  ON public.app_settings FOR INSERT TO service_role WITH CHECK (true);

-- Policy de settings públicas para logados (a versão antiga, sem a chave
-- do grupo — o arquivo testado é que deve acrescentá-la).
GRANT SELECT ON public.app_settings TO authenticated;
CREATE POLICY "Usuarios leem settings publicas"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (key IN ('active_gateway', 'default_entrance_fee'));

-- Configurações sensíveis: se o `anon` conseguir ler uma delas, a policy
-- testada está furada.
INSERT INTO public.app_settings (key, value) VALUES
  ('smtp_host', 'mail.dividepass.com'),
  ('smtp_pass', 'senha-que-nao-pode-vazar'),
  ('gateway_fee_percent', '4.98');

SELECT 'schema de teste pronto' AS status;
