-- ============================================================================
-- RELIGA O JOB DE RECONCILIAÇÃO DE PAGAMENTOS (07/11/2026)
--
-- O job foi PAUSADO a pedido do Gabriel, depois do incidente do
-- `payment_method` (VARCHAR(50)). Enquanto ele roda, ele pergunta à IO Pay
-- o status de transações antigas e LIBERA o acesso de quem já pagou — nunca
-- cobra. O consumo era de ~21 chamadas à API do IO Pay a cada 15 minutos.
--
-- O AGENDAMENTO é o que foi pausado; a função continua no ar e pode ser
-- chamada na mão:
--
--   node scripts\checar-reconciliacao.mjs
--
-- Para religar o agendamento (a cada 15 minutos):
--
--   node scripts\supabase-sql.mjs database\religar-reconcile-payments.sql
--
-- O que fica sem a rede de segurança enquanto estiver pausado: quem paga o
-- Pix pelo aplicativo do banco e FECHA a aba antes de a confirmação chegar.
-- O caminho normal (webhook da IO Pay) continua funcionando.
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payments') THEN
    PERFORM cron.unschedule('reconcile-payments');
    RAISE NOTICE 'Job antigo removido antes de recriar.';
  END IF;
END $$;

SELECT cron.schedule(
  'reconcile-payments',
  '*/15 * * * *',
  $$
    select net.http_post(
      url := 'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (
          SELECT value FROM public.app_settings WHERE key = 'reconcile_payments_cron_secret'
        )
      ),
      body := '{}'::jsonb
    );
  $$
);

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname = 'reconcile-payments';
