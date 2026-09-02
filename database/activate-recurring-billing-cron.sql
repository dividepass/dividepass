-- ============================================================
-- MIGRATION: Agendar cron de cobranças recorrentes (11:00 BRT)
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Secret usado pelo cron e pela Edge Function
INSERT INTO app_settings (key, value)
VALUES ('recurring_billing_cron_secret', 'dp-recurring-billing-cron-2026-secure-key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- Garantir que supabase_url existe
INSERT INTO app_settings (key, value)
VALUES ('supabase_url', 'https://lasoouwboxspstqvjbsv.supabase.co')
ON CONFLICT (key) DO NOTHING;

-- Remover agendamento anterior caso exista
SELECT cron.unschedule('process-recurring-billing') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-recurring-billing'
);

-- Agendar execução diaria as 14:00 UTC (11:00 BRT)
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

-- Verificar se foi criado
SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'process-recurring-billing';
