-- Adiciona coluna metadata para guardar informações do alvo do anúncio
ALTER TABLE announcements ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT NULL;
