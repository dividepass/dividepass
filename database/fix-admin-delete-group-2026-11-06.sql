-- ============================================================
-- CORREÇÃO: exclusão de grupo pelo admin não pode ser barrada
-- Data: 2026-11-06
-- ============================================================
--
-- O QUE ACONTECIA
-- ---------------
-- O painel admin chamava a edge function `delete-group`, que apaga o grupo
-- com service_role — ou seja, SEM RLS (as políticas de privacidade não são
-- avaliadas nesse caminho). O que barrava a exclusão não era política de
-- privacidade: era a chave estrangeira `payments_group_id_fkey`, criada em
-- database/add-payment-flow.sql:30 SEM `ON DELETE` (default = NO ACTION).
-- Com qualquer pagamento apontando para o grupo, o DELETE falhava:
--
--   update or delete on table "groups" violates foreign key constraint
--   "payments_group_id_fkey" on table "payments"
--
-- O QUE ESTE ARQUIVO FAZ
-- ----------------------
-- 1. Garante que TODA chave estrangeira que aponta para public.groups tenha
--    uma regra ON DELETE explícita:
--      - filho do grupo (membros, credenciais, perfis, mensagens) -> CASCADE
--      - registro de dinheiro/log (payments, invoices, carteira) -> SET NULL
--        (o dinheiro continua registrado; só se desliga do grupo).
-- 2. Cria public.group_has_paid_payments(uuid): enxerga os pagamentos de
--    todos os usuários (SECURITY DEFINER), porque o RLS de payments só
--    mostra o próprio pagamento para quem não é dono/admin.
-- 3. Policies de `groups`:
--      - admin        -> apaga qualquer grupo (FOR ALL, is_admin());
--      - usuário comum-> apaga o próprio grupo, mas só quando não existe
--                        pagamento confirmado (a regra de acerto vale para
--                        ele; para o admin, não).
-- 4. SELECT final: mostra o estado das FKs e das policies. A saída do SQL
--    Editor é a conferência.
--
-- COMO RODAR
-- ----------
-- SQL Editor do projeto DividePass (lasoouwboxspstqvjbsv), colar o arquivo
-- INTEIRO e executar. É idempotente: pode rodar duas vezes sem efeito extra.
-- NÃO usar BEGIN/COMMIT (o editor já abre a transação).

-- ───────────────────────────────────────────────────────────────────────────
-- 1. CHAVES ESTRANGEIRAS QUE APONTAM PARA public.groups
-- ───────────────────────────────────────────────────────────────────────────
-- Por que o DROP + ADD: não existe "ALTER CONSTRAINT ... ON DELETE"; a
-- única forma de trocar a regra é derrubar e recriar o constraint.
--
-- Por que NOT VALID: o constraint já existe e já está válido; recriá-lo
-- com validação obrigaria um scan completo de cada tabela filha e quebraria
-- a migration inteira se existisse alguma linha órfã. A regra ON DELETE
-- (CASCADE / SET NULL) vale de qualquer forma para as linhas existentes.
DO $$
DECLARE
  r         RECORD;
  v_col     TEXT;
  v_regra   TEXT;
  v_notnull BOOLEAN;
  v_total   INTEGER;
BEGIN
  FOR r IN
    SELECT c.conname,
           c.confdeltype,
           c.conrelid,
           c.conkey,
           cl.relname AS tabela
    FROM pg_constraint c
    JOIN pg_class cl     ON cl.oid = c.conrelid
    JOIN pg_class par    ON par.oid = c.confrelid
    JOIN pg_namespace n  ON n.oid = cl.relnamespace
    WHERE c.contype = 'f'
      AND par.relname = 'groups'
      AND par.relnamespace = 'public'::regnamespace
      AND n.nspname = 'public'
  LOOP
    -- coluna do FK (grupo de colunas: usa a primeira)
    SELECT a.attname, a.attnotnull
      INTO v_col, v_notnull
      FROM pg_attribute a
     WHERE a.attrelid = r.conrelid
       AND a.attnum = r.conkey[1];

    IF v_col IS NULL THEN
      RAISE WARNING 'FK % em %: coluna nao encontrada, pulando', r.conname, r.tabela;
      CONTINUE;
    END IF;

    -- regra desejada por tabela
    v_regra := CASE
      WHEN r.tabela IN ('payments', 'invoices', 'wallet_transactions',
                         'wallet_withdrawals', 'billing_logs', 'referrals',
                         'coupon_uses')
        THEN 'SET NULL'   -- dinheiro/log: o registro continua, sem o grupo
      ELSE 'CASCADE'     -- filho do grupo: some junto com ele
    END;

    -- coluna NOT NULL não aceita SET NULL -> CASCADE
    IF v_notnull THEN
      v_regra := 'CASCADE';
    END IF;

    -- já está na regra desejada? (confdeltype: a=NO ACTION r=RESTRICT
    -- c=CASCADE n=SET NULL) -> não mexe
    IF (v_regra = 'CASCADE'    AND r.confdeltype = 'c')
       OR (v_regra = 'SET NULL' AND r.confdeltype = 'n') THEN
      CONTINUE;
    END IF;

    EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT %I', r.tabela, r.conname);
    EXECUTE format(
      'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (%I) '
      'REFERENCES public.groups(id) ON DELETE %s NOT VALID',
      r.tabela, r.conname, v_col, v_regra);

    RAISE NOTICE 'FK % em %: ON DELETE %s (antes: %)',
      r.conname, r.tabela, v_regra, r.confdeltype;
  END LOOP;

  -- rede de segurança: se sobrou FK alguma, o DELETE do grupo pode falhar
  SELECT count(*) INTO v_total
    FROM pg_constraint c
    JOIN pg_class par ON par.oid = c.confrelid
   WHERE c.contype = 'f'
     AND par.relname = 'groups'
     AND par.relnamespace = 'public'::regnamespace;

  IF v_total = 0 THEN
    RAISE EXCEPTION 'Nenhuma FK para public.groups foi encontrada — revise este arquivo antes de rodar.';
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2. O DONO DO GRUPO NÃO APAGA GRUPO COM DINHEIRO DENTRO
-- ───────────────────────────────────────────────────────────────────────────
-- O helper é SECURITY DEFINER porque o RLS de payments só entrega ao usuário
-- os PRÓPRIOS pagamentos; sem isso, o dono do grupo "não veria" o pagamento
-- de outra pessoa e o RLS deixaria passar a exclusão.
CREATE OR REPLACE FUNCTION public.group_has_paid_payments(p_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.payments p
     WHERE p.group_id = p_group_id
       AND p.status = 'paid'
  );
$$;

REVOKE ALL ON FUNCTION public.group_has_paid_payments(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.group_has_paid_payments(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.group_has_paid_payments(uuid) IS
  'Verdadeiro se o grupo tem ao menos um pagamento confirmado (status=paid). '
  'SECURITY DEFINER para enxergar os pagamentos de todos os usuarios.';

-- ───────────────────────────────────────────────────────────────────────────
-- 3. POLICIES DE public.groups
-- ───────────────────────────────────────────────────────────────────────────
-- 3.0 Garante que public.is_admin() existe (a policy do admin depende dela).
--     Se o projeto já tem a função — a versão canônica está em
--     database/fix-p0-security.sql — ela NÃO é tocada: aqui só se cria
--     quando está faltando.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'is_admin'
  ) THEN
    CREATE FUNCTION public.is_admin()
    RETURNS boolean
    LANGUAGE sql
    STABLE
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $fn$
      SELECT
        COALESCE((auth.jwt() -> 'app_metadata' ->> 'role') = 'admin', false)
        OR COALESCE(
             (
               SELECT u.role = 'admin'
                 FROM public.users u
                WHERE u.id = auth.uid()
             ),
             false
           );
    $fn$;

    REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
    RAISE NOTICE 'public.is_admin() nao existia e foi criada';
  END IF;
END $$;

-- 3.1 Limpa policies de DELETE que NÃO tinham a proteção (qualquer uma que
--     não fale de admin nem de group_has_paid_payments). Sem isso, uma policy
--     antiga "dono apaga o próprio grupo" continuaria liberando a exclusão
--     para usuário comum.
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT policyname, COALESCE(qual, '') AS qual
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename  = 'groups'
       AND cmd        = 'DELETE'
  LOOP
    IF p.qual NOT ILIKE '%group_has_paid_payments%'
       AND p.qual NOT ILIKE '%admin%' THEN
      EXECUTE format('DROP POLICY %I ON public.groups', p.policyname);
      RAISE NOTICE 'Policy de DELETE sem proteção removida: %', p.policyname;
    END IF;
  END LOOP;
END $$;

-- 3.2 Admin: gerencia qualquer grupo, inclusive apagar com pagamento dentro.
DROP POLICY IF EXISTS "Admins gerenciam grupos" ON public.groups;
CREATE POLICY "Admins gerenciam grupos"
  ON public.groups
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 3.3 Usuário comum: apaga o próprio grupo — mas só se não houver
--     pagamento confirmado (a regra de acerto com quem pagou vale para ele).
DROP POLICY IF EXISTS "Users delete own groups" ON public.groups;
CREATE POLICY "Users delete own groups"
  ON public.groups
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = owner_id
    AND NOT public.group_has_paid_payments(id)
  );

-- ───────────────────────────────────────────────────────────────────────────
-- 4. CONFERÊNCIA (a saída deste SELECT é o que aparece no SQL Editor)
-- ───────────────────────────────────────────────────────────────────────────
-- 4.1 Toda FK que aponta para groups, com a regra de ON DELETE:
SELECT cl.relname AS tabela,
       c.conname AS constraint,
       CASE c.confdeltype
         WHEN 'a' THEN 'NO ACTION'
         WHEN 'r' THEN 'RESTRICT'
         WHEN 'c' THEN 'CASCADE'
         WHEN 'n' THEN 'SET NULL'
         WHEN 'd' THEN 'SET DEFAULT'
       END AS on_delete
  FROM pg_constraint c
  JOIN pg_class cl    ON cl.oid = c.conrelid
  JOIN pg_class par   ON par.oid = c.confrelid
  JOIN pg_namespace n ON n.oid = cl.relnamespace
 WHERE c.contype = 'f'
   AND par.relname = 'groups'
   AND par.relnamespace = 'public'::regnamespace
   AND n.nspname = 'public'
 ORDER BY cl.relname, c.conname;

-- 4.2 Policies de groups:
SELECT policyname, cmd, roles::text AS roles,
       COALESCE(qual, '')      AS usando,
       COALESCE(with_check, '') AS usando_no_insert_update
  FROM pg_policies
 WHERE schemaname = 'public' AND tablename = 'groups'
 ORDER BY cmd, policyname;

-- 4.3 Lixo: pagamento apontando para grupo que não existe mais
DO $$
DECLARE
  v_total INTEGER;
BEGIN
  SELECT count(*) INTO v_total
    FROM public.payments p
   WHERE p.group_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.groups g WHERE g.id = p.group_id);
  IF v_total > 0 THEN
    RAISE WARNING 'payments: % linha(s) com group_id orfao (o grupo foi apagado antes desta correcao)', v_total;
  END IF;
END $$;

-- O PostgREST guarda o schema em cache: avisa para recarregar.
NOTIFY pgrst, 'reload schema';
