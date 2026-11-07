-- ============================================================
-- PENDÊNCIAS DO BANCO — DividePass (2026-10-30)
--
-- Cole TUDO este arquivo no SQL Editor do Supabase (projeto
-- lasoouwboxspstqvjbsv) e execute de uma vez. É idempotente:
-- rodar duas vezes não quebra nada.
--
-- Ele resolve 3 coisas:
--
--   PARTE 1 — Limpa 2 contas de teste órfãs (group_interest +
--             public.users) deixadas pelas rodadas de verificação.
--
--   PARTE 2 — CORRIGE A FK group_interest.user_id (e as outras FKs
--             que apontam para users.id) com ON UPDATE CASCADE.
--             Sem isso, o trigger handle_new_user (que troca o
--             id do profile no re-cadastro) quebra o cadastro de
--             qualquer conta que tenha ficado na lista de espera.
--
--   PARTE 3 — Aplica a migration das ofertas patrocinadas
--             (sponsored_offers + service_votes), que é o que faz
--             as features novas existirem de verdade no banco.
-- ============================================================


-- ══════════════════════════════════════════════════════════════
-- PARTE 1 — LIMPEZA DAS CONTAS DE TESTE ÓRFÃS
-- ══════════════════════════════════════════════════════════════
-- Estas linhas foram criadas pelas rodadas de verificação visual
-- (a edge function delete-account que estava DEPLOYADA era uma
-- versão antiga, que não limpava a lista de espera antes de
-- apagar o profile). Sem serviço_role não dá para apagar pelo
-- app, então a limpeza é aqui.

DO $$
DECLARE
    r       record;
    col     text;
    tbl_q   text;
    teste   uuid;
BEGIN
    FOREACH teste IN ARRAY ARRAY[
        'dd7488f2-602c-4692-9d09-c118825dc35b'::uuid,  -- dp.teste.1793393490562@dividepass.com
        'beb10a98-4f41-40c6-8cdf-3d08d95350fa'::uuid    -- dp.visual.1793407000@dividepass.com
    ] LOOP
        -- Apaga (ou neutraliza) toda linha filha que aponta para users(id)
        FOR r IN
            SELECT (SELECT n.nspname FROM pg_class c
                      JOIN pg_namespace n ON n.oid = c.relnamespace
                     WHERE c.oid = con.conrelid) AS schema_name,
                   (SELECT c.relname FROM pg_class c WHERE c.oid = con.conrelid) AS tbl,
                   con.conrelid,
                   con.conkey
            FROM pg_constraint con
            WHERE con.contype = 'f'
              AND con.confrelid = 'public.users'::regclass
        LOOP
            SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
              INTO col
            FROM unnest(r.conkey) WITH ORDINALITY AS k(attnum, ord)
            JOIN pg_attribute a
              ON a.attrelid = r.conrelid AND a.attnum = k.attnum;

            tbl_q := format('%I.%I', r.schema_name, r.tbl);

            -- `groups` nunca e apagado: o dono/revisor vira NULL.
            IF r.tbl = 'groups' THEN
                EXECUTE format('UPDATE %s SET %s = NULL WHERE %s = $1', tbl_q, col, col)
                USING teste;
            ELSE
                EXECUTE format('DELETE FROM %s WHERE %s = $1', tbl_q, col)
                USING teste;
            END IF;
        END LOOP;
    END LOOP;
END $$;

-- O profile (public.users) depois de limpar as linhas filhas.
DELETE FROM public.users
WHERE id IN (
    'dd7488f2-602c-4692-9d09-c118825dc35b',
    'beb10a98-4f41-40c6-8cdf-3d08d95350fa'
);


-- ══════════════════════════════════════════════════════════════
-- PARTE 2 — ON UPDATE CASCADE NAS FKs QUE APONTAM PARA users(id)
-- ══════════════════════════════════════════════════════════════
-- O trigger public.handle_new_user() faz:
--     UPDATE public.users SET id = NEW.id WHERE email = ...
-- ou seja, ele TROCA a chave primária do profile no re-cadastro.
-- Toda FK que referencia users(id) precisa de ON UPDATE CASCADE,
-- senão o cadastro quebra com:
--     23503: update or delete on table "users" violates foreign key
--             constraint "group_interest_user_id_fkey"
-- O ON DELETE de cada constraint é preservado (CASCADE continua
-- CASCADE, SET NULL continua SET NULL) — só o UPDATE é corrigido.

DO $$
DECLARE
    r        record;
    cols     text;
    del_act  text;
    tbl_q    text;
BEGIN
    FOR r IN
        SELECT con.conname,
               con.conrelid,
               con.confdeltype,
               (SELECT n.nspname FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.oid = con.conrelid) AS schema_name,
               (SELECT c.relname FROM pg_class c WHERE c.oid = con.conrelid) AS tbl,
               con.conkey
        FROM pg_constraint con
        WHERE con.contype = 'f'
          AND con.confrelid = 'public.users'::regclass
          AND con.confupdtype <> 'c'          -- ainda sem ON UPDATE CASCADE
    LOOP
        tbl_q := format('%I.%I', r.schema_name, r.tbl);

        -- Colunas do lado do usuário (normalmente só uma: user_id)
        SELECT string_agg(a.attname, ', ' ORDER BY k.ord)
          INTO cols
        FROM unnest(r.conkey) WITH ORDINALITY AS k(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = r.conrelid AND a.attnum = k.attnum;

        -- Preserva a ação de DELETE original
        del_act := CASE r.confdeltype
                     WHEN 'c' THEN 'CASCADE'
                     WHEN 'n' THEN 'SET NULL'
                     WHEN 'd' THEN 'SET DEFAULT'
                     WHEN 'r' THEN 'RESTRICT'
                     ELSE 'NO ACTION'
                   END;

        EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', tbl_q, r.conname);

        BEGIN
            EXECUTE format(
                'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.users(id) ON DELETE %s ON UPDATE CASCADE',
                tbl_q, r.conname, cols, del_act);
        EXCEPTION WHEN others THEN
            -- Havia linhas órfãs nesta tabela: mantém a FK válida para as
            -- próximas escritas sem travar a execução do script inteiro.
            RAISE WARNING 'FK % em % não validada (%). Aplicando NOT VALID.',
                r.conname, tbl_q, SQLERRM;
            EXECUTE format(
                'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (%s) REFERENCES public.users(id) ON DELETE %s ON UPDATE CASCADE NOT VALID',
                tbl_q, r.conname, cols, del_act);
        END;

        RAISE NOTICE 'FK % em % ajustada: ON DELETE % -> ON UPDATE CASCADE',
            r.conname, tbl_q, del_act;
    END LOOP;
END $$;


-- ══════════════════════════════════════════════════════════════
-- PARTE 3 — MIGRATION: OFERTAS PATROCINADAS + VOTOS
-- ══════════════════════════════════════════════════════════════
-- (mesmo conteúdo de database/add-sponsored-offers.sql, com
--  ON UPDATE CASCADE nas FKs que apontam para users(id))

CREATE TABLE IF NOT EXISTS public.sponsored_offers (
    -- Id curto de 8 caracteres (letras e números), como o resto do projeto.
    id              TEXT PRIMARY KEY
                    DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8),
    service_id      UUID REFERENCES public.streaming_services(id) ON DELETE CASCADE,
    group_id        UUID REFERENCES public.groups(id) ON DELETE CASCADE,
    sponsor_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
    sponsor_name    VARCHAR(120) NOT NULL,
    headline        VARCHAR(160) NOT NULL,
    description     TEXT,
    badge           VARCHAR(60)  NOT NULL DEFAULT 'Oferta em destaque',
    cta_label       VARCHAR(60)  NOT NULL DEFAULT 'Ver oferta',
    cta_url         TEXT,
    banner_url      TEXT,
    placement       VARCHAR(20) NOT NULL DEFAULT 'catalog'
                    CHECK (placement IN ('catalog', 'recommendation', 'both')),
    amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
    period_start    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_end      TIMESTAMPTZ,
    status          VARCHAR(20) NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'paused', 'ended')),
    priority        INTEGER NOT NULL DEFAULT 0,
    impressions     INTEGER NOT NULL DEFAULT 0,
    clicks          INTEGER NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by      UUID REFERENCES public.users(id) ON DELETE SET NULL ON UPDATE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_sponsored_offers_status
    ON public.sponsored_offers (status, priority DESC);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_service
    ON public.sponsored_offers (service_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_group
    ON public.sponsored_offers (group_id);
CREATE INDEX IF NOT EXISTS idx_sponsored_offers_period
    ON public.sponsored_offers (period_start, period_end);

CREATE TABLE IF NOT EXISTS public.service_votes (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE ON UPDATE CASCADE,
    service_id  UUID NOT NULL REFERENCES public.streaming_services(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, service_id)
);

COMMENT ON TABLE public.service_votes IS
    'Votos de interesse em serviços ("O que você gostaria de compartilhar?"). Um voto por usuário e serviço.';

CREATE INDEX IF NOT EXISTS idx_service_votes_service ON public.service_votes (service_id);
CREATE INDEX IF NOT EXISTS idx_service_votes_user    ON public.service_votes (user_id);

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

ALTER TABLE public.sponsored_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.service_votes       ENABLE ROW LEVEL SECURITY;

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

GRANT SELECT ON public.sponsored_offers TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsored_offers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sponsored_offers TO service_role;

GRANT SELECT, INSERT, DELETE ON public.service_votes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_votes TO service_role;

CREATE OR REPLACE VIEW public.service_vote_counts AS
SELECT
    sv.service_id,
    COUNT(*)::int AS votes
FROM public.service_votes sv
GROUP BY sv.service_id;

COMMENT ON VIEW public.service_vote_counts IS
    'Total de votos por serviço. Votos são públicos, mas o voto não identifica o usuário.';

GRANT SELECT ON public.service_vote_counts TO anon, authenticated, service_role;

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


-- ══════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rode depois — deve listar as tabelas novas e 0 órfãos)
-- ══════════════════════════════════════════════════════════════
SELECT 'sponsored_offers' AS tabela, count(*) AS linhas FROM public.sponsored_offers
UNION ALL SELECT 'service_votes', count(*) FROM public.service_votes;

-- Deve retornar 0 linhas (nenhuma conta de teste órfã)
SELECT gi.user_id, count(*)
FROM public.group_interest gi
LEFT JOIN public.users u ON u.id = gi.user_id
WHERE u.id IS NULL
GROUP BY gi.user_id;
