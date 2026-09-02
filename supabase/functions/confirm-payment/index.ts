// Shared payment confirmation logic
// Called by all webhook handlers after verifying the payment

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchNotification } from "../_shared/send-notification.ts";

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

    // Buscar valor pago (pode ser menor se cupom foi usado)
    let paidAmount = defaultAmount;
    try {
      const { data: attempt } = await supabaseAdmin
        .from("payment_attempts")
        .select("coupon_id, original_amount, discount_amount, final_amount")
        .eq("gateway_transaction_id", gateway_payment_id)
        .maybeSingle();

      if (attempt?.final_amount != null) {
        paidAmount = Number(attempt.final_amount);
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

export async function confirmPayment(params: ConfirmParams) {
  const { gateway, group_id, user_id, payment_type, amount, status, gateway_payment_id, payment_method, billing_cycle, custom_cycle_days, custom_cycle_months } = params;

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

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
      await supabaseAdmin.from("payments").insert({
        user_id,
        amount,
        method: payment_method || "unknown",
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
        title: "Pagamento de adesão",
        message: `${entranceUser?.name || "Usuário"} pagou taxa de adesão de R$ ${amount.toFixed(2)} no grupo "${entranceGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway, payment_type: "entrance", gateway_payment_id, user_name: entranceUser?.name, group_name: entranceGroup?.name }),
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
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key, value")
            .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

          const settingsMap: Record<string, string> = {};
          (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

          const gatewayFee = parseFloat(settingsMap.gateway_fee_percent || "4.98");
          const platformFee = parseFloat(settingsMap.platform_fee_percent || "3.95");
          const totalFeePercent = gatewayFee + platformFee;
          const netAmount = amount - (amount * totalFeePercent / 100);

          await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: group.owner_id,
            p_amount: netAmount,
            p_description: `Taxa de adesão - ${gateway}`,
            p_reference_type: "payment",
            p_reference_id: gateway_payment_id,
            p_group_id: group_id,
          });
        }
      } catch (walletErr) {
        console.error("Wallet credit error (entrance):", walletErr);
      }

      // Registrar cupom após confirmação do pagamento PIX (entrance)
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "entrance");

    } else if (payment_type === "combined") {
      // Combined: entrance + first subscription in one payment
      // Get group to split amounts
      const { data: group } = await supabaseAdmin
        .from("groups")
        .select("entrance_fee, price_per_slot, service_id, name, owner_id, billing_cycle")
        .eq("id", group_id)
        .single();

      const entranceAmount = group?.entrance_fee || 0;
      const subscriptionAmount = group?.price_per_slot || 0;

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
      await supabaseAdmin.from("payments").insert({
        user_id,
        amount: entranceAmount,
        method: payment_method || "unknown",
        status: "paid",
        payment_type: "entrance",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: "Taxa de adesão (parte do pagamento combinado)",
      });

      // 3. Create subscription with ONLY the monthly amount (not combined)
      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, billing_cycle, custom_cycle_months, custom_cycle_days, payment_method, card_id")
        .eq("user_id", user_id).eq("group_id", group_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const cycle = billing_cycle || subInfo?.billing_cycle || group?.billing_cycle || "monthly";
      const days = custom_cycle_days || subInfo?.custom_cycle_days || null;
      const months = custom_cycle_months || subInfo?.custom_cycle_months || null;

      let nextChargeAt: Date;
      if (cycle === "days" && days) {
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
            next_charge_at: nextChargeAt.toISOString(),
            billing_status: "active",
            retry_count: 0,
            last_charge_at: new Date().toISOString(),
            payment_method: payment_method || subInfo?.payment_method || null,
            billing_cycle: cycle,
            custom_cycle_days: days,
            custom_cycle_months: months,
            amount: subscriptionAmount, // IMPORTANTE: apenas o valor da mensalidade
          })
          .eq("id", subInfo.id);
      } else {
        await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: group?.service_id,
          billing_cycle: cycle, amount: subscriptionAmount, // IMPORTANTE: apenas mensalidade
          status: "active", gateway: gateway, gateway_subscription_id: gateway_payment_id,
          payment_method: payment_method || null,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          custom_cycle_days: days,
          custom_cycle_months: months,
        });
      }

      // 4. Update member to active
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });

      // 5. Record subscription payment (with savings tracking)
      const savingsDataCombined = await getSavingsData(supabaseAdmin, group_id, gateway_payment_id, subscriptionAmount);
      await supabaseAdmin.from("payments").insert({
        user_id,
        amount: subscriptionAmount,
        official_price: savingsDataCombined.official_price,
        paid_amount: savingsDataCombined.paid_amount,
        method: payment_method || "subscription",
        status: "paid",
        payment_type: "subscription",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: `1ª mensalidade (pagamento combinado com taxa de adesão)`,
      });

      // Platform events for combined
      const { data: combUser } = await supabaseAdmin.from("users").select("name").eq("id", user_id).maybeSingle();
      const { data: combGroup } = await supabaseAdmin.from("groups").select("name, owner_id").eq("id", group_id).maybeSingle();

      await supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: "Pagamento combinado (adesão + assinatura)",
        message: `${combUser?.name || "Usuário"} pagou taxa de adesão (R$ ${entranceAmount.toFixed(2)}) + 1ª mensalidade (R$ ${subscriptionAmount.toFixed(2)}) no grupo "${combGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, total_amount: amount, entrance_amount: entranceAmount, subscription_amount: subscriptionAmount, gateway, payment_type: "combined", gateway_payment_id, user_name: combUser?.name, group_name: combGroup?.name }),
        created_by: user_id,
      });

      await supabaseAdmin.from("platform_events").insert({
        event_type: "member_joined",
        title: "Membro ingressou no grupo",
        message: `${combUser?.name || user_id} ingressou no grupo "${combGroup?.name || group_id}".`,
        metadata: JSON.stringify({ user_id, group_id, amount: subscriptionAmount, gateway }),
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
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key, value")
            .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

          const settingsMap: Record<string, string> = {};
          (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

          const gatewayFee = parseFloat(settingsMap.gateway_fee_percent || "4.98");
          const platformFee = parseFloat(settingsMap.platform_fee_percent || "3.95");
          const totalFeePercent = gatewayFee + platformFee;
          const entranceNetAmount = entranceAmount - (entranceAmount * totalFeePercent / 100);

          await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: group.owner_id,
            p_amount: entranceNetAmount,
            p_description: `Taxa de adesão (pagamento combinado) - ${gateway}`,
            p_reference_type: "payment",
            p_reference_id: gateway_payment_id,
            p_group_id: group_id,
          });
        }
      } catch (walletErr) {
        console.error("Wallet credit error (combined entrance):", walletErr);
      }

      // Credit wallet for subscription portion
      try {
        if (group?.owner_id && !group?.is_official) {
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key, value")
            .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

          const settingsMap: Record<string, string> = {};
          (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

          const gatewayFee = parseFloat(settingsMap.gateway_fee_percent || "4.98");
          const platformFee = parseFloat(settingsMap.platform_fee_percent || "3.95");
          const totalFeePercent = gatewayFee + platformFee;
          const subNetAmount = subscriptionAmount - (subscriptionAmount * totalFeePercent / 100);

          await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: group.owner_id,
            p_amount: subNetAmount,
            p_description: `1ª mensalidade (pagamento combinado) - ${gateway}`,
            p_reference_type: "payment",
            p_reference_id: gateway_payment_id,
            p_group_id: group_id,
          });
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
            amount: subscriptionAmount,
            due_date: nextDue.toISOString().split("T")[0],
            status: "pending",
          });

          await supabaseAdmin
            .from("user_subscriptions")
            .update({ expires_at: nextDue.toISOString() })
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

    } else if (payment_type === "subscription") {
      // Calcular next_charge_at baseado no ciclo
      const { data: subInfo } = await supabaseAdmin
        .from("user_subscriptions")
        .select("id, billing_cycle, custom_cycle_months, custom_cycle_days, payment_method, card_id")
        .eq("user_id", user_id).eq("group_id", group_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: grp } = await supabaseAdmin.from("groups").select("billing_cycle").eq("id", group_id).maybeSingle();
      const cycle = billing_cycle || subInfo?.billing_cycle || grp?.billing_cycle || "monthly";
      const days = custom_cycle_days || subInfo?.custom_cycle_days || null;
      const months = custom_cycle_months || subInfo?.custom_cycle_months || null;

      let nextChargeAt: Date;
      if (cycle === "days" && days) {
        nextChargeAt = new Date();
        nextChargeAt.setDate(nextChargeAt.getDate() + days);
      } else {
        const cycleMonths = cycle === "quarterly" ? 3 : cycle === "semiannual" ? 6 : cycle === "annual" ? 12 : cycle === "custom" ? (months || 1) : 1;
        nextChargeAt = new Date();
        nextChargeAt.setMonth(nextChargeAt.getMonth() + cycleMonths);
      }

      if (subInfo?.id) {
        // Update existing subscription
        await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: "active",
            gateway_status: "authorized",
            gateway_subscription_id: gateway_payment_id,
            next_charge_at: nextChargeAt.toISOString(),
            billing_status: "active",
            retry_count: 0,
            last_charge_at: new Date().toISOString(),
            payment_method: payment_method || subInfo?.payment_method || null,
            billing_cycle: cycle,
            custom_cycle_days: days,
            custom_cycle_months: months,
          })
          .eq("id", subInfo.id);
      } else {
        // Fallback: create subscription if missing (critical gap fix)
        const { data: grp } = await supabaseAdmin.from("groups").select("service_id, price_per_slot, billing_cycle").eq("id", group_id).maybeSingle();
        await supabaseAdmin.from("user_subscriptions").insert({
          user_id, group_id, service_id: grp?.service_id,
          billing_cycle: cycle, amount: amount || grp?.price_per_slot || 0,
          status: "active", gateway: gateway, gateway_subscription_id: gateway_payment_id,
          payment_method: payment_method || null,
          next_charge_at: nextChargeAt.toISOString(),
          billing_status: "active", retry_count: 0, last_charge_at: new Date().toISOString(),
          started_at: new Date().toISOString(),
          custom_cycle_days: days,
          custom_cycle_months: months,
        });
      }

      // Update member — upsert to guarantee existence
      await supabaseAdmin
        .from("group_members")
        .upsert({
          group_id, user_id,
          status: "active",
          payment_status: "active",
          joined_at: new Date().toISOString(),
        }, { onConflict: "group_id, user_id" });

      // Record payment (with savings tracking)
      const savingsDataSub = await getSavingsData(supabaseAdmin, group_id, gateway_payment_id, amount);
      await supabaseAdmin.from("payments").insert({
        user_id,
        amount,
        official_price: savingsDataSub.official_price,
        paid_amount: savingsDataSub.paid_amount,
        method: payment_method || "subscription",
        status: "paid",
        payment_type: "subscription",
        group_id,
        transaction_code: gateway_payment_id,
        gateway,
        notes: "Assinatura recorrente paga",
      });

      // Platform event: payment + member_joined
      const { data: subGroup } = await supabaseAdmin
        .from("groups").select("name, owner_id").eq("id", group_id).maybeSingle();
      const { data: subUser } = await supabaseAdmin
        .from("users").select("name").eq("id", user_id).maybeSingle();

      await supabaseAdmin.from("platform_events").insert({
        event_type: "payment",
        title: "Pagamento de assinatura",
        message: `${subUser?.name || "Usuário"} confirmou assinatura de R$ ${amount.toFixed(2)} no grupo "${subGroup?.name || group_id}" via ${gateway}.`,
        metadata: JSON.stringify({ user_id, group_id, amount, gateway, payment_type: "subscription", gateway_payment_id, user_name: subUser?.name, group_name: subGroup?.name }),
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
          const { data: settings } = await supabaseAdmin
            .from("app_settings")
            .select("key, value")
            .in("key", ["gateway_fee_percent", "platform_fee_percent"]);

          const settingsMap: Record<string, string> = {};
          (settings || []).forEach((s: any) => { settingsMap[s.key] = s.value; });

          const gatewayFee = parseFloat(settingsMap.gateway_fee_percent || "4.98");
          const platformFee = parseFloat(settingsMap.platform_fee_percent || "3.95");
          const totalFeePercent = gatewayFee + platformFee;
          const netAmount = amount - (amount * totalFeePercent / 100);

          await supabaseAdmin.rpc("credit_wallet", {
            p_user_id: group.owner_id,
            p_amount: netAmount,
            p_description: `Assinatura - ${gateway}`,
            p_reference_type: "payment",
            p_reference_id: gateway_payment_id,
            p_group_id: group_id,
          });
        }
      } catch (walletErr) {
        console.error("Wallet credit error (subscription):", walletErr);
      }

      // Registrar cupom após confirmação do pagamento PIX (subscription)
      // registerCouponUsagePIX já atualiza coupon_uses, used_count e campaign_rewards
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "subscription");

      // Mark oldest pending invoice as paid
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

          // Create next invoice
          const { data: sub } = await supabaseAdmin
            .from("user_subscriptions")
            .select("billing_cycle, custom_cycle_days, custom_cycle_months, amount, expires_at")
            .eq("user_id", user_id)
            .eq("group_id", group_id)
            .maybeSingle();

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
              .update({ expires_at: nextDue.toISOString() })
              .eq("user_id", user_id)
              .eq("group_id", group_id);
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

      // Registrar cupom após confirmação do pagamento PIX (combined)
      await registerCouponUsagePIX(supabaseAdmin, gateway_payment_id, user_id, "combined");
    }

  } else if (status === "rejected") {
    // Payment failed
    await supabaseAdmin
      .from("group_members")
      .update({ payment_status: "expired", status: "cancelled" })
      .eq("group_id", group_id)
      .eq("user_id", user_id);

    await supabaseAdmin.from("payments").insert({
      user_id,
      amount,
      method: payment_method || "unknown",
      status: "failed",
      payment_type,
      group_id,
      transaction_code: gateway_payment_id,
      gateway,
      notes: "Pagamento rejeitado",
    });
  }
}

// ── Helper: registrar uso de cupom após confirmação PIX (webhook) ───────────────
async function registerCouponUsagePIX(
  supabaseAdmin: any,
  gateway_payment_id: string,
  user_id: string,
  payment_type: string,
): Promise<void> {
  try {
    const { data: attempt } = await supabaseAdmin
      .from("payment_attempts")
      .select("coupon_id, discount_amount, original_amount, final_amount")
      .eq("gateway_transaction_id", gateway_payment_id)
      .maybeSingle();

    if (!attempt?.coupon_id) return;

    const { data: existingUse } = await supabaseAdmin
      .from("coupon_uses")
      .select("id")
      .eq("coupon_id", attempt.coupon_id)
      .eq("user_id", user_id)
      .maybeSingle();

    if (existingUse) {
      console.log(`[registerCouponUsagePIX] coupon=${attempt.coupon_id} já usado por user=${user_id}`);
      return;
    }

    await supabaseAdmin.from("coupon_uses").insert({
      coupon_id: attempt.coupon_id,
      user_id,
      payment_type,
      original_amount: Number(attempt.original_amount || 0),
      discount_amount: Number(attempt.discount_amount || 0),
      final_amount: Number(attempt.final_amount || 0),
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
