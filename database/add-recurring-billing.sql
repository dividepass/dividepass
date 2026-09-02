-- ============================================================
-- MIGRAÇÃO: Sistema de Cobrança Recorrente
-- ============================================================

-- 1. Novo enum para status de cobrança
DO $$ BEGIN
  CREATE TYPE billing_status AS ENUM (
    'pending',      -- agendada
    'processing',   -- em andamento
    'approved',     -- paga com sucesso
    'failed',       -- recusada pelo gateway
    'cancelled'     -- cancelada após 3 falhas
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 2. Novo enum para status de cobrança da assinatura
DO $$ BEGIN
  CREATE TYPE subscription_billing_status AS ENUM (
    'active',       -- cobrando normalmente
    'retrying',     -- em tentativa de cobrança
    'cancelled'     -- cancelada após 3 falhas
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- 3. Tabela billing_cycles (cada linha = uma tentativa de cobrança)
CREATE TABLE IF NOT EXISTS billing_cycles (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id   UUID NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id          UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,

  -- Valor cobrado
  amount            DECIMAL(10,2) NOT NULL,

  -- Controle de cobrança
  charge_date       DATE NOT NULL,                    -- data prevista para cobrança
  attempted_at      TIMESTAMPTZ,                      -- quando tentou cobrar
  completed_at      TIMESTAMPTZ,                      -- quando confirmou sucesso

  -- Status
  status            billing_status NOT NULL DEFAULT 'pending',

  -- Gateway
  gateway           TEXT NOT NULL,
  gateway_transaction_id TEXT,
  gateway_response  JSONB,
  error_message     TEXT,
  error_code        TEXT,

  -- Retry
  attempt_number    INTEGER NOT NULL DEFAULT 1,       -- 1ª, 2ª ou 3ª tentativa
  next_retry_at     TIMESTAMPTZ,                      -- quando tentar novamente (se falhou)

  -- Referência
  invoice_id        UUID REFERENCES invoices(id),

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_billing_cycles_charge_date ON billing_cycles(charge_date);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_status ON billing_cycles(status);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_subscription ON billing_cycles(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_user ON billing_cycles(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_next_retry ON billing_cycles(next_retry_at) WHERE status = 'failed';

-- 4. Tabela billing_logs (audit trail)
CREATE TABLE IF NOT EXISTS billing_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id   UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
  user_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  group_id          UUID REFERENCES groups(id) ON DELETE SET NULL,
  action            TEXT NOT NULL,   -- charge_attempt, charge_success, charge_failed,
                                     -- retry_scheduled, subscription_cancelled, card_updated
  details           JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_logs_subscription ON billing_logs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_logs_action ON billing_logs(action);
CREATE INDEX IF NOT EXISTS idx_billing_logs_created ON billing_logs(created_at);

-- 5. Colunas extras em user_subscriptions
DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN next_charge_at TIMESTAMPTZ;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN retry_count INTEGER DEFAULT 0;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN last_charge_at TIMESTAMPTZ;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN card_id TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN card_last4 TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN card_brand TEXT;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE user_subscriptions ADD COLUMN billing_status subscription_billing_status DEFAULT 'active';
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;

-- 6. RLS para billing_cycles
ALTER TABLE billing_cycles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all billing cycles" ON billing_cycles;
CREATE POLICY "Admins can view all billing cycles"
  ON billing_cycles FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

DROP POLICY IF EXISTS "Users can view own billing cycles" ON billing_cycles;
CREATE POLICY "Users can view own billing cycles"
  ON billing_cycles FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Service role can manage billing cycles" ON billing_cycles;
CREATE POLICY "Service role can manage billing cycles"
  ON billing_cycles FOR ALL
  TO service_role
  USING (true);

-- 7. RLS para billing_logs
ALTER TABLE billing_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all billing logs" ON billing_logs;
CREATE POLICY "Admins can view all billing logs"
  ON billing_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
  );

DROP POLICY IF EXISTS "Service role can manage billing logs" ON billing_logs;
CREATE POLICY "Service role can manage billing logs"
  ON billing_logs FOR ALL
  TO service_role
  USING (true);

-- 8. Função para calcular next_charge_at baseado no ciclo
CREATE OR REPLACE FUNCTION calculate_next_charge(
  p_billing_cycle TEXT,
  p_custom_cycle_months INTEGER DEFAULT NULL
) RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_months INTEGER;
BEGIN
  v_months := CASE p_billing_cycle
    WHEN 'monthly' THEN 1
    WHEN 'quarterly' THEN 3
    WHEN 'semiannual' THEN 6
    WHEN 'annual' THEN 12
    WHEN 'custom' THEN COALESCE(p_custom_cycle_months, 1)
    ELSE 1
  END;

  -- Próximo dia 1 do mês seguinte ao ciclo
  RETURN (DATE_TRUNC('month', CURRENT_DATE) + (v_months || ' months')::INTERVAL)::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql;

-- 9. Função para obter métricas de billing
CREATE OR REPLACE FUNCTION get_billing_metrics(
  p_start_date DATE DEFAULT NULL,
  p_end_date DATE DEFAULT NULL
) RETURNS TABLE (
  total_revenue NUMERIC,
  future_revenue NUMERIC,
  active_subscriptions BIGINT,
  new_subscribers BIGINT,
  cancelled BIGINT,
  retrying BIGINT,
  charges_today BIGINT,
  failures_today BIGINT,
  approval_rate NUMERIC,
  mrr NUMERIC,
  arr NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    -- Receita total no período
    COALESCE(SUM(CASE WHEN bc.status = 'approved' AND bc.completed_at BETWEEN
      COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)
      THEN bc.amount ELSE 0 END), 0) AS total_revenue,

    -- Receita futura (próximas cobranças)
    COALESCE(SUM(CASE WHEN bc.charge_date > CURRENT_DATE AND bc.status = 'pending'
      THEN bc.amount ELSE 0 END), 0) AS future_revenue,

    -- Assinaturas ativas
    (SELECT COUNT(*) FROM user_subscriptions WHERE status = 'active') AS active_subscribers,

    -- Novos assinantes no período
    (SELECT COUNT(*) FROM user_subscriptions WHERE started_at BETWEEN
      COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)) AS new_subscribers,

    -- Canceladas no período
    (SELECT COUNT(*) FROM user_subscriptions WHERE billing_status = 'cancelled' AND updated_at BETWEEN
      COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)) AS cancelled_count,

    -- Em tentativa
    (SELECT COUNT(*) FROM user_subscriptions WHERE billing_status = 'retrying') AS retrying_count,

    -- Cobranças hoje
    (SELECT COUNT(*) FROM billing_cycles WHERE charge_date = CURRENT_DATE) AS charges_today,

    -- Falhas hoje
    (SELECT COUNT(*) FROM billing_cycles WHERE charge_date = CURRENT_DATE AND status = 'failed') AS failures_today,

    -- Taxa de aprovação
    CASE
      WHEN (SELECT COUNT(*) FROM billing_cycles WHERE charge_date BETWEEN
        COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)) > 0
      THEN ROUND(
        (SELECT COUNT(*)::NUMERIC FROM billing_cycles WHERE status = 'approved' AND charge_date BETWEEN
          COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)) /
        (SELECT COUNT(*)::NUMERIC FROM billing_cycles WHERE charge_date BETWEEN
          COALESCE(p_start_date, CURRENT_DATE) AND COALESCE(p_end_date, CURRENT_DATE + 1)) * 100,
        1
      )
      ELSE 0
    END AS approval_rate,

    -- MRR (Monthly Recurring Revenue)
    (SELECT COALESCE(SUM(amount), 0) FROM user_subscriptions
     WHERE status = 'active' AND billing_cycle = 'monthly') AS mrr,

    -- ARR (Annual Recurring Revenue)
    (SELECT COALESCE(SUM(amount), 0) FROM user_subscriptions
     WHERE status = 'active') * 12 AS arr;
END;
$$ LANGUAGE plpgsql;

-- 10. View para dashboard de cobranças do dia
CREATE OR REPLACE VIEW v_billing_today AS
SELECT
  bc.id,
  bc.charge_date,
  bc.amount,
  bc.status,
  bc.attempt_number,
  bc.error_message,
  bc.next_retry_at,
  u.name AS user_name,
  u.email AS user_email,
  g.name AS group_name,
  ss.name AS service_name,
  us.card_last4,
  us.card_brand,
  us.billing_cycle
FROM billing_cycles bc
JOIN users u ON u.id = bc.user_id
JOIN groups g ON g.id = bc.group_id
JOIN streaming_services ss ON ss.id = (SELECT service_id FROM user_subscriptions WHERE id = bc.subscription_id)
JOIN user_subscriptions us ON us.id = bc.subscription_id
WHERE bc.charge_date = CURRENT_DATE
ORDER BY bc.created_at DESC;

-- 11. View para calendário de cobranças
CREATE OR REPLACE VIEW v_billing_calendar AS
SELECT
  bc.charge_date,
  COUNT(*) AS total_charges,
  COUNT(*) FILTER (WHERE bc.status = 'approved') AS approved_count,
  COUNT(*) FILTER (WHERE bc.status = 'failed') AS failed_count,
  COUNT(*) FILTER (WHERE bc.status = 'pending') AS pending_count,
  SUM(bc.amount) AS total_amount,
  SUM(bc.amount) FILTER (WHERE bc.status = 'approved') AS approved_amount,
  SUM(bc.amount) FILTER (WHERE bc.status = 'failed') AS failed_amount
FROM billing_cycles bc
WHERE bc.charge_date >= CURRENT_DATE - INTERVAL '30 days'
  AND bc.charge_date <= CURRENT_DATE + INTERVAL '90 days'
GROUP BY bc.charge_date
ORDER BY bc.charge_date;

-- 12. View para dashboard de falhas
CREATE OR REPLACE VIEW v_billing_failures AS
SELECT
  bc.id AS cycle_id,
  bc.charge_date,
  bc.amount,
  bc.attempt_number,
  bc.error_message,
  bc.error_code,
  bc.next_retry_at,
  bc.created_at AS first_attempt_at,
  bc.updated_at AS last_attempt_at,
  u.id AS user_id,
  u.name AS user_name,
  u.email AS user_email,
  g.id AS group_id,
  g.name AS group_name,
  ss.name AS service_name,
  us.card_last4,
  us.card_brand,
  us.billing_cycle,
  us.gateway AS subscription_gateway
FROM billing_cycles bc
JOIN users u ON u.id = bc.user_id
JOIN groups g ON g.id = bc.group_id
JOIN user_subscriptions us ON us.id = bc.subscription_id
JOIN streaming_services ss ON ss.id = us.service_id
WHERE bc.status = 'failed'
ORDER BY bc.updated_at DESC;

-- 13. Trigger para updated_at em billing_cycles
CREATE OR REPLACE FUNCTION update_billing_cycles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_billing_cycles_updated_at ON billing_cycles;
CREATE TRIGGER trg_billing_cycles_updated_at
  BEFORE UPDATE ON billing_cycles
  FOR EACH ROW
  EXECUTE FUNCTION update_billing_cycles_updated_at();

-- 14. Configurar cron para process-recurring-billing (14:00 UTC = 11:00 BRT)
-- DESCOMENTAR APÓS FAZER DEPLOY DA EDGE FUNCTION:
-- SELECT cron.schedule(
--   'process-recurring-billing',
--   '0 14 * * *',
--   $$SELECT net.http_post(
--     url := (SELECT value FROM app_settings WHERE key = 'supabase_url') || '/functions/v1/process-recurring-billing',
--     headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT value FROM app_settings WHERE key = 'recurring_billing_cron_secret'))
--   )$$
-- );
