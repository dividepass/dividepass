-- Adicionar colunas de ramificação para Sim/Não
ALTER TABLE survey_steps ADD COLUMN IF NOT EXISTS branch_sim UUID;
ALTER TABLE survey_steps ADD COLUMN IF NOT EXISTS branch_nao UUID;

-- Comentarios
COMMENT ON COLUMN survey_steps.branch_sim IS 'ID do step destino quando resposta = Sim (true)';
COMMENT ON COLUMN survey_steps.branch_nao IS 'ID do step destino quando resposta = Nao (false)';
