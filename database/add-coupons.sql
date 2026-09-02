-- ============================================
-- COUPONS TABLE - Sistema de cupons de desconto
-- ============================================

-- Enum para tipo de desconto
DO $$ BEGIN
  CREATE TYPE discount_type AS ENUM ('percentage', 'fixed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tabela principal de cupons
CREATE TABLE IF NOT EXISTS coupons (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  description TEXT,
  discount_type discount_type NOT NULL DEFAULT 'percentage',
  discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
  max_uses INTEGER DEFAULT NULL,
  used_count INTEGER NOT NULL DEFAULT 0,
  min_amount NUMERIC(10,2) DEFAULT 0,
  applies_to VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all', 'entrance', 'subscription')),
  group_id UUID DEFAULT NULL REFERENCES groups(id) ON DELETE CASCADE,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ DEFAULT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);
CREATE INDEX IF NOT EXISTS idx_coupons_group_id ON coupons(group_id);

-- RLS
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;

-- Admin pode tudo
CREATE POLICY "Admin full access on coupons"
  ON coupons FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Qualquer pessoa pode validar um cupom (para o checkout)
CREATE POLICY "Anyone can validate coupon code"
  ON coupons FOR SELECT
  USING (active = true);

-- Tabela de uso de cupons (log)
CREATE TABLE IF NOT EXISTS coupon_uses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('entrance', 'subscription')),
  original_amount NUMERIC(10,2) NOT NULL,
  discount_amount NUMERIC(10,2) NOT NULL,
  final_amount NUMERIC(10,2) NOT NULL,
  group_id UUID DEFAULT NULL REFERENCES groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon_id ON coupon_uses(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_user_id ON coupon_uses(user_id);

ALTER TABLE coupon_uses ENABLE ROW LEVEL SECURITY;

-- Admin pode ver todos os usos
CREATE POLICY "Admin full access on coupon_uses"
  ON coupon_uses FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Usuários podem ver seus próprios usos
CREATE POLICY "User can see own coupon uses"
  ON coupon_uses FOR SELECT
  USING (user_id = auth.uid());

-- Trigger para updated_at
CREATE OR REPLACE FUNCTION update_coupons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS coupons_updated_at ON coupons;
CREATE TRIGGER coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW
  EXECUTE FUNCTION update_coupons_updated_at();
