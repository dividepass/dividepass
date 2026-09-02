-- ============================================================
-- DIVIDEPASS - ESQUEMA SUPABASE
-- ============================================================
-- Execute este script no SQL Editor do Supabase.
-- As extensões uuid-ossp e pgcrypto já vêm habilitadas no Supabase.
-- ============================================================

-- ----------------------------------------------------------
-- 1. TABELAS DE DOMÍNIO / ENUMS
-- ----------------------------------------------------------
DROP TYPE IF EXISTS user_role CASCADE;
CREATE TYPE user_role AS ENUM ('admin', 'user');

DROP TYPE IF EXISTS user_status CASCADE;
CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending', 'suspended');

DROP TYPE IF EXISTS payment_method CASCADE;
CREATE TYPE payment_method AS ENUM ('pix', 'credit_card', 'bank_slip');

DROP TYPE IF EXISTS payment_status CASCADE;
CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled');

DROP TYPE IF EXISTS subscription_status CASCADE;
CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'cancelled', 'expired', 'pending');

DROP TYPE IF EXISTS ticket_status CASCADE;
CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');

DROP TYPE IF EXISTS ticket_priority CASCADE;
CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent');

DROP TYPE IF EXISTS announcement_type CASCADE;
CREATE TYPE announcement_type AS ENUM ('info', 'warning', 'success', 'urgent');

DROP TYPE IF EXISTS announcement_status CASCADE;
CREATE TYPE announcement_status AS ENUM ('draft', 'published', 'archived');

DROP TYPE IF EXISTS log_action CASCADE;
CREATE TYPE log_action AS ENUM ('create', 'update', 'delete', 'view', 'login', 'logout', 'payment');

-- ----------------------------------------------------------
-- 2. TABELAS PRINCIPAIS
-- ----------------------------------------------------------

CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(150) NOT NULL,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    phone           VARCHAR(20),
    cpf             VARCHAR(14),
    marketing_source TEXT,
    marketing_gclid TEXT,
    marketing_utm_source TEXT,
    marketing_utm_medium TEXT,
    marketing_utm_campaign TEXT,
    marketing_utm_term TEXT,
    marketing_utm_content TEXT,
    marketing_captured_at TIMESTAMPTZ,
    role            user_role NOT NULL DEFAULT 'user',
    status          user_status NOT NULL DEFAULT 'pending',
    email_verified  BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE password_resets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE streaming_services (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    full_name       VARCHAR(200) NOT NULL,
    color           VARCHAR(7) NOT NULL DEFAULT '#000000',
    icon            VARCHAR(10),
    description     TEXT,
    official_price  DECIMAL(10,2),
    max_group_size  INTEGER NOT NULL DEFAULT 4,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE master_accounts (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    password        VARCHAR(255) NOT NULL,
    cost            DECIMAL(10,2) NOT NULL,
    due_day         INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    recovery_email  VARCHAR(255),
    imap_server     VARCHAR(255),
    imap_password   VARCHAR(255),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    name            VARCHAR(200) NOT NULL,
    price_per_slot  DECIMAL(10,2) NOT NULL,
    max_size        INTEGER NOT NULL DEFAULT 4,
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_price_positive CHECK (price_per_slot > 0),
    CONSTRAINT chk_max_size CHECK (max_size > 0)
);

CREATE TABLE group_credentials (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id            UUID NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
    login_email         VARCHAR(255) NOT NULL,
    login_password      VARCHAR(255) NOT NULL,
    profile_assignment  VARCHAR(100),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE group_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_name    VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE user_subscriptions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    status          subscription_status NOT NULL DEFAULT 'active',
    payment_method  TEXT,
    started_at      DATE NOT NULL DEFAULT CURRENT_DATE,
    expires_at      DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, group_id)
);

CREATE TABLE payments (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id     UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
    group_id            UUID REFERENCES groups(id) ON DELETE SET NULL,
    amount              DECIMAL(10,2) NOT NULL,
    method              payment_method NOT NULL,
    payment_type        TEXT,
    gateway             TEXT DEFAULT 'mercadopago',
    status              payment_status NOT NULL DEFAULT 'pending',
    transaction_code    VARCHAR(255),
    notes               TEXT,
    due_date            DATE,
    paid_at             TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    amount          DECIMAL(10,2) NOT NULL,
    due_date        DATE NOT NULL,
    status          payment_status NOT NULL DEFAULT 'pending',
    gateway_transaction_id TEXT,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE support_tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject         VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    status          ticket_status NOT NULL DEFAULT 'open',
    priority        ticket_priority NOT NULL DEFAULT 'medium',
    resolved_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ticket_replies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE announcements (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title           VARCHAR(255) NOT NULL,
    message         TEXT NOT NULL,
    type            announcement_type NOT NULL DEFAULT 'info',
    status          announcement_status NOT NULL DEFAULT 'draft',
    starts_at       TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE verification_pins (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    code            VARCHAR(20) NOT NULL,
    source_email    VARCHAR(255),
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          log_action NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       UUID,
    description     TEXT,
    ip_address      TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------
-- 3. ÍNDICES
-- ----------------------------------------------------------
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

CREATE INDEX idx_groups_service ON groups(service_id);
CREATE INDEX idx_groups_status ON groups(status);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user ON group_members(user_id);

CREATE INDEX idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX idx_user_subscriptions_service ON user_subscriptions(service_id);
CREATE INDEX idx_user_subscriptions_group ON user_subscriptions(group_id);
CREATE INDEX idx_user_subscriptions_status ON user_subscriptions(status);

CREATE INDEX idx_payments_user ON payments(user_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_subscription ON payments(subscription_id);

CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE INDEX idx_invoices_status ON invoices(status);

CREATE INDEX idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);

CREATE INDEX idx_verification_pins_group ON verification_pins(group_id);
CREATE INDEX idx_verification_pins_created ON verification_pins(created_at DESC);

CREATE INDEX idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX idx_activity_logs_created ON activity_logs(created_at DESC);

-- ----------------------------------------------------------
-- 4. VIEWS
-- ----------------------------------------------------------
CREATE OR REPLACE VIEW v_group_spots AS
SELECT
    g.id AS group_id,
    g.service_id,
    g.name AS group_name,
    g.max_size,
    g.price_per_slot,
    COUNT(gm.id) AS occupied_spots,
    (g.max_size - COUNT(gm.id)) AS available_spots,
    CASE
        WHEN COUNT(gm.id) >= g.max_size THEN TRUE
        ELSE FALSE
    END AS is_full
FROM groups g
LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.status = 'active'
GROUP BY g.id, g.service_id, g.name, g.max_size, g.price_per_slot;

CREATE OR REPLACE VIEW v_admin_financial_summary AS
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid') AS total_revenue,
    (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS total_cost,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid')
        - (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS net_profit,
    (SELECT COUNT(*) FROM users WHERE role = 'user' AND status = 'active') AS active_users;

CREATE OR REPLACE VIEW v_user_active_services AS
SELECT
    us.user_id,
    us.id AS subscription_id,
    g.id AS group_id,
    s.id AS service_id,
    s.name AS service_name,
    s.full_name AS service_full_name,
    s.color AS service_color,
    s.icon AS service_icon,
    g.name AS group_name,
    g.price_per_slot,
    gc.login_email,
    gc.login_password,
    gc.profile_assignment,
    us.started_at,
    us.expires_at
FROM user_subscriptions us
JOIN groups g ON g.id = us.group_id
JOIN streaming_services s ON s.id = us.service_id
LEFT JOIN group_credentials gc ON gc.group_id = g.id
WHERE us.status = 'active';

CREATE OR REPLACE VIEW v_tickets_with_last_reply AS
SELECT
    t.*,
    u.name AS user_name,
    u.email AS user_email,
    MAX(tr.created_at) AS last_reply_at
FROM support_tickets t
JOIN users u ON u.id = t.user_id
LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
GROUP BY t.id, u.name, u.email;

-- ----------------------------------------------------------
-- 5. FUNÇÕES E TRIGGERS
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_streaming_services_updated_at BEFORE UPDATE ON streaming_services
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_master_accounts_updated_at BEFORE UPDATE ON master_accounts
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON groups
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_group_credentials_updated_at BEFORE UPDATE ON group_credentials
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_group_members_updated_at BEFORE UPDATE ON group_members
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_user_subscriptions_updated_at BEFORE UPDATE ON user_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON support_tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON announcements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE OR REPLACE FUNCTION check_group_capacity()
RETURNS TRIGGER AS $$
DECLARE
    v_count INTEGER;
    v_max INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count
    FROM group_members
    WHERE group_id = NEW.group_id AND status = 'active';

    SELECT max_size INTO v_max
    FROM groups
    WHERE id = NEW.group_id;

    IF v_count >= v_max THEN
        RAISE EXCEPTION 'Grupo está cheio. Capacidade máxima: %', v_max;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_group_capacity
    BEFORE INSERT ON group_members
    FOR EACH ROW EXECUTE FUNCTION check_group_capacity();

CREATE OR REPLACE FUNCTION log_payment_activity()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'paid' AND (OLD.status IS NULL OR OLD.status != 'paid') THEN
        INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description)
        VALUES (NEW.user_id, 'payment', 'payment', NEW.id, 'Pagamento confirmado');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_payment
    AFTER UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION log_payment_activity();

-- ----------------------------------------------------------
-- 6. ROW LEVEL SECURITY (RLS) - POLÍTICAS BÁSICAS
-- ----------------------------------------------------------
-- IMPORTANTE: Ative o RLS nas tabelas e configure as policies
-- conforme sua regra de negócio. Abaixo estão exemplos iniciais.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;

-- Usuários podem ver/editar apenas seu próprio perfil
CREATE POLICY "Usuários veem seu próprio perfil"
    ON users FOR SELECT
    USING (auth.uid() = id);

-- Admins veem todos os usuários
CREATE POLICY "Admins veem todos os usuários"
    ON users FOR ALL
    USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Donos veem os perfis dos membros dos grupos que administram
CREATE POLICY "Donos veem perfis dos grupos"
    ON users FOR SELECT
    USING (
        auth.uid() = id
        OR EXISTS (
            SELECT 1
            FROM group_members gm
            JOIN groups g ON g.id = gm.group_id
            WHERE gm.user_id = users.id
              AND g.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1
            FROM user_subscriptions us
            JOIN groups g ON g.id = us.group_id
            WHERE us.user_id = users.id
              AND g.owner_id = auth.uid()
        )
    );

-- Usuários veem apenas seus próprios grupos
CREATE POLICY "Usuários veem seus grupos"
    ON group_members FOR SELECT
    USING (user_id = auth.uid());

-- Donos veem os membros dos grupos que administram
CREATE POLICY "Donos veem membros do grupo"
    ON group_members FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = group_members.group_id
          AND g.owner_id = auth.uid()
    ));

-- Usuários veem apenas suas próprias assinaturas
CREATE POLICY "Usuários veem suas assinaturas"
    ON user_subscriptions FOR SELECT
    USING (user_id = auth.uid());

-- Donos veem as assinaturas dos seus grupos
CREATE POLICY "Donos veem assinaturas do grupo"
    ON user_subscriptions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = user_subscriptions.group_id
          AND g.owner_id = auth.uid()
    ));

-- Usuários veem apenas seus próprios pagamentos
CREATE POLICY "Usuários veem seus pagamentos"
    ON payments FOR SELECT
    USING (user_id = auth.uid());

-- Donos veem os pagamentos dos seus grupos
CREATE POLICY "Donos veem pagamentos do grupo"
    ON payments FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = payments.group_id
              AND g.owner_id = auth.uid()
        )
    );

-- Usuários veem apenas suas próprias faturas
CREATE POLICY "Usuários veem suas faturas"
    ON invoices FOR SELECT
    USING (user_id = auth.uid());

-- Usuários veem apenas seus próprios tickets
CREATE POLICY "Usuários veem seus tickets"
    ON support_tickets FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "Usuários veem respostas dos seus tickets"
    ON ticket_replies FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM support_tickets t WHERE t.id = ticket_replies.ticket_id AND t.user_id = auth.uid()
    ));

-- Tabelas públicas de leitura
ALTER TABLE streaming_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Serviços públicos" ON streaming_services FOR SELECT USING (true);
CREATE POLICY "Grupos públicos" ON groups FOR SELECT USING (true);
CREATE POLICY "Avisos publicados" ON announcements FOR SELECT USING (status = 'published');

-- ----------------------------------------------------------
-- 7. SEED DATA
-- ----------------------------------------------------------
INSERT INTO users (id, name, email, phone, password_hash, role, status, email_verified, created_at)
VALUES
    (uuid_generate_v4(), 'Administrador', 'admin@dividepass.com', '+55 11 99999-0001', crypt('admin123', gen_salt('bf')), 'admin', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'João da Silva', 'joao.rateio@dividepass.com', '+55 11 99999-0002', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Maria Souza', 'maria@email.com', '+55 11 99999-0003', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Pedro Santos', 'pedro@email.com', '+55 11 99999-0004', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Ana Oliveira', 'ana@email.com', '+55 11 99999-0005', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Carlos Eduardo', 'carlos@email.com', '+55 11 99999-0006', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW());

INSERT INTO streaming_services (id, name, full_name, color, icon, description, official_price, max_group_size, status)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'Netflix', 'Netflix Premium', '#E50914', 'N', 'Plano Premium Ultra HD', 55.90, 4, 'active'),
    ('22222222-2222-2222-2222-222222222222', 'Spotify', 'Spotify Family', '#1DB954', 'S', 'Plano Família', 34.90, 6, 'active'),
    ('33333333-3333-3333-3333-333333333333', 'Disney+', 'Disney+ Premium', '#113CCF', 'D', 'Disney+ sem anúncios', 43.90, 4, 'active'),
    ('44444444-4444-4444-4444-444444444444', 'Max', 'Max (HBO Max)', '#002BE7', 'M', 'Max Padrão', 39.90, 4, 'active'),
    ('55555555-5555-5555-5555-555555555555', 'Prime Video', 'Prime Video', '#00A8E1', 'P', 'Amazon Prime Video', 19.90, 3, 'active'),
    ('66666666-6666-6666-6666-666666666666', 'YouTube Premium', 'YouTube Premium', '#FF0000', 'Y', 'YouTube sem anúncios', 32.00, 5, 'active'),
    ('77777777-7777-7777-7777-777777777777', 'Globoplay', 'Globoplay + Canais', '#ED1C24', 'G', 'Globoplay com canais', 54.90, 4, 'active'),
    ('88888888-8888-8888-8888-888888888888', 'Crunchyroll', 'Crunchyroll Mega Fan', '#F47521', 'C', 'Crunchyroll Mega Fan', 37.90, 4, 'active');

INSERT INTO master_accounts (service_id, email, password, cost, due_day, status)
VALUES
    ('11111111-1111-1111-1111-111111111111', 'net1@meusaas.com', 'SenhaNetflix123', 55.90, 10, 'active'),
    ('22222222-2222-2222-2222-222222222222', 'spot1@meusaas.com', 'SenhaSpotify123', 34.90, 5, 'active'),
    ('33333333-3333-3333-3333-333333333333', 'disney1@meusaas.com', 'SenhaDisney123', 43.90, 15, 'active'),
    ('44444444-4444-4444-4444-444444444444', 'max1@meusaas.com', 'SenhaMax123', 39.90, 12, 'active'),
    ('55555555-5555-5555-5555-555555555555', 'prime1@meusaas.com', 'SenhaPrime123', 19.90, 20, 'active');

INSERT INTO groups (id, service_id, name, price_per_slot, max_size, status)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Netflix - Grupo A', 12.90, 4, 'open'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Netflix - Grupo B', 12.90, 4, 'open'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Spotify - Família 1', 8.90, 6, 'open'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 'Disney+ - Grupo 1', 9.90, 4, 'open'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444', 'Max - Grupo A', 11.90, 4, 'open'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'Prime - Grupo 1', 10.90, 3, 'open'),
    ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'YouTube - Grupo 1', 8.90, 5, 'open'),
    ('11111111-1111-1111-1111-111111111112', '77777777-7777-7777-7777-777777777777', 'Globoplay - Grupo 1', 9.90, 4, 'open'),
    ('22222222-2222-2222-2222-222222222223', '88888888-8888-8888-8888-888888888888', 'Crunchyroll - Grupo 1', 7.90, 4, 'open');

INSERT INTO group_credentials (group_id, login_email, login_password, profile_assignment)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'netflix.grupo.a@dividepass.com', 'NxGroupA2026!', 'Tela 2'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'netflix.grupo.b@dividepass.com', 'NxGroupB2026!', 'Tela 1'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'spotify.familia1@dividepass.com', 'SpotFam1!', 'João (Convite)'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'disney.grupo1@dividepass.com', 'DsnGroup1!', 'Perfil 1'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'max.grupo.a@dividepass.com', 'MaxGroupA!', 'Perfil 4'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', 'prime.grupo1@dividepass.com', 'PrimeG1!', 'Perfil 1'),
    ('00000000-0000-0000-0000-000000000000', 'youtube.grupo1@dividepass.com', 'YtGroup1!', 'Perfil 1'),
    ('11111111-1111-1111-1111-111111111112', 'globoplay.grupo1@dividepass.com', 'GloboG1!', 'Perfil 1'),
    ('22222222-2222-2222-2222-222222222223', 'crunchy.grupo1@dividepass.com', 'CrunchG1!', 'Perfil 1');

-- Membros, assinaturas, pagamentos e demais seeds gerados via script Python/Node
-- ou manualmente no SQL Editor do Supabase devido à dependência de UUIDs gerados.
-- Recomenda-se usar a API do Supabase para popular estes dados após a criação do schema.

-- ----------------------------------------------------------
-- 8. COMENTÁRIOS SOBRE CRUDS POR TELA
-- ----------------------------------------------------------
-- Login/Register/ForgotPassword -> users, password_resets
-- UserDashboard                 -> user_subscriptions, payments, streaming_services
-- Catalog                       -> streaming_services, groups, v_group_spots
-- Checkout                      -> group_members, user_subscriptions, payments
-- MyCredentials/ServiceCredentials -> v_user_active_services
-- Billing                       -> payments, invoices
-- AdminDashboard                -> v_admin_financial_summary, activity_logs
-- Admin/Users                   -> users
-- Admin/Subscriptions           -> master_accounts
-- Admin/Groups                  -> groups, group_members, v_group_spots
-- Admin/Credentials             -> master_accounts, group_credentials
-- Admin/Support                 -> support_tickets, ticket_replies, v_tickets_with_last_reply
-- Admin/Announcements           -> announcements
