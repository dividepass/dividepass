import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// Guarda de assinatura em vigor: o prazo de 12h da ENTRADA só vale para quem
// NÃO pagou a assinatura. Quem já tem assinatura paga e vigente continua no
// grupo (ver `_shared/subscription-guard.ts`).
import { buscarAssinaturaVigente } from "../_shared/subscription-guard.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

/**
 * `payments.method` é um ENUM: ('pix','credit_card','bank_slip').
 * O código antigo gravava `method: "refund"` — que NÃO existe no enum — e o
 * INSERT falhava com 22P02: o estorno NUNCA era registrado em `payments`.
 * Aqui o método é o do PAGAMENTO ORIGINAL (estornar é devolver o que foi pago
 * no mesmo meio), com um valor aceito pelo enum como reserva.
 */
const METODO_RESERVA = "pix";

export default {
  fetch: async (req: Request) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";

    // Auth do cron. O job no pg_cron envia a service_role key como Bearer,
    // não o CRON_SECRET, então os dois precisam ser aceitos — senão o job
    // devolvia 401 e o prazo de 12h nunca era expirado.
    const authHeader = req.headers.get("Authorization") || "";
    const provided = authHeader.replace(/^Bearer\s+/i, "").trim();
    const accepted = [cronSecret, supabaseServiceKey].filter(Boolean);

    let authorized = accepted.includes(provided);
    if (!authorized && provided) {
      const { data: secretRows } = await createClient(supabaseUrl, supabaseServiceKey)
        .from("app_settings")
        .select("value")
        .in("key", ["recurring_billing_cron_secret", "overdue_cron_secret"]);
      const fromSettings = (secretRows || []).map((r: any) => r.value || "");
      authorized = fromSettings.filter(Boolean).includes(provided);
    }

    if (!authorized) {
      return new Response("Unauthorized", { status: 401 });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    console.log("Checking expired entrances...");

    // Find members where entrance was paid but subscription deadline passed
    const { data: expiredMembers, error: fetchError } = await supabaseAdmin
      .from("group_members")
      .select("id, group_id, user_id, entrance_payment_id")
      .eq("payment_status", "entrance_paid")
      .lt("subscription_deadline", new Date().toISOString());

    if (fetchError) {
      console.error("Error fetching expired members:", fetchError);
      return new Response(JSON.stringify({ error: fetchError.message }), { status: 500 });
    }

    if (!expiredMembers || expiredMembers.length === 0) {
      console.log("No expired entrances found.");
      return new Response(JSON.stringify({ processed: 0, skipped: 0, message: "No expired entrances" }), { status: 200 });
    }

    console.log(`Found ${expiredMembers.length} expired entrances.`);

    let processed = 0;
    let skipped = 0;

    for (const member of expiredMembers) {
      try {
        // ── 0. GUARDA ────────────────────────────────────────────────────
        //
        // O prazo de 12h é o prazo para ASSINATAR depois de pagar a entrada.
        // Se a pessoa já tem assinatura PAGA e em vigor, o acesso é dela e
        // nada aqui pode encerrar o vínculo: no código antigo este job
        // estornava a entrada e cancelava o membro de um grupo que estava
        // SUMINDO da tela dela (a assinatura valia até dez/2026).
        //
        // Quem cancela assinatura vencida é o job de status
        // (`update-subscription-statuses`), pela data e com a carência de
        // 7 dias — nunca um prazo periférico.
        const assinatura = await buscarAssinaturaVigente(
          supabaseAdmin,
          member.user_id,
          member.group_id,
        );

        if (assinatura) {
          await supabaseAdmin
            .from("group_members")
            .update({
              payment_status: "active",
              updated_at: new Date().toISOString(),
            })
            .eq("id", member.id);

          skipped++;
          console.log(
            `Member ${member.id} has an active subscription (${assinatura.id}) — 12h deadline ignored, membership kept.`,
          );
          continue;
        }

        // ── 1. Estorno via Mercado Pago ──────────────────────────────────
        //
        // O gateway ativo hoje é o IO Pay (ver `app_settings.active_gateway`),
        // e o IO Pay não tem estorno automático aqui. Quando o pagamento não
        // existe no Mercado Pago o estorno NÃO acontece — e, nesse caso, o
        // vínculo é desfeito do mesmo jeito (a regra do prazo de 12h vale),
        // mas o hecho fica registrado para a equipe acertar o valor.
        let estornoFeito = false;
        let metodoOriginal = METODO_RESERVA;
        let valorOriginal = 0;

        if (member.entrance_payment_id) {
          // Método e valor do pagamento original (o `method` do estorno tem
          // que ser um valor do ENUM `payment_method`).
          const { data: pagamentoRows } = await supabaseAdmin
            .from("payments")
            .select("id, amount, method")
            .eq("transaction_code", member.entrance_payment_id)
            .limit(1);
          const pagamento = (pagamentoRows && pagamentoRows[0]) || null;
          if (pagamento) {
            metodoOriginal = pagamento.method || METODO_RESERVA;
            valorOriginal = Number(pagamento.amount) || 0;
          }

          if (mpAccessToken) {
            try {
              // Get the original payment to find its ID
              const searchUrl = `https://api.mercadopago.com/v1/payments/${member.entrance_payment_id}`;
              const paymentRes = await fetch(searchUrl, {
                headers: { Authorization: `Bearer ${mpAccessToken}` },
              });

              if (paymentRes.ok) {
                const paymentData = await paymentRes.json();

                // If payment was approved and can be refunded
                if (paymentData.status === "approved" && paymentData.status_detail === "accredited") {
                  // Refund endpoint
                  const refundRes = await fetch("https://api.mercadopago.com/v1/payments/" + member.entrance_payment_id + "/refunds", {
                    method: "POST",
                    headers: {
                      "Authorization": `Bearer ${mpAccessToken}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ amount: paymentData.transaction_amount }),
                  });

                  if (refundRes.ok) {
                    estornoFeito = true;
                    console.log(`Refund successful for payment ${member.entrance_payment_id}`);
                  } else {
                    const refundErr = await refundRes.json();
                    console.error(`Refund failed for payment ${member.entrance_payment_id}:`, refundErr);
                  }
                } else {
                  console.error(
                    `Payment ${member.entrance_payment_id} is not refundable (${paymentData.status}/${paymentData.status_detail}).`,
                  );
                }
              } else {
                console.error(
                  `Payment ${member.entrance_payment_id} not found in Mercado Pago (HTTP ${paymentRes.status}) — refund not done.`,
                );
              }
            } catch (refundErr) {
              console.error(`Refund error for member ${member.id}:`, refundErr);
            }
          }
        }

        // ── 2. Update member status ──────────────────────────────────────
        const agora = new Date().toISOString();
        await supabaseAdmin
          .from("group_members")
          .update({
            payment_status: estornoFeito ? "refunded" : "cancelled",
            status: "cancelled",
            left_at: agora,
            entrance_refunded: estornoFeito,
            updated_at: agora,
          })
          .eq("id", member.id);

        // ── 3. Record refund payment ─────────────────────────────────────
        //
        // Só quando o estorno aconteceu de verdade: um registro com
        // `status: 'refunded'` que não teve estorno seria mentira.
        if (estornoFeito) {
          const { error: insErr } = await supabaseAdmin.from("payments").insert({
            user_id: member.user_id,
            amount: 0,
            method: metodoOriginal,
            status: "refunded",
            notes: `Estorno automático (R$ ${valorOriginal.toFixed(2)}) - prazo de 12h expirado para pagamento da assinatura`,
            payment_type: "refund",
            group_id: member.group_id,
          });

          if (insErr) {
            console.error(`Error recording refund for member ${member.id}:`, insErr.message);
          }
        } else {
          // O dinheiro NÃO voltou (gateway sem estorno automático aqui). A
          // equipe precisa acertar o valor com a pessoa.
          await supabaseAdmin.from("platform_events").insert({
            event_type: "refund",
            title: "Estorno de entrada pendente",
            message:
              `A entrada de ${member.user_id} no grupo ${member.group_id} foi desfeita pelo fim do prazo de 12h, ` +
              `mas o estorno NÃO foi feito (o gateway ativo não tem estorno automático). ` +
              `Acerto manual de R$ ${valorOriginal.toFixed(2)} necessário.`,
            metadata: {
              member_id: member.id,
              user_id: member.user_id,
              group_id: member.group_id,
              entrance_payment_id: member.entrance_payment_id,
              amount: valorOriginal,
            },
          });
        }

        processed++;
      } catch (err) {
        console.error(`Error processing member ${member.id}:`, err);
      }
    }

    console.log(`Processed ${processed} expired entrances (${skipped} kept — active subscription).`);

    return new Response(
      JSON.stringify({ processed, skipped, total: expiredMembers.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
};
