-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Correção da sincronização de status das assinaturas
--
-- O PROBLEMA
--
--   A edge function `update-subscription-statuses` (rodada todo dia às 03h UTC
--   pelo pg_cron) sincronizava `user_subscriptions.status` a partir de
--   `group_members.payment_status` filtrando por GROUP_ID:
--
--     UPDATE user_subscriptions
--        SET status = 'cancelled'
--      WHERE status = 'active'
--        AND group_id IN (grupos que têm ALGUM membro cancelado)
--
--   Um único membro cancelado (ou inadimplente) mudava o status de TODAS as
--   assinaturas ativas daquele grupo — não só da pessoa envolvida. Como
--   `group_members` guarda o cancelamento para sempre, o cron repetia o estrago
--   toda noite, cancelling assinaturas de gente que estava em dia.
--
--   É a origem do número inflado no painel: o card "Canceladas / expiradas"
--   contava `status IN ('cancelled','expired')` e o resultado não era só quem
--   cancelou de verdade.
--
-- COMO SABER O QUE É "CANCELADA DE VERDADE"
--
--   O cancelamento real deixa o MEMBRO marcado junto:
--     - cancelamento do usuário  -> group_members.status/payment_status = 'cancelled'
--     - 3 falhas de cobrança     -> group_members.payment_status = 'cancelled'
--     - grupo excluído           -> idem
--
--   Quando o cron agiu sozinho, a assinatura mudou e o membro NÃO. Então:
--
--     assinatura 'cancelled'/'expired' + membro ainda 'active'  =>  erro do cron
--
-- O QUE ESTE SCRIPT FAZ
--
--   1. DIAGNÓSTICO  — quantas assinaturas estão assim ( rode primeiro )
--   2. FUNÇÕES     — `sync_user_subscription_statuses()` com o JOIN correto
--   3. REPARO      — devolve para 'active' o que foi cancelado/expirado errado
--   4. VERIFICAÇÃO — o painel deve refletir o número real
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════════════════════════════════════════════
-- 1. DIAGNÓSTICO — rode esta parte primeiro e olhe os números
-- ═══════════════════════════════════════════════════════════════════════════

-- 1.1) Como o painel conta hoje (o card "Canceladas / expiradas" = as duas
--      últimas linhas somadas)
SELECT
  status,
  count(*) AS quantidade
FROM public.user_subscriptions
GROUP BY status
ORDER BY quantidade DESC;

-- 1.2) Quantas assinaturas foram canceladas/expiradas SEM o membro estar
--      cancelado -> essas são as canceladas por engano (bug do cron)
SELECT
  count(*) FILTER (WHERE us.status = 'cancelled') AS canceladas_por_engano,
  count(*) FILTER (WHERE us.status = 'expired')  AS expiradas_por_engano,
  count(*) FILTER (
    WHERE us.status = 'cancelled' AND gm.status = 'active' AND gm.payment_status = 'active'
  ) AS canceladas_com_membro_ativo,
  count(*) FILTER (
    WHERE us.status = 'expired' AND gm.status = 'active' AND gm.payment_status = 'active'
  ) AS expiradas_com_membro_ativo
FROM public.user_subscriptions us
LEFT JOIN public.group_members gm
  ON gm.user_id = us.user_id
 AND gm.group_id = us.group_id;

-- 1.3) Quais são elas (para conferir na mão antes de reparar)
SELECT
  us.id                AS assinatura_id,
  u.name               AS usuario,
  u.email,
  g.name               AS grupo,
  us.status            AS status_assinatura,
  gm.status            AS status_membro,
  gm.payment_status    AS cobranca_membro,
  us.amount,
  us.next_charge_at,
  us.updated_at         AS assinatura_atualizada_em
FROM public.user_subscriptions us
JOIN public.group_members gm
  ON gm.user_id = us.user_id
 AND gm.group_id = us.group_id
LEFT JOIN public.users u ON u.id = us.user_id
LEFT JOIN public.groups g ON g.id = us.group_id
WHERE us.status IN ('cancelled', 'expired')
  AND gm.status = 'active'
  AND gm.payment_status = 'active'
ORDER BY us.updated_at DESC;


-- ═══════════════════════════════════════════════════════════════════════════
-- 2. FUNÇÕES CORRIGIDAS
-- ═══════════════════════════════════════════════════════════════════════════

-- 2.1) Sincroniza o status da assinatura pelo par (user_id, group_id).
--
--      Esta é a versão que a edge function passa a usar: um UPDATE por par,
--      nunca por grupo. `payment_status` do membro é a fonte da verdade:
--
--        active    -> assinatura ativa
--        overdue   -> assinatura expirada (renovacao vencida)
--        cancelled -> assinatura cancelada
--
--      Devolve quantas linhas mexem em cada grupo.
CREATE OR REPLACE FUNCTION public.sync_user_subscription_statuses()
RETURNS TABLE (
  expiradas  bigint,
  canceladas bigint,
  reativadas bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_expired   bigint := 0;
  v_cancelled bigint := 0;
  v_restored  bigint := 0;
BEGIN
  -- Vencida: membro inadimplente -> assinatura expirada
  UPDATE public.user_subscriptions us
     SET status = 'expired', updated_at = NOW()
    FROM public.group_members gm
   WHERE us.user_id = gm.user_id
     AND us.group_id = gm.group_id
     AND gm.payment_status = 'overdue'
     AND us.status = 'active';
  GET DIAGNOSTICS v_expired = ROW_COUNT;

  -- Cancelada: membro cancelado -> assinatura cancelada
  UPDATE public.user_subscriptions us
     SET status = 'cancelled', updated_at = NOW()
    FROM public.group_members gm
   WHERE us.user_id = gm.user_id
     AND us.group_id = gm.group_id
     AND gm.payment_status = 'cancelled'
     AND us.status = 'active';
  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  -- Reativada: membro em dia de volta -> assinatura expirada volta a ativa.
  -- `cancelled` NAO volta: e uma acao explicita (usuario cancelou ou 3 falhas
  -- de cobranca) e nao se desfaz sozinha.
  UPDATE public.user_subscriptions us
     SET status = 'active', updated_at = NOW()
    FROM public.group_members gm
   WHERE us.user_id = gm.user_id
     AND us.group_id = gm.group_id
     AND gm.payment_status = 'active'
     AND gm.status = 'active'
     AND us.status = 'expired';
  GET DIAGNOSTICS v_restored = ROW_COUNT;

  RETURN QUERY SELECT v_expired, v_cancelled, v_restored;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_user_subscription_statuses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_subscription_statuses() TO service_role;

COMMENT ON FUNCTION public.sync_user_subscription_statuses() IS
  'Sincroniza user_subscriptions.status a partir de group_members pelo par (user_id, group_id). Nao usar filtro por group_id: cancela assinaturas de terceiros.';


-- 2.2) Corrige `update_subscription_statuses()` (a funcao SQL antiga).
--
--      O bug anterior: `SET status = gm.payment_status::text::subscription_status`
--      quebrava com o valor 'overdue', que NAO existe no enum
--      `subscription_status` ('active','inactive','cancelled','expired','pending').
--      O cast estourava, a funcao inteira abortava e os passos anteriores
--      (overdue -> cancelled) voltavam junto — o UPDATE de group_members
--      nunca era gravado.
CREATE OR REPLACE FUNCTION public.update_subscription_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- 1. first_attempt -> overdue: 7 dias sem pagamento
  UPDATE public.group_members
     SET payment_status = 'overdue', updated_at = NOW()
   WHERE payment_status = 'first_attempt'
     AND created_at < NOW() - INTERVAL '7 days'
     AND NOT EXISTS (
       SELECT 1 FROM public.payments p
        WHERE p.user_id = group_members.user_id
          AND p.group_id = group_members.group_id
          AND p.status = 'paid'
     );

  -- 2. awaiting_subscription -> overdue: prazo estourado
  UPDATE public.group_members
     SET payment_status = 'overdue', updated_at = NOW()
   WHERE payment_status = 'awaiting_subscription'
     AND subscription_deadline IS NOT NULL
     AND subscription_deadline < NOW();

  -- 3. active -> overdue: renovacao vencida
  UPDATE public.group_members
     SET payment_status = 'overdue', updated_at = NOW()
   WHERE payment_status = 'active'
     AND subscription_deadline IS NOT NULL
     AND subscription_deadline < NOW();

  -- 4. overdue -> cancelled: mais de 3 meses em atraso
  UPDATE public.group_members
     SET payment_status = 'cancelled',
         status = 'cancelled',
         left_at = NOW(),
         updated_at = NOW()
   WHERE payment_status = 'overdue'
     AND updated_at < NOW() - INTERVAL '3 months';

  -- 5. Espelha em user_subscriptions — pelo PAR, nunca pelo grupo.
  --    O CASE evita o cast invalido do enum.
  UPDATE public.user_subscriptions us
     SET status = CASE
                    WHEN gm.payment_status = 'active'    THEN 'active'::subscription_status
                    WHEN gm.payment_status = 'overdue'   THEN 'expired'::subscription_status
                    WHEN gm.payment_status = 'cancelled' THEN 'cancelled'::subscription_status
                    ELSE us.status
                  END,
         updated_at = NOW()
    FROM public.group_members gm
   WHERE us.user_id = gm.user_id
     AND us.group_id = gm.group_id
     AND gm.payment_status IN ('overdue', 'cancelled', 'active')
     AND us.status IS DISTINCT FROM CASE
                    WHEN gm.payment_status = 'active'    THEN 'active'::subscription_status
                    WHEN gm.payment_status = 'overdue'   THEN 'expired'::subscription_status
                    WHEN gm.payment_status = 'cancelled' THEN 'cancelled'::subscription_status
                    ELSE us.status
                  END;
END;
$$;

REVOKE ALL ON FUNCTION public.update_subscription_statuses() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_subscription_statuses() TO service_role;


-- ═══════════════════════════════════════════════════════════════════════════
-- 3. REPARO — rode DEPOIS de olhar o diagnóstico da seção 1
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Devolve para 'active' a assinatura cujo membro continua ATIVO e EM DIA.
-- Uma assinatura cancelada de verdade (pelo usuário, por 3 falhas ou por
-- exclusão do grupo) tem o membro marcado junto e NAO volta.
--
-- Se a seção 1.2 mostrar 0 em "canceladas_com_membro_ativo", o reparo não
-- mexe em nada — e o número do painel já era o real.

UPDATE public.user_subscriptions us
   SET status = 'active', updated_at = NOW()
  FROM public.group_members gm
 WHERE us.user_id = gm.user_id
   AND us.group_id = gm.group_id
   AND us.status IN ('cancelled', 'expired')
   AND gm.status = 'active'
   AND gm.payment_status = 'active';


-- ═══════════════════════════════════════════════════════════════════════════
-- 4. VERIFICAÇÃO — o painel deve refletir o número real
-- ═══════════════════════════════════════════════════════════════════════════

-- 4.1) Contagem final por status
SELECT status, count(*) AS quantidade
FROM public.user_subscriptions
GROUP BY status
ORDER BY quantidade DESC;

-- 4.2) Ainda sobrou alguma assinatura orfa? (deve dar 0)
SELECT count(*) AS assinaturas_orfas
FROM public.user_subscriptions us
LEFT JOIN public.group_members gm
  ON gm.user_id = us.user_id
 AND gm.group_id = us.group_id
WHERE us.status IN ('cancelled', 'expired')
  AND (gm.id IS NULL OR (gm.status = 'active' AND gm.payment_status = 'active'));

-- 4.3) Dispara a sincronizacao uma vez (o cron faz isso todo dia as 03h)
--      SELECT * FROM public.sync_user_subscription_statuses();

NOTIFY pgrst, 'reload schema';
