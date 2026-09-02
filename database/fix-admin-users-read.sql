-- ============================================================
-- FIX: RLS users - sem recursão
-- ============================================================

-- Remove policies antigas que causam recursão
DROP POLICY IF EXISTS "Admins leem todos os usuários" ON users;
DROP POLICY IF EXISTS "Authenticated users read basic info" ON users;
DROP POLICY IF EXISTS "Usuários veem seu próprio perfil" ON users;
DROP POLICY IF EXISTS "Usuários atualizam seu próprio perfil" ON users;
DROP POLICY IF EXISTS "Admins veem todos os usuários" ON users;

-- Todos os usuários autenticados podem ver perfil de outros (nome, email, telefone)
-- Isso resolve InterestList, referrals, Users admin, etc.
CREATE POLICY "Authenticated users read profiles"
    ON users FOR SELECT
    USING (auth.role() = 'authenticated');

-- Usuários autenticados podem atualizar apenas o próprio perfil
CREATE POLICY "Users update own profile"
    ON users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
