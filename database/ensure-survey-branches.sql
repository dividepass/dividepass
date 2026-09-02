-- Ensure branch_sim and branch_nao columns exist on survey_steps
-- Safe to run multiple times (uses IF NOT EXISTS)

-- Add columns if they don't exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'survey_steps' AND column_name = 'branch_sim'
  ) THEN
    ALTER TABLE survey_steps ADD COLUMN branch_sim UUID;
    RAISE NOTICE 'Added branch_sim column';
  ELSE
    RAISE NOTICE 'branch_sim column already exists';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'survey_steps' AND column_name = 'branch_nao'
  ) THEN
    ALTER TABLE survey_steps ADD COLUMN branch_nao UUID;
    RAISE NOTICE 'Added branch_nao column';
  ELSE
    RAISE NOTICE 'branch_nao column already exists';
  END IF;
END $$;

-- Add comments
COMMENT ON COLUMN survey_steps.branch_sim IS 'ID do step destino quando resposta = Sim';
COMMENT ON COLUMN survey_steps.branch_nao IS 'ID do step destino quando resposta = Nao';
