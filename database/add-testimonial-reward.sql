-- ============================================
-- TESTIMONIAL REWARD - Sistema de recompensa por depoimento
-- ============================================

-- 1. Marcar se o testemunho gerou recompensa de R$5
ALTER TABLE testimonials
  ADD COLUMN IF NOT EXISTS reward_granted BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN testimonials.reward_granted IS
  'Indica se este testemunho gerou cupom de desconto de R$5 para o usuário.';

-- 2. Criar índice para busca rápida
CREATE INDEX IF NOT EXISTS idx_testimonials_reward_granted
  ON testimonials(user_id, reward_granted)
  WHERE reward_granted = true;

-- 3. Grant para função idempotente (criada via Edge Function, mas garantindo permissão)
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO anon;
