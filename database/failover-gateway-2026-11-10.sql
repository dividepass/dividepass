-- ============================================================================
-- FAILOVER DE GATEWAY (10/11/2026)
-- ============================================================================
--
-- POR QUE ISTO
-- -------------
-- A cobrança de PIX parou em 09/11/2026 porque o `create-payment` publicado
-- tinha um SyntaxError (503 BOOT_ERROR). Corrigido, mas o problema de fundo
-- continua: se UM gateway falhar por motivo técnico (fora do ar, 5xx, erro
-- de rede), o cliente fica sem ser cobrado.
--
-- Com estas duas chaves, a edge `create-payment` tenta o PRÓXIMO gateway da
-- lista quando o principal falha tecnicamente — nunca parando de cobrar.
--
-- A REGRA QUE IMPORTA: só troca quando NADA foi cobrado. Recusa do cliente
-- (cartão recusado) ou pedido inválido NÃO trocam de gateway — vão direto
-- para o usuário. E RENOVAÇÃO não troca (a assinatura já tem cobrança viva
-- no gateway dela).
--
-- O QUE MUDOU AQUI
-- ---------------
--   gateway_failover_pix  = 'iopay'        (PIX:     Woovi  -> IO Pay)
--   gateway_failover_card = 'mercadopago'  (cartão:  IO Pay -> Mercado Pago)
--
-- ESCOLHA DOS FALLBACKS
-- ---------------------
-- IO Pay e Mercado Pago são os dois gateways com credencial de PRODUÇÃO
-- validada (checagem de leitura na API: /users/me do Mercado Pago e
-- /v1/account da Stripe voltaram 200). O Pagar.me foi descartado: a
-- credencial responde 401.
--
-- WOOVI -> IO PAY no PIX: o IO Pay devolve PIX com copia-e-cola e QR, e o
-- front já sabe mostrar e acompanhar esse formato.
--
-- IO PAY -> MERCADO PAGO no cartão: o handler do Mercado Pago devolve
-- `init_point`, que é exatamente o que o front abre quando o gateway
-- principal não devolve um PIX.
--
-- COMO DESLIGAR (se algum dia der problema no fallback)
-- ----------------------------------------------------
--   update app_settings set value = '' where key = 'gateway_failover_pix';
--
-- VAZIO = FAILOVER DESLIGADO. É o padrão seguro.
-- ============================================================================

insert into app_settings (key, value, updated_at)
values
  ('gateway_failover_pix',  'iopay',       now()),
  ('gateway_failover_card', 'mercadopago', now())
on conflict (key) do update
  set value = excluded.value,
      updated_at = excluded.updated_at;

-- Confere o que ficou gravado.
select key, value, updated_at
from app_settings
where key in ('gateway_failover_pix', 'gateway_failover_card');
