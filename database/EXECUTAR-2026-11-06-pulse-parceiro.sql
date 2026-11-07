-- ============================================================================
-- PULSE CODING — CATÁLOGO "VIA PARCEIRO"
-- ============================================================================
--
-- Data: 06/11/2026
-- Objetivo: criar a estrutura da revenda via Pulse Coding (importação de
--            catálogo, mapeamento de grupos, pedidos e auditoria).
--
-- COMO APLICAR
-- ------------
--   1. Abra o SQL Editor do Supabase (produção: lasoouwboxspstqvjbsv).
--   2. Cole ESTE BLOCO INTEIRO e execute.
--   3. O arquivo é idempotente: rodar de novo não quebra nada e não duplica
--      tabela nem índice.
--
-- O QUE ESPERAR DE VOLTA
-- ----------------------
--   - 4 tabelas novas: pulse_pacotes, pulse_mapeamentos, pulse_pedidos,
--     pulse_eventos;
--   - 1 view: pulse_painel (listagem do admin);
--   - RLS ligado nas 4 tabelas com leitura restrita ao service_role
--     (nenhuma policy para anon/authenticated = acesso bloqueado direto);
--   - ao final, um SELECT de conferência com as 4 tabelas.
--
-- MODELO
-- ------
--   - 1 pacote da Pulse  ->  1 grupo do DividePass (tag "Via Parceiro")
--   - 1 compra do cliente -> 1 linha em pulse_pedidos (external_id único)
--   - 1 entrega da Pulse  -> 1 linha em group_credentials com assigned_to
--                             = o comprador (contas são privadas: 1 por cliente)
--
-- NADA É FIXO NO CÓDIGO: o package_id da Pulse fica no banco e é re-sincronizado
-- a partir de list_packages. Se a Pulse trocar o id de um pacote, o sync
-- detecta e o admin remapeia.
-- ============================================================================

-- ============================================================================
-- 1. TABELA: pulse_pacotes (espelho do catálogo da Pulse)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pulse_pacotes (
    package_id         TEXT PRIMARY KEY,               -- id da Pulse (muda quando o catálogo muda)
    title              TEXT NOT NULL,
    category           TEXT,
    description        TEXT,
    features           JSONB NOT NULL DEFAULT '[]'::jsonb,
    original_price     DECIMAL(10,2),                  -- preço de venda ao consumidor final
    price              DECIMAL(10,2),                  -- CUSTO de revenda (o que eu pago)
    markup             DECIMAL(5,2) NOT NULL DEFAULT 20,-- % aplicado sobre o original_price
    sale_price         DECIMAL(10,2),                  -- preço cobrado no DividePass
    stock              INTEGER NOT NULL DEFAULT 0,
    availability       VARCHAR(20),                    -- automatic | manual | unavailable
    delivery           VARCHAR(20),                    -- automatica | manual
    orderable_via_api  BOOLEAN NOT NULL DEFAULT FALSE,
    duration_days      INTEGER,                        -- duração do produto (derivada do título)
    billing_cycle      VARCHAR(20),                    -- ciclo do grupo: monthly | quarterly | annual | days
    service_id         UUID REFERENCES public.streaming_services(id) ON DELETE SET NULL,
    plan_id            UUID REFERENCES public.service_plans(id) ON DELETE SET NULL,
    group_id           UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    status             VARCHAR(20) NOT NULL DEFAULT 'importado',
                        -- importado | indisponivel | ignorado | erro
    visible            BOOLEAN NOT NULL DEFAULT FALSE, -- aparece na vitrine do cliente
    ignorado           BOOLEAN NOT NULL DEFAULT FALSE, -- fora do import automático de propósito
    motivo_ignorado    TEXT,
    raw                JSONB NOT NULL DEFAULT '{}'::jsonb,
    last_synced_at     TIMESTAMPTZ DEFAULT NOW(),
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pulse_pacotes IS
  'Espelho do catálogo da Pulse Coding (list_packages). O package_id NUNCA fica fixo no código: é re-sincronizado.';
COMMENT ON COLUMN public.pulse_pacotes.price IS
  'Custo de revenda: o que a Pulse cobra de mim.';
COMMENT ON COLUMN public.pulse_pacotes.original_price IS
  'Preço de venda ao consumidor final na Pulse.';
COMMENT ON COLUMN public.pulse_pacotes.sale_price IS
  'Preço cobrado ao cliente no DividePass (original_price + markup).';

CREATE INDEX IF NOT EXISTS idx_pulse_pacotes_status ON public.pulse_pacotes (status);
CREATE INDEX IF NOT EXISTS idx_pulse_pacotes_category ON public.pulse_pacotes (category);
CREATE INDEX IF NOT EXISTS idx_pulse_pacotes_group ON public.pulse_pacotes (group_id);

-- ============================================================================
-- 2. TABELA: pulse_mapeamentos (grupo do DividePass <-> pacote da Pulse)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pulse_mapeamentos (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id       UUID NOT NULL UNIQUE REFERENCES public.groups(id) ON DELETE CASCADE,
    package_id     TEXT NOT NULL REFERENCES public.pulse_pacotes(package_id) ON DELETE CASCADE,
    status         VARCHAR(20) NOT NULL DEFAULT 'ativo',
                   -- ativo | pausado | indisponivel | precisa_remap
    custo          DECIMAL(10,2),
    preco_venda    DECIMAL(10,2),
    margem         DECIMAL(10,2),
    observacao     TEXT,
    mapeado_por    TEXT,
    mapped_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pulse_mapeamentos IS
  'Liga um grupo do DividePass (tag "Via Parceiro") ao package_id da Pulse.';

CREATE INDEX IF NOT EXISTS idx_pulse_mapeamentos_package ON public.pulse_mapeamentos (package_id);
CREATE INDEX IF NOT EXISTS idx_pulse_mapeamentos_status ON public.pulse_mapeamentos (status);

-- ============================================================================
-- 3. TABELA: pulse_pedidos (meus pedidos na Pulse)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pulse_pedidos (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id       VARCHAR(24) NOT NULL UNIQUE,   -- id do MEU pedido (8 caracteres)
    transaction_code  TEXT NOT NULL,                 -- id da transação no meu gateway
    payment_id        UUID REFERENCES public.payments(id) ON DELETE SET NULL,
    group_id          UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    service_id        UUID REFERENCES public.streaming_services(id) ON DELETE SET NULL,
    user_id           UUID REFERENCES public.users(id) ON DELETE SET NULL,
    package_id        TEXT REFERENCES public.pulse_pacotes(package_id) ON DELETE SET NULL,
    status            VARCHAR(20) NOT NULL DEFAULT 'pendente',
                      -- pendente | processando | entregue | erro | devolvido | cancelado
    pulse_order_id    TEXT,
    entrega           JSONB NOT NULL DEFAULT '{}'::jsonb,
    custo             DECIMAL(10,2),
    preco_pago        DECIMAL(10,2),
    tentativas        INTEGER NOT NULL DEFAULT 0,
    ultimo_erro       TEXT,
    error_code        TEXT,
    delivery_kind     TEXT,                          -- accounts | link | code | custom
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT pulse_pedidos_uniq UNIQUE (transaction_code, group_id)
);

COMMENT ON COLUMN public.pulse_pedidos.external_id IS
  'Id do meu pedido enviado para a Pulse. NUNCA muda: é o que garante não cobrar duas vezes.';
COMMENT ON COLUMN public.pulse_pedidos.entrega IS
  'Conteúdo entregue pela Pulse (contas, link, licença, código). Só o service_role lê.';

CREATE INDEX IF NOT EXISTS idx_pulse_pedidos_status ON public.pulse_pedidos (status);
CREATE INDEX IF NOT EXISTS idx_pulse_pedidos_user ON public.pulse_pedidos (user_id);
CREATE INDEX IF NOT EXISTS idx_pulse_pedidos_group ON public.pulse_pedidos (group_id);
CREATE INDEX IF NOT EXISTS idx_pulse_pedidos_external ON public.pulse_pedidos (external_id);

-- ============================================================================
-- 4. TABELA: pulse_eventos (auditoria)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pulse_eventos (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id   UUID REFERENCES public.pulse_pedidos(id) ON DELETE CASCADE,
    package_id  TEXT,
    group_id    UUID,
    user_id     UUID,
    tipo        VARCHAR(40) NOT NULL,
    mensagem    TEXT,
    detalhes    JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pulse_eventos_pedido ON public.pulse_eventos (pedido_id);
CREATE INDEX IF NOT EXISTS idx_pulse_eventos_tipo ON public.pulse_eventos (tipo);

-- ============================================================================
-- 5. TABELA: pulse_entregas (o que o cliente recebeu)
-- ============================================================================
-- Por que uma tabela separada e NÃO `group_credentials`:
--   - o trigger `release_credential` (do banco) DESALOCA a credencial quando o
--     membro sai do grupo (assigned_to = NULL) e, com isso, a conta privada
--     de um cliente passaria a ser visível para os OUTROS membros do grupo;
--   - `group_credentials` é lida direto pelo navegador via RLS, e o cliente
--     não pode ver a conta de outro cliente nem o pedido de outra pessoa.
-- Aqui a leitura é sempre pelo backend, filtrada pelo user_id do JWT.
CREATE TABLE IF NOT EXISTS public.pulse_entregas (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pedido_id         UUID REFERENCES public.pulse_pedidos(id) ON DELETE CASCADE,
    group_id          UUID REFERENCES public.groups(id) ON DELETE SET NULL,
    user_id           UUID REFERENCES public.users(id) ON DELETE CASCADE,
    package_id        TEXT REFERENCES public.pulse_pacotes(package_id) ON DELETE SET NULL,
    package_title     TEXT,
    credential_type   VARCHAR(50) NOT NULL DEFAULT 'email_password',
                      -- email_password | link | code | custom
    login_email       TEXT,
    login_password    TEXT,
    credential_url    TEXT,
    credential_notes  TEXT,
    credits           INTEGER,
    expira_em         DATE,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.pulse_entregas IS
  'Entrega da Pulse para o cliente. Conta privada: 1 compra = 1 linha por conta. Leitura só pelo backend.';

CREATE INDEX IF NOT EXISTS idx_pulse_entregas_user ON public.pulse_entregas (user_id);
CREATE INDEX IF NOT EXISTS idx_pulse_entregas_group ON public.pulse_entregas (group_id);
CREATE INDEX IF NOT EXISTS idx_pulse_entregas_pedido ON public.pulse_entregas (pedido_id);

-- ============================================================================
-- 6. RLS — leitura só pelo backend (service_role)
-- ============================================================================
-- Nenhuma policy para anon/authenticated: o acesso direto do navegador é
-- bloqueado. Tudo passa pelas edge functions, que checam o JWT do usuário.
ALTER TABLE public.pulse_pacotes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_mapeamentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_pedidos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_eventos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pulse_entregas   ENABLE ROW LEVEL SECURITY;

-- O cliente enxerga só as SUAS entregas (e o admin enxerga todas).
-- O DROP antes do CREATE é o que torna isto idempotente: rodar o arquivo
-- duas vezes não pode falhar com "policy já existe".
DROP POLICY IF EXISTS "Cliente ve as proprias entregas" ON public.pulse_entregas;
CREATE POLICY "Cliente ve as proprias entregas" ON public.pulse_entregas
    FOR SELECT USING (user_id = auth.uid() OR is_admin());

-- ============================================================================
-- 7. GUARDA DO TRIGGER release_credential
-- ============================================================================
-- O trigger original desaloca a credencial de quem saiu do grupo. Em um grupo
-- "Via Parceiro" isso abriria a conta privada para os outros membros. Aqui
-- a desalocação é ignorada nesses grupos (a conta é do cliente, não do grupo).
DO $do$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'release_credential'
  ) THEN
    EXECUTE $bloco$
      CREATE OR REPLACE FUNCTION public.release_credential()
      RETURNS TRIGGER AS $$
      BEGIN
          IF NEW.status IN ('inactive', 'cancelled') AND OLD.status = 'active' THEN
              UPDATE group_credentials
              SET assigned_to = NULL
              WHERE group_id = NEW.group_id
              AND assigned_to = NEW.user_id
              AND NOT EXISTS (
                  SELECT 1 FROM groups g
                  WHERE g.id = NEW.group_id
                  AND EXISTS (
                      SELECT 1 FROM unnest(COALESCE(g.tags, '{}'::text[])) AS t
                      WHERE lower(btrim(t)) = 'via parceiro'
                  )
              );
          END IF;
          RETURN NEW;
      END;
      $$ LANGUAGE plpgsql SECURITY DEFINER;
    $bloco$;
    RAISE NOTICE 'release_credential: guarda "Via Parceiro" aplicada.';
  ELSE
    RAISE NOTICE 'release_credential nao existe neste banco — guarda nao foi necessaria.';
  END IF;
END $do$;

-- ============================================================================
-- 8. VIEW: painel do admin (pacote + grupo + último pedido)
-- ============================================================================
CREATE OR REPLACE VIEW public.pulse_painel AS
SELECT
    p.package_id,
    p.title,
    p.category,
    p.status,
    p.visible,
    p.orderable_via_api,
    p.availability,
    p.delivery,
    p.stock,
    p.original_price,
    p.price            AS custo,
    p.sale_price,
    (COALESCE(p.sale_price, 0) - COALESCE(p.price, 0)) AS margem,
    p.duration_days,
    p.billing_cycle,
    p.service_id,
    p.plan_id,
    p.group_id,
    g.name             AS grupo_nome,
    g.slug             AS grupo_slug,
    g.status           AS grupo_status,
    g.visibility       AS grupo_visibility,
    g.price_per_slot   AS grupo_preco,
    s.name             AS plataforma_nome,
    s.slug             AS plataforma_slug,
    m.status           AS mapeamento_status,
    p.last_synced_at
FROM public.pulse_pacotes p
LEFT JOIN public.groups g              ON g.id = p.group_id
LEFT JOIN public.streaming_services s  ON s.id = p.service_id
LEFT JOIN public.pulse_mapeamentos m    ON m.package_id = p.package_id AND m.group_id = p.group_id;

-- ============================================================================
-- 9. CRON DO POLLING + URL DO WEBHOOK
-- ============================================================================
-- 9.1. Segredo do job de polling.
--     O job manda esse segredo no header Authorization; a edge function
--     confere antes de mexer em qualquer pedido.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'pulse_cron_secret') THEN
    INSERT INTO public.app_settings (key, value)
    VALUES (
      'pulse_cron_secret',
      md5(random()::text || clock_timestamp()::text)
        || md5(random()::text || clock_timestamp()::text)
    );
    RAISE NOTICE 'Segredo pulse_cron_secret criado.';
  ELSE
    RAISE NOTICE 'Segredo pulse_cron_secret ja existe.';
  END IF;
END $$;

-- 9.2. URL do webhook que a Pulse deve chamar.
--     (A chave da API nao vai aqui: ela e segredo do Supabase.)
INSERT INTO public.app_settings (key, value)
VALUES (
  'pulse_webhook_url',
  'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/pulse-webhook'
)
ON CONFLICT (key) DO NOTHING;

-- 9.3. Job de polling a cada 5 minutos.
--     Rede de seguranca: se o webhook nao chegar, o polling busca a entrega.
--
--     O bloco inteiro depende do pg_cron. Se a extensão não estiver no banco
--     (instalação local, ambiente de teste), o job é apenas pulado com um
--     aviso — o resto do arquivo continua valendo.
DO $do$
DECLARE
  v_existe boolean;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron ausente: o job pulse-poll NAO foi criado. Crie a extensão e rode o bloco de novo.';
    RETURN;
  END IF;

  -- `cron.unschedule` só pode ser chamado se o job existe (pelo nome).
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pulse-poll') INTO v_existe;
  IF v_existe THEN
    PERFORM cron.unschedule('pulse-poll');
    RAISE NOTICE 'Job pulse-poll removido para recriar.';
  END IF;

  PERFORM cron.schedule(
    'pulse-poll',
    '*/5 * * * *',
    $cmd$
      select net.http_post(
        url := 'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/pulse-poll',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT value FROM public.app_settings WHERE key = 'pulse_cron_secret'
          )
        ),
        body := '{"limite":20}'::jsonb
      );
    $cmd$
  );
  RAISE NOTICE 'Job pulse-poll criado (a cada 5 minutos).';
END $do$;

-- ============================================================================
-- 10. CONFERÊNCIA
-- ============================================================================
SELECT 'pulse_pacotes'      AS tabela, COUNT(*) AS linhas FROM public.pulse_pacotes
UNION ALL SELECT 'pulse_mapeamentos', COUNT(*) FROM public.pulse_mapeamentos
UNION ALL SELECT 'pulse_pedidos',     COUNT(*) FROM public.pulse_pedidos
UNION ALL SELECT 'pulse_entregas',    COUNT(*) FROM public.pulse_entregas
UNION ALL SELECT 'pulse_eventos',     COUNT(*) FROM public.pulse_eventos;
