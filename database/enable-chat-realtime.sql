-- ============================================================
-- FIX: Habilitar Realtime no group_messages
-- ============================================================

-- Replica identity para realtime funcionar
ALTER TABLE group_messages REPLICA IDENTITY FULL;

-- Adicionar tabela à publicação realtime
ALTER PUBLICATION supabase_realtime ADD TABLE group_messages;
