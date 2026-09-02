-- ============================================================
-- ADD SERVICE PLANS — Preços oficiais por plano
-- Cada serviço pode ter múltiplos planos com preços oficiais.
-- Não hardcodar no frontend — fonte de verdade é o DB.
-- ============================================================

-- 1. Tabela de planos oficiais por serviço
CREATE TABLE IF NOT EXISTS service_plans (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    name            VARCHAR(100) NOT NULL,                    -- "Premium", "Padrão", "Básico"
    plan_key        VARCHAR(50) NOT NULL,                     -- "premium", "padrao", "basico"
    billing_cycle   VARCHAR(20) NOT NULL DEFAULT 'monthly'
                        CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
    official_price  DECIMAL(10,2) NOT NULL,                   -- Preço oficial em BRL
    currency        VARCHAR(3) NOT NULL DEFAULT 'BRL',
    country         VARCHAR(50) NOT NULL DEFAULT 'Brasil',
    source_url      TEXT,
    source_date     DATE,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, plan_key)
);

-- 2. ÍNDICES
CREATE INDEX IF NOT EXISTS idx_service_plans_service ON service_plans(service_id);
CREATE INDEX IF NOT EXISTS idx_service_plans_active ON service_plans(service_id, is_active) WHERE is_active = TRUE;

-- 3. FUNÇÃO AUTO-UPDATE updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 4. TRIGGER
DROP TRIGGER IF EXISTS trg_service_plans_updated_at ON service_plans;
CREATE TRIGGER trg_service_plans_updated_at
    BEFORE UPDATE ON service_plans
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Adicionar default_plan_id em streaming_services (indica qual plano é o "principal")
ALTER TABLE streaming_services
    ADD COLUMN IF NOT EXISTS default_plan_id UUID REFERENCES service_plans(id) ON DELETE SET NULL;

-- 6. Adicionar plan_id em groups (indica qual plano aquele grupo representa)
ALTER TABLE groups
    ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES service_plans(id) ON DELETE SET NULL;

-- 7. Adicionar plan_id em user_subscriptions (indica qual plano o usuário possui)
ALTER TABLE user_subscriptions
    ADD COLUMN IF NOT EXISTS plan_id UUID REFERENCES service_plans(id) ON DELETE SET NULL;

-- ============================================================
-- SEED: Popular service_plans com preços oficiais do Brasil (2025-2026)
-- Fonte: sites oficiais de cada serviço
-- IMPORTANTE: Ajuste os preços conforme necessário — não é hardcoded no frontend
-- ============================================================

-- Netflix (ID fixo do seed)
DO $$
DECLARE
    netflix_id UUID := '11111111-1111-1111-1111-111111111111';
    netflix_premium_id UUID;
    netflix_padrao_id UUID;
    netflix_basico_id UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (netflix_id, 'Básico com anúncios', 'basico-com-ads', 'monthly', 20.90, 'Brasil', 'https://www.netflix.com/br/', CURRENT_DATE, TRUE),
        (netflix_id, 'Padrão', 'padrao', 'monthly', 38.90, 'Brasil', 'https://www.netflix.com/br/', CURRENT_DATE, TRUE),
        (netflix_id, 'Premium', 'premium', 'monthly', 55.90, 'Brasil', 'https://www.netflix.com/br/', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            name = EXCLUDED.name,
            updated_at = NOW();

    -- Pegar IDs para marcar default
    SELECT id INTO netflix_premium_id FROM service_plans WHERE service_id = netflix_id AND plan_key = 'premium';
    SELECT id INTO netflix_padrao_id FROM service_plans WHERE service_id = netflix_id AND plan_key = 'padrao';
    SELECT id INTO netflix_basico_id FROM service_plans WHERE service_id = netflix_id AND plan_key = 'basico-com-ads';

    -- Marcar Premium como default (mais comum em grupos DividePass)
    UPDATE streaming_services SET default_plan_id = netflix_premium_id WHERE id = netflix_id;
END $$;

-- Spotify (ID fixo do seed)
DO $$
DECLARE
    spotify_id UUID := '22222222-2222-2222-2222-222222222222';
    spotify_premium_id UUID;
    spotify_family_id UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (spotify_id, 'Individual', 'individual', 'monthly', 21.90, 'Brasil', 'https://www.spotify.com/br/premium/', CURRENT_DATE, TRUE),
        (spotify_id, 'Família', 'familia', 'monthly', 34.90, 'Brasil', 'https://www.spotify.com/br/premium/', CURRENT_DATE, TRUE),
        (spotify_id, 'Duo', 'duo', 'monthly', 27.90, 'Brasil', 'https://www.spotify.com/br/premium/', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            name = EXCLUDED.name,
            updated_at = NOW();

    SELECT id INTO spotify_family_id FROM service_plans WHERE service_id = spotify_id AND plan_key = 'familia';
    SELECT id INTO spotify_premium_id FROM service_plans WHERE service_id = spotify_id AND plan_key = 'individual';

    -- Famlia como default (mais relevante para divisão)
    UPDATE streaming_services SET default_plan_id = spotify_family_id WHERE id = spotify_id;
END $$;

-- Disney+ (ID fixo do seed)
DO $$
DECLARE
    disney_id UUID := '33333333-3333-3333-3333-333333333333';
    disney_premium_id UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (disney_id, 'Padrão', 'padrao', 'monthly', 27.90, 'Brasil', 'https://www.disneyplus.com/br/', CURRENT_DATE, TRUE),
        (disney_id, 'Premium', 'premium', 'monthly', 45.90, 'Brasil', 'https://www.disneyplus.com/br/', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            name = EXCLUDED.name,
            updated_at = NOW();

    SELECT id INTO disney_premium_id FROM service_plans WHERE service_id = disney_id AND plan_key = 'premium';
    UPDATE streaming_services SET default_plan_id = disney_premium_id WHERE id = disney_id;
END $$;

-- HBO Max (ID fixo do seed)
DO $$
DECLARE
    hbo_id UUID := '44444444-4444-4444-4444-444444444444';
    hbo_essencial_id UUID;
    hbo_padrao_id UUID;
    hbo_premium_id UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (hbo_id, 'Essencial', 'essencial', 'monthly', 20.90, 'Brasil', 'https://www.max.com/br/pt', CURRENT_DATE, TRUE),
        (hbo_id, 'Padrão', 'padrao', 'monthly', 35.90, 'Brasil', 'https://www.max.com/br/pt', CURRENT_DATE, TRUE),
        (hbo_id, 'Ultimate', 'ultimate', 'monthly', 55.90, 'Brasil', 'https://www.max.com/br/pt', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            name = EXCLUDED.name,
            updated_at = NOW();

    SELECT id INTO hbo_padrao_id FROM service_plans WHERE service_id = hbo_id AND plan_key = 'padrao';
    UPDATE streaming_services SET default_plan_id = hbo_padrao_id WHERE id = hbo_id;
END $$;

-- Amazon Prime Video (ID fixo do seed)
DO $$
DECLARE
    prime_id UUID := '55555555-5555-5555-5555-555555555555';
    prime_id_uuid UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (prime_id, 'Prime', 'prime', 'monthly', 14.90, 'Brasil', 'https://www.primevideo.com/', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            updated_at = NOW();

    SELECT id INTO prime_id_uuid FROM service_plans WHERE service_id = prime_id AND plan_key = 'prime';
    UPDATE streaming_services SET default_plan_id = prime_id_uuid WHERE id = prime_id;
END $$;

-- YouTube Premium (ID fixo do seed)
DO $$
DECLARE
    yt_id UUID := '66666666-6666-6666-6666-666666666666';
    yt_individual_id UUID;
    yt_family_id UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (yt_id, 'Individual', 'individual', 'monthly', 26.90, 'Brasil', 'https://www.youtube.com/premium', CURRENT_DATE, TRUE),
        (yt_id, 'Família', 'familia', 'monthly', 44.90, 'Brasil', 'https://www.youtube.com/premium', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            name = EXCLUDED.name,
            updated_at = NOW();

    SELECT id INTO yt_family_id FROM service_plans WHERE service_id = yt_id AND plan_key = 'familia';
    UPDATE streaming_services SET default_plan_id = yt_family_id WHERE id = yt_id;
END $$;

-- Apple TV+ (ID fixo do seed)
DO $$
DECLARE
    apple_id UUID := '77777777-7777-7777-7777-777777777777';
    apple_id_uuid UUID;
BEGIN
    INSERT INTO service_plans (service_id, name, plan_key, billing_cycle, official_price, country, source_url, source_date, is_active)
    VALUES
        (apple_id, 'Padrão', 'padrao', 'monthly', 12.90, 'Brasil', 'https://tv.apple.com/br/', CURRENT_DATE, TRUE)
    ON CONFLICT (service_id, plan_key) DO UPDATE
        SET official_price = EXCLUDED.official_price,
            updated_at = NOW();

    SELECT id INTO apple_id_uuid FROM service_plans WHERE service_id = apple_id AND plan_key = 'padrao';
    UPDATE streaming_services SET default_plan_id = apple_id_uuid WHERE id = apple_id;
END $$;

-- ============================================================
-- BACKFILL: Atualizar existing subscriptions para usar o plano padrão
-- Se o usuário não tem plan_id, usa o default do serviço
-- ============================================================

-- Atualizar subscriptions existentes para referenciar o plano padrão do serviço
UPDATE user_subscriptions us
SET plan_id = (
    SELECT default_plan_id
    FROM streaming_services s
    WHERE s.id = us.service_id
)
WHERE us.plan_id IS NULL AND us.status = 'active';

-- Atualizar groups existentes para referenciar o plano padrão do serviço
UPDATE groups g
SET plan_id = (
    SELECT default_plan_id
    FROM streaming_services s
    WHERE s.id = g.service_id
)
WHERE g.plan_id IS NULL;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- SELECT 'service_plans count: ' || COUNT(*) FROM service_plans;
-- SELECT s.name, p.name as plan_name, p.official_price
-- FROM service_plans p
-- JOIN streaming_services s ON s.id = p.service_id
-- ORDER BY s.name, p.official_price;
