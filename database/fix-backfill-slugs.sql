-- Backfill: remover # dos slugs existentes e garantir formato limpo
UPDATE groups
SET slug = UPPER(LEFT(REPLACE(slug, '#', ''), 6))
WHERE slug LIKE '#%' OR slug IS NULL OR slug = '';
