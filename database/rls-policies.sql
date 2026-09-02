-- Atualiza policies de RLS para o DividePass

-- Remove policies antigas para evitar duplicatas
DROP POLICY IF EXISTS "Usuários veem seu próprio perfil" ON users;
DROP POLICY IF EXISTS "Admins veem todos os usuários" ON users;
DROP POLICY IF EXISTS "Usuários atualizam seu próprio perfil" ON users;
DROP POLICY IF EXISTS "Donos veem perfis dos grupos" ON users;
DROP POLICY IF EXISTS "Usuários veem seus grupos" ON group_members;
DROP POLICY IF EXISTS "Usuários veem suas assinaturas" ON user_subscriptions;
DROP POLICY IF EXISTS "Usuários veem seus pagamentos" ON payments;
DROP POLICY IF EXISTS "Donos veem membros do grupo" ON group_members;
DROP POLICY IF EXISTS "Donos veem assinaturas do grupo" ON user_subscriptions;
DROP POLICY IF EXISTS "Donos veem pagamentos do grupo" ON payments;
DROP POLICY IF EXISTS "Usuários veem suas faturas" ON invoices;
DROP POLICY IF EXISTS "Usuários veem seus tickets" ON support_tickets;
DROP POLICY IF EXISTS "Usuários veem respostas dos seus tickets" ON ticket_replies;
DROP POLICY IF EXISTS "Serviços públicos" ON streaming_services;
DROP POLICY IF EXISTS "Grupos públicos" ON groups;
DROP POLICY IF EXISTS "Avisos publicados" ON announcements;

-- Users: cada um vê seu próprio perfil, admins veem todos
CREATE POLICY "Usuários leem perfis"
    ON users FOR SELECT
    USING (
        auth.uid() = id
        OR COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', 'user') = 'admin'
    );

-- Users: usuário pode atualizar seu próprio perfil
CREATE POLICY "Usuários atualizam seu próprio perfil"
    ON users FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Users: donos veem os perfis dos membros dos grupos que administram
CREATE POLICY "Donos veem perfis dos grupos"
    ON users FOR SELECT
    USING (
        auth.uid() = id
        OR EXISTS (
            SELECT 1
            FROM group_members gm
            JOIN groups g ON g.id = gm.group_id
            WHERE gm.user_id = users.id
              AND g.owner_id = auth.uid()
        )
        OR EXISTS (
            SELECT 1
            FROM user_subscriptions us
            JOIN groups g ON g.id = us.group_id
            WHERE us.user_id = users.id
              AND g.owner_id = auth.uid()
        )
    );

-- group_members: usuários veem seus próprios registros
CREATE POLICY "Usuários veem seus grupos"
    ON group_members FOR SELECT
    USING (user_id = auth.uid());

-- group_members: donos veem os membros dos grupos que administram
CREATE POLICY "Donos veem membros do grupo"
    ON group_members FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = group_members.group_id
          AND g.owner_id = auth.uid()
    ));

-- user_subscriptions: usuários veem suas próprias assinaturas
CREATE POLICY "Usuários veem suas assinaturas"
    ON user_subscriptions FOR SELECT
    USING (user_id = auth.uid());

-- user_subscriptions: donos veem as assinaturas dos seus grupos
CREATE POLICY "Donos veem assinaturas do grupo"
    ON user_subscriptions FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM groups g
        WHERE g.id = user_subscriptions.group_id
          AND g.owner_id = auth.uid()
    ));

-- payments: usuários veem seus próprios pagamentos
CREATE POLICY "Usuários veem seus pagamentos"
    ON payments FOR SELECT
    USING (user_id = auth.uid());

-- payments: donos veem os pagamentos dos seus grupos
CREATE POLICY "Donos veem pagamentos do grupo"
    ON payments FOR SELECT
    USING (
        user_id = auth.uid()
        OR EXISTS (
            SELECT 1 FROM groups g
            WHERE g.id = payments.group_id
              AND g.owner_id = auth.uid()
        )
    );

-- invoices: usuários veem suas próprias faturas
CREATE POLICY "Usuários veem suas faturas"
    ON invoices FOR SELECT
    USING (user_id = auth.uid());

-- support_tickets: usuários veem seus próprios tickets
CREATE POLICY "Usuários veem seus tickets"
    ON support_tickets FOR SELECT
    USING (user_id = auth.uid());

-- ticket_replies: usuários veem respostas dos seus tickets
CREATE POLICY "Usuários veem respostas dos seus tickets"
    ON ticket_replies FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM support_tickets t WHERE t.id = ticket_replies.ticket_id AND t.user_id = auth.uid()
    ));

-- group_credentials: membros veem credenciais dos seus grupos
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

-- Tabelas públicas de leitura
CREATE POLICY "Serviços públicos" ON streaming_services FOR SELECT USING (true);
CREATE POLICY "Grupos públicos" ON groups FOR SELECT USING (true);
CREATE POLICY "Avisos publicados" ON announcements FOR SELECT USING (status = 'published');
