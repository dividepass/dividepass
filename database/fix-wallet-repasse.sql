-- =============================================================================
-- DividePass — Repasse das carteiras (grupos criados por terceiros)
-- =============================================================================
-- POR QUE ESTE SCRIPT
--
-- Em producao a tela /admin/wallets aparece "tudo zero" porque o dinheiro
-- recebido dos membros NUNCA chega na carteira de quem criou o grupo:
--
--   1) O caminho que grava o pagamento (edge function check-iopay-tx, usado
--      pelo checkout e pelo polling) insere a linha em `payments` com
--      status='paid' e NAO chama credit_wallet. So o webhook (confirm-payment)
--      creditava - e mesmo la o id do gateway (nao-UUID em varios gateways)
--      era passado num parametro UUID, o que derrubava a chamada.
--   2) Quando o dono do grupo nao tinha linha em `public.users` (o trigger de
--      cadastro falhou numa janela), a FK de user_wallets/wallet_transactions
--      estourava e o credito inteiro se perdia.
--   3) `wallet_withdrawals` nunca teve as colunas pix_key/pix_type/bank_* que
--      o app envia - todo pedido de saque do usuario falhava com PGRST204.
--   4) `wallet_withdrawals` nao tinha `created_at`, e o app ordenava por ela.
--
-- O QUE ESTE SCRIPT FAZ
--
--   A) Cria as colunas que faltam em wallet_withdrawals (o app ja as usa).
--   B) Repoe public.users para quem existe no Auth e nao tem linha na tabela
--      publica (sem isso a FK barra o credito).
--   C) Cria o TRIGGER que credita a carteira do dono quando um pagamento vira
--      'paid'. O banco passa a ser a unica fonte do credito: vale para TODO
--      caminho de pagamento (checkout, polling, webhook, recorrencia).
--   D) Cria request_withdrawal() (usuario pede saque, saldo fica reservado)
--      e process_withdrawal() (admin paga/rejeita, saldo sai ou volta).
--   E) Ajusta credit_wallet() para nao quebrar mais e para gravar o tipo
--      certo da movimentacao.
--
-- O REPASSE RETROATIVO dos pagamentos ja feitos fica em
-- database/backfill-wallet-repasse.sql (movimenta dinheiro - rode separado).
--
-- COMO RODAR: SQL Editor do Supabase, do inicio ao fim, em uma unica transacao.
-- O script e idempotente: pode rodar de novo sem efeito colateral.
-- =============================================================================

BEGIN;

-- =============================================================================
-- A) Colunas que o app usa e que nunca existiram em producao
-- =============================================================================

ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS pix_key      TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS pix_type     TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS bank_name    TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS bank_agency  TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS bank_account TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS bank_holder  TEXT;
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS created_at   TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.wallet_withdrawals ADD COLUMN IF NOT EXISTS group_id     UUID REFERENCES public.groups(id) ON DELETE SET NULL;

UPDATE public.wallet_withdrawals SET created_at = requested_at WHERE created_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_requested  ON public.wallet_withdrawals (requested_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_withdrawals_user       ON public.wallet_withdrawals (user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_group     ON public.wallet_transactions (group_id);
CREATE INDEX IF NOT EXISTS idx_wallet_transactions_user_time ON public.wallet_transactions (user_id, created_at DESC);

-- Marcador de repasse: quando o pagamento ja virou dinheiro na carteira do dono.
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS wallet_credited_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS wallet_credit_note TEXT;

-- =============================================================================
-- B) Repor public.users (o trigger de cadastro falhou numa janela e deixou
--    varios usuarios so no Auth - sem a linha, a FK do wallet estourava)
-- =============================================================================

DO $$
BEGIN
  INSERT INTO public.users (id, name, email, password_hash, email_verified, created_at, updated_at)
  SELECT u.id,
         COALESCE(NULLIF(u.raw_user_meta_data ->> 'name', ''),
                  NULLIF(u.raw_user_meta_data ->> 'full_name', ''),
                  NULLIF(u.raw_user_meta_data ->> 'username', ''),
                  split_part(u.email, '@', 1)),
         u.email,
         'auth-managed',
         (u.email_confirmed_at IS NOT NULL),
         COALESCE(u.created_at, NOW()),
         NOW()
  FROM auth.users u
  WHERE u.email IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = u.id)
  ON CONFLICT (id) DO NOTHING;
END $$;

-- =============================================================================
-- C) Nucleo do repasse: creditar a carteira do dono quando o pagamento e pago
-- =============================================================================

-- Funcao interna de credito (usada pelo trigger e pela RPC credit_wallet).
-- Nao expoe nada para fora: quem chama e o proprio banco.
CREATE OR REPLACE FUNCTION public.apply_wallet_credit(
    p_user_id UUID,
    p_amount  NUMERIC,
    p_description TEXT,
    p_reference_type TEXT,
    p_reference_id UUID,
    p_group_id UUID
) RETURNS BOOLEAN AS $$
DECLARE
    v_type TEXT;
BEGIN
    IF p_user_id IS NULL OR p_amount IS NULL OR p_amount = 0 THEN
        RETURN FALSE;
    END IF;

    -- Sem linha em public.users o INSERT estouraria a FK e o credito inteiro
    -- se perderia. Cria a linha a partir do Auth (ou aborta em silencio).
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

    -- Idempotencia: a mesma chave nunca credita duas vezes.
    -- Chave = (reference_type, reference_id, amount, description).
    IF p_reference_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.wallet_transactions
        WHERE reference_type IS NOT DISTINCT FROM p_reference_type
          AND reference_id = p_reference_id
          AND amount = p_amount
          AND description IS NOT DISTINCT FROM p_description
    ) THEN
        RETURN FALSE;
    END IF;

    v_type := CASE WHEN p_amount < 0 THEN 'debit' ELSE 'credit' END;

    INSERT INTO public.user_wallets (user_id, balance, total_earned, updated_at)
    VALUES (p_user_id, GREATEST(p_amount, 0), GREATEST(p_amount, 0), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
        balance     = public.user_wallets.balance + p_amount,
        total_earned = public.user_wallets.total_earned + GREATEST(p_amount, 0),
        updated_at = NOW();

    INSERT INTO public.wallet_transactions
        (user_id, type, amount, description, reference_type, reference_id, group_id, status, created_at)
    VALUES
        (p_user_id, v_type, p_amount, p_description, p_reference_type, p_reference_id, p_group_id, 'completed', NOW());

    RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.apply_wallet_credit(uuid, numeric, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Trigger: quando um pagamento vira 'paid', o dono do grupo recebe na carteira.
CREATE OR REPLACE FUNCTION public.trg_credit_wallet_on_payment() RETURNS TRIGGER AS $$
DECLARE
    v_owner      UUID;
    v_is_official BOOLEAN;
    v_gw          NUMERIC := 4.98;
    v_pf          NUMERIC := 3.95;
    v_net         NUMERIC;
    v_desc        TEXT;
    v_credited    BOOLEAN;
BEGIN
    IF NEW.status IS DISTINCT FROM 'paid' THEN
        RETURN NEW;
    END IF;

    -- Ja creditado (ou nao se aplica): nao faz nada.
    IF NEW.wallet_credited_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.status = 'paid' THEN
        RETURN NEW;   -- ja estava pago: nao creditar de novo
    END IF;

    -- So adesao e assinatura de grupo entram no repasse. Fatura/invoice e
    -- cobranca da propria plataforma nao sao dinheiro de terceiro.
    IF NEW.payment_type IS NULL OR NEW.payment_type NOT IN ('entrance', 'subscription') THEN
        UPDATE public.payments SET wallet_credit_note = 'sem repasse: tipo ' || COALESCE(NEW.payment_type, 'null')
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    IF NEW.group_id IS NULL THEN
        UPDATE public.payments SET wallet_credit_note = 'sem repasse: pagamento sem grupo'
         WHERE id = NEW.id;
        RETURN NEW;
    END IF;

    SELECT g.owner_id, COALESCE(g.is_official, FALSE)
      INTO v_owner, v_is_official
      FROM public.groups g WHERE g.id = NEW.group_id;

    -- Grupo oficial e grupo de propriedade da conta admin sao da propria
    -- plataforma: o dinheiro e receita dela, nao tem repasse para ninguem.
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

    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'gateway_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 4.98) INTO v_gw;
    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'platform_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 3.95) INTO v_pf;

    v_net := ROUND(NEW.amount - (NEW.amount * (v_gw + v_pf) / 100), 2);

    v_desc := CASE NEW.payment_type
                WHEN 'entrance'    THEN 'Taxa de adesão - ' || COALESCE(NEW.gateway, 'gateway')
                WHEN 'subscription' THEN 'Assinatura - ' || COALESCE(NEW.gateway, 'gateway')
                ELSE 'Repasse - ' || COALESCE(NEW.gateway, 'gateway')
              END;

    BEGIN
        v_credited := public.apply_wallet_credit(
            v_owner, v_net, v_desc, 'payment', NEW.id, NEW.group_id
        );

        IF v_credited THEN
            UPDATE public.payments
               SET wallet_credited_at = NOW(),
                   wallet_credit_note = 'creditado ' || v_net::text || ' para o dono do grupo'
             WHERE id = NEW.id;
        ELSE
            UPDATE public.payments
               SET wallet_credit_note = 'sem credito novo (ja creditado ou valor zero)'
             WHERE id = NEW.id;
        END IF;
    EXCEPTION WHEN OTHERS THEN
        -- Nunca derruba a gravacao do pagamento: o repasse vira pendencia.
        RAISE WARNING 'repasse falhou no pagamento %: %', NEW.id, SQLERRM;
        UPDATE public.payments
           SET wallet_credit_note = 'ERRO no repasse: ' || LEFT(SQLERRM, 200)
         WHERE id = NEW.id;
    END;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.trg_credit_wallet_on_payment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_credit_wallet_on_payment ON public.payments;
CREATE TRIGGER trg_credit_wallet_on_payment
    AFTER INSERT OR UPDATE OF status, amount, payment_type, group_id ON public.payments
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_credit_wallet_on_payment();

-- =============================================================================
-- D) credit_wallet: a RPC que os edge functions usavam
-- =============================================================================
-- O credito agora e feito pelo trigger (secao C). Esta RPC continua existindo
-- para uso manual, mas NAO pode mais ser chamada pelas edge functions: elas
-- creditariam em DUPLA (o trigger ja creditou). Por isso o EXECUTE de
-- service_role e removido aqui.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.credit_wallet(
    p_user_id UUID, p_amount DECIMAL, p_description TEXT,
    p_reference_type TEXT DEFAULT NULL, p_reference_id UUID DEFAULT NULL,
    p_group_id UUID DEFAULT NULL
) RETURNS VOID AS $$
BEGIN
    IF (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role'
       AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'credit_wallet: somente service_role ou admin'
            USING ERRCODE = '42501';
    END IF;

    PERFORM public.apply_wallet_credit(
        p_user_id, p_amount, p_description, p_reference_type, p_reference_id, p_group_id
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.credit_wallet(uuid, numeric, text, text, uuid, uuid) IS
  'Credito manual na carteira. O repasse automatico e feito pelo trigger trg_credit_wallet_on_payment (payments).';

-- =============================================================================
-- E) Saque: o usuario pede, o admin paga ou rejeita
-- =============================================================================

-- Usuario pede o saque: valida saldo, reserva o valor e registra o pedido.
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_amount         DECIMAL,
    p_payment_method TEXT    DEFAULT 'pix',
    p_pix_key        TEXT    DEFAULT NULL,
    p_pix_type       TEXT    DEFAULT NULL,
    p_bank_name      TEXT    DEFAULT NULL,
    p_bank_agency    TEXT    DEFAULT NULL,
    p_bank_account   TEXT    DEFAULT NULL,
    p_bank_holder    TEXT    DEFAULT NULL,
    p_notes          TEXT    DEFAULT NULL
) RETURNS UUID AS $$
DECLARE
    v_uid       UUID := auth.uid();
    v_balance   NUMERIC := 0;
    v_withdrawal_id UUID;
BEGIN
    IF v_uid IS NULL THEN
        RAISE EXCEPTION 'request_withdrawal: usuario nao autenticado' USING ERRCODE = '42501';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'request_withdrawal: valor invalido' USING ERRCODE = '22023';
    END IF;

    SELECT balance INTO v_balance
      FROM public.user_wallets
     WHERE user_id = v_uid
     FOR UPDATE;

    v_balance := COALESCE(v_balance, 0);

    IF p_amount > v_balance THEN
        RAISE EXCEPTION 'request_withdrawal: saldo insuficiente (disponivel %)', v_balance
            USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.wallet_withdrawals
        (user_id, amount, status, payment_method, payment_details, notes,
         pix_key, pix_type, bank_name, bank_agency, bank_account, bank_holder,
         requested_at, created_at)
    VALUES
        (v_uid, p_amount, 'pending', p_payment_method,
         json_build_object('pix_key', p_pix_key, 'pix_type', p_pix_type,
                           'bank_name', p_bank_name, 'bank_agency', p_bank_agency,
                           'bank_account', p_bank_account, 'bank_holder', p_bank_holder)::text,
         p_notes, p_pix_key, p_pix_type, p_bank_name, p_bank_agency, p_bank_account, p_bank_holder,
         NOW(), NOW())
    RETURNING id INTO v_withdrawal_id;

    -- Reserva o saldo: o valor sai da carteira agora e volta se for rejeitado.
    UPDATE public.user_wallets
       SET balance = balance - p_amount, updated_at = NOW()
     WHERE user_id = v_uid;

    INSERT INTO public.wallet_transactions
        (user_id, type, amount, description, reference_type, reference_id, status, created_at)
    VALUES
        (v_uid, 'withdrawal', p_amount, 'Solicitação de saque', 'withdrawal', v_withdrawal_id, 'pending', NOW());

    RETURN v_withdrawal_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.request_withdrawal(numeric, text, text, text, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(numeric, text, text, text, text, text, text, text, text) TO authenticated;

COMMENT ON FUNCTION public.request_withdrawal(numeric, text, text, text, text, text, text, text, text) IS
  'Usuario pede saque. Valida o saldo, reserva o valor e cria o pedido pendente.';

-- Admin paga (paid) ou rejeita (rejected) o saque.
CREATE OR REPLACE FUNCTION public.process_withdrawal(
    p_withdrawal_id UUID,
    p_action        TEXT,
    p_notes         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
    w public.wallet_withdrawals%ROWTYPE;
    v_actor UUID := auth.uid();
BEGIN
    IF NOT public.is_admin() AND (auth.jwt() ->> 'role') IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'process_withdrawal: somente admin' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO w FROM public.wallet_withdrawals WHERE id = p_withdrawal_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'process_withdrawal: saque nao encontrado' USING ERRCODE = 'P0002';
    END IF;
    IF w.status <> 'pending' THEN
        RAISE EXCEPTION 'process_withdrawal: saque ja processado (%)', w.status USING ERRCODE = '22023';
    END IF;

    IF p_action = 'paid' THEN
        UPDATE public.wallet_withdrawals
           SET status = 'completed', processed_at = NOW(), processed_by = v_actor,
               notes = COALESCE(p_notes, notes)
         WHERE id = p_withdrawal_id;

        -- O saldo ja foi reservado na solicitacao: aqui so confirma.
        UPDATE public.wallet_transactions
           SET status = 'completed', paid_at = NOW()
         WHERE reference_type = 'withdrawal' AND reference_id = p_withdrawal_id AND status = 'pending';

    ELSIF p_action = 'rejected' THEN
        UPDATE public.wallet_withdrawals
           SET status = 'rejected', processed_at = NOW(), processed_by = v_actor,
               notes = COALESCE(p_notes, notes)
         WHERE id = p_withdrawal_id;

        -- Devolve o valor reservado.
        UPDATE public.user_wallets
           SET balance = balance + w.amount, updated_at = NOW()
         WHERE user_id = w.user_id;

        UPDATE public.wallet_transactions
           SET status = 'cancelled'
         WHERE reference_type = 'withdrawal' AND reference_id = p_withdrawal_id AND status = 'pending';

    ELSE
        RAISE EXCEPTION 'process_withdrawal: acao invalida (%)', p_action USING ERRCODE = '22023';
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.process_withdrawal(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_withdrawal(uuid, text, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.process_withdrawal(uuid, text, text) IS
  'Admin paga (paid) ou rejeita (rejected) um saque pendente. O saldo foi reservado na solicitacao.';

-- O usuario precisa enxergar o proprio pedido de saque e o proprio extrato.
DROP POLICY IF EXISTS "Users view own withdrawals" ON public.wallet_withdrawals;
CREATE POLICY "Users view own withdrawals"
  ON public.wallet_withdrawals FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS "Users see own transactions" ON public.wallet_transactions;
CREATE POLICY "Users see own transactions"
  ON public.wallet_transactions FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

-- Endurecimento: a migration 20260724 deixou a policy "Service role can
-- insert wallet transactions" (FOR INSERT WITH CHECK (true), sem TO) em
-- wallet_transactions. Sem o REVOKE de tabela, QUALQUER autenticado conseguia
-- inserir movimentacao falsa na carteira (inclusive de outro usuario) e
-- forjar o extrato. A partir de agora toda escrita em wallet_transactions
-- passa pelas RPCs (SECURITY DEFINER), que o front nao consegue furar.
DROP POLICY IF EXISTS "Service role can insert wallet transactions" ON public.wallet_transactions;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.wallet_transactions FROM anon, authenticated;

-- =============================================================================
-- F) Impedir credito em dupla
-- =============================================================================
-- O trigger (secao C) ja credita no pagamento. Se as edge functions continuarem
-- chamando credit_wallet, o valor entraria duas vezes. A RPC fica sem
-- EXECUTE para service_role (as edge functions) e continua liberada para o
-- admin, que usa credit_wallet so em manuais.
--
-- ATENCAO: se voce rodar o fix-p0-security.sql de novo, ele restaura o grant
-- para service_role (linha "GRANT EXECUTE ON ALL FUNCTIONS ... TO service_role").
-- Rode este script DEPOIS dele, ou comente essa linha do fix-p0.
-- =============================================================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT p.oid::regprocedure::text AS sig
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'credit_wallet'
    LOOP
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM service_role', r.sig);
    END LOOP;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- Como conferir depois de rodar
-- =============================================================================
-- SELECT count(*) FROM public.payments WHERE status='paid';
-- SELECT count(*) FROM public.payments WHERE status='paid' AND wallet_credited_at IS NOT NULL;
-- SELECT wallet_credit_note, count(*) FROM public.payments
--   WHERE status='paid' GROUP BY 1 ORDER BY 2 DESC;
-- =============================================================================
