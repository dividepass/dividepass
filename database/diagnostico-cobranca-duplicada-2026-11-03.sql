-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — escopo do problema + risco de DUPLA COBRANÇA
-- Data: 2026-11-03
-- ───────────────────────────────────────────────────────────────────────────
-- COMO USAR
--   1. SQL Editor do Supabase (lasoouwboxspstqvjbsv).
--   2. Cole este arquivo INTEIRO e clique em Run.
--   3. Me mande TODAS as 5 saídas (o SQL Editor mostra uma aba por consulta).
--
-- SEGURANÇA: 100% SELECT. Não altera nada.
--
-- POR QUE EXISTE
--   O caso da Cristiana mostrou algo que o diagnóstico anterior não pegava:
--   ela tem DUAS cobranças combinadas de R$ 39,80 (uma às 18:18 e outra às
--   20:43) e uma tentativa de R$ 29,90 antes disso. Se o gateway cobrar
--   qualquer uma delas que já tenha sido paga, a cliente paga duas vezes.
--   Este arquivo separa:
--     (1) quem pagou e NÃO foi liberada          -> precisa de reparo
--     (2) quem tem pagamento meio registrado     -> precisa de reparo
--     (3) quem tem MAIS DE UMA cobrançaequal     -> risco de dupla cobrança
--     (4) o extrato completo da Cristiana        -> o que já foi registrado
--     (5) as tentativas dela                     -> o que o job vai perguntar
--                                                  ao gateway
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. ESCOPO — quantas pessoas pagaram e não foram liberadas
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
  SELECT DISTINCT p.transaction_code FROM public.payments p WHERE p.status = 'paid'
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
     JOIN public.user_subscriptions us ON us.user_id = sp.user_id AND us.group_id = sp.group_id
    WHERE us.status::text = 'pending') AS assinatura_ainda_pendente,
  (SELECT count(*) FROM sem_pagamento sp
     JOIN public.group_members gm ON gm.user_id = sp.user_id AND gm.group_id = sp.group_id
    WHERE gm.payment_status::text <> 'active') AS vinculo_nao_ativo;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. QUEM PRECISA DE REPARO
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
  u.name AS cliente, u.email, g.name AS grupo, g.slug AS grupo_slug, s.name AS servico,
  c.status AS status_da_tentativa, c.payment_type AS tipo, c.amount AS valor_pago,
  c.gateway_transaction_id AS transacao,
  to_char(c.created_at, 'DD/MM/YYYY HH24:MI') AS tentativa_criada,
  us.status::text AS assinatura, us.amount AS valor_da_assinatura,
  to_char(us.next_charge_at, 'DD/MM/YYYY') AS proxima_cobrança,
  gm.payment_status::text AS vinculo_pagamento, gm.status AS vinculo_status,
  pg.tipos AS pagamentos_ja_registrados
FROM cand c
JOIN public.users u ON u.id = c.user_id
LEFT JOIN public.groups g ON g.id = c.group_id
LEFT JOIN public.streaming_services s ON s.id = g.service_id
LEFT JOIN public.user_subscriptions us ON us.user_id = c.user_id AND us.group_id = c.group_id
LEFT JOIN public.group_members gm ON gm.user_id = c.user_id AND gm.group_id = c.group_id
LEFT JOIN pagos pg ON pg.transaction_code = c.gateway_transaction_id
WHERE us.status::text = 'pending' OR gm.payment_status::text IS DISTINCT FROM 'active'
ORDER BY c.updated_at DESC NULLS LAST, c.created_at DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. MEIO CONFIRMADO — pagamento registrado, liberação pela metade
-- ───────────────────────────────────────────────────────────────────────────
WITH pagos AS (
  SELECT p.transaction_code, string_agg(p.payment_type, ',') AS tipos, max(p.created_at) AS quando
  FROM public.payments p WHERE p.status = 'paid' GROUP BY p.transaction_code
)
SELECT
  u.name AS cliente, u.email, g.name AS grupo, g.slug, pg.tipos AS tipos_pagos,
  to_char(pg.quando, 'DD/MM/YYYY HH24:MI') AS pagamento_em,
  us.status::text AS assinatura, gm.payment_status::text AS vinculo_pagamento,
  pa.status AS status_da_tentativa
FROM pagos pg
JOIN public.payment_attempts pa ON pa.gateway_transaction_id = pg.transaction_code
JOIN public.users u ON u.id = pa.user_id
LEFT JOIN public.groups g ON g.id = pa.group_id
LEFT JOIN public.user_subscriptions us ON us.user_id = pa.user_id AND us.group_id = pa.group_id
LEFT JOIN public.group_members gm ON gm.user_id = pa.user_id AND gm.group_id = pa.group_id
WHERE us.status::text IS DISTINCT FROM 'active'
   OR gm.payment_status::text IS DISTINCT FROM 'active'
ORDER BY pg.quando DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. RISCO DE DUPLA COBRANÇA
--
--    Mesma pessoa + mesmo grupo + MESMO valor + MESMO tipo, em transações
--    diferentes. Cada linha dessas é uma cobrança que pode ter sido paga.
--    O job de reconciliação pergunta ao gateway o status de CADA uma; se duas
--    estiverem pagas, a cliente pagou duas vezes e precisa de estorno do
--    valor duplicado.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  u.name AS cliente, u.email, g.name AS grupo, g.slug,
  a.payment_type AS tipo, a.amount AS valor,
  count(*) AS quantas_cobrancas,
  string_agg(a.gateway_transaction_id, ' | ') AS transacoes,
  string_agg(a.status, ' | ') AS status,
  min(to_char(a.created_at, 'DD/MM HH24:MI')) AS primeira,
  max(to_char(a.created_at, 'DD/MM HH24:MI')) AS ultima,
  (SELECT count(*) FROM public.payments p
    WHERE p.user_id = a.user_id AND p.group_id = a.group_id AND p.status = 'paid') AS pagamentos_registrados
FROM public.payment_attempts a
JOIN public.users u ON u.id = a.user_id
LEFT JOIN public.groups g ON g.id = a.group_id
WHERE a.gateway = 'iopay'
  AND a.gateway_transaction_id IS NOT NULL
  AND lower(coalesce(a.status, '')) NOT LIKE '%rejected%'
  AND lower(coalesce(a.status, '')) NOT LIKE '%failed%'
  AND lower(coalesce(a.status, '')) NOT LIKE '%cancelled%'
GROUP BY a.user_id, a.group_id, a.payment_type, a.amount, u.name, u.email, g.name, g.slug
HAVING count(*) > 1
ORDER BY quantas_cobrancas DESC, valor DESC
LIMIT 100;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. A CRISTIANA — o extrato e as tentativas (para conferir com o gateway)
--
--    payments_registrados: o que JÁ foi lançado no extrato dela.
--    tentativas:           o que o job vai perguntar ao gateway.
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  p.transaction_code AS transacao,
  p.payment_type AS tipo_no_extrato,
  p.amount AS valor_no_extrato,
  p.status AS status_no_extrato,
  to_char(p.created_at, 'DD/MM/YYYY HH24:MI') AS lancado_em,
  p.method AS metodo
FROM public.payments p
WHERE p.user_id = '218ce4bb-3fdb-476f-98c2-f1e36a35934b'
ORDER BY p.created_at DESC;

SELECT
  pa.gateway_transaction_id AS transacao,
  pa.payment_type AS tipo,
  pa.amount AS valor,
  pa.status AS status_da_tentativa,
  pa.payment_method AS metodo,
  to_char(pa.created_at, 'DD/MM/YYYY HH24:MI') AS criada_em,
  to_char(pa.updated_at, 'DD/MM/YYYY HH24:MI') AS atualizada_em,
  pa.external_reference
FROM public.payment_attempts pa
WHERE pa.user_id = '218ce4bb-3fdb-476f-98c2-f1e36a35934b'
ORDER BY pa.created_at DESC;

-- ═══════════════════════════════════════════════════════════════════════════
-- O QUE ESPERO DE VOLTA
--
--  Item 1: o tamanho do problema (pessoas_afetadas).
--  Item 2: a lista de quem precisa de reparo.
--  Item 3: quem tem pagamento meio registrado.
--  Item 4: **as cobranças duplicadas** — na Cristiana aparece 1 linha
--           (R$ 39,80 'combined' x 2). Se aparecer mais alguém, me avisa.
--  Item 5: o extrato e as tentativas da Cristiana.
--
--  COMO USAR ISSO: depois de publicar as functions e agendar o cron, o job
--  pergunta ao gateway o status de CADA tentativa listada no item 5. O que
--  estiver 'succeeded' vira pagamento no extrato. Se as DUAS de R$ 39,80
--  estiverem pagas, me mande o resultado do job — a Cristiana pagou duas
--  vezes e a segunda precisa de estorno.
-- ═══════════════════════════════════════════════════════════════════════════
