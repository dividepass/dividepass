-- ============================================
-- COUPON TRACKING - Rastreamento de cupons + melhorias admin
-- ============================================

-- 1. Adicionar coluna recurring na tabela coupons
ALTER TABLE coupons ADD COLUMN IF NOT EXISTS recurring BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN coupons.recurring IS 'Se true, cupom aplica desconto em TODOS os pagamentos recorrentes. Se false, aplica apenas na primeira vez.';

-- 2. Adicionar colunas de cupom na tabela user_subscriptions
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2) DEFAULT 0;

COMMENT ON COLUMN user_subscriptions.coupon_id IS 'Cupom aplicado na assinatura';
COMMENT ON COLUMN user_subscriptions.discount_amount IS 'Valor do desconto aplicado';
COMMENT ON COLUMN user_subscriptions.original_amount IS 'Valor original antes do desconto';

-- 3. Adicionar coluna de cupom na tabela payment_attempts
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10,2) DEFAULT 0;
ALTER TABLE payment_attempts ADD COLUMN IF NOT EXISTS original_amount NUMERIC(10,2) DEFAULT 0;

-- 4. Criar índice para coupon_id em user_subscriptions
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_coupon_id ON user_subscriptions(coupon_id);

-- 5. Adicionar política RLS para admin ver payment_attempts
-- (já existe política para users verem os próprios)
CREATE POLICY "Admin can view all payment_attempts"
  ON payment_attempts FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- 6. Backfill: definir original_amount = amount para assinaturas existentes sem cupom
UPDATE user_subscriptions
SET original_amount = amount
WHERE original_amount = 0 OR original_amount IS NULL;
