-- Sincroniza public.users.role -> auth.users.raw_app_meta_data.role
CREATE OR REPLACE FUNCTION public.sync_user_role_to_auth()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role::text)
    WHERE id = NEW.id
      AND COALESCE(raw_app_meta_data ->> 'role', '') IS DISTINCT FROM NEW.role::text;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_role_change ON public.users;

CREATE TRIGGER on_user_role_change
    AFTER INSERT OR UPDATE OF role ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_user_role_to_auth();

-- Backfill existing users
UPDATE auth.users u
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', p.role::text)
FROM public.users p
WHERE u.id = p.id;
