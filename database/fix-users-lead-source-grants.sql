-- =============================================================================
-- DividePass — libera a leitura da ORIGEM do cadastro (lead_source)
-- =============================================================================
--
-- O QUE ACONTECEU
-- ---------------
-- A migration `fix-p0-security.sql` fez:
--
--   REVOKE SELECT ON TABLE public.users FROM anon, authenticated;
--   GRANT SELECT (id, name, email, ..., onboarding_started_at)
--     ON TABLE public.users TO anon, authenticated;
--   REVOKE SELECT (..., lead_source, lead_source_other) ON TABLE public.users ...
--
-- Ou seja: `lead_source` e `lead_source_other` ficaram SEM permissão de SELECT
-- para `anon` e `authenticated` (só o service_role lê).
--
-- O relatório de onboarding (/admin/onboarding) pedia essas duas colunas na
-- MESMA consulta dos dados do usuário. O PostgREST responde 42501
-- ("permission denied for table users") para a consulta INTEIRA — não só para
-- as colunas proibidas. Resultado: `users` vinha vazio e a tela mostrava
-- "Nenhum usuário entrou no onboarding ainda", mesmo com respostas salvas
-- no banco.
--
-- A ORIGEM DO CADASTRO ("como o usuário conheceu a gente": Instagram, Google,
-- indicação, Totens...) não é dado sensível — o app já grava em
-- `users.lead_source` no cadastro e no `auth-sync.sql`. O relatório do admin
-- precisa ler para montar o gráfico de origem.
--
-- O QUE ESTA MIGRATION FAZ
-- -----------------------
-- 1. Devolve a leitura de `lead_source` e `lead_source_other` para
--    `authenticated` (admin logado) e `anon`.
-- 2. Garante que a lista segura de colunas do `users` continua completa
--    (idempotente: pode rodar mais de uma vez).
-- 3. NÃO mexe em cpf, password_hash, ids de gateway nem nos demais dados de
--    marketing — continuam service_role + a RPC `admin_get_user_private()`.
--
-- Como aplicar: SQL Editor do Supabase -> colar -> Run.
-- =============================================================================

-- 1) Lista segura de colunas do perfil (a mesma do fix-p0-security.sql).
--    Reaplicar não quebra nada e cobre o caso de alguém ter rodado um
--    REVOKE SELECT ON TABLE depois.
GRANT SELECT (
  id, name, email, phone, nickname, avatar_url, birthdate, role, status,
  email_verified, last_login_at, created_at, updated_at,
  pwa_installed_at, push_notifications_enabled_at,
  onboarding_completed_at, onboarding_step, onboarding_started_at,
  lead_source, lead_source_other
) ON TABLE public.users TO anon, authenticated;

-- 2) Confere o resultado (a última linha mostra as colunas liberadas):
--    SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name IN ('lead_source', 'lead_source_other');
