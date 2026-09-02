CREATE TABLE IF NOT EXISTS email_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  event_type TEXT NOT NULL,
  email_id TEXT,
  "from" TEXT,
  "to" TEXT,
  subject TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  raw_event JSONB
);

ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read email logs"
  ON email_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM users
      WHERE users.id = auth.uid()
      AND users.role = 'admin'
    )
  );

CREATE INDEX idx_email_logs_event_type ON email_logs(event_type);
CREATE INDEX idx_email_logs_to ON email_logs("to");
CREATE INDEX idx_email_logs_created_at ON email_logs(created_at DESC);
