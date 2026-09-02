-- Corrige a policy recursiva de admin
DROP POLICY IF EXISTS "Admins veem todos os usuários" ON users;

-- Usa auth.jwt() para evitar recursão (assume que o role do app está no token)
-- Nota: por padrão o role do Supabase Auth é 'authenticated', não o role do app.
-- Para admin no frontend, o app busca o próprio perfil e verifica public.users.role.
-- Esta policy permite apenas leitura do próprio perfil.
DROP POLICY IF EXISTS "Usuários veem seu próprio perfil" ON users;
CREATE POLICY "Usuários veem seu próprio perfil"
    ON users FOR SELECT
    USING (auth.uid() = id);

DROP POLICY IF EXISTS "Usuários atualizam seu próprio perfil" ON users;
CREATE POLICY "Usuários atualizam seu próprio perfil"
    ON users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);
