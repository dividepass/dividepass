// ============================================================================
// Handler da Woovi para `create-payment`.
//
// POR QUE A WOOVI EXISTE AQUI
// ---------------------------
// A IoPay não faz Pix Automático: no IoPay, quem paga por Pix precisa pagar de
// novo a cada ciclo (o cron até tenta, mas só funciona com cartão salvo).
// A Woovi tem Pix Automático nativo (`POST /api/v1/subscriptions` com
// `type: PIX_RECURRING`): o pagador autoriza um MANDATO uma vez e a Woovi
// cobra sozinha, nos ciclos seguintes.
//
// ESTE HANDLER ESTÁ EM STANDBY
// ---------------------------
// Ele só roda se o `gateway` enviado no body for "woovi" (ou se o admin
// colocar "woovi" em `app_settings.active_gateway`). Nada aqui troca o
// gateway ativo por conta própria.
//
// FLUXOS (payment_type)
// ----------------------
//   entrance     → 1 charge Pix (taxa de adesão avulsa)
//   invoice      → 1 charge Pix (fatura avulsa)
//   subscription → 1 Pix Automático na JORNADA 3 (PAYMENT_ON_APPROVAL):
//                  UM QR só, que ao ser aprovado paga o 1º ciclo E registra o
//                  mandato para as renovações seguintes.
//   combined     → 1 charge Pix (adesão + 1º ciclo) + 1 Pix Automático na
//                  JORNADA 2 (ONLY_RECURRENCY): o primeiro QR cobra agora, o
//                  segundo apenas AUTORIZA a cobrança automática do próximo
//                  ciclo (sem cobrar nada no ato).
//
// POR QUE O "combined" TEM DOIS ARTEFATOS
// ----------------------------------------
// A taxa de adesão é ÚNICA e a mensalidade é RECORRENTE. Se o mandate do Pix
// Automático valesse (adesão + mensalidade), a Woovi voltaria a cobrar a taxa
// todo mês. Se valesse só a mensalidade, o primeiro QR da Jornada 3 pagaria
// só a mensalidade e a taxa ficaria de fora. Separando os dois artefatos, cada
// um cobra exatamente o que deve.
//
// JORNADA 2 x JORNADA 3
// ---------------------
//   JORNADA 3 (PAYMENT_ON_APPROVAL): aprova o mandate E cobra na hora.
//     → usada no fluxo `subscription`, em que a única cobrança é a mensalidade.
//   JORNADA 2 (ONLY_RECURRENCY): registra o mandate SEM cobrar; a primeira
//     cobrança só sai na data de início (que precisa ser >= 3 dias no futuro).
//     → usada no fluxo `combined`, em que a cobrança JÁ aconteceu no charge.
//
// VALORES
// -------
// A API da Woovi trabalha em CENTAVOS. O DividePass trabalha em REAIS.
// Conversão em `toCents()` / `fromCents()`.
// ============================================================================

import { getGatewaySettings } from "./settings.ts";
import type { WooviCharge, WooviMandate, WooviCustomer } from "../../_shared/woovi-api.ts";
import { resolveCoupon } from "./coupon.ts";
import {
  createCharge as apiCreateCharge,
  createCustomer as apiCreateCustomer,
  getCustomer as apiGetCustomer,
  findCustomerByTaxID as apiFindCustomerByTaxID,
  createPixAutomatic as apiCreatePixAutomatic,
} from "../../_shared/woovi-api.ts";
import {
  getWooviConfig,
  toCents,
  fromCents,
  wooviFrequencyForCycle,
  wooviCycleMonths,
  nextChargeDate,
  chargeDayOfMonth,
  buildCorrelationId,
  WooviApiError,
  type WooviConfig,
  type WooviFrequency,
} from "../../_shared/woovi.ts";

interface HandlerContext {
  supabaseAdmin: any;
  supabaseUrl: string;
  group_id: string;
  user_id: string;
  billing_cycle: string;
  months: number;
  reason: string;
  referral_code: string | null;
  payment_type: string;
  corsHeaders: Record<string, string>;
  body: any;
  /**
   * Cupom escolhido no checkout. NÃO é confiável: o desconto é sempre
   * recalculado aqui a partir da tabela `coupons` (ver `handlers/coupon.ts`).
   */
  coupon_id: string | null;
}

const json = (data: any, corsHeaders: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Normaliza telefone BR para o formato que a Woovi espera: "5511999999999". */
function normalizePhone(raw: string | null | undefined): string {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) return "";
  // 10 dígitos = fixo; 11 = celular. Sem o código do país, adiciona o 55.
  if (digits.length === 10 || digits.length === 11) digits = "55" + digits;
  return digits;
}

/** Normaliza CPF: só dígitos. */
function normalizeCpf(raw: string | null | undefined): string {
  return String(raw || "").replace(/\D/g, "");
}

/**
 * Extrai o identificador do cliente da Woovi.
 *
 * ATENÇÃO: o objeto `customer` da Woovi **não tem id**. Ele tem `name`,
 * `email`, `phone`, `taxID` e `correlationID` — e é o `correlationID` que
 * identifica o cliente: `GET /api/v1/customer/{correlationID}` devolve o
 * cliente. (Verificado na API de sandbox.)
 *
 * Por isso o nosso `correlationID` é `dp-user-<user_id>`: é ele que permite
 * reencontrar o cliente em qualquer chamada futura.
 */
function extractCustomerId(customer: any): string | null {
  if (!customer || typeof customer !== "object") return null;
  return (
    customer.id ||
    customer._id ||
    customer.globalID ||
    customer.customerId ||
    customer.correlationID ||
    null
  );
}

export default async function handleWoovi(req: Request, ctx: HandlerContext) {
  const {
    supabaseAdmin,
    supabaseUrl,
    group_id,
    user_id,
    billing_cycle,
    months,
    reason,
    referral_code,
    payment_type,
    corsHeaders,
    body: reqBody,
    coupon_id,
  } = ctx;

  const settings = await getGatewaySettings();
  const cfg = getWooviConfig(settings);

  if (!cfg.appId) {
    return json(
      { error: "Credenciais WOOVI não configuradas. Configure no Admin → Configurações." },
      corsHeaders,
      400,
    );
  }

  const { data: group, error: groupError } = await supabaseAdmin
    .from("groups")
    .select("*, service:service_id(*)")
    .eq("id", group_id)
    .single();

  if (groupError || !group) {
    return json({ error: "Grupo não encontrado" }, corsHeaders, 404);
  }

  const body = reqBody || {};
  const type = payment_type || "subscription";
  const cycle = billing_cycle || group.billing_cycle || "monthly";

  // A Woovi entra só para PIX por enquanto. Cartão na Woovi é outro fluxo
  // (smartform) e não faz sentido ativar junto com o Pix Automático.
  if (body.payment_method && body.payment_method !== "pix") {
    return json(
      { error: "A integração Woovi está disponível apenas para PIX por enquanto." },
      corsHeaders,
      400,
    );
  }

  // ── Renovação ────────────────────────────────────────────────────────────
  // Com Pix Automático a renovação NÃO passa por aqui: a Woovi cobra sozinha
  // no dia do vencimento e avisa via webhook. Se o usuário continuou no fluxo
  // antigo de "renovar agora", dizemos isso em vez de criar uma segunda
  // cobrança.
  const isRenewal = body.renewal === true;
  if (isRenewal) {
    const { data: existingSub } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id, status, gateway, woovi_subscription_id, next_charge_at")
      .eq("group_id", group_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (existingSub?.gateway === "woovi" && existingSub.woovi_subscription_id) {
      return json(
        {
          error:
            "Esta assinatura usa Pix Automático: a renovação é cobrada automaticamente na data de vencimento.",
          code: "recurrence_is_automatic",
          next_charge_at: existingSub.next_charge_at,
        },
        corsHeaders,
        409,
      );
    }
  }

  // ── Valores ──────────────────────────────────────────────────────────────
  const entranceAmount = Number(group.entrance_fee || 0);
  const subscriptionAmountBase = Number(group.price_per_slot || 0);
  const subDays = cycle === "days" ? Number(body.custom_cycle_days) || 1 : 0;
  const subMonths = wooviCycleMonths(cycle, body.custom_cycle_months);
  const subscriptionAmount = subDays > 0 ? subscriptionAmountBase : subscriptionAmountBase * subMonths;

  const externalReference = `${group_id}:${user_id}:${type}`;

  // ── Cupom (recalculado no servidor — nunca confia no body) ───────────────
  const authoritativeCoupon = new Map<string, { amount: number; discount: number; recurring: boolean }>();

  const resolveCouponFor = async (base: number, couponType: "entrance" | "subscription") => {
    if (!coupon_id) {
      return { ok: true as const, amount: base, discount: 0, recurring: false };
    }
    const cached = authoritativeCoupon.get(couponType);
    if (cached) return { ok: true as const, ...cached };

    const res = await resolveCoupon({
      supabaseAdmin,
      couponId: coupon_id,
      userId: user_id,
      paymentType: couponType,
      groupId: group_id,
      baseAmount: base,
    });
    if (!res.ok) return res;

    const value = {
      amount: res.coupon.finalAmount,
      discount: res.coupon.discount,
      recurring: res.coupon.recurring,
    };
    authoritativeCoupon.set(couponType, value);
    return { ok: true as const, ...value };
  };

  // ── Cliente na Woovi ─────────────────────────────────────────────────────
  let customer: WooviCustomer;
  let customerId: string | null = null;
  try {
    customer = await getOrCreateCustomer(cfg, supabaseAdmin, user_id, settings);
    customerId = extractCustomerId(customer);
  } catch (e: any) {
    console.error("[woovi] customer error:", e?.message || e);
    return json({ error: "Erro ao criar cliente na Woovi: " + (e?.message || e) }, corsHeaders, 500);
  }

  const customerPayload: Record<string, any> = {
    name: customer.name,
    correlationID: customer.correlationID,
  };
  if (customer.email) customerPayload.email = customer.email;
  if (customer.phone) customerPayload.phone = customer.phone;
  if (customer.taxID) customerPayload.taxID = customer.taxID;
  if (customer.address) customerPayload.address = customer.address;

  // ── Log de tentativa ─────────────────────────────────────────────────────
  const logAttempt = async (
    status: string,
    txId: string | null,
    response: any,
    errorMsg?: string,
    amountOverride?: number,
  ) => {
    try {
      const baseAmt: number =
        type === "entrance" ? entranceAmount
        : type === "combined" ? entranceAmount + subscriptionAmount
        : subscriptionAmount;

      let finalAmt = baseAmt;
      let discountAmt = 0;
      if (type === "combined") {
        const sub = authoritativeCoupon.get("subscription");
        if (sub) {
          finalAmt = entranceAmount + sub.amount;
          discountAmt = sub.discount;
        }
      } else {
        const authoritative = authoritativeCoupon.get(
          type === "entrance" ? "entrance" : "subscription",
        );
        if (authoritative) {
          finalAmt = authoritative.amount;
          discountAmt = authoritative.discount;
        }
      }
      if (typeof amountOverride === "number") finalAmt = amountOverride;

      await supabaseAdmin.from("payment_attempts").insert({
        user_id,
        group_id,
        gateway: "woovi",
        payment_method: "pix",
        payment_type: type,
        amount: finalAmt,
        original_amount: baseAmt,
        discount_amount: discountAmt,
        coupon_id: coupon_id || null,
        status,
        gateway_transaction_id: txId,
        external_reference: externalReference,
        gateway_response: response || {},
        error_message: errorMsg || null,
        pix_copy_paste: response?.pix_copy_paste || null,
        pix_qrcode_url: response?.pix_qrcode_url || null,
      });
    } catch (e) {
      console.error("[woovi] payment_attempts insert error:", e);
    }
  };

  // ════════════════════════════════════════════════════════════════════════
  // FATURA — cobrança avulsa, sem assinatura
  // ════════════════════════════════════════════════════════════════════════
  if (type === "invoice") {
    const invoiceId = body.invoice_id;
    if (!invoiceId) {
      return json({ error: "invoice_id é obrigatório" }, corsHeaders, 400);
    }

    const { data: invoice } = await supabaseAdmin
      .from("invoices")
      .select("id, amount, status, user_id")
      .eq("id", invoiceId)
      .eq("user_id", user_id)
      .maybeSingle();

    if (!invoice) {
      return json({ error: "Fatura não encontrada" }, corsHeaders, 404);
    }
    if (invoice.status === "paid") {
      return json({ error: "Fatura já foi paga" }, corsHeaders, 400);
    }

    const amount = Number(invoice.amount || 0);
    const correlationId = buildCorrelationId(group_id, user_id, "invoice", "charge");

    try {
      const charge = await apiCreateCharge(cfg, {
        valueCents: toCents(amount),
        correlationId,
        comment: `Fatura #${invoiceId.slice(0, 8).toUpperCase()}`.substring(0, 40),
        customer: customerPayload,
      });

      await supabaseAdmin
        .from("invoices")
        .update({ gateway_transaction_id: charge.identifier, payment_method: "pix" })
        .eq("id", invoiceId);

      await logAttempt("created", charge.identifier, {
        pix_copy_paste: charge.brCode,
        pix_qrcode_url: charge.qrCodeImage,
        charge,
      }, undefined, amount);

      return json({
        success: true,
        gateway: "woovi",
        transaction_id: charge.identifier,
        status: charge.status || "pending",
        payment_method: "pix",
        pix_copy_paste: charge.brCode,
        pix_qrcode_url: charge.qrCodeImage,
        amount,
        needs_polling: true,
        recurrence: { enabled: false },
      }, corsHeaders);
    } catch (e: any) {
      console.error("[woovi] invoice charge error:", e);
      await logAttempt("failed", null, {}, e?.message || "erro", amount);
      return json({ error: "Erro ao criar cobrança: " + (e?.message || e) }, corsHeaders, 500);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ADESÃO — taxa de adesão avulsa
  // ════════════════════════════════════════════════════════════════════════
  if (type === "entrance") {
    const couponRes = await resolveCouponFor(entranceAmount, "entrance");
    if (!couponRes.ok) return json({ error: couponRes.error }, corsHeaders, 400);
    const chargedAmount = couponRes.amount;

    const correlationId = buildCorrelationId(group_id, user_id, "entrance", "charge");

    try {
      const charge = await apiCreateCharge(cfg, {
        valueCents: toCents(chargedAmount),
        correlationId,
        comment: `Adesao ${group.name || ""}`.substring(0, 40),
        customer: customerPayload,
      });

      await logAttempt("created", charge.identifier, {
        pix_copy_paste: charge.brCode,
        pix_qrcode_url: charge.qrCodeImage,
        charge,
      });

      return json({
        success: true,
        gateway: "woovi",
        transaction_id: charge.identifier,
        status: charge.status || "pending",
        payment_method: "pix",
        pix_copy_paste: charge.brCode,
        pix_qrcode_url: charge.qrCodeImage,
        amount: chargedAmount,
        needs_polling: true,
        recurrence: { enabled: false },
      }, corsHeaders);
    } catch (e: any) {
      console.error("[woovi] entrance charge error:", e);
      await logAttempt("failed", null, {}, e?.message || "erro");
      return json({ error: "Erro ao criar cobrança: " + (e?.message || e) }, corsHeaders, 500);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // ASSINATURA (subscription) e COMBINADO (combined)
  // ════════════════════════════════════════════════════════════════════════
  const isCombined = type === "combined";

  // Valor do CICLO — é o que vai para o mandate (o que renova sozinho).
  const subCouponRes = await resolveCouponFor(subscriptionAmount, "subscription");
  if (!subCouponRes.ok) return json({ error: subCouponRes.error }, corsHeaders, 400);
  const cycleAmount = subCouponRes.amount;

  const frequency = wooviFrequencyForCycle(cycle);
  const nextCharge = nextChargeDate(cycle, body.custom_cycle_months, body.custom_cycle_days);

  // O ciclo de 3 dias (mínimo da Jornada 2) — se o próximo vencimento cair
  // para menos de 3 dias, a Woovi REJEITA a criação do mandate.
  const daysUntilNextCharge = Math.ceil((nextCharge.getTime() - Date.now()) / 86_400_000);
  const canUsePixAutomatic = !!frequency && daysUntilNextCharge >= 3;

  // ── combined: primeiro a cobrança avulsa (adesão + 1º ciclo) ────────────
  let chargeArtifact: WooviCharge | null = null;
  let chargeAmount = 0;

  if (isCombined) {
    chargeAmount = entranceAmount + cycleAmount;
    const correlationId = buildCorrelationId(group_id, user_id, "combined", "charge");
    try {
      chargeArtifact = await apiCreateCharge(cfg, {
        valueCents: toCents(chargeAmount),
        correlationId,
        comment: `Adesao + 1a mensalidade`.substring(0, 40),
        customer: customerPayload,
      });
    } catch (e: any) {
      console.error("[woovi] combined charge error:", e);
      await logAttempt("failed", null, {}, e?.message || "erro");
      return json({ error: "Erro ao criar cobrança: " + (e?.message || e) }, corsHeaders, 500);
    }
  }

  // ── Pix Automático (mandate) ─────────────────────────────────────────────
  let mandate: WooviMandate | null = null;

  if (canUsePixAutomatic) {
    // Jornada 3 no fluxo `subscription` (o QR paga o 1º ciclo) e Jornada 2 no
    // `combined` (a cobrança JÁ foi feita pelo charge; o mandate só autoriza
    // a renovação do próximo ciclo).
    const journey = isCombined ? "ONLY_RECURRENCY" : "PAYMENT_ON_APPROVAL";

    // Na Jornada 2 a data de início precisa estar >= 3 dias no futuro, e
    // ela também fixa o dia do mês das renovações. Enviamos a data ISO
    // completa do próximo vencimento para o dia do mês bater com o
    // `next_charge_at` que o DividePass calcula.
    //
    // Na Jornada 3 é o contrário: o dia é o de HOJE, para que a PRIMEIRA
    // cobrança saia na hora (a doc da Woovi é explícita: "Caso seja escolhido
    // a jornada 3 a data deve ser o dia atual"). As renovações seguintes
    // caem no mesmo dia do mês — e o `next_charge_at` do banco é calculado
    // com o mesmo limite de último dia do mês (ver `nextChargeDate`).
    const dayGenerateCharge =
      journey === "ONLY_RECURRENCY"
        ? nextCharge.toISOString()
        : chargeDayOfMonth(new Date());

    try {
      mandate = await apiCreatePixAutomatic(cfg, {
        valueCents: toCents(cycleAmount),
        correlationId: buildCorrelationId(group_id, user_id, type, "rec"),
        comment: "Assinatura DividePass".substring(0, 29),
        customer: customerPayload,
        frequency: frequency as WooviFrequency,
        dayGenerateCharge: dayGenerateCharge as any,
        dayDue: Number(settings.woovi_day_due) || 3,
        journey,
        retryPolicy: (settings.woovi_retry_policy as any) || "THREE_RETRIES_7_DAYS",
      });
    } catch (e: any) {
      // O mandate é o que dá a recorrência automática. Se ele falha, a
      // assinatura ainda pode existir (cobrança avulsa) — mas o usuário
      // precisa saber que NÃO vai ter renovação automática.
      console.error("[woovi] pix automatic creation error:", e);
      mandate = null;
    }
  } else if (!frequency) {
    console.log(
      `[woovi] ciclo "${cycle}" sem equivalente no Pix Automático — sem mandato de recorrência`,
    );
  } else {
    console.log(
      `[woovi] próximo vencimento em ${daysUntilNextCharge} dias (< 3) — Pix Automático exige >= 3 dias`,
    );
  }

  // ── Fallback: o mandate falhou e NÃO é o fluxo combinado ─────────────────
  //
  // No fluxo `subscription` o Pix Automático É o meio de pagamento. Se a
  // criação do mandate falhar (erro da API, ciclo sem frequência
  // equivalente, menos de 3 dias para a próxima cobrança), sem fallback o
  // usuário ficaria com um checkout sem QR nenhum — sem caminho para pagar.
  //
  // Com o fallback, ele paga por uma cobrança Pix avulsa do valor do ciclo e
  // entra no grupo normalmente. O que se perde é a RENOVAÇÃO AUTOMÁTICA, e o
  // front avisa isso (`recurrence.fallback`).
  let recurrenceFallback = false;
  if (!mandate && !isCombined) {
    try {
      chargeArtifact = await apiCreateCharge(cfg, {
        valueCents: toCents(cycleAmount),
        correlationId: buildCorrelationId(group_id, user_id, type, "charge"),
        comment: `Assinatura ${group.name || ""}`.substring(0, 40),
        customer: customerPayload,
      });
      recurrenceFallback = true;
      console.log(
        "[woovi] sem Pix Automático — usando cobrança Pix avulsa do valor do ciclo",
      );
    } catch (e: any) {
      console.error("[woovi] fallback de cobrança Pix falhou:", e);
    }
  }

  // ── Persistência ─────────────────────────────────────────────────────────
  const paymentArtifactId = isCombined ? chargeArtifact!.identifier : mandate?.globalID || chargeArtifact?.identifier || null;
  const paymentBrCode = isCombined ? chargeArtifact!.brCode : mandate?.emv || null;
  // A URL da imagem do QR só existe para as COBRANÇAS (a Woovi devolve o
  // `qrCodeImage`). O mandate do Pix Automático vem só com o código EMV — o
  // QR dele é gerado no browser a partir desse código.
  const paymentQrUrl = isCombined ? chargeArtifact!.qrCodeImage : chargeArtifact?.qrCodeImage || null;

  const storedAmount = cycleAmount;
  const storedOriginalAmount = subscriptionAmount;
  const storedDiscount = subCouponRes.discount;

  await logAttempt(
    "created",
    paymentArtifactId,
    {
      pix_copy_paste: paymentBrCode,
      pix_qrcode_url: paymentQrUrl,
      charge: chargeArtifact,
      subscription: mandate,
    },
    undefined,
    isCombined ? chargeAmount : cycleAmount,
  );

  // A assinatura nasce como "pending": quem a ativa é o webhook, quando o
  // pagamento é de fato confirmado. `gateway_subscription_id` guarda o id do
  // artefato pago; `woovi_subscription_id` guarda o mandate (é ele que a Woovi
  // continua usando nas renovações — o `confirmPayment` sobrescreve o
  // `gateway_subscription_id` a cada confirmação).
  const subscriptionRow: Record<string, any> = {
    user_id,
    group_id,
    service_id: group.service_id,
    billing_cycle: cycle,
    amount: storedAmount,
    original_amount: storedOriginalAmount,
    discount_amount: storedDiscount,
    coupon_id: coupon_id || null,
    status: "pending",
    gateway: "woovi",
    payment_method: "pix",
    gateway_subscription_id: paymentArtifactId,
    external_reference: externalReference,
    started_at: new Date().toISOString(),
    next_charge_at: nextCharge.toISOString(),
    renewal_due_at: nextCharge.toISOString(),
    billing_status: "active",
    custom_cycle_days: subDays || null,
    custom_cycle_months: cycle === "custom" ? subMonths : null,
  };

  if (mandate) {
    subscriptionRow.woovi_subscription_id = mandate.globalID;
    subscriptionRow.woovi_recurrency_id = mandate.recurrencyId;
    subscriptionRow.woovi_recurrence_status = mandate.status;
  }

  const { error: subErr } = await supabaseAdmin
    .from("user_subscriptions")
    .upsert(subscriptionRow, { onConflict: "user_id, group_id" });
  if (subErr) {
    console.error("[woovi] user_subscriptions upsert error:", subErr.message);
  }

  return json({
    success: true,
    gateway: "woovi",
    transaction_id: paymentArtifactId,
    status: "pending",
    payment_method: "pix",
    pix_copy_paste: paymentBrCode,
    pix_qrcode_url: paymentQrUrl,
    amount: isCombined ? chargeAmount : cycleAmount,
    needs_polling: true,
    recurrence: {
      enabled: !!mandate,
      subscription_id: mandate?.globalID || null,
      recurrency_id: mandate?.recurrencyId || null,
      status: mandate?.status || null,
      journey: mandate?.journey || null,
      frequency: mandate?.frequency || null,
      first_charge_at: mandate ? nextCharge.toISOString() : null,
      copy_paste: mandate?.emv || null,
      qrcode_url: null,
      payment_link_url: mandate?.paymentLinkUrl || null,
      // true = o QR do mandate é DIFERENTE do QR de pagamento (o usuário
      // precisa escanear os dois: um paga, o outro autoriza a recorrência).
      separate_qr: isCombined && !!mandate,
      // true = o Pix Automático não pôde ser criado e o pagamento caiu para
      // uma cobrança Pix avulsa. O usuário paga, mas sem renovação automática.
      fallback: recurrenceFallback,
    },
  }, corsHeaders);
}

// ============================================================================
// CLIENTE
// ============================================================================

/**
 * Devolve o cliente na Woovi, criando se ainda não existir.
 *
 * O `correlationID` do cliente é o `user_id` do DividePass: isso torna a
 * criação idempotente na Woovi (mesmos dados → mesmo cliente) e garante que
 * a gente sempre consiga reencontrar o cliente.
 */
async function getOrCreateCustomer(
  cfg: WooviConfig,
  supabaseAdmin: any,
  user_id: string,
  settings: Record<string, string>,
): Promise<WooviCustomer> {
  const { data: profile } = await supabaseAdmin
    .from("users")
    .select("customer_id_woovi, name, email, phone, cpf")
    .eq("id", user_id)
    .maybeSingle();

  const correlationID = `dp-user-${user_id}`;

  // Cliente já conhecido: busca na Woovi para ter o objeto completo
  // (endereço, taxID normalizado).
  //
  // A API não tem id de cliente — o que identifica é o `correlationID`, e
  // `GET /api/v1/customer/{correlationID}` funciona. (Verificado no sandbox.)
  if (profile?.customer_id_woovi) {
    try {
      const existing = await apiGetCustomer(cfg, profile.customer_id_woovi);
      if (existing && (existing.email || existing.taxID || existing.phone)) {
        return {
          name: existing.name || profile?.name || "Cliente",
          email: existing.email || profile?.email || undefined,
          phone: existing.phone || profile?.phone || undefined,
          taxID: existing.taxID?.taxID || existing.taxID || normalizeCpf(profile?.cpf) || undefined,
          correlationID: existing.correlationID || correlationID,
          address: existing.address || buildDefaultAddress(settings),
        };
      }
    } catch (e: any) {
      console.warn("[woovi] GET customer falhou, recriando:", e?.message || e);
    }
  }

  const payload: WooviCustomer = {
    name: (profile?.name || "Cliente DividePass").trim(),
    correlationID,
  };

  const email = (profile?.email || "").trim();
  if (email) payload.email = email;

  const phone = normalizePhone(profile?.phone) || normalizePhone(settings.woovi_default_phone);
  if (phone) payload.phone = phone;

  const taxID = normalizeCpf(profile?.cpf);
  if (taxID) payload.taxID = taxID;

  // O Pix Automático exige endereço. O app ainda não coleta endereço do
  // usuário, então usamos um padrão configurável — exatamente o que o handler
  // da IoPay já faz (senão NENHUM usuário novo consegue pagar).
  payload.address = buildDefaultAddress(settings);

  const created = await criarOuReaproveitarCliente(cfg, payload, taxID);
  const newId = extractCustomerId(created);

  if (newId) {
    await supabaseAdmin.from("users").update({ customer_id_woovi: newId }).eq("id", user_id);
  }

  return {
    name: created?.name || payload.name,
    email: created?.email || payload.email,
    phone: created?.phone || payload.phone,
    taxID: created?.taxID?.taxID || created?.taxID || payload.taxID,
    correlationID: created?.correlationID || correlationID,
    address: created?.address || payload.address,
  };
}

/**
 * Cria o cliente na Woovi — ou reaproveita o que já existe.
 *
 * A criação NÃO é idempotente: cliente com os mesmos dados devolve 400
 * ("Há outro cliente com esses dados"). Esse 400 é tratado como "já existe",
 * e o cliente é localizado pelo CPF (a listagem da API não tem filtro, então
 * a busca é feita por nós).
 *
 * Sem esse tratamento, a segunda compra do mesmo usuário travaria sempre que
 * o `users.customer_id_woovi` não tivesse sido gravado — e o cliente ficaria
 * preso sem conseguir pagar.
 */
async function criarOuReaproveitarCliente(
  cfg: WooviConfig,
  payload: WooviCustomer,
  taxID: string,
): Promise<any> {
  try {
    return await apiCreateCustomer(cfg, payload);
  } catch (e: any) {
    const mensagem = String(e?.message || e).toLowerCase();
    const duplicado =
      mensagem.includes("outro cliente") ||
      mensagem.includes("já existe") ||
      mensagem.includes("ja existe");

    if (!duplicado || !taxID) throw e;

    console.warn("[woovi] cliente já existe na Woovi — localizando pelo CPF");
    const existente = await apiFindCustomerByTaxID(cfg, taxID);
    if (!existente) {
      // O 400 era por outro motivo — repassa o erro original.
      throw e;
    }
    return existente;
  }
}

function buildDefaultAddress(settings: Record<string, string>): Record<string, string> {
  return {
    zipcode: settings.woovi_default_address_zipcode || "01310-100",
    street: settings.woovi_default_address_street || "Av. Paulista",
    number: settings.woovi_default_address_number || "1000",
    neighborhood: settings.woovi_default_address_neighborhood || "Bela Vista",
    city: settings.woovi_default_address_city || "Sao Paulo",
    state: settings.woovi_default_address_state || "SP",
    country: settings.woovi_default_address_country || "BR",
  };
}

