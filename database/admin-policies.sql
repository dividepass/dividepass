-- Policies para admins gerenciarem plataformas, grupos e usuários

-- Remove policies antigas
DROP POLICY IF EXISTS "Admins gerenciam plataformas" ON streaming_services;
DROP POLICY IF EXISTS "Admins gerenciam grupos" ON groups;
DROP POLICY IF EXISTS "Admins gerenciam usuários" ON users;
DROP POLICY IF EXISTS "Admins gerenciam credenciais" ON group_credentials;

-- Helper: verifica se usuário é admin baseado no app_metadata do JWT
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'user') = 'admin';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE POLICY "Admins gerenciam plataformas"
    ON streaming_services
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam grupos"
    ON groups
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam usuários"
    ON users
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam credenciais"
    ON group_credentials
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam assinaturas"
    ON user_subscriptions
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam membros de grupos"
    ON group_members
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam faturas"
    ON invoices
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins gerenciam pagamentos"
    ON payments
    FOR ALL
    USING (public.is_admin())
    WITH CHECK (public.is_admin());
