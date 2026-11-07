-- ═══════════════════════════════════════════════════════════════════════════
-- DIAGNÓSTICO — caso Marisa Córdoba Amarantes (pagamento aprovado sem liberação)
-- Data: 2026-11-01
-- ───────────────────────────────────────────────────────────────────────────
-- COMO USAR
--   1. Abra o SQL Editor do Supabase (lasoouwboxspstqvjbsv).
--   2. Cole este arquivo INTEIRO e clique em Run.
--   3. Me mande o RESULTADO (as tabelas) — é só leitura, não muda nada.
--
-- SEGURANÇA: este arquivo é 100% SELECT. Não altera nenhum dado.
-- Pode rodar quantas vezes quiser.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1. VEREDITO: o grupo da transação existe? O pagamento foi aplicado?
--    (leitura de 1 linha — é o resumo do caso)
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  EXISTS (SELECT 1 FROM groups WHERE id = '11111111-1111-1111-1111-111111111111')
    AS grupo_da_referencia_existe,
  (SELECT count(*) FROM groups WHERE name ILIKE '%Grupo 3%')
    AS grupos_chamados_grupo_3,
  (SELECT count(*) FROM payment_attempts
     WHERE gateway_transaction_id = 'd73c9d40a7464a3db981a80137918e67')
    AS tentativas_da_transacao,
  (SELECT count(*) FROM payments
     WHERE transaction_code = 'd73c9d40a7464a3db981a80137918e67')
    AS pagamentos_aplicados_da_transacao,
  (SELECT count(*) FROM user_subscriptions
     WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456' AND status = 'pending')
    AS assinaturas_pendentes_da_marisa,
  (SELECT count(*) FROM group_members
     WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456')
    AS vinculos_da_marisa;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. TENTATIVAS DE PAGAMENTO (todas da Marisa + a da transação citada)
--    status 'created'  = criada pelo create-payment, NUNCA atualizada
--                        (webhook nem polling chegaram nela)
--    status 'polled_*' = o navegador perguntou ao gateway
--    status 'webhook_*'= o gateway avisou
--    ATENÇÃO: se houver MAIS DE UMA linha com o mesmo gateway_transaction_id,
--    isso é a duplicidade que quebrava o webhook.
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(pa) - 'pix_copy_paste' AS tentativa
FROM payment_attempts pa
WHERE gateway_transaction_id = 'd73c9d40a7464a3db981a80137918e67'
   OR user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456'
ORDER BY pa.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 3. ASSINATURAS da Marisa (group_id NULL = o grupo foi apagado)
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(us) AS assinatura
FROM user_subscriptions us
WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456'
ORDER BY us.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 4. GRUPOS: os que a assinatura/vínculo apontam + todos os "Grupo 3"
-- ───────────────────────────────────────────────────────────────────────────
WITH ids AS (
  SELECT group_id FROM user_subscriptions
   WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456' AND group_id IS NOT NULL
  UNION
  SELECT group_id FROM group_members
   WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456' AND group_id IS NOT NULL
  UNION
  SELECT group_id FROM payment_attempts
   WHERE user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456' AND group_id IS NOT NULL
)
SELECT to_jsonb(g) AS grupo
FROM groups g
WHERE g.id IN (SELECT group_id FROM ids)
   OR g.name ILIKE '%Grupo 3%'
ORDER BY g.name;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. VÍNCULOS (group_members) da Marisa
--    payment_status 'entrance_paid' = ela pagou a taxa de adesão
--    payment_status 'active'       = assinatura ativa no grupo
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(gm) AS vinculo
FROM group_members gm
WHERE gm.user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456'
ORDER BY gm.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 6. PAGAMENTOS (a linha "paid" é o que libera o acesso)
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(p) AS pagamento
FROM payments p
WHERE p.user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456'
   OR p.transaction_code = 'd73c9d40a7464a3db981a80137918e67'
ORDER BY p.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 7. EVENTOS do painel (pagamento confirmado / membro ingressou / falhou)
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(pe) AS evento
FROM platform_events pe
WHERE pe.created_at > now() - interval '3 days'
  AND (pe.metadata::text ILIKE '%d73c9d40a7464a3db981a80137918e67%'
       OR pe.metadata::text ILIKE '%d2ccd4d5-d811-4f04-8d65-4f64bbefb456%'
       OR pe.message ILIKE '%Marisa%')
ORDER BY pe.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 8. E-MAILS enviados para a Marisa
--    (email_logs não tem user_id — o vínculo é pelo destinatário "to")
-- ───────────────────────────────────────────────────────────────────────────
SELECT to_jsonb(el) AS email
FROM email_logs el
WHERE el."to" ILIKE '%mfcordoba9@gmail.com%'
ORDER BY el.created_at DESC
LIMIT 20;

-- ───────────────────────────────────────────────────────────────────────────
-- 9. CHAVES ESTRANGEIRAS (o que decide se um grupo pode sumir
--    deixando a assinatura órfã):
--    'c' = cascade (apaga a assinatura junto) | 'n' = no action (não deixa
--    apagar) | 'd' = set null (a assinatura fica, sem grupo)
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  src.relname  AS tabela,
  con.conname  AS constraint,
  tgt.relname  AS tabela_referenciada,
  con.confdeltype AS on_delete,
  pg_get_constraintdef(con.oid) AS definicao
FROM pg_constraint con
JOIN pg_class src ON src.oid = con.conrelid
LEFT JOIN pg_class tgt ON tgt.oid = con.confrelid
WHERE con.contype = 'f'
  AND src.relname IN ('user_subscriptions','group_members','payments','payment_attempts')
  AND (tgt.relname = 'groups' OR src.relname = 'user_subscriptions')
ORDER BY src.relname, con.conname;

-- ═══════════════════════════════════════════════════════════════════════════
-- O QUE EU ESPERO DE VOLTA (para eu bater o martelo):
--
--  A) Se (1) responder grupo_da_referencia_existe = false  → o grupo da
--     referência foi APAGADO (ou nunca existiu) e sobrou a assinatura órfã.
--     O conserto é o arquivo database/reparo-marisa-2026-11-01.sql.
--
--  B) Se houver 2+ linhas em (2) com o mesmo gateway_transaction_id → é a
--     duplicidade que já quebrava o webhook (o caso Fran).
--
--  C) Se em (2) todas as linhas estiverem com status 'created' (nunca
--     atualizadas) → NENHUM dos dois caminhos (webhook e polling) acted on
--     essa transação: foi exatamente o que travou o caso da Marisa.
--
--  D) O item (9) diz se o grupo pode ter sido apagado deixando a assinatura
--     órfã ('d' = set null) ou se ele ainda existe ('c'/'n').
-- ═══════════════════════════════════════════════════════════════════════════
