-- ═══════════════════════════════════════════════════════════════════════════
-- DividePass — Regra de faixas da margem da plataforma (2026-10-27)
-- Rodar no SQL Editor do Supabase (dashboard). Idempotente.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- O QUE MUDA
--
-- Antes, a plataforma retinha uma taxa fixa (gateway 4,98% + plataforma 3,95%
-- = 8,93%) de tudo que entrava. Agora a margem depende do VALOR MENSAL do
-- grupo, por faixas:
--
--   R$ 5,00 até R$ 8,00 ...... 50%
--   R$ 8,01 até R$ 15,00 ..... 40%
--   R$ 15,01 até R$ 30,00 .... 35%
--   R$ 30,01 até R$ 50,00 .... 25%
--   R$ 50,01 até R$ 85,00 .... 20%
--   R$ 85,01 até R$ 150,00 ... 15%
--   acima de R$ 150,00 ....... 12%
--
-- A FAIXA É ESCOLHIDA PELO PREÇO MENSAL (groups.price_per_slot), nunca pelo
-- total do ciclo. Um grupo de R$ 10/mês vendido como trimestral fatura R$ 30:
-- a faixa continua sendo a de R$ 10 (40%) e a plataforma retém 40% dos R$ 30.
-- Se a faixa fosse pelo total, vender ciclo longo daria faixa melhor — e o
-- incentivo seria distorcer o ciclo, não o preço.
--
-- POR QUE ESTE ARQUIVO EXISTE
--
-- Quem credita a carteira do dono do grupo NÃO é o front: é o trigger
-- public.trg_credit_wallet_on_payment (criado em database/fix-wallet-repasse.sql).
-- A edge function mercado-pago-webhook só registra log — o crédito real vem
-- daqui. Sem rodar este script, o dono continua recebendo o repasse com a
-- taxa antiga de 8,93% enquanto o app já mostra a faixa nova.
--
-- A MESMA TABELA DE FAIXAS está em src/lib/platformFee.js (front). Se mudar
-- uma, mude a outra — é o mesmo número em dois lugares.
--
-- O QUE NÃO MUDA
--
-- • A taxa de adesão (entrada) continua com a taxa fixa de hoje. A regra de
--   faixas é do valor MENSAL; a taxa de adesão é um valor fixo definido pela
--   administração da DividePass (app_settings.default_entrance_fee) e não tem
--   relação com o preço do grupo. Para mudar esse comportamento, ajuste o
--   bloco ELSE da função abaixo.
-- • Grupo oficial (is_official) e grupo do próprio admin continuam sem
--   repasse — o dinheiro é receita da plataforma.
-- • Pagamentos já creditedos não são recalculados (o trigger só age em linhas
--   novas ou em atualização de status/amount).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- 1) Função que calcula a margem por faixa
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.platform_fee_percent_for(p_monthly_price numeric)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_price numeric := COALESCE(p_monthly_price, 0);
BEGIN
  IF v_price <= 0 THEN
    RETURN 50;   -- sem preço de referência: faixa mais cara (conservadora)
  END IF;

  IF v_price <= 8    THEN RETURN 50;
  ELSIF v_price <= 15  THEN RETURN 40;
  ELSIF v_price <= 30  THEN RETURN 35;
  ELSIF v_price <= 50  THEN RETURN 25;
  ELSIF v_price <= 85  THEN RETURN 20;
  ELSIF v_price <= 150 THEN RETURN 15;
  ELSE RETURN 12;
  END IF;
END;
$$;

-- ───────────────────────────────────────────────────────────────────────────
-- 2) Trigger de repasse — agora com a faixa
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.trg_credit_wallet_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_owner   uuid;
  v_is_official boolean;
  v_monthly_price numeric;
  v_percent numeric;
  v_gw      numeric;
  v_pf      numeric;
  v_fee     numeric;
  v_net     numeric;
  v_desc    text;
  v_credited boolean;
BEGIN
  -- Só repassa pagamento aprovado.
  IF NEW.status IS DISTINCT FROM 'paid' THEN
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

  IF NEW.payment_type = 'subscription' THEN
    -- ── Assinatura: margem pela faixa, escolhida pelo preço MENSAL ────────
    v_percent := public.platform_fee_percent_for(v_monthly_price);
    -- A taxa e arredondada ANTES do liquido, em centavos. O front faz o mesmo
    -- (src/lib/platformFee.js): se aqui o liquido fosse subtraido do valor
    -- NAO arredondado, o dono veria R$ 0,01 a mais na simulacao do que na
    -- carteira.
    v_fee := ROUND(NEW.amount * v_percent / 100, 2);
    v_net := ROUND(NEW.amount - v_fee, 2);
  ELSE
    -- ── Taxa de adesão e outros: taxa fixa de hoje (4,98% + 3,95%) ───────
    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'gateway_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 4.98) INTO v_gw;
    SELECT COALESCE(NULLIF((SELECT s.value FROM public.app_settings s
                              WHERE s.key = 'platform_fee_percent' AND s.value ~ '^[0-9]+(\.[0-9]+)?$'), '')::numeric, 3.95) INTO v_pf;
    v_fee := ROUND(NEW.amount * (v_gw + v_pf) / 100, 2);
    v_net := ROUND(NEW.amount - v_fee, 2);
  END IF;

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
$$;

REVOKE ALL ON FUNCTION public.trg_credit_wallet_on_payment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.platform_fee_percent_for(numeric) FROM PUBLIC, anon;

COMMIT;

-- ───────────────────────────────────────────────────────────────────────────
-- Verificacao
-- ───────────────────────────────────────────────────────────────────────────
-- 1) as faixas respondem certo:
--
-- SELECT public.platform_fee_percent_for(5)    AS r5,      -- 50
--        public.platform_fee_percent_for(8)    AS r8,      -- 50
--        public.platform_fee_percent_for(8.01) AS r801,    -- 40
--        public.platform_fee_percent_for(15)   AS r15,     -- 40
--        public.platform_fee_percent_for(15.01)AS r1501,   -- 35
--        public.platform_fee_percent_for(30)   AS r30,     -- 35
--        public.platform_fee_percent_for(30.01)AS r3001,   -- 25
--        public.platform_fee_percent_for(50)   AS r50,     -- 25
--        public.platform_fee_percent_for(50.01)AS r5001,   -- 20
--        public.platform_fee_percent_for(85)   AS r85,     -- 20
--        public.platform_fee_percent_for(85.01)AS r8501,   -- 15
--        public.platform_fee_percent_for(150)  AS r150,    -- 15
--        public.platform_fee_percent_for(150.01)AS r15001, -- 12
--        public.platform_fee_percent_for(500)  AS r500;    -- 12
--
-- 2) o trigger continua instalado:
--
-- SELECT tgname, tgenabled FROM pg_trigger
--  WHERE tgname = 'trg_credit_wallet_on_payment';
--
-- 3) a partir de agora, cada pagamento novo mostra a margem aplicada em
--    public.payments.wallet_credit_note.
