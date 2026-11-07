// ============================================================================
// woovi-teste-conexao — testa um AppID da Woovi contra a URL do ambiente.
//
// POR QUE ESTA FUNCTION EXISTE
// -----------------------------
// O erro "appID inválido" (401) da API da Woovi é o mesmo para TODOS os
// erros de credencial: AppID trocado, AppID do ambiente errado, conta
// diferente, AppID revogado. O admin não tem como saber qual é o problema
// sem experimentally bater na API.
//
// Esta função faz exatamente uma coisa: chama `GET /api/v1/customer` (leitura
// simples, sem efeito colateral) na URL do ambiente escolhido e devolve o
// que a API respondeu. 200 = credencial boa; 401 = credencial recusada.
//
// SEGURANÇA
// ---------
//   - só o ADMIN da plataforma chama (JWT + `users.role = 'admin'`);
//   - o AppID viaja no corpo da requisição (HTTPS) e NUNCA é devolvido na
//     resposta — nem em parte;
//   - o AppID não é gravado em lugar nenhum por esta função.
//
// CORPO DA REQUISIÇÃO
// -------------------
//   {
//     "app_id": "Client_Id_... (opcional — vazio = usa o salvo no banco)",
//     "ambiente": "sandbox" | "production"
//   }
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  WOOVI_PROD,
  WOOVI_SANDBOX,
  normalizarAppId,
  appIdDoAmbiente,
  WOOVI_APP_ID_SANDBOX_KEY,
  WOOVI_APP_ID_PRODUCTION_KEY,
  WOOVI_APP_ID_LEGACY_KEY,
} from "../_shared/woovi.ts";
import { normalizarAmbiente } from "../_shared/ambiente.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: any, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/** Lê o app_settings com o service role (a tabela tem RLS). */
async function lerSettings(supabaseAdmin: any): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("app_settings").select("key, value");
  const map: Record<string, string> = {};
  for (const linha of data || []) {
    if (linha?.key) map[linha.key] = linha.value;
  }
  return map;
}

export default {
  fetch: async (req: Request) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
      const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

      // ── Autenticação: só admin ───────────────────────────────────────────
      const authHeader = req.headers.get("authorization") || "";
      if (!authHeader.startsWith("Bearer ")) {
        return json({ error: "Token não fornecido" }, 401);
      }

      const jwt = authHeader.replace("Bearer ", "");
      const { data: { user: caller } } = await supabaseAdmin.auth.getUser(jwt);
      if (!caller) return json({ error: "Token inválido" }, 401);

      const { data: callerProfile } = await supabaseAdmin
        .from("users")
        .select("role")
        .eq("id", caller.id)
        .maybeSingle();
      if (callerProfile?.role !== "admin") {
        return json({ error: "Apenas admins podem testar as credenciais" }, 403);
      }

      // ── Entrada ──────────────────────────────────────────────────────────
      let body: any = {};
      try {
        body = await req.json();
      } catch {
        body = {};
      }

      const ambiente = normalizarAmbiente(body.ambiente);
      const baseUrl = ambiente === "sandbox" ? WOOVI_SANDBOX : WOOVI_PROD;

      const settings = await lerSettings(supabaseAdmin);
      const salvo = appIdDoAmbiente(settings, ambiente);
      const informado = String(body.app_id || "").trim();

      const appId = normalizarAppId(informado || salvo);
      if (!appId) {
        return json({
          ok: false,
          status: 0,
          ambiente,
          base_url: baseUrl,
          error:
            `Nenhum AppID para testar no ambiente ${ambiente}. ` +
            `Cole o AppID no campo e clique em "Testar" de novo.`,
        });
      }

      // ── O teste: uma leitura simples na API ─────────────────────────────
      const started = Date.now();
      let resp: Response;
      try {
        resp = await fetch(`${baseUrl}/api/v1/customer`, {
          method: "GET",
          headers: {
            // AppID CRU, sem "Bearer" (ver _shared/woovi.ts).
            Authorization: appId,
            Accept: "application/json",
          },
        });
      } catch (e: any) {
        return json({
          ok: false,
          status: 0,
          ambiente,
          base_url: baseUrl,
          error: `Falha de rede ao falar com a Woovi: ${e?.message || e}`,
        });
      }

      const raw = await resp.text();
      let parsed: any = null;
      try {
        parsed = raw ? JSON.parse(raw) : null;
      } catch {
        parsed = { raw };
      }

      const msgDaApi = (() => {
        if (!parsed) return null;
        if (Array.isArray(parsed.errors) && parsed.errors.length) {
          const first = parsed.errors[0];
          return typeof first === "string" ? first : first?.message || null;
        }
        if (typeof parsed.errors === "string") return parsed.errors;
        return parsed.message || null;
      })();

      if (resp.ok) {
        const total = Array.isArray(parsed?.customers) ? parsed.customers.length : null;
        console.log(
          `[woovi-teste-conexao] OK ambiente=${ambiente} status=${resp.status} (${Date.now() - started}ms)`,
        );
        return json({
          ok: true,
          status: resp.status,
          ambiente,
          base_url: baseUrl,
          origem: informado ? "digitado agora" : "salvo no banco",
          clientes_visiveis: total,
          message:
            `Credencial aceita pela Woovi (${ambiente}). ` +
            (total !== null ? `A conta tem ${total} cliente(s) visível(is).` : ""),
        });
      }

      console.log(
        `[woovi-teste-conexao] FALHA ambiente=${ambiente} status=${resp.status} corpo=${raw.slice(0, 300)}`,
      );

      // 401 = credencial recusada. A mensagem diz o que TROCAR, porque
      // "appID inválido" sozinho não diz se o problema é o AppID ou o
      // ambiente em que ele está sendo usado.
      const dica =
        resp.status === 401
          ? ambiente === "sandbox"
            ? "Este AppID não é aceito pela conta de TESTE da Woovi. Use o AppID do painel de sandbox (api.woovi-sandbox.com) — ou troque o AppID do Sandbox abaixo."
            : "Este AppID não é aceito pela conta REAL da Woovi. Use o AppID do painel de produção (api.woovi.com) — o AppID do Sandbox é recusado aqui com 401."
          : resp.status === 403
            ? "A credencial foi recusada por falta de permissão. Confira se o AppID pertence a esta conta."
            : `A Woovi respondeu ${resp.status}.`;

      return json({
        ok: false,
        status: resp.status,
        ambiente,
        base_url: baseUrl,
        origem: informado ? "digitado agora" : "salvo no banco",
        api_message: msgDaApi,
        error: dica,
      });
    } catch (error: any) {
      console.error("woovi-teste-conexao error:", error);
      return json({ error: error?.message || "Erro inesperado" }, 500);
    }
  },
};

/**
 * Chaves que a tela do Admin precisa conhecer para montar o formulário.
 * Exportado para o teste local (`scripts/test-*`).
 */
export const CHAVES_APP_ID = {
  sandbox: WOOVI_APP_ID_SANDBOX_KEY,
  production: WOOVI_APP_ID_PRODUCTION_KEY,
  legacy: WOOVI_APP_ID_LEGACY_KEY,
};
