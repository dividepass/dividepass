-- =============================================================================
-- DividePass — fixture de validacao do fix-p0
-- =============================================================================
-- Cria um schema minimo e FAZEL (tabelas, colunas, enums e policies que o
-- migration toca) num banco local, para validar a sintaxe e o comportamento
-- de `database/fix-p0-security.sql` sem tocar em producao.
--
-- Uso:
--   psql -U postgres -c "DROP DATABASE IF EXISTS dp_p0_test" -c "CREATE DATABASE dp_p0_test"
--   psql -U postgres -d dp_p0_test -f scripts/test-fix-p0.sql
--
-- A secao final imprime PASS/FAIL de cada verificacao.
-- =============================================================================

\set ON_ERROR_STOP on

-- ---------------------------------------------------------------------------
-- 0. Stub do schema auth (como o Supabase expoe)
-- ---------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
$$;

-- ---------------------------------------------------------------------------
-- 1. Tabelas FAZEL
-- ---------------------------------------------------------------------------
CREATE TABLE public.streaming_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, slug text UNIQUE
);

CREATE TABLE public.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text, email text, password_hash text, phone text, cpf text,
  role text DEFAULT 'user', status text DEFAULT 'active',
  email_verified boolean DEFAULT false, last_login_at timestamptz,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  avatar_url text, birthdate date, nickname text,
  customer_id_iopay text, customer_id_stripe text, customer_id_asaas text,
  customer_id_mercadopago text, customer_id_pagarme text,
  pwa_installed_at timestamptz, marketing_source text, marketing_gclid text,
  marketing_utm_source text, marketing_utm_medium text,
  marketing_utm_campaign text, marketing_utm_term text,
  marketing_utm_content text, marketing_captured_at timestamptz,
  push_notifications_enabled_at timestamptz, lead_source text, lead_source_other text,
  onboarding_completed_at timestamptz, onboarding_step text, onboarding_started_at timestamptz
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id uuid REFERENCES public.streaming_services(id),
  name text, price_per_slot numeric(10,2), max_size int, status text DEFAULT 'open',
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
  billing_cycle text, cycle_discount numeric(10,2) DEFAULT 0,
  owner_id uuid REFERENCES public.users(id), cover_url text,
  verified boolean DEFAULT false, rules text, tags text[],
  available_cycles text[], has_slot_limit boolean DEFAULT true,
  has_entrance_fee boolean DEFAULT false, entrance_fee numeric(10,2) DEFAULT 0,
  slug text, description text,
  email_code_enabled boolean DEFAULT false, email_code_method text,
  email_address text, verification_email text,
  email_imap_server text, email_imap_port int DEFAULT 993,
  email_imap_user text, email_imap_password text,
  email_allowed_senders text[], email_blocked_subjects text[],
  email_code_patterns text[], email_body_keywords text[],
  email_subject_includes text[], email_ai_enabled boolean DEFAULT false,
  custom_cycle_months int, custom_cycle_label text, custom_cycle_days int,
  is_official boolean DEFAULT false, reference_code text,
  approval_status text, rejection_reason text, approved_at timestamptz,
  reviewed_by uuid, plan_type text, plan_type_custom text,
  photo_url text, plan_id uuid
);

CREATE TABLE public.group_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  status text DEFAULT 'active', payment_status text,
  created_at timestamptz DEFAULT now(),
  entrance_paid_at timestamptz, entrance_payment_id text,
  subscription_deadline timestamptz, left_at timestamptz,
  UNIQUE (group_id, user_id)
);

CREATE TABLE public.group_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  login_email text, login_password text, credential_type text DEFAULT 'email_password',
  credential_url text, credential_notes text, credential_link text,
  credential_code text, credential_invite text, credential_custom text,
  has_profiles boolean DEFAULT false, profile_assignment text,
  assigned_to uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  profile_name text, profile_password text, assigned_to uuid REFERENCES public.users(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_interest (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text, interest text, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text, description text,
  discount_type text DEFAULT 'fixed', discount_value numeric(10,2) DEFAULT 0,
  max_uses int DEFAULT 0, used_count int DEFAULT 0, min_amount numeric(10,2) DEFAULT 0,
  applies_to text DEFAULT 'all', group_id uuid, active boolean DEFAULT true,
  expires_at timestamptz, recurring boolean DEFAULT false,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.coupon_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  coupon_id uuid REFERENCES public.coupons(id), user_id uuid, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.campaign_rewards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign text, user_id uuid, status text DEFAULT 'available', expires_at timestamptz
);

CREATE TABLE public.custom_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_code text, amount numeric(10,2), description text,
  payment_method text, status text DEFAULT 'pending',
  gateway_transaction_id text, pix_copy_paste text, pix_qrcode_url text,
  pix_qrcode_base64 text, created_by uuid, paid_amount numeric(10,2),
  paid_at timestamptz, expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.custom_charge_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  charge_id uuid, reference_code text, admin_id uuid, action text,
  amount numeric(10,2), payment_method text, status text,
  gateway_transaction_id text, gateway_response text, ip_address text,
  user_agent text, metadata text, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.users(id), subject text, status text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.support_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid REFERENCES public.support_tickets(id) ON DELETE CASCADE,
  user_id uuid REFERENCES public.users(id), message text, image_url text,
  is_admin boolean DEFAULT false, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.platform_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text, title text, message text, metadata text,
  created_by uuid, created_at timestamptz DEFAULT now()
);

CREATE TABLE public.payment_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, group_id uuid, gateway text, payment_method text, payment_type text,
  amount numeric(10,2), currency text DEFAULT 'BRL', status text DEFAULT 'created',
  gateway_transaction_id text, gateway_response jsonb DEFAULT '{}',
  error_message text, external_reference text,
  pix_copy_paste text, pix_qrcode_url text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.password_resets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL, email text NOT NULL, token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL, used boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.user_wallets (
  user_id uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  balance numeric(12,2) DEFAULT 0, total_earned numeric(12,2) DEFAULT 0,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.wallet_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, type text, amount numeric(12,2), description text,
  reference_type text, reference_id uuid, group_id uuid,
  status text DEFAULT 'completed', created_at timestamptz DEFAULT now()
);

CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, amount numeric(12,2), official_price numeric(12,2),
  paid_amount numeric(12,2), method text, status text DEFAULT 'pending',
  payment_type text, group_id uuid, transaction_code text, gateway text,
  notes text, billing_cycle text, custom_cycle_months int, custom_cycle_days int,
  created_at timestamptz DEFAULT now(), paid_at timestamptz
);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, group_id uuid, status text DEFAULT 'active',
  billing_cycle text, custom_cycle_days int, custom_cycle_months int,
  payment_method text, gateway text, gateway_subscription_id text,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid, status text DEFAULT 'pending', amount numeric(12,2)
);

CREATE TABLE public.app_settings (
  key text PRIMARY KEY, value text
);

-- ---------------------------------------------------------------------------
-- 2. Roles e privileges (como o Supabase)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

-- Policies "de origem" (as permissivas que causavam o problema)
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users read profiles" ON public.users FOR SELECT
  USING (auth.role() = 'authenticated');
CREATE POLICY "Users update own profile" ON public.users FOR UPDATE
  USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Grupos publicos" ON public.groups FOR SELECT USING (true);
CREATE POLICY "Users insert own groups" ON public.groups FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users update own groups" ON public.groups FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users delete own groups" ON public.groups FOR DELETE USING (auth.uid() = owner_id);

ALTER TABLE public.group_credentials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read group credentials" ON public.group_credentials FOR SELECT
  USING (assigned_to = auth.uid() OR assigned_to IS NULL);

ALTER TABLE public.group_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users read group profiles" ON public.group_profiles FOR SELECT
  USING (assigned_to = auth.uid() OR assigned_to IS NULL);

ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos leem mensagens de suporte" ON public.support_messages FOR SELECT USING (true);

ALTER TABLE public.coupons ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos leem cupons" ON public.coupons FOR SELECT USING (true);

ALTER TABLE public.custom_charges ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos leem cobrancas" ON public.custom_charges FOR SELECT USING (true);

ALTER TABLE public.platform_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Todos leem eventos" ON public.platform_events FOR SELECT USING (true);

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own payment attempts" ON public.payment_attempts FOR SELECT
  USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage payment attempts" ON public.payment_attempts FOR ALL
  USING (true) WITH CHECK (true);

ALTER TABLE public.password_resets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage password resets" ON public.password_resets FOR ALL
  USING (true) WITH CHECK (true);

ALTER TABLE public.user_wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can insert their own wallet" ON public.user_wallets FOR INSERT WITH CHECK (true);
CREATE POLICY "Users can update their own wallet" ON public.user_wallets FOR UPDATE USING (true);

-- ---------------------------------------------------------------------------
-- 3. Dados de teste (ANTES do migration — o migration tem que MIGRAR
--    a senha IMAP de `groups` para `group_mailboxes`)
-- ---------------------------------------------------------------------------
INSERT INTO public.streaming_services (id, name, slug)
VALUES ('33333333-3333-3333-3333-333333333333', 'ChatGPT', 'chatgpt');

INSERT INTO public.users (id, name, email, role, cpf, customer_id_iopay, marketing_gclid)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Admin',   'admin@test.local',  'admin', '11111111111', 'cust-admin',  'gclid-admin'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Membro',  'membro@test.local', 'user',  '22222222222', 'cust-membro', 'gclid-membro'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Outro',   'outro@test.local',  'user',  '33333333333', 'cust-outro',  'gclid-outro');

INSERT INTO public.groups (
  id, service_id, name, slug, owner_id, price_per_slot, max_size,
  verified, is_official, approval_status, email_code_enabled,
  email_address, email_imap_server, email_imap_user, email_imap_password
)
VALUES (
  'bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
  'Grupo Teste', 'TESTE01', 'aaaaaaaa-0000-0000-0000-000000000002',
  10.00, 3, false, false, 'pending', true,
  'grupo@test.local', 'mail.test.local', 'grupo@test.local', 'SENHA_SECRETA_IMAP'
);

INSERT INTO public.group_members (group_id, user_id, status, payment_status)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'active', 'active');

INSERT INTO public.group_credentials (group_id, login_email, login_password, assigned_to)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'login@test.local', 'SENHA_SERVICO', 'aaaaaaaa-0000-0000-0000-000000000002');

INSERT INTO public.group_profiles (group_id, profile_name, profile_password)
VALUES ('bbbbbbbb-0000-0000-0000-000000000001', 'Perfil 1', 'SENHA_PERFIL');

INSERT INTO public.password_resets (user_id, email, token, expires_at)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'membro@test.local', 'TOKEN_RESET_REAL', now() + interval '1 hour');

INSERT INTO public.coupons (code, discount_type, discount_value, max_uses, applies_to, active)
VALUES ('TESTE10', 'fixed', 10.00, 1, 'all', true);

INSERT INTO public.custom_charges (reference_code, amount, description, payment_method, status, created_by)
VALUES ('CODIGO01', 50.00, 'Cobranca de teste', 'pix', 'pending', 'aaaaaaaa-0000-0000-0000-000000000001');

INSERT INTO public.support_tickets (id, user_id, subject)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Chamado do membro');

INSERT INTO public.support_messages (ticket_id, user_id, message)
VALUES ('cccccccc-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000002', 'Mensagem privada');

INSERT INTO public.payment_attempts (user_id, group_id, gateway, payment_method, payment_type, amount, gateway_transaction_id)
VALUES ('aaaaaaaa-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001', 'iopay', 'pix', 'subscription', 10.00, 'TX_REAL_1');

-- ---------------------------------------------------------------------------
-- 4. Aplica o migration
-- ---------------------------------------------------------------------------
\echo '>>> aplicando database/fix-p0-security.sql'
\i database/fix-p0-security.sql

\echo '>>> migration aplicada com sucesso (sem erro de sintaxe)'
