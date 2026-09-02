-- Adiciona campos para rastreamento de economia por pagamento.
-- Preserva o preço de referência "sozinho" no momento do pagamento
-- para que a economia não seja recalculada se o preço da plataforma mudar.

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS official_price DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS paid_amount DECIMAL(10,2);

COMMENT ON COLUMN payments.official_price IS 'Preço oficial da plataforma no momento do pagamento. Usado para calcular economia sem depender de mudanças futuras.';
COMMENT ON COLUMN payments.paid_amount IS 'Valor final pago pelo usuário (após cupons). Usado para calcular economia real.';
