-- ============================================================================
-- Colunas usadas pelas Edge Functions que nunca chegaram ao banco
-- ============================================================================
--
-- O PostgREST valida o payload de cada insert/upsert/update contra o schema
-- real: escrever uma coluna inexistente devolve 400 (PGRST204) e a gravacao
-- INTEIRA e perdida — sem erro visivel na tela, porque o handler nao checa o
-- retorno do upsert.
--
-- Efeito no gateway ativo (iopay):
--   1. `create-payment` gravava a assinatura com `payment_method` e
--      `custom_cycle_label` -> o upsert falhava e a assinatura nunca era criada.
--   2. `create-payment` gravava a fatura com `payment_method` -> a fatura nunca
--      era criada (e o painel mostrava "Cobrança ainda não gerada").
--   3. `check-iopay-tx` lia e gravava `payment_method` na assinatura -> o
--      `confirmIOPayment` falhava e a assinatura nunca era ativada, mesmo com
--      o pagamento aprovado.
--
-- Este arquivo adiciona as colunas. Todas sao aditivas e nullable: nenhum
-- dado existente e alterado.
--
-- Verificacao pos-aplicacao (qualquer coluna que falhar aqui esta de novo
-- fora do schema):
--   node scripts/audit-write-columns.mjs
-- ============================================================================

-- Gateway ativo (iopay): assinatura e fatura.
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS custom_cycle_label VARCHAR(50);
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50);

-- Handlers de gateway inativos (asaas, mercadopago, stripe) gravam o gateway
-- no vinculo do membro com o grupo.
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS gateway VARCHAR(50);

-- `update-subscription-statuses` marca a ultima atualizacao do vinculo.
-- Sem DEFAULT de propósito: os registros existentes ficam com NULL e nenhuma
-- linha e reescrita.
ALTER TABLE public.group_members ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

-- Agendamento manual de cobranca pelo admin (manage-crons).
ALTER TABLE public.billing_cycles ADD COLUMN IF NOT EXISTS notes TEXT;
