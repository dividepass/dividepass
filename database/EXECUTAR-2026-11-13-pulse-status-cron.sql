-- ============================================================================
-- EXECUTAR-2026-11-13-pulse-status-cron.sql
-- ============================================================================
-- CRON DE SINCRONIZAÇÃO DE STATUS DOS GRUPOS COM A PULSE (a cada 5 horas)
-- ============================================================================
--
-- O QUE ESTE ARQUIVO FAZ
-- ---------------------
-- Cria o job de cron `pulse-status`, que roda DE 5 EM 5 HORAS e chama a edge
-- function `pulse-status`.
--
-- A função lê o catálogo da Pulse (1 chamada de `list_packages`) e deixa cada
-- grupo "Via Parceiro" igual ao produto na Pulse:
--
--   Pulse "Na vitrine"   → grupo `open`   + `public`  → liberado e clicável
--   Pulse "Indisponível" → grupo `closed` + `private` → DESATIVADO
--
-- Um grupo desativado não aceita mais ninguém:
--   - sai da vitrine;
--   - o `create-payment` recusa (403 `grupo_desativado`);
--   - o `joinGroup` recusa (ninguém entra no grupo);
--   - o checkout mostra a tela "Esgotado" em vez de cobrar.
--
-- E VOLTA: quando a Pulse volta a liberar o produto, o grupo é reativado e
-- volta para a vitrine.
--
-- POR QUE 5 HORAS (e não 5 MINUTOS, como o `pulse-poll`)
-- -------------------------------------------------------
-- O estoque (tag "Esgotado") é coisa rápida: o `pulse-poll` atualiza a cada 5
-- minutos. O STATUS do produto é mais estável — o parceiro rarely tira e
-- coloca produto do cardápio em minutos. De 5 em 5 horas o grupo continua
-- "sempre em sincronia" sem gastar chamada da API à toa.
--
-- COMO VER O RESULTADO
-- --------------------
--   SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = 'pulse-status';
--   -- e o log da edge function no painel do Supabase (Edge Functions > pulse-status > Logs)
--
-- IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ============================================================================

DO $do$
DECLARE
  v_existe boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: o job pulse-status NAO foi criado. Crie a extensão e rode o bloco de novo.';
    RETURN;
  END IF;

  -- O segredo do cron: usa o mesmo `pulse_cron_secret` (a função aceita
  -- `pulse_cron_secret`, `pulse_poll_secret` e `pulse_status_secret`).
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'pulse_cron_secret') THEN
    INSERT INTO public.app_settings (key, value)
    VALUES (
      'pulse_cron_secret',
      md5(random()::text || clock_timestamp()::text)
        || md5(random()::text || clock_timestamp()::text)
    );
    RAISE NOTICE 'Segredo pulse_cron_secret criado.';
  ELSE
    RAISE NOTICE 'Segredo pulse_cron_secret ja existe.';
  END IF;

  -- `cron.unschedule` só pode ser chamado se o job existe (pelo nome).
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pulse-status') INTO v_existe;
  IF v_existe THEN
    PERFORM cron.unschedule('pulse-status');
    RAISE NOTICE 'Job pulse-status removido para recriar.';
  END IF;

  -- 0 */5 * * * = minuto 0, a cada 5 horas (00h, 05h, 10h, 15h, 20h UTC).
  PERFORM cron.schedule(
    'pulse-status',
    '0 */5 * * *',
    $cmd$
      select net.http_post(
        url := 'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/pulse-status',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT value FROM public.app_settings WHERE key = 'pulse_cron_secret'
          )
        ),
        body := '{}'::jsonb
      );
    $cmd$
  );
  RAISE NOTICE 'Job pulse-status criado (a cada 5 horas).';
END $do$;
