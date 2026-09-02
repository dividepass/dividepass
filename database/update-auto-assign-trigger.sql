-- Update auto-assign trigger to check has_profiles
CREATE OR REPLACE FUNCTION auto_assign_profile()
RETURNS TRIGGER AS $$
DECLARE
    group_has_profiles BOOLEAN;
    has_creds BOOLEAN;
BEGIN
    IF NEW.status = 'active' THEN
        -- Check if group has credentials with profiles enabled
        SELECT c.has_profiles INTO has_creds
        FROM group_credentials c
        WHERE c.group_id = NEW.group_id;

        IF has_creds IS TRUE THEN
            -- Assign first available profile
            UPDATE group_profiles
            SET assigned_to = NEW.user_id, updated_at = NOW()
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
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_auto_assign_profile ON group_members;
CREATE TRIGGER trg_auto_assign_profile
    AFTER INSERT OR UPDATE OF status ON group_members
    FOR EACH ROW
    EXECUTE FUNCTION auto_assign_profile();
