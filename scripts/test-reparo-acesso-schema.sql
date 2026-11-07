-- ============================================================================
-- Schema de TESTE para o script EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql
-- (Postgres local — não é produção)
--
-- Cria o mínimo necessário e semeia os CASOS que motivaram o script:
--   1) espelho 'inactive' + assinatura ativa   -> deve voltar a 'active'
--   2) espelho 'cancelled' + assinatura ativa  -> deve voltar a 'active'
--   3) espelho 'cancelled' SEM assinatura ativa -> NÃO volta (cancelou de verdade)
--   4) assinatura 'cancelled' + vínculo ativo e pago -> assinatura volta a 'active'
--   5) vínculo ativo e pago SEM a data "paga até" -> a data é preenchida
--
-- Uso (no WSL):
--   createdb teste_acesso
--   psql -U postgres -d teste_acesso -f /mnt/c/.../scripts/test-reparo-acesso-schema.sql
--   psql -U postgres -d teste_acesso -f /mnt/c/.../database/EXECUTAR-2026-11-02-reparo-acesso-credenciais.sql
--   psql -U postgres -d teste_acesso -f /mnt/c/.../scripts/test-reparo-acesso-verifica.sql
-- ============================================================================

DROP TABLE IF EXISTS public.group_members CASCADE;
DROP TABLE IF EXISTS public.user_subscriptions CASCADE;
DROP TABLE IF EXISTS public.groups CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP TYPE IF EXISTS public.payment_flow_status CASCADE;
DROP TYPE IF EXISTS public.subscription_status CASCADE;
DROP TYPE IF EXISTS public.subscription_billing_status CASCADE;

CREATE TYPE public.payment_flow_status AS ENUM
  ('first_attempt', 'awaiting_subscription', 'active', 'overdue', 'cancelled', 'pending');
CREATE TYPE public.subscription_status AS ENUM
  ('active', 'pending', 'expired', 'cancelled', 'inactive');
CREATE TYPE public.subscription_billing_status AS ENUM
  ('active', 'pending', 'overdue', 'cancelled', 'expired');

CREATE TABLE public.users (
  id uuid PRIMARY KEY,
  email text,
  name text
);

CREATE TABLE public.groups (
  id uuid PRIMARY KEY,
  name text,
  owner_id uuid REFERENCES public.users(id)
);

CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid REFERENCES public.users(id),
  group_id uuid REFERENCES public.groups(id),
  service_id uuid,
  status public.subscription_status DEFAULT 'active',
  billing_status public.subscription_billing_status DEFAULT 'active',
  amount numeric(10,2),
  billing_cycle text,
  next_charge_at timestamptz,
  renewal_due_at timestamptz,
  expires_at date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_members (
  id uuid PRIMARY KEY,
  group_id uuid REFERENCES public.groups(id),
  user_id uuid REFERENCES public.users(id),
  status varchar(20) DEFAULT 'active',
  payment_status public.payment_flow_status DEFAULT 'first_attempt',
  subscription_deadline timestamptz,
  left_at timestamptz,
  joined_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- ── dados ──────────────────────────────────────────────────────────────────
INSERT INTO public.users (id, email, name) VALUES
  ('11111111-1111-1111-1111-111111111111', 'dono@dividepass.com', 'Dono'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'carolina@exemplo.com',  'Carolina (espelho inactive)'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'saiu@exemplo.com',      'Saiu de verdade'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'assinatura@exemplo.com','Assinatura cancelada'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'sem-prazo@exemplo.com', 'Sem data paga ate');

INSERT INTO public.groups (id, name, owner_id) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'Netflix QA', '11111111-1111-1111-1111-111111111111');

-- 1) espelho 'inactive' + assinatura ativa (o caso da Carol)
INSERT INTO public.group_members (id, group_id, user_id, status, payment_status, subscription_deadline)
VALUES ('c0000001-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000001', 'inactive', 'active', NULL);

-- 2) espelho 'cancelled' + assinatura ativa
INSERT INTO public.group_members (id, group_id, user_id, status, payment_status, subscription_deadline)
VALUES ('c0000001-0000-0000-0000-000000000002', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000004', 'cancelled', 'active', NULL);

-- 3) espelho 'cancelled' SEM assinatura ativa (cancelou de verdade)
INSERT INTO public.group_members (id, group_id, user_id, status, payment_status, subscription_deadline)
VALUES ('c0000001-0000-0000-0000-000000000003', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000002', 'cancelled', 'active', NULL);

-- 4) assinatura 'cancelled' + vínculo ativo e pago
INSERT INTO public.group_members (id, group_id, user_id, status, payment_status, subscription_deadline)
VALUES ('c0000001-0000-0000-0000-000000000004', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000003', 'active', 'active', NOW() + interval '180 days');

-- 5) vínculo ativo e pago SEM a data "paga até"
INSERT INTO public.group_members (id, group_id, user_id, status, payment_status, subscription_deadline)
VALUES ('c0000001-0000-0000-0000-000000000005', 'bbbbbbbb-0000-0000-0000-000000000001',
        'aaaaaaaa-0000-0000-0000-000000000004', 'active', 'active', NULL);

-- assinaturas
INSERT INTO public.user_subscriptions (id, user_id, group_id, status, billing_status, amount, billing_cycle, renewal_due_at)
VALUES
  -- 1) assinatura ativa da Carolina
  ('d0000001-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'bbbbbbbb-0000-0000-0000-000000000001', 'active', 'active', 25.90, 'monthly', NOW() + interval '180 days'),
  -- 2) assinatura ativa (espelho 'cancelled')
  ('d0000001-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000004',
   'bbbbbbbb-0000-0000-0000-000000000001', 'active', 'active', 25.90, 'monthly', NOW() + interval '180 days'),
  -- 4) assinatura cancelada, mas o vínculo está ativo e pago
  ('d0000001-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000003',
   'bbbbbbbb-0000-0000-0000-000000000001', 'cancelled', 'cancelled', 25.90, 'monthly', NOW() + interval '180 days');

-- estado inicial (para conferir o antes/depois)
SELECT 'ANTES' AS momento, u.email, gm.status::text AS membro, gm.payment_status::text AS pagamento,
       gm.subscription_deadline AS paga_ate, us.status::text AS assinatura
FROM public.group_members gm
JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.user_subscriptions us ON us.user_id = gm.user_id AND us.group_id = gm.group_id
ORDER BY u.email;
