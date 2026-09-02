-- Backfill slugs for existing groups using #XXXXXX format from ID
UPDATE groups
SET slug = '#' || UPPER(LEFT(id::text, 6))
WHERE slug IS NULL OR slug = '';
