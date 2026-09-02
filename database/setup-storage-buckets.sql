-- ============================================================
-- MIGRATION: Cria buckets de storage para ícones e capas
-- ============================================================

-- Cria buckets públicos para imagens
INSERT INTO storage.buckets (id, name, public)
VALUES ('platform-icons', 'platform-icons', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('group-covers', 'group-covers', true)
ON CONFLICT (id) DO NOTHING;

-- Policies para admins gerenciarem arquivos
DROP POLICY IF EXISTS "Admins fazem upload de ícones" ON storage.objects;
DROP POLICY IF EXISTS "Admins atualizam ícones" ON storage.objects;
DROP POLICY IF EXISTS "Admins removem ícones" ON storage.objects;
DROP POLICY IF EXISTS "Leitura pública de ícones" ON storage.objects;

CREATE POLICY "Admins fazem upload de ícones"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'platform-icons' AND public.is_admin());

CREATE POLICY "Admins atualizam ícones"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'platform-icons' AND public.is_admin());

CREATE POLICY "Admins removem ícones"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'platform-icons' AND public.is_admin());

CREATE POLICY "Leitura pública de ícones"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'platform-icons');

DROP POLICY IF EXISTS "Admins fazem upload de capas" ON storage.objects;
DROP POLICY IF EXISTS "Admins atualizam capas" ON storage.objects;
DROP POLICY IF EXISTS "Admins removem capas" ON storage.objects;
DROP POLICY IF EXISTS "Leitura pública de capas" ON storage.objects;

CREATE POLICY "Admins fazem upload de capas"
  ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'group-covers' AND public.is_admin());

CREATE POLICY "Admins atualizam capas"
  ON storage.objects FOR UPDATE
  USING (bucket_id = 'group-covers' AND public.is_admin());

CREATE POLICY "Admins removem capas"
  ON storage.objects FOR DELETE
  USING (bucket_id = 'group-covers' AND public.is_admin());

CREATE POLICY "Leitura pública de capas"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'group-covers');
