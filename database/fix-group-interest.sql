-- ============================================================
-- FIX: group_interest - group_id nullable, unique por serviço
-- ============================================================

-- Recriar tabela com group_id nullable e unique por serviço+usuário
DROP TABLE IF EXISTS group_interest;

CREATE TABLE group_interest (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(service_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_group_interest_group ON group_interest(group_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_user ON group_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_service ON group_interest(service_id);

ALTER TABLE group_interest ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_interest" ON group_interest
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "users_create_interest" ON group_interest
    FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "users_update_interest" ON group_interest
    FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "users_delete_interest" ON group_interest
    FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "admin_all_interest" ON group_interest
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );
