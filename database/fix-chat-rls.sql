-- ============================================================
-- FIX: Chat RLS - SELECT + INSERT para membros
-- ============================================================

-- Remove políticas antigas
DROP POLICY IF EXISTS "Membros veem mensagens do grupo" ON group_messages;
DROP POLICY IF EXISTS "Membros enviam mensagens no grupo" ON group_messages;
DROP POLICY IF EXISTS "Usuários autenticados enviam mensagens" ON group_messages;

-- SELECT: membro do grupo OU assinante ativo
CREATE POLICY "Leitura de mensagens"
  ON group_messages FOR SELECT
  USING (
    group_id IN (
      SELECT gm.group_id FROM group_members gm
      WHERE gm.user_id = auth.uid() AND gm.status = 'active'
    )
    OR group_id IN (
      SELECT us.group_id FROM user_subscriptions us
      WHERE us.user_id = auth.uid() AND us.status = 'active'
    )
  );

-- INSERT: usuário autenticado envia como ele mesmo
CREATE POLICY "Envio de mensagens"
  ON group_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());
