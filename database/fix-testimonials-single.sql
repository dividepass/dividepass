-- Single migration for testimonials.
-- Creates table, admin helper, RLS policies and insert RPC.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.testimonials (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  user_name TEXT NOT NULL,
  user_role TEXT,
  text TEXT NOT NULL,
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users
    WHERE id = auth.uid()
      AND role = 'admin'
  );
$$;

ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read approved testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can read own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can insert own testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can update own pending testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Users can delete own pending testimonials" ON public.testimonials;
DROP POLICY IF EXISTS "Admin full access on testimonials" ON public.testimonials;

CREATE POLICY "Public can read approved testimonials"
  ON public.testimonials FOR SELECT
  USING (status = 'approved');

CREATE POLICY "Users can read own testimonials"
  ON public.testimonials FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own testimonials"
  ON public.testimonials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own pending testimonials"
  ON public.testimonials FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending')
  WITH CHECK (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Users can delete own pending testimonials"
  ON public.testimonials FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

CREATE POLICY "Admin full access on testimonials"
  ON public.testimonials FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.create_testimonial(
  p_user_id uuid,
  p_user_name text,
  p_user_role text,
  p_text text,
  p_rating integer
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  testimonial_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF auth.uid() <> p_user_id THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  INSERT INTO public.testimonials (
    user_id,
    user_name,
    user_role,
    text,
    rating,
    status
  ) VALUES (
    p_user_id,
    p_user_name,
    p_user_role,
    p_text,
    p_rating,
    'pending'
  )
  RETURNING id INTO testimonial_id;

  RETURN testimonial_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_testimonial(uuid, text, text, text, integer) TO authenticated;
