-- ============================================================================
-- Schema de TESTE para `database/diagnostico-pagamento-aprovado-sem-liberacao-2026-11-03.sql`
--
-- Não é o banco de produção: é o mínimo (mesmas tabelas/colunas/tipos) para
-- o diagnóstico rodar inteiro no Postgres local e pegar erro antes de colar
-- no SQL Editor do Supabase.
--
--   psql -U postgres -d postgres -f scripts/test-diagnostico-liberacao-schema.sql
--   psql -U postgres -d postgres -f database/diagnostico-pagamento-aprovado-sem-liberacao-2026-11-03.sql
--
-- O cenário reproduzido é o da Cristiana (02/11): tentativa "subscription"
-- de R$ 29,90 e tentativa "combined" de R$ 39,80 aprovada no gateway, com a
-- assinatura ainda PENDENTE e o vínculo em "awaiting_subscription".
-- ============================================================================

DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.payments, public.user_subscriptions, public.group_members,
                     public.groups, public.payment_attempts, public.users,
                     public.streaming_services CASCADE;

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

CREATE TABLE public.streaming_services (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  slug text
);

CREATE TABLE public.groups (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text,
  slug          text,
  owner_id      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  service_id    uuid REFERENCES public.streaming_services(id) ON DELETE SET NULL,
  price_per_slot numeric(10,2),
  entrance_fee   numeric(10,2) DEFAULT 0,
  billing_cycle  text
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
  ('33333333-3333-3333-3333-333333333333','vieiracristiana817@gmail.com'),
  ('22222222-2222-2222-2222-222222222222','michaelortegareal@gmail.com');

INSERT INTO public.users (id, email, name) VALUES
  ('33333333-3333-3333-3333-333333333333','vieiracristiana817@gmail.com','Cristiana Ferreira vieira'),
  ('22222222-2222-2222-2222-222222222222','michaelortegareal@gmail.com','Michael Ortega Real');

INSERT INTO public.streaming_services (id, name, slug) VALUES
  ('44444444-4444-4444-4444-444444444444','IPTV','iptv');

INSERT INTO public.groups (id, name, slug, owner_id, service_id, price_per_slot, entrance_fee, billing_cycle) VALUES
  ('55555555-5555-5555-5555-555555555555','Painel','D17A5E',
   '22222222-2222-2222-2222-222222222222','44444444-4444-4444-4444-444444444444',
   29.90, 9.90, 'monthly');

-- Caso Cristiana (dados REAIS de produção, 02/11):
--   1) tentativa 'subscription' R$ 29,90 às 21:14:38 -> status webhook_pending
--   2) tentativa 'combined'    R$ 39,80 às 21:18:25 -> status polled_pending
--   3) tentativa 'combined'    R$ 39,80 às 23:43:50 -> status polled_succeeded (PAGA)
--   O vínculo JÁ está 'active' (o create-payment antigo gravou antes do pagamento)
--   e a assinatura continua 'pending' R$ 29,90.
INSERT INTO public.payment_attempts
  (user_id, group_id, gateway, gateway_transaction_id, amount, status, payment_type, external_reference, created_at, updated_at)
VALUES
  ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','iopay',
   '468cab0bfded4f4c8cd9df043e0ec454', 29.90, 'webhook_pending', 'subscription',
   '55555555-5555-5555-5555-555555555555:33333333-3333-3333-3333-333333333333:subscription',
   '2026-11-02 21:14:38.860171+00', '2026-11-02 21:14:38.860171+00'),
  ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','iopay',
   'b7e5b6979c074393ba6077b032dce8c9', 39.80, 'polled_pending', 'combined',
   '55555555-5555-5555-5555-555555555555:33333333-3333-3333-3333-333333333333:combined',
   '2026-11-02 21:18:25.6133+00', '2026-11-02 21:18:25.6133+00'),
  ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555','iopay',
   '3e4d8697ab1c456494ffa5f41b7c711d', 39.80, 'polled_succeeded', 'combined',
   '55555555-5555-5555-5555-555555555555:33333333-3333-3333-3333-333333333333:combined',
   '2026-11-02 23:43:50.498469+00', '2026-11-02 23:43:50.498469+00');

-- Vínculo JÁ ativo (foi o create-payment antigo que gravou antes do pagamento)
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at) VALUES
  ('55555555-5555-5555-5555-555555555555','33333333-3333-3333-3333-333333333333','active','active', now() - interval '2 days');

-- Assinatura continua PENDENTE, com o valor do CICLO (29,90) e próxima cobrança em 02/12
INSERT INTO public.user_subscriptions (user_id, group_id, service_id, status, billing_cycle, amount, gateway, next_charge_at, started_at) VALUES
  ('33333333-3333-3333-3333-333333333333','55555555-5555-5555-5555-555555555555',
   '44444444-4444-4444-4444-444444444444','pending','monthly',29.90,'iopay','2026-12-02 21:14:38.682+00','2026-11-02 21:14:38.682+00');

-- Caso "meio confirmado": pagamento registrado, liberação incompleta
INSERT INTO public.payment_attempts
  (user_id, group_id, gateway, gateway_transaction_id, amount, status, payment_type, external_reference, created_at, updated_at)
VALUES
  ('22222222-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555','iopay',
   'tx-meio-1', 39.80, 'webhook_approved', 'combined',
   '55555555-5555-5555-5555-555555555555:22222222-2222-2222-2222-222222222222:combined',
   '2026-11-01 12:00:00+00', '2026-11-01 12:00:00+00');

INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at) VALUES
  ('55555555-5555-5555-5555-555555555555','22222222-2222-2222-2222-222222222222','active','awaiting_subscription', now() - interval '2 days');

INSERT INTO public.user_subscriptions (user_id, group_id, service_id, status, billing_cycle, amount, gateway, next_charge_at) VALUES
  ('22222222-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555',
   '44444444-4444-4444-4444-444444444444','pending','monthly',29.90,'iopay','2026-12-01 00:00:00+00');

INSERT INTO public.payments (user_id, group_id, amount, method, payment_type, gateway, status, transaction_code, created_at) VALUES
  ('22222222-2222-2222-2222-222222222222','55555555-5555-5555-5555-555555555555',39.80,'pix','combined','iopay','paid','tx-meio-1', now() - interval '2 days');

SELECT 'schema de teste pronto (caso Cristiana + caso meio confirmado)' AS status;
