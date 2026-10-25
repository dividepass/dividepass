-- ============================================================
-- Tabela: user_feedback
-- Feedback livre do usuário (o que ele gostaria de ter na
-- plataforma). Criada junto com o CTA "Dar feedback" do
-- dashboard do usuário.
--
-- A gravação é feita pela edge function `send-feedback` com a
-- service role; as policies abaixo valem para o caso de o
-- cliente escrever direto (ou para leitura pelo admin).
-- ============================================================

CREATE TABLE IF NOT EXISTS user_feedback (
  id          UUID        NOT NULL DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT        NOT NULL,
  page        TEXT,                    -- de onde veio o feedback (ex.: 'dashboard')
  status      TEXT        NOT NULL DEFAULT 'new'
              CHECK (status IN ('new', 'reviewed', 'done')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_feedback_user_id
  ON user_feedback(user_id);

CREATE INDEX IF NOT EXISTS idx_user_feedback_status
  ON user_feedback(status, created_at DESC);

COMMENT ON TABLE user_feedback IS
  'Feedback livre enviado pelo usuário pelo CTA do dashboard. O mesmo
   conteúdo chega por e-mail para a caixa da equipe.';

-- ── RLS ──────────────────────────────────────────────────────
ALTER TABLE user_feedback ENABLE ROW LEVEL SECURITY;

-- Usuário vê apenas o próprio feedback.
DROP POLICY IF EXISTS "Usuarios veem seus feedbacks" ON user_feedback;
CREATE POLICY "Usuarios veem seus feedbacks"
  ON user_feedback FOR SELECT
  USING (user_id = auth.uid());

-- Usuário envia feedback em nome próprio.
DROP POLICY IF EXISTS "Usuarios enviam feedback" ON user_feedback;
CREATE POLICY "Usuarios enviam feedback"
  ON user_feedback FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- Admin acessa todos os feedbacks.
DROP POLICY IF EXISTS "Admins gerenciam feedbacks" ON user_feedback;
CREATE POLICY "Admins gerenciam feedbacks"
  ON user_feedback FOR ALL
  USING (is_admin());
