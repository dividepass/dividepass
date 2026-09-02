-- ============================================================
-- MIGRATION: Adiciona campos para grupos criados por usuários
-- ============================================================

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS cover_url TEXT;

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Índice para listar grupos de um usuário proprietário
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);
