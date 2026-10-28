-- ============================================================================
-- REGRAS DE STATUS DA ASSINATURA (ATIVA / ATRASADA / CANCELADA)
-- ============================================================================
-- Data: 2026-10-27
--
-- O QUE MUDA
-- ----------
-- 1) Nova coluna `user_subscriptions.renewal_due_at`: o VENCIMENTO do ciclo.
--    É a fonte da verdade da regra de status.
--
--    Antes a única data era `next_charge_at`, mas ela anda para frente a cada
--    tentativa de cobrança (+1 dia, +2 dias). Quem teve o cartão recusado via
--    "atrasado" três dias antes do fim da carência. `renewal_due_at` não é
--    mexida nos retries: só quando o pagamento entra (data + ciclo).
--
-- 2) A carência passa a ser de 7 DIAS (antes eram 3 meses no job de status
--    e 5 dias no job de faturas):
--
--      ATIVA      vencimento > agora
--      ATRASADA   vencimento <= agora e ainda dentro da carência de 7 dias
--                 (grupo continua visível; acesso às credenciais bloqueado;
--                  aparece o card de renovação com botão de pagamento)
--      CANCELADA  passou da carência: assinatura cancelada, usuário
--                 desvinculado do grupo, cobranças agendadas canceladas.
--                 Só aparece no histórico de assinaturas.
--
-- 3) Índices para as queries do job de status (que roda todo dia).
--
-- COMO APLICAR
-- ------------
-- No SQL Editor do Supabase (roda como postgres). É seguro rodar mais de uma
-- vez: tudo é idempotente.
--
-- ⚠️ ORDEM DE PUBLICAÇÃO (importante)
--    1) ESTE SQL (cria a coluna `renewal_due_at`)
--    2) as edge functions (update-subscription-statuses, process-overdue-invoices,
--       process-recurring-billing, check-iopay-tx, confirm-payment,
--       force-confirm-payment, mercado-pago-webhook, create-payment)
--    3) o front (Vercel)
--
--    O front passa a SELECIONAR `renewal_due_at`. Se o front subir antes deste
--    SQL, o PostgREST devolve erro de coluna inexistente e as telas de
--    assinatura quebram. Portanto: SQL primeiro, sempre.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1) Coluna da data de vencimento do ciclo
-- ----------------------------------------------------------------------------
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS renewal_due_at TIMESTAMPTZ;

COMMENT ON COLUMN public.user_subscriptions.renewal_due_at IS
  'Vencimento do ciclo pago (data + ciclo). Fonte da verdade da regra de status: ATRASADA apos o vencimento, CANCELADA apos 7 dias de carencia. Nao muda a cada retry de cobranca.';

-- ----------------------------------------------------------------------------
-- 2) Backfill
--
--    Assinaturas ativas/legacy: o vencimento conhecido e o `next_charge_at`
--    (ou, na falta dele, o `expires_at`). Canceladas nao precisam: a regra ja
--    as considera terminais.
--
--    Para as que estao VENCIDAS ha mais de 7 dias, o proprio job de status
--    (update-subscription-statuses) faz o cancelamento na proxima execucao.
-- ----------------------------------------------------------------------------
UPDATE public.user_subscriptions
   SET renewal_due_at = COALESCE(next_charge_at, expires_at::TIMESTAMPTZ)
 WHERE renewal_due_at IS NULL
   AND status IN ('active', 'expired')
   AND (next_charge_at IS NOT NULL OR expires_at IS NOT NULL);

-- ----------------------------------------------------------------------------
-- 3) Normalizacao dos estados legados
--
--    O `expired` legado significava "atrasada" (o job de faturas gravava
--    isso). Agora ele e normalizado para 'active' + membro 'overdue' pelo job
--    de status, que passa a medir a carencia pela data. Esta UPDATE so
--    normaliza o que JA passou da carencia de 7 dias: vira 'cancelled'.
-- ----------------------------------------------------------------------------
UPDATE public.user_subscriptions
   SET status = 'cancelled',
       billing_status = 'cancelled',
       updated_at = NOW()
 WHERE status IN ('active', 'expired')
   AND renewal_due_at IS NOT NULL
   AND renewal_due_at + INTERVAL '7 days' < NOW();

-- O membro sai do grupo (desvincula) e as cobrancas agendadas sao canceladas.
UPDATE public.group_members gm
   SET status = 'cancelled',
       payment_status = 'cancelled',
       left_at = NOW(),
       updated_at = NOW()
  FROM public.user_subscriptions us
 WHERE us.group_id = gm.group_id
   AND us.user_id = gm.user_id
   AND us.status = 'cancelled'
   AND us.updated_at > NOW() - INTERVAL '10 minutes'
   AND gm.status <> 'cancelled';

-- O enum de `billing_cycles.status` é `billing_status`
-- ('pending','processing','approved','failed','cancelled'). O 'retrying' é de
-- OUTRO enum (`subscription_billing_status`, da assinatura) — usá-lo aqui dá
-- erro 22P02 "invalid input value for enum billing_status".
-- "Ainda vai cobrar" = pending (agendado) + processing (em voo) + failed
-- (recusado, com next_retry_at).
UPDATE public.billing_cycles bc
   SET status = 'cancelled'
  FROM public.user_subscriptions us
 WHERE us.id = bc.subscription_id
   AND us.status = 'cancelled'
   AND us.updated_at > NOW() - INTERVAL '10 minutes'
   AND bc.status IN ('pending', 'processing', 'failed');

-- ----------------------------------------------------------------------------
-- 4) Indices das queries do job de status
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_renewal_due
  ON public.user_subscriptions (renewal_due_at)
  WHERE status IN ('active', 'expired');

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_active_next_charge
  ON public.user_subscriptions (next_charge_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_group_members_user_status
  ON public.group_members (user_id, status);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_subscription_status
  ON public.billing_cycles (subscription_id, status);

COMMIT;

-- ============================================================================
-- CONFERENCIA
-- ============================================================================
-- Quantas assinaturas estao em cada situacao agora:
--
-- SELECT
--   CASE
--     WHEN status = 'cancelled' THEN 'cancelada'
--     WHEN renewal_due_at IS NULL THEN 'sem_data'
--     WHEN renewal_due_at > NOW() THEN 'ativa'
--     WHEN renewal_due_at + INTERVAL '7 days' > NOW() THEN 'atrasada'
--     ELSE 'vencida_7d (sera cancelada pelo job)'
--   END AS situacao,
--   count(*)
-- FROM public.user_subscriptions
-- GROUP BY 1
-- ORDER BY 2 DESC;
-- ============================================================================
