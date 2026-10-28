-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — CORREÇÃO: membro não enxerga a credencial do grupo
-- ═══════════════════════════════════════════════════════════════════════════
-- Rodar no SQL Editor do Supabase (dividepass) — projeto lasoouwboxspstqvjbsv.
-- Idempotente: pode rodar mais de uma vez.
--
-- ───────────────────────────────────────────────────────────────────────────
-- O QUE ESTÁ QUEBRADO (4 defeitos, todos no mesmo caminho)
-- ───────────────────────────────────────────────────────────────────────────
--
-- [1] O TRIGGER ROBA A CREDENCIAL COMPARTILHADA
--     `trg_auto_assign_credential` roda em todo INSERT/UPDATE de
--     `group_members` e, quando o membro fica `status='active'`, faz:
--         UPDATE group_credentials SET assigned_to = NEW.user_id
--          WHERE group_id = ... AND assigned_to IS NULL
--     O painel admin (GroupForm.jsx) grava **UMA** credencial por grupo
--     ("Compartilhadas entre todos os membros do grupo") — então o primeiro
--     membro que paga fica DONO da linha, e o `assigned_to` deixa de ser NULL.
--
-- [2] A POLICY DE LEITURA SÓ DEIXA PASSAR assigned_to IS NULL
--     "Members read own credentials" (database/fix-p0-security.sql:493) só
--     libera a credencial compartilhada quando `assigned_to IS NULL` **E** o
--     membro está `status='active'`. Com [1] acontece, essa condição morre
--     para todo mundo — menos para quem ficou com a atribuição.
--     Resultado na tela: "Nenhuma credencial foi configurada para este grupo
--     ainda." — mas a credencial EXISTE (o admin vê no /admin/groups/:id/edit).
--
-- [3] AS POLICIES DE ESCRITA SUMIRAM
--     O P0 (2026-10-24) dropou TODAS as policies de group_credentials e
--     recriou só a de SELECT. As de escrita ("Admins gerenciam credenciais",
--     "Owners gerenciam credenciais do grupo") nunca voltaram — o script
--     database/fix-credentials-write-rls.sql existe no repo mas NUNCA foi
--     aplicado. Efeito: INSERT do painel admin → 403; UPDATE → **0 linhas
--     afetadas SEM erro** → o painel jura "Grupo atualizado com sucesso!"
--     e nada foi salvo.
--
-- [4] CRITÉRIO DE ACESSO DIVERGENTE
--     A edge function `fetch-email-code` aceita membro ativo **OU**
--     assinatura ativa. A policy exige as duas coisas (membro ativo). Um
--     pagante cuja linha de group_members ficou fora de 'active' pagou e não
--     vê a credencial.
--
-- ───────────────────────────────────────────────────────────────────────────
-- A CORREÇÃO
-- ───────────────────────────────────────────────────────────────────────────
--  A) Recria as policies de ESCRITA (admin + dono do grupo).
--  B) Ajusta o trigger: só há atribuição individual quando o grupo tem MAIS
--     DE UMA credencial (contas separadas por membro). Com uma credencial só,
--     ela é compartilhada e continua visível a todo membro ativo.
--  C) Devolve ao estado "compartilhada" as credenciais que o trigger roubou
--     (só grupos com UMA credencial — os de conta individual por membro
--     mantêm a atribuição).
--  D) Policy de SELECT passa a aceitar "membro ativo OU assinatura ativa",
--     igual ao critério que a edge function já usa.
--
-- ───────────────────────────────────────────────────────────────────────────

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- A) POLICIES DE ESCRITA (admin + dono do grupo)
-- ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Admins gerenciam credenciais" ON public.group_credentials;
CREATE POLICY "Admins gerenciam credenciais"
  ON public.group_credentials
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

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
-- B) TRIGGER: só atribui quando o grupo tem MAIS DE UMA credencial
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_assign_credential()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  -- Grupo com UMA credencial = conta compartilhada: ela NÃO é de ninguém,
  -- e por isso precisa continuar legível para todos os membros ativos.
  -- Grupo com VÁRIAS credenciais = uma conta por membro: aí sim a atribuição
  -- automática faz sentido (e é o comportamento original).
  IF NEW.status = 'active'
     AND (SELECT count(*) FROM public.group_credentials gc
           WHERE gc.group_id = NEW.group_id) > 1 THEN
    UPDATE public.group_credentials
    SET assigned_to = NEW.user_id
    WHERE group_id = NEW.group_id
      AND assigned_to IS NULL
      AND id = (
        SELECT id FROM public.group_credentials
        WHERE group_id = NEW.group_id
          AND assigned_to IS NULL
        ORDER BY id
        LIMIT 1
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_assign_credential ON public.group_members;
CREATE TRIGGER trg_auto_assign_credential
  AFTER INSERT OR UPDATE OF status ON public.group_members
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_credential();

-- ───────────────────────────────────────────────────────────────────────────
-- C) DEVOLVE AO ESTADO COMPARTILHADO O QUE O TRIGGER ROUBOU
--    (só grupos com UMA credencial; os de conta individual ficam como estão)
-- ───────────────────────────────────────────────────────────────────────────
WITH alvo AS (
  SELECT c.id
  FROM public.group_credentials c
  WHERE c.assigned_to IS NOT NULL
    AND (SELECT count(*) FROM public.group_credentials x
         WHERE x.group_id = c.group_id) = 1
), snap AS (
  SELECT c.id, c.group_id, g.name AS grupo, u.email AS era_de
  FROM public.group_credentials c
  JOIN alvo a ON a.id = c.id
  LEFT JOIN public.groups g ON g.id = c.group_id
  LEFT JOIN public.users  u ON u.id = c.assigned_to
)
UPDATE public.group_credentials c
SET assigned_to = NULL,
    updated_at  = NOW()
FROM snap
WHERE c.id = snap.id
RETURNING c.id AS cred_id, c.group_id, snap.grupo, snap.era_de AS estava_travada_em;

-- ───────────────────────────────────────────────────────────────────────────
-- D) POLICY DE LEITURA: membro ativo OU assinatura ativa
-- ───────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Members read own credentials" ON public.group_credentials;
CREATE POLICY "Members read own credentials"
  ON public.group_credentials
  FOR SELECT
  TO authenticated
  USING (
    public.is_admin()
    OR assigned_to = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.groups g
      WHERE g.id = group_credentials.group_id
        AND g.owner_id = auth.uid()
    )
    OR (
      assigned_to IS NULL
      AND (
        EXISTS (
          SELECT 1 FROM public.group_members gm
          WHERE gm.group_id = group_credentials.group_id
            AND gm.user_id = auth.uid()
            AND gm.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM public.user_subscriptions us
          WHERE us.group_id = group_credentials.group_id
            AND us.user_id = auth.uid()
            AND us.status = 'active'
        )
      )
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICAÇÃO (rodar depois do COMMIT)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- 1) Credenciais que ainda estão travadas (tem de ser 0 nos grupos de conta
--    compartilhada; em grupos de conta individual por membro pode ter):
--
-- SELECT c.id, c.group_id, g.name, c.assigned_to, u.email AS atribuida_a
--   FROM public.group_credentials c
--   LEFT JOIN public.groups g ON g.id = c.group_id
--   LEFT JOIN public.users  u ON u.id = c.assigned_to
--  WHERE c.assigned_to IS NOT NULL;
--
-- 2) Policies de group_credentials (devem ser 3: SELECT + 2 de escrita):
--
-- SELECT policyname, cmd FROM pg_policies
--  WHERE schemaname='public' AND tablename='group_credentials'
--  ORDER BY cmd, policyname;
--
-- 3) O membro reclamante deve enxergar a credencial agora. O teste honesto
--    é com o JWT DELE: abrir /dashboard/credentials/<servico>?group=<grupo>
--    logado como o usuário que reclamou.
-- ═══════════════════════════════════════════════════════════════════════════
