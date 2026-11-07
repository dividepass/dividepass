-- ═══════════════════════════════════════════════════════════════════════════
-- REPARO — caso Marisa Córdoba Amarantes (pagou, não entrou no grupo)
-- Data: 2026-11-01
-- ───────────────────────────────────────────────────────────────────────────
-- COMO USAR
--   1. RODE ANTES o database/diagnostico-marisa-2026-11-01.sql e me mande o
--      resultado (preciso confirmar que o grupo alvo é o certo).
--   2. Cole este arquivo INTEIRO no SQL Editor do Supabase e clique em Run.
--   3. É idempotente: rodar duas vezes não muda nada na segunda.
--
-- O QUE ESTE ARQUIVO FAZ (só a Marisa, só a transação citada):
--   1. Descobre o grupo alvo (o grupo da referência da transação; se ele não
--      existir mais, o grupo onde ela pagou a taxa de adesão).
--   2. Garante a linha 'payments' (status paid) da transação — é ela que
--      libera o acesso e faz o job de reconciliação considerar o caso resolvido.
--   3. Ativa a assinatura (status active, billing_status active) com a data de
--      próxima cobrança.
--   4. Cativa o vínculo em group_members (status active, payment_status active,
--      left_at NULL) e grava o prazo 'paga até'.
--   5. Marca a tentativa de pagamento como 'approved' e registra um evento no
--      painel (auditoria).
--
-- O QUE ESTE ARQUIVO NÃO FAZ:
--   - Não cancela nem desvincula ninguém.
--   - Não toca em nenhuma outra pessoa, grupo ou transação.
--   - Não envia e-mail (o envio é do código; este é o conserto de dados).
--
-- SE ABORTAR: o bloco só aborta se não existir nenhum grupo válido para o
-- reparo — nesse caso nada é gravado (o bloco inteiro é uma transação: ou
-- grava tudo, ou não grava nada).
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_usuario   uuid := 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456';
  v_tx        text := 'd73c9d40a7464a3db981a80137918e67';
  v_referencia uuid := '11111111-1111-1111-1111-111111111111';

  v_grupo     uuid;
  v_service   uuid;
  v_preco     numeric(10,2);
  v_ciclo     text := 'monthly';
  v_metodo    payment_method := 'pix';

  v_sub_alvo  uuid;   -- assinatura já existente para (usuário, grupo alvo)
  v_orfao     uuid;   -- assinatura 'pending' sem grupo válido
  v_sub       uuid;
  v_sub_ciclo text;
  v_next      timestamptz;
  v_valor     numeric(10,2);

  v_pag_inserido int := 0;
  v_sub_atualizada int := 0;
  v_orfao_relativo uuid;
BEGIN
  -- ────────────────────────────────────────────────────────────────────────
  -- 1) GRUPO ALVO — determinístico (a escolha NÃO pode ser no "azar")
  --
  --    Pontuação (maior vence):
  --      100  grupo da referência da transação (é o grupo que ela pagou)
  --       60  grupo onde ela pagou a taxa de adesão (entrance_paid)
  --       50  grupo onde ela já está com pagamento ativo
  --       30  grupo de uma assinatura dela (qualquer status)
  --       20  qualquer outro vínculo dela
  --       10  grupo aberto (status open)
  --    Desempate final: nome e id (sempre o mesmo resultado).
  -- ────────────────────────────────────────────────────────────────────────
  SELECT g.id, g.service_id, g.price_per_slot, COALESCE(g.billing_cycle, 'monthly')
    INTO v_grupo, v_service, v_preco, v_ciclo
  FROM groups g
  WHERE g.id = v_referencia
     OR EXISTS (SELECT 1 FROM group_members gm
                 WHERE gm.group_id = g.id AND gm.user_id = v_usuario)
     OR EXISTS (SELECT 1 FROM user_subscriptions us
                 WHERE us.group_id = g.id AND us.user_id = v_usuario)
  ORDER BY
    (CASE WHEN g.id = v_referencia THEN 100 ELSE 0 END)
  + (CASE WHEN EXISTS (SELECT 1 FROM group_members gm
                        WHERE gm.group_id = g.id AND gm.user_id = v_usuario
                          AND gm.payment_status::text = 'entrance_paid') THEN 60 ELSE 0 END)
  + (CASE WHEN EXISTS (SELECT 1 FROM group_members gm
                        WHERE gm.group_id = g.id AND gm.user_id = v_usuario
                          AND gm.payment_status::text = 'active') THEN 50 ELSE 0 END)
  + (CASE WHEN EXISTS (SELECT 1 FROM user_subscriptions us
                        WHERE us.group_id = g.id AND us.user_id = v_usuario) THEN 30 ELSE 0 END)
  + (CASE WHEN EXISTS (SELECT 1 FROM group_members gm
                        WHERE gm.group_id = g.id AND gm.user_id = v_usuario) THEN 20 ELSE 0 END)
  + (CASE WHEN g.status = 'open' THEN 10 ELSE 0 END) DESC,
    g.name, g.id
  LIMIT 1;

  IF v_grupo IS NULL THEN
    RAISE EXCEPTION
      'REPARO ABORTADO: nenhum grupo válido para a Marisa (sem grupo da referência, sem assinatura pendente com grupo existente e sem adesão paga). Nada foi gravado.';
  END IF;

  v_valor := COALESCE(v_preco, 9.90);

  -- Método do pagamento: pega da tentativa quando é um valor válido do enum.
  SELECT CASE
           WHEN pa.payment_method IN ('pix','credit_card','bank_slip')
             THEN pa.payment_method::payment_method
           ELSE 'pix'::payment_method
         END
    INTO v_metodo
  FROM payment_attempts pa
  WHERE pa.gateway_transaction_id = v_tx
  ORDER BY pa.created_at ASC
  LIMIT 1;

  -- ────────────────────────────────────────────────────────────────────────
  -- 2) ASSINATURA: qual linha vamos ativar
  --    a) já existe assinatura para (usuário, grupo alvo)  -> ativa ela
  --    b) existe assinatura 'pending' órfã (grupo nulo ou inexistente)
  --       -> reaponta para o grupo alvo e ativa
  --    c) não existe nenhuma                             -> cria
  -- ────────────────────────────────────────────────────────────────────────
  SELECT us.id INTO v_sub_alvo
  FROM user_subscriptions us
  WHERE us.user_id = v_usuario AND us.group_id = v_grupo
  ORDER BY us.created_at DESC
  LIMIT 1;

  SELECT us.id INTO v_orfao
  FROM user_subscriptions us
  WHERE us.user_id = v_usuario
    AND us.status::text = 'pending'
    AND (us.group_id IS NULL
         OR NOT EXISTS (SELECT 1 FROM groups g WHERE g.id = us.group_id))
  ORDER BY us.created_at DESC
  LIMIT 1;

  IF v_sub_alvo IS NOT NULL THEN
    v_sub := v_sub_alvo;
    IF v_orfao IS NOT NULL AND v_orfao <> v_sub_alvo THEN
      v_orfao_relativo := v_orfao;  -- fica como está (não cancela nada)
    END IF;
  ELSIF v_orfao IS NOT NULL THEN
    v_sub := v_orfao;
  END IF;

  IF v_sub IS NOT NULL THEN
    SELECT us.billing_cycle, us.next_charge_at INTO v_sub_ciclo, v_next
    FROM user_subscriptions us WHERE us.id = v_sub;
  END IF;

  IF v_sub_ciclo IS NOT NULL THEN
    v_ciclo := v_sub_ciclo;
  END IF;

  -- Próxima cobrança: preserva a que já existe (no futuro); senão recalcula.
  IF v_next IS NULL OR v_next <= now() THEN
    IF v_ciclo = 'quarterly'   THEN v_next := now() + interval '3 months';
    ELSIF v_ciclo = 'semiannual' THEN v_next := now() + interval '6 months';
    ELSIF v_ciclo = 'annual'   THEN v_next := now() + interval '12 months';
    ELSE v_next := now() + interval '1 month';
    END IF;
  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- 3) PAGAMENTO APLICADO (é o que libera o acesso e encerra a reconciliação)
  -- ────────────────────────────────────────────────────────────────────────
  IF NOT EXISTS (SELECT 1 FROM payments WHERE transaction_code = v_tx) THEN
    INSERT INTO payments
      (user_id, subscription_id, group_id, amount, method, payment_type, gateway,
       status, transaction_code, notes, paid_at, created_at)
    VALUES
      (v_usuario, v_sub, v_grupo, v_valor, v_metodo, 'subscription', 'iopay',
       'paid', v_tx,
       'Reparo manual 2026-11-01: confirmacao aplicada via SQL (o gateway nao disparou a liberacao)',
       now(), now());
    v_pag_inserido := 1;
  END IF;

  -- ────────────────────────────────────────────────────────────────────────
  -- 4) ASSINATURA ATIVA
  -- ────────────────────────────────────────────────────────────────────────
  IF v_sub IS NOT NULL THEN
    UPDATE user_subscriptions
       SET group_id        = v_grupo,
           -- O serviço vem do GRUPO ALVO (é ele que manda): se a assinatura
           -- apontava para um grupo que não existe mais, o service_id antigo
           -- era de outro produto e ficava inconsistente com o grupo.
           service_id      = COALESCE(v_service, service_id),
           status          = 'active',
           billing_status  = 'active',
           gateway         = COALESCE(gateway, 'iopay'),
           gateway_subscription_id = COALESCE(gateway_subscription_id, v_tx),
           gateway_status  = COALESCE(gateway_status, 'authorized'),
           amount          = COALESCE(amount, v_valor),
           billing_cycle   = COALESCE(billing_cycle, v_ciclo),
           next_charge_at  = v_next,
           renewal_due_at  = v_next,
           last_charge_at  = now(),
           started_at      = COALESCE(started_at, now()),
           updated_at      = now()
     WHERE id = v_sub;
    v_sub_atualizada := 1;
  ELSE
    INSERT INTO user_subscriptions
      (user_id, group_id, service_id, status, billing_status, billing_cycle, amount,
       gateway, gateway_subscription_id, gateway_status, payment_method,
       next_charge_at, renewal_due_at, last_charge_at, started_at, created_at, updated_at)
    VALUES
      (v_usuario, v_grupo, v_service, 'active', 'active', v_ciclo, v_valor,
       'iopay', v_tx, 'authorized', v_metodo,
       v_next, v_next, now(), now(), now(), now());
    v_sub_atualizada := 1;
  END IF;

  SELECT us.id INTO v_sub
  FROM user_subscriptions us
  WHERE us.user_id = v_usuario AND us.group_id = v_grupo
  ORDER BY us.created_at DESC LIMIT 1;

  -- ────────────────────────────────────────────────────────────────────────
  -- 5) VÍNCULO ATIVO NO GRUPO
  -- ────────────────────────────────────────────────────────────────────────
  INSERT INTO group_members
    (group_id, user_id, status, payment_status, joined_at, subscription_deadline,
     created_at, updated_at)
  VALUES
    (v_grupo, v_usuario, 'active', 'active', now(), v_next, now(), now())
  ON CONFLICT (group_id, user_id) DO UPDATE
    SET status               = 'active',
        payment_status       = 'active',
        left_at              = NULL,
        joined_at            = COALESCE(group_members.joined_at, now()),
        subscription_deadline = v_next,
        updated_at           = now();

  -- ────────────────────────────────────────────────────────────────────────
  -- 6) AUDITORIA: tentativa marcada como aprovada + evento no painel
  -- ────────────────────────────────────────────────────────────────────────
  UPDATE payment_attempts
     SET status           = 'approved',
         updated_at       = now(),
         error_message    = NULL
   WHERE gateway_transaction_id = v_tx
     AND status IS DISTINCT FROM 'approved';

  IF NOT EXISTS (
    SELECT 1 FROM platform_events
     WHERE metadata::text LIKE '%' || v_tx || '%'
       AND event_type = 'payment'
  ) THEN
    INSERT INTO platform_events (event_type, title, message, metadata)
    VALUES (
      'payment',
      'Pagamento confirmado (reparo manual)',
      'Pagamento aprovado no gateway sem liberacao automatica — confirmacao aplicada via SQL.',
      jsonb_build_object(
        'user_id', v_usuario,
        'group_id', v_grupo,
        'transaction_id', v_tx,
        'amount', v_valor,
        'gateway', 'iopay',
        'payment_type', 'subscription',
        'repaired_at', now()
      )
    );
  END IF;

  RAISE NOTICE 'REPARO OK — grupo % (%), assinatura %, pagamento inserido: %, assinatura atualizada: %',
    v_grupo, (SELECT name FROM groups WHERE id = v_grupo), v_sub, v_pag_inserido, v_sub_atualizada;
  IF v_orfao_relativo IS NOT NULL THEN
    RAISE NOTICE 'ATENCAO: a assinatura orfa (pending, grupo inexistente) % continua como estava — nao cancelei nada.', v_orfao_relativo;
  END IF;
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- RESULTADO FINAL (o que o SQL Editor mostra): estado da Marisa agora
-- ───────────────────────────────────────────────────────────────────────────
SELECT
  us.id                          AS assinatura_id,
  us.status                      AS assinatura_status,
  us.billing_status              AS cobranca_status,
  g.name                         AS grupo,
  g.slug                         AS grupo_slug,
  s.name                         AS servico,
  us.amount                      AS valor,
  us.billing_cycle               AS ciclo,
  us.next_charge_at              AS proxima_cobrança,
  gm.status                      AS vinculo_status,
  gm.payment_status              AS vinculo_pagamento,
  gm.subscription_deadline       AS paga_ate,
  (SELECT count(*) FROM payments p
    WHERE p.transaction_code = 'd73c9d40a7464a3db981a80137918e67') AS pagamentos_da_tx,
  (SELECT status FROM payment_attempts pa
    WHERE pa.gateway_transaction_id = 'd73c9d40a7464a3db981a80137918e67'
    ORDER BY pa.created_at ASC LIMIT 1) AS status_da_tentativa
FROM user_subscriptions us
LEFT JOIN groups g  ON g.id = us.group_id
LEFT JOIN group_members gm ON gm.group_id = us.group_id AND gm.user_id = us.user_id
LEFT JOIN streaming_services s ON s.id = us.service_id
WHERE us.user_id = 'd2ccd4d5-d811-4f04-8d65-4f64bbefb456'
ORDER BY us.created_at DESC;
