-- ============================================================
-- DIVIDEPASS - ESQUEMA COMPLETO DO BANCO DE DADOS
-- ============================================================
-- SGBD: PostgreSQL 15+
-- Este script cria todas as tabelas, relacionamentos, índices,
-- seeds e views necessárias para o funcionamento do DividePass.
-- ============================================================

-- ----------------------------------------------------------
-- 1. EXTENSÕES
-- ----------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------
-- 2. TABELAS DE DOMÍNIO / ENUMS (TIPOS PERSONALIZADOS)
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
-- 3. TABELAS PRINCIPAIS
-- ----------------------------------------------------------

-- 3.1 Usuários
-- CRUDs: Login, Register, ForgotPassword, Admin/Users, UserLayout
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

-- 3.2 Recuperação de Senha
-- CRUD: ForgotPassword
CREATE TABLE password_resets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token           VARCHAR(255) NOT NULL UNIQUE,
    expires_at      TIMESTAMPTZ NOT NULL,
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.3 Serviços de Streaming
-- CRUDs: Catalog, Admin/Subscriptions, Admin/Groups
CREATE TABLE streaming_services (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(100) NOT NULL,
    full_name       VARCHAR(200) NOT NULL,
    color           VARCHAR(7) NOT NULL DEFAULT '#000000',
    icon            VARCHAR(10),
    icon_url        TEXT,
    slug            TEXT UNIQUE,
    description     TEXT,
    official_price  DECIMAL(10,2),
    max_group_size  INTEGER NOT NULL DEFAULT 4,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.4 Contas Matrizes (assinaturas que o SaaS paga)
-- CRUD: Admin/Subscriptions, Admin/Credentials
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

-- 3.5 Grupos de Rateio
-- CRUDs: Catalog, Admin/Groups, Checkout
CREATE TABLE groups (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id      UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    owner_id        UUID REFERENCES users(id) ON DELETE SET NULL,
    name            VARCHAR(200) NOT NULL,
    price_per_slot  DECIMAL(10,2) NOT NULL,
    billing_cycle   VARCHAR(20) NOT NULL DEFAULT 'monthly'
                        CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
    cycle_discount  DECIMAL(5,2) NOT NULL DEFAULT 0
                        CHECK (cycle_discount >= 0 AND cycle_discount <= 100),
    max_size        INTEGER NOT NULL DEFAULT 4,
    cover_url       TEXT,
    verified        BOOLEAN NOT NULL DEFAULT FALSE,
    rules           TEXT,
    tags            TEXT[] DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'open',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_price_positive CHECK (price_per_slot > 0),
    CONSTRAINT chk_max_size CHECK (max_size > 0)
);

-- 3.6 Credenciais do Grupo
-- CRUD: Admin/Credentials, ServiceCredentials (read only)
CREATE TABLE group_credentials (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id            UUID NOT NULL UNIQUE REFERENCES groups(id) ON DELETE CASCADE,
    login_email         VARCHAR(255) NOT NULL,
    login_password      VARCHAR(255) NOT NULL,
    profile_assignment  VARCHAR(100),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.7 Membros do Grupo
-- CRUD: Checkout (insert), Admin/Groups (read/update/delete)
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

-- 3.8 Assinaturas do Usuário
-- CRUD: UserDashboard, MyCredentials, ServiceCredentials
CREATE TABLE user_subscriptions (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id                    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    service_id                  UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    status                      subscription_status NOT NULL DEFAULT 'active',
    billing_cycle               VARCHAR(20) NOT NULL DEFAULT 'monthly'
                                    CHECK (billing_cycle IN ('monthly', 'quarterly', 'semiannual', 'annual')),
    payment_method              TEXT,
    started_at                  DATE NOT NULL DEFAULT CURRENT_DATE,
    expires_at                  DATE,
    amount                      DECIMAL(10,2),
    mercado_pago_subscription_id TEXT,
    mercado_pago_preference_id  TEXT,
    mercado_pago_status         TEXT,
    external_reference          TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, group_id)
);

-- 3.9 Pagamentos
-- CRUD: Checkout, Billing, Admin/Dashboard
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

-- 3.10 Faturas Mensais
-- CRUD: Billing
CREATE TABLE invoices (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id        UUID REFERENCES groups(id) ON DELETE SET NULL,
    amount          DECIMAL(10,2) NOT NULL,
    due_date        DATE NOT NULL,
    status          payment_status NOT NULL DEFAULT 'pending',
    gateway_transaction_id TEXT,
    paid_at         TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.11 Tickets de Suporte
-- CRUD: Admin/Support
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

-- 3.12 Respostas dos Tickets
-- CRUD: Admin/Support
CREATE TABLE ticket_replies (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id       UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message         TEXT NOT NULL,
    is_internal     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.13 Avisos Globais
-- CRUD: Admin/Announcements
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

-- 3.14 Códigos PIN de Verificação
-- CRUD: ServiceCredentials (fetch PIN)
CREATE TABLE verification_pins (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    code            VARCHAR(20) NOT NULL,
    source_email    VARCHAR(255),
    used            BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.15 Logs de Atividade
-- CRUD: Admin/Dashboard (atividades recentes)
CREATE TABLE activity_logs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID REFERENCES users(id) ON DELETE SET NULL,
    action          log_action NOT NULL,
    entity_type     VARCHAR(50),
    entity_id       UUID,
    description     TEXT,
    ip_address      INET,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3.16 Notificações do Usuário
-- CRUD: notificações geradas pelo sistema (inadimplência, avisos, etc.)
CREATE TABLE notifications (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title       VARCHAR(255) NOT NULL,
    message     TEXT NOT NULL,
    read        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------
-- 4. ÍNDICES
-- ----------------------------------------------------------
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_status ON users(status);

CREATE INDEX idx_password_resets_token ON password_resets(token);
CREATE INDEX idx_password_resets_user ON password_resets(user_id);

CREATE INDEX idx_groups_service ON groups(service_id);
CREATE INDEX idx_groups_status ON groups(status);
CREATE INDEX idx_groups_owner ON groups(owner_id);

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

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(read);

-- ----------------------------------------------------------
-- 5. VIEWS (CONSULTAS PRÉ-DEFINIDAS)
-- ----------------------------------------------------------

-- View: Vagas disponíveis por grupo
CREATE OR REPLACE VIEW v_group_spots AS
SELECT
    g.id AS group_id,
    g.service_id,
    g.name AS group_name,
    g.max_size,
    g.price_per_slot,
    g.billing_cycle,
    g.cycle_discount,
    COUNT(gm.id) AS occupied_spots,
    (g.max_size - COUNT(gm.id)) AS available_spots,
    CASE
        WHEN COUNT(gm.id) >= g.max_size THEN TRUE
        ELSE FALSE
    END AS is_full
FROM groups g
LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.status = 'active'
GROUP BY g.id, g.service_id, g.name, g.max_size, g.price_per_slot, g.billing_cycle, g.cycle_discount;

-- View: Resumo financeiro do admin
CREATE OR REPLACE VIEW v_admin_financial_summary AS
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid') AS total_revenue,
    (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS total_cost,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid')
        - (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS net_profit,
    (SELECT COUNT(*) FROM users WHERE role = 'user' AND status = 'active') AS active_users;

-- View: Serviços ativos por usuário com credenciais
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

-- View: Tickets com última resposta
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
-- 6. FUNÇÕES E TRIGGERS
-- ----------------------------------------------------------

-- Trigger: Atualiza updated_at automaticamente
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

CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Função: Verifica se grupo está cheio antes de inserir membro
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

-- Função: Registra log de pagamento
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
-- 7. SEED DATA (DADOS INICIAIS)
-- ----------------------------------------------------------

-- Usuários
INSERT INTO users (id, name, email, password_hash, role, status, email_verified, created_at)
VALUES
    (uuid_generate_v4(), 'Administrador', 'admin@dividepass.com', crypt('admin123', gen_salt('bf')), 'admin', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'João da Silva', 'joao.rateio@dividepass.com', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Maria Souza', 'maria@email.com', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Pedro Santos', 'pedro@email.com', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Ana Oliveira', 'ana@email.com', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW()),
    (uuid_generate_v4(), 'Carlos Eduardo', 'carlos@email.com', crypt('user123', gen_salt('bf')), 'user', 'active', TRUE, NOW());

-- Serviços de Streaming
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

-- Contas Matrizes (fixos para facilitar seeds)
DO $$
DECLARE
    netflix_id UUID := '11111111-1111-1111-1111-111111111111';
    spotify_id UUID := '22222222-2222-2222-2222-222222222222';
    disney_id UUID := '33333333-3333-3333-3333-333333333333';
    max_id UUID := '44444444-4444-4444-4444-444444444444';
    prime_id UUID := '55555555-5555-5555-5555-555555555555';
BEGIN
    INSERT INTO master_accounts (service_id, email, password, cost, due_day, status)
    VALUES
        (netflix_id, 'net1@meusaas.com', 'SenhaNetflix123', 55.90, 10, 'active'),
        (spotify_id, 'spot1@meusaas.com', 'SenhaSpotify123', 34.90, 5, 'active'),
        (disney_id, 'disney1@meusaas.com', 'SenhaDisney123', 43.90, 15, 'active'),
        (max_id, 'max1@meusaas.com', 'SenhaMax123', 39.90, 12, 'active'),
        (prime_id, 'prime1@meusaas.com', 'SenhaPrime123', 19.90, 20, 'active');
END $$;

-- Grupos (IDs fixos para seeds de relacionamentos)
INSERT INTO groups (id, service_id, name, price_per_slot, billing_cycle, cycle_discount, max_size, status)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Netflix - Grupo A', 12.90, 'monthly', 0, 4, 'open'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'Netflix - Grupo B', 12.90, 'monthly', 0, 4, 'open'),
    ('cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'Spotify - Família 1', 8.90, 'monthly', 0, 6, 'open'),
    ('dddddddd-dddd-dddd-dddd-dddddddddddd', '33333333-3333-3333-3333-333333333333', 'Disney+ - Grupo 1', 9.90, 'monthly', 0, 4, 'open'),
    ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '44444444-4444-4444-4444-444444444444', 'Max - Grupo A', 11.90, 'monthly', 0, 4, 'open'),
    ('ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'Prime - Grupo 1', 10.90, 'monthly', 0, 3, 'open'),
    ('00000000-0000-0000-0000-000000000000', '66666666-6666-6666-6666-666666666666', 'YouTube - Grupo 1', 8.90, 'monthly', 0, 5, 'open'),
    ('11111111-1111-1111-1111-111111111112', '77777777-7777-7777-7777-777777777777', 'Globoplay - Grupo 1', 9.90, 'monthly', 0, 4, 'open'),
    ('22222222-2222-2222-2222-222222222223', '88888888-8888-8888-8888-888888888888', 'Crunchyroll - Grupo 1', 7.90, 'monthly', 0, 4, 'open');

-- Credenciais dos Grupos
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

-- Membros dos Grupos (usando IDs de usuário gerados dinamicamente)
DO $$
DECLARE
    joao_id UUID;
    maria_id UUID;
    pedro_id UUID;
    ana_id UUID;
    carlos_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';
    SELECT id INTO maria_id FROM users WHERE email = 'maria@email.com';
    SELECT id INTO pedro_id FROM users WHERE email = 'pedro@email.com';
    SELECT id INTO ana_id FROM users WHERE email = 'ana@email.com';
    SELECT id INTO carlos_id FROM users WHERE email = 'carlos@email.com';

    INSERT INTO group_members (group_id, user_id, profile_name, status, joined_at)
    VALUES
        -- Netflix Grupo A (cheio)
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', joao_id, 'Tela 1', 'active', NOW() - INTERVAL '30 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', maria_id, 'Tela 2', 'active', NOW() - INTERVAL '25 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pedro_id, 'Tela 3', 'active', NOW() - INTERVAL '20 days'),
        ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ana_id, 'Tela 4', 'active', NOW() - INTERVAL '15 days'),

        -- Netflix Grupo B (1 vaga ocupada)
        ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', carlos_id, 'Tela 1', 'active', NOW() - INTERVAL '10 days'),

        -- Spotify Família 1 (2 vagas ocupadas)
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', joao_id, 'João', 'active', NOW() - INTERVAL '45 days'),
        ('cccccccc-cccc-cccc-cccc-cccccccccccc', carlos_id, 'Carlos', 'active', NOW() - INTERVAL '30 days'),

        -- Prime Grupo 1 (1 vaga ocupada)
        ('ffffffff-ffff-ffff-ffff-ffffffffffff', joao_id, 'Perfil 1', 'active', NOW() - INTERVAL '15 days');
END $$;

-- Assinaturas dos Usuários
DO $$
DECLARE
    joao_id UUID;
    carlos_id UUID;
    maria_id UUID;
    pedro_id UUID;
    ana_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';
    SELECT id INTO carlos_id FROM users WHERE email = 'carlos@email.com';
    SELECT id INTO maria_id FROM users WHERE email = 'maria@email.com';
    SELECT id INTO pedro_id FROM users WHERE email = 'pedro@email.com';
    SELECT id INTO ana_id FROM users WHERE email = 'ana@email.com';

    INSERT INTO user_subscriptions (user_id, group_id, service_id, status, started_at, expires_at)
    VALUES
        (joao_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (joao_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'active', '2026-05-15', '2026-07-15'),
        (joao_id, 'ffffffff-ffff-ffff-ffff-ffffffffffff', '55555555-5555-5555-5555-555555555555', 'active', '2026-06-10', '2026-07-10'),
        (maria_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (pedro_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (ana_id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-01', '2026-07-01'),
        (carlos_id, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '11111111-1111-1111-1111-111111111111', 'active', '2026-06-10', '2026-07-10'),
        (carlos_id, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '22222222-2222-2222-2222-222222222222', 'active', '2026-05-15', '2026-07-15');
END $$;

-- Pagamentos
DO $$
DECLARE
    joao_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';

    INSERT INTO payments (user_id, amount, method, status, transaction_code, paid_at, created_at)
    VALUES
        (joao_id, 12.90, 'pix', 'paid', 'PIX123456', NOW() - INTERVAL '30 days', NOW() - INTERVAL '30 days'),
        (joao_id, 8.90, 'pix', 'paid', 'PIX789012', NOW() - INTERVAL '45 days', NOW() - INTERVAL '45 days'),
        (joao_id, 10.90, 'credit_card', 'paid', 'CARD345678', NOW() - INTERVAL '15 days', NOW() - INTERVAL '15 days');
END $$;

-- Faturas
DO $$
DECLARE
    joao_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';

    INSERT INTO invoices (user_id, amount, due_date, status)
    VALUES
        (joao_id, 45.90, '2026-07-15', 'pending'),
        (joao_id, 45.90, '2026-06-15', 'paid'),
        (joao_id, 45.90, '2026-05-15', 'paid');
END $$;

-- Tickets de Suporte
DO $$
DECLARE
    joao_id UUID;
    maria_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';
    SELECT id INTO maria_id FROM users WHERE email = 'maria@email.com';

    INSERT INTO support_tickets (user_id, subject, message, status, priority)
    VALUES
        (joao_id, 'Senha da Netflix não funciona', 'A senha fornecida está dando erro de login.', 'open', 'high'),
        (maria_id, 'Dúvida sobre renovação', 'Quando será cobrado novamente?', 'resolved', 'medium');
END $$;

-- Avisos Globais
INSERT INTO announcements (title, message, type, status, starts_at, expires_at)
VALUES
    ('Manutenção programada na Netflix', 'A Netflix passará por manutenção no próximo domingo.', 'info', 'published', NOW(), NOW() + INTERVAL '7 days'),
    ('Novo serviço disponível', 'Agora você pode assinar Crunchyroll pelo DividePass.', 'success', 'published', NOW(), NOW() + INTERVAL '30 days');

-- Logs de Atividade
DO $$
DECLARE
    joao_id UUID;
    maria_id UUID;
BEGIN
    SELECT id INTO joao_id FROM users WHERE email = 'joao.rateio@dividepass.com';
    SELECT id INTO maria_id FROM users WHERE email = 'maria@email.com';

    INSERT INTO activity_logs (user_id, action, entity_type, entity_id, description)
    VALUES
        (maria_id, 'create', 'user', maria_id, 'Novo usuário se cadastrou'),
        (joao_id, 'payment', 'payment', NULL, 'Pagamento confirmado (Pix)'),
        (NULL, 'update', 'subscription', NULL, 'Assinatura Netflix #04 vence em 2 dias');
END $$;

-- Códigos PIN
INSERT INTO verification_pins (group_id, code, source_email, used, created_at)
VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '123456', 'netflix@account.com', FALSE, NOW() - INTERVAL '5 minutes');

-- ----------------------------------------------------------
-- 8. EXEMPLOS DE QUERIES (DOCUMENTAÇÃO DOS CRUDS)
-- ----------------------------------------------------------

-- USER DASHBOARD: Listar serviços ativos do usuário
-- SELECT * FROM v_user_active_services WHERE user_id = ?;

-- USER CATALOG: Listar grupos disponíveis de um serviço
-- SELECT * FROM v_group_spots WHERE service_id = ? AND is_full = FALSE;

-- CHECKOUT: Inserir membro no grupo (a trigger valida capacidade)
-- INSERT INTO group_members (group_id, user_id, profile_name) VALUES (?, ?, ?);
-- INSERT INTO user_subscriptions (user_id, group_id, service_id, expires_at) VALUES (?, ?, ?, ?);
-- INSERT INTO payments (user_id, subscription_id, amount, method, status, paid_at) VALUES (?, ?, ?, ?, 'paid', NOW());

-- USER CREDENTIALS: Ver credenciais apenas se tiver assinatura ativa
-- SELECT * FROM v_user_active_services WHERE user_id = ? AND service_id = ?;

-- ADMIN USERS: CRUD completo de usuários
-- SELECT * FROM users WHERE role = 'user';
-- INSERT INTO users (...) VALUES (...);
-- UPDATE users SET status = ? WHERE id = ?;
-- DELETE FROM users WHERE id = ?;

-- ADMIN SUBSCRIPTIONS (MATRIZES): CRUD de contas matrizes
-- SELECT ma.*, s.name AS service_name FROM master_accounts ma JOIN streaming_services s ON s.id = ma.service_id;
-- INSERT INTO master_accounts (...) VALUES (...);
-- UPDATE master_accounts SET cost = ?, due_day = ? WHERE id = ?;

-- ADMIN GROUPS: CRUD de grupos e visualização de membros
-- SELECT * FROM v_group_spots;
-- SELECT gm.*, u.name, u.email FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ?;
-- UPDATE groups SET status = 'closed' WHERE id = ?;

-- ADMIN CREDENTIALS: CRUD de credenciais de grupos
-- SELECT gc.*, g.name AS group_name, s.name AS service_name
-- FROM group_credentials gc
-- JOIN groups g ON g.id = gc.group_id
-- JOIN streaming_services s ON s.id = g.service_id;
-- INSERT INTO group_credentials (...) VALUES (...);
-- UPDATE group_credentials SET login_password = ? WHERE group_id = ?;

-- ADMIN SUPPORT: CRUD de tickets
-- SELECT * FROM v_tickets_with_last_reply WHERE status = 'open';
-- INSERT INTO ticket_replies (ticket_id, user_id, message) VALUES (?, ?, ?);
-- UPDATE support_tickets SET status = 'resolved', resolved_at = NOW() WHERE id = ?;

-- ADMIN ANNOUNCEMENTS: CRUD de avisos
-- SELECT * FROM announcements WHERE status = 'published';
-- INSERT INTO announcements (...) VALUES (...);
-- UPDATE announcements SET status = 'archived' WHERE id = ?;
-- DELETE FROM announcements WHERE id = ?;

-- ADMIN DASHBOARD: Resumo financeiro
-- SELECT * FROM v_admin_financial_summary;
