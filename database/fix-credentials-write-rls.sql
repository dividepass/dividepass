-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Restaura as policies de ESCRITA que o fix-p0-security.sql
-- removeu (2026-10-24, via Management API). Rodar no SQL Editor.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE ACONTECEU
--
-- `database/fix-p0-security.sql`, na secao 7, tem um DO block que DROPA TODAS
-- as policies de 4 tabelas:
--
--   FOREACH t IN ARRAY ARRAY[
--     'group_profiles','group_credentials','support_messages','platform_events'
--   ] LOOP ... DROP POLICY IF EXISTS ... END LOOP;
--
-- Depois do drop, o script recriou SO UMA policy por tabela, todas de SELECT:
--
--   group_credentials  -> "Members read own credentials"   (FOR SELECT)
--   group_profiles    -> "Members read own group profiles" (FOR SELECT)
--   support_messages  -> "Users read own ticket messages"  (FOR SELECT)
--   platform_events   -> "Admins read platform events" (SELECT) + INSERT (ok)
--
-- As policies de ESCRITA ("Admins gerenciam credenciais" FOR ALL, "Owners
-- gerenciam credenciais do grupo" FOR ALL) foram apagadas e NUNCA voltaram.
--
-- O EFEITO (medido em producao)
--
--   INSERT group_credentials -> 403 "new row violates row-level security policy
--                                 for table group_credentials"
--   INSERT group_profiles   -> 403 (mesma classe de bug)
--   INSERT support_messages -> 403 (mensagem de ticket nao sai)
--
-- Ou seja: o painel admin (/admin/groups/new e /admin/groups/:id/edit) quebra
-- ao salvar credencial, e NINGUEM consegue responder um ticket de suporte.
--
-- IMPORTANTE — por que UPDATE nao complains
--
-- INSERT sem WITH CHECK => erro. UPDATE/DELETE sem policy => o RLS filtra as
-- linhas e a statement afeta ZERO linhas, SEM erro. Ou seja, o caminho de
-- UPDATE some em silencio: o front acha que salvou e nao salvou.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) group_credentials — credencial do servico compartilhado
-- ───────────────────────────────────────────────────────────────────────────
-- Admin: gerencia qualquer credencial (o painel admin grava do browser com o
-- JWT do admin — precisa de WITH CHECK, nao so de USING).
DROP POLICY IF EXISTS "Admins gerenciam credenciais" ON public.group_credentials;
CREATE POLICY "Admins gerenciam credenciais"
  ON public.group_credentials
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Dono do grupo: gerencia a credencial do proprio grupo (ManageGroup.jsx).
DROP POLICY IF EXISTS "Owners gerenciam credenciais do grupo" ON public.group_credentials;
CREATE POLICY "Owners gerenciam credenciais do grupo"
  ON public.group_credentials
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_credentials.group_id
        AND g.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_credentials.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 2) group_profiles — perfis individuais dos membros
-- ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins gerenciam perfis do grupo" ON public.group_profiles;
CREATE POLICY "Admins gerenciam perfis do grupo"
  ON public.group_profiles
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Owners gerenciam perfis do grupo" ON public.group_profiles;
CREATE POLICY "Owners gerenciam perfis do grupo"
  ON public.group_profiles
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_profiles.group_id
        AND g.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_profiles.group_id
        AND g.owner_id = auth.uid()
    )
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 3) support_messages — conversa do ticket
-- ───────────────────────────────────────────────────────────────────────────
-- Admin responde o ticket (AdminTicketDetail.jsx).
DROP POLICY IF EXISTS "Admins gerenciam mensagens do suporte" ON public.support_messages;
CREATE POLICY "Admins gerenciam mensagens do suporte"
  ON public.support_messages
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Dono do ticket escreve no proprio ticket (TicketDetail.jsx / CreateTicket.jsx).
DROP POLICY IF EXISTS "Donos do ticket enviam mensagens" ON public.support_messages;
CREATE POLICY "Donos do ticket enviam mensagens"
  ON public.support_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.support_tickets st
      WHERE st.id = support_messages.ticket_id
        AND st.user_id = auth.uid()
    )
  );

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificacao
-- ───────────────────────────────────────────────────────────────────────────
-- Deve listar 2 policies de group_credentials (admin + dono) e 2 de
-- group_profiles, alem das 2 de SELECT que ja existiam.
--
-- SELECT tablename, policyname, cmd
--   FROM pg_policies
--  WHERE schemaname = 'public'
--    AND tablename IN ('group_credentials','group_profiles','support_messages')
--  ORDER BY tablename, cmd, policyname;
