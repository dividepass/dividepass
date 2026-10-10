-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Onboarding de qualificação (roda UMA VEZ no SQL Editor)
--
-- O questionário é fixo no código (src/pages/user/onboardingQuestions.js),
-- não no banco. Por isso não existe coluna de mapeamento pergunta→coluna:
-- o código e o relatório leem da mesma constante, então não há como um
-- divergir do outro.
--
-- Idempotente: pode rodar mais de uma vez sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. FLAG DE CONCLUSÃO
--
-- Fica em users (e não na tabela de respostas) porque é consultada em toda
-- carga de página pelos gates: é mais barato ter ao lado do perfil que o
-- AuthProvider já busca.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz;

COMMENT ON COLUMN public.users.onboarding_completed_at IS
  'Preenchido quando o usuario termina o onboarding (foto + pesquisa de qualificacao)';


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. RESPOSTAS — UMA LINHA POR USUÁRIO
--
-- Colunas tipadas de propósito: o relatório vira um SELECT ... GROUP BY
-- simples e o admin vê a resposta direto no perfil, sem depender de
-- decodificar JSON nem de buscar a pergunta em outra tabela.
--
-- Uma linha por usuário (não uma por pergunta) porque o relatório é
-- por pessoa e a aba do UserDetail precisa do retrato completo de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_onboarding_profiles (
  user_id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,

  -- "Quantas assinaturas você paga atualmente?"
  subscriptions_count_band text,

  -- "Quanto você gasta por mês com assinaturas?"
  monthly_spend_band       text,

  -- "Você já compartilha alguma assinatura digital?"
  already_shares           boolean,

  -- "Com quem você compartilha?" — múltipla escolha
  shares_with              text[] DEFAULT '{}'::text[],

  -- "Qual é a maior dificuldade para começar a compartilhar?"
  main_barrier             text,
  main_barrier_other       text,

  -- "Você tem interesse em entrar em um grupo?"
  group_interest           text,   -- 'sim' | 'talvez' | 'nao'

  -- "Indicaria para alguém? ou criaria um grupo com você?"
  would_recommend          text,

  created_at               timestamptz NOT NULL DEFAULT NOW(),
  updated_at               timestamptz NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.user_onboarding_profiles IS
  'Respostas da pesquisa de qualificacao do onboarding. Uma linha por usuario.';

COMMENT ON COLUMN public.user_onboarding_profiles.subscriptions_count_band IS
  '1-2 | 3-4 | 5-6 | 7-8 | 9-10 | 10+ | nenhuma';
COMMENT ON COLUMN public.user_onboarding_profiles.monthly_spend_band IS
  'ate-50 | 50-100 | 100-200 | 200-300 | 300-500 | 500+ | nao-sei';
COMMENT ON COLUMN public.user_onboarding_profiles.shares_with IS
  'Array com: familia | amigos | parceiro | colegas | desconhecidos';
COMMENT ON COLUMN public.user_onboarding_profiles.group_interest IS
  'sim = quer entrar | talvez = quer conhecer | nao = sem interesse';

-- Índices para o relatório: toda pergunta vira um filtro por coluna.
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_group_interest
  ON public.user_onboarding_profiles (group_interest);
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_already_shares
  ON public.user_onboarding_profiles (already_shares);
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_created_at
  ON public.user_onboarding_profiles (created_at DESC);

-- Mantém updated_at sozinho; o front só envia upsert e não precisa
-- lembrar de carimbar a data.
CREATE OR REPLACE FUNCTION public.touch_onboarding_profile_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_onboarding_profile_updated_at ON public.user_onboarding_profiles;
CREATE TRIGGER trg_onboarding_profile_updated_at
  BEFORE UPDATE ON public.user_onboarding_profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_onboarding_profile_updated_at();


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. PLATAFORMAS — REGISTRO INDIVIDUAL POR PLATAFORMA
--
-- Uma linha por (usuário, plataforma, tipo). É o que permite perguntar
-- "quantas pessoas querem Netflix" com um GROUP BY, em vez de>array
-- desnormalizado dentro do perfil.
--
-- platform_name é preenchido SEMPRE (inclusive quando platform_id é null,
-- no caso da opção "Outra plataforma"). Isso dá dois benefícios:
--   - platforms novas continuam agrupando corretamente depois
--   - a linha sobrevive se a plataforma for removida do catálogo
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_onboarding_interests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform_id   uuid REFERENCES public.streaming_services(id) ON DELETE SET NULL,
  platform_name text NOT NULL,
  -- 'current' = usa hoje | 'interested' = teria interesse em entrar num grupo
  kind          text NOT NULL CHECK (kind IN ('current', 'interested')),
  is_custom     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT NOW(),

  -- Nome em vez de id porque is_custom não tem platform_id, e NULL não
  -- conflita em índice único no Postgres.
  UNIQUE (user_id, kind, platform_name)
);

COMMENT ON TABLE public.user_onboarding_interests IS
  'Plataformas marcadas no onboarding. Uma linha por plataforma marcada.';

CREATE INDEX IF NOT EXISTS idx_onboarding_interests_user
  ON public.user_onboarding_interests (user_id);

CREATE INDEX IF NOT EXISTS idx_onboarding_interests_kind_name
  ON public.user_onboarding_interests (kind, platform_name);

-- O relatório de interesse é sempre "quantas pessoas querem X", então
-- (kind, platform_name) é a cobertura principal.
CREATE INDEX IF NOT EXISTS idx_onboarding_interests_grouping
  ON public.user_onboarding_interests (kind, platform_name);


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. ROW LEVEL SECURITY
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.user_onboarding_profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_onboarding_interests  ENABLE ROW LEVEL SECURITY;

-- ── Perfis ────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users read own onboarding profile" ON public.user_onboarding_profiles;
CREATE POLICY "Users read own onboarding profile"
  ON public.user_onboarding_profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own onboarding profile" ON public.user_onboarding_profiles;
CREATE POLICY "Users insert own onboarding profile"
  ON public.user_onboarding_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users update own onboarding profile" ON public.user_onboarding_profiles;
CREATE POLICY "Users update own onboarding profile"
  ON public.user_onboarding_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage onboarding profiles" ON public.user_onboarding_profiles;
CREATE POLICY "Admins manage onboarding profiles"
  ON public.user_onboarding_profiles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ── Interesses ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Users read own onboarding interests" ON public.user_onboarding_interests;
CREATE POLICY "Users read own onboarding interests"
  ON public.user_onboarding_interests FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users insert own onboarding interests" ON public.user_onboarding_interests;
CREATE POLICY "Users insert own onboarding interests"
  ON public.user_onboarding_interests FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- O gate regrava as plataformas a cada resposta, então precisa poder limpar
-- e reinserir as linhas do próprio usuário.
DROP POLICY IF EXISTS "Users delete own onboarding interests" ON public.user_onboarding_interests;
CREATE POLICY "Users delete own onboarding interests"
  ON public.user_onboarding_interests FOR DELETE
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage onboarding interests" ON public.user_onboarding_interests;
CREATE POLICY "Admins manage onboarding interests"
  ON public.user_onboarding_interests FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- ═══════════════════════════════════════════════════════════════════════════
-- 5. VERIFICAÇÃO — rode depois e confira que deu certo
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  item text;
  ok   boolean;
BEGIN
  FOREACH item IN ARRAY ARRAY[
    'public.users.onboarding_completed_at',
    'public.user_onboarding_profiles',
    'public.user_onboarding_interests'
  ] LOOP
    SELECT count(*) > 0 INTO ok
    FROM information_schema.columns
    WHERE table_schema = split_part(item, '.', 1)
      AND table_name   = split_part(item, '.', 2)
      AND column_name  = split_part(item, '.', 3);

    IF ok THEN
      RAISE NOTICE 'OK      %', item;
    ELSE
      RAISE WARNING 'FALTOU  %', item;
    END IF;
  END LOOP;
END $$;

-- Policies criadas
SELECT 'policy: ' || policyname AS item
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('user_onboarding_profiles', 'user_onboarding_interests')
ORDER BY tablename, policyname;