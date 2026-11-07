-- Schema mínimo para validar `database/reparo-marisa-2026-11-01.sql`
-- e `database/diagnostico-marisa-2026-11-01.sql`.
--
-- Reproduz o CENÁRIO REAL do caso Marisa:
--   - o grupo da referência (id igual ao id do serviço Netflix) existia;
--   - a assinatura foi criada nele com status 'pending';
--   - depois o grupo foi APAGADO (o script de teste apaga, como o runner);
--   - a tentativa de pagamento ficou 'created' (nunca atualizada);
--   - ela pagou a taxa de adesão em OUTRO grupo ("Grupo 3" Globoplay).
DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.payments, public.user_subscriptions, public.group_members,
                     public.groups, public.payment_attempts, public.platform_events,
                     public.email_logs, public.streaming_services, public.users CASCADE;
DROP TYPE IF EXISTS public.payment_flow_status, public.subscription_status,
                     public.subscription_billing_status, public.payment_method,
                     public.payment_status CASCADE;

CREATE SCHEMA auth;

-- ── enums (mesmos valores de produção) ─────────────────────────────────────
CREATE TYPE payment_flow_status AS ENUM (
  'first_attempt','awaiting_entrance','entrance_paid','awaiting_subscription',
  'active','expired','overdue','refunded','cancelled');
CREATE TYPE subscription_status AS ENUM ('active','inactive','cancelled','expired','pending');
CREATE TYPE subscription_billing_status AS ENUM ('active','retrying','cancelled');
CREATE TYPE payment_method AS ENUM ('pix','credit_card','bank_slip');
CREATE TYPE payment_status AS ENUM ('pending','paid','failed','refunded','cancelled');

-- ── tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE auth.users (id uuid PRIMARY KEY, email text);

CREATE TABLE public.users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id),
  email      text,
  name       text,
  role       text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.streaming_services (
  id     uuid PRIMARY KEY,
  name   text,
  slug   text,
  status text DEFAULT 'active'
);

CREATE TABLE public.groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text,
  slug            text,
  status          text DEFAULT 'open',
  visibility      text DEFAULT 'public',
  owner_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  service_id      uuid,
  price_per_slot  numeric(10,2),
  entrance_fee    numeric(10,2),
  billing_cycle   text DEFAULT 'monthly',
  max_size        integer,
  created_at      timestamptz DEFAULT now()
);

CREATE TABLE public.group_members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id              uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id               uuid REFERENCES public.users(id) ON DELETE CASCADE,
  profile_name          text,
  status                varchar(20) DEFAULT 'active',
  joined_at             timestamptz,
  left_at               timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz,
  payment_status        payment_flow_status DEFAULT 'active',
  entrance_paid_at      timestamptz,
  entrance_payment_id   text,
  subscription_deadline timestamptz,
  entrance_refunded     boolean DEFAULT false,
  subscription_mp_id    text,
  gateway_payment_id    text,
  gateway               text,
  UNIQUE (group_id, user_id)
);

CREATE TABLE public.user_subscriptions (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id                uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  service_id              uuid,
  status                  subscription_status DEFAULT 'pending',
  billing_cycle           text,
  payment_method          text,
  started_at              timestamptz DEFAULT now(),
  expires_at              timestamptz,
  amount                  numeric(10,2),
  gateway                 text,
  gateway_subscription_id text,
  gateway_status          text,
  custom_cycle_months     integer,
  custom_cycle_days       integer,
  next_charge_at          timestamptz,
  renewal_due_at          timestamptz,
  retry_count             integer DEFAULT 0,
  last_charge_at          timestamptz,
  card_id text, card_last4 text, card_brand text,
  billing_status          subscription_billing_status DEFAULT 'active',
  coupon_id               uuid,
  discount_amount         numeric(10,2),
  original_amount         numeric(10,2),
  created_at              timestamptz DEFAULT now(),
  updated_at              timestamptz,
  plan_id                 uuid,
  external_reference      text
);

CREATE TABLE public.payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id  uuid REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  group_id         uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  amount           numeric(10,2) NOT NULL,
  method           payment_method,
  payment_type     text,
  gateway          text,
  status           payment_status DEFAULT 'pending',
  transaction_code text,
  notes            text,
  due_date         date,
  paid_at          timestamptz,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz,
  official_price   numeric(10,2),
  paid_amount      numeric(10,2)
);

CREATE TABLE public.payment_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  group_id              uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  gateway               text,
  gateway_transaction_id text,
  amount                numeric(10,2),
  status                text,
  payment_type          text,
  external_reference    text,
  payment_method        text,
  gateway_response      jsonb,
  error_message         text,
  pix_copy_paste        text,
  pix_qrcode_url        text,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz
);

CREATE TABLE public.platform_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type varchar(50) NOT NULL,
  title      varchar(255) NOT NULL,
  message    text,
  metadata   jsonb DEFAULT '{}',
  created_by uuid REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.email_logs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  email_id   text,
  "from"     text,
  "to"       text,
  subject    text,
  created_at timestamptz DEFAULT now(),
  raw_event  jsonb
);

-- ── dados do caso ──────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('d2ccd4d5-d811-4f04-8d65-4f64bbefb456','mfcordoba9@gmail.com'),
  ('2fd57ac7-fd13-45dc-a496-9ed4db2a5a78','qa.mavis@divteste.com');

INSERT INTO public.users (id, email, name) VALUES
  ('d2ccd4d5-d811-4f04-8d65-4f64bbefb456','mfcordoba9@gmail.com','Marisa córdoba amarantes'),
  ('2fd57ac7-fd13-45dc-a496-9ed4db2a5a78','qa.mavis@divteste.com','QA Mavis');

INSERT INTO public.streaming_services (id, name, slug, status) VALUES
  ('11111111-1111-1111-1111-111111111111','Netflix','netflix','active'),
  ('77777777-7777-7777-7777-777777777777','Globoplay','globoplay','active'),
  ('44444444-4444-4444-4444-444444444444','Max','max','active');

INSERT INTO public.groups (id, name, slug, status, service_id, price_per_slot, entrance_fee, billing_cycle) VALUES
  -- grupo da REFERÊNCIA da transação (vai ser apagado pelo runner)
  ('11111111-1111-1111-1111-111111111111','Grupo 3','ANTIGO','open',
   '11111111-1111-1111-1111-111111111111', 9.90, 0, 'monthly'),
  -- "Grupo 3" Globoplay: onde ela pagou a taxa de adesão
  ('11111111-1111-1111-1111-111111111112','Grupo 3','111111','open',
   '77777777-7777-7777-7777-777777777777', 9.90, 4.90, 'monthly'),
  -- "Grupo 3" Netflix (o mais novo)
  ('daff4caf-c513-4231-89f2-62c5f1063c8b','Grupo 3','DAFF4C','open',
   '11111111-1111-1111-1111-111111111111', 9.90, 0, 'monthly');

-- Vínculo: adesão paga no Grupo 3 Globoplay
INSERT INTO public.group_members
  (group_id, user_id, status, payment_status, entrance_paid_at, entrance_payment_id,
   subscription_deadline, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111112','d2ccd4d5-d811-4f04-8d65-4f64bbefb456',
   'active','entrance_paid', now() - interval '3 hours','tx-entrada-001',
   now() + interval '9 hours', now() - interval '3 hours');

-- Assinatura 'pending' criada no grupo da referência (que será apagado)
INSERT INTO public.user_subscriptions
  (user_id, group_id, service_id, status, billing_status, billing_cycle, amount,
   gateway, gateway_subscription_id, payment_method, next_charge_at, renewal_due_at,
   started_at, created_at, external_reference)
VALUES
  ('d2ccd4d5-d811-4f04-8d65-4f64bbefb456','11111111-1111-1111-1111-111111111111',
   '11111111-1111-1111-1111-111111111111','pending','active','monthly',9.90,
   'iopay','d73c9d40a7464a3db981a80137918e67','pix',
   now() + interval '1 month', now() + interval '1 month',
   now() - interval '4 hours', now() - interval '4 hours',
   '11111111-1111-1111-1111-111111111111:d2ccd4d5-d811-4f04-8d65-4f64bbefb456:subscription');

-- Tentativa de pagamento: criada e NUNCA atualizada (status 'created')
INSERT INTO public.payment_attempts
  (user_id, group_id, gateway, gateway_transaction_id, amount, status, payment_type,
   payment_method, external_reference, gateway_response, created_at, updated_at)
VALUES
  ('d2ccd4d5-d811-4f04-8d65-4f64bbefb456','11111111-1111-1111-1111-111111111111','iopay',
   'd73c9d40a7464a3db981a80137918e67',9.90,'created','subscription','pix',
   '11111111-1111-1111-1111-111111111111:d2ccd4d5-d811-4f04-8d65-4f64bbefb456:subscription',
   '{"status":"succeeded","payment_method":"pix"}', now() - interval '4 hours', now() - interval '4 hours');
