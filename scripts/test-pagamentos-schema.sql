-- Schema mínimo para validar `database/pagamentos-sem-liberacao-2026-11-01.sql`
-- Reproduz as MESMAS tabelas/colunas que a query usa, com os tipos reais.
DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.payments, public.user_subscriptions, public.group_members,
                     public.groups, public.payment_attempts, public.users CASCADE;

CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id    uuid PRIMARY KEY,
  email text
);

CREATE TABLE public.users (
  id         uuid PRIMARY KEY REFERENCES auth.users(id),
  email      text,
  name       text,
  role       text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  owner_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  service_id uuid,
  price_per_slot numeric(10,2),
  billing_cycle text
);

CREATE TABLE public.group_members (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id             uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id              uuid REFERENCES public.users(id) ON DELETE CASCADE,
  profile_name         text,
  status               varchar(20) DEFAULT 'active',
  joined_at            timestamptz,
  left_at              timestamptz,
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz,
  payment_status       text DEFAULT 'active',
  entrance_paid_at     timestamptz,
  entrance_payment_id  text,
  subscription_deadline timestamptz,
  entrance_refunded    boolean DEFAULT false,
  subscription_mp_id   text,
  gateway_payment_id   text,
  gateway              text,
  UNIQUE (group_id, user_id)
);

CREATE TABLE public.user_subscriptions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.users(id) ON DELETE CASCADE,
  group_id     uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  service_id   uuid,
  status       text DEFAULT 'pending',
  billing_cycle text,
  payment_method text,
  started_at   date NOT NULL DEFAULT CURRENT_DATE,
  expires_at   date,
  amount       numeric(10,2),
  gateway      text,
  gateway_subscription_id text,
  gateway_status text,
  custom_cycle_months integer,
  custom_cycle_days   integer,
  next_charge_at timestamptz,
  renewal_due_at  timestamptz,
  retry_count   integer DEFAULT 0,
  last_charge_at timestamptz,
  card_id text, card_last4 text, card_brand text,
  billing_status text DEFAULT 'active',
  coupon_id uuid,
  discount_amount numeric(10,2),
  original_amount numeric(10,2),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz,
  plan_id uuid,
  external_reference text,
  UNIQUE (user_id, group_id)
);

CREATE TABLE public.payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES public.users(id) ON DELETE CASCADE,
  subscription_id uuid REFERENCES public.user_subscriptions(id) ON DELETE SET NULL,
  group_id     uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  amount       numeric(10,2) NOT NULL,
  method       text,
  payment_type text,
  gateway      text,
  status       text DEFAULT 'pending',
  transaction_code text,
  notes        text,
  due_date     date,
  paid_at      timestamptz,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz,
  official_price numeric(10,2),
  paid_amount    numeric(10,2)
);

CREATE TABLE public.payment_attempts (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES public.users(id) ON DELETE CASCADE,
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
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz
);

-- ── dados de teste ─────────────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('11111111-1111-1111-1111-111111111111','kellrodrigues92@gmail.com'),
  ('22222222-2222-2222-2222-222222222222','michaelortegareal@gmail.com');

INSERT INTO public.users (id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111','kellrodrigues92@gmail.com','Fran Ribeiro'),
  ('22222222-2222-2222-2222-222222222222','michaelortegareal@gmail.com','Michael Ortega Real');

INSERT INTO public.groups (id, name, owner_id, service_id, price_per_slot, billing_cycle) VALUES
  ('8a4e94ca-0750-43bb-853a-bc2c6940ee66','Netflix C/ Anúncio','22222222-2222-2222-2222-222222222222',
   '11111111-1111-1111-1111-111111111111', 9.90, 'semiannual');

-- Caso Fran: tentativa aprovada no gateway, sem pagamento aplicado, membro sem assinatura
INSERT INTO public.payment_attempts
  (user_id, group_id, gateway, gateway_transaction_id, amount, status, payment_type, external_reference, created_at)
VALUES
  ('11111111-1111-1111-1111-111111111111','8a4e94ca-0750-43bb-853a-bc2c6940ee66','iopay',
   '3973007501020261101045910tiO', 59.40, 'polled_approved', 'subscription',
   '8a4e94ca-0750-43bb-853a-bc2c6940ee66:11111111-1111-1111-1111-111111111111:subscription',
   now() - interval '5 hours'),
  ('11111111-1111-1111-1111-111111111111','8a4e94ca-0750-43bb-853a-bc2c6940ee66','iopay',
   '3973007501020261101045910tiO-2', 59.40, 'polled_pending', 'subscription',
   '8a4e94ca-0750-43bb-853a-bc2c6940ee66:11111111-1111-1111-1111-111111111111:subscription',
   now() - interval '4 hours'),
  -- caso de quem pagou e foi liberado normalmente
  ('22222222-2222-2222-2222-222222222222','8a4e94ca-0750-43bb-853a-bc2c6940ee66','iopay',
   'tx-ok-123', 59.40, 'webhook_approved', 'subscription',
   '8a4e94ca-0750-43bb-853a-bc2c6940ee66:22222222-2222-2222-2222-222222222222:subscription',
   now() - interval '10 days');

INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at) VALUES
  ('8a4e94ca-0750-43bb-853a-bc2c6940ee66','11111111-1111-1111-1111-111111111111','active','active', now() - interval '5 hours'),
  ('8a4e94ca-0750-43bb-853a-bc2c6940ee66','22222222-2222-2222-2222-222222222222','active','active', now() - interval '10 days');

INSERT INTO public.user_subscriptions (user_id, group_id, service_id, status, billing_cycle, amount, gateway) VALUES
  ('22222222-2222-2222-2222-222222222222','8a4e94ca-0750-43bb-853a-bc2c6940ee66',
   '11111111-1111-1111-1111-111111111111','active','semiannual',59.40,'iopay');

INSERT INTO public.payments (user_id, group_id, amount, method, payment_type, gateway, status, transaction_code) VALUES
  ('22222222-2222-2222-2222-222222222222','8a4e94ca-0750-43bb-853a-bc2c6940ee66',59.40,'pix','subscription','iopay','paid','tx-ok-123');
