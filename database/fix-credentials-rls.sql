-- Corrige RLS: membros ativos do grupo veem todas as credenciais do grupo
-- (não apenas as atribuídas a eles)

DROP POLICY IF EXISTS "Membros veem suas credenciais atribuídas" ON group_credentials;

CREATE POLICY "Membros veem credenciais do seu grupo"
    ON group_credentials FOR SELECT
    USING (
        is_admin()
        OR EXISTS (
            SELECT 1 FROM group_members gm
            WHERE gm.group_id = group_credentials.group_id
            AND gm.user_id = auth.uid()
            AND gm.status = 'active'
        )
    );
