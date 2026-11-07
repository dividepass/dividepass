-- ============================================================================
-- Asserts de comportamento do arquivo
--   database/EXECUTAR-2026-11-01-link-grupo-whatsapp.sql
--
-- Roda DEPOIS do schema de teste e do arquivo principal:
--   psql -U postgres -d postgres -f scripts/test-link-grupo-whatsapp-schema.sql
--   psql -U postgres -d postgres -f database/EXECUTAR-2026-11-01-link-grupo-whatsapp.sql
--   psql -U postgres -d postgres -f scripts/test-link-grupo-whatsapp-asserts.sql
--
-- Imprime PASS/FAIL. Sai com codigo != 0 se houver falha.
-- ============================================================================

DO $$
DECLARE
  v_link        text;
  v_visible     text[];
  v_senhas      text[];
  v_logados     text[];
  v_total       int;
BEGIN
  -- 1) A configuração existe com o link do convite
  SELECT value INTO v_link FROM public.app_settings WHERE key = 'whatsapp_vip_url';
  IF v_link IS NULL OR v_link NOT LIKE 'https://chat.whatsapp.com/%' THEN
    RAISE EXCEPTION 'FAIL: chave whatsapp_vip_url ausente ou com link invalido (%)', coalesce(v_link, 'NULL');
  END IF;
  RAISE NOTICE 'PASS: configuração whatsapp_vip_url = %', v_link;

  -- 2) O visitante (anon) lê a chave do grupo
  SET LOCAL ROLE anon;
  SELECT array_agg(key) INTO v_visible FROM public.app_settings;
  RESET ROLE;

  IF 'whatsapp_vip_url' = ANY (coalesce(v_visible, ARRAY[]::text[])) THEN
    RAISE NOTICE 'PASS: anon lê whatsapp_vip_url';
  ELSE
    RAISE EXCEPTION 'FAIL: anon nao consegue ler whatsapp_vip_url (leu: %)', coalesce(array_to_string(v_visible, ','), 'nada');
  END IF;

  -- 3) O visitante NÃO lê nenhuma configuração sensível
  SET LOCAL ROLE anon;
  SELECT array_agg(key) INTO v_senhas
    FROM public.app_settings
   WHERE key IN ('smtp_host', 'smtp_pass', 'gateway_fee_percent');
  RESET ROLE;

  IF coalesce(array_length(v_senhas, 1), 0) = 0 THEN
    RAISE NOTICE 'PASS: anon nao le nenhuma configuracao sensivel';
  ELSE
    RAISE EXCEPTION 'FAIL: anon leu configuracao sensivel: %', array_to_string(v_senhas, ',');
  END IF;

  -- 4) O visitante enxerga SOMENTE a chave do grupo
  SET LOCAL ROLE anon;
  SELECT count(*) INTO v_total FROM public.app_settings;
  RESET ROLE;

  IF v_total = 1 THEN
    RAISE NOTICE 'PASS: anon enxerga exatamente 1 linha em app_settings';
  ELSE
    RAISE EXCEPTION 'FAIL: anon enxerga % linhas em app_settings (esperado 1)', v_total;
  END IF;

  -- 5) Usuário logado lê a chave do grupo
  SET LOCAL ROLE authenticated;
  SELECT array_agg(key) INTO v_logados
    FROM public.app_settings
   WHERE key = 'whatsapp_vip_url';
  RESET ROLE;

  IF 'whatsapp_vip_url' = ANY (coalesce(v_logados, ARRAY[]::text[])) THEN
    RAISE NOTICE 'PASS: usuario logado lê whatsapp_vip_url';
  ELSE
    RAISE EXCEPTION 'FAIL: usuario logado nao lê whatsapp_vip_url';
  END IF;

  RAISE NOTICE 'RESULTADO: todos os asserts passaram.';
END
$$;
