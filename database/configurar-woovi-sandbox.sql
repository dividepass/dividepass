-- =============================================================================
-- DividePass — Credenciais do gateway Woovi (AppID + ambiente)
-- =============================================================================
--
-- COMO RODAR
-- ----------
-- 1. Abra o SQL Editor do seu projeto Supabase.
-- 2. Cole o arquivo INTEIRO abaixo e rode. É idempotente.
--
-- POR QUE O AppID NÃO ESTÁ NESSE ARQUIVO
-- ---------------------------------------
-- O AppID da Woovi dá acesso total à API da conta (criar e ler cobrança,
-- emitir Pix, gerenciar a empresa). A documentação da Woovi é explícita:
-- "Não compartilhe chaves com terceiros". Colar ele aqui colocaria a
-- credencial no histórico do git, para sempre.
--
-- Por isso este arquivo só PREPARA o campo, e o AppID é colado em:
--
--     Admin -> Configurações -> Woovi -> AppID
--
-- O campo é mascarado (tipo password) e o valor fica no app_settings, que
-- só o service_role lê. É exatamente para isso que o Admin existe: trocar
-- credencial sem mexer em código.
--
-- Se preferir fazer por script (sem abrir o Admin), o comando é:
--
--     curl -X PATCH "$VITE_SUPABASE_URL/rest/v1/app_settings?key=eq.woovi_app_id" \
--          -H "apikey: $SERVICE_ROLE" \
--          -H "Authorization: Bearer $SERVICE_ROLE" \
--          -H "Content-Type: application/json" \
--          -d '{"key":"woovi_app_id","value":"SEU_APPID_AQUI"}'
--
-- TROCAR DE AMBIENTE (sandbox <-> producao)
-- -----------------------------------------
-- É UM interruptor só: `ambiente`. A chave `woovi_env` (por gateway) foi
-- removida de propósito.
--
--     'production' -> https://api.woovi.com
--     'sandbox'    -> https://api.woovi-sandbox.com
--
-- Trocar de ambiente implica trocar o AppID (o de sandbox é outro AppID).
-- A variável de ambiente AMBIENTE tem precedência sobre esta linha — é
-- assim que a instancia de staging na VPS se declara sandbox.
-- =============================================================================

BEGIN;

-- 1. Interruptor de operação: sandbox durante os testes.
--
-- ATENÇÃO: ligar o sandbox NÃO muda o banco. Ele só muda para onde as
-- cobranças são enviadas. Para ter as duas pontas de verdade (uma de teste,
-- uma real), cada uma precisa do seu próprio banco.
INSERT INTO public.app_settings (key, value) VALUES
  ('ambiente', 'sandbox')
ON CONFLICT (key) DO NOTHING;

-- 2. Prepara o campo do AppID (o valor sai colado no Admin).
--
-- Se já existir um AppID gravado, esta linha NÃO o sobrescreve — o
-- preenchimento é feito pelo Admin.
INSERT INTO public.app_settings (key, value) VALUES
  ('woovi_app_id', '')
ON CONFLICT (key) DO NOTHING;

-- 3. Ajustes de comportamento do Pix Automático.
INSERT INTO public.app_settings (key, value) VALUES
  ('woovi_retry_policy', 'THREE_RETRIES_7_DAYS'),
  ('woovi_day_due', '3')
ON CONFLICT (key) DO NOTHING;

COMMIT;

-- =============================================================================
-- CONFERIR
-- =============================================================================
--   SELECT key, value FROM app_settings
--    WHERE key LIKE 'woovi%' OR key = 'ambiente' ORDER BY key;
--
-- 'ambiente' deve vir 'sandbox' e 'woovi_app_id' preenchido (o AppID).
-- =============================================================================
