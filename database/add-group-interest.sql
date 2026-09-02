-- ============================================================
-- MIGRATION: Lista de interesse em grupos + status 'forming'
-- ============================================================

-- Adiciona 'forming' como status válido para grupos
-- (o campo status já existe como VARCHAR, então aceita novos valores)

-- Tabela de lista de interesse
CREATE TABLE IF NOT EXISTS group_interest (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_group_interest_group ON group_interest(group_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_user ON group_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_service ON group_interest(service_id);

-- RLS: usuários veem seu próprio interesse, admin vê todos
ALTER TABLE group_interest ENABLE ROW LEVEL SECURITY;

-- Usuários autenticados podem ver seu próprio interesse
CREATE POLICY "users_own_interest" ON group_interest
    FOR SELECT USING (auth.uid() = user_id);

-- Usuários autenticados podem criar interesse
CREATE POLICY "users_create_interest" ON group_interest
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Usuários autenticados podem deletar seu interesse
CREATE POLICY "users_delete_interest" ON group_interest
    FOR DELETE USING (auth.uid() = user_id);

-- Admin pode ver tudo
CREATE POLICY "admin_all_interest" ON group_interest
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );
