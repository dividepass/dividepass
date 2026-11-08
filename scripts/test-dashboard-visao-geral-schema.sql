-- Schema mínimo para validar
-- `database/EXECUTAR-2026-11-08-dashboard-visao-geral.sql`
--
-- Reproduz as MESMAS tabelas/colunas/enums que as funções usam, com os tipos
-- reais de produção. Roda num banco local descartável.
DROP SCHEMA IF EXISTS auth CASCADE;
DROP TABLE IF EXISTS public.payments, public.groups, public.streaming_services,
                     public.users CASCADE;
DROP TYPE IF EXISTS public.payment_status, public.service_category CASCADE;

CREATE TYPE public.payment_status AS ENUM ('pending','paid','failed','refunded','cancelled');
CREATE TYPE public.service_category AS ENUM ('streaming','musica','ia','cursos','produtividade',
                                             'ferramentas','leitura','games','saude','seguranca');

CREATE TABLE public.users (
  id         uuid PRIMARY KEY,
  email      text,
  name       text,
  nickname   text,
  avatar_url text,
  role       text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE public.streaming_services (
  id             uuid PRIMARY KEY,
  name           varchar,
  full_name      varchar,
  color          varchar,
  icon           varchar,
  icon_url       text,
  slug           text,
  description    text,
  official_price numeric(10,2),
  max_group_size integer,
  status         varchar DEFAULT 'active',
  category       public.service_category,
  featured       boolean DEFAULT false,
  pinned         boolean DEFAULT false,
  official_url   text,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE public.groups (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid REFERENCES public.streaming_services(id) ON DELETE CASCADE,
  name            varchar,
  price_per_slot  numeric(10,2),
  max_size        integer,
  status          varchar DEFAULT 'open',
  created_at      timestamptz DEFAULT now(),
  owner_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  slug            text,
  is_official     boolean DEFAULT false,
  approval_status varchar DEFAULT 'approved',
  visibility      varchar DEFAULT 'public',
  has_slot_limit  boolean DEFAULT true
);

CREATE TABLE public.payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  group_id       uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  amount         numeric(10,2),
  status         public.payment_status DEFAULT 'pending',
  payment_type   text,
  official_price numeric(10,2),
  paid_amount    numeric(10,2),
  created_at     timestamptz DEFAULT now(),
  paid_at        timestamptz
);

-- ── Dados de teste ────────────────────────────────────────────────────────────
-- Netflix: 3 vendas (a mais vendida). Spotify: 2 vendas. HBO Max: 1 venda.
-- YouTube: 1 pagamento NÃO pago (não pode entrar no ranking de vendas).
-- Disney+: 1 venda, mas só com grupo PRIVADO (não aparece no catálogo público).
INSERT INTO public.users (id, name, nickname, avatar_url, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Allan Martins da Silva', NULL, 'https://ex.com/a.png', 'allan@ex.com'),
  ('22222222-2222-2222-2222-222222222222', 'Juscelino P.',               NULL, NULL,                        'jus@ex.com'),
  ('33333333-3333-3333-3333-333333333333', 'gabriel@email.com',           NULL, NULL,                        'gab@ex.com'),
  ('44444444-4444-4444-4444-444444444444', 'Ana Beatriz',                 NULL, 'https://ex.com/ana.png',      'ana@ex.com'),
  ('55555555-5555-5555-5555-555555555555', 'Carlos',                      NULL, NULL,                        'carlos@ex.com');

INSERT INTO public.streaming_services
  (id, name, slug, official_price, status, category, icon_url, color) VALUES
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Netflix',   'netflix',   55.90, 'active', 'streaming', 'https://ex.com/nf.png', '#E50914'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Spotify',   'spotify',   34.90, 'active', 'musica',    'https://ex.com/sp.png', '#1DB954'),
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Max',       'max',       39.90, 'active', 'streaming', 'https://ex.com/mx.png', '#5A2BE0'),
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'YouTube',   'youtube',   69.90, 'active', 'streaming', 'https://ex.com/yt.png', '#FF0000'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Disney Plus','disney-plus',43.90,'active','streaming', 'https://ex.com/dp.png', '#113CCF'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'Inativo',   'inativo',   10.00, 'inactive','streaming','https://ex.com/in.png', '#999999');

INSERT INTO public.groups
  (id, service_id, name, price_per_slot, status, visibility, max_size, created_at) VALUES
  ('a1a1a1a1-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Netflix Família',   23.88, 'open',   'public', 6, now() - interval '10 days'),
  ('a1a1a1a1-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Netflix Top',       19.90, 'open',   'public', 4, now() - interval '5 days'),
  ('b1b1b1b1-0000-0000-0000-000000000001', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Spotify Duo',        9.90, 'open',   'public', 2, now() - interval '3 days'),
  ('c1c1c1c1-0000-0000-0000-000000000001', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Max Torre',        29.90, 'open',   'public', 5, now() - interval '2 days'),
  ('d1d1d1d1-0000-0000-0000-000000000001', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'YouTube Família',   14.90, 'open',   'public', 6, now() - interval '1 day'),
  ('e1e1e1e1-0000-0000-0000-000000000001', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'Disney Privado',    12.00, 'open',   'private',4, now() - interval '1 day');

-- Pagamentos (o ranking só conta 'paid' + 'subscription')
INSERT INTO public.payments
  (user_id, group_id, amount, status, payment_type, official_price, paid_amount, created_at, paid_at) VALUES
  ('11111111-1111-1111-1111-111111111111', 'a1a1a1a1-0000-0000-0000-000000000001', 23.88, 'paid',    'subscription', 55.90, 23.88, now() - interval '9 days',  now() - interval '9 days'),
  ('22222222-2222-2222-2222-222222222222', 'a1a1a1a1-0000-0000-0000-000000000002', 19.90, 'paid',    'subscription', 55.90, 19.90, now() - interval '4 days',  now() - interval '4 days'),
  ('33333333-3333-3333-3333-333333333333', 'a1a1a1a1-0000-0000-0000-000000000001', 23.88, 'paid',    'subscription', 55.90, 23.88, now() - interval '2 days',  now() - interval '2 days'),
  ('44444444-4444-4444-4444-444444444444', 'b1b1b1b1-0000-0000-0000-000000000001',  9.90, 'paid',    'subscription', 34.90,  9.90, now() - interval '1 day',   now() - interval '1 day'),
  ('55555555-5555-5555-5555-555555555555', 'b1b1b1b1-0000-0000-0000-000000000001',  9.90, 'paid',    'subscription', 34.90,  9.90, now() - interval '30 hours',now() - interval '30 hours'),
  ('11111111-1111-1111-1111-111111111111', 'c1c1c1c1-0000-0000-0000-000000000001', 29.90, 'paid',    'subscription', 39.90, 29.90, now() - interval '20 hours',now() - interval '20 hours'),
  -- NÃO pago: não entra no ranking nem na lista de recentes
  ('22222222-2222-2222-2222-222222222222', 'd1d1d1d1-0000-0000-0000-000000000001', 14.90, 'pending', 'subscription', 69.90, 14.90, now() - interval '10 hours', NULL),
  -- Pagamento de outra natureza (entrada/saldo): também não conta
  ('33333333-3333-3333-3333-333333333333', 'b1b1b1b1-0000-0000-0000-000000000001',  9.90, 'paid',    'wallet',       34.90,  9.90, now() - interval '8 hours', now() - interval '8 hours');
