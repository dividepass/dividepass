-- Add assigned_to column to link credentials to specific group members
ALTER TABLE group_credentials
    ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(id) ON DELETE SET NULL;

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_group_credentials_assigned_to ON group_credentials(assigned_to);

-- Update RLS: members can only see credentials assigned to them
DROP POLICY IF EXISTS "Membros veem credenciais dos seus grupos" ON group_credentials;
CREATE POLICY "Membros veem suas credenciais atribuídas"
    ON group_credentials FOR SELECT
    USING (
        assigned_to = auth.uid()
        OR assigned_to IS NULL
        OR is_admin()
    );

-- Function to auto-assign credential when member joins
CREATE OR REPLACE FUNCTION auto_assign_credential()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'active' THEN
        UPDATE group_credentials
        SET assigned_to = NEW.user_id
        WHERE group_id = NEW.group_id
        AND assigned_to IS NULL
        AND id = (
            SELECT id FROM group_credentials
            WHERE group_id = NEW.group_id
            AND assigned_to IS NULL
            ORDER BY id
            LIMIT 1
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop old trigger if exists
DROP TRIGGER IF EXISTS trg_auto_assign_credential ON group_members;

-- Create trigger
CREATE TRIGGER trg_auto_assign_credential
    AFTER INSERT OR UPDATE OF status ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_credential();

-- Also handle credential release when member leaves
CREATE OR REPLACE FUNCTION release_credential()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('inactive', 'cancelled') AND OLD.status = 'active' THEN
        UPDATE group_credentials
        SET assigned_to = NULL
        WHERE assigned_to = NEW.user_id
        AND group_id = NEW.group_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_release_credential ON group_members;
CREATE TRIGGER trg_release_credential
    AFTER UPDATE OF status ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION release_credential();
