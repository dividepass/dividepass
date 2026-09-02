CREATE TABLE IF NOT EXISTS payment_attempts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  group_id UUID NOT NULL,
  gateway TEXT NOT NULL,
  payment_method TEXT NOT NULL,
  payment_type TEXT NOT NULL,
  amount NUMERIC(10,2),
  currency TEXT DEFAULT 'BRL',
  status TEXT NOT NULL DEFAULT 'created',
  gateway_transaction_id TEXT,
  gateway_response JSONB DEFAULT '{}',
  error_message TEXT,
  external_reference TEXT,
  pix_copy_paste TEXT,
  pix_qrcode_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payment_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Users can view own payment attempts"
    ON payment_attempts FOR SELECT
    USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Service role can manage payment attempts"
    ON payment_attempts FOR ALL
    USING (true)
    WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_payment_attempts_user ON payment_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_group ON payment_attempts(group_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_gateway_tx ON payment_attempts(gateway_transaction_id);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_external_ref ON payment_attempts(external_reference);
CREATE INDEX IF NOT EXISTS idx_payment_attempts_created ON payment_attempts(created_at DESC);
