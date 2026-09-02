-- ============================================================
-- MIGRATION: Sistema de Indicações (Referrals/Invitations)
-- ============================================================
-- Tabela de configuração de pontos:
--   10 pontos por indicação bem-sucedida (invitee se inscreve em qualquer grupo)
--   5 pontos bônus se o invitee entra no mesmo grupo do referrer
-- ============================================================

-- Função: Gerar código de indicação de 8 caracteres (alphanumeric maiúsculo)
CREATE OR REPLACE FUNCTION generate_referral_code(user_uuid UUID)
RETURNS VARCHAR(20) AS $$
DECLARE
    code VARCHAR(20);
    exists_count INTEGER;
BEGIN
    LOOP
        code := UPPER(SUBSTRING(MD5(user_uuid::TEXT || NOW()::TEXT) FROM 1 FOR 8));
        SELECT COUNT(*) INTO exists_count FROM user_referral_codes WHERE referral_code = code;
        EXIT WHEN exists_count = 0;
    END LOOP;
    RETURN code;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------
-- 1. TABELA: user_referral_codes
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_referral_codes (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id         UUID NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    referral_code   VARCHAR(20) NOT NULL UNIQUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_referral_codes_user ON user_referral_codes(user_id);
CREATE INDEX IF NOT EXISTS idx_referral_codes_code ON user_referral_codes(referral_code);

-- RLS: usuários veem seu próprio código, admin vê todos
ALTER TABLE user_referral_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_referral_code" ON user_referral_codes
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "admin_all_referral_codes" ON user_referral_codes
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );

-- ----------------------------------------------------------
-- 2. TABELA: referrals
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS referrals (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    referrer_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invitee_id      UUID REFERENCES users(id) ON DELETE SET NULL,
    referral_code   VARCHAR(20) NOT NULL,
    group_id        UUID REFERENCES groups(id) ON DELETE SET NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending', 'completed', 'cancelled')),
    points          INTEGER NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS idx_referrals_invitee ON referrals(invitee_id);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_group ON referrals(group_id);

-- RLS: referrer ou invitee podem ver, admin vê tudo, referrer pode inserir
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_read_own_referrals" ON referrals
    FOR SELECT USING (
        auth.uid() = referrer_id OR auth.uid() = invitee_id
    );

CREATE POLICY "users_insert_own_referrals" ON referrals
    FOR INSERT WITH CHECK (auth.uid() = referrer_id);

CREATE POLICY "admin_all_referrals" ON referrals
    FOR ALL USING (
        EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    );

-- ----------------------------------------------------------
-- 3. FUNÇÃO: Auto-criar código de indicação no cadastro
-- ----------------------------------------------------------
-- Nota: O trigger é no auth.users, mas como pode não ter acesso
-- ao public schema, este trigger deve ser gerenciado pela aplicação.
-- Abaixo está a função para referência:
-- ----------------------------------------------------------

CREATE OR REPLACE FUNCTION handle_new_user_referral()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO user_referral_codes (user_id, referral_code)
    VALUES (NEW.id, generate_referral_code(NEW.id));
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------
-- 4. FUNÇÃO: Notificar membros quando alguém sai do grupo
-- ----------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_group_members_on_leave()
RETURNS TRIGGER AS $$
DECLARE
    group_rec RECORD;
    member_record RECORD;
BEGIN
    -- Só dispara quando status muda para 'inactive'
    IF NEW.status = 'inactive' AND (OLD.status IS NULL OR OLD.status != 'inactive') THEN
        SELECT * INTO group_rec FROM groups WHERE id = NEW.group_id;

        -- Notifica todos os membros ativos restantes
        FOR member_record IN
            SELECT gm.user_id
            FROM group_members gm
            WHERE gm.group_id = NEW.group_id
            AND gm.status = 'active'
            AND gm.user_id != NEW.user_id
        LOOP
            INSERT INTO notifications (user_id, title, message)
            VALUES (
                member_record.user_id,
                'Um membro do seu grupo saiu!',
                'Um membro do grupo ' || group_rec.name || ' saiu. Quer convidar algum amigo ou familiar? Ganhe pontuações e descontos!'
            );
        END LOOP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_notify_group_members_on_leave ON group_members;
CREATE TRIGGER trg_notify_group_members_on_leave
    AFTER UPDATE ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION notify_group_members_on_leave();

-- ----------------------------------------------------------
-- 5. SEED: Gerar códigos de indicação para usuários existentes
-- ----------------------------------------------------------
DO $$
DECLARE
    user_record RECORD;
BEGIN
    FOR user_record IN SELECT id FROM users WHERE id NOT IN (SELECT user_id FROM user_referral_codes)
    LOOP
        INSERT INTO user_referral_codes (user_id, referral_code)
        VALUES (user_record.id, generate_referral_code(user_record.id));
    END LOOP;
END $$;
