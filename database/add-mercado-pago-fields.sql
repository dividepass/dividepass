-- Adiciona campos do Mercado Pago às tabelas existentes

-- Adiciona dados da assinatura do Mercado Pago em user_subscriptions
ALTER TABLE user_subscriptions
    ADD COLUMN IF NOT EXISTS mercado_pago_subscription_id TEXT,
    ADD COLUMN IF NOT EXISTS amount DECIMAL(10,2),
    ADD COLUMN IF NOT EXISTS external_reference TEXT,
    ADD COLUMN IF NOT EXISTS mercado_pago_status TEXT;

-- Adiciona referência ao grupo em invoices para facilitar rastreamento
ALTER TABLE invoices
    ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id) ON DELETE SET NULL;

-- Índices úteis
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_mp_id ON user_subscriptions(mercado_pago_subscription_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_external_ref ON user_subscriptions(external_reference);
