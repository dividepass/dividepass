-- ============================================================
-- REPARO DO STATUS DAS ASSINATURAS — 2026-11-01
--
-- Rodar no SQL Editor do Supabase (painel do projeto DividePass).
-- Idempotente: pode rodar quantas vezes quiser.
--
-- O PROBLEMA
-- -----------
-- No painel (PLATAFORMA > Assinaturas) várias assinaturas aparecem como
-- "Cancelada" mesmo com a próxima cobrança LONGE (22/12/2026, 24/04/2027...),
-- e o status só deveria mudar quando passa o dia da renovação.
--
-- A CAUSA
-- --------
-- A edge function `update-subscription-statuses` que está IMPLANTADA em
-- produção é a versão ANTIGA (a de 25/10). Nela, o passo 5b faz:
--
--   UPDATE user_subscriptions SET status = 'cancelled'
--    WHERE status = 'active'
--      AND group_id IN (grupos que têm QUALQUER membro com payment_status
--                        = 'cancelled')
--
-- ou seja: UM único membro cancelado cancelava a assinatura de TODOS os
-- membros daquele grupo. O "RPC exec_sql" que faria o sync pelo par
-- (user_id, group_id) não existe em produção (404) e o supabase-js NÃO
-- lança exceção no erro — então o fallback errado rodava sempre.
--
-- E a versão antiga do `process-recurring-billing` cancelava a assinatura
-- depois de 3 recusas de cartão (muito antes da carência de 7 dias).
--
-- A REGRA OFICIAL (a mesma do front `src/lib/subscriptionAccess.js`)
-- -------------------------------------------------------------------
--   ATIVA      renovação > agora
--   ATRASADA   renovação <= agora, ainda dentro da carência de 7 dias
--   CANCELADA  passou da carência de 7 dias (ou o próprio banco cancelou)
--   PENDENTE   pagamento em aberto (não se mexe)
--
-- TIPOS DE COLUNA (importante — o erro 22P02)
-- ------------------------------------------
--   group_members.payment_status  -> ENUM payment_flow_status
--        ('awaiting_entrance','entrance_paid','awaiting_subscription',
--         'active','expired','overdue','refunded','cancelled')
--        NÃO tem 'inactive' — comparar o enum com 'inactive' estoura:
--        ERROR 22P02 invalid input value for enum payment_flow_status.
--   group_members.status          -> VARCHAR(20) ('active','cancelled','inactive')
--   user_subscriptions.status      -> ENUM subscription_status
--        ('active','inactive','cancelled','expired','pending')
--
-- Por isso TODA comparação de enum aqui é feita com `::text`. Assim o
-- script não quebra se um valor não existir no enum daquele banco.
--
-- O QUE ESTE SCRIPT FAZ
-- ---------------------
-- 1) MOSTRA o antes/depois de cada assinatura (diagnóstico).
-- 2) RECALCULA `user_subscriptions.status` pela regra acima, sempre pelo
--    PAR (user_id, group_id) — nunca pelo grupo.
-- 3) ALINHA `group_members.payment_status`: membro em dia com renovação
--    vencida vira 'overdue' (a carência de 7 dias continua valendo).
-- 4) CONFERE o resultado.
--
-- IMPACTO MEDIDO EM PRODUÇÃO ANTES DE ESCREVER ESTE SCRIPT:
--   membros: 51 active | 15 cancelled | 6 inactive (status)
--            payment_status: 51 active | 9 cancelled | 2 overdue
--            | 1 awaiting_subscription | 1 awaiting_entrance
--   - 0 membros ativos com renovação vencida
--   - os 2 inadimplentes estão DENTRO da carência (6 e 3 dias) -> viram
--     "Atrasada"; NINGUÉM é desvinculado por este script
--
-- TESTADO contra um Postgres 17 local com o mesmo schema, inclusive com o
-- enum payment_flow_status (ver scripts/test-status-assinaturas-schema.sql).
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. DIAGNÓSTICO — o que está hoje e o que deveria estar
-- ─────────────────────────────────────────────────────────────
WITH base AS (
  SELECT
    us.id,
    us.status::text                                   AS status_hoje,
    gm.payment_status::text                           AS pagamento,
    gm.status::text                                   AS membro_status,
    COALESCE(
      us.renewal_due_at,
      us.next_charge_at,
      CASE WHEN us.expires_at IS NOT NULL
           THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
      END
    )                                                 AS renovacao,
    CASE
      WHEN us.status::text = 'pending'                      THEN 'pending'
      WHEN gm.payment_status::text = 'cancelled'            THEN 'cancelled'
      WHEN gm.status::text = 'cancelled'
       AND gm.payment_status::text <> 'overdue'             THEN 'cancelled'
      WHEN gm.status::text = 'inactive'
       AND gm.payment_status::text NOT IN ('active','overdue') THEN 'cancelled'
      WHEN gm.payment_status::text IN ('awaiting_entrance','awaiting_subscription')
                                                            THEN 'pending'
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) IS NULL                                  THEN
             CASE WHEN gm.payment_status::text = 'overdue' THEN 'expired' ELSE 'active' END
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW() - interval '7 days'               THEN 'cancelled'
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW()                                  THEN 'expired'
      ELSE 'active'
    END::text                                          AS status_correto
  FROM public.user_subscriptions us
  LEFT JOIN public.group_members gm
    ON gm.user_id = us.user_id
   AND gm.group_id = us.group_id
)
SELECT
  b.status_hoje,
  b.status_correto,
  count(*) AS assinaturas,
  count(*) FILTER (WHERE b.status_hoje IS DISTINCT FROM b.status_correto) AS para_corrigir
FROM base b
GROUP BY 1, 2
ORDER BY 1, 2;

-- 1.2) As assinaturas que vão mudar de estado
WITH base AS (
  SELECT
    us.id, us.user_id, us.group_id,
    us.status::text                                   AS status_hoje,
    gm.payment_status::text                           AS pagamento,
    gm.status::text                                   AS membro_status,
    COALESCE(
      us.renewal_due_at,
      us.next_charge_at,
      CASE WHEN us.expires_at IS NOT NULL
           THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
      END
    )                                                 AS renovacao,
    CASE
      WHEN us.status::text = 'pending'                      THEN 'pending'
      WHEN gm.payment_status::text = 'cancelled'            THEN 'cancelled'
      WHEN gm.status::text = 'cancelled'
       AND gm.payment_status::text <> 'overdue'             THEN 'cancelled'
      WHEN gm.status::text = 'inactive'
       AND gm.payment_status::text NOT IN ('active','overdue') THEN 'cancelled'
      WHEN gm.payment_status::text IN ('awaiting_entrance','awaiting_subscription')
                                                            THEN 'pending'
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) IS NULL                                  THEN
             CASE WHEN gm.payment_status::text = 'overdue' THEN 'expired' ELSE 'active' END
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW() - interval '7 days'               THEN 'cancelled'
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW()                                  THEN 'expired'
      ELSE 'active'
    END::text                                          AS status_correto
  FROM public.user_subscriptions us
  LEFT JOIN public.group_members gm
    ON gm.user_id = us.user_id AND gm.group_id = us.group_id
)
SELECT
  b.status_hoje AS antes,
  b.status_correto AS depois,
  u.email,
  g.name AS grupo,
  b.pagamento AS pagamento,
  b.membro_status AS membro,
  b.renovacao AS proxima_cobranca
FROM base b
LEFT JOIN public.users u ON u.id = b.user_id
LEFT JOIN public.groups g ON g.id = b.group_id
WHERE b.status_hoje IS DISTINCT FROM b.status_correto
ORDER BY b.status_hoje, u.email;


-- ─────────────────────────────────────────────────────────────
-- 2. REPARO — recalcula o status da assinatura (pelo par)
-- ─────────────────────────────────────────────────────────────
WITH base AS (
  SELECT
    us.id,
    CASE
      WHEN us.status::text = 'pending'                      THEN 'pending'::subscription_status
      WHEN gm.payment_status::text = 'cancelled'            THEN 'cancelled'::subscription_status
      WHEN gm.status::text = 'cancelled'
       AND gm.payment_status::text <> 'overdue'             THEN 'cancelled'::subscription_status
      WHEN gm.status::text = 'inactive'
       AND gm.payment_status::text NOT IN ('active','overdue') THEN 'cancelled'::subscription_status
      WHEN gm.payment_status::text IN ('awaiting_entrance','awaiting_subscription')
                                                            THEN 'pending'::subscription_status
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) IS NULL                                  THEN
             CASE WHEN gm.payment_status::text = 'overdue'
                  THEN 'expired'::subscription_status
                  ELSE 'active'::subscription_status
             END
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW() - interval '7 days'               THEN 'cancelled'::subscription_status
      WHEN COALESCE(
             us.renewal_due_at,
             us.next_charge_at,
             CASE WHEN us.expires_at IS NOT NULL
                  THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
             END) < NOW()                                  THEN 'expired'::subscription_status
      ELSE 'active'::subscription_status
    END AS status_correto
  FROM public.user_subscriptions us
  LEFT JOIN public.group_members gm
    ON gm.user_id = us.user_id AND gm.group_id = us.group_id
)
UPDATE public.user_subscriptions us
   SET status      = b.status_correto,
       updated_at  = NOW()
  FROM base b
 WHERE us.id = b.id
   AND us.status::text IS DISTINCT FROM b.status_correto::text;


-- ─────────────────────────────────────────────────────────────
-- 3. ALINHA O MEMBRO (group_members.payment_status)
--
--    Só a parte segura: membro em dia cuja renovação venceu vira
--    'overdue' (aí ele aparece como "Atrasada" e pode renovar).
--
--    O passo seguinte — desvincular o membro depois de 7 dias de atraso —
--    fica COMENTADO porque tira a pessoa do grupo. Hoje ele não mudaria
--    ninguém (o mais antigo está há 6 dias), então rode à vontade quando
--    quiser aplicar a carência de 7 dias de forma definitiva.
-- ─────────────────────────────────────────────────────────────
UPDATE public.group_members gm
   SET payment_status = 'overdue'::payment_flow_status,
       updated_at     = NOW()
 WHERE gm.payment_status::text = 'active'
   AND gm.subscription_deadline IS NOT NULL
   AND gm.subscription_deadline < NOW();

-- UPDATE public.group_members gm
--    SET payment_status = 'cancelled'::payment_flow_status,
--        status         = 'cancelled',
--        left_at        = NOW(),
--        updated_at     = NOW()
--  WHERE gm.payment_status::text = 'overdue'
--    AND gm.subscription_deadline IS NOT NULL
--    AND gm.subscription_deadline < NOW() - interval '7 days';


-- ─────────────────────────────────────────────────────────────
-- 4. CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────
SELECT status, count(*) AS assinaturas
FROM public.user_subscriptions
GROUP BY status
ORDER BY status;

SELECT payment_status::text, count(*) AS membros
FROM public.group_members
GROUP BY payment_status::text
ORDER BY 1;

-- 4.1) Nenhuma assinatura pode estar "cancelada" com a renovação no futuro
--      enquanto o membro estiver em dia. Se der linha aqui, o crão antigo
--      ainda está rodando (falta publicar a edge nova).
SELECT u.email, g.name AS grupo, us.status, us.renewal_due_at, gm.payment_status
FROM public.user_subscriptions us
JOIN public.group_members gm
  ON gm.user_id = us.user_id AND gm.group_id = us.group_id
LEFT JOIN public.users u ON u.id = us.user_id
LEFT JOIN public.groups g ON g.id = us.group_id
WHERE us.status::text = 'cancelled'
  AND gm.payment_status::text = 'active'
  AND gm.status::text = 'active'
  AND COALESCE(us.renewal_due_at, us.next_charge_at) > NOW();


-- ─────────────────────────────────────────────────────────────
-- 5. INSTALA A FUNÇÃO SQL CORRIGIDA (opcional, mas recomendado)
--
--    `sync_user_subscription_statuses()` — sync pelo par, com a carência
--    de 7 dias. É a versão que a edge function nova usa; deixar a antiga
--    no banco é o que permite o cancelamento em massa.
--    (Se você já rodou `database/fix-subscription-status-sync.sql`, pule
--    esta seção — ela é a mesma coisa com a regra da carência corrigida.)
-- ─────────────────────────────────────────────────────────────
-- CREATE OR REPLACE FUNCTION public.sync_user_subscription_statuses()
-- RETURNS TABLE (expiradas bigint, canceladas bigint, reativadas bigint)
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public, pg_temp
-- AS $$
-- DECLARE
--   v_expired   bigint := 0;
--   v_cancelled bigint := 0;
--   v_restored  bigint := 0;
-- BEGIN
--   -- Membro inadimplente -> assinatura expirada (atrasada)
--   UPDATE public.user_subscriptions us
--      SET status = 'expired', updated_at = NOW()
--     FROM public.group_members gm
--    WHERE us.user_id = gm.user_id
--      AND us.group_id = gm.group_id
--      AND gm.payment_status::text = 'overdue'
--      AND us.status::text = 'active';
--   GET DIAGNOSTICS v_expired = ROW_COUNT;
--
--   -- Membro cancelado -> assinatura cancelada
--   UPDATE public.user_subscriptions us
--      SET status = 'cancelled', updated_at = NOW()
--     FROM public.group_members gm
--    WHERE us.user_id = gm.user_id
--      AND us.group_id = gm.group_id
--      AND gm.payment_status::text = 'cancelled'
--      AND us.status::text = 'active';
--   GET DIAGNOSTICS v_cancelled = ROW_COUNT;
--
--   -- Membro em dia -> assinatura expirada volta a ativa
--   -- (cancelada NÃO volta: cancelamento é ato explícito)
--   UPDATE public.user_subscriptions us
--      SET status = 'active', updated_at = NOW()
--     FROM public.group_members gm
--    WHERE us.user_id = gm.user_id
--      AND us.group_id = gm.group_id
--      AND gm.payment_status::text = 'active'
--      AND gm.status::text = 'active'
--      AND us.status::text = 'expired'
--      AND COALESCE(us.renewal_due_at, us.next_charge_at) > NOW();
--   GET DIAGNOSTICS v_restored = ROW_COUNT;
--
--   RETURN QUERY SELECT v_expired, v_cancelled, v_restored;
-- END;
-- $$;
--
-- REVOKE ALL ON FUNCTION public.sync_user_subscription_statuses() FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.sync_user_subscription_statuses() TO service_role;
