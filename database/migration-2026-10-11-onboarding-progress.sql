-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Progresso do onboarding (roda UMA VEZ no SQL Editor)
--
-- O onboarding passa a gravar a cada "Continuar" em vez de só no final. Isso
-- permite retomar de onde parou e, pro admin, saber quem começou e não
-- terminou.
--
-- ⚠️ A correção de segurança (fix-user-privilege-escalation.sql) revogou o
-- UPDATE genérico em public.users e devolveu só algumas colunas. Aqui a gente
-- devolve as duas colunas novas pro papel autenticado, senão o cliente não
-- consegue gravá-las.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_step text;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_started_at timestamptz;

COMMENT ON COLUMN public.users.onboarding_step IS
  'Id da etapa atual do onboarding. NULL = ainda não começou (ou concluído).';
COMMENT ON COLUMN public.users.onboarding_started_at IS
  'Quando o usuário começou o onboarding. Permite achar quem não terminou.';

-- Devolve as duas colunas para atualização pelo próprio usuário.
GRANT UPDATE (onboarding_step, onboarding_started_at) ON public.users TO authenticated;

-- Índice para o relatório "não concluíram": quem tem started_at mas não
-- tem completed_at.
CREATE INDEX IF NOT EXISTS idx_users_onboarding_progress
  ON public.users (onboarding_started_at)
  WHERE onboarding_step IS NOT NULL AND onboarding_completed_at IS NULL;


-- ─────────────────────────────────────────────────────────────────
-- Verificação
-- ─────────────────────────────────────────────────────────────────

SELECT column_name, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND column_name IN ('onboarding_step', 'onboarding_started_at')
ORDER BY column_name;

SELECT 'colunas liberadas: ' || string_agg(column_name, ', ' ORDER BY column_name) AS item
FROM information_schema.column_privileges
WHERE table_schema = 'public'
  AND table_name = 'users'
  AND grantee = 'authenticated'
  AND privilege_type = 'UPDATE'
  AND column_name IN ('onboarding_step', 'onboarding_started_at');