-- Adicionar reference_code (6 dígitos) para cada grupo
ALTER TABLE groups ADD COLUMN IF NOT EXISTS reference_code TEXT;

-- Gerar códigos únicos para grupos existentes que não têm
UPDATE groups
SET reference_code = UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6))
WHERE reference_code IS NULL;

-- Garantir unicidade
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_reference_code ON groups(reference_code);

-- Trigger para gerar automaticamente ao criar grupo sem reference_code
CREATE OR REPLACE FUNCTION generate_reference_code()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.reference_code IS NULL OR NEW.reference_code = '' THEN
    NEW.reference_code := UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_reference_code ON groups;
CREATE TRIGGER trg_generate_reference_code
  BEFORE INSERT ON groups
  FOR EACH ROW
  EXECUTE FUNCTION generate_reference_code();
