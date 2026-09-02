-- ============================================================
-- MIGRATION: Adiciona ciclo de faturamento aos grupos
-- ============================================================

-- Adiciona coluna de ciclo de faturamento com valores padrão mensal
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual'));

-- Adiciona coluna de desconto percentual para ciclos maiores (0 a 100)
ALTER TABLE groups
ADD COLUMN IF NOT EXISTS cycle_discount DECIMAL(5,2) NOT NULL DEFAULT 0
    CHECK (cycle_discount >= 0 AND cycle_discount <= 100);

-- Atualiza registros existentes para mensal sem desconto
UPDATE groups
SET billing_cycle = 'monthly',
    cycle_discount = 0
WHERE billing_cycle IS NULL;

-- Adiciona coluna de ciclo na assinatura para o webhook calcular vencimentos
ALTER TABLE user_subscriptions
ADD COLUMN IF NOT EXISTS billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly'
    CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual'));

-- Atualiza assinaturas existentes
UPDATE user_subscriptions
SET billing_cycle = 'monthly'
WHERE billing_cycle IS NULL;
