// Helper: Determine initial payment_status for a new group_member upsert
// - first_attempt: user has never been active in this group
// - awaiting_entrance: user was previously active/expired (renewal scenario)
export async function getInitialPaymentStatus(
  supabaseAdmin: any,
  group_id: string,
  user_id: string,
  hasEntranceFee: boolean,
): Promise<string> {
  const { data: existing } = await supabaseAdmin
    .from("group_members")
    .select("payment_status, status")
    .eq("group_id", group_id)
    .eq("user_id", user_id)
    .maybeSingle();

  if (!existing) {
    return hasEntranceFee ? "first_attempt" : "first_attempt";
  }

  if (existing.status === "active" || existing.payment_status === "active" || existing.payment_status === "entrance_paid") {
    return "awaiting_entrance";
  }

  if (existing.payment_status === "first_attempt" || existing.payment_status === "overdue") {
    return existing.payment_status;
  }

  return "first_attempt";
}
