-- ============================================================
-- MIGRATION: Adiciona regras do grupo
-- ============================================================

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS rules TEXT;
