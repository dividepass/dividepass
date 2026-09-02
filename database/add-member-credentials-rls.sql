-- Allow group members to SELECT credentials for their groups
CREATE POLICY "Membros veem credenciais dos seus grupos"
    ON group_credentials FOR SELECT
    USING (
        group_id IN (
            SELECT gm.group_id
            FROM group_members gm
            WHERE gm.user_id = auth.uid()
            AND gm.status = 'active'
        )
    );
