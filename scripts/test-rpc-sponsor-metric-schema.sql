-- ============================================================================
-- Schema de TESTE para a RPC `increment_sponsor_metric`
-- (database/apply-pending-2026-11-01.sql).
--
-- Reproduz o mínimo do banco de produção:
--   public.sponsored_offers  (a tabela que a RPC escreve)
--   public.users             (a tabela que a limpeza do script apaga)
--   os papéis anon / authenticated / service_role (no Supabase eles já existem)
--
--   psql -U postgres -d postgres -f scripts/test-rpc-sponsor-metric-schema.sql
--   psql -U postgres -d postgres -f database/apply-pending-2026-11-01.sql
-- ============================================================================

DROP TABLE IF EXISTS public.sponsored_offers CASCADE;
DROP TABLE IF EXISTS public.users CASCADE;
DROP SCHEMA IF EXISTS auth CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

-- A limpeza de perfis órfãos do mesmo arquivo precisa destas duas tabelas.
CREATE SCHEMA auth;

CREATE TABLE auth.users (
  id    uuid PRIMARY KEY,
  email text
);

CREATE TABLE public.users (
  id         uuid PRIMARY KEY,
  email      text,
  created_at timestamptz DEFAULT now()
);

-- Um perfil de teste que o script pode apagar.
INSERT INTO auth.users (id, email) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'dp.prod.teste@dividepass.com');
INSERT INTO public.users (id, email) VALUES
  ('b1111111-1111-1111-1111-111111111111', 'dp.prod.teste@dividepass.com');

-- A tabela da oferta patrocinada: as MESMAS colunas que a RPC mexe.
CREATE TABLE public.sponsored_offers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id  uuid,
  group_id    uuid,
  sponsor_name text,
  headline    text,
  status      text NOT NULL DEFAULT 'active',
  clicks      integer NOT NULL DEFAULT 0,
  impressions integer NOT NULL DEFAULT 0,
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end   timestamptz
);

-- O pacote de ofertas: a migration real cria views; aqui basta a tabela.

-- Uma oferta ativa dentro do período e uma pausada (a RPC só conta a ativa).
INSERT INTO public.sponsored_offers (headline, status, clicks, impressions)
VALUES
  ('Oferta ativa', 'active', 0, 0),
  ('Oferta pausada', 'paused', 0, 0);

SELECT 'schema de teste pronto' AS status;
