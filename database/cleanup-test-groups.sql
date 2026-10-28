-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Limpeza dos grupos/contas de teste (2026-10-27)
-- Rodar no SQL Editor do Supabase (dashboard). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- CONTEXTO
--
-- Durante os testes de "Busca de Código por E-mail" e do wizard de criação de
-- grupo, duas contas descartáveis ficaram presas em produção. Elas não podem
-- ser apagadas pelo app porque o dono (RLS) não é mais acessível — os e-mails
-- foram criados com timestamp em milissegundos e não ficaram registrados.
--
-- O que sobrou (medido em produção em 2026-10-27):
--
--   grupo  d15d9cd9-8a05-44e0-92e9-8a08ca747747  "Teste Busca Codigo"
--          owner 4572dc55-88c9-4a15-92b1-25a64d9eb828
--   grupo  1f8ba7e7-dfc1-40aa-9b37-8147225f7f86  "Probe Fn Codigo"
--          owner 62d41c09-3a5e-4ab5-92a0-c8ec852bb0d6
--
-- Cada uma tem 1 linha em public.users e 1 usuário em auth.users.
--
-- POR QUE PRECISA DO SQL EDITOR
--
-- DELETE em groups/users respeita RLS: só o dono ou um admin apaga. E os
-- e-mails dessas contas se perderam, então nem o app consegue autenticar
-- para apagar. Só o SQL Editor (service_role do painel) consegue.

BEGIN;

-- 1) grupos de teste
DELETE FROM public.groups
 WHERE id IN (
   'd15d9cd9-8a05-44e0-92e9-8a08ca747747',
   '1f8ba7e7-dfc1-40aa-9b37-8147225f7f86'
 );

-- 2) perfis públicos das mesmas contas
DELETE FROM public.users
 WHERE id IN (
   '4572dc55-88c9-4a15-92b1-25a64d9eb828',
   '62d41c09-3a5e-4ab5-92a0-c8ec852bb0d6'
 );

-- 3) usuários de autenticação (auth.users é do schema auth, fora do RLS app)
--    o ON DELETE CASCADE de auth.users já remove as linhas dependentes de
--    public.users/public.groups, mas a ordem 1->2->3 evita deixar resíduo.
DELETE FROM auth.users
 WHERE id IN (
   '4572dc55-88c9-4a15-92b1-25a64d9eb828',
   '62d41c09-3a5e-4ab5-92a0-c8ec852bb0d6'
 );

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificacao (deve devolver 0 linhas nas duas consultas)
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT id, name, owner_id, status
--   FROM public.groups
--  WHERE id IN ('d15d9cd9-8a05-44e0-92e9-8a08ca747747',
--               '1f8ba7e7-dfc1-40aa-9b37-8147225f7f86');
--
-- SELECT id, email
--   FROM public.users
--  WHERE id IN ('4572dc55-88c9-4a15-92b1-25a64d9eb828',
--               '62d41c09-3a5e-4ab5-92a0-c8ec852bb0d6');
