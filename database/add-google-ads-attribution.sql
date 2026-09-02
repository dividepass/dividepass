-- Persist Google Ads attribution in public.users.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS marketing_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_gclid TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_source TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_medium TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_campaign TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_term TEXT,
  ADD COLUMN IF NOT EXISTS marketing_utm_content TEXT,
  ADD COLUMN IF NOT EXISTS marketing_captured_at TIMESTAMPTZ;
