-- ============================================================
-- MIGRATION: Configuração de busca de códigos por e-mail
-- Execute no SQL Editor do Supabase
-- ============================================================

-- Adicionar colunas de configuração de e-mail na tabela groups
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_code_enabled BOOLEAN DEFAULT FALSE;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_address VARCHAR(255);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_imap_server VARCHAR(255);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_imap_port INTEGER DEFAULT 993;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_imap_user VARCHAR(255);
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_imap_password TEXT;
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_allowed_senders TEXT[] DEFAULT '{}';
ALTER TABLE groups ADD COLUMN IF NOT EXISTS email_blocked_subjects TEXT[] DEFAULT '{}';

-- A tabela verification_pins já existe no schema (schema.sql linha 257-265)
-- Ela será usada para armazenar os códigos extraídos dos e-mails
