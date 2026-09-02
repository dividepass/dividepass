-- ============================================================
-- MIGRATION: Foto do grupo + Storage policy para usuários
-- ============================================================

ALTER TABLE groups ADD COLUMN IF NOT EXISTS photo_url TEXT DEFAULT NULL;

-- Permitir que usuários autenticados façam upload de fotos de grupo
DROP POLICY IF EXISTS "Users upload group photos" ON storage.objects;
CREATE POLICY "Users upload group photos"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'group-covers' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users update group photos" ON storage.objects;
CREATE POLICY "Users update group photos"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'group-covers' AND auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Users delete group photos" ON storage.objects;
CREATE POLICY "Users delete group photos"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'group-covers' AND auth.role() = 'authenticated');
