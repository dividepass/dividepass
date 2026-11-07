-- ============================================================
-- MIGRATION: Ofertas patrocinadas no catálogo + Votos de interesse
--
-- Duas features novas:
--
-- 1) sponsored_offers — a área MONETIZADA. Um parceiro paga para ter a
--    oferta dele destacada no topo do catálogo e/ou dentro de
--    "Recomendados para você". O preço, o período e a posição ficam
--    registrados aqui, então o admin sabe o que foi vendido.
--
-- 2) service_votes — o voto de "O que você gostaria de compartilhar?".
--    Um voto por (usuário, serviço). Serve para a plataforma saber o que
--    abrir grupo primeiro.
--
-- NOTA IMPORTANTE: o front já foi escrito para degradar com elegância
-- (se a tabela não existir, a seção simplesmente não aparece). Então esta
-- migration pode ser aplicada depois do deploy sem quebrar ninguém.
-- ============================================================

-- ─────────────────────────────────────────────────────────────
-- 1. TABELA: sponsored_offers
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sponsored_offers (
    -- Id curto de 8 caracteres (letras e números), como o resto do projeto
    -- (código de grupo, slug). É o identificador que o admin lê no painel e
    -- que o formulário usa — não um UUID de 36.
    id              TEXT PRIMARY KEY
                    DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8),

    -- O que está sendo patrocinado. Pelo menos um dos dois precisa existir.
    service_id      UUID REFERENCES public.streaming_services(id) ON DELETE CASCADE,
    group_id        UUID REFERENCES public.groups(id) ON DELETE CASCADE,

    -- Quem pagou. Se o SponsoredOffer tiver group_id, este é o dono do grupo:
    -- é ele que ganha o boost nos "Recomendados" (turbinou e patrocinou).
    sponsor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
    sponsor_name    VARCHAR(120) NOT NULL,

    -- Conteúdo do anúncio
    headline        VARCHAR(160) NOT NULL,
    description     TEXT,
    badge           VARCHAR(60)  NOT NULL DEFAULT 'Oferta em destaque',
    cta_label       VARCHAR(60)  NOT NULL DEFAULT 'Ver oferta',
    cta_url         TEXT,
    banner_url      TEXT,

    -- Onde o anúncio aparece:
    --   catalog       → só no topo do catálogo
    --   recommendation → só em "Recomendados para você"
    --   both          → nos dois lugares
    placement       VARCHAR(20) NOT NULL DEFAULT 'catalog'
                    CHECK (placement IN ('catalog', 'recommendation', 'both')),

    -- O que o parceiro pagou (registro comercial, não processa pagamento)
    amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_end      TIMESTAMPTZ,

    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'ended')),

    -- Ordem dentro da área: maior priority aparece primeiro
    priority        INTEGER NOT NULL DEFAULT 0,

    -- Métricas simples para o admin ver se o destaque está rendendo
    impressions     INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,

    notes           TEXT,
    created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT sponsored_offers_target_chk
        CHECK (service_id IS NOT NULL OR group_id IS NOT NULL)
);

COMMENT ON TABLE public.sponsored_offers IS
    'Ofertas patrocinadas: parceiros pagam para ser destacados no catálogo e nos recomendados.';
COMMENT ON COLUMN public.sponsored_offers.placement IS
    'Onde o anúncio aparece: catalog | recommendation | both.';
COMMENT ON COLUMN public.sponsored_offers.sponsor_user_id IS
    'Quem pagou. Quando group_id está preenchido, é o dono do grupo patrocinado.';

-- Índices: a listagem pública filtra por status + período + prioridade
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_status
    ON public.sponsored_offers (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_service
    ON public.sponsored_offers (service_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_group
    ON public.sponsored_offers (group_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_period
    ON public.sponsored_offers (period_start, period_end);

-- ─────────────────────────────────────────────────────────────
-- 2. TABELA: service_votes
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_votes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    service_id  UUID NOT NULL REFERENCES public.streaming_services(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, service_id)
);

COMMENT ON TABLE public.service_votes IS
    'Votos de interesse em serviços ("O que você gostaria de compartilhar?"). Um voto por usuário e serviço.';

CREATE INDEX IF NOT EXISTS idx_service_votes_service ON public.service_votes (service_id);
CREATE INDEX IF NOT EXISTS idx_service_votes_user    ON public.service_votes (user_id);

-- ─────────────────────────────────────────────────────────────
-- 3. TRIGGER updated_at
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.touch_sponsored_offers_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sponsored_offers_updated_at ON public.sponsored_offers;
CREATE TRIGGER trg_sponsored_offers_updated_at
    BEFORE UPDATE ON public.sponsored_offers
    FOR EACH ROW EXECUTE FUNCTION public.touch_sponsored_offers_updated_at();

-- ─────────────────────────────────────────────────────────────
-- 4. ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────
ALTER TABLE public.sponsored_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_votes       ENABLE ROW LEVEL SECURITY;

-- sponsored_offers ───────────────────────────────────────────
-- Leitura pública: só o que está ativo e dentro do período.
-- (A policy do admin vem depois e é OR'd com esta, então o admin vê tudo.)
DROP POLICY IF EXISTS "Ofertas ativas visíveis ao público" ON public.sponsored_offers;
CREATE POLICY "Ofertas ativas visíveis ao público"
    ON public.sponsored_offers
    FOR SELECT
    USING (
        status = 'active'
        AND period_start <= NOW()
        AND (period_end IS NULL OR period_end >= NOW())
    );

DROP POLICY IF EXISTS "Admins gerenciam ofertas patrocinadas" ON public.sponsored_offers;
CREATE POLICY "Admins gerenciam ofertas patrocinadas"
    ON public.sponsored_offers
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- service_votes ──────────────────────────────────────────────
-- Qualquer autenticado lê para poder CONTAR os votos.
-- O front só pede a coluna service_id, então o voto não expõe quem votou.
DROP POLICY IF EXISTS "Autenticados contam votos" ON public.service_votes;
CREATE POLICY "Autenticados contam votos"
    ON public.service_votes
    FOR SELECT
    USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Usuário vota no próprio interesse" ON public.service_votes;
CREATE POLICY "Usuário vota no próprio interesse"
    ON public.service_votes
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Usuário remove o próprio voto" ON public.service_votes;
CREATE POLICY "Usuário remove o próprio voto"
    ON public.service_votes
    FOR DELETE
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins gerenciam votos" ON public.service_votes;
CREATE POLICY "Admins gerenciam votos"
    ON public.service_votes
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────
-- 5. GRANTS
-- ─────────────────────────────────────────────────────────────
GRANT SELECT ON public.sponsored_offers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsored_offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsored_offers TO service_role;

GRANT SELECT, INSERT, DELETE ON public.service_votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_votes TO service_role;

-- ─────────────────────────────────────────────────────────────
-- 6. CONTA DE VOTOS (view para o admin e para o front)
--    Uma linha por serviço com o total de votos.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.service_vote_counts AS
SELECT
    sv.service_id,
    COUNT(*)::int AS votes
FROM public.service_votes sv
GROUP BY sv.service_id;

COMMENT ON VIEW public.service_vote_counts IS
    'Total de votos por serviço. Votos são públicos, mas o voto não identifica o usuário.';

GRANT SELECT ON public.service_vote_counts TO anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 7. AJUDA PARA O ALERTA DE VAGA
--    Quem está na lista de espera de um serviço (group_interest).
--    A edge function notify-service-watchers usa esta view.
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE VIEW public.service_watchlist AS
SELECT
    gi.service_id,
    gi.user_id,
    MIN(gi.created_at) AS since
FROM public.group_interest gi
GROUP BY gi.service_id, gi.user_id;

COMMENT ON VIEW public.service_watchlist IS
    'Serviços que o usuário está esperando vaga, para avisar quando um grupo abrir.';

GRANT SELECT ON public.service_watchlist TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────
-- 8. MÉTRICA DA OFERTA (cliques e impressões)
--
-- A escrita na tabela é restrita ao admin (policy "Admins gerenciam
-- ofertas patrocinadas"). Se o clique fosse um PATCH do navegador do
-- usuário comum, o RLS engoliria a escrita — PostgREST devolveria 200
-- com lista vazia e o contador ficaria sempre em 0.
--
-- Por isso a métrica é somada por uma RPC SECURITY DEFINER: é a única
-- escrita pública na tabela, e só conta oferta ativa e dentro do período.
--
-- (Aplicada em produção em 2026-11-01. O mesmo SQL está isolado em
--  database/apply-pending-2026-11-01.sql para colar no SQL Editor.)
--
-- O `p_offer_id` é TEXT (e não UUID) porque o id da oferta é curto: 8
-- caracteres. A versão antiga, com UUID, é removida antes — senão ficam
-- duas funções com o mesmo nome e o PostgREST não sabe qual chamar.
DROP FUNCTION IF EXISTS public.increment_sponsor_metric(UUID, TEXT);
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.increment_sponsor_metric(
    p_offer_id TEXT,
    p_metric   TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new INTEGER;
BEGIN
    IF p_metric = 'click' THEN
        UPDATE public.sponsored_offers
           SET clicks = clicks + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING clicks INTO v_new;

    ELSIF p_metric = 'impression' THEN
        UPDATE public.sponsored_offers
           SET impressions = impressions + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING impressions INTO v_new;

    ELSE
        RAISE EXCEPTION 'métrica inválida: %', p_metric;
    END IF;

    RETURN COALESCE(v_new, 0);
END;
$$;

REVOKE ALL ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) TO authenticated, service_role;
