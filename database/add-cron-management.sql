-- ============================================================================
-- GESTAO REAL DOS AGENDAMENTOS (pg_cron)
--
-- O painel admin de Cron usava a RPC `exec_sql` (SQL arbitrario) para ler
-- `cron.job`. Essa RPC NAO EXISTE em producao — e o fallback do front devolvia
-- uma lista INVENTADA de 3 jobs, sempre "Ativos". O admin via um agendamento
-- que talvez nem existisse, e nao conseguia saber o que rodava de verdade.
--
-- Aqui vao duas RPCs ESTREITAS: so leem e so alteram `cron.job`. Nada de SQL
-- arbitrario, nada de execucao de comandos.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > cole e execute.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) manage_cron_jobs(): lista os agendamentos
--
-- ATENCAO: `cron.job` nao tem as colunas `next_run` nem `description` no
-- pg_cron do Supabase (o proximo disparo e calculado pelo pg_cron, nao fica
-- gravado). Referenciar `j.next_run` faz a RPC nem ser criada — erro
-- 42703 "column next_run does not exist".
--
-- Por isso a RPC devolve SO as colunas que existem, e o proximo disparo e a
-- descricao sao calculados na edge function (que tem o helper `getNextRun`).
--
-- ATENCAO 2: `CREATE OR REPLACE FUNCTION` NAO permite mudar a assinatura de
-- retorno (os OUT params). Se a versao anterior desta RPC ja existir no
-- banco, o CREATE falha com 42P13 "cannot change return type of existing
-- function". Por isso o DROP vem antes — e torna o script reexecutavel.
--
-- (E o motivo de a RPC antiga existir mesmo com `j.next_run` dentro: em
-- PL/pgSQL o corpo so e validado na PRIMEIRA EXECUCACAO, nao no CREATE.)
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.manage_cron_jobs();

CREATE OR REPLACE FUNCTION public.manage_cron_jobs()
RETURNS TABLE (
  jobid        integer,
  jobname      text,
  schedule     text,
  command      text,
  active       boolean,
  type         text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
BEGIN
  RETURN QUERY
  SELECT
    j.jobid::integer,
    j.jobname,
    j.schedule,
    j.command,
    j.active,
    CASE
      WHEN j.jobname ILIKE '%recurring%'      THEN 'billing'
      WHEN j.jobname ILIKE '%overdue%'       THEN 'overdue'
      WHEN j.jobname ILIKE '%subscription%'   THEN 'status'
      ELSE 'custom'
    END
  FROM cron.job j
  ORDER BY j.jobid;
END;
$$;

-- ----------------------------------------------------------------------------
-- 2) toggle_cron_job(): ativa/desativa UM agendamento existente
-- ----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.toggle_cron_job(integer, boolean);

CREATE OR REPLACE FUNCTION public.toggle_cron_job(
  p_jobid   integer,
  p_active  boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_jobname  text;
  v_schedule text;
  v_command  text;
  v_active   boolean;
  v_exists   boolean := false;
BEGIN
  SELECT jobname, schedule, command, active
  INTO v_jobname, v_schedule, v_command, v_active
  FROM cron.job
  WHERE jobid = p_jobid;

  IF v_jobname IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', format('Nao existe agendamento com jobid %s', p_jobid)
    );
  END IF;

  IF v_active = p_active THEN
    -- Ja esta no estado desejado: nao mexe no job.
    RETURN jsonb_build_object(
      'success', true,
      'jobid', p_jobid,
      'jobname', v_jobname,
      'schedule', v_schedule,
      'active', v_active
    );
  END IF;

  IF p_active THEN
    -- Reativar: `cron.alter_job` preserva o comando original. Se a versao do
    -- pg_cron nao tiver `alter_job`, o job e recriado com o MESMO schedule e
    -- o MESMO comando (o nome e unico, entao nao duplica).
    BEGIN
      EXECUTE format('SELECT cron.alter_job(%s, active := true)', p_jobid);
    EXCEPTION WHEN OTHERS THEN
      EXECUTE format('SELECT cron.schedule(%L, %L, %L)', v_jobname, v_schedule, v_command);
    END;
  ELSE
    -- Desativar: `cron.unschedule` remove o job. Guardamos schedule e
    -- comando no retorno para o admin conseguir reativar depois.
    EXECUTE format('SELECT cron.unschedule(%s)', p_jobid);
  END IF;

  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobid = p_jobid) INTO v_exists;

  -- Se o job foi recriado (fallback de `alter_job`), ele ganha um jobid novo.
  -- Devolve o id atual para a UI nao ficar com um id morto.
  SELECT jobid::integer INTO p_jobid FROM cron.job WHERE jobname = v_jobname;

  RETURN jsonb_build_object(
    'success', true,
    'jobid', p_jobid,
    'jobname', v_jobname,
    'schedule', v_schedule,
    'active', v_exists AND p_active
  );
END;
$$;

-- ----------------------------------------------------------------------------
-- 3) Permissoes: SOMENTE o service_role (as edge functions) pode usar.
--    O role `authenticated` (usuarios logados) nao enxerga `cron.job`.
-- ----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.manage_cron_jobs() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.toggle_cron_job(integer, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.manage_cron_jobs() TO service_role;
GRANT EXECUTE ON FUNCTION public.toggle_cron_job(integer, boolean) TO service_role;

-- ----------------------------------------------------------------------------
-- 4) Recarregar o cache de schema do PostgREST
--
-- A RPC antiga (8 colunas) pode continuar no cache do PostgREST mesmo
-- depois do DROP + CREATE. Sem isto, `/rest/v1/rpc/manage_cron_jobs` continua
-- devolvendo a assinatura antiga e o painel de cron mostra "indisponivel".
-- ----------------------------------------------------------------------------
NOTIFY pgrst, 'reload schema';
