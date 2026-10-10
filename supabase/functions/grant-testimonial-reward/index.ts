import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CAMPAIGN_CODE = "AVALIE5";
const REWARD_DAYS_VALID = 30;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Authenticate user
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUser = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await supabaseUser.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "Não autenticado" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json();
    const { user_name, user_role, text, rating, avatar_url } = body;

    // Validation
    if (!text || !text.trim()) {
      return new Response(
        JSON.stringify({ error: "Texto do depoimento é obrigatório" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    if (!rating || rating < 1 || rating > 5) {
      return new Response(
        JSON.stringify({ error: "Avaliação deve ser entre 1 e 5 estrelas" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── IDEMPOTENCY CHECK ──────────────────────────────────────────────────
    // Se o usuário já tem elegibilidade ativa para AVALIE5, não conceder de novo.
    const { data: existingReward } = await supabaseAdmin
      .from("campaign_rewards")
      .select("id, status")
      .eq("campaign", CAMPAIGN_CODE)
      .eq("user_id", user.id)
      .in("status", ["available"])
      .maybeSingle();

    if (existingReward) {
      return new Response(
        JSON.stringify({
          error: "Você já possui elegibilidade para esta campanha.",
          already_granted: true,
          campaign: CAMPAIGN_CODE,
        }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── ATOMIC: criar testemunho + elegibilidade ───────────────────────────
    const expiresAt = new Date(Date.now() + REWARD_DAYS_VALID * 24 * 60 * 60 * 1000);

    // Avatar é desnormalizado aqui porque a RLS de users não permite leitura
    // por visitante anônimo, e a home pública precisa exibi-lo.
    // Aceitamos só URL do próprio bucket para o cliente não injetar origem externa.
    let safeAvatarUrl: string | null = null;
    const submittedAvatar = typeof avatar_url === "string" ? avatar_url.trim() : "";
    if (submittedAvatar) {
      const { data: avatarProfile } = await supabaseAdmin
        .from("users")
        .select("avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      // Só persistimos o avatar que realmente pertence a este usuário.
      if (avatarProfile?.avatar_url && submittedAvatar === avatarProfile.avatar_url) {
        safeAvatarUrl = avatarProfile.avatar_url;
      }
    }

    // Insert testimonial
    const { data: testimonial, error: testimonialErr } = await supabaseAdmin
      .from("testimonials")
      .insert({
        user_id: user.id,
        user_name: user_name || user.email || "Anônimo",
        user_role: user_role || null,
        text: text.trim(),
        rating: Number(rating),
        status: "pending",
        avatar_url: safeAvatarUrl,
      })
      .select()
      .single();

    if (testimonialErr) {
      console.error("grant-testimonial-reward: testimonial insert error", testimonialErr);
      return new Response(
        JSON.stringify({ error: "Erro ao salvar depoimento" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert campaign reward eligibility
    const { data: reward, error: rewardErr } = await supabaseAdmin
      .from("campaign_rewards")
      .insert({
        campaign: CAMPAIGN_CODE,
        user_id: user.id,
        earned_at: new Date().toISOString(),
        expires_at: expiresAt.toISOString(),
        status: "available",
      })
      .select()
      .single();

    if (rewardErr) {
      console.error("grant-testimonial-reward: campaign_rewards insert error", rewardErr);
      // Rollback: desmarcar o testemunho
      await supabaseAdmin
        .from("testimonials")
        .delete()
        .eq("id", testimonial.id);
      return new Response(
        JSON.stringify({ error: "Erro ao criar elegibilidade da campanha" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        already_granted: false,
        testimonial_id: testimonial.id,
        campaign: CAMPAIGN_CODE,
        reward: {
          code: CAMPAIGN_CODE,
          expires_at: expiresAt.toISOString(),
          expires_in_days: REWARD_DAYS_VALID,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("grant-testimonial-reward error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Erro interno" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
