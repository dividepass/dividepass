-- ============================================================
-- MIGRATION: Adiciona slug para URLs amigáveis nos grupos
-- ============================================================

ALTER TABLE groups
ADD COLUMN IF NOT EXISTS slug TEXT;

-- Gera slugs para grupos existentes baseado no nome
UPDATE groups SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;

-- Garante unicidade dos slugs existentes
DO $$
DECLARE
  r RECORD;
  base_slug TEXT;
  final_slug TEXT;
  suffix INT;
BEGIN
  FOR r IN SELECT id, slug FROM groups ORDER BY created_at LOOP
    base_slug := r.slug;
    suffix := 0;
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM groups WHERE slug = final_slug AND id != r.id) LOOP
      suffix := suffix + 1;
      final_slug := base_slug || '-' || suffix;
    END LOOP;
    IF final_slug != r.slug THEN
      UPDATE groups SET slug = final_slug WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_slug ON groups(slug);

-- Função para gerar slug único a partir do nome
CREATE OR REPLACE FUNCTION generate_group_slug(name TEXT) RETURNS TEXT AS $$
DECLARE
    base_slug TEXT;
    final_slug TEXT;
    suffix INT := 0;
BEGIN
    base_slug := lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g'));
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM groups WHERE slug = final_slug) LOOP
        suffix := suffix + 1;
        final_slug := base_slug || '-' || suffix;
    END LOOP;
    RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

-- Trigger para auto-gerar slug no INSERT
CREATE OR REPLACE FUNCTION auto_generate_group_slug() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := generate_group_slug(NEW.name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_group_slug ON groups;
CREATE TRIGGER trg_generate_group_slug
    BEFORE INSERT ON groups
    FOR EACH ROW
    EXECUTE FUNCTION auto_generate_group_slug();
