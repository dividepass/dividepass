DROP TABLE IF EXISTS user_card_metadata;

CREATE TABLE IF NOT EXISTS user_card_metadata (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  id_card TEXT NOT NULL,
  last_four TEXT,
  brand TEXT,
  holder_name TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, id_card)
);

ALTER TABLE user_card_metadata ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own card metadata"
  ON user_card_metadata FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own card metadata"
  ON user_card_metadata FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own card metadata"
  ON user_card_metadata FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own card metadata"
  ON user_card_metadata FOR UPDATE
  USING (auth.uid() = user_id);
