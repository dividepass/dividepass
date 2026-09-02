-- ============================================================
-- Destaque e fixar no topo para plataformas
-- ============================================================

ALTER TABLE IF EXISTS public.streaming_services ADD COLUMN IF NOT EXISTS featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE IF EXISTS public.streaming_services ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
