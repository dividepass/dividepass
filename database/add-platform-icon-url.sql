-- ============================================================
-- MIGRATION: Adiciona URL de ícone para plataformas
-- ============================================================

ALTER TABLE streaming_services
ADD COLUMN IF NOT EXISTS icon_url TEXT;
