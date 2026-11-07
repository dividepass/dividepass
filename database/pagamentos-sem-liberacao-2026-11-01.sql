-- ============================================================================
-- PAGAMENTO APROVADO SEM LIBERAÇÃO — "paguei e não fui add ao grupo"
-- ============================================================================
-- Data: 01/11/2026
-- Motivo: a Fran Ribeiro pagou R$ 59,40 no grupo "Netflix C/ Anúncio"
--         (plano semiannual: R$ 9,90 x 6). O gateway aprovou, o painel marcou
--         a tentativa como "Aprovado", mas o acesso nunca foi liberado: sem
--         assinatura ativa, sem evento no painel e sem e-mail da DividePass.
--         Só entrou às 15:40, quando o admin usou a confirmação manual.
--
-- ESTE SCRIPT SÓ DIAGNOSTICA (SELECT). Ele não muda nada.
--
-- COMO LER O RESULTADO
--   tentativa_aprovada  = o gateway disse que foi paga
--   sem_liberacao      = o gateway approveu mas não existe pagamento aplicado
--                         → é o caso quebrado (cliente pagou e ficou fora)
--   com_liberacao      = o pagamento foi aplicado normalmente
--
-- COMO CORRIGIR
--   1) publique a edge function `reconcile-payments` (a nova rede de
--      segurança: ela pergunta o status real à IO Pay e libera o que estiver
--      pago);
--   2) rode o job:  ver database/pagamentos-sem-liberacao-2026-11-01.sql
--      ou chame a função manualmente (ver o bloco "RODAR A RECONCILIAÇÃO");
--   3) o job cria a assinatura, ativa o vínculo, registra o pagamento,
--      cria o ciclo de cobrança e MANDA OS E-MAILS para o cliente.
--
-- ============================================================================

-- ── 1. QUEM PAGOU E NÃO ENTROU ─────────────────────────────────────────────
-- Uma tentativa do gateway que:
--   • não tem linha paga em `payments` com o mesmo transaction_code, e
--   • não foi recusada pelo gateway.
SELECT
  pa.created_at                       AS tentativa_em,
  u.name                              AS cliente,
  u.email                             AS e_mail,
  g.name                              AS grupo,
  pa.payment_type                     AS tipo,
  pa.amount                           AS valor,
  pa.status                           AS tentativa_status,
  pa.gateway_transaction_id           AS transacao,
  pa.external_reference               AS referencia,
  gm.status                           AS membro_status,
  gm.payment_status                   AS membro_pagamento,
  gm.joined_at                        AS entrou_em,
  us.id IS NOT NULL                   AS tem_assinatura,
  us.status                           AS assinatura_status,
  CASE
    WHEN pa.status LIKE 'webhook_%' OR pa.status LIKE 'polled_%'
      THEN 'gateway confirmou'
    ELSE 'sem confirmacao do gateway'
  END                                 AS tentativa_aprovada,
  CASE
    WHEN gm.id IS NULL THEN 'SEM LIBERACAO - nem vinculado'
    WHEN us.id IS NULL AND pa.payment_type = 'subscription'
      THEN 'SEM LIBERACAO - sem assinatura ativa'
    ELSE 'liberado'
  END                                 AS situacao
FROM public.payment_attempts pa
JOIN public.users  u ON u.id = pa.user_id
LEFT JOIN public.groups g ON g.id = pa.group_id
LEFT JOIN public.group_members gm
       ON gm.group_id = pa.group_id AND gm.user_id = pa.user_id
LEFT JOIN public.user_subscriptions us
       ON us.group_id = pa.group_id AND us.user_id = pa.user_id
WHERE pa.gateway = 'iopay'
  AND pa.gateway_transaction_id IS NOT NULL
  AND pa.created_at >= now() - interval '90 days'
  AND pa.status NOT LIKE '%rejected%'
  AND pa.status NOT LIKE '%failed%'
  AND pa.status NOT LIKE '%cancelled%'
  AND pa.status NOT LIKE '%refunded%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.transaction_code = pa.gateway_transaction_id
      AND p.status = 'paid'
  )
ORDER BY pa.created_at DESC;

-- ── 2. RESUMO POR GRUPO (quem mais foi afetado) ─────────────────────────────
SELECT
  COALESCE(g.name, pa.group_id::text)  AS grupo,
  count(*)                              AS pagamentos_sem_liberacao,
  min(pa.created_at)                    AS mais_antigo,
  max(pa.created_at)                    AS mais_recente,
  sum(pa.amount)                        AS valor_total
FROM public.payment_attempts pa
LEFT JOIN public.groups g ON g.id = pa.group_id
WHERE pa.gateway = 'iopay'
  AND pa.gateway_transaction_id IS NOT NULL
  AND pa.created_at >= now() - interval '90 days'
  AND pa.status NOT LIKE '%rejected%'
  AND pa.status NOT LIKE '%failed%'
  AND pa.status NOT LIKE '%cancelled%'
  AND pa.status NOT LIKE '%refunded%'
  AND NOT EXISTS (
    SELECT 1
    FROM public.payments p
    WHERE p.transaction_code = pa.gateway_transaction_id
      AND p.status = 'paid'
  )
GROUP BY 1
ORDER BY 2 DESC, 3 ASC;

-- ── 3. O CASO DA FRAN ──────────────────────────────────────────────────────
SELECT
  pa.created_at             AS tentativa_em,
  pa.status                 AS tentativa_status,
  pa.gateway_transaction_id AS transacao,
  pa.amount                 AS valor,
  g.name                    AS grupo,
  g.billing_cycle           AS ciclo,
  g.price_per_slot          AS preco_por_vaga,
  gm.joined_at              AS entrou_em,
  gm.payment_status         AS membro_pagamento
FROM public.payment_attempts pa
JOIN public.users u ON u.id = pa.user_id
LEFT JOIN public.groups g ON g.id = pa.group_id
LEFT JOIN public.group_members gm
       ON gm.group_id = pa.group_id AND gm.user_id = pa.user_id
WHERE u.email = 'kellrodrigues92@gmail.com'
ORDER BY pa.created_at DESC;

-- ── 4. SANIDADE: o total de pagamentos aplicados ────────────────────────────
-- Se a 1ª query devolver muita gente e esta devolver 0, o problema está no
-- `transaction_code` e não na liberação.
SELECT
  count(*) FILTER (WHERE status = 'paid')    AS pagos,
  count(*) FILTER (WHERE status <> 'paid')   AS nao_pagos,
  count(DISTINCT transaction_code)          AS transacoes_distintas
FROM public.payments
WHERE gateway = 'iopay';

-- ============================================================================
-- RODAR A RECONCILIAÇÃO
-- ============================================================================
-- A reconciliação pergunta à IO Pay o status real de cada transação e libera
-- o que estiver pago. Depois de publicar a function `reconcile-payments`:
--
--   curl -X POST "https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments" \
--        -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
--        -H "Content-Type: application/json" \
--        -d '{}'
--
-- A resposta traz o resumo:
--   examinadas / aprovadas_no_gateway / confirmadas / falharam / recusadas
--
-- O job também pode ser agendado (a cada 15 min):
--   select cron.schedule('reconcile-payments', '*/15 * * * *', $$
--     select net.http_post(
--       url := 'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
--       ),
--       body := '{}'::jsonb
--     );
--   $$);
--
-- ⚠️ O segredo do cron precisa existir em `app_settings`
--    (`reconcile_payments_cron_secret`) ou como secret `BILLING_CRON_SECRET`.
-- ============================================================================
