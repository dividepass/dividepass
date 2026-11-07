-- ============================================================================
-- COLUNA `transaction_id` EM `platform_events` (07/11/2026)
--
-- POR QUE
-- -------
-- `platform_events.metadata` é jsonb, mas o conteúdo gravado é uma STRING JSON
-- (`metadata: JSON.stringify({...})` -> o PostgREST guarda a string como um
-- jsonb do tipo `string`). Por isso:
--
--   - `metadata->>'transaction_id'` devolve NULL (o campo não é um objeto);
--   - `metadata LIKE '...'` nem existe (jsonb não tem o operador ~~).
--
-- Sem uma coluna dedicada, o job de reconciliação (que roda a cada 15 min)
-- criava um evento "Pagamento aprovado sem liberação" POR RODADA para o mesmo
-- pagamento — o painel ficava cheio do mesmo problema repetido.
--
-- COMO APLICAR
-- ------------
--   node scripts/supabase-sql.mjs database/add-platform-events-transaction-id.sql
--
-- ou colar no SQL Editor do painel do Supabase. É idempotente.
-- ============================================================================

-- 1) A coluna (idempotente).
ALTER TABLE public.platform_events
  ADD COLUMN IF NOT EXISTS transaction_id text;

-- 2) Índice para a consulta de trava (o job pergunta por transação).
CREATE INDEX IF NOT EXISTS idx_platform_events_transaction_id
  ON public.platform_events (transaction_id);

CREATE INDEX IF NOT EXISTS idx_platform_events_title_created
  ON public.platform_events (title, created_at DESC);

-- 3) Backfill: puxa o transaction_id dos eventos que ja existem.
--
--    O metadata e uma string JSON; `(metadata #>> '{}')` extrai o texto e o
--    `::jsonb` devolve o objeto de verdade, de onde sai o transaction_id.
UPDATE public.platform_events e
SET transaction_id = ((e.metadata #>> '{}')::jsonb ->> 'transaction_id')
WHERE e.transaction_id IS NULL
  AND jsonb_typeof(e.metadata) = 'string'
  AND (e.metadata #>> '{}') LIKE '%"transaction_id"%'
  AND ((e.metadata #>> '{}')::jsonb ->> 'transaction_id') IS NOT NULL;

-- 4) Confere.
SELECT
  count(*) FILTER (WHERE transaction_id IS NOT NULL) AS com_tx,
  count(*) FILTER (WHERE transaction_id IS NULL) AS sem_tx
FROM public.platform_events
WHERE title = 'Pagamento aprovado sem liberação';

SELECT transaction_id, count(*) AS n, max(created_at) AS ultimo
FROM public.platform_events
WHERE title = 'Pagamento aprovado sem liberação'
  AND transaction_id IS NOT NULL
GROUP BY 1
ORDER BY n DESC;
