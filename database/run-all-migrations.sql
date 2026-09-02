-- ============================================================
-- MIGRAÇÃO COMBINADA: Slugs + Lista de Interesse
-- Rode este arquivo completo no Supabase SQL Editor
-- https://supabase.com/dashboard/project/lasoouwboxspstqvjbsv/sql/new
-- ============================================================

-- ============================================================
-- 1. SLUG NOS GRUPOS
-- ============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE groups SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;

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

-- ============================================================
-- 2. SLUG NAS PLATAFORMAS
-- ============================================================

ALTER TABLE streaming_services ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE streaming_services SET slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) WHERE slug IS NULL;

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

-- ============================================================
-- 3. LISTA DE INTERESSE
-- ============================================================

CREATE TABLE IF NOT EXISTS group_interest (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_interest_group ON group_interest(group_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_user ON group_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_service ON group_interest(service_id);

ALTER TABLE group_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_interest" ON group_interest
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_create_interest" ON group_interest
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_delete_interest" ON group_interest
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "admin_all_interest" ON group_interest
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );
