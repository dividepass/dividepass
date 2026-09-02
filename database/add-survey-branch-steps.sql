-- Adicionar colunas INT para branches (step_number em vez de UUID)
-- Mais simples e confiável que UUID

ALTER TABLE survey_steps ADD COLUMN IF NOT EXISTS branch_sim_step INT;
ALTER TABLE survey_steps ADD COLUMN IF NOT EXISTS branch_nao_step INT;

COMMENT ON COLUMN survey_steps.branch_sim_step IS 'Step_number destino quando resposta = Sim';
COMMENT ON COLUMN survey_steps.branch_nao_step IS 'Step_number destino quando resposta = Nao';
