CREATE TABLE IF NOT EXISTS custom_charges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_code TEXT UNIQUE NOT NULL,
  amount NUMERIC(10,2) NOT NULL,
  description TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'pix',
  status TEXT NOT NULL DEFAULT 'pending',
  created_by UUID REFERENCES users(id),
  gateway TEXT DEFAULT 'iopay',
  gateway_transaction_id TEXT,
  paid_at TIMESTAMPTZ,
  paid_amount NUMERIC(10,2),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE custom_charges ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins can manage custom charges" ON custom_charges
    FOR ALL USING (
      EXISTS (SELECT 1 FROM users WHERE users.id = auth.uid() AND users.role = 'admin')
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone can view pending custom charges by reference" ON custom_charges
    FOR SELECT USING (status = 'pending');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS idx_custom_charges_reference ON custom_charges(reference_code);
CREATE INDEX IF NOT EXISTS idx_custom_charges_status ON custom_charges(status);
