-- ============================================================================
-- PAUSA O JOB DE RECONCILIAÇÃO DE PAGAMENTOS
--
-- O oposto de `religar-reconcile-payments.sql`. Remove o agendamento (a
-- função continua no ar — dá para chamar na mão).
--
--   node scripts\supabase-sql.mjs database\pausar-reconcile-payments.sql
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payments') THEN
    PERFORM cron.unschedule('reconcile-payments');
    RAISE NOTICE 'reconcile-payments pausado.';
  ELSE
    RAISE NOTICE 'reconcile-payments ja estava pausado.';
  END IF;
END $$;

SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobid;
