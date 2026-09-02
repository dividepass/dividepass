import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) {
        return new Response(JSON.stringify({ error: "No auth" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user } } = await supabaseAdmin.auth.getUser(jwt);
      if (!user) {
        return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const body = await req.json();
      const { action } = body;

      // Validação de cupom NÃO requer admin
      if (action === "validate") {
        // Validate abaixo, sem verificação admin
      } else {
        // Todas as outras ações requerem admin
        const { data: profile } = await supabaseAdmin
          .from("users").select("role").eq("id", user.id).maybeSingle();
        if (profile?.role !== "admin") {
          return new Response(JSON.stringify({ error: "Not admin" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
      }

      // LIST
      if (action === "list") {
        const { data, error } = await supabaseAdmin
          .from("coupons")
          .select("*, group:group_id(id, name)")
          .order("created_at", { ascending: false });

        if (error) throw error;

        // Enriquezer com contagem de uso recente (últimos 30 dias)
        const enriched = await Promise.all((data || []).map(async (coupon) => {
          const { count: recentUses } = await supabaseAdmin
            .from("coupon_uses")
            .select("id", { count: "exact", head: true })
            .eq("coupon_id", coupon.id)
            .gte("created_at", new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

          return { ...coupon, recent_uses_30d: recentUses || 0 };
        }));

        return Response.json({ coupons: enriched }, { headers: corsHeaders });
      }

      // CREATE
      if (action === "create") {
        const { code, description, discount_type, discount_value, max_uses, min_amount, applies_to, group_id, expires_at, recurring } = body;

        if (!code || !discount_value) {
          return new Response(JSON.stringify({ error: "code and discount_value required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        if (discount_type === "percentage" && discount_value > 100) {
          return new Response(JSON.stringify({ error: "Desconto percentual não pode ser maior que 100%" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data, error } = await supabaseAdmin
          .from("coupons")
          .insert({
            code: code.toUpperCase().trim(),
            description: description || null,
            discount_type: discount_type || "percentage",
            discount_value,
            max_uses: max_uses || null,
            min_amount: min_amount || 0,
            applies_to: applies_to || "all",
            group_id: group_id || null,
            expires_at: expires_at || null,
            recurring: recurring || false,
          })
          .select()
          .single();

        if (error) {
          if (error.code === "23505") {
            return new Response(JSON.stringify({ error: "Este código já existe" }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          }
          throw error;
        }

        return Response.json({ success: true, coupon: data }, { headers: corsHeaders });
      }

      // UPDATE
      if (action === "update") {
        const { id, code, description, discount_type, discount_value, max_uses, min_amount, applies_to, group_id, expires_at, active, recurring } = body;
        if (!id) {
          return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const updates: any = {};
        if (code !== undefined) updates.code = code.toUpperCase().trim();
        if (description !== undefined) updates.description = description;
        if (discount_type !== undefined) updates.discount_type = discount_type;
        if (discount_value !== undefined) updates.discount_value = discount_value;
        if (max_uses !== undefined) updates.max_uses = max_uses;
        if (min_amount !== undefined) updates.min_amount = min_amount;
        if (applies_to !== undefined) updates.applies_to = applies_to;
        if (group_id !== undefined) updates.group_id = group_id;
        if (expires_at !== undefined) updates.expires_at = expires_at;
        if (active !== undefined) updates.active = active;
        if (recurring !== undefined) updates.recurring = recurring;

        const { data, error } = await supabaseAdmin
          .from("coupons")
          .update(updates)
          .eq("id", id)
          .select()
          .single();

        if (error) throw error;
        return Response.json({ success: true, coupon: data }, { headers: corsHeaders });
      }

      // DELETE
      if (action === "delete") {
        const { id } = body;
        if (!id) {
          return new Response(JSON.stringify({ error: "id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { error } = await supabaseAdmin.from("coupons").delete().eq("id", id);
        if (error) throw error;
        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // VALIDATE (chamado do checkout, sem auth admin)
      if (action === "validate") {
        // Re-verify as the requesting user (not admin)
        const { data: reqUser } = await supabaseAdmin.auth.getUser(jwt);
        const userId = reqUser?.user?.id;

        const { code, payment_type, amount, group_id: checkoutGroupId } = body;
        if (!code) {
          return new Response(JSON.stringify({ error: "code required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        const { data: coupon, error: couponErr } = await supabaseAdmin
          .from("coupons")
          .select("*")
          .eq("code", code.toUpperCase().trim())
          .eq("active", true)
          .maybeSingle();

        if (couponErr || !coupon) {
          return Response.json({ valid: false, error: "Cupom não encontrado ou inativo" }, { headers: corsHeaders });
        }

        // Verificar expiração
        if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) {
          return Response.json({ valid: false, error: "Cupom expirado" }, { headers: corsHeaders });
        }

        // Verificar limite de uso
        if (coupon.max_uses && coupon.used_count >= coupon.max_uses) {
          return Response.json({ valid: false, error: "Cupom atingiu o limite de uso" }, { headers: corsHeaders });
        }

        // Verificar se aplica ao tipo de pagamento
        if (coupon.applies_to !== "all" && coupon.applies_to !== payment_type) {
          return Response.json({ valid: false, error: `Cupom não se aplica a ${payment_type === "entrance" ? "taxa de adesão" : "assinatura"}` }, { headers: corsHeaders });
        }

        // ── ELEGIBILIDADE INDIVIDUAL POR CAMPANHA ────────────────────────────────
        // Cupons de campanha (ex: AVALIE5) exigem elegibilidade individual.
        // Se o cupom tem description "campaign:{codigo}", verificar campaign_rewards.
        const isCampaign = coupon.description && coupon.description.startsWith("campaign:");
        if (isCampaign && userId) {
          const campaignCode = coupon.description.replace("campaign:", "").trim();
          const { data: reward } = await supabaseAdmin
            .from("campaign_rewards")
            .select("*")
            .eq("campaign", campaignCode)
            .eq("user_id", userId)
            .eq("status", "available")
            .maybeSingle();

          if (!reward) {
            return Response.json({
              valid: false,
              error: "Este benefício é exclusivo para usuários que enviaram uma avaliação.",
            }, { headers: corsHeaders });
          }

          if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
            // Marcar como expirado no DB
            await supabaseAdmin
              .from("campaign_rewards")
              .update({ status: "expired" })
              .eq("id", reward.id)
              .catch(() => {});
            return Response.json({
              valid: false,
              error: "Este benefício expirou.",
            }, { headers: corsHeaders });
          }
        }

        // Verificar se o usuário já usou este cupom (se não for recorrente)
        if (!coupon.recurring && userId) {
          const { data: existingUse } = await supabaseAdmin
            .from("coupon_uses")
            .select("id")
            .eq("coupon_id", coupon.id)
            .eq("user_id", userId)
            .maybeSingle();

          if (existingUse) {
            return Response.json({ valid: false, error: "Você já utilizou este cupom anteriormente" }, { headers: corsHeaders });
          }
        }

        // Verificar se aplica ao grupo específico
        if (coupon.group_id && checkoutGroupId && coupon.group_id !== checkoutGroupId) {
          return Response.json({ valid: false, error: "Cupom não se aplica a este grupo" }, { headers: corsHeaders });
        }

        // Verificar valor mínimo
        if (coupon.min_amount && Number(amount || 0) < Number(coupon.min_amount)) {
          return Response.json({ valid: false, error: `Valor mínimo: R$ ${Number(coupon.min_amount).toFixed(2)}` }, { headers: corsHeaders });
        }

        // Calcular desconto
        const baseAmount = Number(amount || 0);
        let discount = 0;
        if (coupon.discount_type === "percentage") {
          discount = baseAmount * (Number(coupon.discount_value) / 100);
        } else {
          discount = Math.min(Number(coupon.discount_value), baseAmount);
        }
        let finalAmount = Math.max(0, baseAmount - discount);
        let minChargeWarning = null;

        // Regra: valor mínimo de R$ 1.00 para cobrar
        if (finalAmount < 1 && baseAmount >= 1) {
          minChargeWarning = `O valor com desconto ficou abaixo de R$ 1,00. O cobrado será o mínimo de R$ 1,00.`;
          finalAmount = 1;
        } else if (baseAmount < 1) {
          minChargeWarning = `O valor mínimo para pagamento é R$ 1,00.`;
          finalAmount = 1;
        }

        return Response.json({
          valid: true,
          coupon_id: coupon.id,
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: Number(coupon.discount_value),
          original_amount: baseAmount,
          discount_amount: discount,
          final_amount: finalAmount,
          description: coupon.description,
          is_campaign: isCampaign,
          min_charge_warning: minChargeWarning,
        }, { headers: corsHeaders });
      }

      // APPLY (registrar uso após pagamento confirmado)
      if (action === "apply") {
        const { coupon_id, payment_type, original_amount, discount_amount, final_amount, group_id: useGroupId } = body;
        if (!coupon_id) {
          return new Response(JSON.stringify({ error: "coupon_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        // Buscar o cupom para saber se é de campanha
        const { data: coupon } = await supabaseAdmin
          .from("coupons")
          .select("description")
          .eq("id", coupon_id)
          .maybeSingle();

        const isCampaign = coupon?.description && coupon.description.startsWith("campaign:");

        // Marcar elegibilidade individual de campanha como "used"
        if (isCampaign) {
          const campaignCode = coupon.description.replace("campaign:", "").trim();
          await supabaseAdmin
            .from("campaign_rewards")
            .update({ status: "used" })
            .eq("campaign", campaignCode)
            .eq("user_id", user.id)
            .eq("status", "available")
            .catch((e) => console.error("campaign_rewards update error:", e));
        }

        // Incrementar used_count
        const { error: updateErr } = await supabaseAdmin
          .rpc("increment_coupon_uses", { coupon_id_input: coupon_id })
          .single();

        // Fallback: update direto se RPC não existir
        if (updateErr) {
          await supabaseAdmin
            .from("coupons")
            .update({ used_count: supabaseAdmin.rpc ? undefined : 0 })
            .eq("id", coupon_id);

          // Usar query raw
          const { data: current } = await supabaseAdmin
            .from("coupons")
            .select("used_count")
            .eq("id", coupon_id)
            .single();

          if (current) {
            await supabaseAdmin
              .from("coupons")
              .update({ used_count: current.used_count + 1 })
              .eq("id", coupon_id);
          }
        }

        // Registrar uso
        const { error: insertErr } = await supabaseAdmin
          .from("coupon_uses")
          .insert({
            coupon_id,
            user_id: user.id,
            payment_type,
            original_amount,
            discount_amount,
            final_amount,
            group_id: useGroupId || null,
          });

        if (insertErr) console.error("coupon_uses insert error:", insertErr);

        return Response.json({ success: true }, { headers: corsHeaders });
      }

      // TESTIMONIAL AVAILABLE — verifica elegibilidade do usuário em campaign_rewards
      if (action === "testimonial_available") {
        const { data: reqUser } = await supabaseAdmin.auth.getUser(jwt);
        const userId = reqUser?.user?.id;
        if (!userId) {
          return Response.json({ available: false }, { headers: corsHeaders });
        }

        // Buscar elegibilidade ativa do usuário para campanha de depoimento
        const { data: reward } = await supabaseAdmin
          .from("campaign_rewards")
          .select("*")
          .eq("user_id", userId)
          .eq("status", "available")
          .order("earned_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!reward) {
          return Response.json({ available: false }, { headers: corsHeaders });
        }

        // Verificar expiração
        if (reward.expires_at && new Date(reward.expires_at) < new Date()) {
          // Marcar expirado no DB
          await supabaseAdmin
            .from("campaign_rewards")
            .update({ status: "expired" })
            .eq("id", reward.id)
            .catch(() => {});
          return Response.json({ available: false }, { headers: corsHeaders });
        }

        // Buscar o cupom da campanha para retornar discount_value
        const { data: coupon } = await supabaseAdmin
          .from("coupons")
          .select("id, code, discount_type, discount_value, description")
          .eq("code", reward.campaign)
          .eq("active", true)
          .maybeSingle();

        if (!coupon) {
          return Response.json({ available: false }, { headers: corsHeaders });
        }

        return Response.json({
          available: true,
          campaign: reward.campaign,
          coupon_id: coupon.id,
          code: coupon.code,
          discount_type: coupon.discount_type,
          discount_value: Number(coupon.discount_value),
          expires_at: reward.expires_at,
          description: coupon.description,
        }, { headers: corsHeaders });
      }

      // STATS
      if (action === "stats") {
        const { data: totalCoupons } = await supabaseAdmin
          .from("coupons")
          .select("id", { count: "exact", head: true });

        const { data: activeCoupons } = await supabaseAdmin
          .from("coupons")
          .select("id", { count: "exact", head: true })
          .eq("active", true);

        const { data: totalUses } = await supabaseAdmin
          .from("coupon_uses")
          .select("id", { count: "exact", head: true });

        const { data: totalDiscount } = await supabaseAdmin
          .from("coupon_uses")
          .select("discount_amount");

        const totalDiscountSum = (totalDiscount || []).reduce((sum: number, u: any) => sum + Number(u.discount_amount || 0), 0);

        return Response.json({
          stats: {
            total: totalCoupons?.length || 0,
            active: activeCoupons?.length || 0,
            total_uses: totalUses?.length || 0,
            total_discount_given: totalDiscountSum,
          }
        }, { headers: corsHeaders });
      }

      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    } catch (error: any) {
      console.error("manage-coupons error:", error);
      return Response.json(
        { error: error.message },
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  },
};
