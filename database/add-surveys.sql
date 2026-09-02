-- ============================================
-- SURVEYS / PESQUISAS SYSTEM
-- ============================================

-- Enum for step types
DO $$ BEGIN
  CREATE TYPE step_type AS ENUM ('info', 'question', 'platforms');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Enum for question types
DO $$ BEGIN
  CREATE TYPE question_type AS ENUM ('single', 'multiple', 'yes_no');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- SURVEYS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS surveys (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  slug TEXT UNIQUE NOT NULL,
  is_active BOOLEAN DEFAULT true,
  show_in_catalog BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-generate slug from title
CREATE OR REPLACE FUNCTION generate_survey_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    NEW.slug := LOWER(REGEXP_REPLACE(
      REGEXP_REPLACE(NEW.title, '[^a-zA-Z0-9\s-]', '', 'g'),
      '\s+', '-', 'g'
    ));
    -- Ensure uniqueness
    IF EXISTS (SELECT 1 FROM surveys WHERE slug = NEW.slug AND id != NEW.id) THEN
      NEW.slug := NEW.slug || '-' || SUBSTRING(NEW.id::text FROM 1 FOR 6);
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_survey_slug ON surveys;
CREATE TRIGGER trg_survey_slug
  BEFORE INSERT OR UPDATE ON surveys
  FOR EACH ROW EXECUTE FUNCTION generate_survey_slug();

-- ============================================
-- SURVEY STEPS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS survey_steps (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE NOT NULL,
  step_number INT NOT NULL,
  step_type step_type NOT NULL DEFAULT 'info',
  title TEXT NOT NULL,
  description TEXT,
  is_required BOOLEAN DEFAULT true,
  
  -- For question steps
  question_type question_type,
  options JSONB DEFAULT '[]'::jsonb,
  -- options format: [{ "label": "Netflix", "value": "netflix", "icon": "url" }]
  
  -- For info steps
  content TEXT,
  image_url TEXT,
  
  -- For platforms step (auto-populated from admin-selected platforms)
  platform_filter JSONB DEFAULT '[]'::jsonb,
  -- platform_filter format: ["netflix", "disney", "prime"] — selected platform IDs
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(survey_id, step_number)
);

-- ============================================
-- SURVEY RESPONSES TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS survey_responses (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  survey_id UUID REFERENCES surveys(id) ON DELETE CASCADE NOT NULL,
  
  -- User info (collected at step 0)
  respondent_name TEXT NOT NULL,
  respondent_email TEXT,
  respondent_phone TEXT,
  respondent_whatsapp TEXT,
  
  -- All answers stored as JSONB
  -- format: { "step_id": { "value": "...", "label": "..." }, ... }
  answers JSONB DEFAULT '{}'::jsonb,
  
  -- Metadata
  ip_address TEXT,
  user_agent TEXT,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================
CREATE INDEX IF NOT EXISTS idx_survey_steps_survey ON survey_steps(survey_id, step_number);
CREATE INDEX IF NOT EXISTS idx_survey_responses_survey ON survey_responses(survey_id);
CREATE INDEX IF NOT EXISTS idx_survey_responses_created ON survey_responses(created_at DESC);

-- ============================================
-- RLS POLICIES
-- ============================================

-- Surveys
ALTER TABLE surveys ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS " surveys_select_public" ON surveys;
CREATE POLICY " surveys_select_public"
  ON surveys FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "surveys_select_admin" ON surveys;
CREATE POLICY "surveys_select_admin"
  ON surveys FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "surveys_insert_admin" ON surveys;
CREATE POLICY "surveys_insert_admin"
  ON surveys FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "surveys_update_admin" ON surveys;
CREATE POLICY "surveys_update_admin"
  ON surveys FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "surveys_delete_admin" ON surveys;
CREATE POLICY "surveys_delete_admin"
  ON surveys FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Survey Steps
ALTER TABLE survey_steps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "survey_steps_select_public" ON survey_steps;
CREATE POLICY "survey_steps_select_public"
  ON survey_steps FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM surveys WHERE id = survey_id AND is_active = true)
  );

DROP POLICY IF EXISTS "survey_steps_select_admin" ON survey_steps;
CREATE POLICY "survey_steps_select_admin"
  ON survey_steps FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "survey_steps_insert_admin" ON survey_steps;
CREATE POLICY "survey_steps_insert_admin"
  ON survey_steps FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "survey_steps_update_admin" ON survey_steps;
CREATE POLICY "survey_steps_update_admin"
  ON survey_steps FOR UPDATE
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS "survey_steps_delete_admin" ON survey_steps;
CREATE POLICY "survey_steps_delete_admin"
  ON survey_steps FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- Survey Responses
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;

-- Public can INSERT (submit response)
DROP POLICY IF EXISTS "survey_responses_insert_public" ON survey_responses;
CREATE POLICY "survey_responses_insert_public"
  ON survey_responses FOR INSERT
  WITH CHECK (true);

-- Admin can SELECT all
DROP POLICY IF EXISTS "survey_responses_select_admin" ON survey_responses;
CREATE POLICY "survey_responses_select_admin"
  ON survey_responses FOR SELECT
  TO authenticated
  USING (public.is_admin());

-- Admin can DELETE
DROP POLICY IF EXISTS "survey_responses_delete_admin" ON survey_responses;
CREATE POLICY "survey_responses_delete_admin"
  ON survey_responses FOR DELETE
  TO authenticated
  USING (public.is_admin());

-- ============================================
-- VIEWS
-- ============================================

-- Survey stats view
CREATE OR REPLACE VIEW survey_stats AS
SELECT
  s.id AS survey_id,
  s.title,
  s.slug,
  s.is_active,
  s.created_at,
  COUNT(sr.id) AS total_responses,
  COUNT(CASE WHEN sr.completed_at IS NOT NULL THEN 1 END) AS completed_responses,
  ROUND(
    CASE WHEN COUNT(sr.id) > 0
      THEN (COUNT(CASE WHEN sr.completed_at IS NOT NULL THEN 1 END)::decimal / COUNT(sr.id) * 100)
      ELSE 0
    END, 1
  ) AS completion_rate
FROM surveys s
LEFT JOIN survey_responses sr ON sr.survey_id = s.id
GROUP BY s.id, s.title, s.slug, s.is_active, s.created_at
ORDER BY s.created_at DESC;

-- ============================================
-- PLATFORMS INTEGRATION
-- Create a view that joins survey platform selections with platform data
-- ============================================
CREATE OR REPLACE VIEW survey_platform_options AS
SELECT
  ss.id AS step_id,
  ss.survey_id,
  ss.step_number,
  pf.platform_id::uuid,
  p.name AS platform_name,
  p.icon_url,
  p.color
FROM survey_steps ss
CROSS JOIN LATERAL jsonb_array_elements_text(ss.platform_filter) AS pf(platform_id)
LEFT JOIN streaming_services p ON p.id = pf.platform_id::uuid
WHERE ss.step_type = 'platforms';
