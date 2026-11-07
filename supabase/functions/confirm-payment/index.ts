// Shared payment confirmation logic
// Called by all webhook handlers after verifying the payment

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";
import { notifyAdminPayment } from "../_shared/admin-payment-email.ts";
import { notifySubscriptionCreated } from "../_shared/subscription-emails.ts";
import {
  notifyPaymentReceived,
  notifyMemberJoined,
} from "../_shared/payment-emails.ts";
// Pulse Coding (revenda): grupos "Via Parceiro" — a compra na Pulse acontece
// depois do pagamento confirmado, com o external_id do MEU pedido.
import {
  dataValidade,
  instanteValidade,
  processarCompraViaParceiro,
  resolverViaParceiro,
} from "../_shared/pulse-orders.ts";
// Metodo de pagamento: o gateway (IO Pay) devolve um OBJETO (cartao inteiro /
// BR Code) e a coluna `user_subscriptions.payment_method` e VARCHAR(50).
// Gravar o que veio do gateway estourava o limite e a liberacao do grupo
// falhava DEPOIS do dinheiro cair. Aqui sempre grava-se o metodo normalizado.
import { limitarTexto, metodoPagamentoSeguro } from "../_shared/metodo-pagamento.ts";

interface ConfirmParams {
  gateway: string;
  group_id: string;
  user_id: string;
  payment_type: "entrance" | "subscription" | "combined";
  amount: number;
  status: "approved" | "rejected" | "pending";
  gateway_payment_id: string;
  payment_method?: string;
  billing_cycle?: string | null;
  custom_cycle_days?: number | null;
  custom_cycle_months?: number | null;
  /**
   * A confirmação veio do botão "forçar" do admin? Muda o título do evento
   * no painel ("Pagamento confirmado (forçado)") e grava `forced: true` no
   * metadado, para dar pra distinguir na hora o que foi automático do que
   * foi manual.
   */
  forced?: boolean;
}

/**
 * `payments.method` e um ENUM: ('pix','credit_card','bank_slip').
 *
 * O caminho do webhook gravava valores como "unknown", "subscription" e
 * "iopay" — TODOS fora do ENUM. O insert era REJEITADO pelo Postgres e a
 * linha do pagamento nunca existia. Consequencias: o pagamento nao aparecia
 * na tela de billing e a trava de idempotencia (que le `payments`) nunca
 * disparava, entao um replay do webhook refazia tudo.
 */
function normalizePaymentMethod(raw?: string | null): "pix" | "credit_card" | "bank_slip" {
  const value = String(raw || "").toLowerCase().trim();
  if (value.includes("pix")) return "pix";
  if (value.includes("credit") || value.includes("card") || value.includes("iopay")) return "credit_card";
  if (value.includes("boleto") || value.includes("bank") || value.includes("slip")) return "bank_slip";
  return "credit_card";
}

/** Obtém official_price e paid_amount (após cupom) para rastrear economia de assinatura. */
async function getSavingsData(
  supabaseAdmin: any,
  group_id: string,
  gateway_payment_id: string,
  defaultAmount: number,
): Promise<{ official_price: number | null; paid_amount: number }> {
  try {
    // Buscar preço oficial via service do grupo
    const { data: group } = await supabaseAdmin
      .from("groups")
      .select("service_id")
      .eq("id", group_id)
      .maybeSingle();

    let officialPrice: number | null = null;
    if (group?.service_id) {
      const { data: service } = await supabaseAdmin
        .from("streaming_services")
        .select("official_price")
        .eq("id", group.service_id)
        .maybeSingle();
      officialPrice = service?.official_price ? Number(service.official_price) : null;
    }

    // Buscar valor pago (pode ser menor se cupom foi usado).
    //
    // `payment_attempts` NAO tem a coluna `final_amount` — asking por ela
    // fazia o select inteiro falhar e o valor pago caia no default. E o
    // `.maybeSingle()` abortava quando o polling ja tinha gravado varias
    // linhas com o mesmo transaction_id.
    let paidAmount = defaultAmount;
    try {
      const { data: attemptRows } = await supabaseAdmin
        .from("payment_attempts")
        .select("coupon_id, original_amount, discount_amount")
        .eq("gateway_transaction_id", gateway_payment_id)
        .order("created_at", { ascending: true })
        .limit(1);

      const attempt = (attemptRows && attemptRows[0]) || null;
      if (attempt?.original_amount != null && attempt?.discount_amount != null) {
        paidAmount = Number(attempt.original_amount) - Number(attempt.discount_amount);
      }
    } catch (_) {
      // payment_attempts pode não existir — usar amount padrão
    }

    return { official_price: officialPrice, paid_amount: paidAmount };
  } catch (e) {
    console.warn("[getSavingsData] erro:", e);
    return { official_price: null, paid_amount: defaultAmount };
  }
}

/**
 * Os DOIS e-mails do cliente: "recebemos o seu pagamento" e "você entrou no
 * grupo".
 *
 * Por que aqui e não em cada chamador: o polling do navegador, o webhook do
 * gateway e a confirmação manual do admin são três entradas diferentes. Com a
 * chamada dentro da confirmação compartilhada, qualquer uma delas dispara os
 * e-mails — e a trava de duplicidade (`dedup_key`) impede o e-mail duplo
 * quando as duas chegam ao mesmo tempo.
 *
 * São DOIS e-mails, não três:
 *   1. "Recebemos o seu pagamento"   → sempre;
 *   2. "Sua assinatura foi criada"   → quando tem assinatura (`subscription`
 *      e `combined`, pelo `notifySubscriptionCreated`);
 *      "Sua vaga foi liberada"       → quando é só taxa de adesão (`entrance`,
 *      pelo `notifyMemberJoined`).
 *
 * NUNCA derruba a confirmação: uma falha de SMTP fica no log e no
 * `email_logs`, mas o pagamento continua liberado.
 */
async function enviarEmailsDoCliente(
  supabaseAdmin: any,
  params: {
    user_id: string;
    group_id: string;
    amount: number;
    gateway_payment_id: string;
    payment_type: string;
  },
): Promise<void> {
  const ctx = {
    userId: params.user_id,
    groupId: params.group_id,
    amount: Number(params.amount) || 0,
    transactionId: params.gateway_payment_id,
    paymentType: params.payment_type,
  };

  try {
    const recebido = await notifyPaymentReceived(supabaseAdmin, ctx);
    console.log(
      `[confirm-payment] e-mail "recebemos seu pagamento": ${recebido.sent ? "enviado" : recebido.reason}`,
    );
  } catch (e: any) {
    console.error("[confirm-payment] falha no e-mail de pagamento recebido:", e);
  }

  // Na assinatura (pura ou combinada) o e-mail de "assinatura criada" já
  // cobre a entrada no grupo — mandar os dois seria spam.
  if (params.payment_type !== "subscription" && params.payment_type !== "combined") {
    try {
      const entrou = await notifyMemberJoined(supabaseAdmin, ctx);
      console.log(
        `[confirm-payment] e-mail "você entrou no grupo": ${entrou.sent ? "enviado" : entrou.reason}`,
      );
    } catch (e: any) {
      console.error("[confirm-payment] falha no e-mail de entrada no grupo:", e);
    }
  }
}

/**
 * Pagamento aprovado no gateway, mas a liberação no grupo FALHOU.
 *
 * Antes isso era silencioso: a tentativa ficava "aprovada" no painel, a
 * pessoa não entrava no grupo, não havia evento e não havia e-mail — o
 * admin só descobria quando a cliente reclamava. Agora o caso vira um evento
 * visível no painel + um aviso para o e-mail do admin.
 */
async function registrarLiberacaoFalhada(
  params: ConfirmParams,
  erro?: string,
): Promise<void> {
  const { group_id, user_id, amount, gateway_payment_id, payment_type, gateway } = params;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    const [{ data: usr }, { data: grp }] = await Promise.all([
      admin.from("users").select("name, email").eq("id", user_id).limit(1),
      admin.from("groups").select("name").eq("id", group_id).limit(1),
    ]);
    const userName = (usr || [])[0]?.name || "Usuário";
    const groupName = (grp || [])[0]?.name || group_id;

    await admin.from("platform_events").insert({
      event_type: "payment",
      title: "Pagamento aprovado sem liberação",
      message:
        `${userName} pagou R$ ${Number(amount || 0).toFixed(2)} no grupo "${groupName}" ` +
        `via ${gateway}, mas a liberação no grupo falhou: ${erro || "erro desconhecido"}. ` +
        `O valor foi cobrado — libere o acesso manualmente ou rode o job de reconciliação.`,
      metadata: JSON.stringify({
        user_id, group_id, amount, payment_type, gateway,
        transaction_id: gateway_payment_id,
        error: erro || null,
        needs_reconcile: true,
      }),
      created_by: user_id,
    });

    console.error(
      `[confirm-payment] LIBERAÇÃO FALHOU (${payment_type}) user=${user_id} group=${group_id} tx=${gateway_payment_id}: ${erro}`,
    );
  } catch (e: any) {
    console.error("[confirm-payment] falha ao registrar a liberação que falhou:", e);
  }
}

/**
 * Ponto de entrada único da confirmação de pagamento.
 *
 * Todo caminho (webhook do gateway, polling do navegador, confirmação manual
 * do admin e o job de reconciliação) passa por aqui — é o que garante que o
 * pagamento confirmado SEMPRE libere o grupo e SEMPRE mande e-mail.
 */
/**
 * A LIBERAÇÃO (acesso ao grupo) realmente aconteceu?
 *
 * O atalho de idempotência ("já pago, replay ignorado") só pode ser usado
 * quando a liberação está completa: assinatura ativa + vínculo no grupo. Se o
 * pagamento foi registrado mas a liberação ficou pela metade, a confirmação
 * PRECISA rodar de novo — senão o cliente pagou e nunca entrou, e nenhuma
 * nova tentativa conserta (todas caem no mesmo atalho).
 */
async function liberacaoConcluida(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  payment_type: string,
): Promise<boolean> {
  try {
    const { data: mem } = await supabaseAdmin
      .from("group_members")
      .select("status, payment_status")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (payment_type === "entrance") {
      return mem?.payment_status === "entrance_paid" || mem?.payment_status === "active";
    }

    const { data: sub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("status")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const assinaturaAtiva = sub?.status === "active";
    const vinculoLiberado =
      mem?.payment_status === "active" || mem?.payment_status === "entrance_paid";
    return assinaturaAtiva && !!vinculoLiberado;
  } catch (e) {
    console.error("[confirm-payment] erro ao verificar a liberacao:", e);
    // Na dúvida, refaz: a confirmação é idempotente.
    return false;
  }
}

/**
 * Registra a linha em `payments` sem duplicar.
 *
 * A mesma transação pode ser confirmada várias vezes (webhook + polling +
 * reconciliação + botão do admin). Sem esta checagem, cada confirmação
 * acrescentava uma linha nova no extrato do cliente.
 */
async function registrarPagamento(supabaseAdmin: any, dados: any): Promise<{ ok: boolean; inserted: boolean; error?: string }> {
  try {
    const { data: existente } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("transaction_code", dados.transaction_code)
      .eq("payment_type", dados.payment_type)
      .eq("status", dados.status)
      .limit(1);

    if (existente && existente.length > 0) {
      console.log(
        `[confirm-payment] pagamento ${dados.payment_type} ja registrado (${dados.transaction_code}) — nao duplicado`,
      );
      return { ok: true, inserted: false };
    }

    const { error } = await supabaseAdmin.from("payments").insert(dados);
    if (error) {
      console.error("[confirm-payment] erro ao registrar pagamento:", error.message);
      return { ok: false, inserted: false, error: error.message };
    }
    return { ok: true, inserted: true };
  } catch (e: any) {
    console.error("[confirm-payment] erro ao registrar pagamento:", e);
    return { ok: false, inserted: false, error: e?.message || String(e) };
  }
}

export async function confirmPayment(params: ConfirmParams) {
  const result = await confirmarPagamento(params);

  // Pagamento aprovado no gateway + confirmação que falhou = cliente pagou e
  // ficou fora do grupo. Precisa ficar visível.
  if (params.status === "approved" && !result?.success && !result?.already_confirmed) {
    await registrarLiberacaoFalhada(params, result?.error);
  }

  return result;
}

async function confirmarPagamento(params: ConfirmParams) {
  const { gateway, group_id, user_id, payment_type, amount, status, gateway_payment_id, payment_method, billing_cycle, custom_cycle_days, custom_cycle_months } = params;

  // Título do evento: a confirmação manual do admin fica marcada, para dar
  // pra distinguir na hora o que foi automático do que foi feito na mão.
  const tituloEvento = (base: string) =>
    params.forced ? "Pagamento confirmado (forçado)" : base;
  const marcaForcado = params.forced ? { forced: true } : {};

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

  // ---------------------------------------------------------------------
  // IDEMPOTENCIA (S13)
  // ---------------------------------------------------------------------
  // Esta funcao e chamada por TODOS os caminhos de confirmacao: webhook,
  // polling e confirmacao manual. Sem esta guarda, um reenvio de webhook
  // (o endpoint nao exige assinatura) criava uma nova linha em `payments` e
  // creditava a wallet do dono do grupo de novo — o `transaction_id` needed
  // para o replay era publico (payment_attempts.gateway_transaction_id).
  //
  // A guarda e por (transaction_code, payment_type) porque o pagamento
  // combinado gera DOIS pagamentos (entrance + subscription) com o mesmo
  // transaction_code.
  // ---------------------------------------------------------------------
  if (status === "approved" && gateway_payment_id) {
    const { data: alreadyPaid } = await supabaseAdmin
      .from("payments")
      .select("id, payment_type")
      .eq("transaction_code", gateway_payment_id)
      .eq("status", "paid")
      .limit(10);

    if (alreadyPaid && alreadyPaid.length > 0) {
      const alreadyTypes = alreadyPaid.map((p: any) => p.payment_type).join(",");
      // No fluxo combinado as duas partes (entrance + subscription) sao
      // confirmadas na mesma chamada: so considera resolvido quando todos os
      // tipos esperados ja estao pagos.
      const expectedTypes =
        payment_type === "combined" ? ["entrance", "subscription"] : [payment_type];
      const allPaid = expectedTypes.every((t) => alreadyTypes.includes(t));

      if (allPaid) {
        // ─────────────────────────────────────────────────────────────────────
        // "PAGO" não é a mesma coisa que "LIBERADO".
        //
        // A linha em `payments` pode existir sem que a liberação tenha
        // acontecido (a confirmação falhou no meio do caminho). Quando isso
        // acontecia, TODO replay era ignorado e o cliente ficava para sempre
        // com a assinatura "Pendente" mesmo com o pagamento aprovado — sem
        // nenhuma forma de se recuperar, porque o atalho "já pago" pulava a
        // liberação.
        //
        // Agora o atalho só vale quando a liberação CONCLUÍU de fato; caso
        // contrário a confirmação roda de novo (ela é idempotente).
        // ─────────────────────────────────────────────────────────────────────
        const liberado = await liberacaoConcluida(supabaseAdmin, group_id, user_id, payment_type);
        if (liberado) {
          console.log(
            `[confirm-payment] ${gateway} tx=${gateway_payment_id} ja confirmado (${alreadyTypes}) — replay ignorado`,
          );
          return { success: true, already_confirmed: true };
        }
        console.log(
          `[confirm-payment] ${gateway} tx=${gateway_payment_id} pagamento registrado mas liberacao incompleta — refazendo a liberacao`,
        );
      }
    }
  }

  if (status === "approved") {
    if (payment_type === "entrance") {
      // Mark entrance as paid — upsert to guarantee existence
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "entrance_paid",
          entrance_paid_at: new Date().toISOString(),
          entrance_payment_id: gateway_payment_id,
          subscription_deadline: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: "group_id, user_id" });

      // Record payment
      await registrarPagamento(supabaseAdmin, {
        user_id,
        amount,
        method: normalizePaymentMethod(payment_method),
        status: "paid",
        payment_type: "entrance",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
      });

      // Platform event: payment
      const { data: entranceGroup } = await supabaseAdmin
        .from("groups").select("name, owner_id").eq("id", group_id).maybeSingle();
      const { data: entranceUser } = await supabaseAdmin
        .from("users").select("name").eq("id", user_id).maybeSingle();
      await supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: tituloEvento("Pagamento de adesão"),
        message: `${entranceUser?.name || "Usuário"} pagou taxa de adesão de R$ ${amount.toFixed(2)} no grupo "${entranceGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway, payment_type: "entrance", gateway_payment_id, user_name: entranceUser?.name, group_name: entranceGroup?.name, ...marcaForcado }),
        created_by: user_id,
      });

      const recipients = [user_id, entranceGroup?.owner_id].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
      if (recipients.length > 0) {
        await dispatchNotification(supabaseAdmin, {
          title: "Pagamento aprovado",
          message: `${entranceUser?.name || "Usuário"} concluiu a taxa de adesão no grupo "${entranceGroup?.name || group_id}".`,
          event_type: "payment_approved",
          metadata: { user_id, group_id, gateway, payment_type: "entrance", gateway_payment_id },
          audience: { type: "users", user_ids: recipients },
          channels: ["in_app", "push"],
          url: `/dashboard/groups/${group_id}`,
        }).catch((e) => console.error("push notification error (entrance):", e));
      }

      // Credit wallet
      try {
        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("owner_id")
          .eq("id", group_id)
          .single();

        if (group?.owner_id) {
          // O repasse para a carteira do dono do grupo e feito pelo TRIGGER
          // trg_credit_wallet_on_payment, no banco, assim que a linha em
          // `payments` entra com status 'paid'. Creditar aqui duplicaria o
          // valor (o trigger ja creditou) - e ainda falhava quando o id do
          // gateway nao era UUID, engolindo o erro no catch.
          console.log("Repasse do grupo sera feito pelo trigger do banco:", group_id);
        }
      } catch (walletErr) {
        console.error("Wallet credit error (entrance):", walletErr);
      }

      // Registrar cupom após confirmação do pagamento PIX (entrance)
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "entrance");

      // E-mails do cliente: "recebemos o seu pagamento" + "sua vaga foi
      // liberada". Vêm DEPOIS de o vínculo estar gravado.
      await enviarEmailsDoCliente(supabaseAdmin, {
        user_id, group_id, amount, gateway_payment_id, payment_type: "entrance",
      });

      return { success: true, payment_type: "entrance" };

    } else if (payment_type === "combined") {
      // Combined: entrance + first subscription in one payment
      // Get group to split amounts
      const { data: group } = await supabaseAdmin
        .from("groups")
        .select("entrance_fee, price_per_slot, service_id, name, owner_id, billing_cycle")
        .eq("id", group_id)
        .single();

      const entranceAmount = group?.entrance_fee || 0;

      // ─────────────────────────────────────────────────────────────────────
      // SEPARANDO O QUE FOI PAGO (e o que vira recorrência)
      //
      // `amount` aqui é o TOTAL cobrado no gateway (adesão + mensalidade).
      // A parte da assinatura é o total menos a taxa de adesão — esse é o
      // valor que foi pago e o que vai na linha de `payments`.
      //
      // A RECORRÊNCIA usa o valor do CICLO (preço mensal x meses) e NUNCA a
      // taxa de adesão: foi o que fazia o grupo cobrar a taxa todo mês.
      // ─────────────────────────────────────────────────────────────────────
      const chargedTotal = Number(amount || 0);
      const paidSubscriptionPart = Math.max(0, chargedTotal - entranceAmount);

      // 1. Mark entrance as paid
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "entrance_paid",
          entrance_paid_at: new Date().toISOString(),
          entrance_payment_id: gateway_payment_id,
        }, { onConflict: "group_id, user_id" });

      // 2. Record entrance payment
      await registrarPagamento(supabaseAdmin, {
        user_id,
        amount: entranceAmount,
        method: normalizePaymentMethod(payment_method),
        status: "paid",
        payment_type: "entrance",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: "Taxa de adesão (parte do pagamento combinado)",
      });

      // 3. Create subscription with ONLY the cycle amount (not combined)
      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, amount, billing_cycle, custom_cycle_months, custom_cycle_days, payment_method, card_id")
        .eq("user_id", user_id).eq("group_id", group_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const cycle = billing_cycle || subInfo?.billing_cycle || group?.billing_cycle || "monthly";
      const days = custom_cycle_days || subInfo?.custom_cycle_days || null;
      const months = custom_cycle_months || subInfo?.custom_cycle_months || null;

      // Valor do ciclo: preço mensal x meses (o que a renovação vai cobrar).
      const cycleMonths = cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (months || 1) : 1;
      const cycleTotal = cycle === "days"
        ? Number(group?.price_per_slot || 0)
        : Number(group?.price_per_slot || 0) * cycleMonths;

      // O valor gravado é o que o create-payment já calculou (ciclo + cupom
      // recorrente). Sem linha prévia, cai no total do ciclo.
      const storedSubscriptionAmount = Number(subInfo?.amount || 0) > 0
        ? Number(subInfo.amount)
        : cycleTotal;

      let nextChargeAt: Date;
      // Grupo "Via Parceiro" (revenda Pulse Coding): o produto tem PRAZO, não
      // assinatura que renova sozinha. Sem este bloco, o job de cobrança
      // recorrente (que NÃO passa pelo confirmPayment) voltaria a cobrar o
      // cliente sem comprar nada na Pulse. Ver o mesmo bloco no ramo
      // `subscription` para a explicação completa.
      const viaParceiroCombinado = await resolverViaParceiro(supabaseAdmin, group_id);
      const viaParceiroAtivoCombinado =
        viaParceiroCombinado.viaParceiro &&
        !!viaParceiroCombinado.mapeamento &&
        viaParceiroCombinado.mapeamento.status === "ativo";

      if (viaParceiroAtivoCombinado) {
        nextChargeAt = new Date(instanteValidade(viaParceiroCombinado.durationDays));
      } else if (cycle === "days" && days) {
        nextChargeAt = new Date();
        nextChargeAt.setDate(nextChargeAt.getDate() + days);
      } else {
        const cycleMonths = cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (months || 1) : 1;
        nextChargeAt = new Date();
        nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
      }

      if (subInfo?.id) {
        await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: "active",
            gateway_status: "authorized",
            gateway_subscription_id: gateway_payment_id,
            next_charge_at: viaParceiroAtivoCombinado ? null : nextChargeAt.toISOString(),
            // Pagamento aprovado: vencimento do ciclo = data + ciclo (fonte da
            // verdade da regra de status; nao anda a cada retry).
            renewal_due_at: nextChargeAt.toISOString(),
            billing_status: "active",
            retry_count: 0,
            last_charge_at: new Date().toISOString(),
            payment_method: metodoPagamentoSeguro(payment_method, subInfo?.payment_method),
            billing_cycle: limitarTexto(cycle, 20),
            custom_cycle_days: days,
            custom_cycle_months: months,
            // IMPORTANTE: o valor do CICLO (nunca a taxa de adesão). É este
            // campo que a renovação cobra — a taxa é única.
            amount: storedSubscriptionAmount,
            expires_at: viaParceiroAtivoCombinado ? dataValidade(viaParceiroCombinado.durationDays) : undefined,
          })
          .eq("id", subInfo.id);
      } else {
        await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: group?.service_id,
          billing_cycle: limitarTexto(cycle, 20), amount: storedSubscriptionAmount, // IMPORTANTE: valor do ciclo, sem a taxa
          status: "active", gateway: gateway, gateway_subscription_id: gateway_payment_id,
          payment_method: metodoPagamentoSeguro(payment_method),
          next_charge_at: viaParceiroAtivoCombinado ? null : nextChargeAt.toISOString(),
          renewal_due_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          custom_cycle_days: days,
          custom_cycle_months: months,
          expires_at: viaParceiroAtivoCombinado ? dataValidade(viaParceiroCombinado.durationDays) : undefined,
        });
      }

      // 4. Update member to active
      //
      // `subscription_deadline` = até quando o acesso está PAGO. Sem isso o
      // vínculo não sabe o período válido e as regras de status (atrasada /
      // cancelada) não têm como ser calculadas por membro — foi o que deixou
      // gente com assinatura ativa aparecendo como "Cancelado" no grupo.
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
          subscription_deadline: nextChargeAt.toISOString(),
          left_at: null,
          updated_at: new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });

      // 5. Record subscription payment (with savings tracking)
      //
      // O valor aqui é a PARTE DA ASSINATURA do que foi pago (o total menos a
      // taxa de adesão) — é o valor que aparece na fatura do cliente.
      const savingsDataCombined = await getSavingsData(supabaseAdmin, group_id, gateway_payment_id, paidSubscriptionPart);
      await registrarPagamento(supabaseAdmin, {
        user_id,
        amount: paidSubscriptionPart,
        official_price: savingsDataCombined.official_price,
        paid_amount: savingsDataCombined.paid_amount,
        method: normalizePaymentMethod(payment_method),
        status: "paid",
        payment_type: "subscription",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: `1ª mensalidade (pagamento combinado com taxa de adesão)`,
      });

      // Registrar cupom após confirmação do pagamento COMBINADO.
      //
      // O cupom incide sobre a MENSALIDADE (é desconto de assinatura), então
      // o registro é do tipo "subscription" — igual ao ramo de assinatura
      // pura.
      //
      // Sem esta chamada o cupom NUNCA era registrado no fluxo combinado:
      // `coupon_uses` não recebia a linha, `coupons.used_count` não subia e
      // o prêmio de campanha (ex.: AVALIE5) não era liberado — mesmo com o
      // desconto visível no valor cobrado. `registerCouponUsagePIX` é
      // idempotente (procura uso anterior antes de inserir), então chamar
      // aqui é seguro mesmo se o polling e o webhook chegarem juntos.
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "subscription");

      // ── VIA PARCEIRO (Pulse Coding): compra na Pulse ────────────────────
      // Mesmo gancho do ramo `subscription`, aqui para o fluxo combinado
      // (adesão + 1ª mensalidade na mesma transação). O grupo "Via Parceiro"
      // nasce sem taxa de adesão, mas se um dia alguém incluir taxa num grupo
      // importado, o cliente ainda tem que receber o acesso.
      if (viaParceiroAtivoCombinado) {
        try {
          const { data: pagamentoCombinado } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("transaction_code", gateway_payment_id)
            .eq("payment_type", "subscription")
            .eq("status", "paid")
            .limit(1)
            .maybeSingle();

          const { data: compradorCombinado } = await supabaseAdmin
            .from("users")
            .select("name, email, phone")
            .eq("id", user_id)
            .maybeSingle();

          const resultadoCombinado = await processarCompraViaParceiro(supabaseAdmin, {
            transaction_code: gateway_payment_id,
            group_id,
            user_id,
            payment_id: pagamentoCombinado?.id ?? null,
            amount: Number(paidSubscriptionPart) || null,
            customer_name: compradorCombinado?.name ?? null,
            customer_whatsapp: compradorCombinado?.phone ?? null,
          });

          console.log(
            `[confirm-payment] via parceiro (combinado): pedido=${resultadoCombinado.externalId ?? "-"} ` +
            `status=${resultadoCombinado.status ?? "-"} entregas=${resultadoCombinado.entregaAplicada ?? 0}`,
          );
        } catch (pulseErrCombinado: any) {
          console.error("[confirm-payment] falha na compra Via Parceiro (combinado):", pulseErrCombinado?.message ?? pulseErrCombinado);
        }
      }

      // Platform events for combined
      const { data: combUser } = await supabaseAdmin.from("users").select("name").eq("id", user_id).maybeSingle();
      const { data: combGroup } = await supabaseAdmin.from("groups").select("name, owner_id").eq("id", group_id).maybeSingle();

      await supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: tituloEvento("Pagamento combinado (adesão + assinatura)"),
        message: `${combUser?.name || "Usuário"} pagou taxa de adesão (R$ ${entranceAmount.toFixed(2)}) + 1ª mensalidade (R$ ${paidSubscriptionPart.toFixed(2)}) no grupo "${combGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, total_amount: amount, entrance_amount: entranceAmount, subscription_amount: paidSubscriptionPart, cycle_amount: storedSubscriptionAmount, gateway, payment_type: "combined", gateway_payment_id, user_name: combUser?.name, group_name: combGroup?.name, ...marcaForcado }),
        created_by: user_id,
      });

      await supabaseAdmin.from("platform_events").insert({
        event_type: "member_joined",
        title: "Membro ingressou no grupo",
        message: `${combUser?.name || user_id} ingressou no grupo "${combGroup?.name || group_id}".`,
        metadata: JSON.stringify({ user_id, group_id, amount: paidSubscriptionPart, gateway }),
        created_by: user_id,
      });

      // Notifications
      const recipients = [user_id, combGroup?.owner_id].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
      if (recipients.length > 0) {
        await dispatchNotification(supabaseAdmin, {
          title: "Pagamento aprovado",
          message: `${combUser?.name || "Usuário"} concluiu a adesão + 1ª mensalidade no grupo "${combGroup?.name || group_id}".`,
          event_type: "payment_approved",
          metadata: { user_id, group_id, gateway, payment_type: "combined", gateway_payment_id },
          audience: { type: "users", user_ids: recipients },
          channels: ["in_app", "push"],
          url: `/dashboard/groups/${group_id}`,
        }).catch((e) => console.error("push notification error (combined):", e));
      }

      // Credit wallet for entrance portion
      try {
        if (group?.owner_id && !group?.is_official) {
          // Repasse feito pelo trigger do banco (ver nota no bloco de adesao).
          console.log("Repasse da taxa de adesao (combinado) sera feito pelo trigger do banco:", group_id);
        }
      } catch (walletErr) {
        console.error("Wallet credit error (combined entrance):", walletErr);
      }

      // Credit wallet for subscription portion
      try {
        if (group?.owner_id && !group?.is_official) {
          // Repasse feito pelo trigger do banco (ver nota no bloco de adesao).
          console.log("Repasse da 1a mensalidade (combinado) sera feito pelo trigger do banco:", group_id);
        }
      } catch (walletErr) {
        console.error("Wallet credit error (combined subscription):", walletErr);
      }

      // Process invoices and referrals
      try {
        const { data: invoice } = await supabaseAdmin
          .from("invoices")
          .select("id")
          .eq("user_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(1)
          .maybeSingle();

        if (invoice) {
          await supabaseAdmin
            .from("invoices")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("id", invoice.id);

          const nextDue = new Date();
          nextDue.setMonth(nextDue.getMonth() + (cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (months || 1) : 1));

          await supabaseAdmin.from("invoices").insert({
            user_id, group_id,
            amount: storedSubscriptionAmount,
            due_date: nextDue.toISOString().split("T")[0],
            status: "pending",
          });

          await supabaseAdmin
            .from("user_subscriptions")
            .update({ expires_at: nextDue.toISOString(), renewal_due_at: nextDue.toISOString() })
            .eq("user_id", user_id)
            .eq("group_id", group_id);
        }
      } catch (invoiceErr) {
        console.error("Invoice processing error (combined):", invoiceErr);
      }

      // Process referrals
      try {
        const { data: pendingReferral } = await supabaseAdmin
          .from("referrals")
          .select("id, referrer_id")
          .eq("invitee_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .maybeSingle();

        if (pendingReferral) {
          await supabaseAdmin
            .from("referrals")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", pendingReferral.id);

          await supabaseAdmin.rpc("add_referral_points", {
            p_user_id: pendingReferral.referrer_id,
            p_points: 10,
            p_type: 'subscription',
          });
        }
      } catch (refErr) {
        console.error("Referral processing error (combined):", refErr);
      }

      // E-mail de "assinatura confirmada" para o cliente. A trava de
      // duplicidade é o `dedup_key` (que carrega o `created_at` da
      // assinatura), então o poll do front e o webhook do gateway não
      // mandam dois e-mails — e a renovação do ciclo seguinte também não
      // (a chave é a mesma).
      // "Recebemos o seu pagamento" (vem antes).
      await enviarEmailsDoCliente(supabaseAdmin, {
        user_id, group_id, amount, gateway_payment_id, payment_type: "combined",
      });

      // "Sua assinatura foi criada" — com a taxa de adesão já paga.
      await notifySubscriptionCreated(supabaseAdmin, {
        userId: user_id,
        groupId: group_id,
        transactionId: gateway_payment_id,
      });

      return { success: true, payment_type: "combined" };

    } else if (payment_type === "subscription") {
      // Calcular next_charge_at baseado no ciclo.
      //
      // `.maybeSingle()` aqui abortava quando o usuario tinha MAIS de uma
      // assinatura no mesmo grupo (histórico de transferências): o PostgREST
      // devolvia erro, `data` ficava null e a assinatura NAO era atualizada —
      // o pagamento era confirmado "no papel" sem liberar credencial nenhuma.
      const { data: subInfoRows } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, billing_cycle, custom_cycle_months, custom_cycle_days, payment_method, card_id, card_last4, card_brand")
        .eq("user_id", user_id).eq("group_id", group_id)
        .order("created_at", { ascending: false })
        .limit(1);
      const subInfo = (subInfoRows && subInfoRows[0]) || null;

      const { data: grp } = await supabaseAdmin.from("groups").select("billing_cycle").eq("id", group_id).maybeSingle();
      const cycle = billing_cycle || subInfo?.billing_cycle || grp?.billing_cycle || "monthly";
      const days = custom_cycle_days || subInfo?.custom_cycle_days || null;
      const months = custom_cycle_months || subInfo?.custom_cycle_months || null;

      // ─────────────────────────────────────────────────────────────────────
      // GRUPO "VIA PARCEIRO" (Pulse Coding)
      // ─────────────────────────────────────────────────────────────────────
      // Um grupo importado da Pulse vende PRODUTO com prazo (1 mês, 3 meses,
      // 12 meses...), não uma vaga em conta compartilhada. Isso muda três
      // coisas em relação a um grupo normal:
      //
      //  1. A assinatura NÃO renova sozinha. `next_charge_at` fica NULL: o
      //     job de cobrança recorrente filtra por `next_charge_at <= agora`
      //     e o NULL é excluído pelo PostgREST. Sem isso, o cron cobrararia o
      //     cliente de novo sem comprar nada na Pulse — porque esse job NÃO
      //     passa pelo `confirmPayment`.
      //
      //  2. O acesso vale pelo período do pacote: renewal_due_at/expires_at
      //     viram a data de validade. Passada a data, a assinatura fica
      //     ATRASADA (7 dias de carência) e o cliente renova pelo fluxo
      //     normal — que dispara uma nova compra na Pulse.
      //
      //  3. A compra na Pulse acontece DEPOIS do pagamento, no fim da
      //     confirmação (ver `processarCompraViaParceiro`).
      // ─────────────────────────────────────────────────────────────────────
      const viaParceiro = await resolverViaParceiro(supabaseAdmin, group_id);
      const viaParceiroAtivo =
        viaParceiro.viaParceiro &&
        !!viaParceiro.mapeamento &&
        viaParceiro.mapeamento.status === "ativo";

      let nextChargeAt: Date;
      if (viaParceiroAtivo) {
        nextChargeAt = new Date(instanteValidade(viaParceiro.durationDays));
      } else if (cycle === "days" && days) {
        nextChargeAt = new Date();
        nextChargeAt.setDate(nextChargeAt.getDate() + days);
      } else {
        const cycleMonths = cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (months || 1) : 1;
        nextChargeAt = new Date();
        nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
      }

      if (subInfo?.id) {
        // Update existing subscription
        const { error: subErr } = await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: "active",
            gateway_status: "authorized",
            gateway_subscription_id: gateway_payment_id,
            // Via Parceiro: sem próxima cobrança automática (o produto tem
            // prazo, e a renovação é manual — ver o bloco acima).
            next_charge_at: viaParceiroAtivo ? null : nextChargeAt.toISOString(),
            // Pagamento aprovado: vencimento do ciclo = data + ciclo (fonte da
            // verdade da regra de status; nao anda a cada retry).
            renewal_due_at: nextChargeAt.toISOString(),
            billing_status: "active",
            retry_count: 0,
            last_charge_at: new Date().toISOString(),
            payment_method: metodoPagamentoSeguro(payment_method, subInfo?.payment_method),
            billing_cycle: limitarTexto(cycle, 20),
            custom_cycle_days: days,
            custom_cycle_months: months,
            // Grupo Via Parceiro: o acesso purchased vale até a data do pacote.
            expires_at: viaParceiroAtivo ? dataValidade(viaParceiro.durationDays) : undefined,
          })
          .eq("id", subInfo.id);

        if (subErr) {
          console.error("[confirm-payment] assinatura nao atualizada:", subErr.message);
          return { success: false, error: "user_subscriptions update failed: " + subErr.message };
        }
      } else {
        // Fallback: create subscription if missing (critical gap fix)
        const { data: grp } = await supabaseAdmin.from("groups").select("service_id, price_per_slot, billing_cycle").eq("id", group_id).maybeSingle();
        const { error: insErr } = await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: grp?.service_id,
          billing_cycle: limitarTexto(cycle, 20), amount: amount || grp?.price_per_slot || 0,
          status: "active", gateway: gateway, gateway_subscription_id: gateway_payment_id,
          payment_method: metodoPagamentoSeguro(payment_method),
          next_charge_at: viaParceiroAtivo ? null : nextChargeAt.toISOString(),
          renewal_due_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          custom_cycle_days: days,
          custom_cycle_months: months,
          expires_at: viaParceiroAtivo ? dataValidade(viaParceiro.durationDays) : undefined,
        });

        if (insErr) {
          // `service_id` e NOT NULL: se o grupo nao tiver service_id, o insert
          // reprova e a assinatura nunca nasce.
          console.error("[confirm-payment] assinatura nao criada:", insErr.message);
          return { success: false, error: "user_subscriptions insert failed: " + insErr.message };
        }
      }

      // Fatura vencida do ciclo que está sendo pago: precisa ser quitada, senão
      // continua aparecendo como pendente no painel de cobrança mesmo depois do
      // pagamento (era uma das fontes do "46 Faturas vencidas" no admin).
      // A fatura do próximo ciclo (vencimento futuro) fica pendente de propósito.
      try {
        const today = new Date().toISOString().split("T")[0];
        const { data: dueInvoices } = await supabaseAdmin
          .from("invoices")
          .select("id, amount")
          .eq("group_id", group_id)
          .eq("user_id", user_id)
          .eq("status", "pending")
          .lte("due_date", today);

        const due = dueInvoices || [];
        if (due.length > 0) {
          const paidAmount = Number(amount);
          const dueTotal = due.reduce((sum, i) => sum + Number(i.amount || 0), 0);
          const toSettle = Math.abs(dueTotal - paidAmount) < 0.01
            ? due
            : due.filter((i) => Math.abs(Number(i.amount) - paidAmount) < 0.01);

          for (const inv of toSettle) {
            const { error: invErr } = await supabaseAdmin
              .from("invoices")
              .update({ status: "paid", paid_at: new Date().toISOString() })
              .eq("id", inv.id);
            if (invErr) console.error("[confirm-payment] fatura vencida nao quitada:", invErr.message);
            else console.log(`[confirm-payment] fatura vencida quitada: ${inv.id} (${inv.amount})`);
          }
        }
      } catch (invException: any) {
        console.error("[confirm-payment] falha ao quitar faturas vencidas:", invException);
      }

      // Update member — update se já existe, upsert se não (o upsert sozinho
      // deixava de fora linhas antigas sem a constraint de conflito).
      const { data: existingMember, error: memberSelErr } = await supabaseAdmin
        .from("group_members")
        .select("id")
        .eq("group_id", group_id)
        .eq("user_id", user_id)
        .limit(1);

      if (memberSelErr) {
        console.error("[confirm-payment] group_members select error:", memberSelErr.message);
      }

      const memberPayload = {
        group_id, user_id,
        status: "active",
        payment_status: "active",
        joined_at: new Date().toISOString(),
        // O cancelamento por carência grava `left_at` no vínculo. Ao pagar de
        // novo o vínculo é refeito — sem zerar, o membro ficaria com status
        // "ativo" e data de saída preenchida ao mesmo tempo.
        left_at: null,
        // Até quando o acesso está PAGO. Sem esta data o vínculo não sabe o
        // período válido e as regras de status (atrasada/cancelada) não têm
        // como ser calculadas por membro — foi o que deixou gente com
        // assinatura ativa aparecendo como "Cancelado" na lista do grupo.
        subscription_deadline: nextChargeAt.toISOString(),
        updated_at: new Date().toISOString(),
      };

      let memberError = null;
      if (existingMember && existingMember.length > 0) {
        const { error } = await supabaseAdmin
          .from("group_members")
          .update(memberPayload)
          .eq("group_id", group_id)
          .eq("user_id", user_id);
        memberError = error;
      } else {
        const { error } = await supabaseAdmin
          .from("group_members")
          .upsert(memberPayload, { onConflict: "group_id, user_id" });
        memberError = error;
      }

      if (memberError) {
        // Sem group_members ativo o trigger do banco NAO libera a credencial.
        console.error("[confirm-payment] grupo nao liberado:", memberError.message);
        return { success: false, error: "group_members write failed: " + memberError.message };
      }

      // Record payment (with savings tracking)
      const savingsDataSub = await getSavingsData(supabaseAdmin, group_id, gateway_payment_id, amount);
      const regPagamento = await registrarPagamento(supabaseAdmin, {
        user_id,
        amount,
        official_price: savingsDataSub.official_price,
        paid_amount: savingsDataSub.paid_amount,
        method: normalizePaymentMethod(payment_method),
        status: "paid",
        payment_type: "subscription",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: "Assinatura recorrente paga",
      });

      if (!regPagamento.ok) {
        // Sem a linha em `payments` o pagamento nao aparece no billing E a
        // trava de idempotencia nunca dispara (ela le `payments`).
        console.error("[confirm-payment] pagamento nao registrado:", regPagamento.error);
        return { success: false, error: "payments insert failed: " + regPagamento.error };
      }

      // ─────────────────────────────────────────────────────────────────────
      // VIA PARCEIRO (Pulse Coding): compra na Pulse AGORA que o pagamento
      // está confirmado e registrado.
      //
      // A regra que vale aqui: o pedido real na Pulse só existe DEPOIS do
      // pagamento do meu cliente — nunca antes. E, se a Pulse falhar, a
      // confirmação do pagamento NÃO pode falhar junto: o cliente pagou e
      // tem que entrar no grupo de qualquer jeito. A compra fica pendente e
      // o webhook/polling tenta de novo.
      // ─────────────────────────────────────────────────────────────────────
      if (viaParceiroAtivo) {
        try {
          const { data: pagamentoRow } = await supabaseAdmin
            .from("payments")
            .select("id")
            .eq("transaction_code", gateway_payment_id)
            .eq("payment_type", "subscription")
            .eq("status", "paid")
            .limit(1)
            .maybeSingle();

          const { data: comprador } = await supabaseAdmin
            .from("users")
            .select("name, email, phone")
            .eq("id", user_id)
            .maybeSingle();

          const resultado = await processarCompraViaParceiro(supabaseAdmin, {
            transaction_code: gateway_payment_id,
            group_id,
            user_id,
            payment_id: pagamentoRow?.id ?? null,
            amount: Number(amount) || null,
            customer_name: comprador?.name ?? null,
            customer_whatsapp: comprador?.phone ?? null,
          });

          console.log(
            `[confirm-payment] via parceiro: pedido=${resultado.externalId ?? "-"} status=${resultado.status ?? "-"} ` +
            `entregas=${resultado.entregaAplicada ?? 0}${resultado.motivo ? ` (${resultado.motivo})` : ""}`,
          );
        } catch (pulseErr: any) {
          // NUNCA derruba a confirmação por causa da Pulse.
          console.error("[confirm-payment] falha na compra Via Parceiro:", pulseErr?.message ?? pulseErr);
        }
      }

      // billing_cycles: a fila de cobrança do PRÓXIMO ciclo.
      //
      // Sem esta linha o job de cobrança recorrente não acha o ciclo para
      // cobrar e a assinatura "renova" só no papel. O polling do navegador
      // criava essa linha (na sua cópia da confirmação) e o webhook não — o
      // mesmo pagamento dava um resultado diferente dependendo de por onde
      // foi confirmado.
      //
      // Grupo "Via Pareiro" NÃO entra aqui: o produto tem prazo e a
      // renovação é manual. Um ciclo pendente faria o job de recorrência
      // cobrar o cliente de novo sem comprar nada na Pulse.
      if (!viaParceiroAtivo) {
      try {
        const { data: cycleSubRows } = await supabaseAdmin
          .from("user_subscriptions")
          .select("id")
          .eq("group_id", group_id)
          .eq("user_id", user_id)
          .order("created_at", { ascending: false })
          .limit(1);
        const cycleSub = (cycleSubRows && cycleSubRows[0]) || null;

        if (cycleSub?.id) {
          const { data: existingCycles } = await supabaseAdmin
            .from("billing_cycles")
            .select("id")
            .eq("subscription_id", cycleSub.id)
            .eq("status", "pending")
            .order("created_at", { ascending: false })
            .limit(1);

          if (!existingCycles || existingCycles.length === 0) {
            const { error: bcErr } = await supabaseAdmin.from("billing_cycles").insert({
              subscription_id: cycleSub.id,
              user_id,
              group_id,
              amount,
              charge_date: nextChargeAt.toISOString().split("T")[0],
              status: "pending",
              attempt_number: 0,
            });
            if (bcErr) {
              console.error("[confirm-payment] billing_cycles error:", bcErr.message);
            }
          }
        }
      } catch (bcException: any) {
        console.error("[confirm-payment] billing_cycles exception:", bcException);
      }
      }

      // Platform event: payment + member_joined
      const { data: subGroup } = await supabaseAdmin
        .from("groups").select("name, owner_id").eq("id", group_id).maybeSingle();
      const { data: subUser } = await supabaseAdmin
        .from("users").select("name").eq("id", user_id).maybeSingle();

      await supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: tituloEvento("Pagamento de assinatura"),
        message: `${subUser?.name || "Usuário"} confirmou assinatura de R$ ${amount.toFixed(2)} no grupo "${subGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway, payment_type: "subscription", gateway_payment_id, user_name: subUser?.name, group_name: subGroup?.name, ...marcaForcado }),
        created_by: user_id,
      });

      await supabaseAdmin.from("platform_events").insert({
        event_type: "member_joined",
        title: "Membro ingressou no grupo",
        message: `${subUser?.name || user_id} ingressou no grupo "${subGroup?.name || group_id}".`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway }),
        created_by: user_id,
      });

      const subscriptionRecipients = [user_id, subGroup?.owner_id].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
      if (subscriptionRecipients.length > 0) {
        await dispatchNotification(supabaseAdmin, {
          title: "Assinatura aprovada",
          message: `${subUser?.name || "Usuário"} renovou a assinatura do grupo "${subGroup?.name || group_id}".`,
          event_type: "subscription_approved",
          metadata: { user_id, group_id, gateway, payment_type: "subscription", gateway_payment_id },
          audience: { type: "users", user_ids: subscriptionRecipients },
          channels: ["in_app", "push"],
          url: `/dashboard/groups/${group_id}`,
        }).catch((e) => console.error("push notification error (subscription):", e));
      }

      // Credit wallet
      try {
        const { data: group } = await supabaseAdmin
          .from("groups")
          .select("owner_id")
          .eq("id", group_id)
          .single();

        if (group?.owner_id) {
          // Repasse feito pelo trigger do banco (ver nota no bloco de adesao).
          console.log("Repasse da assinatura sera feito pelo trigger do banco:", group_id);
        }
      } catch (walletErr) {
        console.error("Wallet credit error (subscription):", walletErr);
      }

      // Registrar cupom após confirmação do pagamento PIX (subscription)
      // registerCouponUsagePIX já atualiza coupon_uses, used_count e campaign_rewards
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "subscription");

      // Mark oldest pending invoice as paid
      try {
        const { data: invoiceRows } = await supabaseAdmin
          .from("invoices")
          .select("id")
          .eq("user_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .order("due_date", { ascending: true })
          .limit(1);
        const invoice = (invoiceRows && invoiceRows[0]) || null;

        if (invoice) {
          await supabaseAdmin
            .from("invoices")
            .update({ status: "paid", paid_at: new Date().toISOString() })
            .eq("id", invoice.id);

          // Create next invoice
          const { data: subRows } = await supabaseAdmin
            .from("user_subscriptions")
            .select("id, billing_cycle, custom_cycle_days, custom_cycle_months, amount, expires_at")
            .eq("user_id", user_id)
            .eq("group_id", group_id)
            .order("created_at", { ascending: false })
            .limit(1);
          const sub = (subRows && subRows[0]) || null;

          if (sub) {
            const nextDue = new Date();
            if (sub.billing_cycle === "days" && sub.custom_cycle_days) {
              nextDue.setDate(nextDue.getDate() + sub.custom_cycle_days);
            } else {
              const cycleMonths = sub.billing_cycle === "quarterly" ? 3
                : sub.billing_cycle === "semiannual" ? 6
                : sub.billing_cycle === "annual" ? 12
                : sub.billing_cycle === "custom" ? (sub.custom_cycle_months || 1)
                : 1;
              nextDue.setMonth(nextDue.getMonth() + cycleMonths);
            }

            await supabaseAdmin.from("invoices").insert({
              user_id,
              group_id,
              amount: sub.amount,
              due_date: nextDue.toISOString().split("T")[0],
              status: "pending",
            });

            await supabaseAdmin
              .from("user_subscriptions")
              .update({ expires_at: nextDue.toISOString(), renewal_due_at: nextDue.toISOString() })
              .eq("id", sub.id);
          }
        }
      } catch (invoiceErr) {
        console.error("Invoice processing error:", invoiceErr);
      }

      // Process referrals
      try {
        const { data: pendingReferral } = await supabaseAdmin
          .from("referrals")
          .select("id, referrer_id")
          .eq("invitee_id", user_id)
          .eq("group_id", group_id)
          .eq("status", "pending")
          .maybeSingle();

        if (pendingReferral) {
          await supabaseAdmin
            .from("referrals")
            .update({ status: "completed", completed_at: new Date().toISOString() })
            .eq("id", pendingReferral.id);

          // Credit referrer points
          await supabaseAdmin.rpc("add_referral_points", {
            p_user_id: pendingReferral.referrer_id,
            p_points: 10,
            p_type: 'subscription',
          });
        }
      } catch (refErr) {
        console.error("Referral processing error:", refErr);
      }

      // O cupom desta assinatura ja foi registrado acima (com o tipo
      // "subscription"). Registrar de novo aqui, com o tipo "combined",
      // duplicava o uso do cupom na confirmacao de assinatura.
      //
      // E-mail de "assinatura confirmada" para o cliente (ver nota no
      // branch "combined"). A chave de dedup carrega o `created_at` da
      // assinatura: assinatura nova manda o e-mail, renovação do mesmo
      // ciclo não manda de novo.
      // "Recebemos o seu pagamento" (vem antes: o cliente primeiro precisa
      // saber que o dinheiro entrou).
      await enviarEmailsDoCliente(supabaseAdmin, {
        user_id, group_id, amount, gateway_payment_id, payment_type: "subscription",
      });

      // "Sua assinatura foi criada" — o e-mail que fecha o ciclo e diz que ela
      // já entrou no grupo.
      await notifySubscriptionCreated(supabaseAdmin, {
        userId: user_id,
        groupId: group_id,
        transactionId: gateway_payment_id,
      });

      return { success: true, payment_type: "subscription" };
    }

    // Aviso por e-mail para o administrador: grupo, pessoa, valor, tipo e
    // data/hora. A deduplicação é pela transação (email_logs), então o poll e
    // o webhook não geram dois avisos do mesmo pagamento.
    await notifyAdminPayment(supabaseAdmin, {
      groupId: group_id,
      userId: user_id,
      amount,
      paymentType: payment_type,
      gateway,
      transactionId: gateway_payment_id,
      paymentMethod: payment_method || null,
    });

  } else if (status === "rejected") {
    // Payment failed
    await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "expired", status: "cancelled" })
      .eq("group_id", group_id)
      .eq("user_id", user_id);

    await registrarPagamento(supabaseAdmin, {
      user_id,
      amount,
      method: normalizePaymentMethod(payment_method),
      status: "failed",
      payment_type,
      group_id,
      transaction_code: gateway_payment_id,
      gateway,
      notes: "Pagamento rejeitado",
    });

    return { success: false, payment_type, error: "payment rejected by gateway" };
  }

  // Pagamento ainda pendente no gateway: nada a confirmar, mas o chamador
  // precisa saber que a transacao foi vista.
  return { success: false, payment_type, error: "payment still pending" };
}

// ── Helper: registrar uso de cupom após confirmação PIX (webhook) ───────────────
async function registerCouponUsagePIX(
  supabaseAdmin: any,
  gateway_payment_id: string,
  user_id: string,
  payment_type: string,
): Promise<void> {
  try {
    // `final_amount` NAO existe em `payment_attempts` — o select falhava e o
    // cupom NUNCA era registrado (o `if (!attempt?.coupon_id) return` cortava
    // tudo). E `.maybeSingle()` abortava com as linhas duplicadas do polling.
    const { data: attemptRows } = await supabaseAdmin
      .from("payment_attempts")
      .select("coupon_id, discount_amount, original_amount")
      .eq("gateway_transaction_id", gateway_payment_id)
      .order("created_at", { ascending: true })
      .limit(1);

    const attempt = (attemptRows && attemptRows[0]) || null;

    if (!attempt?.coupon_id) return;

    const originalAmount = Number(attempt.original_amount || 0);
    const discountAmount = Number(attempt.discount_amount || 0);
    const finalAmount = Math.max(0, originalAmount - discountAmount);

    const { data: existingUse } = await supabaseAdmin
      .from("coupon_uses")
      .select("id")
      .eq("coupon_id", attempt.coupon_id)
      .eq("user_id", user_id)
      .limit(1);

    if (existingUse && existingUse.length > 0) {
      console.log(`[registerCouponUsagePIX] coupon=${attempt.coupon_id} já usado por user=${user_id}`);
      return;
    }

    await supabaseAdmin.from("coupon_uses").insert({
      coupon_id: attempt.coupon_id,
      user_id,
      payment_type,
      original_amount: originalAmount,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      group_id: null,
    });

    const { data: current } = await supabaseAdmin
      .from("coupons")
      .select("used_count")
      .eq("id", attempt.coupon_id)
      .single();

    if (current != null) {
      await supabaseAdmin
        .from("coupons")
        .update({ used_count: (current.used_count || 0) + 1 })
        .eq("id", attempt.coupon_id);
    }

    // Atualizar campaign_rewards se cupom for de campanha
    const { data: coupon } = await supabaseAdmin
      .from("coupons")
      .select("description")
      .eq("id", attempt.coupon_id)
      .maybeSingle();

    if (coupon?.description?.startsWith("campaign:")) {
      const campaignCode = coupon.description.replace("campaign:", "").trim();
      await supabaseAdmin
        .from("campaign_rewards")
        .update({ status: "used" })
        .eq("campaign", campaignCode)
        .eq("user_id", user_id)
        .eq("status", "available");
    }

    console.log(`[registerCouponUsagePIX] cupom=${attempt.coupon_id} consumido em ${payment_type} por user=${user_id}`);
  } catch (e) {
    console.error("[registerCouponUsagePIX] erro:", e);
  }
}
