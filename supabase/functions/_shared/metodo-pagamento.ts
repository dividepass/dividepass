/**
 * MÉTODO DE PAGAMENTO — normalização.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A IO Pay devolve `payment_method` como OBJETO, não como texto: no cartão é o
 * cartão inteiro (holder_name, fingerprint, verification_checklist) e no Pix é
 * o BR Code. São 480–540 caracteres.
 *
 * O `check-iopay-tx` gravava esse objeto CRU em `payment_attempts`, o
 * `reconcile-payments` lia a tentativa e repassava o valor CRU para o
 * `confirm-payment`, que gravava em `user_subscriptions.payment_method` — uma
 * coluna VARCHAR(50).
 *
 * Resultado em producao (06->07/11/2026):
 *   - `value too long for type character varying(50)`
 *   - a liberacao do grupo falhava DEPOIS do dinheiro cair (cliente pagou e
 *     ficou de fora);
 *   - o job de reconciliacao repetia a tentativa a cada 15 minutos: 1.536
 *     falhas em 24h, com evento no painel a cada rodada.
 *
 * A REGRA: para uma coluna curta, NUNCA gravar o que veio do gateway.
 * Sempre gravar o método normalizado.
 */

/** Valores aceitos pelo ENUM `payments.method`. */
export const METODO_PIX = "pix";
export const METODO_CARTAO = "credit_card";
export const METODO_BOLETO = "bank_slip";

export type MetodoPagamento = typeof METODO_PIX | typeof METODO_CARTAO | typeof METODO_BOLETO;

/**
 * Extrai o "recurso" de um método que pode ser texto OU objeto do gateway.
 * Devolve sempre um dos três métodos conhecidos.
 */
export function normalizarMetodoPagamento(raw?: unknown): MetodoPagamento {
  let texto = "";
  if (typeof raw === "string") {
    texto = raw;
  } else if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    texto = String(obj.resource ?? obj.type ?? obj.method ?? obj.payment_method ?? "");
  }

  const v = texto.toLowerCase().trim();
  if (!v) return METODO_CARTAO;
  if (v.includes("pix")) return METODO_PIX;
  if (v.includes("boleto") || v.includes("bank") || v.includes("slip")) return METODO_BOLETO;
  if (v.includes("credit") || v.includes("card") || v.includes("iopay")) return METODO_CARTAO;
  return METODO_CARTAO;
}

/**
 * Método pronto para gravar numa coluna curta (`user_subscriptions`).
 *
 * - `null` quando não há método nenhum (a coluna fica vazia, como antes).
 * - `cartao` vira `credit_card` e `boleto` vira `bank_slip` — são os valores
 *   que o painel e o app já esperam.
 * - Qualquer outra coisa (inclusive o JSON do gateway) vira o método
 *   normalizado, que tem no maximo 11 caracteres.
 */
export function metodoPagamentoSeguro(
  raw?: unknown,
  anterior?: string | null
): string | null {
  const bruto = typeof raw === "string" ? raw.trim() : "";
  if (!bruto) return anterior ?? null;

  if (bruto === "card") return METODO_CARTAO;
  if (bruto === "boleto") return METODO_BOLETO;
  if (bruto === METODO_PIX || bruto === METODO_CARTAO || bruto === METODO_BOLETO) {
    return bruto;
  }

  return normalizarMetodoPagamento(bruto);
}

/**
 * Garante que o texto cabe numa coluna VARCHAR(n).
 * Devolve `null` para valor vazio (para não gravar string vazia).
 */
export function limitarTexto(valor: unknown, max: number): string | null {
  if (valor === null || valor === undefined) return null;
  const s = String(valor).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}
