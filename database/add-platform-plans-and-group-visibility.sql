-- =============================================================================
-- PLANOS DA PLATAFORMA + VISIBILIDADE DO GRUPO
-- =============================================================================
-- DividePass (lasoouwboxspstqvjbsv)
--
-- ESTADO: JÁ APLICADO em produção (01/11/2026) — conferido por REST
-- (colunas `service_plans.max_members/min_price/max_price/suggested_price/
-- max_screens/quality/sort_order` e `groups.visibility/plan_id/chat_enabled/
-- subscription_status` respondendo). ESTE ARQUIVO É IDEMPOTENTE: pode colar e
-- rodar de novo no SQL Editor sem quebrar nada (todo `ADD COLUMN`,
-- `CREATE INDEX` e `CREATE POLICY` é "IF NOT EXISTS" / "DROP IF EXISTS").
--
-- 1) `service_plans` (planos padrao de cada plataforma) ganha os campos que
--    faltavam para o dono do grupo escolher UM plano da plataforma e ter teto
--    de preco (minimo e maximo) — assim ninguem cria grupo com preco
--    desproporcional.
--
-- 2) `service_plans` ganha RLS de leitura publica (hoje a tabela tem RLS
--    ligado SEM nenhuma policy: nem o admin consegue gravar, e o front nao
--    consegue ler os planos da plataforma no wizard de criacao de grupo).
--
-- 3) `groups` ganha `visibility` (publico/privado). Grupo privado nao aparece
--    no catalogo: so entra por convite ou pelo link do grupo.
--
-- 4) `groups` ganha `chat_enabled` — o dono decide se o grupo tem chat
--    (troca de mensagens entre os membros) ou nao.
--
-- 5) `groups` ganha `subscription_status` — o dono declara se JÁ assinou a
--    conta do serviço ('active') ou se vai assinar quando o grupo fechar
--    ('pending'). Com 'pending' o grupo nasce em formacao (status 'forming').
--
-- COMO APLICAR: SQL Editor do Supabase -> colar o arquivo inteiro -> Run.
-- O QUE ESPERAR: nenhuma mensagem de erro. No fim, a secao VERIFICACAO lista
-- os planos cadastrados e os grupos publicos x privados.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1) CAMPOS NOVOS DOS PLANOS DA PLATAFORMA
-- -----------------------------------------------------------------------------
-- `official_price` continua sendo o VALOR COBRADO PELA PLATAFORMA (o preco
-- oficial do plano). Os campos novos sao os limites de PRECO DO GRUPO e os
-- detalhes que aparecem no card do plano.

ALTER TABLE public.service_plans
  ADD COLUMN IF NOT EXISTS max_members      INTEGER,          -- quantidade maxima de membros
  ADD COLUMN IF NOT EXISTS suggested_price  DECIMAL(10,2),    -- valor sugerido (pre-enchido no wizard)
  ADD COLUMN IF NOT EXISTS min_price        DECIMAL(10,2),    -- valor minimo sugerido (teto inferior)
  ADD COLUMN IF NOT EXISTS max_price        DECIMAL(10,2),    -- valor maximo (teto superior)
  ADD COLUMN IF NOT EXISTS max_screens      INTEGER,          -- telas simultaneas
  ADD COLUMN IF NOT EXISTS quality          VARCHAR(120),     -- "Full HD (1080p)", "Ultra HD (4K) + HDR"
  ADD COLUMN IF NOT EXISTS details          TEXT,             -- observacoes do plano (ads, assinante extra...)
  ADD COLUMN IF NOT EXISTS is_default       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS sort_order       INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.service_plans.official_price   IS 'Valor cobrado pela plataforma pelo plano.';
COMMENT ON COLUMN public.service_plans.max_members      IS 'Quantidade maxima de membros que o grupo deste plano aceita.';
COMMENT ON COLUMN public.service_plans.suggested_price  IS 'Valor sugerido para o grupo que usa este plano.';
COMMENT ON COLUMN public.service_plans.min_price        IS 'Valor minimo aceito para o grupo que usa este plano.';
COMMENT ON COLUMN public.service_plans.max_price        IS 'Valor maximo aceito para o grupo que usa este plano.';
COMMENT ON COLUMN public.service_plans.max_screens      IS 'Telas simultaneas do plano.';
COMMENT ON COLUMN public.service_plans.quality          IS 'Qualidade do video (ex.: Full HD (1080p)).';
COMMENT ON COLUMN public.service_plans.details          IS 'Observacoes exibidas no card do plano.';

-- Nenhum preco pode ser negativo e o minimo nunca pode ser maior que o maximo.
-- (NULL = nao definido; a constraint so compara quando os dois existem.)
ALTER TABLE public.service_plans
  DROP CONSTRAINT IF EXISTS chk_service_plans_prices_positive;
ALTER TABLE public.service_plans
  ADD CONSTRAINT chk_service_plans_prices_positive
  CHECK (
    COALESCE(max_members, 0) >= 0
    AND COALESCE(max_screens, 0) >= 0
    AND COALESCE(suggested_price, 0) >= 0
    AND COALESCE(min_price, 0) >= 0
    AND COALESCE(max_price, 0) >= 0
  );

ALTER TABLE public.service_plans
  DROP CONSTRAINT IF EXISTS chk_service_plans_price_range;
ALTER TABLE public.service_plans
  ADD CONSTRAINT chk_service_plans_price_range
  CHECK (
    min_price IS NULL OR max_price IS NULL OR min_price <= max_price
  );

-- Indice para a listagem "planos da plataforma" (filtra por servico + ativo).
CREATE INDEX IF NOT EXISTS idx_service_plans_service_active
  ON public.service_plans (service_id, is_active, sort_order, official_price);


-- -----------------------------------------------------------------------------
-- 2) RLS DOS PLANOS — leitura publica, escrita so admin
-- -----------------------------------------------------------------------------
-- Sem isto o wizard de criacao de grupo nao consegue LER os planos da
-- plataforma (RLS ligado sem policy = zero linhas para todo mundo) e o painel
-- admin nao consegue GRAVAR (erro 42501).

ALTER TABLE public.service_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Planos das plataformas sao publicos" ON public.service_plans;
CREATE POLICY "Planos das plataformas sao publicos"
  ON public.service_plans
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins gerenciam planos" ON public.service_plans;
CREATE POLICY "Admins gerenciam planos"
  ON public.service_plans
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());


-- -----------------------------------------------------------------------------
-- 3) VISIBILIDADE DO GRUPO (publico / privado)
-- -----------------------------------------------------------------------------
-- 'public'  = qualquer pessoa pode encontrar e entrar pagando no grupo.
-- 'private' = o grupo nao aparece no catalogo; entra por convite ou pelo link.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS visibility VARCHAR(20) NOT NULL DEFAULT 'public';

ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS chk_groups_visibility;
ALTER TABLE public.groups
  ADD CONSTRAINT chk_groups_visibility
  CHECK (visibility IN ('public', 'private'));

COMMENT ON COLUMN public.groups.visibility IS
  'public = grupo visivel no catalogo; private = so entra por convite ou link.';

CREATE INDEX IF NOT EXISTS idx_groups_visibility
  ON public.groups (visibility)
  WHERE visibility = 'public';

-- Grupo antigo (antes da coluna) e publico por padrao.
UPDATE public.groups SET visibility = 'public' WHERE visibility IS NULL;

-- O grupo pode apontar para o plano da plataforma que ele usa.
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES public.service_plans(id) ON DELETE SET NULL;


-- -----------------------------------------------------------------------------
-- 4) CHAT DO GRUPO
-- -----------------------------------------------------------------------------
-- O dono liga/desliga a troca de mensagens entre os membros. Grupo antigo
-- (antes da coluna) continua com o chat ligado.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS chat_enabled BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.groups.chat_enabled IS
  'true = membros podem trocar mensagens no chat do grupo; false = sem chat.';


-- -----------------------------------------------------------------------------
-- 5) STATUS DA ASSINATURA DO SERVICIO COMPARTILHADO
-- -----------------------------------------------------------------------------
-- 'active'  = o dono JA assinou a conta do serviço (ela esta pronta para uso).
-- 'pending' = o dono vai assinar quando o grupo fechar (as vagas encherem).
--             Nesse caso o grupo nasce em formacao (status 'forming') e so
--             vira 'open' quando o dono confirma que assinou.

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(20) NOT NULL DEFAULT 'active';

ALTER TABLE public.groups
  DROP CONSTRAINT IF EXISTS chk_groups_subscription_status;
ALTER TABLE public.groups
  ADD CONSTRAINT chk_groups_subscription_status
  CHECK (subscription_status IN ('active', 'pending'));

COMMENT ON COLUMN public.groups.subscription_status IS
  'active = conta do servico ja assinatura; pending = assinara quando o grupo fechar.';

-- Grupo antigo (antes da coluna) e tratado como conta ja assinada.
UPDATE public.groups SET subscription_status = 'active' WHERE subscription_status IS NULL;


-- =============================================================================
-- VERIFICACAO
-- =============================================================================
-- Planos cadastrados:
--   SELECT s.name AS plataforma, p.name AS plano, p.official_price, p.min_price,
--          p.max_price, p.suggested_price, p.max_members, p.max_screens, p.quality
--   FROM service_plans p
--   JOIN streaming_services s ON s.id = p.service_id
--   WHERE p.is_active = TRUE
--   ORDER BY s.name, p.sort_order, p.official_price;
--
-- Grupos publicos x privados:
--   SELECT visibility, COUNT(*) FROM groups GROUP BY visibility;
--
-- Chat e status da assinatura:
--   SELECT chat_enabled, subscription_status, status, COUNT(*)
--   FROM groups GROUP BY 1, 2, 3;
