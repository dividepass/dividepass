// ============================================================================
// MINHAS ENTREGAS — PULSE CODING
// ============================================================================
//
// O cliente pede aqui a sua entrega (a conta, o link, a licença ou o código
// que a Pulse devolveu) e o andamento do pedido.
//
// SEGURANÇA
// ----------
//   - Exige o JWT do usuário (verify_jwt = true, padrão do projeto).
//   - Tudo é filtrado por `user_id`: o cliente NUNCA vê a entrega de outro.
//   - A chave da Pulse não existe aqui — esta função só lê do banco.
//
// ESTADOS QUE O CLIENTE VÊ
// -----------------------
//   entregue  → a conta está pronta (aparece em "Minhas entregas")
//   pendente  → "estamos comprando na Pulse" (o polling/webhook resolve)
//   erro      → "não deu certo, o suporte foi avisado"
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_KEY") ?? "";
      const serviceRoleKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";

      const authHeader = req.headers.get("Authorization");
      if (!authHeader) return json({ ok: false, erro: "Não autenticado." }, 401);

      const jwt = authHeader.replace("Bearer ", "");
      const supabaseUser = createClient(supabaseUrl, anonKey || serviceRoleKey);
      const { data: authData, error: authError } = await supabaseUser.auth.getUser(jwt);
      if (authError || !authData?.user) return json({ ok: false, erro: "Sessão inválida." }, 401);

      const userId = authData.user.id;
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const url = new URL(req.url);
      const groupId = url.searchParams.get("group_id");

      // ── Entregas do cliente ─────────────────────────────────────────────
      let query = supabaseAdmin
        .from("pulse_entregas")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (groupId) query = query.eq("group_id", groupId);

      const { data: entregas, error: errEntregas } = await query;
      if (errEntregas) {
        console.error("[pulse-entrega] erro ao ler as entregas:", errEntregas.message);
        return json({ ok: false, erro: "Não foi possível carregar suas entregas." }, 200);
      }

      // ── Pedidos (para o aviso de "entrega em andamento") ───────────────
      let queryPedidos = supabaseAdmin
        .from("pulse_pedidos")
        .select(
          "id, external_id, status, package_id, group_id, created_at, updated_at, ultimo_erro, error_code, delivery_kind",
        )
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);

      if (groupId) queryPedidos = queryPedidos.eq("group_id", groupId);

      const { data: pedidos } = await queryPedidos;

      // ── Nome do produto e do grupo, para a tela ─────────────────────────
      const groupIds = [...new Set((entregas ?? []).map((e) => e.group_id).filter(Boolean))];
      let grupos: any[] = [];
      if (groupIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("groups")
          .select("id, name, slug, service_id")
          .in("id", groupIds);
        grupos = data ?? [];
      }

      const packageIds = [...new Set((entregas ?? []).map((e) => e.package_id).filter(Boolean))];
      let pacotes: any[] = [];
      if (packageIds.length > 0) {
        const { data } = await supabaseAdmin
          .from("pulse_pacotes")
          .select("package_id, title, category, delivery")
          .in("package_id", packageIds);
        pacotes = data ?? [];
      }

      const grupoPorId = new Map(grupos.map((g) => [g.id, g]));
      const pacotePorId = new Map(pacotes.map((p) => [p.package_id, p]));

      const entregasFormatadas = (entregas ?? []).map((e: any) => ({
        id: e.id,
        group_id: e.group_id,
        grupo_nome: grupoPorId.get(e.group_id)?.name ?? null,
        grupo_slug: grupoPorId.get(e.group_id)?.slug ?? null,
        package_id: e.package_id,
        produto: pacotePorId.get(e.package_id)?.title ?? e.package_title ?? null,
        categoria: pacotePorId.get(e.package_id)?.category ?? null,
        credential_type: e.credential_type,
        login_email: e.login_email,
        login_password: e.login_password,
        credential_url: e.credential_url,
        credential_notes: e.credential_notes,
        credits: e.credits,
        expira_em: e.expira_em,
        created_at: e.created_at,
      }));

      return json({
        ok: true,
        entregas: entregasFormatadas,
        pedidos: pedidos ?? [],
      });
    } catch (e: any) {
      console.error("[pulse-entrega] erro:", e?.message ?? e);
      return json({ ok: false, erro: String(e?.message ?? e) }, 500);
    }
  },
};
