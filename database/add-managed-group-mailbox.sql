-- ============================================================================
-- E-MAIL GERENCIADO PELA DIVIDEPASS (caixa exclusiva do grupo + IA)
-- ============================================================================
-- Data: 2026-10-31
-- Execute no SQL Editor do Supabase (roda como postgres).
--
-- O QUE MUDOU
--   1. `group_mailboxes` ganha 3 colunas:
--        managed_email  -> a caixa foi criada pela DividePass (nao digitada a mao)
--        provisioned_at -> quando a caixa foi criada
--        managed_by     -> quem provedou ('dividepass')
--   2. Nova funcao `group_managed_email(group_id)`: devolve SO o endereco de
--      e-mail do grupo para quem tem vinculo com ele (membro, assinante ou dono).
--
-- POR QUE UMA FUNCAO E NAO UMA POLICY
--   A RLS filtra LINHAS, nao COLUNAS. Dizer "o membro pode ler group_mailboxes"
--   entregaria a ele tambem `email_imap_password` — a senha da caixa que guarda
--   o codigo de verificacao da assinatura compartilhada. Isso e exatamente o
--   vazamento que o fix-p0-security.sql travou.
--   Entao a leitura do endereco passa por uma funcao SECURITY DEFINER que
--   devolve apenas o e-mail, e so para quem tem vinculo com o grupo.
--   A senha IMAP continua visivel so para admin e service_role.
-- ============================================================================

-- ---------------------------------------------------------------- 1. colunas
-- `groups.managed_email` e a INTENCAO do dono ("quero e-mail gerenciado com
-- IA"). Ela fica separada de `groups.email_code_enabled` de proposito:
--   - `email_code_enabled` = a busca de codigo existe para o membro (so vale
--     a pena quando a caixa foi de fato criada);
--   - `managed_email`      = o dono pediu o e-mail gerenciado (vale mesmo se
--     a criacao da caixa falhar — a tela "Gerenciar Grupo" mostra o botao
--     para tentar de novo).
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS managed_email boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.groups.managed_email IS
  'Dono pediu o e-mail do grupo gerenciado pela DividePass com IA.';

ALTER TABLE public.group_mailboxes
  ADD COLUMN IF NOT EXISTS managed_email boolean NOT NULL DEFAULT false;

ALTER TABLE public.group_mailboxes
  ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;

ALTER TABLE public.group_mailboxes
  ADD COLUMN IF NOT EXISTS managed_by text;

COMMENT ON COLUMN public.group_mailboxes.managed_email IS
  'true quando a caixa foi criada pela DividePass (com IA). O endereco dela e o que o membro deve usar na conta da plataforma.';
COMMENT ON COLUMN public.group_mailboxes.provisioned_at IS
  'Momento em que a caixa gerenciada foi criada no servidor de e-mail.';
COMMENT ON COLUMN public.group_mailboxes.managed_by IS
  'Quem criou a caixa (dividepass = automacao da plataforma).';

-- ------------------------------------------------- 2. funcao de leitura
-- Devolve o e-mail do grupo para quem tem vinculo com ele.
-- Nao devolve senha, nem servidor IMAP, nem porta.
CREATE OR REPLACE FUNCTION public.group_managed_email(p_group_id uuid)
RETURNS TABLE (
  email_address text,
  managed boolean,
  ai_enabled boolean,
  provisioned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Sem sessao: nao devolve nada.
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  -- Sem vinculo com o grupo: nao devolve nada (mesmo chamador autenticado).
  IF NOT EXISTS (
    SELECT 1
    FROM public.groups g
    WHERE g.id = p_group_id
      AND (
        g.owner_id = v_uid
        OR EXISTS (
          SELECT 1 FROM public.group_members m
          WHERE m.group_id = g.id AND m.user_id = v_uid AND m.status = 'active'
        )
        OR EXISTS (
          SELECT 1 FROM public.user_subscriptions s
          WHERE s.group_id = g.id AND s.user_id = v_uid AND s.status = 'active'
        )
      )
  ) THEN
    RETURN;
  END IF;

  RETURN QUERY
    SELECT mb.email_address, mb.managed_email, mb.email_ai_enabled, mb.provisioned_at
    FROM public.group_mailboxes mb
    WHERE mb.group_id = p_group_id
      AND mb.managed_email = true
      AND mb.email_address IS NOT NULL;
END;
$$;

COMMENT ON FUNCTION public.group_managed_email(uuid) IS
  'E-mail gerenciado do grupo. Le apenas para membros, assinantes e dono — nunca expoe a senha IMAP.';

GRANT EXECUTE ON FUNCTION public.group_managed_email(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.group_managed_email(uuid) FROM anon;

-- ------------------------------------------------- 3. conferencia
-- Esperado: 1 linha com a coluna email_address.
--
--   SELECT * FROM public.group_managed_email('<group_id>');
--
-- As colunas novas existem?
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'group_mailboxes' ORDER BY ordinal_position;
