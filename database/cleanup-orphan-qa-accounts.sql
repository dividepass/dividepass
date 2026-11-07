-- ============================================================
-- Limpa as contas de teste do fluxo de avatar (@example.com)
-- e as contas descartáveis dos E2E deste projeto
-- ============================================================
-- Rodar no SQL Editor do Supabase. Idempotente: pode rodar quantas vezes quiser.
--
-- CONTEXTO
-- As contas de teste do gate de avatar foram apagadas pela edge function
-- `delete-account`, mas o `DELETE FROM public.users` falhou por violação de
-- FK: `platform_events.created_by` aponta para `users(id)` SEM ON DELETE
-- CASCADE, e todo login grava um evento de plataforma. O auth sumia, o
-- perfil ficava (órfão).
--
-- Os E2E deste projeto (`.tmp-verify/qa-regrinhas*.mjs`) criam contas
-- descartáveis em `@divteste.com` e as apagam pela edge function — mas a
-- edge em produção é a versão ANTIGA (sem limpar `platform_events`), então
-- sobram perfis órfãos e grupos "draft" das rodadas. Esta rotina limpa
-- tudo de uma vez.
--
-- Esta rotina é dinâmica de propósito: ela olha as FKs REAIS do banco. O
-- schema de produção não é igual ao dos arquivos .sql do repo — por exemplo
-- `custom_charges.created_by` e `wallet_transactions.processed_by` NÃO
-- existem lá (e `wallet_transactions` liga em users por `user_id`).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 0. DIAGNÓSTICO: quais FKs apontam para public.users(id)?
--    (confdeltype: a=NO ACTION, r=RESTRICT, c=CASCADE, n=SET NULL)
-- ─────────────────────────────────────────────────────────────
SELECT
  c.conname AS fk,
  c.conrelid::regclass::text AS tabela,
  (SELECT attname FROM pg_attribute a
    WHERE a.attrelid = c.conrelid AND a.attnum = c.conkey[1]) AS coluna,
  c.confdeltype AS ondelete,
  CASE c.confdeltype
    WHEN 'a' THEN 'NO ACTION (trava o DELETE)'
    WHEN 'r' THEN 'RESTRICT (trava o DELETE)'
    WHEN 'c' THEN 'CASCADE (apaga junto)'
    WHEN 'n' THEN 'SET NULL (zera)'
  END AS efeito
FROM pg_constraint c
WHERE c.contype = 'f'
  AND c.confrelid = 'public.users'::regclass
  AND c.connamespace = 'public'::regnamespace
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────
-- 1. LIMPEZA
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  r       RECORD;
  ids     uuid[];
  v_lim   int;
BEGIN
  SELECT array_agg(id) INTO ids
  FROM public.users
  WHERE email LIKE 'qa.%@example.com'
     OR email LIKE 'regrinhas.%@divteste.com'      -- E2E das regrinhas
     OR email LIKE 'sonda.orfao.%@divteste.com'    -- sonda de limpeza
     OR email LIKE 'limpeza-regrinhas-%@divteste.com'
     OR email LIKE 'diag-regrinhas-%@divteste.com'
     -- QA dos scripts de verificação do catálogo (rodada do avatar no card)
     OR email LIKE 'probe.avatar%@t.com'
     OR email LIKE 'probe.cols%@t.com'
     OR email LIKE 'qa.catalogo%@t.com'
     OR email LIKE 'qa.rodape%@t.com'
     OR email LIKE 'qa.close%@t.com'
     OR email LIKE 'qa.geo%@t.com'
     OR email LIKE 'qa.clip%@t.com'
     OR email LIKE 'dup.%@t.com'
     OR email LIKE 'cleanup%@t.com'
     OR email LIKE 'del.%@t.com'
     OR email LIKE 'list.%@t.com';

  IF ids IS NULL THEN
    RAISE NOTICE 'Nenhuma conta de teste encontrada — nada a fazer.';
    RETURN;
  END IF;

  v_lim := array_length(ids, 1);
  RAISE NOTICE 'Contas de teste encontradas: %', v_lim;

  -- Para cada FK que aponta para public.users(id):
  --   NO ACTION / RESTRICT -> apaga as linhas filhas (elas travam o DELETE)
  --   CASCADE / SET NULL     -> o próprio banco resolve, não mexe
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

  -- Auth (alguns logins ainda podem existir; se houver FK com cascade entre
  -- auth.users e public.users, o perfil cai junto)
  BEGIN
    DELETE FROM auth.users WHERE id = ANY(ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Nao consegui limpar auth.users: %', SQLERRM;
  END;

  -- Perfil
  BEGIN
    DELETE FROM public.users WHERE id = ANY(ids);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Nao consegui limpar public.users: %', SQLERRM;
  END;

  RAISE NOTICE 'Limpeza concluida.';
END $$;

-- Confere: tem que voltar VAZIO
SELECT id, email, avatar_url FROM public.users
WHERE email LIKE 'qa.%@example.com'
   OR email LIKE 'regrinhas.%@divteste.com'
   OR email LIKE 'sonda.orfao.%@divteste.com'
   OR email LIKE 'limpeza-regrinhas-%@divteste.com'
   OR email LIKE 'diag-regrinhas-%@divteste.com'
   OR email LIKE 'probe.avatar%@t.com'
   OR email LIKE 'probe.cols%@t.com'
   OR email LIKE 'qa.catalogo%@t.com'
   OR email LIKE 'qa.rodape%@t.com'
   OR email LIKE 'qa.close%@t.com'
   OR email LIKE 'qa.geo%@t.com'
   OR email LIKE 'qa.clip%@t.com'
   OR email LIKE 'dup.%@t.com'
   OR email LIKE 'cleanup%@t.com'
   OR email LIKE 'del.%@t.com'
   OR email LIKE 'list.%@t.com';
