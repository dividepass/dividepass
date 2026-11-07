import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { group_id } = await req.json();
    if (!group_id) {
      return new Response(JSON.stringify({ error: "group_id required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Fetch group data
    const { data: group, error: groupError } = await supabaseAdmin
      .from("groups")
      .select("id, name, owner_id")
      .eq("id", group_id)
      .single();

    if (groupError || !group) {
      return new Response(JSON.stringify({ error: "Group not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Check permission: admin or owner
    const { data: caller } = await supabaseAdmin
      .from("users")
      .select("role")
      .eq("id", user.id)
      .single();

    // Admin do sistema: as regras de privacidade/acerto NÃO valem para ele.
    // (mesma fonte do public.is_admin() do banco: users.role OU
    // app_metadata.role do JWT)
    const isAdmin = caller?.role === "admin" || user.app_metadata?.role === "admin";

    if (!isAdmin && group.owner_id !== user.id) {
      return new Response(JSON.stringify({ error: "Permission denied" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1. Get all active members
    const { data: members } = await supabaseAdmin
      .from("group_members")
      .select("user_id")
      .eq("group_id", group_id)
      .eq("status", "active");

    const memberIds = (members || []).map(m => m.user_id);

    // 1b. Quanto entrou no grupo. Se alguém pagou, a exclusão precisa do
    // acerto da equipe DividePass (estorno/transferência) — o grupo não pode
    // sumir com o dinheiro dentro sem que ninguém tome conta.
    const { data: paidPayments } = await supabaseAdmin
      .from("payments")
      .select("id, amount, user_id, paid_at")
      .eq("group_id", group_id)
      .eq("status", "paid");

    const paidCount = (paidPayments || []).length;
    const paidTotal = (paidPayments || []).reduce(
      (sum, p) => sum + (parseFloat(String(p.amount)) || 0),
      0,
    );
    const hasPaidMembers = paidCount > 0;

    // 1c. QUEM PODE APAGAR O GRUPO
    // - admin do sistema: apaga sempre. O registro do dinheiro continua no
    //   banco (o pagamento é desacoplado do grupo) e a equipe recebe o
    //   pedido de acerto.
    // - dono do grupo (usuário comum): a regra vale para ele. Com pagamento
    //   confirmado, a exclusão vira pedido para a equipe, porque o acerto com
    //   quem pagou não pode ser feito no automático.
    if (!isAdmin && hasPaidMembers) {
      const resumo = [
        `Quero encerrar o grupo "${group.name}".`,
        "",
        `Pagamentos confirmados: ${paidCount}`,
        `Total recebido: R$ ${paidTotal.toFixed(2)}`,
        `Membros notificados na exclusão: ${memberIds.length}`,
        "",
        "A exclusão precisa ser feita pela equipe DividePass para que os valores de quem pagou sejam acertados.",
      ].join("\n");

      // Abre o chamado para a equipe. Se a tabela de tickets não estiver
      // disponível, o pedido ainda é registrado em platform_events.
      let ticketId = null;
      try {
        const { data: ticket, error: ticketError } = await supabaseAdmin
          .from("support_tickets")
          .insert({
            user_id: user.id,
            subject: `Encerrar grupo com pagamento — ${group.name}`,
            category: "billing",
            priority: "high",
            archived: false,
          })
          .select("id")
          .single();

        if (!ticketError && ticket) {
          ticketId = ticket.id;
          await supabaseAdmin.from("support_messages").insert({
            ticket_id: ticket.id,
            user_id: user.id,
            message: resumo,
          });
        }
      } catch {
        ticketId = null;
      }

      await supabaseAdmin.from("platform_events").insert({
        event_type: "group_deletion_requested",
        title: "Exclusão de grupo com pagamentos — remover membros",
        message: `O dono do grupo "${group.name}" pediu a exclusão. ${paidCount} pagamento(s) recebido(s), total de R$ ${paidTotal.toFixed(2)}. Necessário remover os membros do grupo e acertar os valores de quem pagou (estorno ou transferência).`,
        metadata: JSON.stringify({
          group_id,
          group_name: group.name,
          paid_count: paidCount,
          paid_total: paidTotal,
          payer_ids: (paidPayments || []).map(p => p.user_id),
          member_ids: memberIds,
          requested_by: user.id,
          ticket_id: ticketId,
        }),
        created_by: user.id,
      });

      return new Response(JSON.stringify({
        error: `Este grupo tem ${paidCount} pagamento(s) confirmado(s) (R$ ${paidTotal.toFixed(2)}). A exclusão de grupos com dinheiro recebido é feita pela equipe DividePass, para que o acerto com quem pagou seja feito.${ticketId ? " Abrimos um chamado com esse pedido." : ""}`,
        code: "group_has_payments",
        paid_count: paidCount,
        paid_total: paidTotal,
        ticket_id: ticketId,
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 2. Cancel all subscriptions for this group
    const { data: subs } = await supabaseAdmin
      .from("user_subscriptions")
      .select("id")
      .eq("group_id", group_id)
      .in("status", ["active", "pending"]);

    if (subs && subs.length > 0) {
      await supabaseAdmin
        .from("user_subscriptions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .in("id", subs.map(s => s.id));
    }

    // 3. Delete group credentials
    await supabaseAdmin
      .from("group_credentials")
      .delete()
      .eq("group_id", group_id);

    // 4. Create notifications for all members
    if (memberIds.length > 0) {
      const notifications = memberIds.map(uid => ({
        user_id: uid,
        title: "Grupo encerrado",
        message: hasPaidMembers
          ? `O grupo "${group.name}" foi removido e sua assinatura foi cancelada. Como você pagou neste grupo, a equipe DividePass vai entrar em contato para acertar o valor.`
          : `O grupo "${group.name}" foi removido. Sua assinatura foi cancelada automaticamente.`,
        event_type: "group_deleted",
        metadata: JSON.stringify({ group_id, group_name: group.name }),
      }));

      await supabaseAdmin.from("notifications").insert(notifications);
    }

    // 5. Log platform event
    await supabaseAdmin.from("platform_events").insert({
      event_type: "group_deleted",
      title: "Grupo removido",
      message: `O grupo "${group.name}" foi removido por ${isAdmin ? "administrador" : "criador"}. ${subs?.length || 0} assinatura(s) cancelada(s). ${memberIds.length} membro(s) notificado(s).`,
      metadata: JSON.stringify({ group_id, group_name: group.name, subscriptions_cancelled: subs?.length || 0, members_notified: memberIds.length, deleted_by_admin: isAdmin }),
      created_by: user.id,
    });

    // 5b. Havia dinheiro dentro? Então a equipe DividePass precisa remover os
    // membros e acertar os valores de quem pagou. Este é o pedido.
    if (hasPaidMembers) {
      await supabaseAdmin.from("platform_events").insert({
        event_type: "group_deletion_requested",
        title: "Exclusão de grupo com pagamentos — remover membros",
        message: `O grupo "${group.name}" foi removido ${isAdmin ? "por um administrador" : "pelo dono"} com ${paidCount} pagamento(s) recebido(s), total de R$ ${paidTotal.toFixed(2)}. Necessário remover os membros do grupo e acertar os valores de quem pagou (estorno ou transferência).`,
        metadata: JSON.stringify({
          group_id,
          group_name: group.name,
          paid_count: paidCount,
          paid_total: paidTotal,
          payer_ids: (paidPayments || []).map(p => p.user_id),
          member_ids: memberIds,
          requested_by: user.id,
        }),
        created_by: user.id,
      });
    }

    // 6. Desacopla os pagamentos do grupo ANTES do DELETE.
    // O registro do dinheiro continua no banco (o grupo que some é o grupo,
    // não o histórico financeiro) e o DELETE deixa de bater na chave
    // estrangeira payments_group_id_fkey. Se o DELETE falhar, os pagamentos
    // voltam a apontar para o grupo (nada fica pela metade).
    const { data: pagamentos } = await supabaseAdmin
      .from("payments")
      .select("id")
      .eq("group_id", group_id);

    const paymentIds = (pagamentos || []).map(p => p.id);

    if (paymentIds.length > 0) {
      await supabaseAdmin
        .from("payments")
        .update({ group_id: null })
        .in("id", paymentIds);
    }

    // 7. Delete the group
    const { error: deleteError } = await supabaseAdmin
      .from("groups")
      .delete()
      .eq("id", group_id);

    if (deleteError) {
      // desfaz o desacoplamento: o grupo continua como estava
      if (paymentIds.length > 0) {
        await supabaseAdmin
          .from("payments")
          .update({ group_id })
          .in("id", paymentIds);
      }
      throw deleteError;
    }

    return new Response(JSON.stringify({
      success: true,
      subscriptions_cancelled: subs?.length || 0,
      members_notified: memberIds.length,
      paid_count: paidCount,
      paid_total: paidTotal,
      payments_detached: paymentIds.length,
      deleted_by_admin: isAdmin,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
