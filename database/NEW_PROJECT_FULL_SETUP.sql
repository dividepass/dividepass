-- ============================================================
-- DIVIDEPASS - SCHEMA COMPLETO PARA NOVO PROJETO
-- Cole este código no SQL Editor do novo projeto Supabase
-- Execute em partes se necessário (Dividido em blocos comentados)
-- ============================================================

-- ============================================================
-- BLOCO 1: EXTENSÕES E TIPOS
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enums
DO $$ BEGIN CREATE TYPE user_role AS ENUM ('admin', 'user'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE user_status AS ENUM ('active', 'inactive', 'pending', 'suspended'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_method AS ENUM ('pix', 'credit_card', 'bank_slip'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'failed', 'refunded', 'cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE subscription_status AS ENUM ('active', 'inactive', 'cancelled', 'expired', 'pending'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE ticket_status AS ENUM ('open', 'in_progress', 'resolved', 'closed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE ticket_priority AS ENUM ('low', 'medium', 'high', 'urgent'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE announcement_type AS ENUM ('info', 'warning', 'success', 'urgent'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE announcement_status AS ENUM ('draft', 'published', 'archived'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE log_action AS ENUM ('create', 'update', 'delete', 'view', 'login', 'logout', 'payment'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE payment_flow_status AS ENUM ('first_attempt','awaiting_entrance','entrance_paid','awaiting_subscription','active','expired','overdue','refunded','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE billing_status AS ENUM ('pending','processing','approved','failed','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE subscription_billing_status AS ENUM ('active','retrying','cancelled'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE group_approval_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE discount_type AS ENUM ('percentage','fixed'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE service_category AS ENUM ('streaming','musica','ia','cursos','produtividade','ferramentas','leitura','games','saude','seguranca'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE step_type AS ENUM ('info','question','platforms'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN CREATE TYPE question_type AS ENUM ('single','multiple','yes_no'); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE question_type ADD VALUE IF NOT EXISTS 'text_input'; EXCEPTION WHEN undefined_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE question_type ADD VALUE IF NOT EXISTS 'rating_star'; EXCEPTION WHEN undefined_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE payment_flow_status ADD VALUE IF NOT EXISTS 'first_attempt' BEFORE 'awaiting_entrance'; EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN ALTER TYPE payment_flow_status ADD VALUE IF NOT EXISTS 'overdue' AFTER 'expired'; EXCEPTION WHEN duplicate_object THEN null; END $$;

-- ============================================================
-- BLOCO 2: TABELAS PRINCIPAIS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(150) NOT NULL,
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    cpf VARCHAR(14),
    marketing_source TEXT,
    marketing_gclid TEXT,
    marketing_utm_source TEXT,
    marketing_utm_medium TEXT,
    marketing_utm_campaign TEXT,
    marketing_utm_term TEXT,
    marketing_utm_content TEXT,
    marketing_captured_at TIMESTAMPTZ,
    role user_role NOT NULL DEFAULT 'user',
    status user_status NOT NULL DEFAULT 'pending',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    avatar_url TEXT,
    birthdate DATE,
    nickname VARCHAR(100),
    push_notifications_enabled_at TIMESTAMPTZ,
    pwa_installed_at TIMESTAMPTZ,
    customer_id_iopay TEXT,
    customer_id_stripe TEXT,
    customer_id_asaas TEXT,
    customer_id_mercadopago TEXT,
    customer_id_pagarme TEXT
);

CREATE TABLE IF NOT EXISTS password_resets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS streaming_services (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    color VARCHAR(7) NOT NULL DEFAULT '#000000',
    icon VARCHAR(10),
    icon_url TEXT,
    slug TEXT UNIQUE,
    description TEXT,
    official_price DECIMAL(10,2),
    official_url TEXT,
    max_group_size INTEGER NOT NULL DEFAULT 4,
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    category service_category NOT NULL DEFAULT 'streaming',
    featured BOOLEAN NOT NULL DEFAULT FALSE,
    pinned BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS master_accounts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL,
    password VARCHAR(255) NOT NULL,
    cost DECIMAL(10,2) NOT NULL,
    due_day INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
    recovery_email VARCHAR(255),
    imap_server VARCHAR(255),
    imap_password VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS groups (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
    name VARCHAR(200) NOT NULL,
    description TEXT,
    price_per_slot DECIMAL(10,2) NOT NULL,
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    cycle_discount DECIMAL(5,2) NOT NULL DEFAULT 0,
    max_size INTEGER NOT NULL DEFAULT 4,
    cover_url TEXT,
    photo_url TEXT,
    verified BOOLEAN NOT NULL DEFAULT FALSE,
    rules TEXT,
    tags TEXT[] DEFAULT '{}',
    status VARCHAR(20) NOT NULL DEFAULT 'open',
    slug TEXT,
    reference_code TEXT,
    is_official BOOLEAN DEFAULT FALSE,
    custom_cycle_months INTEGER,
    custom_cycle_label VARCHAR(50),
    custom_cycle_days INTEGER,
    plan_type VARCHAR(50) DEFAULT NULL,
    plan_type_custom VARCHAR(100) DEFAULT NULL,
    approval_status group_approval_status DEFAULT NULL,
    rejection_reason TEXT DEFAULT NULL,
    approved_at TIMESTAMPTZ DEFAULT NULL,
    reviewed_by UUID DEFAULT NULL REFERENCES users(id) ON DELETE SET NULL,
    email_code_enabled BOOLEAN DEFAULT FALSE,
    email_address VARCHAR(255),
    email_imap_server VARCHAR(255),
    email_imap_port INTEGER DEFAULT 993,
    email_imap_user VARCHAR(255),
    email_imap_password TEXT,
    email_allowed_senders TEXT[] DEFAULT '{}',
    email_blocked_subjects TEXT[] DEFAULT '{}',
    email_code_patterns TEXT[] DEFAULT '{}',
    email_body_keywords TEXT[] DEFAULT '{}',
    email_subject_includes TEXT[] DEFAULT '{}',
    email_ai_enabled BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_price_positive CHECK (price_per_slot > 0),
    CONSTRAINT chk_max_size CHECK (max_size > 0)
);

-- Drop old constraint and add new one with all cycle types
ALTER TABLE groups DROP CONSTRAINT IF EXISTS groups_billing_cycle_check;
ALTER TABLE groups ADD CONSTRAINT groups_billing_cycle_check
  CHECK (billing_cycle IN ('monthly','quarterly','semiannual','annual','custom','days'));

CREATE TABLE IF NOT EXISTS group_credentials (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    login_email VARCHAR(255),
    login_password VARCHAR(255),
    profile_assignment VARCHAR(100),
    credential_type VARCHAR(50) NOT NULL DEFAULT 'email_password',
    credential_url TEXT,
    credential_notes TEXT,
    has_profiles BOOLEAN NOT NULL DEFAULT FALSE,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    profile_name VARCHAR(100),
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    payment_status payment_flow_status DEFAULT 'awaiting_entrance',
    entrance_paid_at TIMESTAMPTZ,
    entrance_payment_id TEXT,
    subscription_deadline TIMESTAMPTZ,
    entrance_refunded BOOLEAN DEFAULT FALSE,
    subscription_mp_id TEXT,
    gateway_payment_id TEXT,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    left_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    status subscription_status NOT NULL DEFAULT 'active',
    billing_cycle VARCHAR(20) NOT NULL DEFAULT 'monthly',
    payment_method TEXT,
    started_at DATE NOT NULL DEFAULT CURRENT_DATE,
    expires_at DATE,
    amount DECIMAL(10,2),
    mercado_pago_subscription_id TEXT,
    mercado_pago_preference_id TEXT,
    mercado_pago_status TEXT,
    external_reference TEXT,
    gateway TEXT DEFAULT 'mercadopago',
    gateway_subscription_id TEXT,
    gateway_status TEXT,
    custom_cycle_months INTEGER,
    custom_cycle_days INTEGER,
    next_charge_at TIMESTAMPTZ,
    retry_count INTEGER DEFAULT 0,
    last_charge_at TIMESTAMPTZ,
    card_id TEXT,
    card_last4 TEXT,
    card_brand TEXT,
    billing_status subscription_billing_status DEFAULT 'active',
    coupon_id UUID,
    discount_amount NUMERIC(10,2) DEFAULT 0,
    original_amount NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(user_id, group_id)
);

ALTER TABLE user_subscriptions DROP CONSTRAINT IF EXISTS user_subscriptions_billing_cycle_check;
ALTER TABLE user_subscriptions ADD CONSTRAINT user_subscriptions_billing_cycle_check
  CHECK (billing_cycle IN ('monthly','quarterly','semiannual','annual','custom','days'));

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    method payment_method NOT NULL,
    payment_type TEXT,
    gateway TEXT DEFAULT 'mercadopago',
    status payment_status NOT NULL DEFAULT 'pending',
    transaction_code VARCHAR(255),
    notes TEXT,
    due_date DATE,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS invoices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    service_id UUID REFERENCES streaming_services(id) ON DELETE SET NULL,
    amount DECIMAL(10,2) NOT NULL,
    due_date DATE NOT NULL,
    status payment_status NOT NULL DEFAULT 'pending',
    gateway_transaction_id TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS support_tickets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    subject VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    status ticket_status NOT NULL DEFAULT 'open',
    priority ticket_priority NOT NULL DEFAULT 'medium',
    category VARCHAR(50) NOT NULL DEFAULT 'general',
    resolved_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ticket_replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id UUID NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message TEXT NOT NULL,
    is_internal BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS announcements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    type announcement_type NOT NULL DEFAULT 'info',
    status announcement_status NOT NULL DEFAULT 'draft',
    starts_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    metadata JSONB DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verification_pins (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    code VARCHAR(20) NOT NULL,
    source_email VARCHAR(255),
    used BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS activity_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action log_action NOT NULL,
    entity_type VARCHAR(50),
    entity_id UUID,
    description TEXT,
    ip_address INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    read BOOLEAN NOT NULL DEFAULT FALSE,
    event_type VARCHAR(50) DEFAULT 'info',
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- BLOCO 3: TABELAS SECUNDÁRIAS
-- ============================================================

CREATE TABLE IF NOT EXISTS group_profiles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    profile_name VARCHAR(255) NOT NULL,
    profile_password VARCHAR(255) NOT NULL,
    assigned_to UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_wallets (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    balance DECIMAL(10,2) DEFAULT 0,
    total_earned DECIMAL(10,2) DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit','withdrawal','refund')),
    amount DECIMAL(10,2) NOT NULL,
    description TEXT,
    reference_type VARCHAR(50),
    reference_id UUID,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'completed' CHECK (status IN ('pending','completed','cancelled')),
    admin_notes TEXT,
    paid_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wallet_withdrawals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','rejected')),
    payment_method VARCHAR(50),
    payment_details TEXT,
    processed_by UUID REFERENCES users(id),
    notes TEXT,
    requested_at TIMESTAMPTZ DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS platform_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    event_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT,
    metadata JSONB DEFAULT '{}',
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_messages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_interest (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id UUID NOT NULL REFERENCES streaming_services(id) ON DELETE CASCADE,
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(group_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_referral_codes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code VARCHAR(20) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS referrals (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id UUID REFERENCES users(id) ON DELETE SET NULL,
    referral_code VARCHAR(20) NOT NULL,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','cancelled')),
    points INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS payment_attempts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL,
    group_id UUID NOT NULL,
    gateway TEXT NOT NULL,
    payment_method TEXT NOT NULL,
    payment_type TEXT NOT NULL,
    amount NUMERIC(10,2),
    currency TEXT DEFAULT 'BRL',
    status TEXT NOT NULL DEFAULT 'created',
    gateway_transaction_id TEXT,
    gateway_response JSONB DEFAULT '{}',
    error_message TEXT,
    external_reference TEXT,
    pix_copy_paste TEXT,
    pix_qrcode_url TEXT,
    coupon_id UUID REFERENCES coupons(id) ON DELETE SET NULL,
    discount_amount NUMERIC(10,2) DEFAULT 0,
    original_amount NUMERIC(10,2) DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_cycles (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    amount DECIMAL(10,2) NOT NULL,
    charge_date DATE NOT NULL,
    attempted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    status billing_status NOT NULL DEFAULT 'pending',
    gateway TEXT NOT NULL,
    gateway_transaction_id TEXT,
    gateway_response JSONB,
    error_message TEXT,
    error_code TEXT,
    attempt_number INTEGER NOT NULL DEFAULT 1,
    next_retry_at TIMESTAMPTZ,
    invoice_id UUID REFERENCES invoices(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS billing_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    subscription_id UUID REFERENCES user_subscriptions(id) ON DELETE SET NULL,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    group_id UUID REFERENCES groups(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupons (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    code VARCHAR(30) NOT NULL UNIQUE,
    description TEXT,
    discount_type discount_type NOT NULL DEFAULT 'percentage',
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    max_uses INTEGER DEFAULT NULL,
    used_count INTEGER NOT NULL DEFAULT 0,
    min_amount NUMERIC(10,2) DEFAULT 0,
    applies_to VARCHAR(20) NOT NULL DEFAULT 'all' CHECK (applies_to IN ('all','entrance','subscription')),
    group_id UUID DEFAULT NULL REFERENCES groups(id) ON DELETE CASCADE,
    active BOOLEAN NOT NULL DEFAULT true,
    recurring BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS coupon_uses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    coupon_id UUID NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    payment_type VARCHAR(20) NOT NULL CHECK (payment_type IN ('entrance','subscription')),
    original_amount NUMERIC(10,2) NOT NULL,
    discount_amount NUMERIC(10,2) NOT NULL,
    final_amount NUMERIC(10,2) NOT NULL,
    group_id UUID DEFAULT NULL REFERENCES groups(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_charges (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    reference_code TEXT UNIQUE NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    description TEXT NOT NULL,
    payment_method TEXT NOT NULL DEFAULT 'pix',
    status TEXT NOT NULL DEFAULT 'pending',
    created_by UUID REFERENCES users(id),
    gateway TEXT DEFAULT 'iopay',
    gateway_transaction_id TEXT,
    paid_at TIMESTAMPTZ,
    paid_amount NUMERIC(10,2),
    expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
    pix_copy_paste TEXT,
    pix_qrcode_url TEXT,
    pix_qrcode_base64 TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS custom_charge_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    charge_id UUID REFERENCES custom_charges(id) ON DELETE SET NULL,
    reference_code TEXT NOT NULL,
    admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL CHECK (action IN ('created','paid','expired','cancelled','pix_generated','link_generated','payment_error','status_check')),
    amount NUMERIC(10,2),
    payment_method TEXT CHECK (payment_method IN ('pix','link')),
    status TEXT,
    gateway_transaction_id TEXT,
    gateway_response JSONB,
    ip_address TEXT,
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type TEXT NOT NULL,
    email_id TEXT,
    "from" TEXT,
    "to" TEXT,
    subject TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    raw_event JSONB
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    subscription JSONB NOT NULL DEFAULT '{}',
    device_name TEXT,
    user_agent TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    last_seen_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_card_metadata (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    id_card TEXT NOT NULL,
    last_four TEXT,
    brand TEXT,
    holder_name TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, id_card)
);

CREATE TABLE IF NOT EXISTS testimonials (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_name TEXT NOT NULL,
    user_role TEXT,
    text TEXT NOT NULL,
    rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
    admin_note TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS surveys (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN DEFAULT true,
    show_in_catalog BOOLEAN DEFAULT false,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS survey_steps (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE NOT NULL,
    step_number INT NOT NULL,
    step_type step_type NOT NULL DEFAULT 'info',
    title TEXT NOT NULL,
    description TEXT,
    is_required BOOLEAN DEFAULT true,
    question_type question_type,
    options JSONB DEFAULT '[]'::jsonb,
    content TEXT,
    image_url TEXT,
    platform_filter JSONB DEFAULT '[]'::jsonb,
    branch_sim UUID,
    branch_nao UUID,
    branch_sim_step INT,
    branch_nao_step INT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(survey_id, step_number)
);

CREATE TABLE IF NOT EXISTS survey_responses (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE NOT NULL,
    respondent_name TEXT NOT NULL,
    respondent_email TEXT,
    respondent_phone TEXT,
    respondent_whatsapp TEXT,
    answers JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- BLOCO 4: ÍNDICES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_status ON users(status);
CREATE INDEX IF NOT EXISTS idx_users_customer_id_iopay ON users(customer_id_iopay);
CREATE INDEX IF NOT EXISTS idx_users_customer_id_stripe ON users(customer_id_stripe);
CREATE INDEX IF NOT EXISTS idx_users_customer_id_asaas ON users(customer_id_asaas);
CREATE INDEX IF NOT EXISTS idx_password_resets_token ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_groups_service ON groups(service_id);
CREATE INDEX IF NOT EXISTS idx_groups_status ON groups(status);
CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups(owner_id);
CREATE INDEX IF NOT EXISTS idx_groups_approval ON groups(approval_status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_slug ON groups(slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_reference_code ON groups(reference_code);
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_service ON user_subscriptions(service_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_group ON user_subscriptions(group_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status ON user_subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_mp_id ON user_subscriptions(mercado_pago_subscription_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_external_ref ON user_subscriptions(external_reference);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_coupon_id ON user_subscriptions(coupon_id);
CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_subscription ON payments(subscription_id);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(user_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user ON support_tickets(user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_verification_pins_group ON verification_pins(group_id);
CREATE INDEX IF NOT EXISTS idx_verification_pins_created ON verification_pins(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user ON activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read);
CREATE INDEX IF NOT EXISTS idx_group_profiles_group_id ON group_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_group_profiles_assigned_to ON group_profiles(assigned_to);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user ON wallet_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_created ON wallet_transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user ON wallet_withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_status ON wallet_withdrawals(status);
CREATE INDEX IF NOT EXISTS idx_platform_events_type ON platform_events(event_type);
CREATE INDEX IF NOT EXISTS idx_platform_events_created ON platform_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_group_messages_group_id ON group_messages(group_id);
CREATE INDEX IF NOT EXISTS idx_group_messages_created_at ON group_messages(created_at);
CREATE INDEX IF NOT EXISTS idx_group_interest_group ON group_interest(group_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_user ON group_interest(user_id);
CREATE INDEX IF NOT EXISTS idx_group_interest_service ON group_interest(service_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON user_referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON user_referral_codes(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals(invitee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_group ON referrals(group_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_user ON payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_group ON payment_attempts(group_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_gateway_tx ON payment_attempts(gateway_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_external_ref ON payment_attempts(external_reference);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_created ON payment_attempts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_charge_date ON billing_cycles(charge_date);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_status ON billing_cycles(status);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_subscription ON billing_cycles(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_user ON billing_cycles(user_id);
CREATE INDEX IF NOT EXISTS idx_billing_cycles_next_retry ON billing_cycles(next_retry_at) WHERE status = 'failed';
CREATE INDEX IF NOT EXISTS idx_billing_logs_subscription ON billing_logs(subscription_id);
CREATE INDEX IF NOT EXISTS idx_billing_logs_action ON billing_logs(action);
CREATE INDEX IF NOT EXISTS idx_billing_logs_created ON billing_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(active);
CREATE INDEX IF NOT EXISTS idx_coupons_group_id ON coupons(group_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_coupon_id ON coupon_uses(coupon_id);
CREATE INDEX IF NOT EXISTS idx_coupon_uses_user_id ON coupon_uses(user_id);
CREATE INDEX IF NOT EXISTS idx_custom_charges_reference ON custom_charges(reference_code);
CREATE INDEX IF NOT EXISTS idx_custom_charges_status ON custom_charges(status);
CREATE INDEX IF NOT EXISTS idx_custom_charge_logs_charge_id ON custom_charge_logs(charge_id);
CREATE INDEX IF NOT EXISTS idx_custom_charge_logs_reference_code ON custom_charge_logs(reference_code);
CREATE INDEX IF NOT EXISTS idx_custom_charge_logs_admin_id ON custom_charge_logs(admin_id);
CREATE INDEX IF NOT EXISTS idx_custom_charge_logs_action ON custom_charge_logs(action);
CREATE INDEX IF NOT EXISTS idx_custom_charge_logs_created_at ON custom_charge_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type ON email_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_to ON email_logs("to");
CREATE INDEX IF NOT EXISTS idx_email_logs_created_at ON email_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_active ON push_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_testimonials_status ON testimonials(status);
CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON testimonials(user_id);
CREATE INDEX IF NOT EXISTS idx_survey_steps_survey ON survey_steps(survey_id, step_number);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_created ON survey_responses(created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_streaming_services_slug ON streaming_services(slug);
CREATE INDEX IF NOT EXISTS idx_group_credentials_type ON group_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_group_credentials_assigned_to ON group_credentials(assigned_to);
CREATE INDEX IF NOT EXISTS idx_group_credentials_group_id ON group_credentials(group_id);

-- ============================================================
-- BLOCO 5: FUNÇÕES E TRIGGERS
-- ============================================================

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers to all tables that need it
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_users_updated_at ON users; CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_streaming_services_updated_at ON streaming_services; CREATE TRIGGER trg_streaming_services_updated_at BEFORE UPDATE ON streaming_services FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_master_accounts_updated_at ON master_accounts; CREATE TRIGGER trg_master_accounts_updated_at BEFORE UPDATE ON master_accounts FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_groups_updated_at ON groups; CREATE TRIGGER trg_groups_updated_at BEFORE UPDATE ON groups FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_group_credentials_updated_at ON group_credentials; CREATE TRIGGER trg_group_credentials_updated_at BEFORE UPDATE ON group_credentials FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_user_subscriptions_updated_at ON user_subscriptions; CREATE TRIGGER trg_user_subscriptions_updated_at BEFORE UPDATE ON user_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_payments_updated_at ON payments; CREATE TRIGGER trg_payments_updated_at BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_invoices_updated_at ON invoices; CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON support_tickets; CREATE TRIGGER trg_support_tickets_updated_at BEFORE UPDATE ON support_tickets FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_announcements_updated_at ON announcements; CREATE TRIGGER trg_announcements_updated_at BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_notifications_updated_at ON notifications; CREATE TRIGGER trg_notifications_updated_at BEFORE UPDATE ON notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_billing_cycles_updated_at ON billing_cycles; CREATE TRIGGER trg_billing_cycles_updated_at BEFORE UPDATE ON billing_cycles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS trg_group_profiles_updated_at ON group_profiles; CREATE TRIGGER trg_group_profiles_updated_at BEFORE UPDATE ON group_profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN DROP TRIGGER IF EXISTS coupons_updated_at ON coupons; CREATE TRIGGER coupons_updated_at BEFORE UPDATE ON coupons FOR EACH ROW EXECUTE FUNCTION update_updated_at_column(); EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Group capacity check
CREATE OR REPLACE FUNCTION check_group_capacity()
RETURNS TRIGGER AS $$
DECLARE
    v_count INTEGER;
    v_max INTEGER;
BEGIN
    SELECT COUNT(*) INTO v_count FROM group_members WHERE group_id = NEW.group_id AND status = 'active';
    SELECT max_size INTO v_max FROM groups WHERE id = NEW.group_id;
    IF v_count >= v_max THEN
        RAISE EXCEPTION 'Grupo está cheio. Capacidade máxima: %', v_max;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_group_capacity ON group_members;
CREATE TRIGGER trg_check_group_capacity BEFORE INSERT ON group_members FOR EACH ROW EXECUTE FUNCTION check_group_capacity();

-- Payment activity log
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

DROP TRIGGER IF EXISTS trg_log_payment ON payments;
CREATE TRIGGER trg_log_payment AFTER UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION log_payment_activity();

-- Group slug generation
CREATE OR REPLACE FUNCTION generate_group_slug(p_name TEXT) RETURNS TEXT AS $$
DECLARE
    base_slug TEXT; final_slug TEXT; suffix INT := 0;
BEGIN
    base_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'));
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM groups WHERE slug = final_slug) LOOP
        suffix := suffix + 1;
        final_slug := base_slug || '-' || suffix;
    END LOOP;
    RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_generate_group_slug() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := generate_group_slug(NEW.name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_group_slug ON groups;
CREATE TRIGGER trg_generate_group_slug BEFORE INSERT ON groups FOR EACH ROW EXECUTE FUNCTION auto_generate_group_slug();

-- Service slug generation
CREATE OR REPLACE FUNCTION generate_service_slug(p_name TEXT) RETURNS TEXT AS $$
DECLARE
    base_slug TEXT; final_slug TEXT; suffix INT := 0;
BEGIN
    base_slug := lower(regexp_replace(p_name, '[^a-zA-Z0-9]+', '-', 'g'));
    final_slug := base_slug;
    WHILE EXISTS (SELECT 1 FROM streaming_services WHERE slug = final_slug) LOOP
        suffix := suffix + 1;
        final_slug := base_slug || '-' || suffix;
    END LOOP;
    RETURN final_slug;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION auto_generate_service_slug() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := generate_service_slug(NEW.name);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_service_slug ON streaming_services;
CREATE TRIGGER trg_generate_service_slug BEFORE INSERT ON streaming_services FOR EACH ROW EXECUTE FUNCTION auto_generate_service_slug();

-- Reference code generation
CREATE OR REPLACE FUNCTION generate_reference_code()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.reference_code IS NULL OR NEW.reference_code = '' THEN
        NEW.reference_code := UPPER(SUBSTRING(MD5(RANDOM()::text) FROM 1 FOR 6));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_generate_reference_code ON groups;
CREATE TRIGGER trg_generate_reference_code BEFORE INSERT ON groups FOR EACH ROW EXECUTE FUNCTION generate_reference_code();

-- Credit wallet function
CREATE OR REPLACE FUNCTION credit_wallet(
    p_user_id UUID, p_amount DECIMAL, p_description TEXT,
    p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
    p_group_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    INSERT INTO user_wallets (user_id, balance, total_earned, updated_at)
    VALUES (p_user_id, p_amount, p_amount, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        balance = user_wallets.balance + p_amount,
        total_earned = user_wallets.total_earned + p_amount, updated_at = NOW();
    INSERT INTO wallet_transactions (user_id, type, amount, description, reference_type, reference_id, group_id, status, created_at)
    VALUES (p_user_id, 'credit', p_amount, p_description, p_reference_type, p_reference_id, p_group_id, 'completed', NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Check expired entrances
CREATE OR REPLACE FUNCTION check_expired_entrances()
RETURNS void AS $$
BEGIN
    UPDATE group_members
    SET payment_status = 'expired', status = 'cancelled', left_at = NOW()
    WHERE payment_status IN ('entrance_paid','awaiting_subscription')
        AND subscription_deadline < NOW();
END;
$$ LANGUAGE plpgsql;

-- Update subscription statuses
CREATE OR REPLACE FUNCTION update_subscription_statuses()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
    UPDATE group_members SET payment_status = 'overdue', updated_at = NOW()
    WHERE payment_status = 'first_attempt' AND created_at < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.user_id = group_members.user_id AND p.group_id = group_members.group_id AND p.status = 'paid');
    UPDATE group_members SET payment_status = 'overdue', updated_at = NOW()
    WHERE payment_status = 'awaiting_subscription' AND subscription_deadline IS NOT NULL AND subscription_deadline < NOW();
    UPDATE group_members SET payment_status = 'overdue', updated_at = NOW()
    WHERE payment_status = 'active' AND subscription_deadline IS NOT NULL AND subscription_deadline < NOW();
    UPDATE group_members SET payment_status = 'cancelled', status = 'cancelled', left_at = NOW(), updated_at = NOW()
    WHERE payment_status = 'overdue' AND updated_at < NOW() - INTERVAL '3 months';
END;
$$;

-- Auto assign credential
CREATE OR REPLACE FUNCTION auto_assign_credential()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE group_credentials SET assigned_to = NEW.user_id
        WHERE group_id = NEW.group_id AND assigned_to IS NULL
        AND id = (SELECT id FROM group_credentials WHERE group_id = NEW.group_id AND assigned_to IS NULL ORDER BY id LIMIT 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_credential ON group_members;
CREATE TRIGGER trg_auto_assign_credential AFTER INSERT OR UPDATE OF status ON group_members FOR EACH ROW EXECUTE FUNCTION auto_assign_credential();

-- Release credential
CREATE OR REPLACE FUNCTION release_credential()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('inactive','cancelled') AND OLD.status = 'active' THEN
        UPDATE group_credentials SET assigned_to = NULL WHERE assigned_to = NEW.user_id AND group_id = NEW.group_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_release_credential ON group_members;
CREATE TRIGGER trg_release_credential AFTER UPDATE OF status ON group_members FOR EACH ROW EXECUTE FUNCTION release_credential();

-- Auto assign profile
CREATE OR REPLACE FUNCTION auto_assign_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE group_profiles SET assigned_to = NEW.user_id
        WHERE group_id = NEW.group_id AND assigned_to IS NULL
        AND id = (SELECT id FROM group_profiles WHERE group_id = NEW.group_id AND assigned_to IS NULL ORDER BY created_at LIMIT 1);
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_profile ON group_members;
CREATE TRIGGER trg_auto_assign_profile AFTER INSERT OR UPDATE OF status ON group_members FOR EACH ROW EXECUTE FUNCTION auto_assign_profile();

-- Release profile
CREATE OR REPLACE FUNCTION release_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('inactive','cancelled') AND OLD.status = 'active' THEN
        UPDATE group_profiles SET assigned_to = NULL WHERE assigned_to = NEW.user_id AND group_id = NEW.group_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_release_profile ON group_members;
CREATE TRIGGER trg_release_profile AFTER UPDATE OF status ON group_members FOR EACH ROW EXECUTE FUNCTION release_profile();

-- Notify members on leave
CREATE OR REPLACE FUNCTION notify_group_members_on_leave()
RETURNS TRIGGER AS $$
DECLARE group_rec RECORD; member_record RECORD;
BEGIN
    IF NEW.status = 'inactive' AND (OLD.status IS NULL OR OLD.status != 'inactive') THEN
        SELECT * INTO group_rec FROM groups WHERE id = NEW.group_id;
        FOR member_record IN SELECT gm.user_id FROM group_members gm WHERE gm.group_id = NEW.group_id AND gm.status = 'active' AND gm.user_id != NEW.user_id LOOP
            INSERT INTO notifications (user_id, title, message)
            VALUES (member_record.user_id, 'Um membro do seu grupo saiu!', 'Um membro do grupo ' || group_rec.name || ' saiu. Quer convidar algum amigo?');
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_group_members_on_leave ON group_members;
CREATE TRIGGER trg_notify_group_members_on_leave AFTER UPDATE ON group_members FOR EACH ROW EXECUTE FUNCTION notify_group_members_on_leave();

-- Referral code generation
CREATE OR REPLACE FUNCTION generate_referral_code(user_uuid UUID)
RETURNS VARCHAR(20) AS $$
DECLARE code VARCHAR(20); exists_count INTEGER;
BEGIN
    LOOP
        code := UPPER(SUBSTRING(MD5(user_uuid::TEXT || NOW()::TEXT) FROM 1 FOR 8));
        SELECT COUNT(*) INTO exists_count FROM user_referral_codes WHERE referral_code = code;
        EXIT WHEN exists_count = 0;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION handle_new_user_referral()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_referral_codes (user_id, referral_code) VALUES (NEW.id, generate_referral_code(NEW.id));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Survey slug generation
CREATE OR REPLACE FUNCTION generate_survey_slug()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.slug IS NULL OR NEW.slug = '' THEN
        NEW.slug := LOWER(REGEXP_REPLACE(REGEXP_REPLACE(NEW.title, '[^a-zA-Z0-9\s-]', '', 'g'), '\s+', '-', 'g'));
        IF EXISTS (SELECT 1 FROM surveys WHERE slug = NEW.slug AND id != NEW.id) THEN
            NEW.slug := NEW.slug || '-' || SUBSTRING(NEW.id::text FROM 1 FOR 6);
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_survey_slug ON surveys;
CREATE TRIGGER trg_survey_slug BEFORE INSERT OR UPDATE ON surveys FOR EACH ROW EXECUTE FUNCTION generate_survey_slug();

-- Calculate next charge
CREATE OR REPLACE FUNCTION calculate_next_charge(p_billing_cycle TEXT, p_custom_cycle_months INTEGER DEFAULT NULL)
RETURNS TIMESTAMPTZ AS $$
DECLARE v_months INTEGER;
BEGIN
    v_months := CASE p_billing_cycle
        WHEN 'monthly' THEN 1 WHEN 'quarterly' THEN 3 WHEN 'semiannual' THEN 6
        WHEN 'annual' THEN 12 WHEN 'custom' THEN COALESCE(p_custom_cycle_months, 1) ELSE 1
    END;
    RETURN (DATE_TRUNC('month', CURRENT_DATE) + (v_months || ' months')::INTERVAL)::TIMESTAMPTZ;
END;
$$ LANGUAGE plpgsql;

-- is_admin helper function
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- BLOCO 6: RLS POLICIES
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE streaming_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE ticket_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallet_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_referral_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE billing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupon_uses ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE custom_charge_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_card_metadata ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

-- Users
DROP POLICY IF EXISTS "Usuários leem perfis" ON users;
CREATE POLICY "Usuários leem perfis" ON users FOR SELECT USING (auth.uid() = id OR is_admin());
DROP POLICY IF EXISTS "Usuários atualizam seu próprio perfil" ON users;
CREATE POLICY "Usuários atualizam seu próprio perfil" ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
DROP POLICY IF EXISTS "Donos veem perfis dos grupos" ON users;
CREATE POLICY "Donos veem perfis dos grupos" ON users FOR SELECT USING (auth.uid() = id OR EXISTS (SELECT 1 FROM group_members gm JOIN groups g ON g.id = gm.group_id WHERE gm.user_id = users.id AND g.owner_id = auth.uid()) OR EXISTS (SELECT 1 FROM user_subscriptions us JOIN groups g ON g.id = us.group_id WHERE us.user_id = users.id AND g.owner_id = auth.uid()));

-- Groups
DROP POLICY IF EXISTS "Grupos públicos" ON groups;
CREATE POLICY "Grupos públicos" ON groups FOR SELECT USING (true);
CREATE POLICY "Users create own groups" ON groups FOR INSERT WITH CHECK (auth.uid() = owner_id);
CREATE POLICY "Users update own groups" ON groups FOR UPDATE USING (auth.uid() = owner_id);
CREATE POLICY "Users delete own groups" ON groups FOR DELETE USING (auth.uid() = owner_id);

-- Streaming services
DROP POLICY IF EXISTS "Serviços públicos" ON streaming_services;
CREATE POLICY "Serviços públicos" ON streaming_services FOR SELECT USING (true);

-- Group members
DROP POLICY IF EXISTS "Usuários veem seus grupos" ON group_members;
CREATE POLICY "Usuários veem seus grupos" ON group_members FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Donos veem membros do grupo" ON group_members;
CREATE POLICY "Donos veem membros do grupo" ON group_members FOR SELECT USING (EXISTS (SELECT 1 FROM groups g WHERE g.id = group_members.group_id AND g.owner_id = auth.uid()));

-- User subscriptions
DROP POLICY IF EXISTS "Usuários veem suas assinaturas" ON user_subscriptions;
CREATE POLICY "Usuários veem suas assinaturas" ON user_subscriptions FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Donos veem assinaturas do grupo" ON user_subscriptions;
CREATE POLICY "Donos veem assinaturas do grupo" ON user_subscriptions FOR SELECT USING (EXISTS (SELECT 1 FROM groups g WHERE g.id = user_subscriptions.group_id AND g.owner_id = auth.uid()));

-- Payments
DROP POLICY IF EXISTS "Usuários veem seus pagamentos" ON payments;
CREATE POLICY "Usuários veem seus pagamentos" ON payments FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Donos veem pagamentos do grupo" ON payments;
CREATE POLICY "Donos veem pagamentos do grupo" ON payments FOR SELECT USING (user_id = auth.uid() OR EXISTS (SELECT 1 FROM groups g WHERE g.id = payments.group_id AND g.owner_id = auth.uid()));

-- Invoices
DROP POLICY IF EXISTS "Usuários veem suas faturas" ON invoices;
CREATE POLICY "Usuários veem suas faturas" ON invoices FOR SELECT USING (user_id = auth.uid());

-- Group credentials
DROP POLICY IF EXISTS "Membros veem credenciais dos seus grupos" ON group_credentials;
CREATE POLICY "Membros veem suas credenciais atribuídas" ON group_credentials FOR SELECT USING (assigned_to = auth.uid() OR assigned_to IS NULL OR is_admin());
CREATE POLICY "Admins gerenciam credenciais" ON group_credentials FOR ALL USING (is_admin()) WITH CHECK (is_admin());

-- Support tickets
DROP POLICY IF EXISTS "Usuários veem seus tickets" ON support_tickets;
CREATE POLICY "Usuários veem seus tickets" ON support_tickets FOR SELECT USING (user_id = auth.uid());
DROP POLICY IF EXISTS "Usuários veem respostas dos seus tickets" ON ticket_replies;
CREATE POLICY "Usuários veem respostas dos seus tickets" ON ticket_replies FOR SELECT USING (EXISTS (SELECT 1 FROM support_tickets t WHERE t.id = ticket_replies.ticket_id AND t.user_id = auth.uid()));

-- Announcements
DROP POLICY IF EXISTS "Avisos publicados" ON announcements;
CREATE POLICY "Avisos publicados" ON announcements FOR SELECT USING (status = 'published');

-- Group profiles
CREATE POLICY "Admins gerenciam perfis de grupo" ON group_profiles FOR ALL USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "Membros veem seus perfis" ON group_profiles FOR SELECT USING (assigned_to = auth.uid() OR assigned_to IS NULL);

-- Wallets
CREATE POLICY "Users see own wallet" ON user_wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own transactions" ON wallet_transactions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users see own withdrawals" ON wallet_withdrawals FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users request withdrawals" ON wallet_withdrawals FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins see all wallets" ON user_wallets FOR SELECT USING (is_admin());
CREATE POLICY "Admins see all transactions" ON wallet_transactions FOR SELECT USING (is_admin());
CREATE POLICY "Admins manage withdrawals" ON wallet_withdrawals FOR ALL USING (is_admin());

-- Platform events
CREATE POLICY "Admin can read platform_events" ON platform_events FOR SELECT USING (is_admin());
CREATE POLICY "Service role can insert platform_events" ON platform_events FOR INSERT WITH CHECK (true);

-- Group messages
CREATE POLICY "Membros veem mensagens do grupo" ON group_messages FOR SELECT USING (group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id = auth.uid() AND gm.status = 'active'));
CREATE POLICY "Membros enviam mensagens no grupo" ON group_messages FOR INSERT WITH CHECK (user_id = auth.uid() AND group_id IN (SELECT gm.group_id FROM group_members gm WHERE gm.user_id = auth.uid() AND gm.status = 'active'));

-- Group interest
CREATE POLICY "users_own_interest" ON group_interest FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_create_interest" ON group_interest FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_delete_interest" ON group_interest FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "admin_all_interest" ON group_interest FOR ALL USING (is_admin());

-- Referrals
CREATE POLICY "users_own_referral_code" ON user_referral_codes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "admin_all_referral_codes" ON user_referral_codes FOR ALL USING (is_admin());
CREATE POLICY "users_read_own_referrals" ON referrals FOR SELECT USING (auth.uid() = referrer_id OR auth.uid() = invitee_id);
CREATE POLICY "users_insert_own_referrals" ON referrals FOR INSERT WITH CHECK (auth.uid() = referrer_id);
CREATE POLICY "admin_all_referrals" ON referrals FOR ALL USING (is_admin());

-- Payment attempts
CREATE POLICY "Users can view own payment attempts" ON payment_attempts FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role can manage payment attempts" ON payment_attempts FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Admin can view all payment_attempts" ON payment_attempts FOR SELECT USING (is_admin());

-- Billing cycles
CREATE POLICY "Admins can view all billing cycles" ON billing_cycles FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Users can view own billing cycles" ON billing_cycles FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "Service role can manage billing cycles" ON billing_cycles FOR ALL TO service_role USING (true);

-- Billing logs
CREATE POLICY "Admins can view all billing logs" ON billing_logs FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "Service role can manage billing logs" ON billing_logs FOR ALL TO service_role USING (true);

-- Coupons
CREATE POLICY "Admin full access on coupons" ON coupons FOR ALL USING (is_admin());
CREATE POLICY "Anyone can validate coupon code" ON coupons FOR SELECT USING (active = true);
CREATE POLICY "Admin full access on coupon_uses" ON coupon_uses FOR ALL USING (is_admin());
CREATE POLICY "User can see own coupon uses" ON coupon_uses FOR SELECT USING (user_id = auth.uid());

-- Custom charges
CREATE POLICY "Admins can manage custom charges" ON custom_charges FOR ALL USING (is_admin());
CREATE POLICY "Anyone can view pending custom charges by reference" ON custom_charges FOR SELECT USING (status = 'pending');
CREATE POLICY "Admins can view all custom charge logs" ON custom_charge_logs FOR SELECT USING (is_admin());
CREATE POLICY "Service role can insert custom charge logs" ON custom_charge_logs FOR INSERT WITH CHECK (true);
CREATE POLICY "Admins can insert custom charge logs" ON custom_charge_logs FOR INSERT WITH CHECK (is_admin());

-- Email logs
CREATE POLICY "Admins can read email logs" ON email_logs FOR SELECT USING (is_admin());

-- Testimonials
CREATE POLICY "Public can read approved testimonials" ON testimonials FOR SELECT USING (status = 'approved');
CREATE POLICY "Users can read own testimonials" ON testimonials FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own testimonials" ON testimonials FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own pending testimonials" ON testimonials FOR UPDATE USING (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "Users can delete own pending testimonials" ON testimonials FOR DELETE USING (auth.uid() = user_id AND status = 'pending');
CREATE POLICY "Admin full access on testimonials" ON testimonials FOR ALL USING (is_admin());

-- Surveys
CREATE POLICY "surveys_select_public" ON surveys FOR SELECT USING (is_active = true);
CREATE POLICY "surveys_select_admin" ON surveys FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "surveys_insert_admin" ON surveys FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "surveys_update_admin" ON surveys FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "surveys_delete_admin" ON surveys FOR DELETE TO authenticated USING (is_admin());

-- Survey steps
CREATE POLICY "survey_steps_select_public" ON survey_steps FOR SELECT USING (EXISTS (SELECT 1 FROM surveys WHERE id = survey_id AND is_active = true));
CREATE POLICY "survey_steps_select_admin" ON survey_steps FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "survey_steps_insert_admin" ON survey_steps FOR INSERT TO authenticated WITH CHECK (is_admin());
CREATE POLICY "survey_steps_update_admin" ON survey_steps FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "survey_steps_delete_admin" ON survey_steps FOR DELETE TO authenticated USING (is_admin());

-- Survey responses
CREATE POLICY "survey_responses_insert_public" ON survey_responses FOR INSERT WITH CHECK (true);
CREATE POLICY "survey_responses_select_admin" ON survey_responses FOR SELECT TO authenticated USING (is_admin());
CREATE POLICY "survey_responses_delete_admin" ON survey_responses FOR DELETE TO authenticated USING (is_admin());

-- Card metadata
CREATE POLICY "Users can view own card metadata" ON user_card_metadata FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own card metadata" ON user_card_metadata FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own card metadata" ON user_card_metadata FOR DELETE USING (auth.uid() = user_id);
CREATE POLICY "Users can update own card metadata" ON user_card_metadata FOR UPDATE USING (auth.uid() = user_id);

-- App settings: admin read/write, service_role all
CREATE POLICY "Admins can read app_settings" ON app_settings FOR SELECT USING (is_admin());
CREATE POLICY "Admins can update app_settings" ON app_settings FOR UPDATE USING (is_admin());
CREATE POLICY "Admins can insert app_settings" ON app_settings FOR INSERT WITH CHECK (is_admin());

-- ============================================================
-- BLOCO 7: VIEWS
-- ============================================================

CREATE OR REPLACE VIEW v_group_spots AS
SELECT g.id AS group_id, g.service_id, g.name AS group_name, g.max_size, g.price_per_slot, g.billing_cycle, g.cycle_discount,
    COUNT(gm.id) AS occupied_spots, (g.max_size - COUNT(gm.id)) AS available_spots,
    CASE WHEN COUNT(gm.id) >= g.max_size THEN TRUE ELSE FALSE END AS is_full
FROM groups g LEFT JOIN group_members gm ON gm.group_id = g.id AND gm.status = 'active'
GROUP BY g.id, g.service_id, g.name, g.max_size, g.price_per_slot, g.billing_cycle, g.cycle_discount;

CREATE OR REPLACE VIEW v_admin_financial_summary AS
SELECT
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid') AS total_revenue,
    (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS total_cost,
    (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'paid') - (SELECT COALESCE(SUM(cost), 0) FROM master_accounts WHERE status = 'active') AS net_profit,
    (SELECT COUNT(*) FROM users WHERE role = 'user' AND status = 'active') AS active_users;

CREATE OR REPLACE VIEW v_user_active_services AS
SELECT us.user_id, us.id AS subscription_id, g.id AS group_id, s.id AS service_id, s.name AS service_name,
    s.full_name AS service_full_name, s.color AS service_color, s.icon AS service_icon, g.name AS group_name,
    g.price_per_slot, gc.login_email, gc.login_password, gc.profile_assignment, us.started_at, us.expires_at
FROM user_subscriptions us
JOIN groups g ON g.id = us.group_id JOIN streaming_services s ON s.id = us.service_id
LEFT JOIN group_credentials gc ON gc.group_id = g.id WHERE us.status = 'active';

CREATE OR REPLACE VIEW v_tickets_with_last_reply AS
SELECT t.*, u.name AS user_name, u.email AS user_email, MAX(tr.created_at) AS last_reply_at
FROM support_tickets t JOIN users u ON u.id = t.user_id LEFT JOIN ticket_replies tr ON tr.ticket_id = t.id
GROUP BY t.id, u.name, u.email;

CREATE OR REPLACE VIEW category_info AS
SELECT category,
    CASE category WHEN 'streaming' THEN 'Streaming' WHEN 'musica' THEN 'Musica' WHEN 'ia' THEN 'IA' WHEN 'cursos' THEN 'Cursos' WHEN 'produtividade' THEN 'Produtividade' WHEN 'ferramentas' THEN 'Ferramentas' WHEN 'leitura' THEN 'Leitura' WHEN 'games' THEN 'Games' WHEN 'saude' THEN 'Saude' WHEN 'seguranca' THEN 'Seguranca' END AS label
FROM (SELECT unnest(enum_range(NULL::service_category)) AS category) sub;

CREATE OR REPLACE VIEW survey_stats AS
SELECT s.id AS survey_id, s.title, s.slug, s.is_active, s.created_at,
    COUNT(sr.id) AS total_responses,
    COUNT(CASE WHEN sr.completed_at IS NOT NULL THEN 1 END) AS completed_responses,
    ROUND(CASE WHEN COUNT(sr.id) > 0 THEN (COUNT(CASE WHEN sr.completed_at IS NOT NULL THEN 1 END)::decimal / COUNT(sr.id) * 100) ELSE 0 END, 1) AS completion_rate
FROM surveys s LEFT JOIN survey_responses sr ON sr.survey_id = s.id
GROUP BY s.id, s.title, s.slug, s.is_active, s.created_at ORDER BY s.created_at DESC;

CREATE OR REPLACE VIEW survey_platform_options AS
SELECT ss.id AS step_id, ss.survey_id, ss.step_number, pf.platform_id::uuid, p.name AS platform_name, p.icon_url, p.color
FROM survey_steps ss CROSS JOIN LATERAL jsonb_array_elements_text(ss.platform_filter) AS pf(platform_id)
LEFT JOIN streaming_services p ON p.id = pf.platform_id::uuid WHERE ss.step_type = 'platforms';

CREATE OR REPLACE VIEW v_billing_today AS
SELECT bc.id, bc.charge_date, bc.amount, bc.status, bc.attempt_number, bc.error_message, bc.next_retry_at,
    u.name AS user_name, u.email AS user_email, g.name AS group_name, ss.name AS service_name, us.card_last4, us.card_brand, us.billing_cycle
FROM billing_cycles bc JOIN users u ON u.id = bc.user_id JOIN groups g ON g.id = bc.group_id
JOIN user_subscriptions us ON us.id = bc.subscription_id JOIN streaming_services ss ON ss.id = us.service_id
WHERE bc.charge_date = CURRENT_DATE ORDER BY bc.created_at DESC;

CREATE OR REPLACE VIEW v_billing_calendar AS
SELECT bc.charge_date, COUNT(*) AS total_charges,
    COUNT(*) FILTER (WHERE bc.status = 'approved') AS approved_count,
    COUNT(*) FILTER (WHERE bc.status = 'failed') AS failed_count,
    COUNT(*) FILTER (WHERE bc.status = 'pending') AS pending_count,
    SUM(bc.amount) AS total_amount,
    SUM(bc.amount) FILTER (WHERE bc.status = 'approved') AS approved_amount,
    SUM(bc.amount) FILTER (WHERE bc.status = 'failed') AS failed_amount
FROM billing_cycles bc WHERE bc.charge_date >= CURRENT_DATE - INTERVAL '30 days' AND bc.charge_date <= CURRENT_DATE + INTERVAL '90 days'
GROUP BY bc.charge_date ORDER BY bc.charge_date;

CREATE OR REPLACE VIEW v_billing_failures AS
SELECT bc.id AS cycle_id, bc.charge_date, bc.amount, bc.attempt_number, bc.error_message, bc.error_code, bc.next_retry_at,
    bc.created_at AS first_attempt_at, bc.updated_at AS last_attempt_at,
    u.id AS user_id, u.name AS user_name, u.email AS user_email,
    g.id AS group_id, g.name AS group_name, ss.name AS service_name, us.card_last4, us.card_brand, us.billing_cycle
FROM billing_cycles bc JOIN users u ON u.id = bc.user_id JOIN groups g ON g.id = bc.group_id
JOIN user_subscriptions us ON us.id = bc.subscription_id JOIN streaming_services ss ON ss.id = us.service_id
WHERE bc.status = 'failed' ORDER BY bc.updated_at DESC;

-- ============================================================
-- BLOCO 8: AUTH SYNC TRIGGERS
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
    UPDATE public.users SET
        id = NEW.id, name = COALESCE(NEW.raw_user_meta_data->>'name', public.users.name, NEW.email),
        phone = COALESCE(NEW.raw_user_meta_data->>'phone', public.users.phone),
        marketing_source = COALESCE(NEW.raw_user_meta_data->>'ga_source', public.users.marketing_source),
        marketing_gclid = COALESCE(NEW.raw_user_meta_data->>'ga_gclid', public.users.marketing_gclid),
        marketing_utm_source = COALESCE(NEW.raw_user_meta_data->>'ga_utm_source', public.users.marketing_utm_source),
        marketing_utm_medium = COALESCE(NEW.raw_user_meta_data->>'ga_utm_medium', public.users.marketing_utm_medium),
        marketing_utm_campaign = COALESCE(NEW.raw_user_meta_data->>'ga_utm_campaign', public.users.marketing_utm_campaign),
        marketing_utm_term = COALESCE(NEW.raw_user_meta_data->>'ga_utm_term', public.users.marketing_utm_term),
        marketing_utm_content = COALESCE(NEW.raw_user_meta_data->>'ga_utm_content', public.users.marketing_utm_content),
        marketing_captured_at = COALESCE(NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz, public.users.marketing_captured_at),
        password_hash = 'auth-managed', email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE), updated_at = NOW()
    WHERE public.users.email = NEW.email;
    IF NOT FOUND THEN
        INSERT INTO public.users (id, name, email, phone, marketing_source, marketing_gclid, marketing_utm_source, marketing_utm_medium, marketing_utm_campaign, marketing_utm_term, marketing_utm_content, marketing_captured_at, password_hash, role, status, email_verified, created_at, updated_at)
        VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'name', NEW.email), NEW.email, NEW.raw_user_meta_data->>'phone',
            NEW.raw_user_meta_data->>'ga_source', NEW.raw_user_meta_data->>'ga_gclid', NEW.raw_user_meta_data->>'ga_utm_source',
            NEW.raw_user_meta_data->>'ga_utm_medium', NEW.raw_user_meta_data->>'ga_utm_campaign', NEW.raw_user_meta_data->>'ga_utm_term',
            NEW.raw_user_meta_data->>'ga_utm_content', NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz,
            'auth-managed', CASE WHEN NEW.email = 'admin@dividepass.com' THEN 'admin'::user_role ELSE 'user'::user_role END,
            'active', COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE), NOW(), NOW())
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email, phone = EXCLUDED.phone, email_verified = EXCLUDED.email_verified, updated_at = NOW();
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
    IF NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at THEN
        UPDATE public.users SET email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE), updated_at = NOW() WHERE id = NEW.id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated AFTER UPDATE ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_auth_user_updated();

CREATE OR REPLACE FUNCTION public.handle_user_role_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
BEGIN
    UPDATE auth.users SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role::text) WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_role_updated ON public.users;
CREATE TRIGGER on_user_role_updated AFTER INSERT OR UPDATE OF role ON public.users FOR EACH ROW EXECUTE FUNCTION public.handle_user_role_update();

-- ============================================================
-- BLOCO 9: STORAGE BUCKETS
-- ============================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES ('profile-photos', 'profile-photos', true, 2097152, ARRAY['image/png','image/jpeg','image/webp','image/gif']) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('platform-icons', 'platform-icons', true) ON CONFLICT (id) DO NOTHING;
INSERT INTO storage.buckets (id, name, public) VALUES ('group-covers', 'group-covers', true) ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "Users can view all profiles" ON storage.objects;
CREATE POLICY "Users can view all profiles" ON storage.objects FOR SELECT USING (bucket_id = 'profile-photos');
DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar" ON storage.objects FOR UPDATE USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar" ON storage.objects FOR DELETE USING (bucket_id = 'profile-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
DROP POLICY IF EXISTS "Admins fazem upload de ícones" ON storage.objects;
CREATE POLICY "Admins fazem upload de ícones" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'platform-icons' AND is_admin());
DROP POLICY IF EXISTS "Admins atualizam ícones" ON storage.objects;
CREATE POLICY "Admins atualizam ícones" ON storage.objects FOR UPDATE USING (bucket_id = 'platform-icons' AND is_admin());
DROP POLICY IF EXISTS "Admins removem ícones" ON storage.objects;
CREATE POLICY "Admins removem ícones" ON storage.objects FOR DELETE USING (bucket_id = 'platform-icons' AND is_admin());
DROP POLICY IF EXISTS "Leitura pública de ícones" ON storage.objects;
CREATE POLICY "Leitura pública de ícones" ON storage.objects FOR SELECT USING (bucket_id = 'platform-icons');
DROP POLICY IF EXISTS "Admins fazem upload de capas" ON storage.objects;
CREATE POLICY "Admins fazem upload de capas" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'group-covers' AND is_admin());
DROP POLICY IF EXISTS "Admins atualizam capas" ON storage.objects;
CREATE POLICY "Admins atualizam capas" ON storage.objects FOR UPDATE USING (bucket_id = 'group-covers' AND is_admin());
DROP POLICY IF EXISTS "Admins removem capas" ON storage.objects;
CREATE POLICY "Admins removem capas" ON storage.objects FOR DELETE USING (bucket_id = 'group-covers' AND is_admin());
DROP POLICY IF EXISTS "Leitura pública de capas" ON storage.objects;
CREATE POLICY "Leitura pública de capas" ON storage.objects FOR SELECT USING (bucket_id = 'group-covers');
DROP POLICY IF EXISTS "Users upload group photos" ON storage.objects;
CREATE POLICY "Users upload group photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'group-covers' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Users update group photos" ON storage.objects;
CREATE POLICY "Users update group photos" ON storage.objects FOR UPDATE USING (bucket_id = 'group-covers' AND auth.role() = 'authenticated');
DROP POLICY IF EXISTS "Users delete group photos" ON storage.objects;
CREATE POLICY "Users delete group photos" ON storage.objects FOR DELETE USING (bucket_id = 'group-covers' AND auth.role() = 'authenticated');

-- ============================================================
-- BLOCO 10: APP SETTINGS DEFAULTS
-- ============================================================

INSERT INTO app_settings (key, value) VALUES
    ('gateway_fee_percent', '4.98'),
    ('platform_fee_percent', '3.95'),
    ('default_entrance_fee', '15.00'),
    ('active_gateway', 'mercadopago'),
    ('mercadopago_access_token', ''),
    ('stripe_secret_key', ''),
    ('stripe_webhook_secret', ''),
    ('asaas_api_key', ''),
    ('asaas_env', 'sandbox'),
    ('iopay_secret', ''),
    ('iopay_email', ''),
    ('iopay_seller_id', ''),
    ('smtp_host', 'mail.dividepass.com'),
    ('smtp_port', '465'),
    ('smtp_user_support', 'suporte@dividepass.com'),
    ('smtp_user_noreply', 'noreply@dividepass.com'),
    ('smtp_from_support', 'DividePass Suporte <suporte@dividepass.com>'),
    ('smtp_from_noreply', 'DividePass <noreply@dividepass.com>'),
    ('pagarme_secret_key', ''),
    ('pagarme_public_key', ''),
    ('recurring_billing_cron_secret', 'dp-recurring-billing-cron-2026-secure-key')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- ============================================================
-- PRONTO! Schema completo criado.
-- Agora atualize as variáveis de ambiente na Vercel
-- e faça deploy.
-- ============================================================
