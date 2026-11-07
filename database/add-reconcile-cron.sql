-- ============================================================================
-- AGENDAMENTO DA RECONCILIAÇÃO DE PAGAMENTOS (idempotente)
--
-- Data: 01/11/2026
-- Motivo: a edge function `reconcile-payments` pergunta à IO Pay o status real
-- de cada transação e libera quem pagou e não entrou no grupo. Ela precisa
-- RODAR sozinha — nem toda pessoa deixa a aba do checkout aberta, e quem paga
-- no PIX sai do navegador para pagar no app do banco.
--
-- POR QUE ESTE ARQUIVO EXISTE
-- ---------------------------
-- O job era só um trecho comentado dentro de
-- `database/pagamentos-sem-liberacao-2026-11-01.sql` (que é um arquivo de
-- DIAGNÓSTICO, só SELECT). Aqui ele vira SQL de verdade, pronto para rodar.
--
-- COMO APLICAR
-- ------------
--   node scripts/publicar-pendencias-supabase.mjs --cron
--
-- ou colar no SQL Editor do painel do Supabase.
-- ============================================================================

-- 1. Garante que o segredo da reconciliação existe.
--    A função aceita o segredo guardado em `app_settings`
--    (`reconcile_payments_cron_secret`) ou o secret `BILLING_CRON_SECRET`.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'reconcile_payments_cron_secret') THEN
    INSERT INTO public.app_settings (key, value)
    VALUES (
      'reconcile_payments_cron_secret',
      md5(random()::text || clock_timestamp()::text)
        || md5(random()::text || clock_timestamp()::text)
    );
    RAISE NOTICE 'Segredo reconcile_payments_cron_secret criado.';
  ELSE
    RAISE NOTICE 'Segredo reconcile_payments_cron_secret ja existe.';
  END IF;
END $$;

-- 2. (Re)cria o job de 15 em 15 minutos.
--    `cron.unschedule` nao erra quando o job nao existe (nao pode ser usado
--    dentro de DO, entao fica aqui, com o IF EXISTS).
DO $$
DECLARE
  v_existe boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payments') INTO v_existe;

  IF v_existe THEN
    PERFORM cron.unschedule('reconcile-payments');
    RAISE NOTICE 'Job reconcile-payments removido para recriar.';
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

-- 3. Confere: tem que aparecer o job com a função correta.
SELECT jobid, jobname, schedule, active, command
FROM cron.job
WHERE jobname = 'reconcile-payments';
