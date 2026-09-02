-- ============================================================
-- MIGRATION: Eventos da plataforma + notificações enriquecidas
-- ============================================================

-- Tabela de eventos da plataforma (visão admin)
CREATE TABLE IF NOT EXISTS platform_events (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type  VARCHAR(50) NOT NULL,
    title       VARCHAR(255) NOT NULL,
    message     TEXT,
    metadata    JSONB DEFAULT '{}',
    created_by  UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_platform_events_type ON platform_events(event_type);
CREATE INDEX idx_platform_events_created ON platform_events(created_at DESC);

-- RLS: apenas admin lê
ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin can read platform_events"
    ON platform_events FOR SELECT
    USING (public.is_admin());

CREATE POLICY "Service role can insert platform_events"
    ON platform_events FOR INSERT
    WITH CHECK (true);

-- Enriquecer tabela notifications com event_type e metadata
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS event_type VARCHAR(50) DEFAULT 'info';
ALTER TABLE notifications ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
