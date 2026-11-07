-- =============================================================================
-- DividePass — schema de TESTE para database/fix-admin-delete-group-2026-11-06.sql
-- =============================================================================
-- Reproduz o estado de PRODUÇÃO que causa o bug:
--   - payments.group_id -> FK SEM "ON DELETE" (default = NO ACTION), exatamente
--     como o database/add-payment-flow.sql:30 criou em produção;
--   - users.role como texto (o is_admin() do projeto olha users.role e o
--     app_metadata.role do JWT);
--   - RLS ligado em groups com as policies canônicas do projeto;
--   - stubs de auth.uid()/auth.jwt() para simular o login.
--
-- As tabelas filhas (group_members, user_subscriptions, group_credentials) já
-- vêm com ON DELETE CASCADE, como no schema canônico.
-- =============================================================================

DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.payments, public.group_members, public.user_subscriptions,
                     public.group_credentials, public.groups, public.users CASCADE;

CREATE SCHEMA auth;

-- ── Stubs do Supabase (o JWT chega em GUCs) ────────────────────────────────
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- ── Tabelas ────────────────────────────────────────────────────────────────
CREATE TABLE public.users (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  email      text,
  role       text DEFAULT 'user'
);

CREATE TABLE public.groups (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text,
  owner_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status     text DEFAULT 'open',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.payments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES public.users(id) ON DELETE CASCADE,
  -- >>> AQUI ESTÁ O BUG DE PRODUÇÃO: sem ON DELETE (= NO ACTION) <<<
  group_id   uuid REFERENCES public.groups(id),
  amount     numeric(10,2) NOT NULL,
  status     text DEFAULT 'pending',
  paid_at    timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.group_members (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  status     varchar(20) DEFAULT 'active'
);

CREATE TABLE public.user_subscriptions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  -- grupo é NOT NULL: prova que SET NULL não serviria aqui (tem de ser CASCADE)
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE,
  status     text DEFAULT 'active'
);

CREATE TABLE public.group_credentials (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   uuid NOT NULL REFERENCES public.groups(id) ON DELETE CASCADE
);

-- ── Papéis do Supabase ─────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE ROLE service_role NOLOGIN BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT USAGE ON SCHEMA public, auth TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON FUNCTION auth.uid(), auth.jwt() TO anon, authenticated, service_role;

-- ── RLS de groups, como em produção ────────────────────────────────────────
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Grupos públicos" ON public.groups FOR SELECT USING (true);
CREATE POLICY "Users create own groups" ON public.groups FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users update own groups" ON public.groups FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users delete own groups" ON public.groups FOR DELETE USING (auth.uid() = owner_id);

-- payments: o usuário enxerga só o próprio pagamento (é o que o helper
-- SECURITY DEFINER contorna)
CREATE POLICY "Usuários veem seus pagamentos" ON public.payments FOR SELECT USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.groups TO authenticated;
GRANT SELECT ON public.payments TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- ── Dados do teste ─────────────────────────────────────────────────────────
INSERT INTO public.users (id, name, email, role) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Admin', 'admin@dividepass.com', 'admin'),
  ('22222222-2222-2222-2222-222222222222', 'Dono', 'dono@dividepass.com', 'user'),
  ('33333333-3333-3333-3333-333333333333', 'Membro', 'membro@dividepass.com', 'user');

-- g1: grupo do dono COM pagamento confirmado (o admin apaga)
-- g2: grupo do dono SEM pagamento (o dono apaga)
-- g3: grupo de outro dono (o dono do g1 não pode mexer)
-- g4: grupo do dono COM pagamento confirmado (o dono tenta — tem de ser barrado)
-- g5: grupo COM pagamento confirmado (admin via users.role, sem app_metadata)
INSERT INTO public.groups (id, name, owner_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', 'Grupo com pagamento (admin apaga)', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'Grupo sem pagamento (dono apaga)', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'Grupo de outro', '33333333-3333-3333-3333-333333333333'),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'Grupo com pagamento (dono tenta)', '22222222-2222-2222-2222-222222222222'),
  ('aaaaaaaa-0000-0000-0000-000000000005', 'Grupo com pagamento (admin por users.role)', '22222222-2222-2222-2222-222222222222');

INSERT INTO public.group_members (group_id, user_id, status) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000005', '33333333-3333-3333-3333-333333333333', 'active');

INSERT INTO public.user_subscriptions (user_id, group_id, status) VALUES
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001', 'active'),
  ('33333333-3333-3333-3333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000005', 'active');

INSERT INTO public.group_credentials (group_id) VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001'),
  ('aaaaaaaa-0000-0000-0000-000000000005');

INSERT INTO public.payments (id, user_id, group_id, amount, status, paid_at) VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000001', 25.00, 'paid', now()),
  ('bbbbbbbb-0000-0000-0000-000000000002', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000003', 25.00, 'pending', null),
  ('bbbbbbbb-0000-0000-0000-000000000003', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000004', 30.00, 'paid', now()),
  ('bbbbbbbb-0000-0000-0000-000000000004', '33333333-3333-3333-3333-333333333333',
   'aaaaaaaa-0000-0000-0000-000000000005', 40.00, 'paid', now());
