-- ============================================================================
-- CPF NO PERFIL — o checkout só pergunta o que está faltando
-- ============================================================================
-- Data: 07/11/2026
-- Motivo: a Woovi só cria a ASSINATURA (Pix Automático) de um cliente que ela
--         resolve pelo `taxID` (CPF). Quem JÁ TEM o CPF cadastrado não pode ser
--         obrigado a digitar de novo a cada compra — e quem NÃO tem precisa
--         ser avisado ANTES de clicar em pagar.
--
-- O QUE ESTE ARQUIVO FAZ
-- ----------------------
-- 1. Libera a ESCRITA da coluna `users.cpf` para o próprio dono.
-- 2. Cria `public.meu_cpf_status()`: devolve só o STATUS do CPF de quem
--    chama (se existe + uma versão mascarada) — nunca o CPF de outra pessoa.
--
-- POR QUE UM GRANT DE COLUNA E NÃO "SELECT *"
-- -------------------------------------------
-- A coluna `users.cpf` NÃO tem SELECT para `authenticated` (e nem para `anon`):
-- o CPF é dado sensível e fica no banco. Verificado em produção (07/11/2026) —
-- um usuário comum receives `403 permission denied for table users` ao pedir
-- `select=cpf`, e `200` (122 linhas) ao pedir só `select=id`.
--
-- Por isso o front NÃO consegue ler o próprio CPF direto da tabela. E também
-- não pode grantar a coluna inteira: a policy "Authenticated users read
-- profiles" (`auth.role() = 'authenticated'`) permite a QUALQUER logado ler
-- QUALQUER linha de `users` — ou seja, dar SELECT na coluna `cpf` vazaria o
-- CPF de todo mundo. Por isso o status passa por uma função.
--
-- A FUNÇÃO
-- --------
-- `meu_cpf_status()` é SECURITY DEFINER (dono `postgres`), então lê a coluna
-- mesmo sem grant — mas filtra por `auth.uid()`, ou seja, só devolve o CPF de
-- quem está chamando. E devolve o valor MASCARADO (`***.456.789-09`), porque
-- a tela precisa mostrar que o CPF está lá, não o CPF em si.
--
-- A ESCRITA
-- ---------
-- `GRANT UPDATE (cpf)` + a policy "Users update own profile"
-- (`USING (auth.uid() = id)` E `WITH CHECK (auth.uid() = id)`) = o usuário
-- escreve APENAS o próprio CPF. A column-level grant vale para a tabela
-- inteira, mas a RLS limita a LINHA: ninguém mexe no CPF de outra pessoa.
--
-- COMO VERIFICAR DEPOIS DE RODAR
-- -------------------------------
--   -- 1. o status responde?
--   select public.meu_cpf_status();
--   -- 2. o front consegue gravar o próprio CPF?
--   --    (no app: Meu Perfil -> campo "CPF" -> salvar)
--   -- 3. a coluna continua bloqueada para leitura alheia?
--   --    (no app: nenhum CPF de outra pessoa aparece)
--
-- É IDEMPOTENTE: pode rodar quantas vezes quiser.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. O DONO PODE GRAVAR O PRÓPRIO CPF
-- ────────────────────────────────────────────────────────────────────────────
-- Só a coluna `cpf` entra no grant. A RLS (auth.uid() = id) continua valendo
-- para LINHA, então o usuário só mexe no próprio registro.
grant update (cpf) on public.users to authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. STATUS DO CPF DE QUEM CHAMA
-- ────────────────────────────────────────────────────────────────────────────
-- Retorna (jsonb):
--   cadastrado : true  -> há CPF válido (11 dígitos) no perfil
--                false -> não há (ou está incompleto)
--   mascarado  : '***.456.789-09' (apenas os 3 últimos antes do dígito, para
--                o usuário conferir) ou null
create or replace function public.meu_cpf_status()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with meu as (
    select nullif(regexp_replace(btrim(coalesce(cpf, '')), '\D', '', 'g'), '') as digitos
    from public.users
    where id = auth.uid()
  )
  select jsonb_build_object(
    'cadastrado', coalesce((select coalesce(length(digitos), 0) = 11 from meu), false),
    'mascarado', (
      select case
               when length(digitos) = 11
                 then '***.' || substr(digitos, 4, 3) || '.' || substr(digitos, 7, 3) || '-' || substr(digitos, 10, 2)
               else null
             end
      from meu
    )
  );
$$;

-- O padrão é PUBLIC (qualquer papel pode executar) — fecha para o resto e
-- libera só para quem está logado.
--
-- ATENCAO: o Supabase dá `grant execute on all functions in schema public to
-- anon, authenticated, service_role` — o `revoke ... from public` sozinho
-- NÃO tira o `anon`, porque o grant é DIRETO na role. Por isso o revoke
-- explícito do `anon` logo abaixo (sem ele, `anon` podia chamar a função).
revoke all on function public.meu_cpf_status() from public;
revoke all on function public.meu_cpf_status() from anon;
grant execute on function public.meu_cpf_status() to authenticated;
