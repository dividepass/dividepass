-- ============================================================================
-- Schema de TESTE para o SQL do agendamento da reconciliação
-- (database/add-reconcile-cron.sql).
--
-- Não é o banco de produção: é o mínimo para o script rodar inteiro no
-- Postgres local e pegar erro de sintaxe antes de colar no painel.
--
--   psql -U postgres -d postgres -f scripts/test-cron-reconciliacao-schema.sql
--   psql -U postgres -d postgres -f database/add-reconcile-cron.sql
-- ============================================================================

DROP SCHEMA IF EXISTS cron CASCADE;
DROP TABLE IF EXISTS public.app_settings CASCADE;

CREATE SCHEMA cron;

-- Tabela real do pg_cron (só o que o script usa).
CREATE TABLE cron.job (
  jobid    bigserial PRIMARY KEY,
  jobname  text NOT NULL,
  schedule text NOT NULL,
  command  text NOT NULL,
  active   boolean NOT NULL DEFAULT true
);

-- Assinatura do pg_cron: agendar por NOME.
CREATE FUNCTION cron.schedule(p_jobname text, p_schedule text, p_command text)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_id bigint;
BEGIN
  INSERT INTO cron.job (jobname, schedule, command)
  VALUES (p_jobname, p_schedule, p_command)
  RETURNING jobid INTO v_id;
  RETURN v_id;
END;
$$;

CREATE FUNCTION cron.unschedule(p_jobname text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM cron.job WHERE jobname = p_jobname;
  RETURN true;
END;
$$;

-- Tabela que o projeto usa para guardar segredo (chave/valor).
CREATE TABLE public.app_settings (
  key   text PRIMARY KEY,
  value text
);

-- Confere o que o script espera encontrar.
SELECT 'schema de teste pronto' AS status;
