-- ============================================================
-- MIGRATION: Adiciona tags aos grupos
-- ============================================================

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}';
