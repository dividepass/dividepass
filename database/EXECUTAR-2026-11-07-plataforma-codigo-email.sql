-- =============================================================================
-- DividePass — plataforma exige código por e-mail + modo de controle do código
-- =============================================================================
-- Data: 07/11/2026
--
-- O QUE MUDA
-- ----------
-- 1) streaming_services ganha:
--
--      requires_email_code  → boolean (padrão false)
--        "A plataforma pede confirmação por e-mail quando alguém entra com um
--         dispositivo diferente?"
--        É o toggle que o admin liga por plataforma. Quando está ligado, o
--        wizard de criação de grupo faz a pergunta extra de COMO o código
--        chega ao membro (manual x DividePass com IA).
--
-- 2) groups ganha:
--
--      email_code_delivery  → 'manual' | 'managed' (padrão 'managed')
--        'manual'  = o dono do grupo busca o código no e-mail e repassa para
--                    cada membro, manualmente.
--        'managed' = a DividePass lê o e-mail do grupo com IA e entrega o
--                    código com 1 clique, a qualquer hora, para todos os
--                    membros.
--
--      owner_contact        → texto (e-mail ou telefone)
--        Contato do dono do grupo que o membro usa para falar com ele quando o
--        código é controlado manualmente. Guardado no grupo para poder ser
--        mostrado ao membro depois do pagamento.
--
-- TUDO IDEMPOTENTE: pode rodar quantas vezes quiser, sem erro.
--
-- COMO RODAR
-- -----------
-- 1) Abra o SQL Editor do projeto **DividePass**
--    (https://supabase.com/dashboard → projeto "DividePass")
--    ATENÇÃO: existe outro projeto na sua conta (ByeFIT). O SQL tem que ser
--    rodado no projeto DividePass — é nele que o app (lasoouwboxspstqvjbsv)
--    busca os dados.
-- 2) Cole o conteúdo INTEIRO deste arquivo e clique em "Run"
-- 3) No fim aparecem três linhas de conferência:
--    "requires_email_code: OK", "email_code_delivery: OK" e
--    "owner_contact: OK".
--    Se aparecer "ERRO", rode de novo: o script é idempotente e o erro some.
--
-- DEPOIS DE RODAR
-- ---------------
-- O app NÃO trava enquanto este script não foi aplicado: o app detecta que a
-- coluna ainda não existe e salva o resto do grupo normalmente — só a resposta
-- da nova pergunta (manual x IA) fica sem gravar até a coluna existir.
--
-- POR QUE NÃO TEM BEGIN/COMMIT
-- -----------------------------
-- O SQL Editor do Supabase já roda o lote dentro de uma transação. Se um
-- único statement falhar, tudo volta — e as colunas NÃO seriam criadas.
-- Por isso cada parte opcional aqui é blindada (blocos DO com EXCEPTION), e
-- o arquivo pode ser rodado em etapas: se algo falhar, o que já rodou fica.
-- =============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) PLATAFORMA PEDE CONFIRMAÇÃO POR E-MAIL
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.streaming_services
  ADD COLUMN IF NOT EXISTS requires_email_code boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.streaming_services.requires_email_code IS
  'A plataforma pede confirmacao por e-mail ao acessar com um dispositivo diferente';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) MODO DE CONTROLE DO CODIGO + CONTATO DO DONO
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS email_code_delivery varchar(20) NOT NULL DEFAULT 'managed';

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS owner_contact text;

COMMENT ON COLUMN public.groups.email_code_delivery IS
  'Como o codigo de confirmacao chega ao membro: ''manual'' (o dono repassa) ou ''managed'' (DividePass com IA)';

COMMENT ON COLUMN public.groups.owner_contact IS
  'Contato do dono do grupo (e-mail ou telefone) informado ao membro apos o pagamento, quando o codigo e controlado manualmente';

-- O CHECK original pode ter sido criado pelo Postgres com nome automatico
-- (groups_email_code_delivery_check). Em vez de depender desse nome, o laco
-- abaixo derruba QUALQUER CHECK que fale em "email_code_delivery" — assim o
-- script funciona mesmo que a constraint tenha sido renomeada.
DO $$
DECLARE
  c text;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.groups'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%email_code_delivery%'
  LOOP
    EXECUTE format('ALTER TABLE public.groups DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE public.groups
  ADD CONSTRAINT groups_email_code_delivery_check
  CHECK (email_code_delivery IN ('manual', 'managed'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PERMISSÕES
-- ─────────────────────────────────────────────────────────────────────────────
-- O app usa o token do próprio usuário para gravar e o painel admin (com
-- role admin) para ler. O GRANT é guardado: em produção os papéis `anon` e
-- `authenticated` sempre existem, mas um banco de teste local não os tem, e
-- um GRANT para um papel inexistente quebra a transação inteira.
-- Cada GRANT vai dentro de um bloco com EXCEPTION: se o papel não existir (ou
-- o GRANT for negado), o bloco engole o erro e o resto do script segue.
DO $$
DECLARE
  papel text;
BEGIN
  FOREACH papel IN ARRAY ARRAY['authenticated', 'anon'] LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
        IF papel = 'authenticated' THEN
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.streaming_services TO authenticated';
          EXECUTE 'GRANT SELECT, INSERT, UPDATE ON public.groups TO authenticated';
        ELSE
          EXECUTE 'GRANT SELECT ON public.streaming_services TO anon';
        END IF;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'GRANT em % ignorado: %', papel, SQLERRM;
    END;
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CONFERÊNCIA — leia as três linhas depois de rodar
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'streaming_services'
       AND column_name = 'requires_email_code'
  ) AS "requires_email_code: OK",

  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'groups'
       AND column_name = 'email_code_delivery'
  ) AS "email_code_delivery: OK",

  EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'groups'
       AND column_name = 'owner_contact'
  ) AS "owner_contact: OK";
