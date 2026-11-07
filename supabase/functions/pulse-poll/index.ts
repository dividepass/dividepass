// ============================================================================
// POLLING DE PEDIDOS PENDENTES — PULSE CODING
// ============================================================================
//
// Rede de segurança do webhook.
//
// A entrega pode não chegar pelo webhook (a Pulse pode não enviar, a rede
// pode cair, a assinatura pode ter sido recusada). Este job roda de tempos em
// tempos, pergunta `check_status` dos pedidos pendentes e aplica a entrega
// assim que ela estiver pronta.
//
// AUTENTICAÇÃO
// ------------
//   O cron manda um segredo guardado em `app_settings`
//   (`pulse_cron_secret`) ou o secret `PULSE_CRON_SECRET` — não é um JWT,
//   então `verify_jwt = false` (o gateway do Supabase rejeitaria). A checagem
//   real acontece aqui.
//
// LIMITE
// ------
//   A Pulse aceita 30 requisições por minuto. Cada rodada processa no máximo
//   20 pedidos (configurável) e o job roda a cada 5 minutos.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reprocessarPendentes } from "../_shared/pulse-orders.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const body = await req.json().catch(() => ({}));
      const limite = Math.max(1, Math.min(25, Number(body.limite ?? 20)));

      // ── O cron manda o segredo no header Authorization ───────────────────
      const authHeader = req.headers.get("Authorization") ?? "";
      const provided = authHeader.replace(/^Bearer\s+/i, "").trim();

      const { data: secretRows } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .in("key", ["pulse_cron_secret", "pulse_poll_secret"]);

      const aceitos = [
        Deno.env.get("PULSE_CRON_SECRET") || "",
        ...(secretRows || []).map((r: any) => r.value || ""),
      ].filter(Boolean);

      let autorizado = provided.length > 0 && aceitos.includes(provided);

      // Admin autenticado também pode disparar na mão.
      if (!autorizado && provided) {
        const { data: authData } = await supabaseAdmin.auth.getUser(provided);
        if (authData?.user) {
          const { data: profile } = await supabaseAdmin
            .from("users")
            .select("role")
            .eq("id", authData.user.id)
            .maybeSingle();
          autorizado = profile?.role === "admin" || authData.user.app_metadata?.role === "admin";
        }
      }

      if (!autorizado) {
        return json({ ok: false, erro: "Não autorizado." }, 401);
      }

      const resultado = await reprocessarPendentes(supabaseAdmin, limite);

      console.log(
        `[pulse-poll] processados=${resultado.processados} entregues=${resultado.entregues} erros=${resultado.erros}`,
      );

      return json({ ok: true, ...resultado });
    } catch (e: any) {
      console.error("[pulse-poll] erro:", e?.message ?? e);
      return json({ ok: false, erro: String(e?.message ?? e) }, 500);
    }
  },
};
