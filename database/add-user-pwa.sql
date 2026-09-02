-- PWA install tracking for first-login gate
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS pwa_installed_at TIMESTAMPTZ;
