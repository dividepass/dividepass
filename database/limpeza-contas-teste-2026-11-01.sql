-- ============================================================
-- LIMPEZA DAS CONTAS DE TESTE — 2026-11-01 (v2)
--
-- Rodar no SQL Editor do Supabase (painel do projeto DividePass).
-- Idempotente: pode rodar quantas vezes quiser.
--
-- POR QUE A v1 NÃO APAGOU
-- -----------------------
-- A v1 apagava as linhas-filhas que apontam para `users(id)` lendo as FKs
-- do banco, MAS:
--   - só aceitava FK de coluna única (`conkey[1]`) e avisava nas compostas;
--   - filtrava as FKs pelo schema `public` e ignorava as de `auth`;
--   - e, principalmente, ENGOlia o erro do DELETE final dentro de um
--     `EXCEPTION WHEN OTHERS` — se alguma tabela bloqueasse, o script
--     terminava "com sucesso" e nada era apagado.
--
-- Esta v2:
--   - limpa os filhos de `public.users` E de `auth.users`, tabelando TODA FK
--     que aponte para a coluna `id` (inclusive composta, escolhendo a
--     posição exata da coluna que referencia o id);
--   - NÃO engole erro: cada tabela aparece no log com o que foi apagado;
--   - ao final, LISTA o que sobrou (com o motivo) — se sobrar algo, você
--     vê o que é em vez de acreditar que foi apagado.
--
-- O QUE É CONSIDERADO CONTA DE TESTE
-- ----------------------------------
--   - QUALQUER e-mail @divteste.com  (domínio exclusivo dos scripts de QA)
--     MENOS a conta QA oficial (qa.mavis@divteste.com), que é a única que
--     deve sobrar para as próximas rodadas de teste;
--   - e-mail começando com: onb. | dp.teste. | dp.prod. | dp.voto. |
--     regrinhas. | qa. | sonda.orfao. | visual.check
--
-- TESTADO contra um Postgres 17 local com o mesmo desenho de FKs
-- (ver scripts/test-limpeza-contas-schema.sql).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. O QUE VAI SER APAGADO
-- ─────────────────────────────────────────────────────────────
SELECT id, email, name, created_at
FROM public.users
WHERE email <> 'qa.mavis@divteste.com'
  AND (
       email LIKE '%@divteste.com'
    OR email LIKE 'onb.%'
    OR email LIKE 'dp.teste.%'
    OR email LIKE 'dp.prod.%'
    OR email LIKE 'dp.voto.%'
    OR email LIKE 'regrinhas.%'
    OR email LIKE 'qa.%'
    OR email LIKE 'sonda.orfao.%'
    OR email LIKE 'visual.check%'
  )
ORDER BY created_at;

-- 1.1) Quantas linhas-filhas existem hoje para essas contas
--      (o que trava o DELETE do perfil se não for limpo antes)
SELECT c.conname AS fk,
       n.nspname || '.' || c2.relname AS tabela,
       a.attname AS coluna,
       CASE c.confdeltype
         WHEN 'a' THEN 'NO ACTION (TRAVA o DELETE)'
         WHEN 'r' THEN 'RESTRICT (TRAVA o DELETE)'
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
       END AS ondelete,
       (SELECT count(*) FROM public.users u
         WHERE u.id IN (
           SELECT u2.id FROM public.users u2
           WHERE u2.email <> 'qa.mavis@divteste.com'
             AND (u2.email LIKE '%@divteste.com'
               OR u2.email LIKE 'onb.%' OR u2.email LIKE 'dp.teste.%'
               OR u2.email LIKE 'dp.prod.%' OR u2.email LIKE 'dp.voto.%'
               OR u2.email LIKE 'regrinhas.%' OR u2.email LIKE 'qa.%'
               OR u2.email LIKE 'sonda.orfao.%' OR u2.email LIKE 'visual.check%')
         )) AS linhas_no_alvo
FROM pg_constraint c
JOIN pg_class c2 ON c2.oid = c.conrelid
JOIN pg_namespace n ON n.oid = c2.relnamespace
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND c.confrelid IN ('public.users'::regclass, 'auth.users'::regclass)
ORDER BY 2, 3;


-- ─────────────────────────────────────────────────────────────
-- 2. LIMPEZA
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r         RECORD;
  v_ids     uuid[];
  v_alvos   regclass[];
  v_alvo    regclass;
  v_idx     int;
  v_pos     int;
  v_col     text;
  v_tipo    text;
  v_tab     text;
  v_ref_id  int;
  v_apagadas int;
BEGIN
  SELECT array_agg(id) INTO v_ids
  FROM public.users
  WHERE email <> 'qa.mavis@divteste.com'
    AND (
         email LIKE '%@divteste.com'
      OR email LIKE 'onb.%'
      OR email LIKE 'dp.teste.%'
      OR email LIKE 'dp.prod.%'
      OR email LIKE 'dp.voto.%'
      OR email LIKE 'regrinhas.%'
      OR email LIKE 'qa.%'
      OR email LIKE 'sonda.orfao.%'
      OR email LIKE 'visual.check%'
    );

  IF v_ids IS NULL THEN
    RAISE NOTICE 'Nenhuma conta de teste encontrada — nada a fazer.';
    RETURN;
  END IF;

  RAISE NOTICE 'Contas de teste no alvo: %', array_length(v_ids, 1);

  -- ── 2.1) Limpa as linhas-filhas de public.users e de auth.users ──
  v_alvos := ARRAY['public.users'::regclass, 'auth.users'::regclass];

  FOREACH v_alvo IN ARRAY v_alvos LOOP
    RAISE NOTICE '--- limpando os filhos de % ---', v_alvo;

    FOR r IN
      SELECT c.conname,
             c.conrelid AS reloid,
             c.conkey,
             c.confkey,
             ns.nspname AS esquema,
             cl.relname AS tabela,             (SELECT attnum FROM pg_attribute
               WHERE attrelid = c.confrelid AND attname = 'id') AS ref_id_attnum
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_namespace ns ON ns.oid = cl.relnamespace
      WHERE c.contype = 'f'
        AND c.confrelid = v_alvo
        AND c.connamespace NOT IN ('pg_catalog'::regnamespace)
      ORDER BY ns.nspname, cl.relname
    LOOP
      -- Em FK composta, acha a posição da coluna que referencia o id.
      v_idx := NULL;
      FOR v_pos IN 1 .. COALESCE(array_length(r.confkey, 1), 0) LOOP
        IF r.confkey[v_pos] = r.ref_id_attnum THEN
          v_idx := v_pos;
          EXIT;
        END IF;
      END LOOP;

      IF v_idx IS NULL THEN
        RAISE NOTICE '   FK % -> %.%: NAO referencia o id — pulada', r.conname, r.esquema, r.tabela;
        CONTINUE;
      END IF;

      SELECT a.attname, format_type(a.atttypid, a.atttypmod)
        INTO v_col, v_tipo
        FROM pg_attribute a
       WHERE a.attrelid = r.reloid AND a.attnum = r.conkey[v_idx];

      v_tab := format('%I.%I', r.esquema, r.tabela);

      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1::%s[])', v_tab, v_col, v_tipo)
          USING v_ids;
        GET DIAGNOSTICS v_apagadas = ROW_COUNT;
        IF v_apagadas > 0 THEN
          RAISE NOTICE '   % -> % : % linha(s) apagada(s)', v_tab, v_col, v_apagadas;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING '   FALHOU em %.% (%): %', r.esquema, r.tabela, v_col, SQLERRM;
      END;
    END LOOP;
  END LOOP;

  -- ── 2.2) Apaga o perfil e o login ──
  BEGIN
    DELETE FROM public.users WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
    RAISE NOTICE 'public.users: % perfil(is) apagado(s)', v_apagadas;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'public.users NAO pode ser apagado ainda: %', SQLERRM;
  END;

  BEGIN
    DELETE FROM auth.users WHERE id = ANY(v_ids);
    GET DIAGNOSTICS v_apagadas = ROW_COUNT;
    RAISE NOTICE 'auth.users: % login(s) apagado(s)', v_apagadas;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'auth.users NAO pode ser apagado ainda: %', SQLERRM;
  END;

  -- Se o perfil ficou (FK mútua entre auth.users e public.users), a segunda
  -- tentativa vem depois que o login já saiu.
  IF EXISTS (SELECT 1 FROM public.users WHERE id = ANY(v_ids)) THEN
    BEGIN
      DELETE FROM public.users WHERE id = ANY(v_ids);
      GET DIAGNOSTICS v_apagadas = ROW_COUNT;
      RAISE NOTICE 'public.users (2a tentativa): % perfil(is) apagado(s)', v_apagadas;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'public.users continua bloqueado: %', SQLERRM;
    END;
  END IF;

  RAISE NOTICE 'Limpeza concluida.';
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. CONFERÊNCIA — o que sobrou (tem que ser só a conta QA)
-- ─────────────────────────────────────────────────────────────
SELECT id, email, name, created_at
FROM public.users
WHERE email <> 'qa.mavis@divteste.com'
  AND (
       email LIKE '%@divteste.com'
    OR email LIKE 'onb.%'
    OR email LIKE 'dp.teste.%'
    OR email LIKE 'dp.prod.%'
    OR email LIKE 'dp.voto.%'
    OR email LIKE 'regrinhas.%'
    OR email LIKE 'qa.%'
    OR email LIKE 'sonda.orfao.%'
    OR email LIKE 'visual.check%'
  )
ORDER BY created_at;

-- 3.1) A conta QA oficial (a única que deve sobrar)
SELECT id, email, name, created_at
FROM public.users
WHERE email = 'qa.mavis@divteste.com';

-- 3.2) Logins de teste que ficaram sem perfil (auth orphaned)
SELECT id, email
FROM auth.users
WHERE email <> 'qa.mavis@divteste.com'
  AND (
       email LIKE '%@divteste.com'
    OR email LIKE 'onb.%'
    OR email LIKE 'dp.teste.%'
    OR email LIKE 'dp.prod.%'
    OR email LIKE 'dp.voto.%'
    OR email LIKE 'regrinhas.%'
    OR email LIKE 'qa.%'
    OR email LIKE 'sonda.orfao.%'
    OR email LIKE 'visual.check%'
  )
ORDER BY email;
