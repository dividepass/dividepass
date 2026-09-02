-- ============================================================
-- MIGRATION: Agendamento diário para processar faturas vencidas
-- ============================================================

-- Garante as extensões necessárias
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Tabela para armazenar secrets/configurações acessíveis pelo cron
CREATE TABLE IF NOT EXISTS app_settings (
    key     TEXT PRIMARY KEY,
    value   TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Secret usado pelo cron e pela Edge Function.
-- IMPORTANTE: use o mesmo valor na variável de ambiente OVERDUE_CRON_SECRET da Edge Function.
INSERT INTO app_settings (key, value)
VALUES ('overdue_cron_secret', 'dp-overdue-cron-2026-secure-key-change-me')
ON CONFLICT (key) DO NOTHING;

INSERT INTO app_settings (key, value)
VALUES ('supabase_url', 'https://lasoouwboxspstqvjbsv.supabase.co')
ON CONFLICT (key) DO NOTHING;

-- Remove agendamento anterior caso exista
SELECT cron.unschedule('process-overdue-invoices') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'process-overdue-invoices'
);

-- Agenda execução diária às 06:00 UTC
SELECT cron.schedule(
  'process-overdue-invoices',
  '0 6 * * *',
  $$
    WITH secrets AS (
      SELECT
        MAX(CASE WHEN key = 'supabase_url' THEN value END) AS supabase_url,
        MAX(CASE WHEN key = 'overdue_cron_secret' THEN value END) AS overdue_secret
      FROM app_settings
      WHERE key IN ('supabase_url', 'overdue_cron_secret')
    )
    SELECT net.http_post(
      url := (SELECT supabase_url FROM secrets) || '/functions/v1/process-overdue-invoices',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT overdue_secret FROM secrets)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);
