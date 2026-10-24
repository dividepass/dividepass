-- =============================================================================
-- DividePass — P0 Security Fix
-- =============================================================================
-- Correcoes para as vulnerabilidades CONFIRMADAS em producao
-- (projeto lasoouwboxspstqvjbsv) durante o estudo de 2026-10-23.
--
-- Como aplicar: SQL Editor do Supabase (ou psql). O script e IDEMPOTENTE:
-- pode rodar varias vezes sem efeito colateral.
--
-- INDICE
--   S1  user_wallets      -> saldo fabricavel por qualquer autenticado
--   S2  password_resets   -> tokens de reset lidos/gravados por anonimo
--   S3  groups            -> dono se auto-aprova / vira oficial
--   S4  groups.email_imap_* -> senha IMAP dos e-mails dos grupos exposta
--   S6  custom_charges    -> gateway_transaction_id exposto
--   S7  payment_attempts  -> leitura/escrita anonima
--   S8  users             -> cpf / ids de gateway / dados de marketing expostos
--   S9  coupons, group_profiles, support_messages, platform_events
--   S13 idempotencia     -> replay de webhook duplica pagamento e wallet
--
-- O QUE ESTE SCRIPT NAO FAZ (e por que):
--   - Nao mexe em tabelas que ja estao corretas (group_credentials tem
--     correcao, master_accounts/verification_pins/payments/user_subscriptions
--     continuam intactos).
--   - Nao usa REVOKE de coluna em `groups`: 8 telas fazem select('*') e isso
--     quebraria o app. A correcao da senha IMAP e por tabela nova.
--   - Nao roda DDL destrutivo sem copia previa dos dados.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 0. FUNCAO CANONICA is_admin()
-- =============================================================================
-- existem 3 definicoes divergentes no repo (users.role / app_metadata.role /
-- JWT). Esta unifica as duas que importam, como SECURITY DEFINER para
-- conseguir ler public.users sem recursao de RLS.
--
-- SECURITY DEFINER + SET search_path = public -> evita search_path hijacking.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
    OR COALESCE(
         (
           SELECT u.role = 'admin'
           FROM public.users u
           WHERE u.id = auth.uid()
         ),
         false
       );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

COMMENT ON FUNCTION public.is_admin() IS
  'Unica definicao de admin do projeto. Verdadeiro se o JWT tiver app_metadata.role=admin OU se public.users.role=admin.';


-- =============================================================================
-- 1. S2 — password_resets: leitura e escrita anonimas
-- =============================================================================
-- Origem do bug: database/add-password-resets.sql:16-19 cria
--   CREATE POLICY ... FOR ALL USING (true) WITH CHECK (true);
-- SEM a clausula TO service_role. Em Postgres, policy sem TO vale para
-- PUBLIC -> anon e authenticated ganham acesso total a tabela.
-- =============================================================================
REVOKE ALL ON TABLE public.password_resets FROM anon, authenticated;

DROP POLICY IF EXISTS "Service role can manage password resets" ON public.password_resets;

CREATE POLICY "Service role can manage password resets"
  ON public.password_resets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMENT ON TABLE public.password_resets IS
  'Tokens de reset de senha. Somente service_role. Nunca expor a anon/authenticated.';


-- =============================================================================
-- 2. S7 — payment_attempts: leitura e escrita anonimas
-- =============================================================================
-- Origem do bug: NEW_PROJECT_FULL_SETUP.sql:1208 (mesmo padrao sem TO).
--
-- ATENCAO: o painel admin (PlatformEvents.jsx) le payment_attempts com
-- select('*') usando o JWT do admin. Por isso o SELECT continua para
-- `authenticated`, mas limitado a propria tentativa + admin. A ESCRITA fica
-- so com service_role.
-- =============================================================================
REVOKE ALL ON TABLE public.payment_attempts FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.payment_attempts FROM authenticated;

DROP POLICY IF EXISTS "Users can view own payment attempts" ON public.payment_attempts;
DROP POLICY IF EXISTS "Service role can manage payment attempts" ON public.payment_attempts;

CREATE POLICY "Users view own payment attempts"
  ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins view all payment attempts"
  ON public.payment_attempts
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can manage payment attempts"
  ON public.payment_attempts
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- 3. S1 — user_wallets: saldo fabricavel
-- =============================================================================
-- Origem do bug: supabase/migrations/20260724000000_add_wallet_insert_policies.sql
--   INSERT ... WITH CHECK (true) / UPDATE ... USING (true)  (sem TO service_role)
-- Qualquer autenticado criava carteira com balance=999999.
--
-- O SELECT precisa continuar: o usuario ve o proprio saldo (Wallet.jsx:48).
-- A escrita e exclusiva do service_role (credit_wallet / edge functions).
-- =============================================================================
REVOKE INSERT, UPDATE, DELETE ON TABLE public.user_wallets FROM anon, authenticated;

DROP POLICY IF EXISTS "Users can insert their own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can update their own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Users can view their own wallet" ON public.user_wallets;
DROP POLICY IF EXISTS "Service role can manage wallets" ON public.user_wallets;

CREATE POLICY "Users view own wallet"
  ON public.user_wallets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- O painel admin (Wallets.jsx) lista as carteiras de todos os usuarios.
CREATE POLICY "Admins view all wallets"
  ON public.user_wallets
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Service role can manage wallets"
  ON public.user_wallets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);


-- =============================================================================
-- 4. S3 — groups: dono se auto-aprova, vira oficial e burla a moderacao
-- =============================================================================
-- Origem do bug: NEW_PROJECT_FULL_SETUP.sql:1128
--   CREATE POLICY "Users update own groups" ON groups FOR UPDATE
--     USING (auth.uid() = owner_id);
-- Sem WITH CHECK, o USING e reusado como WITH CHECK implicito -> restringe
-- apenas owner_id. O dono CONSEGUIA alterar verified / is_official /
-- approval_status livremente (confirmado em producao).
--
-- A correcao usa TRIGGER em vez de REVOKE de coluna, porque:
--   - o painel admin (GroupForm.jsx) grava `groups` direto do browser com o
--     JWT do admin e precisa de `verified` / `owner_id`;
--   - um REVOKE de coluna quebraria o select('*') de 8 telas.
-- O trigger bloqueia o campo privilegiado para quem nao e admin e deixa
-- passar o admin. O dono continua editando o resto do grupo normalmente.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_group_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.verified         := COALESCE(NEW.verified, false);
    NEW.is_official      := COALESCE(NEW.is_official, false);
    NEW.approval_status  := COALESCE(NEW.approval_status, 'pending');
    NEW.reviewed_by      := NULL;
    NEW.approved_at      := NULL;
    NEW.rejection_reason := NULL;
    RETURN NEW;
  END IF;

  IF NEW.verified IS DISTINCT FROM OLD.verified
     OR NEW.is_official IS DISTINCT FROM OLD.is_official
     OR NEW.approval_status IS DISTINCT FROM OLD.approval_status
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
     OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
     OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
  THEN
    RAISE EXCEPTION
      'Campo de moderacao (verified, is_official, approval_status, owner_id) so pode ser alterado por admin'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_group_privileged_fields() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_group_privileged_fields() TO authenticated, service_role;

DROP TRIGGER IF EXISTS trg_guard_group_privileged ON public.groups;
CREATE TRIGGER trg_guard_group_privileged
  BEFORE INSERT OR UPDATE ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_group_privileged_fields();

-- O painel admin (GroupForm.jsx) grava `groups` direto do browser com o JWT
-- do admin. Sem esta policy, o admin so consegue editar grupos onde e o dono
-- — ou seja, a moderacao inteira fica sem efeito.
DROP POLICY IF EXISTS "Admins gerenciam grupos" ON public.groups;
CREATE POLICY "Admins gerenciam grupos"
  ON public.groups
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- =============================================================================
-- 5. S4 — groups.email_imap_*: senha da caixa IMAP dos grupos exposta
-- =============================================================================
-- A policy "Grupos publicos" (SELECT USING (true)) expunha TODAS as colunas
-- de TODOS os grupos para anonimo, incluindo a senha IMAP do e-mail
-- institucional (mail.dividepass.com) — o canal por onde passa o codigo de
-- verificacao de posse da assinatura. Vazamento = tomada de conta da
-- assinatura compartilhada.
--
-- RLS filtra LINHAS, nao COLUNAS. E um REVOKE de coluna em `groups` quebraria
-- o select('*') de 8 telas. Solucao: mover a configuracao de e-mail para uma
-- tabela propria, com RLS por admin, e manter em `groups` apenas o booleano
-- que o membro precisa ver ("este grupo usa verificacao por e-mail").
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.group_mailboxes (
  group_id               uuid PRIMARY KEY REFERENCES public.groups(id) ON DELETE CASCADE,
  email_address          text,
  verification_email     text,
  email_imap_server      text,
  email_imap_port        integer DEFAULT 993,
  email_imap_user        text,
  email_imap_password    text,
  email_allowed_senders  text[],
  email_blocked_subjects text[],
  email_code_patterns    text[],
  email_body_keywords    text[],
  email_subject_includes text[],
  email_ai_enabled       boolean NOT NULL DEFAULT false,
  created_at             timestamptz DEFAULT now(),
  updated_at             timestamptz DEFAULT now()
);

COMMENT ON TABLE public.group_mailboxes IS
  'Configuracao de e-mail/IMAP por grupo. Contem credencial -> visivel apenas a admin e service_role.';

ALTER TABLE public.group_mailboxes ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.group_mailboxes FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.group_mailboxes TO authenticated;

DROP POLICY IF EXISTS "Admins manage group mailboxes" ON public.group_mailboxes;
CREATE POLICY "Admins manage group mailboxes"
  ON public.group_mailboxes
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Copia os dados existentes (idempotente)
INSERT INTO public.group_mailboxes (
  group_id, email_address, verification_email, email_imap_server, email_imap_port,
  email_imap_user, email_imap_password, email_allowed_senders, email_blocked_subjects,
  email_code_patterns, email_body_keywords, email_subject_includes, email_ai_enabled
)
SELECT
  g.id, g.email_address, g.verification_email, g.email_imap_server, g.email_imap_port,
  g.email_imap_user, g.email_imap_password, g.email_allowed_senders, g.email_blocked_subjects,
  g.email_code_patterns, g.email_body_keywords, g.email_subject_includes,
  COALESCE(g.email_ai_enabled, false)
FROM public.groups g
WHERE g.email_imap_password IS NOT NULL
   OR g.email_imap_user IS NOT NULL
   OR g.email_address IS NOT NULL
ON CONFLICT (group_id) DO UPDATE SET
  email_address          = EXCLUDED.email_address,
  verification_email     = EXCLUDED.verification_email,
  email_imap_server      = EXCLUDED.email_imap_server,
  email_imap_port        = EXCLUDED.email_imap_port,
  email_imap_user        = EXCLUDED.email_imap_user,
  email_imap_password    = EXCLUDED.email_imap_password,
  email_allowed_senders  = EXCLUDED.email_allowed_senders,
  email_blocked_subjects = EXCLUDED.email_blocked_subjects,
  email_code_patterns    = EXCLUDED.email_code_patterns,
  email_body_keywords    = EXCLUDED.email_body_keywords,
  email_subject_includes = EXCLUDED.email_subject_includes,
  email_ai_enabled       = EXCLUDED.email_ai_enabled,
  updated_at             = now();

-- Remove as colunas sensiveis de `groups`.
-- Mantidas em `groups`: email_code_enabled e email_code_method (sao apenas
-- booleanos/modo, lidos pelo membro em ServiceCredentials.jsx:614).
DO $$
DECLARE
  c text;
BEGIN
  FOREACH c IN ARRAY ARRAY[
    'email_address','verification_email','email_imap_server','email_imap_port',
    'email_imap_user','email_imap_password','email_allowed_senders',
    'email_blocked_subjects','email_code_patterns','email_body_keywords',
    'email_subject_includes','email_ai_enabled'
  ] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'groups' AND column_name = c
    ) THEN
      EXECUTE format('ALTER TABLE public.groups DROP COLUMN IF EXISTS %I', c);
      RAISE NOTICE 'groups.% removida (movida para group_mailboxes)', c;
    END IF;
  END LOOP;
END $$;


-- =============================================================================
-- 6. S8 — users: colunas sensiveis expostas a qualquer autenticado
-- =============================================================================
-- A policy "Authenticated users read profiles" (fix-admin-users-read.sql:14)
-- dava SELECT em TODAS as 94 linhas x 35 colunas para qualquer autenticado.
--
-- IMPORTANTE: um REVOKE de COLUNA nao sobrepoe um GRANT de TABELA. Como o
-- Supabase da GRANT ALL em todas as tabelas para `anon`/`authenticated`, e
-- necessario REVOKAR o privilegio de TABELA e depois GRANTar as colunas
-- seguras explicitamente.
--
-- O front nao le explicitamente nenhuma das colunasbelow (verificado por
-- varredura). AuthProvider.jsx / PlatformEvents.jsx / UserDetail.jsx usavam
-- select('*') e foram ajustados para listas explicitas.
-- cpf/email sao exibidos por telas de admin -> caminho administrativo
-- proprio via admin_get_user_private().
-- =============================================================================
REVOKE SELECT ON TABLE public.users FROM anon, authenticated;

GRANT SELECT (
  id, name, email, phone, nickname, avatar_url, birthdate, role, status,
  email_verified, last_login_at, created_at, updated_at,
  pwa_installed_at, push_notifications_enabled_at,
  onboarding_completed_at, onboarding_step, onboarding_started_at
) ON TABLE public.users TO anon, authenticated;

-- Seguem service_role apenas: cpf, password_hash, ids de gateway e dados de
-- marketing. O admin le via admin_get_user_private() (abaixo).
REVOKE SELECT (
  customer_id_iopay, customer_id_stripe, customer_id_asaas,
  customer_id_mercadopago, customer_id_pagarme,
  cpf, password_hash,
  marketing_source, marketing_gclid, marketing_utm_source, marketing_utm_medium,
  marketing_utm_campaign, marketing_utm_term, marketing_utm_content,
  marketing_captured_at, lead_source, lead_source_other
) ON TABLE public.users FROM anon, authenticated;


CREATE OR REPLACE FUNCTION public.admin_get_user_private(p_user_id uuid)
RETURNS TABLE (
  id uuid,
  cpf text,
  email text,
  phone text,
  customer_id_iopay text,
  customer_id_stripe text,
  customer_id_asaas text,
  customer_id_mercadopago text,
  customer_id_pagarme text,
  marketing_source text,
  marketing_gclid text,
  lead_source text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    u.id, u.cpf, u.email, u.phone,
    u.customer_id_iopay, u.customer_id_stripe, u.customer_id_asaas,
    u.customer_id_mercadopago, u.customer_id_pagarme,
    u.marketing_source, u.marketing_gclid, u.lead_source
  FROM public.users u
  WHERE u.id = p_user_id
    AND public.is_admin();
$$;

REVOKE ALL ON FUNCTION public.admin_get_user_private(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_user_private(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_user_private(uuid) IS
  'Le os campos sensiveis de um usuario. Retorna vazio para quem nao e admin.';


-- =============================================================================
-- 7. S6 / S9 — vazamentos entre autenticados e para anonimos
-- =============================================================================
-- Duas classes de problema:
--   (a) policy permissiva SEM clausula TO -> vale para anon
--   (b) policy permissiva que deixa um autenticado ler dado de OUTRO usuario
--
-- Para (b) e necessario remover as policies antigas: policies permissivas
-- sao OR-ed entre si, entao uma policy frouxa continua valendo mesmo com
-- outra restrita ao lado. O DO block abaixo remove todas as policies das
-- tabelas indicadas e recomeca de forma deterministica.
-- =============================================================================

DO $$
DECLARE
  t text;
  r record;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'group_profiles','group_credentials','support_messages','platform_events'
  ] LOOP
    FOR r IN
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t
    LOOP
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', r.policyname, t);
      RAISE NOTICE 'policy removida: % . %', t, r.policyname;
    END LOOP;
  END LOOP;
END $$;

-- -----------------------------------------------------------------------------
-- 7.1 coupons — codigo e desconto visiveis a anonimo
-- -----------------------------------------------------------------------------
-- Leitura legitima: MyCupons.jsx (autenticado) e a edge function
-- manage-coupons (service_role). Nenhum fluxo publico precisa de anon.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.coupons FROM anon;

-- -----------------------------------------------------------------------------
-- 7.2 group_profiles — profile_password visivel a anonimo e a outros membros
-- -----------------------------------------------------------------------------
-- Leitura legitima: useAppData.js / MyCredentials.jsx / SubscriptionManage.jsx
-- (autenticados, select aninhado profiles:group_profiles(*)).
-- A policy anterior permitia assigned_to IS NULL para QUALQUER autenticado,
-- expondo perfis de grupos em que a pessoa nao e membro.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.group_profiles FROM anon;

CREATE POLICY "Members read own group profiles"
  ON public.group_profiles
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR assigned_to = auth.uid()
    OR (
      assigned_to IS NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = group_profiles.group_id
          AND gm.user_id = auth.uid()
          AND gm.status = 'active'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 7.3 group_credentials — mesma classe do bug, para a credencial do servico
-- -----------------------------------------------------------------------------
-- Mantem o caso "credencial ainda nao atribuida" (precisa ser visivel a
-- quem e membro ativo do grupo), mas bloqueia a leitura por nao-membros.
-- O DONO do grupo tambem pode ver (ele gerencia a credencial em
-- ManageGroup.jsx).
-- -----------------------------------------------------------------------------
CREATE POLICY "Members read own credentials"
  ON public.group_credentials
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_credentials.group_id
        AND g.owner_id = auth.uid()
    )
    OR (
      assigned_to IS NULL
      AND EXISTS (
        SELECT 1 FROM public.group_members gm
        WHERE gm.group_id = group_credentials.group_id
          AND gm.user_id = auth.uid()
          AND gm.status = 'active'
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 7.4 support_messages — conversas privadas de suporte em claro
-- -----------------------------------------------------------------------------
-- Confirmado em producao: anon lia as mensagens (texto, user_id, URL da
-- imagem) e QUALQUER autenticado lia as conversas de OUTRO usuario.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.support_messages FROM anon;

CREATE POLICY "Users read own ticket messages"
  ON public.support_messages
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.support_tickets st
      WHERE st.id = support_messages.ticket_id
        AND st.user_id = auth.uid()
    )
  );

-- -----------------------------------------------------------------------------
-- 7.5 custom_charges — reference_code, valor e status publicos
-- -----------------------------------------------------------------------------
-- O checkout publico (/checkout-link/:referenceCode) le esta tabela SEM
-- sessao, entao anon PRECISA de SELECT — inclusive de `gateway_transaction_id`
-- (o front usa esse campo para saber se ja existe transacao em andamento e
-- nao iniciar uma segunda).
--
-- O que NAO pode vazar e `created_by` (quem criou a cobranca).
-- A explorabilidade real estava em check-custom-charge / pay-custom-charge /
-- create-custom-charge, que aceitavam POST sem autenticacao — corrigido nas
-- edge functions.
--
-- Mesma armadilha do `users`: REVOKE de coluna nao sobrepoe GRANT de tabela.
-- Entao revoga-se a tabela e concede-se coluna a coluna.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.custom_charges FROM anon, authenticated;

GRANT SELECT (
  id, reference_code, amount, description, payment_method, status,
  gateway_transaction_id, pix_copy_paste, pix_qrcode_url, pix_qrcode_base64,
  expires_at, created_at, paid_amount, paid_at
) ON TABLE public.custom_charges TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7.6 platform_events — trilha de eventos forjavel pelo client
-- -----------------------------------------------------------------------------
-- platformEventLogger.js insere direto do browser (precisa manter INSERT),
-- mas o SELECT fica restrito a admin, unico consumidor.
-- -----------------------------------------------------------------------------
REVOKE SELECT ON TABLE public.platform_events FROM anon;

CREATE POLICY "Admins read platform events"
  ON public.platform_events
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE POLICY "Authenticated log platform events"
  ON public.platform_events
  FOR INSERT
  TO authenticated
  WITH CHECK (true);


-- =============================================================================
-- 8. S13 — idempotencia de pagamento (replay de webhook)
-- =============================================================================
-- iopay-webhook/index.ts:123 chama confirmPayment() SEM checar se o
-- pagamento ja foi confirmado -> reenvio do webhook cria nova linha em
-- payments e credita a wallet do dono de novo. O transaction_id necessario
-- para o replay e publico (payment_attempts.gateway_transaction_id).
--
-- Tres camadas de protecao:
--   8.1 indice unico parcial em payments  -> barra duplicidade no banco
--   8.2 credit_wallet idempotente          -> barra duplicidade no saldo
--   8.3 guarda em confirm-payment/index.ts -> evita refazer o trabalho
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 8.1 Indice unico PARCIAL em payments
-- -----------------------------------------------------------------------------
-- ATENCAO: nao pode ser UNIQUE(transaction_code) puro. No pagamento combinado
-- (entrance + subscription na mesma transacao) o confirm-payment insere DOIS
-- pagamentos com o MESMO transaction_code, um de cada tipo. Por isso a chave e
-- (transaction_code, payment_type) e apenas para pagamentos JA PAGOS.
-- Um pagamento 'failed' seguido de 'paid' do mesmo tx continua valendo.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  d bigint;
BEGIN
  SELECT count(*) INTO d FROM (
    SELECT transaction_code, payment_type FROM public.payments
    WHERE transaction_code IS NOT NULL AND status = 'paid'
    GROUP BY transaction_code, payment_type HAVING count(*) > 1
  ) t;

  IF d > 0 THEN
    RAISE WARNING 'S13: % par (transaction_code, payment_type) duplicado(s) em payments pagos. Indice NAO sera criado.',
      d;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'payments'
        AND indexname = 'payments_paid_tx_unique'
    ) THEN
      CREATE UNIQUE INDEX payments_paid_tx_unique
        ON public.payments (transaction_code, payment_type)
        WHERE transaction_code IS NOT NULL AND status = 'paid';
      RAISE NOTICE 'S13: indice unico parcial criado em payments (transaction_code, payment_type) WHERE status=paid';
    END IF;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 8.1b Trigger de duplicidade em payments (cobre o que o indice nao cobre)
-- -----------------------------------------------------------------------------
-- O indice acima so pode ser criado se NAO existirem duplicatas legadas. Em
-- producao existiam 3 pares duplicados (julho/agosto/2026, gerados pelo replay
-- de webhook) — com eles o indice nao e criado e a protecao some.
--
-- Por isso a trava real e um trigger BEFORE INSERT que:
--   - ignora (RETURN NULL, sem erro) o INSERT quando ja existe um pagamento
--     PAGO com o mesmo (transaction_code, payment_type);
--   - NAO bloqueia pagamentos 'pending' (um 'failed' seguido de 'paid' continua
--     valendo);
--   - NAO bloqueia o pagamento combinado, que insere 'entrance' e 'subscription'
--     com o mesmo transaction_code mas payment_type diferentes.
--
-- O trigger vale para todos os caminhos de gravacao (webhook, polling,
-- confirmacao manual) e nao depende de historico, entao cobre tambem as
-- duplicatas que ja existiam.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_duplicate_paid_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'paid'
     AND NEW.transaction_code IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.payments p
       WHERE p.id IS DISTINCT FROM NEW.id
         AND p.transaction_code = NEW.transaction_code
         AND p.payment_type IS NOT DISTINCT FROM NEW.payment_type
         AND p.status = 'paid'
     )
  THEN
    RAISE NOTICE 'payments: duplicado (%) / (%) ignorado', NEW.transaction_code, NEW.payment_type;
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.guard_duplicate_paid_payment() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.guard_duplicate_paid_payment() TO service_role;

DROP TRIGGER IF EXISTS trg_guard_duplicate_paid_payment ON public.payments;
CREATE TRIGGER trg_guard_duplicate_paid_payment
  BEFORE INSERT ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_duplicate_paid_payment();

COMMENT ON FUNCTION public.guard_duplicate_paid_payment() IS
  'Ignora INSERT em payments quando ja existe pagamento pago com o mesmo (transaction_code, payment_type). Trava de replay (S13).';

-- -----------------------------------------------------------------------------
-- 8.2 credit_wallet idempotente
-- -----------------------------------------------------------------------------
-- A funcao era um `balance = balance + amount` cego: cada reenvio de webhook
-- inflava a wallet do dono do grupo.
--
-- A chave de dedup inclui o amount e a description de proposito: no pagamento
-- combinado a MESMA transacao credita duas vezes (taxa de adesao + 1a
-- mensalidade), e as duas linhas se distinguem pelo valor/descricao. Um replay
-- repete exatamente os mesmos pares -> e barrado.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id UUID, p_amount DECIMAL, p_description TEXT,
    p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
    p_group_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    -- Idempotencia: nao creditar duas vezes a mesma referencia.
    IF p_reference_id IS NOT NULL THEN
        PERFORM 1
        FROM public.wallet_transactions
        WHERE reference_id = p_reference_id
          AND reference_type IS NOT DISTINCT FROM p_reference_type
          AND amount = p_amount
          AND description IS NOT DISTINCT FROM p_description;

        IF FOUND THEN
            RAISE NOTICE 'credit_wallet: referencia % ja creditada — ignorando', p_reference_id;
            RETURN;
        END IF;
    END IF;

    INSERT INTO public.user_wallets (user_id, balance, total_earned, updated_at)
    VALUES (p_user_id, p_amount, p_amount, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        balance = public.user_wallets.balance + p_amount,
        total_earned = public.user_wallets.total_earned + p_amount,
        updated_at = NOW();

    INSERT INTO public.wallet_transactions (user_id, type, amount, description, reference_type, reference_id, group_id, status, created_at)
    VALUES (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id, p_group_id, 'completed', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) TO service_role;

COMMENT ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) IS
  'Credita a wallet. Idempotente por (reference_id, reference_type, amount, description).';



-- =============================================================================
-- 9. CHECKPOINT
-- =============================================================================
-- Aplicados por este script: S1, S2, S3, S4, S6, S7, S8, S9, S13
-- Pendentes (exigem deploy de edge function / ajuste de front):
--   S10 senha SMTP/IMAP no git -> rotacao manual no servidor de e-mail
--   S11 assinatura HMAC nos webhooks -> patch de edge function
--   S12 16 funcoes sem auth -> patch de edge function
--   S14 iopay-webhook ReferenceError -> patch de edge function
--   B1/B2/B3 colunas ausentes (wallet_withdrawals, group_credentials)
--          -> migration de schema + ajuste de front
-- =============================================================================

COMMIT;

-- =============================================================================
-- 10. VERIFICACAO POS-APLICACAO
-- =============================================================================
-- Rode:  node scripts/verify-p0.mjs
-- Ele testa cada vulnerabilidade e imprime PASS/FAIL.
-- =============================================================================
