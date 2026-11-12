/**
 * GUARDA DE ASSINATURA EM VIGOR
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * Vários eventos PERIFÉRICOS mexem no vínculo com o grupo:
 *
 *   - `confirm-payment`: o gateway recusou um pagamento
 *   - `check-entrance-deadline`: o prazo de 12h da entrada venceu
 *
 * Cada um deles, no código antigo, terminava em
 * `group_members.status = 'cancelled'` — o que some o grupo da tela do
 * usuário (o front só lista assinatura `active`/`expired`) e libera a
 * credencial/perfil do grupo (triggers `release_credential`/`release_profile`).
 *
 * Ou seja: um teste de pagamento recusado de R$0,01 ou um prazo de entrada
 * vencido tiraram do grupo pessoas que tinham ASSINATURA PAGA E VIGENTE.
 *
 * A REGRA (a mesma do `src/lib/subscriptionAccess.js` do front)
 * ----------------------------------------------------------
 *   ATIVA      vencimento > agora
 *   ATRASADA   vencimento <= agora e ainda dentro da carência de 7 dias
 *   CANCELADA  passou da carência de 7 dias
 *
 * Enquanto a assinatura está "em vigor" (ativa OU dentro da carência), o
 * acesso é da pessoa: nenhum evento periférico pode desvincular ela.
 * Passou da carência, quem desvincula é o job de status
 * (`update-subscription-statuses`), pela data — e não um evento aleatório.
 */

import { renewalDueAt, OVERDUE_GRACE_DAYS, DAY_MS } from "./subscription-dates.ts";

/** Status de assinatura que NUNCA são "em vigor". */
const STATUS_NAO_VIGENTES = new Set(["cancelled", "inactive", "pending"]);

/**
 * A assinatura ainda dá acesso?
 *
 * - `cancelled`/`inactive`/`pending` → não (cancelada é terminal; pending
 *   nunca foi paga).
 * - Sem data de renovação: não dá para provar atraso → vale enquanto o
 *   status for 'active'.
 * - Com data de renovação: vale até `vencimento + carência`.
 *
 * O `billing_status` NÃO entra na conta de propósito: `billing_status =
 * 'cancelled'` significa "a cobrança automática foi desligada" (recusa de
 * cartão, mandate do Pix recusado, 3 tentativas falhas), e não "sem acesso" —
 * quem não pode mais ser cobrado ainda tem o período PAGO pela frente. A
 * regra é por DATA, como no front (`src/lib/subscriptionAccess.js`).
 */
export function assinaturaEmVigor(sub: any, now = new Date()): boolean {
  if (!sub) return false;

  const status = String(sub.status || "").toLowerCase();
  if (STATUS_NAO_VIGENTES.has(status)) return false;

  const due = renewalDueAt(sub);
  if (!due) return status === "active";

  // Vencimento ainda não passou → ativa. Passou, mas dentro da carência de
  // 7 dias → atrasada (o grupo continua visível; o acesso às credenciais, não).
  return due.getTime() + OVERDUE_GRACE_DAYS * DAY_MS >= now.getTime();
}

/**
 * Procura a assinatura EM VIGOR do par (user_id, group_id).
 *
 * Devolve a assinatura ou `null`. Não lança: quem chama decide o que fazer
 * quando não há assinatura (aí o cancelamento é legítimo).
 */
export async function buscarAssinaturaVigente(
  admin: any,
  user_id: string,
  group_id: string,
  now = new Date(),
): Promise<any | null> {
  if (!user_id || !group_id) return null;

  const { data, error } = await admin
    .from("user_subscriptions")
    .select(
      "id, user_id, group_id, status, billing_status, renewal_due_at, next_charge_at, expires_at, created_at",
    )
    .eq("user_id", user_id)
    .eq("group_id", group_id)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("[subscription-guard] falha ao buscar assinatura:", error.message);
    return null;
  }

  for (const sub of data || []) {
    if (assinaturaEmVigor(sub, now)) return sub;
  }
  return null;
}
