-- ============================================================================
-- EXECUTAR NO SQL EDITOR DO SUPABASE — projeto lasoouwboxspstqvjbsv
-- ============================================================================
-- Data: 01/11/2026
-- Motivo: fechar a rodada das "Ofertas patrocinadas no catálogo" (a
-- monetização da plataforma) e destravar as engrenagens que dependem do
-- banco.
--
-- O QUE ESTE ARQUIVO FAZ (3 coisas, tudo idempotente)
-- ---------------------------------------------------
--   1. O ID CURTO DA OFERTA (8 caracteres, letras e números) + a RPC
--      `increment_sponsor_metric` — é o que faz a MÉTRICA do anúncio contar.
--      Sem a RPC, o painel do admin mostra 0 cliques para sempre e o parceiro
--      não vê retorno nenhum pelo que pagou.
--
--   2. O segredo + o agendamento de 15 em 15 min da reconciliação de
--      pagamentos (a rede de segurança do "paguei e não fui add ao grupo").
--      Precisa da edge function `reconcile-payments` no ar (é publicado
--      pelo terminal — veja scripts/publicar-edge-functions.mjs).
--
--   3. UMA OFERTA DE DEMONSTRAÇÃO (id `dddddddd`, 7 dias, serviço Netflix)
--      para a área patrocinada aparecer de fato no catálogo e nos
--      "Recomendados para você". Sem nenhuma oferta cadastrada, ninguém vê
--      a feature.
--
-- COMO EXECUTAR
-- -------------
--   Dashboard → SQL Editor → New query → cole o arquivo INTEIRO → Run.
--   Se aparecer "Potential issue detected — destructive operations", clique
--   em "Run query".
--
-- PODE RODAR DE NOVO: nada é duplicado (a RPC é recriada, o job do cron é
-- recriado, a oferta de demonstração é atualizada).
--
-- ⚠️ A OFERTA DE DEMONSTRAÇÃO É REAL PARA O USUÁRIO: ela aparece no
--    catálogo e na faixa de recomendados durante 7 dias. Para encerrar antes:
--    UPDATE public.sponsored_offers SET status = 'ended'
--      WHERE id = 'dddddddd';
-- ============================================================================


-- ─────────────────────────────────────────────────────────────
-- 1. ID CURTO DA OFERTA + RPC QUE SOMA A MÉTRICA
-- ─────────────────────────────────────────────────────────────
-- 1.1. ID DE 8 CARACTERES (letras e números).
--      A tabela nasceu com `id UUID` (36 caracteres). O projeto usa código
--      curto no resto (código de grupo, slug), então a oferta passa a ter um
--      id de 8 caracteres. Conversão segura: a tabela está vazia e nenhuma
--      outra tabela tem FK apontando para `sponsored_offers.id`.
--
--      É um ALTER direto (e não um IF sobre information_schema) de propósito:
--      dentro de um bloco DO, o `information_schema` devolve o tipo ANTIGO
--      (o plano da view fica cacheado com o snapshot de quando foi
--      compilado) e o guard mentia, anunciando "convertida" toda vez.
--      Converter text em text não tem efeito — então rodar de novo é seguro.
ALTER TABLE public.sponsored_offers ALTER COLUMN id DROP DEFAULT;
ALTER TABLE public.sponsored_offers ALTER COLUMN id TYPE TEXT USING id::text;

-- Id novo de oferta: 8 caracteres de letra e número (0-9a-f).
ALTER TABLE public.sponsored_offers
  ALTER COLUMN id SET DEFAULT substr(md5(random()::text || clock_timestamp()::text), 1, 8);

-- 1.2. A RPC.
--      `SECURITY DEFINER`: é a ÚNICA escrita pública na tabela de ofertas
--      (o RLS só libera escrita para admin, então o PATCH do navegador era
--      engolido — o PostgREST devolvia "200 []", sucesso falso).
--      E só conta oferta ATIVA e dentro do período.
--
--      A versão antiga (p_offer_id UUID) é removida: com as duas funções de
--      mesmo nome, o PostgREST não sabe qual chamar.
DROP FUNCTION IF EXISTS public.increment_sponsor_metric(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.increment_sponsor_metric(
    p_offer_id TEXT,
    p_metric   TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_new INTEGER;
BEGIN
    IF p_metric = 'click' THEN
        UPDATE public.sponsored_offers
           SET clicks = clicks + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING clicks INTO v_new;

    ELSIF p_metric = 'impression' THEN
        UPDATE public.sponsored_offers
           SET impressions = impressions + 1
         WHERE id = p_offer_id
           AND status = 'active'
           AND period_start <= NOW()
           AND (period_end IS NULL OR period_end >= NOW())
        RETURNING impressions INTO v_new;

    ELSE
        RAISE EXCEPTION 'métrica inválida: %', p_metric;
    END IF;

    -- Oferta fora do período / pausada: devolve 0 em vez de erro.
    RETURN COALESCE(v_new, 0);
END;
$$;

COMMENT ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) IS
    'Soma 1 em clicks/impressions de uma oferta patrocinada ativa. SECURITY DEFINER: é a única escrita pública na tabela.';

-- anon não conta nada (ninguém anônimo conta clique);
-- authenticated é quem vê o anúncio; service_role é o job/painel.
REVOKE ALL ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.increment_sponsor_metric(TEXT, TEXT) TO authenticated, service_role;


-- ─────────────────────────────────────────────────────────────
-- 2. RECONCILIAÇÃO DE PAGAMENTOS (segredo + agendamento)
-- ─────────────────────────────────────────────────────────────
-- 2.1. O segredo que o cron manda no Authorization.
--     A edge function aceita o segredo guardado em `app_settings`
--     (chave `reconcile_payments_cron_secret`).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.app_settings WHERE key = 'reconcile_payments_cron_secret'
  ) THEN
    INSERT INTO public.app_settings (key, value)
    VALUES (
      'reconcile_payments_cron_secret',
      md5(random()::text || clock_timestamp()::text)
        || md5(random()::text || clock_timestamp()::text)
    );
    RAISE NOTICE 'Segredo reconcile_payments_cron_secret criado.';
  ELSE
    RAISE NOTICE 'Segredo reconcile_payments_cron_secret ja existe (mantido).';
  END IF;
END $$;

-- 2.2. O job de 15 em 15 minutos.
--     Tudo aqui é dinâmico (EXECUTE) de propósito: se o `pg_cron` não
--     estiver habilitado no projeto, o script NÃO quebra — ele avisa e
--     segue. A reconciliação manual continua valendo:
--       POST https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments
DO $$
DECLARE
    v_comando text := $cmd$
      select net.http_post(
        url := 'https://lasoouwboxspstqvjbsv.supabase.co/functions/v1/reconcile-payments',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (
            SELECT value FROM public.app_settings WHERE key = 'reconcile_payments_cron_secret'
          )
        ),
        body := '{}'::jsonb
      );
    $cmd$;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE WARNING 'pg_cron nao esta habilitado neste projeto: o agendamento foi pulado. Habilite a extensao no painel (Database > Extensions) e rode este arquivo de novo.';
    RETURN;
  END IF;

  BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reconcile-payments') THEN
      PERFORM cron.unschedule('reconcile-payments');
      RAISE NOTICE 'Job anterior removido (vai recriar).';
    END IF;

    PERFORM cron.schedule('reconcile-payments', '*/15 * * * *', v_comando);
    RAISE NOTICE 'Job reconcile-payments agendado: a cada 15 minutos.';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'Nao consegui agendar o cron: %', SQLERRM;
  END;
END $$;


-- ─────────────────────────────────────────────────────────────
-- 3. OFERTA DE DEMONSTRAÇÃO (para a área patrocinada aparecer)
-- ─────────────────────────────────────────────────────────────
-- Netflix (slug 'netflix') como serviço do anúncio, período de 7 dias,
-- placement 'both' (topo do catálogo E faixa de recomendados), prioridade
-- alta para aparecer no topo. Valor de R$ 49,90 é só registro comercial
-- (a tabela não processa pagamento).
INSERT INTO public.sponsored_offers (
  id, service_id, group_id, sponsor_user_id,
  sponsor_name, headline, description, badge, cta_label, cta_url, banner_url,
  placement, amount_paid, period_start, period_end,
  status, priority, impressions, clicks, notes
) VALUES (
  'dddddddd',
  COALESCE(
    (SELECT id FROM public.streaming_services WHERE slug = 'netflix' LIMIT 1),
    (SELECT id FROM public.streaming_services WHERE status = 'active' ORDER BY name LIMIT 1)
  ),
  NULL, NULL,
  'Parceiro de Teste',
  'Oferta em destaque',
  'Oferta de demonstracao para validar o espaco patrocinado no catalogo e nos recomendados. Pode apagar quando quiser.',
  'Oferta em destaque',
  'Ver oferta',
  NULL, NULL,
  'both',
  49.90,
  NOW() - INTERVAL '1 day',
  NOW() + INTERVAL '7 days',
  'active',
  10,
  0, 0,
  'DEMO 01/11/2026 - criada pelo script de publicacao. Apagavel em /admin/sponsored-offers.'
)
ON CONFLICT (id) DO UPDATE SET
  service_id   = EXCLUDED.service_id,
  sponsor_name = EXCLUDED.sponsor_name,
  headline     = EXCLUDED.headline,
  description  = EXCLUDED.description,
  badge        = EXCLUDED.badge,
  placement    = EXCLUDED.placement,
  amount_paid  = EXCLUDED.amount_paid,
  period_start = EXCLUDED.period_start,
  period_end   = EXCLUDED.period_end,
  status       = EXCLUDED.status,
  priority     = EXCLUDED.priority,
  notes        = EXCLUDED.notes;


-- ─────────────────────────────────────────────────────────────
-- 4. CONFERÊNCIA (o que tem que aparecer)
-- ─────────────────────────────────────────────────────────────
-- 4.1. A RPC existe?
SELECT 'RPC increment_sponsor_metric' AS item,
       count(*)::text AS estado,
       '1 = criada' AS esperado
FROM pg_proc
WHERE proname = 'increment_sponsor_metric';

-- 4.2. A oferta de demonstração está no ar?
SELECT id, sponsor_name, headline, badge, placement,
       amount_paid, period_start, period_end, status, priority,
       impressions, clicks
FROM public.sponsored_offers
WHERE id = 'dddddddd';

-- 4.3. O cron da reconciliação (só aparece se o pg_cron estiver ligado)
DO $$
DECLARE
    r RECORD;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    FOR r IN EXECUTE
      'SELECT jobid, jobname, schedule, active FROM cron.job WHERE jobname = ''reconcile-payments'''
    LOOP
      RAISE NOTICE 'Cron: % | % | % | ativo=%', r.jobid, r.jobname, r.schedule, r.active;
    END LOOP;
  ELSE
    RAISE NOTICE 'pg_cron desligado: a reconciliacao precisa ser chamada na mao.';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────
-- 5. O QUE FALTA DEPOIS DESTE SQL
-- ─────────────────────────────────────────────────────────────
-- As EDGE FUNCTIONS não são publicadas por SQL. No terminal, com o login do
-- Supabase da sua conta:
--
--    npx supabase login
--    node scripts/publicar-edge-functions.mjs
--
-- São 5 funções: notify-service-watchers (o aviso de vaga), reconcile-payments
-- (a reconciliação), provision-group-mailbox, send-welcome-email e
-- delete-account (a versão corrigida).
-- ============================================================================
