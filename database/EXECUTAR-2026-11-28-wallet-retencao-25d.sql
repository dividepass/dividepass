-- =============================================================================
-- CARTEIRA DO DONO — REPASSE SÓ DA ASSINATURA + RETENÇÃO DE 25 DIAS
-- Data: 28/11/2026
-- =============================================================================
--
-- O QUE MUDA
--
-- 1) A TAXA DE ADESÃO NÃO ENTRA MAIS NA CARTEIRA DO DONO.
--    O repasse ao dono do grupo passa a ser SOMENTE a assinatura (líquida,
--    pela faixa de margem). A taxa de adesão fica integralmente com a
--    plataforma. (Pagamentos de adesão JÁ creditados continuam no histórico —
--    não retiramos dinheiro já repassado.)
--
-- 2) O REPASSE DA ASSINATURA NASCE 'PENDENTE' E SÓ VIRA SALDO LIBERADO
--    25 DIAS DEPOIS DO PAGAMENTO.
--    Enquanto pendente, o valor NÃO entra em user_wallets.balance (não é
--    sacável). Um job diário libera os créditos vencidos.
--
-- 3) O EXTRATO GANHA DETALHE HUMANO: quem pagou e o período do ciclo.
--    Coluna nova `wallet_transactions.detail` com
--    "Usuario= <nome/email> referente ao mês <ini> até <fim>".
--    Coluna nova `wallet_transactions.release_at` = previsão de liberação.
--
-- COMO APLICAR: SQL Editor do Supabase -> colar o arquivo -> Run.
-- Idempotente (pode rodar de novo).
-- =============================================================================

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) COLUNAS NOVAS
-- ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.wallet_transactions
  ADD COLUMN IF NOT EXISTS release_at timestamptz,
  ADD COLUMN IF NOT EXISTS detail     text;

COMMENT ON COLUMN public.wallet_transactions.release_at IS
  'Previsão de liberação do crédito para o saldo do dono (pagamento + 25 dias). NULL = liberado na hora (legado).';
COMMENT ON COLUMN public.wallet_transactions.detail IS
  'Detalhe humano do repasse: quem pagou e o período do ciclo.';

-- Dias de retenção antes de liberar o repasse ao dono.
INSERT INTO public.app_settings (key, value, updated_at)
VALUES ('wallet_release_days', '25', NOW())
ON CONFLICT (key) DO NOTHING;

COMMIT;


-- ───────────────────────────────────────────────────────────────────────────
-- 2) CRÉDITO COM RETENÇÃO (usado pelo trigger)
--    Diferente de apply_wallet_credit: se release_at > agora, o crédito entra
--    como 'pending' e NÃO mexe no saldo. A liberação é feita depois pelo
--    release_due_wallet_credits().
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.apply_wallet_credit_hold(
    p_user_id       uuid,
    p_amount        numeric,
    p_description   text,
    p_reference_type text,
    p_reference_id  uuid,
    p_group_id      uuid,
    p_release_at    timestamptz,
    p_detail        text
) RETURNS boolean AS $$
DECLARE
    v_type    text;
    v_pending boolean;
BEGIN
    IF p_user_id IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
        RETURN FALSE;
    END IF;

    -- Linha em public.users é pré-requisito da FK.
    IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
        INSERT INTO public.users (id, name, email, password_hash, email_verified, created_at, updated_at)
        SELECT u.id,
               COALESCE(NULLIF(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
               u.email, 'auth-managed', (u.email_confirmed_at IS NOT NULL),
               COALESCE(u.created_at, NOW()), NOW()
        FROM auth.users u WHERE u.id = p_user_id
        ON CONFLICT (id) DO NOTHING;

        IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = p_user_id) THEN
            RAISE EXCEPTION 'dono do grupo % nao existe no Auth nem em public.users', p_user_id;
        END IF;
    END IF;

    -- Idempotência: a mesma transação nunca credita duas vezes.
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE reference_type IS NOT DISTINCT FROM p_reference_type
          AND reference_id = p_reference_id
          AND amount = p_amount
          AND description IS NOT DISTINCT FROM p_description
    ) THEN
        RETURN FALSE;
    END IF;

    v_type    := CASE WHEN p_amount < 0 THEN 'debit' ELSE 'credit' END;
    v_pending := (p_release_at IS NOT NULL AND p_release_at > NOW());

    IF NOT v_pending THEN
        INSERT INTO public.user_wallets (user_id, balance, total_earned, updated_at)
        VALUES (p_user_id, GREATEST(p_amount, 0), GREATEST(p_amount, 0), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            balance      = public.user_wallets.balance + p_amount,
            total_earned = public.user_wallets.total_earned + GREATEST(p_amount, 0),
            updated_at   = NOW();
    END IF;

    INSERT INTO public.wallet_transactions
        (user_id, type, amount, description, reference_type, reference_id,
         group_id, status, release_at, detail, paid_at, created_at)
    VALUES
        (p_user_id, v_type, p_amount, p_description, p_reference_type, p_reference_id,
         p_group_id,
         CASE WHEN v_pending THEN 'pending' ELSE 'completed' END,
         p_release_at,
         p_detail,
         CASE WHEN v_pending THEN NULL ELSE NOW() END,
         NOW());

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.apply_wallet_credit_hold(uuid, numeric, text, text, uuid, uuid, timestamptz, text)
  FROM PUBLIC, anon, authenticated, service_role;


-- ───────────────────────────────────────────────────────────────────────────
-- 3) LIBERAÇÃO DOS CRÉDITOS VENCIDOS (chamado pelo cron)
--    Vira 'completed' e entra no saldo tudo que já passou da retenção.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.release_due_wallet_credits()
RETURNS integer AS $$
DECLARE
    v_rec   record;
    v_count integer := 0;
BEGIN
    FOR v_rec IN
        SELECT wt.id, wt.user_id, wt.amount
        FROM public.wallet_transactions wt
        WHERE wt.type = 'credit'
          AND wt.status = 'pending'
          AND wt.release_at IS NOT NULL
          AND wt.release_at <= NOW()
        FOR UPDATE SKIP LOCKED
    LOOP
        UPDATE public.wallet_transactions
           SET status = 'completed', paid_at = NOW()
         WHERE id = v_rec.id;

        INSERT INTO public.user_wallets (user_id, balance, total_earned, updated_at)
        VALUES (v_rec.user_id, v_rec.amount, v_rec.amount, NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            balance      = public.user_wallets.balance + v_rec.amount,
            total_earned = public.user_wallets.total_earned + v_rec.amount,
            updated_at   = NOW();

        v_count := v_count + 1;
    END LOOP;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.release_due_wallet_credits() FROM PUBLIC, anon, authenticated;


-- ───────────────────────────────────────────────────────────────────────────
-- 4) TRIGGER DE REPASSE — só assinatura, com retenção e detalhe
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_credit_wallet_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
    v_owner         uuid;
    v_is_official   boolean;
    v_monthly_price numeric;
    v_percent       numeric;
    v_fee           numeric;
    v_net           numeric;
    v_desc          text;
    v_detail        text;
    v_release_at    timestamptz;
    v_credited      boolean;
    v_payer         text;
    v_billing       text;
    v_cycle_months  integer;
    v_cycle_days    integer;
    v_period_end    timestamptz;
    v_period_start  timestamptz;
    v_hold_days     integer;
    v_paid_at       timestamptz;
BEGIN
    IF NEW.status IS DISTINCT FROM 'paid' THEN
        RETURN NEW;
    END IF;
    IF NEW.wallet_credited_at IS NOT NULL THEN
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
        RETURN NEW;
    END IF;

    IF NEW.group_id IS NULL THEN
        UPDATE public.payments SET wallet_credit_note = 'sem repasse: pagamento sem grupo'
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    -- ── SOMENTE A ASSINATURA É REPASSADA ──────────────────────────────────
    -- A taxa de adesão fica com a plataforma (não entra na carteira do dono).
    IF NEW.payment_type IS DISTINCT FROM 'subscription' THEN
        UPDATE public.payments SET wallet_credit_note =
            CASE NEW.payment_type
              WHEN 'entrance' THEN 'sem repasse: taxa de adesao fica com a plataforma'
              ELSE 'sem repasse: tipo ' || COALESCE(NEW.payment_type, 'null')
            END
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    SELECT g.owner_id, COALESCE(g.is_official, FALSE), COALESCE(g.price_per_slot, 0)
      INTO v_owner, v_is_official, v_monthly_price
      FROM public.groups g WHERE g.id = NEW.group_id;

    IF v_owner IS NULL OR v_is_official THEN
        UPDATE public.payments SET wallet_credit_note = 'sem repasse: grupo oficial ou sem dono'
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    IF (SELECT u.role::text FROM public.users u WHERE u.id = v_owner) = 'admin' THEN
        UPDATE public.payments SET wallet_credit_note = 'sem repasse: grupo da propria plataforma'
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    -- Margem pela faixa do preço mensal (mesma regra do front / faixas).
    v_percent := public.platform_fee_percent_for(v_monthly_price);
    v_fee     := ROUND(NEW.amount * v_percent / 100, 2);
    v_net     := ROUND(NEW.amount - v_fee, 2);

    -- ── DETALHE: quem pagou + período do ciclo ────────────────────────────
    SELECT COALESCE(NULLIF(u.name, ''), u.email) INTO v_payer
      FROM public.users u WHERE u.id = NEW.user_id;

    SELECT s.billing_cycle, s.custom_cycle_months, s.custom_cycle_days,
           COALESCE(s.renewal_due_at, s.next_charge_at)
      INTO v_billing, v_cycle_months, v_cycle_days, v_period_end
      FROM public.user_subscriptions s
     WHERE s.user_id = NEW.user_id AND s.group_id = NEW.group_id
     ORDER BY s.created_at DESC
     LIMIT 1;

    v_billing      := COALESCE(v_billing, 'monthly');
    v_cycle_months := CASE v_billing
                        WHEN 'quarterly'  THEN 3
                        WHEN 'semiannual' THEN 6
                        WHEN 'annual'     THEN 12
                        WHEN 'custom'     THEN COALESCE(v_cycle_months, 1)
                        ELSE 1
                      END;
    v_cycle_days   := CASE WHEN v_billing = 'days' THEN COALESCE(v_cycle_days, 30) ELSE NULL END;

    v_paid_at := COALESCE(NEW.paid_at, NEW.created_at, NOW());

    IF v_period_end IS NULL THEN
        v_period_end := v_paid_at +
            CASE WHEN v_cycle_days IS NOT NULL
                 THEN make_interval(days => v_cycle_days)
                 ELSE make_interval(months => v_cycle_months) END;
    END IF;
    v_period_start := v_period_end -
        CASE WHEN v_cycle_days IS NOT NULL
             THEN make_interval(days => v_cycle_days)
             ELSE make_interval(months => v_cycle_months) END;

    v_detail := 'Usuario= ' || COALESCE(v_payer, '- ')
             || ' referente ao mes ' || to_char(v_period_start, 'DD/MM/YYYY')
             || ' ate ' || to_char(v_period_end, 'DD/MM/YYYY');

    -- ── RETENÇÃO DE 25 DIAS ───────────────────────────────────────────────
    v_hold_days  := COALESCE(
        (SELECT NULLIF(s.value,'')::integer FROM public.app_settings s
          WHERE s.key = 'wallet_release_days'), 25);
    v_release_at := v_paid_at + make_interval(days => v_hold_days);

    v_desc := 'Assinatura - ' || COALESCE(NEW.gateway, 'gateway');

    BEGIN
        v_credited := public.apply_wallet_credit_hold(
            v_owner, v_net, v_desc, 'payment', NEW.id, NEW.group_id,
            v_release_at, v_detail
        );

        IF v_credited THEN
            UPDATE public.payments
               SET wallet_credited_at = NOW(),
                   wallet_credit_note = 'creditado (pendente liberacao '
                     || to_char(v_release_at, 'DD/MM/YYYY') || ') ' || v_net::text
                     || ' para o dono do grupo'
             WHERE id = NEW.id;
        ELSE
            UPDATE public.payments
               SET wallet_credit_note = 'sem credito novo (ja creditado ou valor zero)'
             WHERE id = NEW.id;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'repasse falhou no pagamento %: %', NEW.id, SQLERRM;
        UPDATE public.payments
           SET wallet_credit_note = 'ERRO no repasse: ' || LEFT(SQLERRM, 200)
         WHERE id = NEW.id;
    END;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_credit_wallet_on_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_credit_wallet_on_payment ON public.payments;
CREATE TRIGGER trg_credit_wallet_on_payment
    AFTER INSERT OR UPDATE OF status, amount, payment_type, group_id ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_credit_wallet_on_payment();


-- ───────────────────────────────────────────────────────────────────────────
-- 5) RPC para o painel/liberação manual liberar vencidos (opcional)
-- ───────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.release_due_wallet_credits() TO service_role;

COMMIT;


-- ───────────────────────────────────────────────────────────────────────────
-- 6) CRON — libera os créditos vencidos (a cada hora)
-- ───────────────────────────────────────────────────────────────────────────
DO $$
DECLARE v_existe boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wallet-release-credits') INTO v_existe;
  IF v_existe THEN
    PERFORM cron.unschedule('wallet-release-credits');
  END IF;
END $$;

SELECT cron.schedule(
  'wallet-release-credits',
  '5 * * * *',
  $$SELECT public.release_due_wallet_credits()$$
);

-- ───────────────────────────────────────────────────────────────────────────
-- VERIFICAÇÃO
-- ───────────────────────────────────────────────────────────────────────────
-- SELECT tgname, tgenabled FROM pg_trigger WHERE tgname = 'trg_credit_wallet_on_payment';
-- SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'wallet-release-credits';
-- SELECT column_name FROM information_schema.columns
--   WHERE table_name='wallet_transactions' AND column_name IN ('release_at','detail');
