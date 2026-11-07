-- Schema de teste para `database/reparo-vinculos-e-assinaturas-2026-11-01.sql`
-- Reproduz os enums REAIS e os casos REAIS de produção (01/11/2026).
DROP TABLE IF EXISTS public.user_subscriptions, public.group_members,
                     public.groups, public.users CASCADE;
DROP TYPE IF EXISTS payment_flow_status, subscription_status, subscription_billing_status CASCADE;

CREATE TYPE payment_flow_status AS ENUM
  ('first_attempt','awaiting_entrance','entrance_paid','awaiting_subscription',
   'active','expired','overdue','refunded','cancelled');
CREATE TYPE subscription_status AS ENUM ('active','inactive','cancelled','expired','pending');
CREATE TYPE subscription_billing_status AS ENUM ('active','retrying','cancelled');

CREATE TABLE public.users (
  id   uuid PRIMARY KEY,
  email text,
  name  text
);

CREATE TABLE public.groups (
  id   uuid PRIMARY KEY,
  name text
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
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES public.users(id) ON DELETE CASCADE,
  group_id              uuid REFERENCES public.groups(id) ON DELETE CASCADE,
  service_id            uuid,
  status                subscription_status DEFAULT 'pending',
  billing_cycle         text,
  payment_method        text,
  started_at            date NOT NULL DEFAULT CURRENT_DATE,
  expires_at            date,
  amount                numeric(10,2),
  gateway               text,
  gateway_subscription_id text,
  gateway_status        text,
  custom_cycle_months   integer,
  custom_cycle_days     integer,
  next_charge_at        timestamptz,
  renewal_due_at        timestamptz,
  retry_count           integer DEFAULT 0,
  last_charge_at        timestamptz,
  card_id text, card_last4 text, card_brand text,
  billing_status        subscription_billing_status DEFAULT 'active',
  coupon_id uuid,
  discount_amount numeric(10,2),
  original_amount numeric(10,2),
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz,
  plan_id uuid,
  external_reference text,
  UNIQUE (user_id, group_id)
);

INSERT INTO public.users (id, email, name) VALUES
  ('c1111111-1111-1111-1111-111111111111','carolinasantos0594@gmail.com','Carolina Pereira dos Santos'),
  ('c2222222-2222-2222-2222-222222222222','maysa.romao.kiel@gmail.com','Maysa Caroline Romao Silva'),
  ('c3333333-3333-3333-3333-333333333333','yara@exemplo.com','Yara Jessica'),
  ('c4444444-4444-4444-4444-444444444444','normal@exemplo.com','Membro Normal'),
  ('c5555555-5555-5555-5555-555555555555','atrasado@exemplo.com','Membro Atrasado'),
  ('c6666666-6666-6666-6666-666666666666','saiu@exemplo.com','Membro Que Saiu');

INSERT INTO public.groups (id, name) VALUES
  ('8a4e94ca-0750-43bb-853a-bc2c6940ee66','Netflix C/ Anuncio'),
  ('a1111111-1111-1111-1111-111111111111','Plano Spotify'),
  ('b1111111-1111-1111-1111-111111111111','Wellhub'),
  ('c1111111-1111-1111-1111-111111111111','Grupo Comum');

-- CAROLINA: pagou, o vinculo ficou com status legado 'inactive' e a
-- assinatura foi cancelada. O caso do print.
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at, left_at, subscription_deadline, updated_at) VALUES
  ('8a4e94ca-0750-43bb-853a-bc2c6940ee66','c1111111-1111-1111-1111-111111111111','inactive','active','2026-07-27','2026-10-25','2027-01-27','2026-11-01T01:58:46');
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at, next_charge_at) VALUES
  ('c1111111-1111-1111-1111-111111111111','8a4e94ca-0750-43bb-853a-bc2c6940ee66','cancelled','cancelled','semiannual',59.40,'2027-01-27','2027-01-27');

-- MAYSA: mesmo padrao, prazo 2026-11-27
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at, left_at, subscription_deadline, updated_at) VALUES
  ('a1111111-1111-1111-1111-111111111111','c2222222-2222-2222-2222-222222222222','inactive','active','2026-07-27','2026-10-25','2026-11-27','2026-10-27T22:20:08');
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at, next_charge_at) VALUES
  ('c2222222-2222-2222-2222-222222222222','a1111111-1111-1111-1111-111111111111','cancelled','cancelled','monthly',9.90,'2026-11-27','2026-11-27');

-- YARA (Wellhub): saiu do grupo, sem prazo vigente, mas o pagamento ficou 'active'
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at, left_at, subscription_deadline) VALUES
  ('b1111111-1111-1111-1111-111111111111','c3333333-3333-3333-3333-333333333333','cancelled','active','2026-08-10','2026-10-12',NULL);
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at) VALUES
  ('c3333333-3333-3333-3333-333333333333','b1111111-1111-1111-1111-111111111111','active','active','monthly',39.90,'2026-11-10');

-- MEMBRO NORMAL: tudo certo, mas o vinculo nunca recebeu a data "paga ate"
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at) VALUES
  ('c1111111-1111-1111-1111-111111111111','c4444444-4444-4444-4444-444444444444','active','active','2026-10-01');
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at) VALUES
  ('c4444444-4444-4444-4444-444444444444','c1111111-1111-1111-1111-111111111111','active','active','monthly',29.90,'2026-12-01');

-- MEMBRO ATRASADO:pagou, mas a renovacao venceu
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at, subscription_deadline) VALUES
  ('c1111111-1111-1111-1111-111111111111','c5555555-5555-5555-5555-555555555555','active','overdue','2026-09-01','2026-10-01');
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at) VALUES
  ('c5555555-5555-5555-5555-555555555555','c1111111-1111-1111-1111-111111111111','expired','active','monthly',29.90,'2026-10-01');

-- MEMBRO QUE SAIU DE PROPONTO: cancelado nos dois lados
INSERT INTO public.group_members (group_id, user_id, status, payment_status, joined_at, left_at) VALUES
  ('c1111111-1111-1111-1111-111111111111','c6666666-6666-6666-6666-666666666666','cancelled','cancelled','2026-08-01','2026-08-20');
INSERT INTO public.user_subscriptions (user_id, group_id, status, billing_status, billing_cycle, amount, renewal_due_at) VALUES
  ('c6666666-6666-6666-6666-666666666666','c1111111-1111-1111-1111-111111111111','cancelled','cancelled','monthly',29.90,'2026-09-01');
