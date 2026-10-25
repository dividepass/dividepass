-- ============================================================
-- FIX: RLS da tabela notifications
--
-- A tabela foi criada em `add-notifications-table.sql` sem nenhuma
-- policy. Quando o RLS foi ligado na tabela, o Postgres passou a
-- negar TODO acesso (RLS ligado + zero policies = nega tudo).
--
-- Efeito: todo `supabase.from('notifications').insert(...)` feito pelo
-- app era descartado em silencio, sem erro na tela:
--   - src/pages/admin/Platforms.jsx  (aprovar/recusar grupo)
--   - src/pages/admin/Groups.jsx     (aprovar/recusar grupo)
--   - src/pages/admin/AdminDashboard.jsx (aprovar inline na fila)
--
-- As policies abaixo liberam o caminho correto:
--   - admin gerencia qualquer notificacao
--   - usuario le e marca como lida apenas as proprias
--
-- Triggers que gravam em notifications (ex.: membro que saiu do grupo)
-- continuam funcionando: rodam como dono da funcao e nao sao afetados
-- por RLS.
-- ============================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- Admin: gerencia todas as notificacoes
DROP POLICY IF EXISTS "Admins gerenciam notificacoes" ON public.notifications;
CREATE POLICY "Admins gerenciam notificacoes"
    ON public.notifications FOR ALL
    USING (is_admin())
    WITH CHECK (is_admin());

-- Usuario: le apenas as proprias notificacoes
DROP POLICY IF EXISTS "Usuarios leem suas notificacoes" ON public.notifications;
CREATE POLICY "Usuarios leem suas notificacoes"
    ON public.notifications FOR SELECT
    USING (user_id = auth.uid());

-- Usuario: marca as proprias notificacoes como lidas
DROP POLICY IF EXISTS "Usuarios atualizam suas notificacoes" ON public.notifications;
CREATE POLICY "Usuarios atualizam suas notificacoes"
    ON public.notifications FOR UPDATE
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());
