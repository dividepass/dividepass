-- Backfill: gera as faturas de ciclos vencidos que nunca foram criadas.
--
-- Contexto: o cron process-recurring-billing vinha retornando 401 (o gateway
-- exige JWT e o cron manda o segredo de app_settings), então nenhuma cobrança
-- recorrente era processada. Como a fatura só era criada APÓS o sucesso da
-- cobrança, as assinaturas que venceram ficaram sem nenhum registro e sem
-- botão de pagamento no front.
--
-- Este script cria uma fatura 'pending' para cada assinatura ativa cujo
-- next_charge_at já passou e que não possui fatura aberta para o mesmo
-- vencimento. É idempotente: rodar de novo não duplica.

INSERT INTO invoices (user_id, group_id, amount, due_date, status, created_at)
SELECT
  s.user_id,
  s.group_id,
  s.amount,
  (s.next_charge_at)::date AS due_date,
  'pending'::payment_status,
  now()
FROM user_subscriptions s
WHERE s.status = 'active'
  AND s.next_charge_at IS NOT NULL
  AND s.next_charge_at <= now()
  AND s.billing_status IS DISTINCT FROM 'cancelled'
  AND NOT EXISTS (
    SELECT 1
    FROM invoices i
    WHERE i.user_id = s.user_id
      AND i.group_id = s.group_id
      AND i.status IN ('pending'::payment_status, 'failed'::payment_status)
      AND i.due_date = (s.next_charge_at)::date
  )
  AND NOT EXISTS (
    -- já existe fatura paga para este ciclo
    SELECT 1
    FROM invoices i
    WHERE i.user_id = s.user_id
      AND i.group_id = s.group_id
      AND i.status = 'paid'::payment_status
      AND i.due_date = (s.next_charge_at)::date
  );
