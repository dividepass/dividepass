-- =============================================================================
-- DividePass — Gateway Woovi (Pix Automático)
-- =============================================================================
--
-- COMO RODAR
-- ----------
-- 1. Abra o SQL Editor do seu projeto Supabase.
-- 2. Cole o arquivo INTEIRO abaixo e clique em "Run".
-- 3. É IDEMPOTENTE: pode rodar quantas vezes quiser, sem erro.
--
-- O QUE ESPERAR DE VOLTA
-- ----------------------
-- Uma sequência de "ALTER TABLE ... ADD COLUMN IF NOT EXISTS" e "CREATE INDEX
-- IF NOT EXISTS". Sem erro. Se as colunas já existirem, o Postgres avisa
-- "column ... already exists, skipping" e segue — isso é o esperado.
--
-- CONFIRA DEPOIS (opcional):
--
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_schema = 'public'
--      AND column_name LIKE '%woovi%'
--    ORDER BY table_name, column_name;
--
-- Deve listar:
--   users                | customer_id_woovi
--   user_subscriptions   | woovi_recurrence_status
--   user_subscriptions   | woovi_recurrency_id
--   user_subscriptions   | woovi_subscription_id
--
-- POR QUE CADA COLUNA
-- -------------------
-- users.customer_id_woovi
--   Id do cliente na Woovi. Criado na primeira compra e reaproveitado em
--   todas as seguintes (a Woovi trata o mesmo CPF como o mesmo cliente).
--
-- user_subscriptions.woovi_subscription_id
--   O `globalID` do mandate de Pix Automático. É o ponteiro que permite
--   reencontrar a assinatura nos webhooks das renovações — por isso ele é
--   uma coluna separada do `gateway_subscription_id` (que o `confirmPayment`
--   sobrescreve com o id de cada pagamento).
--
-- user_subscriptions.woovi_recurrency_id
--   O `recurrencyId` do mandato (o identificador do Pix Automático).
--
-- user_subscriptions.woovi_recurrence_status
--   CREATED | APPROVED | REJECTED — o estado da autorização do pagador.
--
-- SOBRE PERMISSÕES
-- -----------------
-- Esta migration NÃO mexe em GRANT/REVOKE, e é proposital:
--
--   - O `fix-p0-security.sql` já fez `REVOKE SELECT ON TABLE public.users`
--     e concede acesso coluna a coluna. Uma coluna NOVA não entra na lista,
--     então `customer_id_woovi` nasce inacessível ao `authenticated` (só o
--     service_role lê), igual aos outros `customer_id_*`.
--   - O `fix-user-privilege-escalation.sql` já fez `REVOKE UPDATE ON
--     public.users`, então o cliente logado não consegue alterar o
--     `customer_id_woovi` de ninguém.
--
-- Se você quiser conferir depois de rodar:
--
--   SELECT column_name FROM information_schema.column_privileges
--    WHERE table_schema = 'public' AND table_name = 'users'
--      AND column_name = 'customer_id_woovi'
--      AND grantee IN ('anon','authenticated');
--
-- O esperado é ZERO linhas.
--
-- ESTA MIGRATION NÃO ATIVA NADA
-- ------------------------------
-- A integração fica em STANDBY. O gateway ativo continua sendo o valor de
-- `app_settings.active_gateway` (hoje: iopay). Para ativar a Woovi:
--   1. Admin → Configurações → preencha o AppID da Woovi;
--   2. Admin → Configurações → troque o gateway ativo para "Woovi";
--   3. Cadastre o webhook na Woovi (veja docs/woovi-pix-automatico.md).
-- =============================================================================

BEGIN;

-- 1. Cliente na Woovi
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS customer_id_woovi TEXT;

CREATE INDEX IF NOT EXISTS idx_users_customer_id_woovi
  ON public.users(customer_id_woovi);

-- 2. Mandato de Pix Automático na assinatura
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS woovi_subscription_id TEXT;

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS woovi_recurrency_id TEXT;

ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS woovi_recurrence_status TEXT;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_woovi_sub
  ON public.user_subscriptions(woovi_subscription_id);

-- 3. Interruptor de ambiente (produção x sandbox).
--
-- Um único interruptor decide para onde a operação acontece. O código é o
-- mesmo nos dois casos; o que muda é o destino das chamadas ao gateway.
--
--   'production' → https://api.woovi.com
--   'sandbox'    → https://api.woovi-sandbox.com
--
-- A variável de ambiente AMBIENTE tem precedência sobre esta linha — é
-- assim que a instância de staging na VPS se declara sandbox sem mexer no
-- painel.
--
-- ATENÇÃO: ligar o sandbox NÃO muda o banco. Ele só muda para onde as
-- cobranças são enviadas. Para ter as duas pontas de verdade (uma de teste,
-- uma real), cada uma precisa do seu próprio banco.
INSERT INTO public.app_settings (key, value) VALUES
  ('ambiente', 'production')
ON CONFLICT (key) DO NOTHING;

-- 4. Remove a chave antiga de ambiente por gateway.
--
-- O `woovi_env` foi substituído pelo interruptor global `ambiente`. A chave
-- nunca chegou a ser gravada (a tela do Admin com esse campo não foi
-- publicada), mas a limpeza deixa o banco sem configuração sobrando.
DELETE FROM public.app_settings WHERE key = 'woovi_env';

-- 5. Endereço padrão do pagador.
--
-- O Pix Automático EXIGE endereço do cliente. O app ainda não coleta
-- endereço do usuário, então usamos um padrão configurável — exatamente o
-- que o handler da IO Pay já faz (`iopay_default_address_city/state`).
-- Editável em Admin → Configurações.
INSERT INTO public.app_settings (key, value) VALUES
  ('woovi_default_address_zipcode',     '01310-100'),
  ('woovi_default_address_street',       'Av. Paulista'),
  ('woovi_default_address_number',       '1000'),
  ('woovi_default_address_neighborhood', 'Bela Vista'),
  ('woovi_default_address_city',         'Sao Paulo'),
  ('woovi_default_address_state',        'SP'),
  ('woovi_default_address_country',      'BR')
ON CONFLICT (key) DO NOTHING;

COMMIT;
