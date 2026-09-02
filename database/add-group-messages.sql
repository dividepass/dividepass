CREATE TABLE IF NOT EXISTS group_messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_group_messages_group_id ON group_messages(group_id);
CREATE INDEX idx_group_messages_created_at ON group_messages(created_at);

ALTER TABLE group_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Membros veem mensagens do grupo"
  ON group_messages FOR SELECT
  USING (
    group_id IN (
      SELECT gm.group_id FROM group_members gm
      WHERE gm.user_id = auth.uid() AND gm.status = 'active'
    )
  );

CREATE POLICY "Membros enviam mensagens no grupo"
  ON group_messages FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND group_id IN (
      SELECT gm.group_id FROM group_members gm
      WHERE gm.user_id = auth.uid() AND gm.status = 'active'
    )
  );
