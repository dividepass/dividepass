-- Tabela de depoimentos
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

-- RLS
ALTER TABLE public.testimonials ENABLE ROW LEVEL SECURITY;

-- Anyone can read approved testimonials (for landing page)
CREATE POLICY "Public can read approved testimonials"
  ON public.testimonials FOR SELECT
  USING (status = 'approved');

-- Authenticated users can read their own testimonials
CREATE POLICY "Users can read own testimonials"
  ON public.testimonials FOR SELECT
  USING (auth.uid() = user_id);

-- Authenticated users can insert their own testimonials
CREATE POLICY "Users can insert own testimonials"
  ON public.testimonials FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Authenticated users can update their own testimonials (only if pending)
CREATE POLICY "Users can update own pending testimonials"
  ON public.testimonials FOR UPDATE
  USING (auth.uid() = user_id AND status = 'pending');

-- Authenticated users can delete their own testimonials (only if pending)
CREATE POLICY "Users can delete own pending testimonials"
  ON public.testimonials FOR DELETE
  USING (auth.uid() = user_id AND status = 'pending');

-- Admin full access via is_admin()
CREATE POLICY "Admin full access on testimonials"
  ON public.testimonials FOR ALL
  USING (public.is_admin());

-- Indexes
CREATE INDEX IF NOT EXISTS idx_testimonials_status ON public.testimonials(status);
CREATE INDEX IF NOT EXISTS idx_testimonials_user_id ON public.testimonials(user_id);
