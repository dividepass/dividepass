-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — DIAGNÓSTICO: por que o membro não enxerga a credencial
-- ═══════════════════════════════════════════════════════════════════════════
-- Uso: colar no SQL Editor do Supabase (dividepass). É SOMENTE LEITURA.
--
-- ⚠ CORREÇÃO 27/10: `group_credentials` NÃO tem coluna `created_at` (tem
--   `updated_at`). Queries que ordenavam por `created_at` quebravam com
--   42703. Aqui usa-se `updated_at` / `id`.
--
-- Troque o GROUP_ID nas consultas 1 e 2 pelo grupo que está reclamando.
-- ═══════════════════════════════════════════════════════════════════════════

-- ───────────────────────────────────────────────────────────────────────────
-- 1) A CREDENCIAL DO GRUPO
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  c.id                                        AS cred_id,
  c.group_id,
  c.credential_type,
  c.login_email,
  (c.login_password IS NOT NULL AND c.login_password <> '') AS tem_senha,
  c.has_profiles,
  c.assigned_to,
  u.email                                     AS atribuida_a,
  (SELECT count(*) FROM public.group_credentials x
    WHERE x.group_id = c.group_id)            AS credenciais_no_grupo,
  CASE
    WHEN c.assigned_to IS NULL
      THEN 'COMPARTILHADA (assigned_to = NULL) — visível a todo membro ativo'
    ELSE 'TRAVADA EM UM MEMBRO (assigned_to preenchido) — os OUTROS não enxergam'
  END                                         AS situacao
FROM public.group_credentials c
LEFT JOIN public.users u ON u.id = c.assigned_to
WHERE c.group_id = 'daff4caf-c513-4231-89f2-62c5f1063c8b'
ORDER BY c.updated_at DESC;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) MEMBROS: quem enxerga e quem é barrado pelo RLS
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  gm.user_id,
  u.email,
  gm.status                                   AS membro_status,
  gm.payment_status,
  sub.status                                  AS assinatura_status,
  cred.assigned_to                            AS cred_atribuida_a,
  CASE
    WHEN cred.assigned_to = gm.user_id
      THEN 'ENXERGA a credencial (assigned_to = eu)'
    WHEN cred.assigned_to IS NULL AND gm.status = 'active'
      THEN 'ENXERGA a credencial (compartilhada + membro ativo)'
    WHEN cred.assigned_to IS NULL AND sub.status = 'active'
      THEN 'ENXERGA a credencial (compartilhada + assinatura ativa)'
    WHEN cred.assigned_to IS NULL
      THEN '*** NAO ENXERGA *** (compartilhada, mas sem membro ativo nem assinatura ativa)'
    ELSE '*** NAO ENXERGA *** (credencial travada em outro membro)'
  END                                         AS veredito
FROM public.group_members gm
LEFT JOIN public.users u ON u.id = gm.user_id
LEFT JOIN LATERAL (
  SELECT s.status FROM public.user_subscriptions s
  WHERE s.group_id = gm.group_id AND s.user_id = gm.user_id
  ORDER BY s.created_at DESC LIMIT 1
) sub ON true
LEFT JOIN LATERAL (
  SELECT c.assigned_to FROM public.group_credentials c
  WHERE c.group_id = gm.group_id
  ORDER BY c.updated_at DESC LIMIT 1
) cred ON true
WHERE gm.group_id = 'daff4caf-c513-4231-89f2-62c5f1063c8b'
ORDER BY gm.created_at;

-- ───────────────────────────────────────────────────────────────────────────
-- 3) POLICIES E TRIGGERS (o que decide a visibilidade)
-- ───────────────────────────────────────────────────────────────────────────
SELECT policyname, cmd, roles::text, qual AS using_expr, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'group_credentials'
ORDER BY cmd, policyname;

-- trigger que "roubava" a credencial do grupo para o primeiro membro ativo
SELECT tgname, pg_get_triggerdef(oid) AS definicao
FROM pg_trigger
WHERE tgrelid = 'public.group_members'::regclass AND NOT tgisinternal
ORDER BY tgname;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4) VERIFICAÇÃO PÓS-CORREÇÃO (rodar depois de aplicar a correção)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 4.1) Nenhuma credencial de grupo compartilhado pode ficar travada.
--      Esperado: 0 linhas. (Grupos de conta INDIVIDUAL por membro — mais de
--      uma credencial no grupo — podem manter a atribuição.)
--
-- SELECT c.id, c.group_id, g.name, u.email AS atribuida_a
--   FROM public.group_credentials c
--   LEFT JOIN public.groups g ON g.id = c.group_id
--   LEFT JOIN public.users  u ON u.id = c.assigned_to
--  WHERE c.assigned_to IS NOT NULL
--    AND (SELECT count(*) FROM group_credentials x WHERE x.group_id = c.group_id) = 1;
--
-- 4.2) As 3 policies de group_credentials devem existir:
--      SELECT — "Members read own credentials"
--      ALL   — "Admins gerenciam credenciais"
--      ALL   — "Owners gerenciam credenciais do grupo"
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname = 'public' AND tablename = 'group_credentials'
--  ORDER BY cmd, policyname;
--
-- 4.3) O trigger corrigido só atribui quando o grupo tem MAIS DE UMA
--      credencial (conta individual). Conferir que o "count(*) > 1" está lá:
--
-- SELECT pg_get_functiondef('public.auto_assign_credential()'::regprocedure);
--
-- 4.4) Placar da plataforma:
--
-- SELECT count(*) FILTER (WHERE assigned_to IS NULL)     AS compartilhadas,
--        count(*) FILTER (WHERE assigned_to IS NOT NULL) AS travadas,
--        count(*)                                        AS total
--   FROM public.group_credentials;
-- ═══════════════════════════════════════════════════════════════════════════
