-- ============================================================================
-- CORRECAO DA COBRANCA RECORRENTE
--
-- Sintoma: "as cobrancas automaticas das mensalidades nao estao acontecendo".
--
-- Causas no banco (as edge functions agora tratam o caso novo, mas os dados
-- antigos precisam ser corrigidos uma vez):
--
-- 1. `next_charge_at` NULL -> a assinatura NUNCA aparece no filtro
--    `next_charge_at <= agora`, entao nunca e cobrada. Sem data, nao ha como
--    saber quando cobrar: o mais seguro e comecar pelo ciclo atual.
-- 2. `billing_status` NULL -> `billing_status != 'cancelled'` e NULL em
--    SQL, e o PostgREST filtra as linhas com NULL. A assinatura e ignorada.
-- 3. `retry_count` NULL -> `retry_count < 3` e NULL: mesma exclusao.
-- 4. `card_id` NULL -> nao ha cartao para cobrar (o usuario precisa salvar um
--    cartao). Isso nao se corrige por SQL, mas o painel agora mostra quem e.
--
-- Como aplicar: Supabase Dashboard > SQL Editor > cole e execute.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) Assinaturas ativas sem data de proxima cobranca
-- ----------------------------------------------------------------------------
-- Regra: cobra no dia da proxima virada de ciclo a partir de hoje.
-- `expires_at` e o fallback (a data ate onde a assinatura vale).
UPDATE public.user_subscriptions
SET next_charge_at = COALESCE(expires_at, now())
WHERE status = 'active'
  AND next_charge_at IS NULL
  AND billing_status IS DISTINCT FROM 'cancelled';

-- ----------------------------------------------------------------------------
-- 2) billing_status ausente -> assume 'active' (o enum aceita
--    'active' | 'retrying' | 'cancelled')
-- ----------------------------------------------------------------------------
UPDATE public.user_subscriptions
SET billing_status = 'active'
WHERE billing_status IS NULL
  AND status = 'active';

-- ----------------------------------------------------------------------------
-- 3) retry_count ausente -> 0
-- ----------------------------------------------------------------------------
UPDATE public.user_subscriptions
SET retry_count = 0
WHERE retry_count IS NULL;

-- ----------------------------------------------------------------------------
-- 4) Diagnostico: o que continua sem poder ser cobrado
-- ----------------------------------------------------------------------------
-- Rode esta query depois das correcoes acima para saber o que ainda depende
-- de acao do usuario (salvar cartao) em vez de bug:
--
--   SELECT
--     u.name,
--     u.email,
--     g.name            AS grupo,
--     s.next_charge_at,
--     s.billing_status,
--     s.retry_count,
--     s.card_last4,
--     (s.card_id IS NULL) AS sem_cartao
--   FROM public.user_subscriptions s
--   JOIN public.users u  ON u.id = s.user_id
--   JOIN public.groups g ON g.id = s.group_id
--   WHERE s.status = 'active'
--     AND s.billing_status <> 'cancelled'
--     AND (s.card_id IS NULL OR s.next_charge_at IS NULL)
--   ORDER BY s.next_charge_at NULLS FIRST;

-- ----------------------------------------------------------------------------
-- 5) Indice de apoio
--
-- `payment_attempts.gateway_transaction_id` NAO e unico: o polling gravava uma
-- linha nova a cada round com o mesmo id, e isso quebrava o webhook (que lia
-- com `.maybeSingle()`). O polling foi corrigido para atualizar a linha
-- existente; este indice deixa a busca por transacao barata.
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payment_attempts_gateway_tx
  ON public.payment_attempts (gateway_transaction_id);

-- Duplicatas antigas: o polling gravava uma linha nova a cada round.
--
-- CUIDADO: a linha que carrega `external_reference` e `coupon_id` e a de
-- CRIACAO (a mais antiga) — e ela e a que o webhook valida e a que registra
-- o cupom. Por isso a limpeza so remove as linhas de polling (sem
-- `external_reference`). Apagar a linha de criacao faria o cupom nunca ser
-- registrado e o total pago perder o desconto.
DELETE FROM public.payment_attempts a
USING public.payment_attempts b
WHERE a.gateway_transaction_id = b.gateway_transaction_id
  AND a.gateway_transaction_id IS NOT NULL
  AND a.created_at < b.created_at
  AND a.external_reference IS NULL;
