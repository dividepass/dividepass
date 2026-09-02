import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
};

export default {
  fetch: async (req: Request) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseServiceKey = Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    const mpAccessToken = Deno.env.get("MERCADO_PAGO_ACCESS_TOKEN") ?? "";
    const cronSecret = Deno.env.get("CRON_SECRET") ?? "";

    // Validate cron secret
    const authHeader = req.headers.get("Authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
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
      return new Response(JSON.stringify({ processed: 0, message: "No expired entrances" }), { status: 200 });
    }

    console.log(`Found ${expiredMembers.length} expired entrances.`);

    let processed = 0;

    for (const member of expiredMembers) {
      try {
        // 1. Attempt refund via MP API
        if (member.entrance_payment_id && mpAccessToken) {
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
                  console.log(`Refund successful for payment ${member.entrance_payment_id}`);
                } else {
                  const refundErr = await refundRes.json();
                  console.error(`Refund failed for payment ${member.entrance_payment_id}:`, refundErr);
                }
              }
            }
          } catch (refundErr) {
            console.error(`Refund error for member ${member.id}:`, refundErr);
          }
        }

        // 2. Update member status
        await supabaseAdmin
          .from("group_members")
          .update({
            payment_status: "refunded",
            status: "cancelled",
            left_at: new Date().toISOString(),
            entrance_refunded: true,
          })
          .eq("id", member.id);

        // 3. Record refund payment
        await supabaseAdmin
          .from("payments")
          .insert({
            user_id: member.user_id,
            amount: 0,
            method: "refund",
            status: "refunded",
            notes: `Estorno automático - prazo de 12h expirado para pagamento da assinatura`,
            payment_type: "refund",
            group_id: member.group_id,
          });

        processed++;
      } catch (err) {
        console.error(`Error processing member ${member.id}:`, err);
      }
    }

    console.log(`Processed ${processed} expired entrances.`);

    return new Response(
      JSON.stringify({ processed, total: expiredMembers.length }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  },
};
