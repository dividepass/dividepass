-- ============================================================
-- REPARO DOS VÍNCULOS DE GRUPO DESATIVADOS SEM MOTIVO — 2026-11-09
--
-- Rodar no SQL Editor do Supabase (painel do projeto DividePass).
-- Idempotente: pode rodar quantas vezes quiser.
--
-- O PROBLEMA
-- -----------
-- Duas pessoas com ASSINATURA PAGA E VIGENTE (vencimento no futuro) tinham
-- o vínculo com o grupo em `status = 'cancelled'`. Como o front só lista
-- assinatura `active`/`expired` (ver `src/hooks/useAppData.js`), o grupo
-- SUMIA da tela delas — era a reclamação ("os grupos estão sumindo").
--
-- CADA CASO TEVE UMA CAUSA DIFERENTE (nenhum dos dois é o job de status):
--
--  1) Membro 9f35d1f8-8be2-4e5b-bf61-535f8a2f596a
--     (Gabriel / grupo "Bye")
--     `confirm-payment` tratava QUALQUER pagamento recusado pelo gateway
--     como "desvincula o membro". Um teste de cartão de R$ 0,01 RECUSADO
--     (08/11 16:09) cancelou o vínculo de quem tinha assinatura paga até
--     07/12/2026. A assinatura em si nunca foi cancelada — só o espelho do
--     grupo.
--
--  2) Membro c99c564f-9827-4b3e-863e-bef527b7249f
--     (Marisa / "Grupo 3")
--     O job `check-entrance-deadline` (cron de 2 em 2 horas) estornava a
--     ENTRADA e cancelava o vínculo de quem passasse do prazo de 12h —
--     sem olhar se existia assinatura paga. Ela tinha o Pix da assinatura
--     pago (01/11) e a entrada paga (07/11); o prazo de 12h contava a
--     partir da entrada, e o job rodou às 02:00 de 08/11 e cancelou ela.
--     (Obs.: o "estorno" nunca saiu — o gateway ativo é o IO Pay e o job
--     estorna no Mercado Pago — por isso `entrance_refunded` vai para
--     false: o dinheiro NÃO voltou.)
--
-- O QUE ESTE SCRIPT FAZ
-- ---------------------
-- 1) MOSTRA o estado antes (diagnóstico).
-- 2) Reativa os DOIS vínculos — sempre pelo ID exato do membro E com a
--    confirmação de que existe assinatura em vigor. Nunca por escopo de
--    grupo: um UPDATE por `group_id` foi exatamente o bug que cancelou
--    assinaturas de outras pessoas (ver `database/reparo-status-assinaturas-2026-11-01.sql`).
-- 3) Alinha `subscription_deadline` com o vencimento real da assinatura
--    (o prazo de 12h é o prazo para ASSINATAR depois da entrada; com a
--    assinatura em dia ele não tem o que regularizar).
-- 4) CONFERE o resultado.
--
-- A CREDENCIAL E O PERFIL DO GRUPO
-- --------------------------------
-- Ao cancelar o membro, as triggers do banco liberationam a atribuição:
-- `trg_release_credential` (group_credentials.assigned_to = NULL) e
-- `trg_release_profile` (group_profiles.assigned_to = NULL). Com a
-- reativação, `trg_auto_assign_credential` / `trg_auto_assign_profile`
-- rodam de novo. No grupo "Grupo 3" há UMA credencial: deixada sem dono ela
-- volta a ser COMPARTILHADA (todo membro ativo enxerga), que é o estado
-- correto para conta compartilhada.
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. DIAGNÓSTICO — o estado antes do reparo
-- ─────────────────────────────────────────────────────────────
SELECT
  gm.id AS membro,
  u.email,
  g.name AS grupo,
  gm.status::text              AS membro_status,
  gm.payment_status::text      AS pagamento,
  gm.left_at,
  gm.entrance_refunded,
  gm.subscription_deadline,
  us.id                         AS assinatura,
  us.status::text              AS assinatura_status,
  us.billing_status::text      AS assinatura_cobranca,
  us.renewal_due_at             AS vencimento
FROM public.group_members gm
JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id
 AND us.group_id = gm.group_id
LEFT JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.id IN (
  '9f35d1f8-8be2-4e5b-bf61-535f8a2f596a',
  'c99c564f-9827-4b3e-863e-bef527b7249f'
)
ORDER BY gm.id;


-- ─────────────────────────────────────────────────────────────
-- 2. REPARO — reativa os dois vínculos
--
-- As três condições juntas são o filtro de segurança:
--   - `gm.id IN (...)`: os DOIS membros exatos (nunca por grupo);
--   - a assinatura precisa estar `active`/`expired` (não cancelada);
--   - a assinatura precisa estar dentro da carência (vencimento + 7 dias).
-- ─────────────────────────────────────────────────────────────
UPDATE public.group_members gm
   SET status            = 'active',
       payment_status    = 'active'::payment_flow_status,
       left_at           = NULL,
       entrance_refunded = false,
       subscription_deadline = us.renewal_due_at,
       updated_at        = NOW()
  FROM public.user_subscriptions us
 WHERE us.user_id  = gm.user_id
   AND us.group_id = gm.group_id
   AND gm.id IN (
     '9f35d1f8-8be2-4e5b-bf61-535f8a2f596a',
     'c99c564f-9827-4b3e-863e-bef527b7249f'
   )
   AND us.status::text IN ('active', 'expired')
   AND COALESCE(us.renewal_due_at, us.next_charge_at, us.expires_at::timestamptz)
       > NOW() - interval '7 days'
   AND gm.status::text <> 'active';


-- ─────────────────────────────────────────────────────────────
-- 3. CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────
SELECT
  gm.id AS membro,
  u.email,
  g.name AS grupo,
  gm.status::text          AS membro_status,
  gm.payment_status::text  AS pagamento,
  gm.left_at,
  gm.entrance_refunded,
  gm.subscription_deadline,
  us.status::text          AS assinatura_status,
  us.renewal_due_at         AS vencimento
FROM public.group_members gm
JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id
 AND us.group_id = gm.group_id
LEFT JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.id IN (
  '9f35d1f8-8be2-4e5b-bf61-535f8a2f596a',
  'c99c564f-9827-4b3e-863e-bef527b7249f'
)
ORDER BY gm.id;

-- 3.1) NINGUÉM pode ficar com vínculo cancelado e assinatura em vigor.
--      Se aparecer linha aqui, sobrou caso para reparar.
SELECT
  u.email,
  g.name AS grupo,
  gm.id AS membro,
  gm.status::text AS membro_status,
  gm.payment_status::text AS pagamento,
  us.id AS assinatura,
  us.status::text AS assinatura_status,
  us.renewal_due_at
FROM public.group_members gm
JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id
 AND us.group_id = gm.group_id
LEFT JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.status::text <> 'active'
  AND us.status::text IN ('active', 'expired')
  AND COALESCE(us.renewal_due_at, us.next_charge_at) > NOW();

-- 3.2) Nenhuma assinatura pode estar cancelada com o vencimento no futuro
--      enquanto o membro estiver em dia (o crão antigo que fazia isso foi
--      substituído pela versão de 09/11/2026).
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
