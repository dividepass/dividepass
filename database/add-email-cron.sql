-- ============================================================================
-- AGENDAMENTO: E-MAILS DE CICLO DE VIDA (todo dia às 09h BRT)
-- ============================================================================
-- Data: 2026-10-27
--
-- O QUE FAZ
-- ---------
-- Dispara a edge function `send-lifecycle-emails`, que cuida de três e-mails
-- automáticos do cliente:
--
--   1) Boas-vindas — de quem se cadastrou e ainda não recebeu.
--   2) Lembrete de renovação — das assinaturas que vencem nos próximos dias.
--   3) Aviso de atraso — das que venceram e ainda estão dentro da carência.
--
-- A trava de duplicidade é o `dedup_key` do `email_logs` (índice UNIQUE):
-- rodar o job duas vezes NÃO manda o mesmo e-mail duas vezes.
--
-- COMO APLICAR
-- ------------
-- No SQL Editor do Supabase (roda como postgres). É seguro rodar mais de uma
-- vez: o agendamento anterior é removido antes de recriar.
--
-- ⚠️ ORDEM DE PUBLICAÇÃO
--    1) `database/add-email-management.sql` (colunas e configurações)
--    2) ESTE SQL (agendamento)
--    3) as edge functions (send-lifecycle-emails, send-welcome-email)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- ----------------------------------------------------------------------------
-- 1) Segredo do job
--
--    A edge function aceita o SERVICE_ROLE_KEY, o BILLING_CRON_SECRET do
--    ambiente ou qualquer um dos segredos guardados em app_settings.
-- ----------------------------------------------------------------------------
INSERT INTO app_settings (key, value)
VALUES ('email_cron_secret', 'dp-email-lifecycle-cron-2026-secure-key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ----------------------------------------------------------------------------
-- 2) Remover agendamento anterior (se houver)
-- ----------------------------------------------------------------------------
SELECT cron.unschedule('send-lifecycle-emails') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'send-lifecycle-emails'
);

-- ----------------------------------------------------------------------------
-- 3) Agendar todo dia às 12:00 UTC (09h BRT)
--
--    09h BRT dá tempo do aviso de renovação chegar de manhã, que é quando a
--    pessoa decide renewing — e ainda antes do job de cobrança das 11h, para
--    que a pessoa já tenha regularizado antes da cobrança.
-- ----------------------------------------------------------------------------
SELECT cron.schedule(
  'send-lifecycle-emails',
  '0 12 * * *',
  $$
    WITH secrets AS (
      SELECT
        MAX(CASE WHEN key = 'supabase_url' THEN value END) AS supabase_url,
        MAX(CASE WHEN key = 'email_cron_secret' THEN value END) AS email_secret
      FROM app_settings
      WHERE key IN ('supabase_url', 'email_cron_secret')
    )
    SELECT net.http_post(
      url := (SELECT supabase_url FROM secrets) || '/functions/v1/send-lifecycle-emails',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT email_secret FROM secrets)
      ),
      body := '{}'::jsonb
    ) AS request_id;
  $$
);

-- ----------------------------------------------------------------------------
-- 4) Conferir
-- ----------------------------------------------------------------------------
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname = 'send-lifecycle-emails';

-- ============================================================================
-- TESTE MANUAL (sem esperar o agendamento)
-- ============================================================================
--
-- No SQL Editor:
--
--   SELECT net.http_post(
--     url := (SELECT value FROM app_settings WHERE key = 'supabase_url')
--            || '/functions/v1/send-lifecycle-emails',
--     headers := jsonb_build_object(
--       'Content-Type', 'application/json',
--       'Authorization', 'Bearer ' || (SELECT value FROM app_settings WHERE key = 'email_cron_secret')
--     ),
--     body := '{}'::jsonb
--   );
--
-- Ou pelo painel admin: Cobranças > Crons > "Executar agora" no job
-- `send-lifecycle-emails`.
-- ============================================================================
