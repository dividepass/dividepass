-- =============================================================================
-- groups.has_ads — a assinatura compartilhada tem anúncios?
-- =============================================================================
-- Motivo: o comprador precisa saber ANTES de entrar no grupo se a assinatura
-- que vai receber tem anúncio (Plano com anúncios) ou não (Premium/sem ads).
-- Sem isso, o preço parece igual e a entrega disappointa.
--
-- Semântica:
--   true  = a conta compartilhada exibe anúncios
--   false = a conta compartilhada é sem anúncios (Premium)
--   NULL  = não informado (grupos antigos; nenhum selo aparece no card)
--
-- A coluna NÃO entra na lista de campos privilegiados do trigger
-- guard_group_privileged_fields: quem cria o grupo escolhe, o admin pode
-- corrigir depois. Nada de moderação aqui.
-- =============================================================================

ALTER TABLE public.groups
  ADD COLUMN IF NOT EXISTS has_ads boolean;

COMMENT ON COLUMN public.groups.has_ads IS
  'true = assinatura com anúncios; false = assinatura sem anúncios (Premium); null = não informado.';

-- Índice parcial: o filtro do catálogo ("só grupos sem anúncio") precisa
-- batter em cima de poucos linhas.
CREATE INDEX IF NOT EXISTS idx_groups_has_ads
  ON public.groups (has_ads)
  WHERE has_ads IS NOT NULL;
