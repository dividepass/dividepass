-- ============================================================
-- MIGRATION: Adiciona slug para URLs amigáveis nos serviços
-- ============================================================

ALTER TABLE streaming_services
ADD COLUMN IF NOT EXISTS slug TEXT;

-- Gera slugs para serviços existentes
UPDATE streaming_services SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;

-- Garante unicidade dos slugs existentes
DO $$
DECLARE
  r RECORD;
  base_slug TEXT;
  final_slug TEXT;
  suffix INT;
BEGIN
  FOR r IN SELECT id, slug FROM streaming_services ORDER BY created_at LOOP
    base_slug := r.slug;
    suffix := 0;
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM streaming_services WHERE slug = final_slug AND id != r.id) LOOP
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    END LOOP;
    IF final_slug != r.slug THEN
      UPDATE streaming_services SET slug = final_slug WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_streaming_services_slug ON streaming_services(slug);

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE OR REPLACE FUNCTION generate_service_slug(name TEXT) RETURNS TEXT AS $$
DECLARE
    base_slug TEXT;
    final_slug TEXT;
    suffix INT := 0;
BEGIN
    base_slug := lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'));
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM streaming_services WHERE slug = final_slug) LOOP
        suffix := suffix + 1;
        final_slug := base_slug || '-' || suffix;
    END LOOP;
    RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_generate_service_slug() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := generate_service_slug(NEW.name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_service_slug ON streaming_services;
CREATE TRIGGER trg_generate_service_slug
    BEFORE INSERT ON streaming_services
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_service_slug();
