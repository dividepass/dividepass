-- ============================================================================
-- REPARO DOS VÍNCULOS E DAS ASSINATURAS — 01/11/2026
-- ============================================================================
-- Rodar no SQL Editor do Supabase (painel do projeto DividePass).
-- Idempotente: pode rodar quantas vezes quiser.
--
-- O PROBLEMA (relatado pelo dono)
-- -------------------------------
-- "Dentro do grupo, os membros aparecem como CANCELADO mesmo tendo assinado.
--  Se eu removo o usuário da lista de membros e adiciono de novo, volta ao
--  normal. E o cliente não está aparecendo a assinatura — a tela de
--  credenciais diz 'Acesso Negado'."
--
-- A CAUSA
-- -------
-- Três defeitos que se somam:
--
-- 1) O PAINEL ADMIN, ao REATIVAR uma assinatura, gravava só o
--    `payment_status` e o prazo — sem devolver o `group_members.status` para
--    'active' e sem limpar o `left_at`. O vínculo ficava com o status legado
--    'inactive' (ou 'cancelled') e o `payment_status` valendo 'active'.
--    → Na lista de membros do grupo, status ≠ 'active' aparece como
--      "Cancelado".
--    → Em `ServiceCredentials.jsx` o status legado do vínculo negava o
--      acesso antes mesmo de olhar a assinatura → "Acesso Negado".
--
-- 2) O `user_subscriptions.status` ficava 'cancelled' (a assinatura não
--    voltava), e a dashboard só lista assinatura com status em
--    USER_SUBSCRIPTION_STATUSES → a assinatura não aparecia para o cliente.
--
-- 3) A ASSINATURA não gravava a data "paga até" no vínculo
--    (`group_members.subscription_deadline`): só a taxa de adesão gravava.
--    Sem essa data não dá para saber, por membro, se o período ainda vale —
--    que é justamente o que a regra de status precisa.
--
-- A REGRA (a mesma do front `src/lib/subscriptionAccess.js`)
-- -----------------------------------------------------------
--   ATIVA      renovação > agora
--   ATRASADA   renovação <= agora, ainda dentro da carência de 7 dias
--   CANCELADA  passou da carência (ou o próprio banco cancelou)
--   PENDENTE   pagamento em aberto
--
-- E o vínculo segue o pagamento: pagamento ativo + prazo vigente = membro
-- ATIVO (com `left_at` zerado).
--
-- ⚠️ ESTE SCRIPT NÃO CANCELA NINGUÉM E NÃO DESVINCUDA NINGUÉM.
--    Ele só:
--      (a) preenche o prazo que faltava no vínculo;
--      (b) reativa quem PAGOU e ainda está dentro do período;
--      (c) alinha `payment_status` de quem saiu sem período válido.
--
-- TIPOS DE COLUNA (comparações sempre com ::text — o enum estoura 22P02)
-- ---------------------------------------------------------------------------
--   group_members.status        -> VARCHAR(20) ('active','cancelled','inactive')
--   group_members.payment_status-> ENUM payment_flow_status
--   user_subscriptions.status    -> ENUM subscription_status
-- ============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DIAGNÓSTICO
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1) Quem está FORA do grupo mas tem pagamento ativo e prazo ainda vigente
--      (é o caso da Carol e da Maysa — pessoas que pagaram e estão em dia).
WITH base AS (
  SELECT
    gm.user_id,
    gm.group_id,
    gm.status::text                  AS membro_status,
    gm.payment_status::text          AS pagamento,
    gm.left_at,
    gm.subscription_deadline,
    COALESCE(
      gm.subscription_deadline,
      us.renewal_due_at,
      us.next_charge_at,
      CASE WHEN us.expires_at IS NOT NULL
           THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
      END
    )                                AS renovacao,
    us.status::text                  AS assinatura_status
  FROM public.group_members gm
  LEFT JOIN public.user_subscriptions us
    ON us.user_id = gm.user_id AND us.group_id = gm.group_id
)
SELECT
  u.email,
  u.name                            AS cliente,
  g.name                            AS grupo,
  b.membro_status,
  b.pagamento,
  b.assinatura_status,
  b.renovacao                       AS paga_ate,
  b.left_at                         AS saiu_em,
  CASE
    WHEN b.renovacao IS NOT NULL AND b.renovacao > NOW()
      THEN 'REATIVAR (pago e em dia)'
    ELSE 'manter como está'
  END                               AS acao
FROM base b
JOIN public.users u ON u.id = b.user_id
LEFT JOIN public.groups g ON g.id = b.group_id
WHERE b.membro_status <> 'active'
  AND b.pagamento = 'active'
ORDER BY b.renovacao DESC NULLS LAST;

-- 1.2) Panorama: como o vínculo e a assinatura estão distribuídos
SELECT
  gm.status::text                                       AS membro_status,
  gm.payment_status::text                               AS pagamento,
  us.status::text                                       AS assinatura_status,
  count(*)                                              AS pares
FROM public.group_members gm
LEFT JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id AND us.group_id = gm.group_id
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

-- 1.3) Vínculos sem a data "paga até" (a assinatura pagou, mas o vínculo não sabe)
SELECT count(*) AS sem_prazo
FROM public.group_members gm
LEFT JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id AND us.group_id = gm.group_id
WHERE gm.subscription_deadline IS NULL
  AND us.id IS NOT NULL
  AND us.status::text IN ('active', 'expired');

-- 1.4) Assinaturas que NÃO aparecem para o cliente (status fora da lista) e
--      ainda têm renovação no futuro → devem voltar a 'active'
SELECT
  u.email,
  g.name AS grupo,
  us.status::text AS assinatura_status,
  COALESCE(us.renewal_due_at, us.next_charge_at) AS renovacao,
  gm.status::text AS membro_status,
  gm.payment_status::text AS pagamento
FROM public.user_subscriptions us
JOIN public.users u ON u.id = us.user_id
LEFT JOIN public.groups g ON g.id = us.group_id
LEFT JOIN public.group_members gm
  ON gm.user_id = us.user_id AND gm.group_id = us.group_id
WHERE us.status::text IN ('cancelled', 'inactive')
  AND COALESCE(us.renewal_due_at, us.next_charge_at) > NOW()
  AND gm.payment_status::text = 'active'
ORDER BY u.email;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. REPARO
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1) Preenche a data "paga até" no vínculo a partir da assinatura.
--      É o que permite, dali em diante, decidir por membro se o período vale.
UPDATE public.group_members gm
   SET subscription_deadline = COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ),
       updated_at = NOW()
  FROM public.user_subscriptions us
 WHERE us.user_id = gm.user_id
   AND us.group_id = gm.group_id
   AND gm.subscription_deadline IS NULL
   AND COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ) IS NOT NULL;

-- 2.2) REATIVA o vínculo de quem PAGOU e ainda está dentro do período.
--      (status = 'active' e left_at zerado — o espelho passa a seguir o
--      pagamento, e a pessoa volta a aparecer como "Ativo" na lista do grupo
--      e a ver as credenciais.)
--
--      POR QUE SÓ O status LEGADO 'inactive':
--      'inactive' é o valor que o job antigo de status gravava quando
--      cancelava a assinatura de TODO mundo num grupo (o bug em massa) — o
--      'status' ficava defasado enquanto o `payment_status` voltava a
--      'active'. Já o 'cancelled' é o cancelamento DE VERDADE (a pessoa saiu
--      ou a carência venceu) e não é tocado aqui: quem cancelou de
--      propósito continua fora.
--
--      E o filtro do prazo vale como prova de pagamento: sem período
--      vigente não há o que reativar.
UPDATE public.group_members gm
   SET status       = 'active',
       left_at      = NULL,
       updated_at   = NOW()
 WHERE gm.payment_status::text = 'active'
   AND gm.status::text = 'inactive'
   AND gm.subscription_deadline IS NOT NULL
   AND gm.subscription_deadline > NOW();

-- 2.3) Devolve a ASSINATURA de quem está ativo e pago para 'active'.
--      (é o que faz a assinatura voltar a aparecer na dashboard do cliente)
--
--      O par tem que estar com o vínculo ATIVO e o pagamento ativo — quem
--      cancelou de verdade (vínculo 'cancelled') não é tocado aqui.
UPDATE public.user_subscriptions us
   SET status       = 'active'::subscription_status,
       billing_status = 'active'::subscription_billing_status,
       updated_at   = NOW()
  FROM public.group_members gm
 WHERE gm.user_id = us.user_id
   AND gm.group_id = us.group_id
   AND gm.status::text = 'active'
   AND gm.payment_status::text = 'active'
   AND us.status::text IN ('cancelled', 'inactive', 'expired')
   AND COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ) > NOW();

-- 2.4) Alinha quem saiu do grupo SEM período válido: o pagamento não pode
--      continuar dizendo 'active' (isso fazia o espelho e a assinatura
--      discordarem). Não desvincula ninguém — só corrige o estado.
UPDATE public.group_members gm
   SET payment_status = 'cancelled'::payment_flow_status,
       updated_at      = NOW()
 WHERE gm.status::text IN ('cancelled', 'inactive', 'left')
   AND gm.payment_status::text = 'active'
   AND (gm.subscription_deadline IS NULL OR gm.subscription_deadline <= NOW());


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1) Nenhum vínculo pode ficar "fora do grupo" com pagamento ativo e prazo
--      vigente (se aparecer linha aqui, o 2.2 não cobriu algum caso).
SELECT u.email, g.name AS grupo, gm.status::text AS membro, gm.payment_status::text AS pagamento,
       gm.subscription_deadline AS paga_ate
FROM public.group_members gm
JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.status::text <> 'active'
  AND gm.payment_status::text = 'active'
  AND gm.subscription_deadline IS NOT NULL
  AND gm.subscription_deadline > NOW();

-- 3.2) Panorama final dos vínculos
SELECT status::text AS membro_status, payment_status::text AS pagamento, count(*)
FROM public.group_members
GROUP BY 1, 2
ORDER BY 3 DESC;

-- 3.3) Panorama final das assinaturas
SELECT status::text, count(*)
FROM public.user_subscriptions
GROUP BY 1
ORDER BY 2 DESC;

-- ============================================================================
-- DEPOIS DE RODAR
-- ============================================================================
-- 1) Publique as edge functions novas (o job de status agora conserta o
--    vínculo sozinho e a confirmação grava a data "paga até"):
--       node scripts/empacotar-function-painel.mjs
--       → colar no painel: check-iopay-tx, force-confirm-payment,
--         iopay-webhook, reconcile-payments (nova), update-subscription-statuses
-- 2) Suba o front na Vercel (tela de credenciais + painel admin).
-- 3) Rode a reconciliação para o caso "pagou e não entrou no grupo":
--       curl -X POST "https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments" \
--            -H "Authorization: Bearer <SERVICE_ROLE_KEY>" -H "Content-Type: application/json" -d '{}'
-- ============================================================================
