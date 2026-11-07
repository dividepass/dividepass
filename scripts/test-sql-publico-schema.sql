-- ============================================================================
-- Schema de TESTE para o arquivo que o Gabriel executa no SQL Editor:
--   database/EXECUTAR-2026-11-01-ofertas-patrocinadas.sql
--
-- Reproduz o mínimo do banco de produção para o arquivo inteiro rodar sem
-- erro: streaming_services, sponsored_offers, app_settings, o schema `cron`
-- e as extensões pg_cron/pg_net (o pg_extension é uma tabela de sistema, então
-- o teste só registra as extensões que já existem — o arquivo do Supabase
-- roda no banco real, onde elas estão habilitadas).
--
--   psql -U postgres -d postgres -f scripts/test-sql-publico-schema.sql
--   psql -U postgres -d postgres -f database/EXECUTAR-2026-11-01-ofertas-patrocinadas.sql
-- ============================================================================

DROP SCHEMA IF EXISTS cron CASCADE;
DROP TABLE IF EXISTS public.sponsored_offers CASCADE;
DROP TABLE IF EXISTS public.streaming_services CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;

CREATE TABLE public.streaming_services (
  id    uuid PRIMARY KEY,
  name  text NOT NULL,
  slug  text,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE public.sponsored_offers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  service_id      uuid REFERENCES public.streaming_services(id) ON DELETE CASCADE,
  group_id        uuid,
  sponsor_user_id uuid,
  sponsor_name    varchar(120) NOT NULL,
  headline        varchar(160) NOT NULL,
  description     text,
  badge           varchar(60)  NOT NULL DEFAULT 'Oferta em destaque',
  cta_label       varchar(60)  NOT NULL DEFAULT 'Ver oferta',
  cta_url         text,
  banner_url      text,
  placement       varchar(20) NOT NULL DEFAULT 'catalog'
                  CHECK (placement IN ('catalog', 'recommendation', 'both')),
  amount_paid     numeric(10,2) NOT NULL DEFAULT 0,
  period_start    timestamptz NOT NULL DEFAULT now(),
  period_end      timestamptz,
  status          varchar(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'ended')),
  priority        integer NOT NULL DEFAULT 0,
  impressions     integer NOT NULL DEFAULT 0,
  clicks          integer NOT NULL DEFAULT 0,
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sponsored_offers_target_chk
    CHECK (service_id IS NOT NULL OR group_id IS NOT NULL)
);

CREATE TABLE public.app_settings (
  key   text PRIMARY KEY,
  value text
);

-- O "Netflix" do seed de produção.
INSERT INTO public.streaming_services (id, name, slug) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Netflix', 'netflix'),
  ('22222222-2222-2222-2222-222222222222', 'Spotify', 'spotify');

-- Schema do pg_cron (o arquivo do Supabase usa o cron de verdade; aqui é mock)
CREATE SCHEMA cron;

CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  jobname  text NOT NULL,
  schedule text NOT NULL,
  command  text NOT NULL,
  active   boolean NOT NULL DEFAULT true
);

CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_jobname, p_schedule, p_command) RETURNING jobid INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION cron.unschedule(p_jobname text)
RETURNS boolean LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  RETURN true;
END;
$$;

SELECT 'schema de teste pronto' AS status;
