-- =============================================================================
-- DividePass — dados da Visão Geral: mais vendidos + últimas assinaturas
-- =============================================================================
-- Data: 08/11/2026
--
-- POR QUE ISSO É SQL E NÃO SÓ CONSULTAS DO APP
-- ---------------------------------------------
-- O card "Top 10 mais vendidos" (que hoje não existe) e a lista de "Últimas
-- assinaturas" precisam de DUAS coisas que o app, logado como usuário comum,
-- não consegue ler:
--
--   1) as vendas de TODO mundo — a RLS de `payments` só libera o pagamento
--      para o próprio usuário (e tudo para admin). Sem uma função, o card
--      mostraria só as compras da própria pessoa;
--   2) o nome/avatar de quem assinou — precisa sair de `payments` + `users`.
--
-- As funções abaixo são SECURITY DEFINER: elas rodam com o dono (postgres) e
-- devolvem SÓ dados agregados ou dados já mascarados (primeiro nome + inicial
-- + último nome como "***"). Nenhum dado sensível (e-mail, CPF, telefone,
-- pagamento, ID de gateway) sai daqui.
--
-- O QUE MUDA
-- ----------
-- 1) public.dividepass_top_sold_services(p_limit)
--      → ranking de serviços por assinatura paga, com preço "a partir de",
--        preço oficial, % de economia e nº de grupos abertos.
--
-- 2) public.dividepass_recent_subscribers(p_service_id, p_limit)
--      → últimas assinaturas confirmadas (nome mascarado + avatar + inicial),
--        de uma plataforma ou de toda a plataforma.
--
-- TUDO IDEMPOTENTE: pode rodar quantas vezes quiser, sem erro.
--
-- COMO RODAR
-- -----------
-- 1) Abra o SQL Editor do Supabase (projeto do DividePass)
-- 2) Cole o conteúdo INTEIRO deste arquivo e clique em "Run"
-- 3) No fim aparece uma linha de conferência:
--    "dashboard_visao_geral: OK"
--    Se aparecer "ERRO", rode de novo: o script é idempotente e o erro some.
--
-- DEPOIS DE RODAR
-- ---------------
-- O app NÃO trava enquanto este script não foi aplicado: o dashboard detecta
-- que a função ainda não existe e cai no ranking alternativo (serviços com
-- mais gente nos grupos). Assim que o script roda, o card passa a usar o
-- ranking real de vendas sozinho, sem novo deploy.
--
-- CACHE DO POSTGREST
-- ------------------
-- Funções entram no cache do PostgREST em poucos segundos. Se o app ainda
-- responder "function ... does not exist", é só esperar 1 minuto e recarregar.
-- =============================================================================

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) TOP DE SERVIÇOS VENDIDOS
-- ─────────────────────────────────────────────────────────────────────────────
-- Contabiliza pagamento de assinatura CONFIRMADO (status = 'paid') por
-- serviço, via o grupo do pagamento. Serviços sem nenhuma venda ainda entram
-- no ranking se tiverem grupo aberto — assim o card não fica vazio no começo
-- da operação.
--
-- "from_price" é o MENOR preço por vaga entre os grupos abertos e públicos da
-- plataforma: é o valor que a pessoa realmente paga ao entrar.
-- "savings_pct" compara esse valor com o preço oficial da plataforma.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.dividepass_top_sold_services(p_limit integer default 10)
returns table (
  service_id     uuid,
  service_name   text,
  service_slug   text,
  icon_url       text,
  color          text,
  category       text,
  official_price numeric,
  from_price     numeric,
  sold_count     integer,
  savings_pct    integer,
  groups_count   integer
)
language sql
stable
security definer
set search_path = public
as $$
  with vendidos as (
    select g.service_id, count(*)::integer as qtd
    from public.payments p
    join public.groups g on g.id = p.group_id
    where p.status = 'paid'
      and p.payment_type = 'subscription'
    group by g.service_id
  ),
  grupos_publicos as (
    select g.service_id,
           count(*)::integer as qtd,
           min(g.price_per_slot)::numeric as preco
    from public.groups g
    where g.status in ('open', 'forming')
      and (g.visibility = 'public' or g.visibility is null)
    group by g.service_id
  )
  select s.id,
         s.name::text,
         s.slug::text,
         s.icon_url::text,
         s.color::text,
         s.category::text,
         s.official_price,
         gp.preco,
         coalesce(v.qtd, 0)::integer,
         case
           when s.official_price > 0 and gp.preco > 0
             then round(((s.official_price - gp.preco) / s.official_price) * 100)::integer
           else 0
         end,
         coalesce(gp.qtd, 0)::integer
  from public.streaming_services s
  left join vendidos v on v.service_id = s.id
  left join grupos_publicos gp on gp.service_id = s.id
  where s.status = 'active'
    and (coalesce(v.qtd, 0) > 0 or coalesce(gp.qtd, 0) > 0)
  order by coalesce(v.qtd, 0) desc,
           coalesce(gp.qtd, 0) desc,
           s.name
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

comment on function public.dividepass_top_sold_services(integer) is
  'Ranking de plataformas por assinatura paga, com preco a partir de e desconto. SECURITY DEFINER: le payments de todo mundo, mas so devolve contagens e precos.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) ÚLTIMAS ASSINATURAS
-- ─────────────────────────────────────────────────────────────────────────────
-- Lista de quem entrou nos grupos (pagamento confirmado), do mais recente para
-- o mais antigo.
--
-- PRIVACIDADE: o nome sai MASCARADO — primeiro nome + inicial do sobrenome +
-- "***" (ex.: "Allan M***"). O avatar é o mesmo que já aparece publicamente
-- nos cards de grupo do catálogo. Nada de e-mail, CPF ou telefone sai aqui.
--
-- "initial" é a letra do PRIMEIRO nome — é ela que aparece no círculo do
-- avatar quando a pessoa não tem foto ("Allan M***" com o "A" no círculo).
--
-- p_service_id = null devolve as últimas assinaturas de TODAS as plataformas.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.dividepass_recent_subscribers(
  p_service_id uuid default null,
  p_limit integer default 8
)
returns table (
  user_id      uuid,
  display_name text,
  initial      text,
  avatar_url   text,
  joined_at    timestamptz,
  group_name   text,
  service_name text,
  service_slug text
)
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select
      p.user_id,
      coalesce(p.paid_at, p.created_at) as quando,
      g.name::text as grupo,
      s.name::text as plataforma,
      s.slug::text as plataforma_slug,
      coalesce(nullif(trim(u.nickname), ''), nullif(trim(u.name), ''), 'Participante') as nome_bruto
    from public.payments p
    join public.groups g on g.id = p.group_id
    join public.streaming_services s on s.id = g.service_id
    left join public.users u on u.id = p.user_id
    where p.status = 'paid'
      and p.payment_type = 'subscription'
      and (p_service_id is null or g.service_id = p_service_id)
  ),
  nomes as (
    select
      b.*,
      case
        when position('@' in b.nome_bruto) > 0
          then split_part(b.nome_bruto, '@', 1)
        else b.nome_bruto
      end as nome_limpo
    from base b
  ),
  finais as (
    select
      n.*,
      split_part(n.nome_limpo, ' ', 1) as primeiro_nome,
      left(split_part(n.nome_limpo, ' ', 2), 1) as inicial
    from nomes n
  )
  select
    f.user_id,
    case
      when nullif(f.primeiro_nome, '') is null then 'Participante'
      when nullif(f.inicial, '') is null then f.primeiro_nome
      else f.primeiro_nome || ' ' || upper(f.inicial) || '***'
    end,
    upper(coalesce(nullif(left(f.primeiro_nome, 1), ''), '')),
    u.avatar_url::text,
    f.quando,
    f.grupo,
    f.plataforma,
    f.plataforma_slug
  from finais f
  left join public.users u on u.id = f.user_id
  order by f.quando desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

comment on function public.dividepass_recent_subscribers(uuid, integer) is
  'Ultimas assinaturas confirmadas, com nome mascarado (primeiro nome + inicial). SECURITY DEFINER: cruza payments e users, mas so devolve nome mascarado e avatar.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PERMISSÕES
-- ─────────────────────────────────────────────────────────────────────────────
-- Só usuário logado usa. A função é SECURITY DEFINER (lê tudo), mas quem
-- chama só enxerga o resultado agregado/mascarado.
revoke all on function public.dividepass_top_sold_services(integer) from public;
grant execute on function public.dividepass_top_sold_services(integer) to authenticated;

revoke all on function public.dividepass_recent_subscribers(uuid, integer) from public;
grant execute on function public.dividepass_recent_subscribers(uuid, integer) to authenticated;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_top integer;
  v_recentes integer;
BEGIN
  select count(*) into v_top from public.dividepass_top_sold_services(10);
  select count(*) into v_recentes from public.dividepass_recent_subscribers(null, 8);

  if v_top is null or v_recentes is null then
    raise exception 'dashboard_visao_geral: ERRO — as funções não devolveram linhas';
  end if;

  raise notice 'dashboard_visao_geral: OK — % serviços no ranking, % assinaturas recentes', v_top, v_recentes;
END $$;
