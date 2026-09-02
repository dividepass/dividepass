-- ============================================================
-- FIX: Chat RLS - Permitir envio de mensagens
-- ============================================================

-- Remove a política antiga restritiva
DROP POLICY IF EXISTS "Membros enviam mensagens no grupo" ON group_messages;

-- Política mais simples: qualquer usuário autenticado pode enviar
-- como garantir que é ele mesmo (user_id = auth.uid())
CREATE POLICY "Usuários autenticados enviam mensagens"
  ON group_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());
