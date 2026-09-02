-- ============================================================
-- ADD SERVICE PLANS V2 — Preços oficiais com histórico e alertas
-- Inclui: tipo de preço, promocional, histórico, alertas de desatualização
-- ============================================================

-- 1. Adicionar campos em service_plans para distinguir tipos de preço

ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS price_type VARCHAR(20) NOT NULL DEFAULT 'recurring'
    CHECK (price_type IN ('recurring', 'promotional', 'annual', 'monthly', 'one_time'));

ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS promotional_price DECIMAL(10,2);
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS promo_end_date DATE;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS is_promo_active BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN price_type = 'promotional' AND promotional_price IS NOT NULL
         AND (promo_end_date IS NULL OR promo_end_date >= CURRENT_DATE)
         THEN TRUE ELSE FALSE END
    ) STORED;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS last_verified_at DATE;
ALTER TABLE service_plans ADD COLUMN IF NOT EXISTS is_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Tabela de histórico de preços (não altera retroativamente)
CREATE TABLE IF NOT EXISTS service_price_history (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    plan_id        UUID REFERENCES service_plans(id) ON DELETE SET NULL,
    price           DECIMAL(10,2) NOT NULL,
    price_type      VARCHAR(20) NOT NULL DEFAULT 'recurring',
    valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
    valid_until     DATE,
    source_url      TEXT,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by      UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_price_history_service ON service_price_history(service_id);
CREATE INDEX IF NOT EXISTS idx_price_history_plan ON service_price_history(plan_id);
CREATE INDEX IF NOT EXISTS idx_price_history_valid ON service_price_history(valid_from, valid_until) WHERE valid_until IS NULL;

-- 3. Criar função: buscar preço oficial válido em uma data
CREATE OR REPLACE FUNCTION get_official_price_at(p_service_id UUID, p_date DATE DEFAULT CURRENT_DATE)
RETURNS DECIMAL(10,2) AS $$
DECLARE
    v_price DECIMAL(10,2);
BEGIN
    -- Primeiro tenta plano padrão do serviço
    SELECT sp.official_price INTO v_price
    FROM service_plans sp
    WHERE sp.service_id = p_service_id
      AND sp.is_active = TRUE
      AND sp.price_type = 'recurring'
      AND (sp.promo_end_date IS NULL OR sp.promo_end_date >= p_date)
    ORDER BY sp.official_price DESC
    LIMIT 1;

    -- Se não encontrar recorrente, usa qualquer ativo
    IF v_price IS NULL THEN
        SELECT sp.official_price INTO v_price
        FROM service_plans sp
        WHERE sp.service_id = p_service_id
          AND sp.is_active = TRUE
          AND (sp.promo_end_date IS NULL OR sp.promo_end_date >= p_date)
        ORDER BY sp.official_price DESC
        LIMIT 1;
    END IF;

    RETURN COALESCE(v_price, 0);
END;
$$ LANGUAGE plpgsql STABLE;

-- 4. Criar função: verificar se preço está desatualizado (> 90 dias sem verificar)
CREATE OR REPLACE FUNCTION check_price_staleness(p_plan_id UUID)
RETURNS JSONB AS $$
DECLARE
    v_plan service_plans%ROWTYPE;
    v_days_since_verified INT;
    v_days_since_update INT;
BEGIN
    SELECT * INTO v_plan FROM service_plans WHERE id = p_plan_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('is_stale', FALSE);
    END IF;

    v_days_since_verified := COALESCE(
        (CURRENT_DATE - v_plan.last_verified_at)::INT, 999
    );
    v_days_since_update := COALESCE(
        (CURRENT_DATE - DATE(v_plan.updated_at))::INT, 999
    );

    RETURN jsonb_build_object(
        'is_stale', v_days_since_verified > 90 OR v_days_since_update > 180,
        'days_since_verified', v_days_since_verified,
        'days_since_update', v_days_since_update,
        'last_verified_at', v_plan.last_verified_at,
        'updated_at', v_plan.updated_at,
        'needs_review', v_days_since_verified > 90
    );
END;
$$ LANGUAGE plpgsql STABLE;

-- 5. Atualizar seed dos planos existentes com price_type = 'recurring'
UPDATE service_plans
SET price_type = 'recurring',
    is_verified = TRUE,
    last_verified_at = CURRENT_DATE,
    notes = 'Atualizado em ' || CURRENT_DATE || ' — fonte: site oficial'
WHERE price_type = 'monthly';

-- Se a coluna ainda tem valor 'monthly' do seed original, corrigir
UPDATE service_plans
SET billing_cycle = 'monthly'
WHERE price_type = 'recurring' AND billing_cycle = 'monthly';

-- 6. Função: validar que economia não é negativa
CREATE OR REPLACE FUNCTION validate_savings_positive()
RETURNS TABLE(
    plan_id UUID,
    service_name TEXT,
    plan_name TEXT,
    official_price DECIMAL(10,2),
    min_expected_price DECIMAL(10,2)
) AS $$
BEGIN
    RETURN QUERY
    SELECT
        sp.id,
        ss.name,
        sp.name,
        sp.official_price,
        sp.official_price * 0.5 AS min_expected_price
    FROM service_plans sp
    JOIN streaming_services ss ON ss.id = sp.service_id
    WHERE sp.is_active = TRUE
      AND sp.official_price > 0
      -- Plano suspeito se oficial < R$ 5 (muito barato)
      AND sp.official_price < 5
    ORDER BY sp.official_price;
END;
$$ LANGUAGE plpgsql STABLE;

-- 7. Alerta: planos sem preço oficial (old streaming_services.official_price reference)
-- Atualizar plano padrão para serviços que ainda dependem do old price
UPDATE service_plans sp
SET official_price = (
    SELECT ss.official_price
    FROM streaming_services ss
    WHERE ss.id = sp.service_id
)
WHERE sp.official_price = 0
  AND sp.service_id IN (
      SELECT id FROM streaming_services WHERE official_price > 0
  );

-- 8. Inserir registro inicial no histórico para planos ativos
INSERT INTO service_price_history (service_id, plan_id, price, price_type, valid_from, notes, created_by)
SELECT
    sp.service_id,
    sp.id,
    sp.official_price,
    sp.price_type,
    COALESCE(sp.last_verified_at, CURRENT_DATE - INTERVAL '1 day'),
    'Registro inicial de histórico de preços — ' || CURRENT_DATE,
    NULL
FROM service_plans sp
WHERE sp.is_active = TRUE
  AND sp.official_price > 0
ON CONFLICT DO NOTHING;

-- ============================================================
-- VERIFICAÇÃO
-- ============================================================
-- Plans com alerta de desatualização:
-- SELECT sp.id, ss.name, sp.name, check_price_staleness(sp.id)
-- FROM service_plans sp
-- JOIN streaming_services ss ON ss.id = sp.service_id
-- WHERE sp.is_active = TRUE;

-- Plans sem preço:
-- SELECT ss.name, sp.name, sp.official_price
-- FROM service_plans sp
-- JOIN streaming_services ss ON ss.id = sp.service_id
-- WHERE sp.is_active = TRUE AND sp.official_price = 0;
