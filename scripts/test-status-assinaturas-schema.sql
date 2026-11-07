-- Banco de teste: reproduz os tipos REAIS de producao
--   group_members.payment_status -> ENUM payment_flow_status (SEM 'inactive')
--   group_members.status         -> VARCHAR(20)
--   user_subscriptions.status     -> ENUM subscription_status
-- e todos os casos de membro que existem em producao.
DROP TABLE IF EXISTS public.group_members, public.user_subscriptions, public.users, public.groups CASCADE;
DROP TYPE IF EXISTS public.subscription_status CASCADE;
DROP TYPE IF EXISTS public.payment_flow_status CASCADE;

CREATE TYPE public.subscription_status AS ENUM ('active','inactive','cancelled','expired','pending');

-- enum real de producao: 'inactive' NAO existe aqui (foi o que estourou 22P02)
CREATE TYPE public.payment_flow_status AS ENUM (
  'awaiting_entrance','entrance_paid','awaiting_subscription',
  'active','expired','overdue','refunded','cancelled'
);

CREATE TABLE public.users (
  id    uuid PRIMARY KEY,
  email text,
  name  text
);

CREATE TABLE public.groups (
  id         uuid PRIMARY KEY,
  name       text,
  owner_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status     text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_members (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid REFERENCES public.users(id),
  group_id              uuid REFERENCES public.groups(id),
  status                VARCHAR(20) NOT NULL DEFAULT 'active',
  payment_status        public.payment_flow_status DEFAULT 'awaiting_entrance',
  subscription_deadline timestamptz,
  left_at               timestamptz,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);

CREATE TABLE public.user_subscriptions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid REFERENCES public.users(id),
  group_id         uuid REFERENCES public.groups(id),
  status           public.subscription_status DEFAULT 'active',
  billing_status   text,
  renewal_due_at   timestamptz,
  next_charge_at   timestamptz,
  expires_at       date,
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now()
);

INSERT INTO public.users (id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111','talita@x.com','Talita'),
  ('22222222-2222-2222-2222-222222222222','robson@x.com','Robson'),
  ('33333333-3333-3333-3333-333333333333','cintia@x.com','Cintia (cancelled+overdue)'),
  ('44444444-4444-4444-4444-444444444444','paulo@x.com','Paulo'),
  ('55555555-5555-5555-5555-555555555555','carolina@x.com','Carolina (inactive+active)'),
  ('66666666-6666-6666-6666-666666666666','kell@x.com','Kell (inactive+cancelled)'),
  ('77777777-7777-7777-7777-777777777777','maysa@x.com','Maysa (inactive+active)'),
  ('88888888-8888-8888-8888-888888888888','wellhub@x.com','Wellhub (cancelled+active)'),
  ('99999999-9999-9999-9999-999999999999','atrasado6d@x.com','Atrasado 6d'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','atrasado10d@x.com','Atrasado 10d'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','pendente-membro@x.com','Pagamento em aberto'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','sem-membro@x.com','Sem linha de membro'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','legado-inactive@x.com','Legado inactive');

INSERT INTO public.groups (id, name, owner_id) VALUES
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','Spotify 01','11111111-1111-1111-1111-111111111111'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff','Grupo 3','11111111-1111-1111-1111-111111111111');

-- membros (status / payment_status / prazo) — copiado do estado real
INSERT INTO public.group_members (user_id, group_id, status, payment_status, subscription_deadline) VALUES
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','active', NOW() + interval '50 days'),
  ('22222222-2222-2222-2222-222222222222','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','active', NOW() + interval '50 days'),
  ('33333333-3333-3333-3333-333333333333','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled','overdue', NOW() - interval '2 days'),
  ('44444444-4444-4444-4444-444444444444','ffffffff-ffff-ffff-ffff-ffffffffffff','active','active', NOW() + interval '8 days'),
  ('55555555-5555-5555-5555-555555555555','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','inactive','active', NOW() + interval '202 days'),
  ('66666666-6666-6666-6666-666666666666','ffffffff-ffff-ffff-ffff-ffffffffffff','inactive','cancelled', NOW() - interval '27 days'),
  ('77777777-7777-7777-7777-777777777777','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','inactive','active', NOW() + interval '26 days'),
  ('88888888-8888-8888-8888-888888888888','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled','active', NULL),
  ('99999999-9999-9999-9999-999999999999','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','overdue', NOW() - interval '6 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','overdue', NOW() - interval '10 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','awaiting_subscription', NOW() + interval '5 days'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active','active', NOW() + interval '60 days');

-- assinaturas
INSERT INTO public.user_subscriptions (user_id, group_id, status, renewal_due_at, next_charge_at) VALUES
  ('11111111-1111-1111-1111-111111111111','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() + interval '50 days', NOW() + interval '50 days'),
  ('22222222-2222-2222-2222-222222222222','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() + interval '50 days', NOW() + interval '50 days'),
  ('33333333-3333-3333-3333-333333333333','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() - interval '2 days',  NOW() - interval '2 days'),
  ('44444444-4444-4444-4444-444444444444','ffffffff-ffff-ffff-ffff-ffffffffffff','cancelled', NOW() + interval '8 days',  NOW() + interval '8 days'),
  ('55555555-5555-5555-5555-555555555555','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() + interval '202 days', NOW() + interval '202 days'),
  ('66666666-6666-6666-6666-666666666666','ffffffff-ffff-ffff-ffff-ffffffffffff','cancelled', NOW() - interval '27 days', NOW() - interval '27 days'),
  ('77777777-7777-7777-7777-777777777777','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() + interval '26 days', NOW() + interval '26 days'),
  ('88888888-8888-8888-8888-888888888888','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NULL, NULL),
  ('99999999-9999-9999-9999-999999999999','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active',    NOW() - interval '6 days',  NOW() - interval '6 days'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active',    NOW() - interval '10 days', NOW() - interval '10 days'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','active',    NOW() + interval '5 days',  NOW() + interval '5 days'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','cancelled', NOW() + interval '10 days', NOW() + interval '10 days'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd','eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee','inactive',  NOW() + interval '60 days', NOW() + interval '60 days');

SELECT 'estado inicial' AS etapa, status, count(*) FROM public.user_subscriptions GROUP BY status;
