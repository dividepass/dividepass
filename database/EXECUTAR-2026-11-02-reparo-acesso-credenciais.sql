-- =============================================================================
-- REPARO DO ACESSO ÀS CREDENCIAIS — 02/11/2026
-- =============================================================================
-- DividePass (lasoouwboxspstqvjbsv)
--
-- COMO APLICAR: SQL Editor do Supabase -> colar o arquivo inteiro -> Run.
-- Idempotente: pode rodar quantas vezes quiser (roda de novo e não muda nada).
--
-- O CASO (relatado pelo dono em 02/11/2026)
-- --------------------------------------------
-- "A cliente Carolina entrou no grupo dela e a tela respondeu 'Acesso Negado:
--  seu acesso ao Netflix foi encerrado. Sua assinatura foi cancelada ou você
--  saiu do grupo' — mas no painel admin a assinatura estava ATIVA (Netflix,
--  R$ 59,40, semestral, próxima cobrança em 26/01/2027) e o vínculo dela no
--  grupo também estava ATIVO."
--
-- O QUE ESTAVA ERRADO (uma coisa na tela, outra no banco)
-- ------------------------------------------------------
-- 1) A TELA (src/pages/user/ServiceCredentials.jsx) negava o acesso em
--    qualquer um destes casos — e a mensagem acusava a cliente:
--      a) FALHA NA CONSULTA (rede/banco)     -> "Acesso Negado";
--      b) LINK PARA OUTRO GRUPO              -> "Acesso Negado";
--      c) ESPELHO DO GRUPO DEFEASADO
--         ('inactive'/'cancelled'/'left') com o PAGAMENTO ativo e o prazo
--         vigente                          -> "Acesso Negado".
--    Hoje a tela: quem pagou SEMPRE entra; erro de rede vira "não foi possível
--    verificar" (com botão "Tentar de novo"); link de outro grupo vira o
--    aviso certo ("você não tem assinatura ativa do X neste grupo") + botão
--    "Abrir meu grupo". (Correção já feita no front — precisa publicar.)
--
-- 2) O BANCO: o vínculo em `group_members` é um "espelho" do grupo. O painel
--    admin, ao reativar uma assinatura, nem sempre devolvia o espelho para
--    'active' — e, quando a data "paga até" (`subscription_deadline`) não
--    existia no vínculo, ninguém conseguia dizer se o período ainda valia.
--    O conserto do painel já está no código (01/11/2026); o que faltava era
--    curar o passado — é o que este script faz.
--
-- O QUE ESTE SCRIPT FAZ
-- ---------------------
--   (a) DIAGNÓSTICO: quem está fora do grupo com pagamento ativo e período
--       válido; quem está sem a data "paga até"; como o panorama está.
--   (b) Preenche a data "paga até" no vínculo a partir da assinatura.
--   (c) Devolve o VÍNCULO para 'active' de quem PAGOU e está dentro do
--       período (a assinatura ativa é a prova do pagamento).
--   (d) Devolve a ASSINATURA para 'active' de quem tem vínculo e pagamento
--       ativos (é o que faz a assinatura voltar a aparecer na dashboard).
--   (e) Alinha o `payment_status` de quem saiu sem período válido.
--
-- O QUE ESTE SCRIPT NÃO FAZ
-- -------------------------
--   - NÃO cancela assinatura nenhuma.
--   - NÃO desvincula ninguém do grupo.
--   - NÃO mexe em quem cancelou de propósito sem período válido.
--
-- COMPARAÇÕES SEMPRE COM ::text (o enum estoura 22P02):
--   group_members.status         -> VARCHAR(20) ('active','cancelled','inactive','left')
--   group_members.payment_status -> ENUM payment_flow_status
--   user_subscriptions.status     -> ENUM subscription_status
-- =============================================================================


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) DIAGNÓSTICO
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1) Quem está FORA do grupo (espelho defasado) mas tem pagamento ativo e
--      prazo ainda vigente -> é quem pagou e pode ficar trancado fora da
--      tela de credenciais.
WITH base AS (
  SELECT
    gm.user_id,
    gm.group_id,
    gm.status::text           AS membro_status,
    gm.payment_status::text   AS pagamento,
    gm.left_at,
    gm.subscription_deadline,
    COALESCE(
      us.renewal_due_at,
      us.next_charge_at,
      CASE WHEN us.expires_at IS NOT NULL
           THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
      END
    )                         AS renovacao,
    us.status::text           AS assinatura_status
  FROM public.group_members gm
  LEFT JOIN public.user_subscriptions us
    ON us.user_id = gm.user_id AND us.group_id = gm.group_id
)
SELECT
  u.email,
  u.name                        AS cliente,
  g.name                        AS grupo,
  b.membro_status,
  b.pagamento,
  b.assinatura_status,
  b.renovacao                   AS paga_ate,
  b.left_at                     AS saiu_em,
  CASE
    WHEN b.renovacao IS NOT NULL AND b.renovacao > NOW()
      THEN 'REATIVAR (pago e em dia)'
    ELSE 'manter como está'
  END                           AS acao
FROM base b
JOIN public.users u ON u.id = b.user_id
LEFT JOIN public.groups g ON g.id = b.group_id
WHERE b.membro_status <> 'active'
  AND b.pagamento = 'active'
ORDER BY b.renovacao DESC NULLS LAST;

-- 1.2) Panorama: como o vínculo e a assinatura estão distribuídos
SELECT
  gm.status::text                                       AS membro_status,
  gm.payment_status::text                               AS pagamento,
  us.status::text                                       AS assinatura_status,
  count(*)                                              AS pares
FROM public.group_members gm
LEFT JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id AND us.group_id = gm.group_id
GROUP BY 1, 2, 3
ORDER BY 4 DESC;

-- 1.3) Vínculos SEM a data "paga até" (a assinatura pagou, mas o vínculo não
--      sabe) — é o que impede o auto-cura do cron de curar o espelho.
SELECT
  u.email,
  g.name AS grupo,
  gm.status::text AS membro_status,
  gm.payment_status::text AS pagamento,
  us.status::text AS assinatura_status,
  COALESCE(us.renewal_due_at, us.next_charge_at) AS renovacao
FROM public.group_members gm
LEFT JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id AND us.group_id = gm.group_id
JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.subscription_deadline IS NULL
  AND us.id IS NOT NULL
  AND us.status::text IN ('active', 'expired')
ORDER BY u.email;

-- 1.4) Assinaturas que NÃO aparecem para o cliente (status fora da lista) e
--      ainda têm renovação no futuro -> devem voltar a 'active'.
SELECT
  u.email,
  g.name AS grupo,
  us.status::text AS assinatura_status,
  COALESCE(us.renewal_due_at, us.next_charge_at) AS renovacao,
  gm.status::text AS membro_status,
  gm.payment_status::text AS pagamento
FROM public.user_subscriptions us
JOIN public.users u ON u.id = us.user_id
LEFT JOIN public.groups g ON g.id = us.group_id
LEFT JOIN public.group_members gm
  ON gm.user_id = us.user_id AND gm.group_id = us.group_id
WHERE us.status::text IN ('cancelled', 'inactive')
  AND COALESCE(us.renewal_due_at, us.next_charge_at) > NOW()
  AND gm.payment_status::text = 'active'
ORDER BY u.email;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) REPARO
-- ─────────────────────────────────────────────────────────────────────────────

-- 2.1) Preenche a data "paga até" no vínculo a partir da assinatura.
--      (é o que permite, dali em diante, decidir por membro se o período vale)
UPDATE public.group_members gm
   SET subscription_deadline = COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ),
       updated_at = NOW()
  FROM public.user_subscriptions us
 WHERE us.user_id = gm.user_id
   AND us.group_id = gm.group_id
   AND gm.subscription_deadline IS NULL
   AND COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ) IS NOT NULL;

-- 2.2) REATIVA o vínculo de quem PAGOU e ainda está dentro do período.
--
--      A PROVA DE PAGAMENTO é a ASSINATURA ativa (status 'active') com
--      renovação no futuro. O `status` do espelho ('inactive', 'cancelled',
--      'left') é lixo de fluxos antigos: o painel admin, ao reativar uma
--      assinatura, nem sempre devolvia o espelho — e a pessoa ficava fora da
--      tela de credenciais mesmo com a assinatura ativa e paga.
--
--      (O script de 01/11 só reativava o 'inactive'. Aqui entra também o
--      'cancelled'/'left' DESDE QUE a assinatura ativa prove o pagamento —
--      quem cancelou de verdade não tem assinatura ativa, então não entra.)
UPDATE public.group_members gm
   SET status       = 'active',
       left_at      = NULL,
       updated_at   = NOW()
  FROM public.user_subscriptions us
 WHERE us.user_id = gm.user_id
   AND us.group_id = gm.group_id
   AND us.status::text = 'active'
   AND gm.status::text IN ('inactive', 'cancelled', 'left')
   AND gm.payment_status::text = 'active'
   AND COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ) > NOW();

-- 2.3) Devolve a ASSINATURA de quem está ativo e pago para 'active'.
--      (é o que faz a assinatura voltar a aparecer na dashboard do cliente)
--
--      O par tem que estar com o vínculo ATIVO e o pagamento ativo — quem
--      cancelou de verdade (vínculo 'cancelled') não é tocado aqui.
UPDATE public.user_subscriptions us
   SET status        = 'active'::subscription_status,
       billing_status = 'active'::subscription_billing_status,
       updated_at    = NOW()
  FROM public.group_members gm
 WHERE gm.user_id = us.user_id
   AND gm.group_id = us.group_id
   AND gm.status::text = 'active'
   AND gm.payment_status::text = 'active'
   AND us.status::text IN ('cancelled', 'inactive', 'expired')
   AND COALESCE(
         us.renewal_due_at,
         us.next_charge_at,
         CASE WHEN us.expires_at IS NOT NULL
              THEN us.expires_at::timestamp + interval '23 hours 59 minutes 59 seconds'
         END
       ) > NOW();

-- 2.4) Alinha quem saiu do grupo SEM período válido: o pagamento não pode
--      continuar dizendo 'active' (isso fazia o espelho e a assinatura
--      discordarem). Não desvincula ninguém — só corrige o estado.
UPDATE public.group_members gm
   SET payment_status = 'cancelled'::payment_flow_status,
       updated_at      = NOW()
 WHERE gm.status::text IN ('cancelled', 'inactive', 'left')
   AND gm.payment_status::text = 'active'
   AND (gm.subscription_deadline IS NULL OR gm.subscription_deadline <= NOW());


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CONFERÊNCIA
-- ─────────────────────────────────────────────────────────────────────────────

-- 3.1) Nenhum vínculo pode ficar "fora do grupo" com pagamento ativo e prazo
--      vigente (se aparecer linha aqui, o 2.2 não cobriu algum caso).
SELECT u.email, g.name AS grupo, gm.status::text AS membro, gm.payment_status::text AS pagamento,
       gm.subscription_deadline AS paga_ate
FROM public.group_members gm
JOIN public.users u ON u.id = gm.user_id
LEFT JOIN public.groups g ON g.id = gm.group_id
WHERE gm.status::text <> 'active'
  AND gm.payment_status::text = 'active'
  AND gm.subscription_deadline IS NOT NULL
  AND gm.subscription_deadline > NOW();

-- 3.2) Panorama final dos vínculos
SELECT status::text AS membro_status, payment_status::text AS pagamento, count(*)
FROM public.group_members
GROUP BY 1, 2
ORDER BY 3 DESC;

-- 3.3) Panorama final das assinaturas
SELECT status::text, count(*)
FROM public.user_subscriptions
GROUP BY 1
ORDER BY 2 DESC;

-- 3.4) Os pagamentos ativos sem a data "paga até" (tem que dar ZERO depois do 2.1)
SELECT count(*) AS sem_prazo
FROM public.group_members gm
JOIN public.user_subscriptions us
  ON us.user_id = gm.user_id AND us.group_id = gm.group_id
WHERE gm.subscription_deadline IS NULL
  AND us.status::text IN ('active', 'expired');

-- =============================================================================
-- DEPOIS DE RODAR
-- =============================================================================
-- 1) Publique o FRONT (a tela de credenciais) — é lá que está a correção
--    que impede o "Acesso Negado" de cobrar o corpo de quem pagou:
--       src/pages/user/ServiceCredentials.jsx
-- 2) Publique as EDGE FUNCTIONS (o auto-cura):
--       supabase/functions/sync-members/index.ts
--         → agora grava também a data "paga até" no vínculo;
--       supabase/functions/update-subscription-statuses/index.ts
--         → agora cura o vínculo mesmo quando a data "paga até" está vazia.
-- 3) Se alguma pessoa continuar presa, o painel admin tem o botão de
--    sincronizar grupo (que chama a `sync-members`):
--       /admin/groups/<grupo>/edit  e  /admin/users
-- =============================================================================
