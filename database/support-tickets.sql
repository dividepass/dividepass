-- Support Tickets System
CREATE TABLE IF NOT EXISTS support_tickets (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject     VARCHAR(255) NOT NULL,
    category    VARCHAR(50) NOT NULL DEFAULT 'general',
    status      VARCHAR(20) NOT NULL DEFAULT 'open',
    priority    VARCHAR(20) NOT NULL DEFAULT 'normal',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_messages (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id   UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message     TEXT NOT NULL,
    is_admin    BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_messages_ticket_id ON support_messages(ticket_id);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_support_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
    BEFORE UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION update_support_tickets_updated_at();

-- RLS
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

-- Users see their own tickets
CREATE POLICY "Usuarios veem seus tickets"
    ON support_tickets FOR SELECT
    USING (user_id = auth.uid());

-- Users create their own tickets
CREATE POLICY "Usuarios criam tickets"
    ON support_tickets FOR INSERT
    WITH CHECK (user_id = auth.uid());

-- Users update their own tickets (close)
CREATE POLICY "Usuarios atualizam seus tickets"
    ON support_tickets FOR UPDATE
    USING (user_id = auth.uid());

-- Admins full access on tickets
CREATE POLICY "Admins gerenciam tickets"
    ON support_tickets FOR ALL
    USING (is_admin());

-- Users see messages on their own tickets
CREATE POLICY "Usuarios veem mensagens de seus tickets"
    ON support_messages FOR SELECT
    USING (
        ticket_id IN (
            SELECT id FROM support_tickets WHERE user_id = auth.uid()
        )
        OR is_admin = TRUE
    );

-- Users insert messages on their own tickets
CREATE POLICY "Usuarios enviam mensagens"
    ON support_messages FOR INSERT
    WITH CHECK (
        user_id = auth.uid()
        AND ticket_id IN (
            SELECT id FROM support_tickets WHERE user_id = auth.uid()
        )
    );

-- Admins full access on messages
CREATE POLICY "Admins gerenciam mensagens"
    ON support_messages FOR ALL
    USING (is_admin());
