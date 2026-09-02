-- 1. Add has_profiles toggle to group_credentials
ALTER TABLE group_credentials
    ADD COLUMN IF NOT EXISTS has_profiles BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Create group_profiles table for individual member profiles
CREATE TABLE IF NOT EXISTS group_profiles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
    profile_name    VARCHAR(255) NOT NULL,
    profile_password VARCHAR(255) NOT NULL,
    assigned_to     UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_profiles_group_id ON group_profiles(group_id);
CREATE INDEX IF NOT EXISTS idx_group_profiles_assigned_to ON group_profiles(assigned_to);

-- updated_at trigger
CREATE OR REPLACE FUNCTION update_group_profiles_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_group_profiles_updated_at ON group_profiles;
CREATE TRIGGER trg_group_profiles_updated_at
    BEFORE UPDATE ON group_profiles
    FOR EACH ROW
    EXECUTE FUNCTION update_group_profiles_updated_at();

-- 3. RLS policies
ALTER TABLE group_profiles ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins gerenciam perfis de grupo"
    ON group_profiles FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Members see their own assigned profiles + unassigned in their groups
CREATE POLICY "Membros veem seus perfis"
    ON group_profiles FOR SELECT
    USING (
        assigned_to = auth.uid()
        OR assigned_to IS NULL
    );

-- 4. Auto-assign profile when member joins
CREATE OR REPLACE FUNCTION auto_assign_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE group_profiles
        SET assigned_to = NEW.user_id
        WHERE group_id = NEW.group_id
        AND assigned_to IS NULL
        AND id = (
            SELECT id FROM group_profiles
            WHERE group_id = NEW.group_id
            AND assigned_to IS NULL
            ORDER BY created_at
            LIMIT 1
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_profile ON group_members;
CREATE TRIGGER trg_auto_assign_profile
    AFTER INSERT OR UPDATE OF status ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_profile();

-- 5. Release profile when member leaves
CREATE OR REPLACE FUNCTION release_profile()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('inactive', 'cancelled') AND OLD.status = 'active' THEN
        UPDATE group_profiles
        SET assigned_to = NULL
        WHERE assigned_to = NEW.user_id
        AND group_id = NEW.group_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_release_profile ON group_members;
CREATE TRIGGER trg_release_profile
    AFTER UPDATE OF status ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION release_profile();
