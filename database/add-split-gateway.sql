-- ============================================================================
-- EXECUTAR NO SQL EDITOR DO SUPABASE — projeto lasoouwboxspstqvjbsv
-- ============================================================================
-- Data: 04/11/2026
-- Motivo: permitir COBRAR O MESMO CHECKOUT EM DOIS GATEWAYS DIFERENTES —
-- por exemplo, o PIX na Woovi (Pix Automático) e o cartão de crédito na
-- IO Pay. Hoje o `active_gateway` vale para o PIX e para o cartão, então
-- não dá para ter os dois em gateways diferentes ao mesmo tempo.
--
-- O QUE ESTE ARQUIVO FAZ (tudo idempotente)
-- -----------------------------------------
--   1. Cria as 4 chaves da divisão, já com o padrão DESLIGADO:
--        split_gateway_enabled → 'false'
--        split_gateway_pix     → 'iopay'
--        split_gateway_card    → 'iopay'
--        split_gateway_scope   → 'v2'  (só no checkout de teste)
--
--      O ESCOPO é o que garante que o checkout de produção (que já
--      funciona) não muda de comportamento: por padrão a divisão vale
--      apenas no checkout V2 (/v2/checkout). Só quando o admin escolher
--      "Em todos os checkouts" é que ela passa a valer no de produção.
--
--   2. Libera a LEITURA dessas 3 chaves para o usuário logado (role
--      `authenticated`), porque o checkout precisa saber qual gateway
--      atende cada método ANTES de criar a cobrança (para mostrar o
--      formulário de cartão ou o QR do Pix).
--
--      A policy pública atual só libera 3 chaves. Sem incluir estas aqui,
--      o frontend não enxergaria a configuração e o checkout cairia no
--      gateway padrão (ou seja: a divisão nunca apareceria).
--
--   3. NÃO mexe na policy do `anon` (visitante sem login): ela continua
--      restrita ao link do grupo VIP. Nenhum segredo é exposto.
--
-- ATENÇÃO — ESTE ARQUIVO NÃO ATIVA NADA
-- -------------------------------------
-- Com `split_gateway_enabled = 'false'` (o padrão), o site se comporta
-- EXATAMENTE como hoje: um gateway só, o `active_gateway`. A divisão é
-- ligada no painel Admin → Configurações → "Gateway por método de
-- pagamento", no momento em que você quiser.
--
-- COMO USAR DEPOIS
-- -----------------
--   Painel admin (dividepass.com/admin/settings) → "Gateway por método de
--   pagamento" → ligue o interruptor e escolha o gateway do PIX e do
--   cartão → "Salvar Configurações".
--
-- COMO EXECUTAR
-- -------------
--   Dashboard → SQL Editor → New query → cole o arquivo INTEIRO → Run.
--   Se aparecer "Potential issue detected — destructive operations", clique
--   em "Run query".
--
-- PODE RODAR DE NOVO: nada é duplicado. A recriação da policy é feita com
-- a lista COMPLETA de chaves, então rodar de novo não perde nenhuma.
-- ============================================================================


-- ───────────────────────────────────────────────────────────────────────────
-- 1. As chaves da divisão (padrão: desligada)
-- ───────────────────────────────────────────────────────────────────────────
-- `ON CONFLICT DO NOTHING`: se o admin já configurou a divisão pelo painel,
-- rodar este arquivo NÃO sobrescreve a escolha dele.
INSERT INTO public.app_settings (key, value)
VALUES
  ('split_gateway_enabled', 'false'),
  ('split_gateway_pix', 'iopay'),
  ('split_gateway_card', 'iopay'),
  ('split_gateway_scope', 'v2')
ON CONFLICT (key) DO NOTHING;


-- ───────────────────────────────────────────────────────────────────────────
-- 2. O usuário logado passa a ler a configuração da divisão
-- ───────────────────────────────────────────────────────────────────────────
-- A policy é recriada com a lista COMPLETA (as 3 chaves de antes + as 3
-- novas). As chaves de ANTES continuam liberadas — `active_gateway` é o que
-- o checkout já lia, e `default_entrance_fee` e `whatsapp_vip_url` também.
--
-- Nenhum segredo entra aqui: o nome de um gateway não é credencial. As
-- credenciais (AppID, senhas) continuam só para o admin.
DROP POLICY IF EXISTS "Usuarios leem settings publicas" ON public.app_settings;
CREATE POLICY "Usuarios leem settings publicas"
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (key IN (
    'active_gateway',
    'default_entrance_fee',
    'whatsapp_vip_url',
    'split_gateway_enabled',
    'split_gateway_pix',
    'split_gateway_card',
    'split_gateway_scope'
  ));


-- ───────────────────────────────────────────────────────────────────────────
-- Verificação
-- ───────────────────────────────────────────────────────────────────────────
-- Deve mostrar 3 linhas, com a divisão desligada:
SELECT key, value
FROM public.app_settings
WHERE key LIKE 'split_gateway%'
ORDER BY key;

-- O gateway ativo NÃO pode ter mudado (continua iopay):
SELECT key, value FROM public.app_settings WHERE key = 'active_gateway';

-- O que o usuário logado enxerga (deve incluir as 6 chaves públicas):
-- SET ROLE authenticated;
-- SELECT key FROM public.app_settings
-- WHERE key IN ('active_gateway','default_entrance_fee','whatsapp_vip_url',
--                'split_gateway_enabled','split_gateway_pix','split_gateway_card')
-- ORDER BY key;
-- RESET ROLE;
--
-- O que o visitante (anon) enxerga: só o link do grupo VIP.
-- Se aparecer qualquer outra chave, o RLS está aberto demais.
-- SET ROLE anon;
-- SELECT key FROM public.app_settings;
-- RESET ROLE;
