-- Permitir que donos do grupo gerenciem suas credenciais
DROP POLICY IF EXISTS "Owners gerenciam credenciais do grupo" ON group_credentials;

CREATE POLICY "Owners gerenciam credenciais do grupo"
    ON group_credentials
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM groups
            WHERE groups.id = group_credentials.group_id
              AND groups.owner_id = auth.uid()
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM groups
            WHERE groups.id = group_credentials.group_id
              AND groups.owner_id = auth.uid()
        )
    );
