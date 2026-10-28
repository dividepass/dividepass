-- ============================================================
-- Garante que o admin do painel leia e gerencie os feedbacks.
--
-- A tabela `user_feedback` foi criada em `database/add-user-feedback.sql`
-- junto com a edge function `send-feedback`. Este script e idempotente e
-- pode ser rodado quantas vezes for: ele recria as policies do zero e
-- garante os GRANTs.
--
-- POR QUE ISTO EXISTE
-- O feedback e gravado pela edge function `send-feedback` com a
-- `service_role` (que ignora RLS). A leitura, porem, e feita pelo painel
-- admin com o JWT do usuario logado -- e o JWT so passa na policy se o
-- `is_admin()` estiver correta. Sem policy de admin (ou com uma policy
-- quebrada), a listagem volta VAZIA sem erro nenhum: o RLS filtra as
-- linhas em silencio e o admin conclui que "ninguem mandou feedback".
--
-- COMO APLICAR (projeto DividePass = lasoouwboxspstqvjbsv)
--   $env:SUPABASE_ACCESS_TOKEN = '<sbp_...>'
--   .\scripts\apply-migration.ps1 -File database\fix-feedback-admin-rls.sql
--
-- VERIFICACAO DEPOIS (rode no SQL Editor do Supabase):
--   select policyname, cmd, roles from pg_policies
--    where schemaname = 'public' and tablename = 'user_feedback';
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1) Tabela (garante que exista, mesmo se a migration original
--    ainda nao tiver sido aplicada neste projeto).
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_feedback (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  page        TEXT,
  status      TEXT        NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'reviewed', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- 2) RLS ligado.
--    ATENCAO: RLS ligado SEM nenhuma policy = escrita/leitura negada
--    para anon e authenticated. O service_role passa (BYPASSRLS).
-- ------------------------------------------------------------
ALTER TABLE public.user_feedback ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 3) Policies. Recriadas (DROP + CREATE) para nao deixar policy
--    antiga "frouxa" convivendo com a nova: policies sao OR-ed entre
--    si, entao uma permissiva continua valendo ao lado de outra.
-- ------------------------------------------------------------

-- Admin: le, atualiza o status e exclui qualquer feedback.
DROP POLICY IF EXISTS "Admins gerenciam feedbacks" ON public.user_feedback;
CREATE POLICY "Admins gerenciam feedbacks"
  ON public.user_feedback FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Usuario: le apenas o proprio feedback.
DROP POLICY IF EXISTS "Usuarios veem seus feedbacks" ON public.user_feedback;
CREATE POLICY "Usuarios veem seus feedbacks"
  ON public.user_feedback FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Usuario: envia feedback em nome proprio.
DROP POLICY IF EXISTS "Usuarios enviam feedback" ON public.user_feedback;
CREATE POLICY "Usuarios enviam feedback"
  ON public.user_feedback FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

-- ------------------------------------------------------------
-- 4) GRANTs. O `users` mantem o padrao do projeto; explicitamos
--    aqui para nao depender de default privileges do schema.
-- ------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_feedback TO authenticated;
GRANT ALL ON public.user_feedback TO service_role;

-- ------------------------------------------------------------
-- 5) Indices para os filtros da listagem (status + data).
-- ------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id
  ON public.user_feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_user_feedback_status
  ON public.user_feedback(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_feedback_created_at
  ON public.user_feedback(created_at DESC);

COMMIT;

-- ============================================================
-- VERIFICACAO
--   -- policies criadas:
--   select policyname, cmd, roles, qual
--     from pg_policies
--    where schemaname = 'public' and tablename = 'user_feedback';
--
--   -- linhas visiveis (deve vir 0 se nao houver feedback, e
--   -- nao "erro"): conte como admin autenticado.
--   select status, count(*) from user_feedback group by status;
-- ============================================================
