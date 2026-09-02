-- Trigger para sincronizar auth.users com public.users
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    -- Atualiza usuário existente pelo email (caso tenha sido criado via seed)
    UPDATE public.users
    SET
        id = NEW.id,
        name = COALESCE(NEW.raw_user_meta_data->>'name', public.users.name, NEW.email),
        phone = COALESCE(NEW.raw_user_meta_data->>'phone', public.users.phone),
        marketing_source = COALESCE(NEW.raw_user_meta_data->>'ga_source', public.users.marketing_source),
        marketing_gclid = COALESCE(NEW.raw_user_meta_data->>'ga_gclid', public.users.marketing_gclid),
        marketing_utm_source = COALESCE(NEW.raw_user_meta_data->>'ga_utm_source', public.users.marketing_utm_source),
        marketing_utm_medium = COALESCE(NEW.raw_user_meta_data->>'ga_utm_medium', public.users.marketing_utm_medium),
        marketing_utm_campaign = COALESCE(NEW.raw_user_meta_data->>'ga_utm_campaign', public.users.marketing_utm_campaign),
        marketing_utm_term = COALESCE(NEW.raw_user_meta_data->>'ga_utm_term', public.users.marketing_utm_term),
        marketing_utm_content = COALESCE(NEW.raw_user_meta_data->>'ga_utm_content', public.users.marketing_utm_content),
        marketing_captured_at = COALESCE(NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz, public.users.marketing_captured_at),
        password_hash = 'auth-managed',
        email_verified = COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE),
        updated_at = NOW()
    WHERE public.users.email = NEW.email;

    -- Se não encontrou pelo email, insere novo
    IF NOT FOUND THEN
        INSERT INTO public.users (
            id,
            name,
            email,
            phone,
            marketing_source,
            marketing_gclid,
            marketing_utm_source,
            marketing_utm_medium,
            marketing_utm_campaign,
            marketing_utm_term,
            marketing_utm_content,
            marketing_captured_at,
            password_hash,
            role,
            status,
            email_verified,
            created_at,
            updated_at
        )
        VALUES (
            NEW.id,
            COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
            NEW.email,
            NEW.raw_user_meta_data->>'phone',
            NEW.raw_user_meta_data->>'ga_source',
            NEW.raw_user_meta_data->>'ga_gclid',
            NEW.raw_user_meta_data->>'ga_utm_source',
            NEW.raw_user_meta_data->>'ga_utm_medium',
            NEW.raw_user_meta_data->>'ga_utm_campaign',
            NEW.raw_user_meta_data->>'ga_utm_term',
            NEW.raw_user_meta_data->>'ga_utm_content',
            NULLIF(NEW.raw_user_meta_data->>'ga_captured_at', '')::timestamptz,
            'auth-managed',
            CASE
                WHEN NEW.email = 'admin@dividepass.com' THEN 'admin'::user_role
                ELSE 'user'::user_role
            END,
            'active',
            COALESCE(NEW.email_confirmed_at IS NOT NULL, FALSE),
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
            name = EXCLUDED.name,
            email = EXCLUDED.email,
            phone = EXCLUDED.phone,
            email_verified = EXCLUDED.email_verified,
            updated_at = NOW();
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Trigger para sincronizar email_verified quando email_confirmed_at for alterado
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

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;

CREATE TRIGGER on_auth_user_updated
    AFTER UPDATE ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_auth_user_updated();

-- Trigger para espelhar public.users.role em auth.users raw_app_meta_data
CREATE OR REPLACE FUNCTION public.handle_user_role_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
    UPDATE auth.users
    SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', NEW.role::text)
    WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_user_role_updated ON public.users;

CREATE TRIGGER on_user_role_updated
    AFTER INSERT OR UPDATE OF role ON public.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_user_role_update();
