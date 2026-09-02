-- ============================================
-- MIGRAÇÃO: Fluxo de Pagamento em 2 Etapas
-- ============================================

-- 1. Tipo enum
DO $$ BEGIN
  CREATE TYPE payment_flow_status AS ENUM (
    'awaiting_entrance', 'entrance_paid', 'awaiting_subscription',
    'active', 'expired', 'refunded', 'cancelled'
  );
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- 2. Remover trigger que usa updated_at (group_members não tem essa coluna)
DROP TRIGGER IF EXISTS trg_group_members_updated_at ON group_members;

-- 3. Colunas de controle de pagamento
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS payment_status payment_flow_status DEFAULT 'awaiting_entrance';
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS entrance_paid_at TIMESTAMPTZ;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS entrance_payment_id TEXT;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS subscription_deadline TIMESTAMPTZ;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS entrance_refunded BOOLEAN DEFAULT FALSE;
ALTER TABLE group_members ADD COLUMN IF NOT EXISTS subscription_mp_id TEXT;

-- 4. Atualizar membros existentes
UPDATE group_members SET payment_status = 'active' WHERE status = 'active';

-- 5. Colunas em payments
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES groups(id);

-- 6. Função para verificar prazos expirados
CREATE OR REPLACE FUNCTION check_expired_entrances()
RETURNS void AS $$
BEGIN
  UPDATE group_members
  SET payment_status = 'expired', status = 'cancelled', left_at = NOW()
  WHERE payment_status IN ('entrance_paid', 'awaiting_subscription')
    AND subscription_deadline < NOW();
END;
$$ LANGUAGE plpgsql;
