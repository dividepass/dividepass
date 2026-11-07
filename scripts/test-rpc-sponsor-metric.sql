-- Teste de comportamento da RPC increment_sponsor_metric (local).
\set QUIET on
SELECT id AS ativa   FROM public.sponsored_offers WHERE status = 'active'   \gset
SELECT id AS pausada FROM public.sponsored_offers WHERE status = 'paused'   \gset
\set QUIET off

SET ROLE authenticated;
SELECT public.increment_sponsor_metric(:'ativa', 'impression') AS impressoes_ativa;
SELECT public.increment_sponsor_metric(:'ativa', 'click')      AS cliques_ativa;
SELECT public.increment_sponsor_metric(:'pausada', 'impression') AS impressoes_pausada;
RESET ROLE;

SELECT headline, clicks, impressions FROM public.sponsored_offers ORDER BY headline;
