import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Revalidação de cupom no SERVIDOR.
 *
 * Por que isto existe:
 * o checkout enviava `coupon_id`, `discount_amount` e `final_amount` no body e
 * o handler do gateway usava esses valores direto:
 *
 *   const charged = (coupon_id && final_amount != null && discount_amount != null)
 *     ? Number(final_amount)
 *     : subscriptionAmount;              // iopay.ts:739 e :865
 *
 * Um POST com `final_amount: 0.01` cobrava R$ 0,01 numa assinatura de R$ 150
 * e ainda persistia o valor adulterado em `user_subscriptions.amount`, o que
 * contaminava a recorrencia.
 *
 * Aqui o desconto e SEMPRE recalculado a partir da tabela `coupons`, aplicando
 * as mesmas regras da acao `validate` do manage-coupons. O valor do cliente e
 * ignorado por completo.
 */

export type ResolvedCoupon = {
  coupon_id: string;
  code: string;
  discount: number;
  finalAmount: number;
  recurring: boolean;
  isCampaign: boolean;
  minChargeWarning: string | null;
};

export type CouponResult =
  | { ok: true; coupon: ResolvedCoupon }
  | { ok: false; error: string };

export async function resolveCoupon(params: {
  supabaseAdmin: SupabaseClient;
  couponId: string;
  userId: string;
  paymentType: string;
  groupId: string;
  baseAmount: number;
}): Promise<CouponResult> {
  const { supabaseAdmin, couponId, userId, paymentType, groupId, baseAmount } = params;

  const { data: coupon, error: couponErr } = await supabaseAdmin
    .from("coupons")
    .select("*")
    .eq("id", couponId)
    .eq("active", true)
    .maybeSingle();

  if (couponErr || !coupon) {
    return { ok: false, error: "Cupom não encontrado ou inativo" };
  }

  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
    return { ok: false, error: "Cupom expirado" };
  }

  if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
    return { ok: false, error: "Cupom atingiu o limite de uso" };
  }

  if (coupon.applies_to !== "all" && coupon.applies_to !== paymentType) {
    return {
      ok: false,
      error: `Cupom não se aplica a ${paymentType === "entrance" ? "taxa de adesão" : "assinatura"}`,
    };
  }

  if (coupon.group_id && groupId && coupon.group_id !== groupId) {
    return { ok: false, error: "Cupom não se aplica a este grupo" };
  }

  // Elegibilidade individual de campanha (ex: AVALIE5)
  const isCampaign = !!(coupon.description && String(coupon.description).startsWith("campaign:"));
  if (isCampaign && userId) {
    const campaignCode = String(coupon.description).replace("campaign:", "").trim();
    const { data: reward } = await supabaseAdmin
      .from("campaign_rewards")
      .select("*")
      .eq("campaign", campaignCode)
      .eq("user_id", userId)
      .eq("status", "available")
      .maybeSingle();

    if (!reward) {
      return {
        ok: false,
        error: "Este benefício é exclusivo para usuários que enviaram uma avaliação.",
      };
    }
    if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
      await supabaseAdmin
        .from("campaign_rewards")
        .update({ status: "expired" })
        .eq("id", reward.id)
        .catch(() => {});
      return { ok: false, error: "Este benefício expirou." };
    }
  }

  // Cupom nao recorrente: cada usuario pode usar uma vez
  if (!coupon.recurring && userId) {
    const { data: existingUse } = await supabaseAdmin
      .from("coupon_uses")
      .select("id")
      .eq("coupon_id", coupon.id)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingUse) {
      return { ok: false, error: "Você já utilizou este cupom anteriormente" };
    }
  }

  const base = Number(baseAmount || 0);
  if (coupon.min_amount && base < Number(coupon.min_amount)) {
    return { ok: false, error: `Valor mínimo: R$ ${Number(coupon.min_amount).toFixed(2)}` };
  }

  // Calculo do desconto (mesma formula do manage-coupons)
  let discount = 0;
  if (coupon.discount_type === "percentage") {
    discount = base * (Number(coupon.discount_value) / 100);
  } else {
    discount = Math.min(Number(coupon.discount_value), base);
  }
  let finalAmount = Math.max(0, base - discount);
  let minChargeWarning: string | null = null;

  if (finalAmount < 1 && base >= 1) {
    minChargeWarning = "O valor com desconto ficou abaixo de R$ 1,00. O cobrado será o mínimo de R$ 1,00.";
    finalAmount = 1;
  } else if (base < 1) {
    minChargeWarning = "O valor mínimo para pagamento é R$ 1,00.";
    finalAmount = 1;
  }

  return {
    ok: true,
    coupon: {
      coupon_id: coupon.id,
      code: coupon.code,
      discount: Number(discount.toFixed(2)),
      finalAmount: Number(finalAmount.toFixed(2)),
      recurring: !!coupon.recurring,
      isCampaign,
      minChargeWarning,
    },
  };
}
