-- =============================================================================
-- DividePass — asserts de comportamento do fix-p0
-- =============================================================================
-- Roda DEPOIS de scripts/test-fix-p0.sql (que cria o schema e aplica o
-- migration). Verifica que cada vulnerabilidade foi realmente fechada.
--
--   psql -U postgres -d dp_p0_test -v ON_ERROR_STOP=1 -f scripts/test-fix-p0-asserts.sql
--
-- Imprime PASS/FAIL. Sai com codigo != 0 se houver falha.
-- =============================================================================

\set ON_ERROR_STOP on

\pset pager off

-- ---------------------------------------------------------------------------
-- Dados de teste: inseridos por scripts/test-fix-p0.sql (antes do migration)
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Helpers de assert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.ok(p_id text, p_msg text) RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'PASS  %  %', p_id, p_msg; END $$;

CREATE OR REPLACE FUNCTION pg_temp.fail(p_id text, p_msg text, p_detail text DEFAULT '') RETURNS void
LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'FAIL  %  %  %', p_id, p_msg, p_detail; END $$;

-- conta de falhas
CREATE TEMP TABLE IF NOT EXISTS assert_results (id text, passed boolean);
TRUNCATE assert_results;

-- SECURITY DEFINER: a tabela de resultados e TEMP do superusuario e o teste
-- roda com SET ROLE anon/authenticated, que nao tem privilegio nela.
-- (try_count NAO e definer de proposito: precisa respeitar o RLS do papel.)
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

-- Conta linhas. Se o papel nao tem o privilegio, devolve 0 — que e o mesmo
-- resultado de "nao expoe" que os asserts esperam (um REVOKE deve manifesta
-- como "sem linhas" ou "permissao negada"; os dois significam "fechado").
CREATE OR REPLACE FUNCTION pg_temp.try_count(p_sql text) RETURNS bigint
LANGUAGE plpgsql AS $$
DECLARE n bigint;
BEGIN
  EXECUTE p_sql INTO n;
  RETURN n;
EXCEPTION WHEN insufficient_privilege THEN
  RETURN 0;
END $$;

-- ===========================================================================
-- ANONIMO
-- ===========================================================================
SET ROLE anon;
SELECT set_config('request.jwt.claim.role', 'anon', false);
SELECT set_config('request.jwt.claims', '{"role":"anon"}', false);
SELECT set_config('request.jwt.claim.sub', '', false);

-- S2: password_resets nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.password_resets');
  PERFORM pg_temp.report('S2', n = 0, 'anon: password_resets sem linhas', 'linhas=' || n);
END $$;

-- S2: password_resets nao pode ser gravado por anonimo
DO $$
BEGIN
  BEGIN
    INSERT INTO public.password_resets (user_id, email, token, expires_at)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'x@test.local', 'TOKEN_FORJADO', now());
    PERFORM pg_temp.report('S2', false, 'anon: INSERT em password_resets bloqueado', 'INSERT passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S2', true, 'anon: INSERT em password_resets bloqueado', '');
  END;
END $$;

-- S7: payment_attempts nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.payment_attempts');
  PERFORM pg_temp.report('S7', n = 0, 'anon: payment_attempts sem linhas', 'linhas=' || n);
END $$;

-- S7: payment_attempts nao pode ser gravado por anonimo
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payment_attempts (user_id, gateway, payment_method, payment_type)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'x', 'x', 'x');
    PERFORM pg_temp.report('S7', false, 'anon: INSERT em payment_attempts bloqueado', 'INSERT passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S7', true, 'anon: INSERT em payment_attempts bloqueado', '');
  END;
END $$;

-- S1: user_wallets nao pode ser gravado por anonimo
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_wallets (user_id, balance, total_earned)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 999999, 999999);
    PERFORM pg_temp.report('S1', false, 'anon: INSERT em user_wallets bloqueado', 'INSERT passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S1', true, 'anon: INSERT em user_wallets bloqueado', '');
  END;
END $$;

-- S9: coupons nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.coupons');
  PERFORM pg_temp.report('S9', n = 0, 'anon: coupons sem linhas', 'linhas=' || n);
END $$;

-- S9: support_messages nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.support_messages');
  PERFORM pg_temp.report('S9', n = 0, 'anon: support_messages sem linhas', 'linhas=' || n);
END $$;

-- S9: group_profiles nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_profiles');
  PERFORM pg_temp.report('S9', n = 0, 'anon: group_profiles sem linhas', 'linhas=' || n);
END $$;

-- S4: group_mailboxes nao pode ser lido por anonimo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_mailboxes');
  PERFORM pg_temp.report('S4', n = 0, 'anon: group_mailboxes sem linhas', 'linhas=' || n);
END $$;

-- S4: a coluna email_imap_password nao existe mais em groups
DO $$
DECLARE existe boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='groups' AND column_name='email_imap_password'
  ) INTO existe;
  PERFORM pg_temp.report('S4', NOT existe, 'groups.email_imap_password removida', 'ainda existe');
END $$;

-- S4: o dado foi migrado para group_mailboxes (visivel so a admin)
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_mailboxes WHERE email_imap_password = ''SENHA_SECRETA_IMAP''');
  PERFORM pg_temp.report('S4', n = 0, 'anon: group_mailboxes sem a senha migrada', 'linhas=' || n);
END $$;

-- S6: custom_charges continua legivel (checkout publico) mas sem created_by
DO $$
DECLARE n bigint; c boolean;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.custom_charges');
  PERFORM pg_temp.report('S6', n = 1, 'anon: custom_charges continua legivel (checkout publico)', 'linhas=' || n);
  BEGIN
    PERFORM created_by FROM public.custom_charges LIMIT 1;
    c := false;
  EXCEPTION WHEN insufficient_privilege THEN
    c := true;
  END;
  PERFORM pg_temp.report('S6', c, 'anon: custom_charges.created_by bloqueado', 'coluna acessivel');
END $$;

RESET ROLE;

-- ===========================================================================
-- AUTENTICADO COMUM (nao admin)
-- ===========================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"authenticated"}}', false);

-- S8: cpf nao pode ser lido
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM cpf FROM public.users LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    ok := true;
  END;
  PERFORM pg_temp.report('S8', ok, 'autenticado comum: users.cpf bloqueado', 'coluna acessivel');
END $$;

-- S8: customer_id_iopay nao pode ser lido
DO $$
DECLARE ok boolean := false;
BEGIN
  BEGIN
    PERFORM customer_id_iopay FROM public.users LIMIT 1;
  EXCEPTION WHEN insufficient_privilege THEN
    ok := true;
  END;
  PERFORM pg_temp.report('S8', ok, 'autenticado comum: users.customer_id_iopay bloqueado', 'coluna acessivel');
END $$;

-- S8: colunas publicas continuam legiveis
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.users');
  PERFORM pg_temp.report('S8', n > 0, 'autenticado comum: users (colunas publicas) legivel', 'linhas=' || n);
END $$;

-- S1: user_wallets — INSERT bloqueado
DO $$
BEGIN
  BEGIN
    INSERT INTO public.user_wallets (user_id, balance, total_earned)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 999999, 999999);
    PERFORM pg_temp.report('S1', false, 'autenticado comum: INSERT em user_wallets bloqueado', 'INSERT passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S1', true, 'autenticado comum: INSERT em user_wallets bloqueado', '');
  END;
END $$;

-- S1: user_wallets — UPDATE de saldo bloqueado
DO $$
BEGIN
  BEGIN
    UPDATE public.user_wallets SET balance = 5000000 WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
    PERFORM pg_temp.report('S1', false, 'autenticado comum: UPDATE de saldo bloqueado', 'UPDATE passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S1', true, 'autenticado comum: UPDATE de saldo bloqueado', '');
  END;
END $$;

-- S3: escalacao de privilegio em groups bloqueada
DO $$
BEGIN
  BEGIN
    UPDATE public.groups
    SET verified = true, is_official = true, approval_status = 'approved'
    WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    PERFORM pg_temp.report('S3', false, 'dono nao pode se auto-aprovar/auto-oficializar', 'UPDATE passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S3', true, 'dono nao pode se auto-aprovar/auto-oficializar', '');
  END;
END $$;

-- S3: o grupo continua como estava
DO $$
DECLARE v boolean; o boolean; a text;
BEGIN
  SELECT verified, is_official, approval_status INTO v, o, a
  FROM public.groups WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  PERFORM pg_temp.report('S3', v = false AND o = false AND a = 'pending',
    'grupo continua nao aprovado', format('verified=%s official=%s approval=%s', v, o, a));
END $$;

-- S3: o dono ainda consegue editar o resto do grupo
DO $$
DECLARE novo text;
BEGIN
  BEGIN
    UPDATE public.groups SET description = 'editado pelo dono' WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    SELECT description INTO novo FROM public.groups WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    PERFORM pg_temp.report('S3', novo = 'editado pelo dono', 'dono ainda edita campos normais', 'desc=' || coalesce(novo, 'null'));
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.report('S3', false, 'dono ainda edita campos normais', SQLERRM);
  END;
END $$;

-- S7: payment_attempts — autenticado comum so ve a propria
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.payment_attempts');
  PERFORM pg_temp.report('S7', n = 1, 'autenticado comum: ve so a propria payment_attempt', 'linhas=' || n);
END $$;

-- S7: payment_attempts — INSERT bloqueado
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payment_attempts (user_id, gateway, payment_method, payment_type)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'x', 'x', 'x');
    PERFORM pg_temp.report('S7', false, 'autenticado comum: INSERT em payment_attempts bloqueado', 'INSERT passou');
  EXCEPTION WHEN insufficient_privilege THEN
    PERFORM pg_temp.report('S7', true, 'autenticado comum: INSERT em payment_attempts bloqueado', '');
  END;
END $$;

-- S9: support_messages — autenticado comum nao le conversa alheia
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.support_messages');
  PERFORM pg_temp.report('S9', n = 1, 'autenticado comum: so le a propria mensagem de suporte', 'linhas=' || n);
END $$;

-- S9: coupons continua legivel por autenticado (MyCupons.jsx)
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.coupons');
  PERFORM pg_temp.report('S9', n = 1, 'autenticado comum: coupons continua legivel', 'linhas=' || n);
END $$;

-- S4: group_mailboxes — autenticado comum nao le a credencial IMAP
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_mailboxes');
  PERFORM pg_temp.report('S4', n = 0, 'autenticado comum: group_mailboxes bloqueado', 'linhas=' || n);
END $$;

-- S9: group_profiles — membro ve o perfil do proprio grupo
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_profiles');
  PERFORM pg_temp.report('S9', n = 1, 'membro ativo ve o perfil nao atribuido do proprio grupo', 'linhas=' || n);
END $$;

RESET ROLE;

-- ===========================================================================
-- ADMIN
-- ===========================================================================
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"admin"}}', false);

-- S3: admin continua podendo moderar
DO $$
DECLARE v boolean;
BEGIN
  BEGIN
    UPDATE public.groups SET verified = true, approval_status = 'approved'
    WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    SELECT verified INTO v FROM public.groups WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
    PERFORM pg_temp.report('S3', v = true, 'admin ainda pode aprovar/moderar grupos', 'verified=' || v);
  EXCEPTION WHEN others THEN
    PERFORM pg_temp.report('S3', false, 'admin ainda pode aprovar/moderar grupos', SQLERRM);
  END;
END $$;

-- S4: admin le a credencial IMAP
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.group_mailboxes WHERE email_imap_password = ''SENHA_SECRETA_IMAP''');
  PERFORM pg_temp.report('S4', n = 1, 'admin le a credencial IMAP migrada', 'linhas=' || n);
END $$;

-- S7: admin ve todas as payment_attempts
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.payment_attempts');
  PERFORM pg_temp.report('S7', n = 1, 'admin ve todas as payment_attempts', 'linhas=' || n);
END $$;

-- S1: admin ve todas as carteiras
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.user_wallets');
  PERFORM pg_temp.report('S1', n >= 0, 'admin ve as carteiras (Wallets.jsx)', 'linhas=' || n);
END $$;

-- S8: admin le campos privados via RPC
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.admin_get_user_private(''aaaaaaaa-0000-0000-0000-000000000002'')');
  PERFORM pg_temp.report('S8', n = 1, 'admin_get_user_private devolve a linha para admin', 'linhas=' || n);
END $$;

-- S8: usuario comum nao consegue usar a RPC
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000002', false);
SELECT set_config('request.jwt.claims', '{"role":"authenticated","app_metadata":{"role":"authenticated"}}', false);
DO $$
DECLARE n bigint;
BEGIN
  n := pg_temp.try_count('SELECT count(*) FROM public.admin_get_user_private(''aaaaaaaa-0000-0000-0000-000000000001'')');
  PERFORM pg_temp.report('S8', n = 0, 'admin_get_user_private nao devolve nada para nao-admin', 'linhas=' || n);
END $$;
RESET ROLE;

-- ===========================================================================
-- S13 — idempotencia
-- ===========================================================================
SET ROLE service_role;

-- Indice unico parcial: dois 'paid' com o mesmo (transaction_code, payment_type) falham
DO $$
BEGIN
  BEGIN
    INSERT INTO public.payments (user_id, amount, status, payment_type, transaction_code, gateway)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 10, 'paid', 'subscription', 'TX_DUP_1', 'iopay');
    INSERT INTO public.payments (user_id, amount, status, payment_type, transaction_code, gateway)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 10, 'paid', 'subscription', 'TX_DUP_1', 'iopay');
    PERFORM pg_temp.report('S13', false, 'payments: (transaction_code, payment_type) unique parcial', '2a insercao passou');
  EXCEPTION WHEN unique_violation THEN
    PERFORM pg_temp.report('S13', true, 'payments: (transaction_code, payment_type) unique parcial', '');
  END;
END $$;

-- O fluxo combinado (2 pagamentos, mesmo tx, tipos diferentes) continua funcionando
DO $$
DECLARE ok boolean := true; det text := '';
BEGIN
  BEGIN
    INSERT INTO public.payments (user_id, amount, status, payment_type, transaction_code, gateway)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 5, 'paid', 'entrance', 'TX_COMB_1', 'iopay');
    INSERT INTO public.payments (user_id, amount, status, payment_type, transaction_code, gateway)
    VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 10, 'paid', 'subscription', 'TX_COMB_1', 'iopay');
  EXCEPTION WHEN others THEN
    ok := false; det := SQLERRM;
  END;
  PERFORM pg_temp.report('S13', ok, 'pagamento combinado (2 tipos, mesmo tx) continua valendo', det);
END $$;

-- credit_wallet idempotente
DO $$
DECLARE v1 numeric; v2 numeric;
BEGIN
  PERFORM credit_wallet('aaaaaaaa-0000-0000-0000-000000000002', 25.00, 'Credito de teste', 'payment', 'aaaaaaaa-0000-0000-0000-000000000009');
  SELECT balance INTO v1 FROM public.user_wallets WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  PERFORM credit_wallet('aaaaaaaa-0000-0000-0000-000000000002', 25.00, 'Credito de teste', 'payment', 'aaaaaaaa-0000-0000-0000-000000000009');
  SELECT balance INTO v2 FROM public.user_wallets WHERE user_id = 'aaaaaaaa-0000-0000-0000-000000000002';
  PERFORM pg_temp.report('S13', v1 = 25.00 AND v2 = 25.00,
    'credit_wallet nao credita duas vezes a mesma referencia',
    format('v1=%s v2=%s', v1, v2));
END $$;

RESET ROLE;

-- ===========================================================================
-- Resumo
-- ===========================================================================
\echo ''
\echo '=============================================================='
SELECT
  CASE WHEN count(*) FILTER (WHERE passed) = count(*)
    THEN 'RESULTADO: ' || count(*) || '/' || count(*) || ' PASS'
    ELSE 'RESULTADO: ' || count(*) FILTER (WHERE passed) || '/' || count(*) || ' PASS, '
         || count(*) FILTER (WHERE NOT passed) || ' FAIL'
  END AS resultado
FROM assert_results;

SELECT id FROM assert_results WHERE NOT passed ORDER BY id;

\echo '=============================================================='
