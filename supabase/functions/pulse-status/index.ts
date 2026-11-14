// ============================================================================
// SINCRONIZAÇÃO DE STATUS DOS GRUPOS — PULSE CODING
// ============================================================================
//
// Alvo do cron `pulse-status` (roda de 5 em 5 horas).
//
// O que faz
// ---------
// Lê o catálogo da Pulse (1 chamada de `list_packages`) e deixa cada grupo Via
// Parceiro igual ao produto na Pulse:
//
//   Pulse "Na vitrine"   → grupo `open`   + `public`  → liberado e clicável
//   Pulse "Indisponível" → grupo `closed` + `private` → DESATIVADO
//
// Um grupo desativado não aceita mais ninguém: sai da vitrine, o
// `create-payment` recusa (403 `grupo_desativado`), o `joinGroup` recusa e o
// checkout mostra a tela "Esgotado". Quando a Pulse volta a liberar o produto,
// o grupo é REATIVADO e volta para a vitrine.
//
// ESTOQUE: quem cuida da tag "Esgotado" (produto anunciado, porém sem estoque)
// é o `pulse-poll`, que roda a cada 5 minutos. Aqui só o status do produto.
//
// AUTENTICAÇÃO
// ------------
//   O cron manda o segredo guardado em `app_settings` (`pulse_cron_secret`) ou
//   o secret `PULSE_CRON_SECRET` — não é um JWT, então `verify_jwt = false`
//   (o gateway do Supabase rejeitaria). A checagem real acontece aqui.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sincronizarStatusParceiro } from "../_shared/pulse-status.ts";

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

      // ── O cron manda o segredo no header Authorization ───────────────────
      const authHeader = req.headers.get("Authorization") ?? "";
      const provided = authHeader.replace(/^Bearer\s+/i, "").trim();

      const { data: secretRows } = await supabaseAdmin
        .from("app_settings")
        .select("value")
        .in("key", ["pulse_cron_secret", "pulse_poll_secret", "pulse_status_secret"]);

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

      const relatorio = await sincronizarStatusParceiro(supabaseAdmin);

      // ── Avisa o admin quando algo mudou de estado ───────────────────────
      if (relatorio.desativados > 0 || relatorio.reativados > 0) {
        const partes: string[] = [];
        if (relatorio.desativados > 0) partes.push(`${relatorio.desativados} desativado(s)`);
        if (relatorio.reativados > 0) partes.push(`${relatorio.reativados} reativado(s)`);

        // Grupo desativado COM gente pagante: as assinaturas continuam
        // renovando e a credencial continua valendo, mas ninguém mais entra.
        // O dono precisa ver o nome e o tamanho para poder avisar o cliente.
        const comGente = relatorio.desativados_com_gente || [];
        const detalhe = comGente.length
          ? ` Atenção — desativado com gente pagante: ${comGente
              .map((g) => `${g.nome} (${g.assinaturas} assinatura(s) ativa(s), ${g.membros} membro(s))`)
              .join("; ")}. Essas assinaturas continuam renovando.`
          : "";

        try {
          await supabaseAdmin.from("platform_events").insert({
            event_type: "pulse",
            title: "Status dos grupos sincronizado com a Pulse",
            message: `Sincronização de 5 em 5 horas: ${partes.join(" e ")}.${detalhe}`,
            metadata: JSON.stringify({
              desativados: relatorio.desativados,
              reativados: relatorio.reativados,
              na_vitrine: relatorio.na_vitrine,
              indisponiveis: relatorio.indisponiveis,
              desativados_com_gente: comGente,
            }),
            created_by: null,
          });
        } catch (e: any) {
          console.error("[pulse-status] erro ao avisar o admin:", e?.message ?? e);
        }
      }

      console.log(
        `[pulse-status] total=${relatorio.total} na_vitrine=${relatorio.na_vitrine} indisponiveis=${relatorio.indisponiveis} esgotados=${relatorio.esgotados} desativados=${relatorio.desativados} reativados=${relatorio.reativados} atualizados=${relatorio.atualizados}${relatorio.erro ? ` erro=${relatorio.erro}` : ""}`,
      );

      if (relatorio.erro) {
        return json({ ok: false, erro: relatorio.erro, relatorio }, 502);
      }

      return json({ ok: true, relatorio });
    } catch (e: any) {
      console.error("[pulse-status] erro:", e?.message ?? e);
      return json({ ok: false, erro: String(e?.message ?? e) }, 500);
    }
  },
};
