-- ============================================================
-- MIGRATION: Filtros dinâmicos de extração de código por grupo
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Novas colunas para configuração dinâmica de extração de código por e-mail
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_code_patterns TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_body_keywords TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_subject_includes TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_ai_enabled BOOLEAN DEFAULT FALSE;

-- Comentários nas colunas
COMMENT ON COLUMN groups.email_code_patterns IS 'Regex customizados para extração de código neste grupo. Ex: {"code[:\\s]*(\\d{6})", "pin[:\\s]*(\\d{4})"}';
COMMENT ON COLUMN groups.email_body_keywords IS 'Palavras-chave que indicam email de verificação. Ex: {"verificação", "verification", "access code"}';
COMMENT ON COLUMN groups.email_subject_includes IS 'Termos que o assunto deve conter para ser processado. Se vazio, todos os emails são aceitos.';
COMMENT ON COLUMN groups.email_ai_enabled IS 'Habilitar IA (Groq) para extração quando regex falhar';
