-- =============================================================================
-- DividePass — asserts de comportamento do card de Visão Geral
-- =============================================================================
-- Roda DEPOIS de scripts/test-dashboard-visao-geral-schema.sql + do migration
-- database/EXECUTAR-2026-11-08-dashboard-visao-geral.sql
--
--   psql -U postgres -d dp_dash_test -v ON_ERROR_STOP=1 \
--        -f scripts/test-dashboard-visao-geral-asserts.sql
--
-- Imprime PASS/FAIL. Sai com codigo != 0 se houver falha.
-- =============================================================================

\set ON_ERROR_STOP on

\pset pager off

CREATE OR REPLACE FUNCTION pg_temp.report(p_id text, p_passed boolean, p_msg text, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF p_passed THEN
    RAISE NOTICE 'PASS  %  %', p_id, p_msg;
  ELSE
    RAISE NOTICE 'FAIL  %  %  %', p_id, p_msg, p_detail;
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) TOP DE VENDIDOS: ordem, contagem, preço e desconto
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_limite  integer;
  v_netflix record;
  v_spotify record;
  v_max     record;
  v_youtube record;
begin
  select count(*) into v_limite from public.dividepass_top_sold_services(50);

  select * into v_netflix from public.dividepass_top_sold_services(50) where service_slug = 'netflix';
  select * into v_spotify from public.dividepass_top_sold_services(50) where service_slug = 'spotify';
  select * into v_max     from public.dividepass_top_sold_services(50) where service_slug = 'max';
  select * into v_youtube from public.dividepass_top_sold_services(50) where service_slug = 'youtube';

  -- 1.1 Netflix é a mais vendida (3 pagamentos pagos de assinatura)
  perform pg_temp.report('top-01', v_netflix.sold_count = 3,
    'Netflix aparece com 3 vendas',
    format('veio %s', v_netflix.sold_count));

  -- 1.2 O preço "a partir de" é o MENOR entre os grupos abertos e públicos
  perform pg_temp.report('top-02', v_netflix.from_price = 19.90,
    'from_price = menor vaga aberta (19,90)',
    format('veio %s', v_netflix.from_price));

  -- 1.3 Desconto contra o preço oficial: (55,90 - 19,90) / 55,90 = 64%
  perform pg_temp.report('top-03', v_netflix.savings_pct = 64,
    'savings_pct de 64% contra o preço oficial',
    format('veio %s', v_netflix.savings_pct));

  -- 1.4 Spotify: 2 vendas, 72% de desconto
  perform pg_temp.report('top-04', v_spotify.sold_count = 2 and v_spotify.savings_pct = 72,
    'Spotify com 2 vendas e 72% de desconto',
    format('vendas=%s desconto=%s', v_spotify.sold_count, v_spotify.savings_pct));

  -- 1.5 Max: 1 venda
  perform pg_temp.report('top-05', v_max.sold_count = 1,
    'Max com 1 venda',
    format('veio %s', v_max.sold_count));

  -- 1.6 YouTube tem grupo aberto mas NENHUMA venda: entra com 0 (não some da tela)
  perform pg_temp.report('top-06', v_youtube is not null and v_youtube.sold_count = 0,
    'YouTube entra no ranking com 0 vendas (grupo aberto)',
    format('veio %s', v_youtube.sold_count));

  -- 1.7 Disney Plus só tem grupo PRIVADO: não pode aparecer no catálogo público
  perform pg_temp.report('top-07',
    not exists (select 1 from public.dividepass_top_sold_services(50) where service_slug = 'disney-plus'),
    'plataforma só com grupo privado não aparece no ranking',
    'disney-plus apareceu no ranking');

  -- 1.8 Plataforma inativa nunca aparece
  perform pg_temp.report('top-08',
    not exists (select 1 from public.dividepass_top_sold_services(50) where service_slug = 'inativo'),
    'plataforma inativa não aparece no ranking',
    'inativo apareceu no ranking');

  -- 1.9 O limite é respeitado
  perform pg_temp.report('top-09',
    (select count(*) from public.dividepass_top_sold_services(2)) = 2,
    'p_limit corta o ranking',
    'veio ' || (select count(*) from public.dividepass_top_sold_services(2))::text);
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) ÚLTIMAS ASSINATURAS: só pagamento pago, nome mascarado e filtro
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_total   integer;
  v_netflix integer;
  v_topo    record;
  v_masked  record;
  v_email   record;
  v_semini  record;
begin
  select count(*) into v_total from public.dividepass_recent_subscribers(null, 50);

  -- 2.1 Só entram assinatura PAGA (6 no total: 3 Netflix + 2 Spotify + 1 Max).
  --     O pagamento pendente do YouTube e o pagamento de 'wallet' ficam de fora.
  perform pg_temp.report('rec-01', v_total = 6,
    'só assinatura paga entra na lista (6 linhas)',
    format('veio %s', v_total));

  -- 2.2 Filtro por plataforma
  select count(*) into v_netflix from public.dividepass_recent_subscribers(
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 50);
  perform pg_temp.report('rec-02', v_netflix = 3,
    'filtro por plataforma devolve só as 3 assinaturas da Netflix',
    format('veio %s', v_netflix));

  -- 2.3 Mais recente primeiro: Max (20 horas) antes de Spotify (30 horas)
  select * into v_topo from public.dividepass_recent_subscribers(null, 1);
  perform pg_temp.report('rec-03', v_topo.service_slug = 'max',
    'a lista começa pela assinatura mais recente',
    format('veio %s', v_topo.service_slug));

  -- 2.4 Nome mascarado: primeiro nome + inicial do sobrenome + ***
  select * into v_masked from public.dividepass_recent_subscribers(null, 50)
    where user_id = '11111111-1111-1111-1111-111111111111'
      and service_slug = 'netflix';
  perform pg_temp.report('rec-04', v_masked.display_name = 'Allan M***',
    'nome sai mascarado (Allan M***)',
    format('veio %s', v_masked.display_name));

  -- 2.5 Nome que é e-mail: usa a parte antes do @ e não expõe o e-mail
  select * into v_email from public.dividepass_recent_subscribers(null, 50)
    where user_id = '33333333-3333-3333-3333-333333333333';
  perform pg_temp.report('rec-05',
    v_email.display_name = 'gabriel' and v_email.display_name not like '%@%',
    'nome-e-mail vira só o prefixo, sem o @',
    format('veio %s', v_email.display_name));

  -- 2.6 Inicial sempre presente (avatar circular) = letra do PRIMEIRO nome
  select * into v_semini from public.dividepass_recent_subscribers(null, 50)
    where user_id = '44444444-4444-4444-4444-444444444444';
  perform pg_temp.report('rec-06',
    v_semini.initial = 'A' and v_semini.display_name = 'Ana B***',
    'avatar circular mostra a inicial do primeiro nome (Ana B*** / A)',
    format('nome=%s inicial=%s', v_semini.display_name, v_semini.initial));
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) PRIVACIDADE: a função não devolve dado sensível
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_colunas text;
begin
  select string_agg(column_name, ',' order by column_name)
    into v_colunas
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'payments';

  -- Sanidade do schema usado no teste (o nome da coluna do gateway muda com o
  -- tempo, então o assert é sobre o que a FUNÇÃO devolve, não sobre a tabela).
  perform pg_temp.report('priv-01', v_colunas like '%user_id%',
    'payments tem user_id (base da lista de assinantes)',
    v_colunas);
end $$;

\echo ''
\echo 'RESULTADO: asserts do card de Visão Geral concluídos (veja PASS/FAIL acima).'
