-- ============================================
-- APPROVAL SYSTEM FOR USER-CREATED GROUPS
-- ============================================

-- Enum para status de aprovação
DO $$ BEGIN
  CREATE TYPE group_approval_status AS ENUM ('pending', 'approved', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Adicionar colunas na tabela groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS approval_status group_approval_status DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS reviewed_by UUID DEFAULT NULL REFERENCES auth.users(id) ON DELETE SET NULL;

-- Grupos criados por admin são aprovados automaticamente
UPDATE groups SET approval_status = 'approved' WHERE owner_id IS NULL;
UPDATE groups SET approval_status = 'approved', approved_at = created_at WHERE owner_id IS NOT NULL AND approval_status IS NULL;

-- Índices
CREATE INDEX IF NOT EXISTS idx_groups_approval ON groups(approval_status);
