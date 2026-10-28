-- =============================================================================
-- DividePass — Repasse RETROATIVO: o dinheiro que já foi recebido dos membros
--                e nunca chegou na carteira de quem criou o grupo
-- =============================================================================
-- Este script e separado do fix-wallet-repasse.sql porque MOVIMENTA DINHEIRO.
--
-- O QUE ELE FAZ
--   Para cada pagamento pago (adesao/assinatura) de um grupo de terceiro que
--   ainda nao foi creditado, credita na carteira do dono do grupo o valor
--   liquido (bruto menos taxa do gateway e taxa da plataforma, a mesma conta
--   que o app ja usa).
--
-- CUIDADO COM DUPLICIDADE
--   Alguns poucos pagamentos chegaram a ser creditados pela edge function
--   antiga (confirm-payment). O script procura uma movimentacao de carteira
--   com o mesmo dono, mesmo valor e proxima da data do pagamento: se achar,
--   o pagamento e pulado. Conferir o aviso na previa antes de aplicar.
--
-- COMO RODAR (SQL Editor do Supabase)
--   0) RODE ANTES o database/fix-wallet-repasse.sql (ele cria a funcao
--      apply_wallet_credit, as colunas e o trigger).
--   1) Abra o script, troque v_do_it para FALSE (ja vem assim) e rode.
--      Ele so MOSTRA o que seria creditado. Nao muda nada.
--   2) Confirme que os numeros batem com o que o painel mostra.
--   3) Troque v_do_it para TRUE e rode de novo.
--
-- O script e idempotente: rodar duas vezes nao credita duas vezes
-- (o pagamento ganha wallet_credited_at e a chave impede a repeticao).
-- =============================================================================

DO $$
DECLARE
    v_do_it   BOOLEAN := FALSE;   -- <<< mude para TRUE para aplicar
    v_gw      NUMERIC := 4.98;
    v_pf      NUMERIC := 3.95;
    v_owner   UUID;
    v_name    TEXT;
    v_group   TEXT;
    v_net     NUMERIC;
    v_count   INT := 0;
    v_total   NUMERIC := 0;
    v_pular   INT := 0;
    r         RECORD;
BEGIN
    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'gateway_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 4.98) INTO v_gw;
    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'platform_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 3.95) INTO v_pf;

    RAISE NOTICE '--- Repasse retroativo (modo %) ---', CASE WHEN v_do_it THEN 'APLICANDO' ELSE 'PREVIA' END;
    RAISE NOTICE '--- taxas: gateway % + plataforma % ---', v_gw, v_pf;

    FOR r IN
        SELECT p.id,
               p.amount,
               p.payment_type,
               p.gateway,
               p.created_at,
               p.group_id,
               g.owner_id,
               g.name AS group_name,
               COALESCE(u.name, u.email, 'sem usuario') AS owner_name,
               ROUND(p.amount - (p.amount * (v_gw + v_pf) / 100), 2) AS liquido,
               EXISTS (
                   SELECT 1 FROM public.wallet_transactions wt
                    WHERE wt.user_id = g.owner_id
                      AND wt.reference_type = 'payment'
                      AND wt.amount = ROUND(p.amount - (p.amount * (v_gw + v_pf) / 100), 2)
                      AND wt.created_at BETWEEN p.created_at - INTERVAL '1 day' AND p.created_at + INTERVAL '15 days'
               ) AS ja_creditado
        FROM public.payments p
        JOIN public.groups g ON g.id = p.group_id
        LEFT JOIN public.users u ON u.id = g.owner_id
        WHERE p.status = 'paid'
          AND p.payment_type IN ('entrance', 'subscription')
          AND p.wallet_credited_at IS NULL
          AND g.owner_id IS NOT NULL
          AND COALESCE(g.is_official, FALSE) = FALSE
          AND COALESCE((SELECT u.role::text FROM public.users u WHERE u.id = g.owner_id), 'user') <> 'admin'
        ORDER BY p.created_at
    LOOP
        v_owner := r.owner_id;
        v_name  := r.owner_name;
        v_group := r.group_name;
        v_net   := r.liquido;

        IF r.ja_creditado THEN
            v_pular := v_pular + 1;
            RAISE NOTICE '  [pulado] % | % | ja havia movimentacao de R$ % para este dono',
                r.created_at::date, v_group, v_net;
            CONTINUE;
        END IF;

        v_count := v_count + 1;
        v_total := v_total + v_net;

        IF v_do_it THEN
            BEGIN
                PERFORM public.apply_wallet_credit(
                    v_owner, v_net,
                    CASE r.payment_type
                        WHEN 'entrance'     THEN 'Taxa de adesão (repasse retroativo) - ' || COALESCE(r.gateway, 'gateway')
                        WHEN 'subscription' THEN 'Assinatura (repasse retroativo) - ' || COALESCE(r.gateway, 'gateway')
                        ELSE 'Repasse retroativo - ' || COALESCE(r.gateway, 'gateway')
                    END,
                    'payment', r.id, r.group_id
                );

                UPDATE public.payments
                   SET wallet_credited_at = NOW(),
                       wallet_credit_note = 'repasse retroativo de ' || v_net::text || ' para ' || v_name
                 WHERE id = r.id;
            EXCEPTION WHEN OTHERS THEN
                RAISE WARNING 'falhou no pagamento %: %', r.id, SQLERRM;
                UPDATE public.payments
                   SET wallet_credit_note = 'ERRO no repasse retroativo: ' || LEFT(SQLERRM, 200)
                 WHERE id = r.id;
            END;
        ELSE
            RAISE NOTICE '  % | % | % | R$ % -> R$ % (dono: %)',
                r.created_at::date, r.payment_type, v_group, r.amount, v_net, v_name;
        END IF;
    END LOOP;

    RAISE NOTICE '--- total: % repasse(s), R$ % (% pagamento(s) ja creditado(s) e pulado(s)) ---',
        v_count, v_total, v_pular;

    IF NOT v_do_it THEN
        RAISE NOTICE '--- PREVIA: nada foi alterado. Troque v_do_it para TRUE e rode de novo. ---';
    ELSE
        RAISE NOTICE '--- repasse retroativo aplicado ---';
    END IF;
END $$;

-- =============================================================================
-- Como conferir depois
-- =============================================================================
-- SELECT wallet_credit_note, count(*) FROM public.payments
--   WHERE status='paid' GROUP BY 1 ORDER BY 2 DESC;
-- SELECT u.name, w.balance, w.total_earned
--   FROM public.user_wallets w JOIN public.users u ON u.id = w.user_id
--   ORDER BY w.balance DESC;
-- =============================================================================
