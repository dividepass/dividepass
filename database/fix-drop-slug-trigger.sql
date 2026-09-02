-- Remove trigger antigo que gerava slug a partir do nome
DROP TRIGGER IF EXISTS trg_generate_group_slug ON groups;
DROP FUNCTION IF EXISTS auto_generate_group_slug();
DROP FUNCTION IF EXISTS generate_group_slug(TEXT);
