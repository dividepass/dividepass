-- =============================================================================
-- DividePass — grupo em destaque no slide da plataforma
-- =============================================================================
-- Data: 08/11/2026
--
-- PARA QUE SERVE
-- --------------
-- Na página da plataforma (/dashboard/catalog/netflix) o primeiro slide é uma
-- "tarja" de destaque. Antes, esse slide era sempre a oferta geral da
-- plataforma. Agora o ADMIN escolhe QUAL grupo merece o destaque — é o botão
-- "Destacar" no painel de grupos (/admin/groups).
--
-- COMO FUNCIONA
-- -------------
-- `groups.featured_in_slide` (boolean):
--   - TRUE  → este grupo aparece em destaque no slide da plataforma;
--   - FALSE → grupo normal (padrão).
--
-- O app garante que só UM grupo por plataforma fica marcado: ao escolher um,
-- os outros da mesma plataforma são desligados antes.
--
-- A RLS não muda: `groups` já é lida por qualquer usuário logado (é o catálogo
-- público) e o UPDATE é feito pelo admin, que já tem permissão.
--
-- TUDO IDEMPOTENTE: pode rodar quantas vezes quiser, sem erro.
--
-- COMO RODAR
-- -----------
-- 1) Abra o SQL Editor do Supabase (projeto do DividePass)
-- 2) Cole o conteúdo INTEIRO deste arquivo e clique em "Run"
-- 3) No fim aparece: "grupo_destaque_slide: OK"
--
-- DEPOIS DE RODAR
-- ---------------
-- O botão "Destacar" no painel de grupos passa a gravar de verdade. Antes
-- disso, o botão avisa que a coluna ainda não existe (a tela do usuário
-- continua normal — sem slide de destaque, sem erro).
--
-- CACHE DO POSTGREST
-- ------------------
-- A coluna nova é lida pelo `select('*')` — o PostgREST solta o schema em
-- poucos segundos. Se o botão continuar reclamando da coluna, espere 1
-- minuto e recarregue o painel.
-- =============================================================================

BEGIN;

alter table public.groups
  add column if not exists featured_in_slide boolean not null default false;

-- Índice parcial: só os grupos marcados são poucos, então o índice fica
-- minúsculo e a busca do slide é instantânea.
create index if not exists idx_groups_featured_in_slide
  on public.groups (service_id)
  where featured_in_slide = true;

comment on column public.groups.featured_in_slide is
  'TRUE = este grupo aparece em destaque no slide da plataforma (escolhido pelo admin).';

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_coluna text;
  v_marcados integer;
BEGIN
  select column_name into v_coluna
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'groups'
    and column_name = 'featured_in_slide';

  if v_coluna is null then
    raise exception 'grupo_destaque_slide: ERRO — a coluna nao foi criada';
  end if;

  select count(*) into v_marcados
  from public.groups
  where featured_in_slide = true;

  raise notice 'grupo_destaque_slide: OK — coluna criada, % grupo(s) em destaque', v_marcados;
END $$;
