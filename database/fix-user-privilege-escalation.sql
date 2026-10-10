-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Correção de escalação de privilégio em public.users
--
-- PROBLEMA
--
--   database/fix-admin-users-read.sql:19-22 criou a policy abaixo sem
--   restringir colunas:
--
--     CREATE POLICY "Users update own profile" ON users FOR UPDATE
--       USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
--
--   RLS decide LINHAS, não COLUNAS. Um usuário logado que llama a API
--   direto consegue alterar qualquer coluna da própria linha:
--
--     PATCH /rest/v1/users?id=eq.<meu_id>   {"role":"admin"}
--
--   Isso foi verificado em produção: a chamada retornou 200 e o usuário
--   virou admin. Como public.is_admin() lê users.role, o admin inteiro
--   (todos os usuários, todos os pagamentos, edição de preços) destrava.
--   Pior: o trigger handle_user_role_update ainda espelha o role novo para
--   auth.users.raw_app_metadata, então a escalada persiste no JWT.
--
-- CORREÇÃO
--
--   No Postgres o filtro por coluna é privilégio (GRANT), não policy.
--   Tiramos o UPDATE de tabela e devolvemos só as colunas que o usuário
--   realmente pode mexer na própria conta. O service_role (usado pelas
--   edge functions e pelo painel admin) não é afetado.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════


-- ─────────────────────────────────────────────────────────────────
-- 1. Fecha o UPDATE de tabela para o papel autenticado
-- ─────────────────────────────────────────────────────────────────

REVOKE UPDATE ON public.users FROM authenticated;
REVOKE UPDATE ON public.users FROM anon;


-- ─────────────────────────────────────────────────────────────────
-- 2. Devolve apenas as colunas de auto-serviço
--
-- Todos os pontos do front que gravam em users a partir do navegador:
--   src/lib/uploadAvatar.js          -> avatar_url
--   src/pages/user/UserProfile.jsx   -> name, avatar_url, phone, nickname, birthdate
--   src/components/PwaInstallGate.jsx-> pwa_installed_at
--   src/components/OnboardingGate.jsx-> onboarding_completed_at
--
-- O painel admin grava pela edge function admin-update-user (service_role),
-- então troca de role, status e email continua funcionando normalmente.
-- ─────────────────────────────────────────────────────────────────

GRANT UPDATE (
  name,
  phone,
  nickname,
  birthdate,
  avatar_url,
  pwa_installed_at,
  onboarding_completed_at
) ON public.users TO authenticated;


-- ─────────────────────────────────────────────────────────────────
-- 3. Verificação
--
-- Rode e confira que saem 7 linhas na primeira consulta e as colunas
-- sensíveis aparecem com 'nao' na segunda.
-- ─────────────────────────────────────────────────────────────────

SELECT 'colunas liberadas para o usuario: ' || count(*)::text AS item
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name   = 'users'
  AND grantee      = 'authenticated'
  AND privilege_type = 'UPDATE';

SELECT c.column_name,
       CASE WHEN p.column_name IS NULL THEN 'nao' ELSE 'SIM' END AS auto_update_permitido
FROM information_schema.columns c
LEFT JOIN information_schema.column_privileges p
       ON p.table_schema = 'public'
      AND p.table_name   = 'users'
      AND p.column_name  = c.column_name
      AND p.grantee      = 'authenticated'
      AND p.privilege_type = 'UPDATE'
WHERE c.table_schema = 'public'
  AND c.table_name = 'users'
  AND c.column_name IN (
    'role', 'status', 'email', 'email_verified', 'password_hash', 'cpf',
    'customer_id_iopay', 'customer_id_stripe', 'customer_id_asaas',
    'customer_id_mercadopago', 'customer_id_pagarme',
    'push_notifications_enabled_at'
  )
ORDER BY c.column_name;