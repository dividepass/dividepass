-- Teste: a oferta de demonstração é contável pela RPC?
-- (a oferta demo nasce ATIVA e dentro do período — é o que a RPC exige)
SET ROLE authenticated;
SELECT public.increment_sponsor_metric(
  'dddddddd', 'impression') AS impressoes;
SELECT public.increment_sponsor_metric(
  'dddddddd', 'click') AS cliques;
RESET ROLE;

SELECT id, sponsor_name, headline, placement, status,
       period_start <= now() AS dentro_do_periodo,
       impressions, clicks
FROM public.sponsored_offers
WHERE id = 'dddddddd';
