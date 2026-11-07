-- =============================================================================
-- DividePass — asserts de comportamento da correção de exclusão de grupo
-- =============================================================================
-- Roda DEPOIS de:
--   1) scripts/test-fix-admin-delete-group-schema.sql  (schema no estado de
--      produção: payments.group_id com FK NO ACTION)
--   2) database/fix-admin-delete-group-2026-11-06.sql  (a migration)
--
-- O que precisa ser verdade depois da migration:
--   A1  — payments.group_id tem ON DELETE SET NULL (a FK que barrava)
--   A2  — user_subscriptions.group_id continua CASCADE (coluna NOT NULL)
--   A3  — public.group_has_paid_payments() existe, é SECURITY DEFINER e a
--         policy de DELETE do dono comum tem a trava
--   A4  — admin apaga grupo COM pagamento confirmado
--   A5  — o pagamento continua no banco, com group_id NULL (o dinheiro não some)
--   A6  — os filhos do grupo somem junto (membro, assinatura, credencial)
--   A7  — admin apaga pelo users.role (sem app_metadata no JWT)
--   A8  — dono comum NÃO apaga grupo com pagamento confirmado
--   A9  — dono comum apaga grupo SEM pagamento confirmado
--   A10 — dono comum NÃO apaga grupo de outra pessoa
--   A11 — o helper distingue pago de pendente
--
-- Imprime PASS/FAIL. Sai com codigo != 0 se houver falha.
-- =============================================================================

\set ON_ERROR_STOP on

\pset pager off

-- ---------------------------------------------------------------------------
-- Helpers de assert
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE IF NOT EXISTS assert_results (id text, passed boolean);
TRUNCATE assert_results;

-- SECURITY DEFINER: a tabela de resultados e TEMP do superusuario e o teste
-- roda com SET ROLE authenticated, que nao tem privilegio nela.
CREATE OR REPLACE FUNCTION pg_temp.report(p_id text, p_passed boolean, p_msg text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO assert_results VALUES (p_id, p_passed);
  IF p_passed THEN
    RAISE NOTICE 'PASS  %  %', p_id, p_msg;
  ELSE
    RAISE NOTICE 'FAIL  %  %  %', p_id, p_msg, p_detail;
  END IF;
END $$;

-- ===========================================================================
-- ESTRUTURA (superusuario)
-- ===========================================================================
DO $$
DECLARE
  v_del  text;
  v_qual text;
  v_n    integer;
BEGIN
  -- A1: payments.group_id -> SET NULL
  SELECT CASE c.confdeltype WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE'
                            WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END
    INTO v_del
    FROM pg_constraint c
    JOIN pg_class cl  ON cl.oid = c.conrelid
    JOIN pg_class par ON par.oid = c.confrelid
   WHERE c.contype = 'f'
     AND cl.relname = 'payments'
     AND par.relname = 'groups'
     AND c.conname = 'payments_group_id_fkey';

  PERFORM pg_temp.report('A1', v_del = 'SET NULL',
    'payments_group_id_fkey = ON DELETE SET NULL',
    'veio ' || coalesce(v_del, 'constraint ausente'));

  -- A2: user_subscriptions.group_id continua CASCADE (coluna NOT NULL)
  SELECT CASE c.confdeltype WHEN 'n' THEN 'SET NULL' WHEN 'c' THEN 'CASCADE'
                            WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT' END
    INTO v_del
    FROM pg_constraint c
    JOIN pg_class cl  ON cl.oid = c.conrelid
    JOIN pg_class par ON par.oid = c.confrelid
   WHERE c.contype = 'f'
     AND cl.relname = 'user_subscriptions'
     AND par.relname = 'groups';

  PERFORM pg_temp.report('A2', v_del = 'CASCADE',
    'user_subscriptions.group_id = ON DELETE CASCADE (coluna NOT NULL)',
    'veio ' || coalesce(v_del, 'constraint ausente'));

  -- A3a: a função existe e é SECURITY DEFINER
  SELECT count(*) INTO v_n
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname = 'group_has_paid_payments'
     AND p.prosecdef;

  PERFORM pg_temp.report('A3a', v_n = 1,
    'public.group_has_paid_payments() existe e é SECURITY DEFINER',
    'funcoes encontradas: ' || v_n::text);

  -- A3b: a policy de DELETE do dono comum tem a trava do pagamento
  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'groups'
     AND policyname = 'Users delete own groups';

  PERFORM pg_temp.report('A3b', v_qual LIKE '%group_has_paid_payments%',
    'policy de DELETE do dono tem a trava de pagamento',
    'qual = ' || coalesce(v_qual, 'policy ausente'));

  -- A3c: a policy do admin existe e não tem a trava (admin não é barrado)
  SELECT qual INTO v_qual
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'groups'
     AND policyname = 'Admins gerenciam grupos';

  PERFORM pg_temp.report('A3c', v_qual IS NOT NULL AND v_qual NOT LIKE '%group_has_paid_payments%',
    'policy do admin existe e não tem a trava de pagamento',
    'qual = ' || coalesce(v_qual, 'policy ausente'));
END $$;

-- ===========================================================================
-- COMPORTAMENTO — ADMIN (app_metadata.role = admin)
-- ===========================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claims', '{"app_metadata":{"role":"admin"}}', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

-- A4: admin apaga grupo com pagamento confirmado
DELETE FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM pg_temp.report('A4', v_n = 0,
    'admin apaga grupo com pagamento confirmado',
    'grupo ainda existe');
END $$;

RESET ROLE;

-- A5: o pagamento continua registrado, com group_id NULL
DO $$
DECLARE v_group uuid; v_n integer;
BEGIN
  SELECT group_id INTO v_group FROM public.payments WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_n FROM public.payments WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  PERFORM pg_temp.report('A5', v_n = 1 AND v_group IS NULL,
    'pagamento continua no banco com group_id NULL',
    'linhas = ' || v_n::text || ', group_id = ' || coalesce(v_group::text, 'null'));
END $$;

-- A6: os filhos do grupo somem junto (CASCADE)
DO $$
DECLARE v_m integer; v_s integer; v_c integer;
BEGIN
  SELECT count(*) INTO v_m FROM public.group_members  WHERE group_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_s FROM public.user_subscriptions WHERE group_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  SELECT count(*) INTO v_c FROM public.group_credentials WHERE group_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  PERFORM pg_temp.report('A6', v_m = 0 AND v_s = 0 AND v_c = 0,
    'membro, assinatura e credencial apagados junto com o grupo',
    'sobrou: membros=' || v_m::text || ', assinaturas=' || v_s::text || ', credenciais=' || v_c::text);
END $$;

-- A7: admin reconhecido pelo users.role (sem app_metadata no JWT)
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"app_metadata":{}}', false);
SELECT set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

DELETE FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005';

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000005';
  PERFORM pg_temp.report('A7', v_n = 0,
    'admin pelo users.role (sem app_metadata) apaga o grupo',
    'grupo ainda existe');
END $$;

RESET ROLE;

-- ===========================================================================
-- COMPORTAMENTO — DONO COMUM (usuário, não admin)
-- ===========================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"app_metadata":{}}', false);
SELECT set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);

-- A8: dono NÃO apaga grupo com pagamento confirmado (a regra vale para ele)
DELETE FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004';

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000004';
  PERFORM pg_temp.report('A8', v_n = 1,
    'dono comum NÃO apaga grupo com pagamento confirmado',
    'grupo foi apagado (nao devia)');
END $$;

-- A9: dono apaga grupo SEM pagamento confirmado
DELETE FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000002';
  PERFORM pg_temp.report('A9', v_n = 0,
    'dono comum apaga grupo sem pagamento confirmado',
    'grupo ainda existe');
END $$;

-- A10: dono NÃO apaga grupo de outra pessoa
DELETE FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';

DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.groups WHERE id = 'aaaaaaaa-0000-0000-0000-000000000003';
  PERFORM pg_temp.report('A10', v_n = 1,
    'dono comum NÃO apaga grupo de outra pessoa',
    'grupo foi apagado (nao devia)');
END $$;

RESET ROLE;

-- A11: o helper distingue pago de pendente
DO $$
DECLARE v_pg1 boolean; v_pg2 boolean;
BEGIN
  SELECT public.group_has_paid_payments('aaaaaaaa-0000-0000-0000-000000000004') INTO v_pg1;
  SELECT public.group_has_paid_payments('aaaaaaaa-0000-0000-0000-000000000003') INTO v_pg2;
  PERFORM pg_temp.report('A11', v_pg1 = true AND v_pg2 = false,
    'helper: grupo com pagamento = true, grupo só com pendente = false',
    'veio ' || coalesce(v_pg1::text, 'null') || ' / ' || coalesce(v_pg2::text, 'null'));
END $$;

-- ===========================================================================
-- PLacar
-- ===========================================================================
DO $$
DECLARE
  v_total  integer;
  v_falhas integer;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT passed) INTO v_total, v_falhas FROM assert_results;
  IF v_falhas = 0 THEN
    RAISE NOTICE 'RESULTADO % assert(s) — todos passaram.', v_total;
  ELSE
    RAISE NOTICE 'RESULTADO % assert(s) — % FALHA(S).', v_total, v_falhas;
  END IF;
  IF v_falhas > 0 THEN
    RAISE EXCEPTION 'Falhou: % de % asserts.', v_falhas, v_total;
  END IF;
END $$;
