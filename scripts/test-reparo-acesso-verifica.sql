-- ============================================================================
-- Verificação do reparo (roda DEPOIS do EXECUTAR-2026-11-02-...sql)
-- Cada linha precisa bater com o esperado.
-- ============================================================================
SELECT
  CASE
    WHEN u.email = 'carolina@exemplo.com' THEN
      CASE WHEN gm.status::text = 'active' AND gm.subscription_deadline IS NOT NULL
           THEN 'OK  espelho inactive + assinatura ativa -> ativo com prazo'
           ELSE 'FALHA espelho inactive nao foi reparado' END
    WHEN u.email = 'sem-prazo@exemplo.com' THEN
      CASE WHEN gm.status::text = 'active' AND gm.subscription_deadline IS NOT NULL
           THEN 'OK  espelho cancelled + assinatura ativa -> ativo com prazo'
           ELSE 'FALHA espelho cancelled nao foi reparado' END
    WHEN u.email = 'saiu@exemplo.com' THEN
      CASE WHEN gm.status::text = 'cancelled' AND gm.payment_status::text = 'cancelled'
           THEN 'OK  quem cancelou de verdade NAO foi reativado'
           ELSE 'FALHA quem cancelou de verdade foi mexido' END
    WHEN u.email = 'assinatura@exemplo.com' THEN
      CASE WHEN us.status::text = 'active'
           THEN 'OK  assinatura cancelada (pago e em dia) -> active'
           ELSE 'FALHA assinatura nao voltou para active' END
    ELSE 'ok'
  END AS resultado,
  u.email,
  gm.status::text AS membro,
  gm.payment_status::text AS pagamento,
  gm.subscription_deadline AS paga_ate,
  us.status::text AS assinatura
FROM public.group_members gm
JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.user_subscriptions us ON us.user_id = gm.user_id AND us.group_id = gm.group_id
ORDER BY u.email;

-- Nenhuma linha pode sobrar com pagamento ativo e prazo vigente fora do grupo
SELECT CASE WHEN count(*) = 0 THEN 'OK  ninguem fora do grupo com pagamento ativo e prazo vigente'
            ELSE 'FALHA sobrou ' || count(*) || ' vinculo(s)' END AS conferencia
FROM public.group_members gm
WHERE gm.status::text <> 'active'
  AND gm.payment_status::text = 'active'
  AND gm.subscription_deadline IS NOT NULL
  AND gm.subscription_deadline > NOW();
