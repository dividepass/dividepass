-- =============================================================================
-- DividePass — onboarding: fluxo novo (criar / entrar / ambos) + resposta aberta
-- =============================================================================
-- Data: 02/11/2026
--
-- O QUE MUDA
-- ----------
-- 1) user_onboarding_profiles ganha DUAS colunas:
--
--      group_intent  → 'entrar' | 'criar' | 'ambos'
--        "Hoje você gostaria de entrar em grupos para dividir ou deseja criar
--         o seu grupo?"
--
--      expectations  → resposta aberta (texto)
--        "O que você espera encontrar na plataforma? E o que te faria usar a
--         nossa plataforma?"
--
-- 2) user_onboarding_interests.kind passa a aceitar 'share' e 'join'.
--    Antes só existiam 'current' (usa hoje) e 'interested' (tem interesse),
--    que vinham do questionário antigo. No fluxo novo são:
--
--        'share' → serviços que a pessoa quer CRIAR um grupo
--        'join'  → serviços que a pessoa quer ENTRAR em um grupo
--
--    Os valores antigos continuam aceitos, para não quebrar dado já gravado.
--
-- 3) Permissões de leitura/escrita conferidas: o app grava com o token do
--    próprio usuário e o painel admin lê. Sem isso a coluna nova simplesmente
--    não volta na query (ou o insert falha).
--
-- TUDO IDEMPOTENTE: pode rodar quantas vezes quiser, sem erro.
--
-- COMO RODAR
-- -----------
-- 1) Abra o SQL Editor do Supabase (projeto do DividePass)
-- 2) Cole o conteúdo INTEIRO deste arquivo e clique em "Run"
-- 3) No fim aparecem duas linhas de conferência:
--      "colunas novas: OK" e "kind aceita share e join: OK"
--    Se aparecer "ERRO", rode de novo: o script é idempotente e o erro some.
--
-- DEPOIS DE RODAR
-- ---------------
-- O app novo (com o questionário curto) só funciona depois deste script:
-- sem as colunas, o onboarding quebra ao gravar a resposta.
--
-- O app NÃO trava enquanto este script não foi aplicado: ele salva o que o
-- banco aceita (a barreira e os convidados) e só perde as respostas novas.
--
-- CACHE DO POSTGREST
-- ------------------
-- O PostgREST guarda o formato das tabelas em cache. Depois do ALTER TABLE,
-- o cache é recarregado sozinho em poucos segundos — mas se o app ainda
-- responder "Could not find the 'group_intent' column ... in the schema
-- cache", é só esperar 1 minuto e recarregar a página do app.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) COLUNAS NOVOIS
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.user_onboarding_profiles
  ADD COLUMN IF NOT EXISTS group_intent text;

ALTER TABLE public.user_onboarding_profiles
  ADD COLUMN IF NOT EXISTS expectations text;

COMMENT ON COLUMN public.user_onboarding_profiles.group_intent IS
  'Intencao no onboarding: ''entrar'' | ''criar'' | ''ambos''';

COMMENT ON COLUMN public.user_onboarding_profiles.expectations IS
  'Resposta aberta: o que a pessoa espera encontrar na plataforma e o que a faria usar';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) 'kind' ACEITA OS VALORES NOVOS
--
-- O CHECK original foi criado pelo próprio Postgres com nome automático
-- (user_onboarding_interests_kind_check). Em vez de depender desse nome, o
-- laço abaixo derruba QUALQUER CHECK que fale em "kind" — assim o script
-- funciona mesmo que a constraint tenha sido renomeada.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_onboarding_interests'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_onboarding_interests DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.user_onboarding_interests
  ADD CONSTRAINT user_onboarding_interests_kind_check
  CHECK (kind IN ('current', 'interested', 'share', 'join'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PERMISSÕES
--
-- O app usa o token do próprio usuário para gravar e o painel admin (com
-- role admin) para ler. A RLS das tabelas continua valendo — estas permissões
-- só garantem que as COLUNAS novas voltem na query.
--
-- O GRANT é guardado: em produção os papéis `anon` e `authenticated` sempre
-- existem, mas um banco de teste local não os tem, e um GRANT para um papel
-- inexistente quebra a transação inteira.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
      IF papel = 'authenticated' THEN
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.user_onboarding_profiles TO authenticated';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.user_onboarding_interests TO authenticated';
      ELSE
        EXECUTE 'GRANT SELECT ON public.user_onboarding_profiles TO anon';
        EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.user_onboarding_interests TO anon';
      END IF;
    END IF;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) ÍNDICE DO NOVO FILTRO
--
-- O painel admin agrupa as respostas por group_intent. Com poucas dezenas de
-- linhas não é necessário, mas o índice deixa a consulta pronta para quando
-- o volume crescer.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_group_intent
  ON public.user_onboarding_profiles (group_intent);

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CONFERÊNCIA — leia as duas linhas depois de rodar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'user_onboarding_profiles'
       AND column_name IN ('group_intent', 'expectations')) = 2
    AS "colunas novas: OK",

  EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.user_onboarding_interests'::regclass
       AND contype = 'c'
       AND pg_get_constraintdef(oid) ILIKE '%share%'
       AND pg_get_constraintdef(oid) ILIKE '%join%'
  ) AS "kind aceita share e join: OK",

  (SELECT count(*) FROM public.user_onboarding_profiles) AS "respostas gravadas ate agora";
