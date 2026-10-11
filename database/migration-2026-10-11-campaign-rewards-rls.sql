-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — RLS em campaign_rewards (roda UMA VEZ no SQL Editor)
--
-- Hoje campaign_rewards não tem nenhuma policy. Como as edge functions
-- (grant-testimonial-reward, manage-coupons) usam service_role, o INSERT
-- delas continua funcionando. Mas a leitura era aberta para qualquer
-- usuário autenticado — ele via a elegibilidade de todo mundo.
--
-- Aqui fechamos: o usuário lê só os próprios rewards, o admin tudo.
--
-- Idempotente: pode rodar mais de uma vez.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE public.campaign_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own campaign rewards" ON public.campaign_rewards;
CREATE POLICY "Users read own campaign rewards"
  ON public.campaign_rewards FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins manage campaign rewards" ON public.campaign_rewards;
CREATE POLICY "Admins manage campaign rewards"
  ON public.campaign_rewards FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- ─────────────────────────────────────────────────────────────────
-- Verificação
-- ─────────────────────────────────────────────────────────────────

SELECT 'policy: ' || policyname AS item
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'campaign_rewards'
ORDER BY policyname;