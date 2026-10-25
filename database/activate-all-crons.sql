-- ============================================================================
-- AGENDAMENTOS (pg_cron) — DividePass
--
-- As cobranças automáticas dependem de DUAS coisas e basta uma delas estar
-- errada para nenhuma cobrança sair:
--
--   1. o job existir no `cron.job` (este arquivo);
--   2. a Edge Function estar publicada com `verify_jwt = false`.
--
-- O item (2) é o que já quebrou produção: o `config.toml` do projeto não
-- declarava `process-recurring-billing`, então o padrão `verify_jwt = true`
-- fazia o gateway do Supabase responder 401 `UNAUTHORIZED_INVALID_JWT_FORMAT`
-- ANTES do código rodar — a função nunca executava, e o painel mostrava a
-- lista de jobs como se estivesse tudo certo.
--
-- O `config.toml` agora declara `verify_jwt = false` para as funções de
-- cron. AO REDEPLOYAR, use `supabase functions deploy <nome> --no-verify-jwt`
-- OU deixe o `config.toml` no commit (o deploy do Supabase respeita).
--
-- Como aplicar: Supabase Dashboard > SQL Editor > cole e execute.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ----------------------------------------------------------------------------
-- Segredos
-- ----------------------------------------------------------------------------
INSERT INTO app_settings (key, value)
VALUES ('recurring_billing_cron_secret', 'dp-recurring-billing-cron-2026-secure-key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO app_settings (key, value)
VALUES ('supabase_url', 'https://lasoouwboxspstqvjbsv.supabase.co')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ----------------------------------------------------------------------------
-- 1) Cobranças recorrentes — todo dia às 11:00 BRT (14:00 UTC)
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('process-recurring-billing')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-recurring-billing');

SELECT cron.schedule(
  'process-recurring-billing',
  '0 14 * * *',
  $$
    WITH secrets AS (
      SELECT
        MAX(CASE WHEN key = 'supabase_url' THEN value END) AS supabase_url,
        MAX(CASE WHEN key = 'recurring_billing_cron_secret' THEN value END) AS billing_secret
      FROM app_settings
      WHERE key IN ('supabase_url', 'recurring_billing_cron_secret')
    )
    SELECT net.http_post(
      url := (SELECT supabase_url FROM secrets) || '/functions/v1/process-recurring-billing',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT billing_secret FROM secrets)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- ----------------------------------------------------------------------------
-- 2) Faturas vencidas — todo dia às 03:00 BRT (06:00 UTC)
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('process-overdue-invoices')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-overdue-invoices');

SELECT cron.schedule(
  'process-overdue-invoices',
  '0 6 * * *',
  $$
    WITH secrets AS (
      SELECT
        MAX(CASE WHEN key = 'supabase_url' THEN value END) AS supabase_url,
        MAX(CASE WHEN key = 'recurring_billing_cron_secret' THEN value END) AS billing_secret
      FROM app_settings
      WHERE key IN ('supabase_url', 'recurring_billing_cron_secret')
    )
    SELECT net.http_post(
      url := (SELECT supabase_url FROM secrets) || '/functions/v1/process-overdue-invoices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT billing_secret FROM secrets)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- ----------------------------------------------------------------------------
-- 3) Status das assinaturas — todo dia às 00:00 BRT (03:00 UTC)
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('update-subscription-statuses')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'update-subscription-statuses');

SELECT cron.schedule(
  'update-subscription-statuses',
  '0 3 * * *',
  $$
    WITH secrets AS (
      SELECT
        MAX(CASE WHEN key = 'supabase_url' THEN value END) AS supabase_url,
        MAX(CASE WHEN key = 'recurring_billing_cron_secret' THEN value END) AS billing_secret
      FROM app_settings
      WHERE key IN ('supabase_url', 'recurring_billing_cron_secret')
    )
    SELECT net.http_post(
      url := (SELECT supabase_url FROM secrets) || '/functions/v1/update-subscription-statuses',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT billing_secret FROM secrets)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- ----------------------------------------------------------------------------
-- 4) Verificacao
--
-- ATENCAO: `cron.job` nao tem a coluna `next_run` (o pg_cron calcula o
-- proximo disparo, nao grava). Pedir `next_run` quebra o script inteiro com
-- 42703 — e, como o SQL Editor roda o script numa transacao, os
-- agendamentos criados antes do erro tambem voltavam.
--
-- Se `active` vier false, o job esta desativado. Se NAO vier nenhuma linha,
-- o job nao existe — e por isso que nenhuma cobrança sai.
-- ----------------------------------------------------------------------------
SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN (
  'process-recurring-billing',
  'process-overdue-invoices',
  'update-subscription-statuses'
)
ORDER BY jobname;

-- Ultimas execucoes (pg_cron guarda o historico quando o job termina com
-- sucesso e `cron.log` esta habilitado).
-- SELECT jobid, runid, status, start_time, end_time FROM cron.job_run_details
-- ORDER BY start_time DESC LIMIT 20;
