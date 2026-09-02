-- Fix RLS policies for support_tickets and support_messages
-- Drop existing policies
DROP POLICY IF EXISTS "Usuarios criam tickets" ON support_tickets;
DROP POLICY IF EXISTS "Usuarios veem seus tickets" ON support_tickets;
DROP POLICY IF EXISTS "Usuarios atualizam seus tickets" ON support_tickets;
DROP POLICY IF EXISTS "Admins gerenciam tickets" ON support_tickets;

DROP POLICY IF EXISTS "Usuarios veem mensagens de seus tickets" ON support_messages;
DROP POLICY IF EXISTS "Usuarios enviam mensagens" ON support_messages;
DROP POLICY IF EXISTS "Admins gerenciam mensagens" ON support_messages;

-- Tickets: users can see their own
CREATE POLICY "Usuarios veem seus tickets"
    ON support_tickets FOR SELECT
    USING (user_id = auth.uid());

-- Tickets: authenticated users can insert
CREATE POLICY "Usuarios criam tickets"
    ON support_tickets FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Tickets: users can update their own
CREATE POLICY "Usuarios atualizam seus tickets"
    ON support_tickets FOR UPDATE
    USING (user_id = auth.uid());

-- Tickets: admins full access
CREATE POLICY "Admins gerenciam tickets"
    ON support_tickets FOR ALL
    USING (is_admin());

-- Messages: users can see messages on their own tickets + all admin messages
CREATE POLICY "Usuarios veem mensagens de seus tickets"
    ON support_messages FOR SELECT
    USING (
        user_id = auth.uid()
        OR is_admin = TRUE
        OR ticket_id IN (
            SELECT id FROM support_tickets WHERE user_id = auth.uid()
        )
    );

-- Messages: authenticated users can insert
CREATE POLICY "Usuarios enviam mensagens"
    ON support_messages FOR INSERT
    WITH CHECK (auth.uid() IS NOT NULL);

-- Messages: admins full access
CREATE POLICY "Admins gerenciam mensagens"
    ON support_messages FOR ALL
    USING (is_admin());
