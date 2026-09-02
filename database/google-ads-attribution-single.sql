-- Single SQL for Google Ads attribution + auth sync.
-- Replaces: add-google-ads-attribution.sql + attribution fields in auth-sync.sql

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS marketing_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_gclid TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_term TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_content TEXT,
  ADD COLUMN IF NOT EXISTS marketing_captured_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
BEGIN
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
