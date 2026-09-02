-- Adicionar URL oficial da plataforma
ALTER TABLE streaming_services ADD COLUMN IF NOT EXISTS official_url TEXT;
