-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — pagamentos aprovados no gateway que NÃO liberaram o grupo
-- Data: 2026-11-03
-- ───────────────────────────────────────────────────────────────────────────
-- COMO USAR
--   1. SQL Editor do Supabase (lasoouwboxspstqvjbsv).
--   2. Cole este arquivo INTEIRO e clique em Run.
--   3. Me mande o resultado.
--
-- SEGURANÇA: 100% SELECT. Não altera nada.
--
-- POR QUE EXISTE
--   Entre 01/11 e 02/11 o polling (`check-iopay-tx`) respondia "já confirmei"
--   olhando o ESTADO DO VÍNCULO — e o `create-payment` gravava o vínculo como
--   "active" ANTES do pagamento. Resultado: o navegador recebia "confirmado",
--   a tela dizia sucesso, e a assinatura continuava PENDENTE (sem acesso e sem
--   e-mail). O job `reconcile-payments` + as functions novas resolvem isso.
--
--   Este arquivo mostra QUEM foi afetado (e se o job já resolveu).
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. RESUMO — quantas pessoas estão nessa situação agora
-- ───────────────────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT pa.id, pa.user_id, pa.group_id, pa.gateway_transaction_id, pa.status, pa.amount, pa.payment_type
  FROM public.payment_attempts pa
  WHERE pa.gateway = 'iopay'
    AND pa.gateway_transaction_id IS NOT NULL
    AND lower(coalesce(pa.status, '')) NOT LIKE '%rejected%'
    AND lower(coalesce(pa.status, '')) NOT LIKE '%failed%'
    AND lower(coalesce(pa.status, '')) NOT LIKE '%cancelled%'
),
pagos AS (
  SELECT DISTINCT p.transaction_code FROM public.payments p
  WHERE p.status = 'paid'
),
sem_pagamento AS (
  SELECT c.* FROM cand c
  LEFT JOIN pagos pg ON pg.transaction_code = c.gateway_transaction_id
  WHERE pg.transaction_code IS NULL
)
SELECT
  (SELECT count(*) FROM sem_pagamento) AS tentativas_aprovadas_sem_pagamento,
  (SELECT count(DISTINCT user_id) FROM sem_pagamento) AS pessoas_afetadas,
  (SELECT count(*) FROM sem_pagamento sp
     JOIN public.user_subscriptions us
       ON us.user_id = sp.user_id AND us.group_id = sp.group_id
    WHERE us.status::text = 'pending') AS assinatura_ainda_pendente,
  (SELECT count(*) FROM sem_pagamento sp
     JOIN public.group_members gm
       ON gm.user_id = sp.user_id AND gm.group_id = sp.group_id
    WHERE gm.payment_status::text <> 'active') AS vinculo_nao_ativo;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. QUEM ESTÁ AFETADO (assinatura pendente + pagamento aprovado no gateway)
-- ───────────────────────────────────────────────────────────────────────────
WITH cand AS (
  SELECT pa.id, pa.user_id, pa.group_id, pa.gateway_transaction_id, pa.status, pa.amount,
         pa.payment_type, pa.created_at, pa.updated_at, pa.external_reference
  FROM public.payment_attempts pa
  WHERE pa.gateway = 'iopay'
    AND pa.gateway_transaction_id IS NOT NULL
    AND lower(coalesce(pa.status, '')) NOT LIKE '%rejected%'
    AND lower(coalesce(pa.status, '')) NOT LIKE '%failed%'
    AND lower(coalesce(pa.status, '')) NOT LIKE '%cancelled%'
),
pagos AS (
  SELECT transaction_code, string_agg(payment_type, ',') AS tipos FROM public.payments
  WHERE status = 'paid' GROUP BY transaction_code
)
SELECT
  u.name  AS cliente,
  u.email AS email,
  g.name  AS grupo,
  g.slug  AS grupo_slug,
  s.name  AS servico,
  c.status        AS status_da_tentativa,
  c.payment_type  AS tipo,
  c.amount        AS valor_pago,
  c.gateway_transaction_id AS transacao,
  to_char(c.created_at, 'DD/MM/YYYY HH24:MI') AS tentativa_criada,
  to_char(c.updated_at, 'DD/MM/YYYY HH24:MI') AS tentativa_atualizada,
  us.status::text AS assinatura,
  us.amount       AS valor_da_assinatura,
  to_char(us.next_charge_at, 'DD/MM/YYYY') AS proxima_cobrança,
  gm.payment_status::text AS vinculo_pagamento,
  gm.status       AS vinculo_status,
  pg.tipos        AS pagamentos_ja_registrados
FROM cand c
JOIN public.users u  ON u.id = c.user_id
LEFT JOIN public.groups g ON g.id = c.group_id
LEFT JOIN public.streaming_services s ON s.id = g.service_id
LEFT JOIN public.user_subscriptions us
       ON us.user_id = c.user_id AND us.group_id = c.group_id
LEFT JOIN public.group_members gm
       ON gm.user_id = c.user_id AND gm.group_id = c.group_id
LEFT JOIN pagos pg ON pg.transaction_code = c.gateway_transaction_id
WHERE us.status::text = 'pending' OR gm.payment_status::text IS DISTINCT FROM 'active'
ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. CASOS "MEIO CONFIRMADO" — o pagamento foi registrado mas a liberação
--    ficou pela metade (a armadilha do replay ignorado).
--    Estes são os que a GUARDA nova (`liberacaoConcluida`) vai refazer.
-- ───────────────────────────────────────────────────────────────────────────
WITH pagos AS (
  SELECT p.transaction_code, string_agg(p.payment_type, ',') AS tipos, max(p.created_at) AS quando
  FROM public.payments p
  WHERE p.status = 'paid' GROUP BY p.transaction_code
)
SELECT
  u.name AS cliente, u.email,
  g.name AS grupo, g.slug,
  pg.tipos AS tipos_pagos,
  to_char(pg.quando, 'DD/MM/YYYY HH24:MI') AS pagamento_em,
  us.status::text AS assinatura,
  gm.payment_status::text AS vinculo_pagamento,
  pa.status AS status_da_tentativa
FROM pagos pg
JOIN public.payment_attempts pa ON pa.gateway_transaction_id = pg.transaction_code
JOIN public.users u ON u.id = pa.user_id
LEFT JOIN public.groups g ON g.id = pa.group_id
LEFT JOIN public.user_subscriptions us
       ON us.user_id = pa.user_id AND us.group_id = pa.group_id
LEFT JOIN public.group_members gm
       ON gm.user_id = pa.user_id AND gm.group_id = pa.group_id
WHERE us.status::text IS DISTINCT FROM 'active'
   OR gm.payment_status::text IS DISTINCT FROM 'active'
ORDER BY pg.quando DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. A CRISTIANA (caso relatado em 03/11)
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  u.id AS user_id, u.name, u.email,
  g.id AS group_id, g.name AS grupo, g.slug,
  s.name AS servico,
  g.entrance_fee AS taxa_de_adesao,
  g.price_per_slot AS preco_mensal,
  g.billing_cycle AS ciclo,
  us.id AS assinatura_id, us.status::text AS assinatura_status,
  us.amount AS valor_assinatura, us.next_charge_at,
  gm.payment_status::text AS vinculo_pagamento, gm.status AS vinculo_status,
  pa.id AS tentativa_id, pa.status AS tentativa_status, pa.amount AS tentativa_valor,
  pa.payment_type AS tentativa_tipo, pa.gateway_transaction_id AS transacao,
  pa.created_at AS tentativa_criada, pa.updated_at AS tentativa_atualizada,
  pa.external_reference
FROM public.users u
LEFT JOIN public.groups g ON g.id = (
  SELECT gm2.group_id FROM public.group_members gm2
   WHERE gm2.user_id = u.id ORDER BY gm2.created_at DESC LIMIT 1)
LEFT JOIN public.streaming_services s ON s.id = g.service_id
LEFT JOIN public.user_subscriptions us
       ON us.user_id = u.id AND us.group_id = g.id
LEFT JOIN public.group_members gm
       ON gm.user_id = u.id AND gm.group_id = g.id
LEFT JOIN public.payment_attempts pa
       ON pa.user_id = u.id AND pa.group_id = g.id
WHERE lower(u.email) = 'vieiracristiana817@gmail.com'
ORDER BY pa.created_at DESC NULLS LAST
LIMIT 20;

-- ═══════════════════════════════════════════════════════════════════════════
-- O QUE ESPERO DE VOLTA
--
--  Item 1: "pessoas_afetadas" = quantas clentes pagaram e não entraram.
--           (A Cristiana entra aqui; o nome dela aparece no item 2.)
--  Item 2: a lista de quem precisa de reparo — com o valor pago, o tipo
--           (Combined/Assinatura) e se a assinatura está pendente.
--  Item 3: quem tem pagamento registrado mas liberação incompleta.
--  Item 4: o recorte da Cristiana (tentativas, assinatura e vínculo).
--
-- DEPOIS DE PUBLICAR as functions e agendar o cron, rode o item 1 de novo:
-- o "pessoas_afetadas" precisa cair a zero.
-- ═══════════════════════════════════════════════════════════════════════════
