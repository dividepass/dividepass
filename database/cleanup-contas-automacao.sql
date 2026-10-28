-- ############################################################################
-- # VERSAO v3 - 2026-10-27 18:45 (DividePass / lasoouwboxspstqvjbsv)
-- #
-- # 1) NAO usa split_part e NAO usa 'item text[]'.
-- # 2) Define claims de admin na transacao (SET LOCAL request.jwt.claims),
-- #    senao o trigger guard_group_privileged_fields barra groups.owner_id.
-- # 3) Se voce esta lendo esta linha, e a versao certa.
-- #    No editor do Supabase: clique no codigo, Ctrl+A, Ctrl+V, Run.
-- ############################################################################
-- ============================================================================
-- LIMPEZA DAS CONTAS CRIADAS POR AUTOMAÇÃO (scripts/agentes de teste da IA)
-- Gerado a partir de logs/usuarios-producao.csv (auditoria de 2026-10-27).
--
-- Total de contas no alvo: 42
-- Escopo: as 10 famílias listadas (tags.check, wizard.e2e, visual.check,
-- teste.email.code, nocol, wizard.probe, test/dbg/dash@t.com,
-- rendercheck/fadecheck@divteste, shot, hunt*@maxxspace.com).
-- Fora do escopo (não apagados): gwmorata+N@gmail.com, rodox85, leo1leonardo123.
--
-- IMPORTANTE: rode a parte 1 (conferência) e confira o resultado antes da parte 2.
-- Nenhuma conta listada tem vínculo visível com grupo, pagamento ou wallet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) CONFERÊNCIA (somente leitura)
-- ---------------------------------------------------------------------------
SELECT email, name, created_at, status
  FROM public.users
 WHERE email IN (
    'hunt37b23d9b79@maxxspace.com',
    'wizard.e2e.1793066604521@gmail.com',
    'wizard.e2e.1793067555996@gmail.com',
    'test1787710833373@t.com',
    'dbg1787706566184@t.com',
    'dash1787710281134@t.com',
    'test1787710511966@t.com',
    'test1787710771841@t.com',
    'hunt37adminbypass@maxxspace.com',
    'teste.email.code.1792987308872@gmail.com',
    'teste.email.code.1792987368275@gmail.com',
    'teste.email.code.1792987452368@gmail.com',
    'huntadmee653e495d@maxxspace.com',
    'teste.email.code.1792987540010@gmail.com',
    'fadecheck-1792947617021@divteste.com',
    'visual.check.1793076466670@gmail.com',
    'visual.check.1792989372173@gmail.com',
    'teste.email.code.1792987620277@gmail.com',
    'visual.check.1792989431926@gmail.com',
    'visual.check.1793077879660@gmail.com',
    'visual.check.1793078187345@gmail.com',
    'wizard.probe.1793061758555@gmail.com',
    'rendercheck-1792947505626@divteste.com',
    'wizard.probe.1793061745045@gmail.com',
    'wizard.e2e.1793062736075@gmail.com',
    'wizard.e2e.1793066313952@gmail.com',
    'wizard.e2e.1793062568932@gmail.com',
    'wizard.e2e.1793062924565@gmail.com',
    'wizard.e2e.1793066118807@gmail.com',
    'wizard.e2e.1793066404890@gmail.com',
    'tags.check.1793113258211@gmail.com',
    'tags.check.1793113572455@gmail.com',
    'tags.check.1793113666254@gmail.com',
    'tags.check.1793113772856@gmail.com',
    'tags.check.1793113834100@gmail.com',
    'nocol.1793114261317@gmail.com',
    'tags.check.1793114359726@gmail.com',
    'nocol.1793114479059@gmail.com',
    'tags.check.1793115219239@gmail.com',
    'tags.check.1793115331455@gmail.com',
    'nocol.1793115407356@gmail.com',
    'shot.1793115782883@gmail.com'
  )
 ORDER BY created_at;

-- Quantas linhas de public.users ficariam (antes = total da tabela):
SELECT (SELECT count(*) FROM public.users) AS antes,
       (SELECT count(*) FROM public.users WHERE email IN (
         'hunt37b23d9b79@maxxspace.com',
         'wizard.e2e.1793066604521@gmail.com',
         'wizard.e2e.1793067555996@gmail.com',
         'test1787710833373@t.com',
         'dbg1787706566184@t.com',
         'dash1787710281134@t.com',
         'test1787710511966@t.com',
         'test1787710771841@t.com',
         'hunt37adminbypass@maxxspace.com',
         'teste.email.code.1792987308872@gmail.com',
         'teste.email.code.1792987368275@gmail.com',
         'teste.email.code.1792987452368@gmail.com',
         'huntadmee653e495d@maxxspace.com',
         'teste.email.code.1792987540010@gmail.com',
         'fadecheck-1792947617021@divteste.com',
         'visual.check.1793076466670@gmail.com',
         'visual.check.1792989372173@gmail.com',
         'teste.email.code.1792987620277@gmail.com',
         'visual.check.1792989431926@gmail.com',
         'visual.check.1793077879660@gmail.com',
         'visual.check.1793078187345@gmail.com',
         'wizard.probe.1793061758555@gmail.com',
         'rendercheck-1792947505626@divteste.com',
         'wizard.probe.1793061745045@gmail.com',
         'wizard.e2e.1793062736075@gmail.com',
         'wizard.e2e.1793066313952@gmail.com',
         'wizard.e2e.1793062568932@gmail.com',
         'wizard.e2e.1793062924565@gmail.com',
         'wizard.e2e.1793066118807@gmail.com',
         'wizard.e2e.1793066404890@gmail.com',
         'tags.check.1793113258211@gmail.com',
         'tags.check.1793113572455@gmail.com',
         'tags.check.1793113666254@gmail.com',
         'tags.check.1793113772856@gmail.com',
         'tags.check.1793113834100@gmail.com',
         'nocol.1793114261317@gmail.com',
         'tags.check.1793114359726@gmail.com',
         'nocol.1793114479059@gmail.com',
         'tags.check.1793115219239@gmail.com',
         'tags.check.1793115331455@gmail.com',
         'nocol.1793115407356@gmail.com',
         'shot.1793115782883@gmail.com'
       )) AS a_remover;

-- ---------------------------------------------------------------------------
-- 2) LIMPEZA (mesma ordem da edge function delete-account)
-- ---------------------------------------------------------------------------
BEGIN;

-- 1.9) SESSION DE ADMIN
--      is_admin() le o JWT (app_metadata.role=admin OU public.users.role=admin do
--      auth.uid()). No SQL Editor nao ha JWT, entao o trigger
--      guard_group_privileged_fields barra mexer em groups.owner_id.
--      Estas claims simulam a sessao de admin (so valem dentro desta transacao).
SET LOCAL request.jwt.claims = '{"role":"service_role","app_metadata":{"role":"admin"}}';

-- 2.1) Monta a lista de IDs alvo
CREATE TEMP TABLE _limpeza_ids AS
  SELECT id FROM public.users WHERE email IN (
    'hunt37b23d9b79@maxxspace.com',
    'wizard.e2e.1793066604521@gmail.com',
    'wizard.e2e.1793067555996@gmail.com',
    'test1787710833373@t.com',
    'dbg1787706566184@t.com',
    'dash1787710281134@t.com',
    'test1787710511966@t.com',
    'test1787710771841@t.com',
    'hunt37adminbypass@maxxspace.com',
    'teste.email.code.1792987308872@gmail.com',
    'teste.email.code.1792987368275@gmail.com',
    'teste.email.code.1792987452368@gmail.com',
    'huntadmee653e495d@maxxspace.com',
    'teste.email.code.1792987540010@gmail.com',
    'fadecheck-1792947617021@divteste.com',
    'visual.check.1793076466670@gmail.com',
    'visual.check.1792989372173@gmail.com',
    'teste.email.code.1792987620277@gmail.com',
    'visual.check.1792989431926@gmail.com',
    'visual.check.1793077879660@gmail.com',
    'visual.check.1793078187345@gmail.com',
    'wizard.probe.1793061758555@gmail.com',
    'rendercheck-1792947505626@divteste.com',
    'wizard.probe.1793061745045@gmail.com',
    'wizard.e2e.1793062736075@gmail.com',
    'wizard.e2e.1793066313952@gmail.com',
    'wizard.e2e.1793062568932@gmail.com',
    'wizard.e2e.1793062924565@gmail.com',
    'wizard.e2e.1793066118807@gmail.com',
    'wizard.e2e.1793066404890@gmail.com',
    'tags.check.1793113258211@gmail.com',
    'tags.check.1793113572455@gmail.com',
    'tags.check.1793113666254@gmail.com',
    'tags.check.1793113772856@gmail.com',
    'tags.check.1793113834100@gmail.com',
    'nocol.1793114261317@gmail.com',
    'tags.check.1793114359726@gmail.com',
    'nocol.1793114479059@gmail.com',
    'tags.check.1793115219239@gmail.com',
    'tags.check.1793115331455@gmail.com',
    'nocol.1793115407356@gmail.com',
    'shot.1793115782883@gmail.com'
  );

-- 2.2) Dependências
--      Tabelas com ON DELETE CASCADE/SET NULL são resolvidas pelo próprio FK.
--      As com NO ACTION/RESTRICT bloqueiam a exclusão — são limpas aqui,
--      discovers dinamicamente (foi o que travou a conta 'dash*').
DO $$
DECLARE r record; n integer;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.users'::regclass
       AND c.confdeltype IN ('a','r')
       AND array_length(c.conkey, 1) = 1
  LOOP
    BEGIN
      EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', r.tbl, r.col)
        USING ARRAY(SELECT id FROM _limpeza_ids);
      GET DIAGNOSTICS n = ROW_COUNT;
      RAISE NOTICE 'limpo % -> % linha(s)', r.tbl, n;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'falhou ao limpar %: %', r.tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2.2.1) Tabelas conhecidas — DELETE condicional (ignora tabela ausente)
--      Dois arrays paralelos: sem split_part, sem parse de texto.
DO $$
DECLARE
  tbls text[] := ARRAY[
    'public.group_members',
    'public.user_subscriptions',
    'public.payments',
    'public.invoices',
    'public.password_resets',
    'public.notifications',
    'public.wallet_transactions',
    'public.user_wallets',
    'public.activity_logs',
    'public.email_logs',
    'public.payment_attempts',
    'public.push_subscriptions',
    'public.group_interest',
    'public.group_messages',
    'public.announcement_reads',
    'public.support_tickets',
    'public.user_feedback',
    'public.user_card_metadata',
    'public.campaign_rewards',
    'public.user_referral_codes',
    'public.referrals',
    'public.referrals',
    'public.wallet_withdrawals',
    'public.wallet_withdrawals',
    'public.group_applications',
    'public.group_applications',
    'public.custom_charges',
    'public.custom_charge_logs',
    'public.platform_events',
    'public.service_plans',
    'public.group_credentials',
    'public.group_profiles',
    'public.billing_cycles',
    'public.credentials'
  ];
  cols text[] := ARRAY[
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'user_id',
    'referrer_id',
    'invitee_id',
    'user_id',
    'processed_by',
    'user_id',
    'reviewed_by',
    'created_by',
    'admin_id',
    'created_by',
    'created_by',
    'assigned_to',
    'assigned_to',
    'created_by',
    'assigned_to'
  ];
  i integer; tbl text; col text; n integer; cnt integer;
BEGIN
  FOR i IN 1..coalesce(array_length(tbls, 1), 0) LOOP
    tbl := tbls[i];
    col := cols[i];
    IF to_regclass(tbl) IS NOT NULL THEN
      BEGIN
        EXECUTE format('DELETE FROM %s WHERE %I = ANY($1)', tbl, col)
          USING ARRAY(SELECT id FROM _limpeza_ids);
        GET DIAGNOSTICS n = ROW_COUNT;
        IF n > 0 THEN RAISE NOTICE 'limpo % -> % linha(s)', tbl, n; END IF;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'falhou ao limpar %: %', tbl, SQLERRM;
      END;
    ELSE
      RAISE NOTICE 'tabela ausente (ignorada): %', tbl;
    END IF;
  END LOOP;
  -- owner_id / target_user_id usam ON DELETE SET NULL; garantimos por seguranca
  IF to_regclass('public.groups') IS NOT NULL THEN
    BEGIN
      UPDATE public.groups SET owner_id = NULL WHERE owner_id IN (SELECT id FROM _limpeza_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'nao consegui liberar groups.owner_id: %', SQLERRM;
    END;
    EXECUTE 'SELECT count(*) FROM public.groups WHERE owner_id = ANY($1)' INTO cnt
      USING ARRAY(SELECT id FROM _limpeza_ids);
    IF cnt > 0 THEN
      RAISE WARNING 'ainda % grupo(s) com owner_id de uma conta do alvo', cnt;
    ELSE
      RAISE NOTICE 'groups.owner_id: nenhum grupo preso as contas do alvo';
    END IF;
  END IF;
  IF to_regclass('public.announcements') IS NOT NULL THEN
    BEGIN
      UPDATE public.announcements SET target_user_id = NULL WHERE target_user_id IN (SELECT id FROM _limpeza_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'nao consegui liberar announcements.target_user_id: %', SQLERRM;
    END;
  END IF;
END $$;

-- 2.2.2) Diagnóstico: alguma FK sem CASCADE ainda segura as contas?
DO $$
DECLARE r record; cnt integer;
BEGIN
  FOR r IN
    SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
      FROM pg_constraint c
      JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON true
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.users'::regclass
       AND c.confdeltype IN ('a','r')
       AND array_length(c.conkey, 1) = 1
  LOOP
    BEGIN
      EXECUTE format('SELECT count(*) FROM %s WHERE %I = ANY($1)', r.tbl, r.col)
        INTO cnt USING ARRAY(SELECT id FROM _limpeza_ids);
      IF cnt > 0 THEN
        RAISE WARNING 'AINDA BLOQUEADO: %.% -> % linha(s)', r.tbl, r.col, cnt;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'nao consegui checar %: %', r.tbl, SQLERRM;
    END;
  END LOOP;
END $$;

-- 2.3) Perfil (public.users). O trigger de auth-sync recria a linha se a
--       conta auth ainda existir, então apague o auth logo em seguida.
DELETE FROM public.users WHERE id IN (SELECT id FROM _limpeza_ids);

-- 2.4) Autenticação (auth.users). Precisa de service_role / SQL do dashboard.
--       No SQL Editor do Supabase isso roda como postgres, então funciona.
DELETE FROM auth.users WHERE id IN (SELECT id FROM _limpeza_ids);

DROP TABLE _limpeza_ids;

COMMIT;

-- ---------------------------------------------------------------------------
-- 3) CONFERÊNCIA FINAL
-- ---------------------------------------------------------------------------
SELECT count(*) AS restantes_no_escopo
  FROM public.users
 WHERE email IN (
    'hunt37b23d9b79@maxxspace.com',
    'wizard.e2e.1793066604521@gmail.com',
    'wizard.e2e.1793067555996@gmail.com',
    'test1787710833373@t.com',
    'dbg1787706566184@t.com',
    'dash1787710281134@t.com',
    'test1787710511966@t.com',
    'test1787710771841@t.com',
    'hunt37adminbypass@maxxspace.com',
    'teste.email.code.1792987308872@gmail.com',
    'teste.email.code.1792987368275@gmail.com',
    'teste.email.code.1792987452368@gmail.com',
    'huntadmee653e495d@maxxspace.com',
    'teste.email.code.1792987540010@gmail.com',
    'fadecheck-1792947617021@divteste.com',
    'visual.check.1793076466670@gmail.com',
    'visual.check.1792989372173@gmail.com',
    'teste.email.code.1792987620277@gmail.com',
    'visual.check.1792989431926@gmail.com',
    'visual.check.1793077879660@gmail.com',
    'visual.check.1793078187345@gmail.com',
    'wizard.probe.1793061758555@gmail.com',
    'rendercheck-1792947505626@divteste.com',
    'wizard.probe.1793061745045@gmail.com',
    'wizard.e2e.1793062736075@gmail.com',
    'wizard.e2e.1793066313952@gmail.com',
    'wizard.e2e.1793062568932@gmail.com',
    'wizard.e2e.1793062924565@gmail.com',
    'wizard.e2e.1793066118807@gmail.com',
    'wizard.e2e.1793066404890@gmail.com',
    'tags.check.1793113258211@gmail.com',
    'tags.check.1793113572455@gmail.com',
    'tags.check.1793113666254@gmail.com',
    'tags.check.1793113772856@gmail.com',
    'tags.check.1793113834100@gmail.com',
    'nocol.1793114261317@gmail.com',
    'tags.check.1793114359726@gmail.com',
    'nocol.1793114479059@gmail.com',
    'tags.check.1793115219239@gmail.com',
    'tags.check.1793115331455@gmail.com',
    'nocol.1793115407356@gmail.com',
    'shot.1793115782883@gmail.com'
  );

-- Checagem ampla (informativa): sobrou alguma conta com nome = e-mail?
SELECT count(*) AS restantes_nome_igual_email
  FROM public.users
 WHERE name = email;

-- ---------------------------------------------------------------------------
-- 4) FORA DO ESCOPO (não apagadas — revisar depois)
-- ---------------------------------------------------------------------------
-- rodox85@yahoo.com.br  |  nome="Bruno Luiz da Silva"  |  criado em 2026-10-13T14:35:03.131272+00:00
-- gwmorata+1@gmail.com  |  nome="Gabriel"  |  criado em 2026-10-10T19:47:35.424681+00:00
-- gwmorata+2@gmail.com  |  nome="gabriel"  |  criado em 2026-10-11T23:42:41.17079+00:00
-- leo1leonardo123@gmail.com  |  nome="Leonardo Ramon"  |  criado em 2026-10-27T02:22:57.406897+00:00
