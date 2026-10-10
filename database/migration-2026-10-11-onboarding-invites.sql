-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Indicações do onboarding (roda UMA VEZ no SQL Editor)
--
-- Etapa final do onboarding: em vez de texto livre, o usuário adiciona as
-- pessoas que convidaria para um grupo (Nome + WhatsApp). O mínimo é 2.
--
-- Uma linha por pessoa indicada: o admin consegue filtrar quem foi
-- indicado, ver o telefone e usar isso depois em campanha de indicação.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_onboarding_invites (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  -- Só dígitos, com DDI: o front normaliza antes de gravar.
  phone      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT NOW(),

  UNIQUE (user_id, phone)
);

COMMENT ON TABLE public.user_onboarding_invites IS
  'Pessoas que o usuarioubu convidou para um grupo na etapa final do onboarding.';

CREATE INDEX IF NOT EXISTS idx_onboarding_invites_user
  ON public.user_onboarding_invites (user_id);

-- Telefone sem DDI + o próprio usuário: evita a mesma pessoa entrar duas
-- vezes por DDD diferente (11987654321 vs 5511987654321).
CREATE UNIQUE INDEX IF NOT EXISTS idx_onboarding_invites_user_phone_national
  ON public.user_onboarding_invites (user_id, right(phone, 11))
  WHERE phone IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────
-- RLS: o usuário escreve e lê os próprios; admin lê e gerencia todos
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE public.user_onboarding_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own onboarding invites" ON public.user_onboarding_invites;
CREATE POLICY "Users read own onboarding invites"
  ON public.user_onboarding_invites FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own onboarding invites" ON public.user_onboarding_invites;
CREATE POLICY "Users insert own onboarding invites"
  ON public.user_onboarding_invites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- O gate regrava as indicações quando o usuário edita a resposta.
DROP POLICY IF EXISTS "Users delete own onboarding invites" ON public.user_onboarding_invites;
CREATE POLICY "Users delete own onboarding invites"
  ON public.user_onboarding_invites FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage onboarding invites" ON public.user_onboarding_invites;
CREATE POLICY "Admins manage onboarding invites"
  ON public.user_onboarding_invites FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ─────────────────────────────────────────────────────────────────
-- Verificação
-- ─────────────────────────────────────────────────────────────────

SELECT 'policy: ' || policyname AS item
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'user_onboarding_invites'
ORDER BY policyname;

SELECT count(*)::text AS "linhas hoje"
FROM public.user_onboarding_invites;