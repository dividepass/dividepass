-- Sincroniza email_verified quando email_confirmed_at é atualizado (autoconfirm)
DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE OR REPLACE FUNCTION public.handle_auth_user_updated()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    IF NEW.email_confirmed_at IS DISTINCT FROM OLD.email_confirmed_at THEN
        UPDATE public.users
        SET
            email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE),
            updated_at = NOW()
        WHERE id = NEW.id;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auth_user_updated();

-- Backfill existing confirmed users
UPDATE public.users u
SET email_verified = TRUE
FROM auth.users a
WHERE u.id = a.id AND a.email_confirmed_at IS NOT NULL AND u.email_verified = FALSE;
