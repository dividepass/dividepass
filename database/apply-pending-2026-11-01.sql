-- ============================================================
-- PENDENTE DE APLICAÇÃO — 2026-11-01
--
-- Roda no SQL Editor do Supabase (painel do projeto DividePass).
-- É idempotente: pode colar e rodar mais de uma vez sem quebrar.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------
-- A feature "Ofertas patrocinadas" já está no ar (tabela `sponsored_offers`,
-- migration de 30/10/2026). Mas as MÉTRICAS dela estavam mortas:
--
--   - O `PATCH` que somava o clique vinha do navegador do usuário comum.
--     A policy de escrita da tabela só libera o ADMIN, então o RLS
--     engolia a escrita: PostgREST devolvia `200 []` (sucesso falso) e
--     o contador ficava eternamente em 0. O parceiro pagava por um
--     destaque que não rendia nada mensurável.
--   - `impressions` nunca era escrito por ninguém.
--
-- A correção é uma RPC SECURITY DEFINER: soma dentro do banco, burla o
-- RLS de propósito (é a única escrita pública na tabela) e só conta
-- oferta ATIVA e dentro do período.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. ID CURTO DA OFERTA (8 caracteres, letras e números)
-- ─────────────────────────────────────────────────────────────
-- A tabela nasceu com `id UUID` (36 caracteres). O projeto usa código curto
-- no resto (código de grupo, slug), então a oferta passa a ter um id de 8
-- caracteres — o mesmo que o admin lê no painel.
--
-- A conversão é direta (e não um IF sobre information_schema) de propósito:
-- dentro de um bloco DO, o `information_schema` devolve o tipo ANTIGO (o
-- plano da view fica cacheado com o snapshot de quando foi compilado) e o
-- guard mentia. Converter text em text não tem efeito — rodar de novo é
-- seguro.
ALTER TABLE public.sponsored_offers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.sponsored_offers ALTER COLUMN id TYPE TEXT USING id::text;

-- Id novo: 8 caracteres de letra e número (md5 do random → 0-9a-f).
ALTER TABLE public.sponsored_offers
  ALTER COLUMN id SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8);

-- ─────────────────────────────────────────────────────────────
-- 2. RPC que soma a métrica
-- ─────────────────────────────────────────────────────────────
-- A versão antiga (p_offer_id UUID) é removida: com as duas funções de mesmo
-- nome o PostgREST não sabe qual chamar.
DROP FUNCTION IF EXISTS public.increment_sponsor_metric(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.increment_sponsor_metric(
    p_offer_id TEXT,
    p_metric   TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new INTEGER;
BEGIN
    IF p_metric = 'click' THEN
        UPDATE public.sponsored_offers
           SET clicks = clicks + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING clicks INTO v_new;

    ELSIF p_metric = 'impression' THEN
        UPDATE public.sponsored_offers
           SET impressions = impressions + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING impressions INTO v_new;

    ELSE
        RAISE EXCEPTION 'métrica inválida: %', p_metric;
    END IF;

    -- Oferta fora do período / pausada: devolve 0 em vez de erro.
    RETURN COALESCE(v_new, 0);
END;
$$;

COMMENT ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) IS
    'Soma 1 em clicks/impressions de uma oferta patrocinada ativa. SECURITY DEFINER: é a única escrita pública na tabela.';

-- ─────────────────────────────────────────────────────────────
-- 2. Permissões
--    - anon: sem acesso (ninguém anônimo conta clique)
--    - authenticated: pode contar (é quem vê o anúncio)
--    - service_role: pode contar (jobs / painel)
-- ─────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 3. Grants na tabela (o front só LÊ a oferta; a escrita é pela RPC)
-- ─────────────────────────────────────────────────────────────
-- Anúncio pausado ou vencido precisa continuar legível pelo admin,
-- então o SELECT para o admin já existe via policy — nada a mexer aqui.

-- ─────────────────────────────────────────────────────────────
-- 4. LIMPEZA DOS PERFIS ÓRFÃOS DAS CONTAS DE TESTE
--
-- O `delete-account` implantado em produção devolve 200 e apaga o auth, mas
-- o `DELETE FROM public.users` FALHA por violação de FK: `platform_events.
-- created_by` aponta para `users(id)` SEM ON DELETE CASCADE, e todo login
-- pela tela grava um evento de plataforma. Resultado: o auth some, o perfil
-- fica — e aparece na lista de usuários do admin como uma conta real.
--
-- Verificado em 01/11/2026: 4 perfis `dp.prod.*` órfãos (3 de rodadas
-- anteriores, 1 do smoke test do dia).
--
-- A rotina é DINÂMICA de propósito: ela lê as FKs REAIS do banco. O schema
-- de produção não é igual ao dos .sql do repo (ex.: `wallet_transactions`
-- liga em users por `user_id`, não por `wallet_id`/`processed_by`).
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r     RECORD;
  ids   uuid[];
  v_lim int;
BEGIN
  SELECT array_agg(id) INTO ids
  FROM public.users
  WHERE email LIKE 'dp.prod.%@dividepass.com'
     OR email LIKE 'dp.cheque.%@dividepass.com'
     OR email LIKE 'dp.teste.%@dividepass.com'
     OR email LIKE 'dp.visual.%@dividepass.com'
     OR email LIKE 'qa.%@example.com';

  IF ids IS NULL THEN
    RAISE NOTICE 'Nenhum perfil orfao de conta de teste — nada a fazer.';
    RETURN;
  END IF;

  v_lim := array_length(ids, 1);
  RAISE NOTICE 'Perfis orfaos encontrados: %', v_lim;

  -- Para cada FK que aponta para public.users(id):
  --   NO ACTION / RESTRICT -> apaga as linhas filhas (elas travam o DELETE)
  --   CASCADE / SET NULL     -> o proprio banco resolve, nao mexe
  FOR r IN
    SELECT c.conname,
           c.conrelid::regclass::text AS tabela,
           (SELECT attname FROM pg_attribute a
             WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS coluna,
           c.confdeltype
    FROM pg_constraint c
    WHERE c.contype = 'f'
      AND c.confrelid = 'public.users'::regclass
      AND c.connamespace = 'public'::regnamespace
  LOOP
    RAISE NOTICE 'FK % -> % . % (ondelete=%)', r.conname, r.tabela, r.coluna, r.confdeltype;

    IF r.confdeltype IN ('a', 'r') THEN
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tabela, r.coluna) USING ids;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Nao consegui limpar % . %: %', r.tabela, r.coluna, SQLERRM;
      END;
    END IF;
  END LOOP;

  BEGIN
    DELETE FROM auth.users WHERE id = ANY(ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Nao consegui limpar auth.users: %', SQLERRM;
  END;

  BEGIN
    DELETE FROM public.users WHERE id = ANY(ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Nao consegui limpar public.users: %', SQLERRM;
  END;

  RAISE NOTICE 'Limpeza concluida.';
END $$;

-- Confere: tem que voltar VAZIO
SELECT id, email, created_at
FROM public.users
WHERE email LIKE 'dp.%@dividepass.com' OR email LIKE 'qa.%@example.com';
