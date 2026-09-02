-- Permitir que qualquer usuário autenticado veja os membros de qualquer grupo
-- Necessário para a página de detalhes do grupo
CREATE POLICY "Membros visíveis em grupos"
    ON group_members FOR SELECT
    USING (auth.role() = 'authenticated');
