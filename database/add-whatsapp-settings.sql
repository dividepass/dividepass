-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Configuração do canal WhatsApp (roda UMA VEZ no SQL Editor)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O canal WhatsApp dos avisos usa a Cloud API da Meta
-- (graph.facebook.com). Para ligar, são duas coisas:
--
--   1. O Phone Number ID (número do WhatsApp Business) nesta tabela:
--        UPDATE app_settings
--           SET value = 'SEU_PHONE_NUMBER_ID'
--         WHERE key = 'whatsapp_phone_number_id';
--
--   2. O token permanente da Meta como SECRET da edge function
--      `send-notification`:
--        supabase secrets set WHATSAPP_ACCESS_TOKEN='SEU_TOKEN'
--
-- Sem essas duas peças, o canal WhatsApp aparece no admin mas reporta
-- "não configurado" no resumo do envio — não falha calada.
--
-- ATENÇÃO (regra da Meta): texto livre só é entregue dentro da janela de
-- 24h depois que a pessoa falar com a empresa. Para disparo em massa é
-- preciso um TEMPLATE aprovado pela Meta.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

INSERT INTO app_settings (key, value) VALUES
  ('whatsapp_phone_number_id', ''),
  ('whatsapp_api_version', 'v21.0')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificação
-- ───────────────────────────────────────────────────────────────────────────

SELECT key, value FROM app_settings WHERE key LIKE 'whatsapp%';
