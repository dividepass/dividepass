/**
 * Teste da normalização do método de pagamento.
 *
 * Reproduz o bug de 06->07/11/2026: a IO Pay devolve `payment_method` como
 * OBJETO (o cartão inteiro ou o BR Code do Pix). Esse objeto era gravado cru
 * em `payment_attempts` e depois repassado para
 * `user_subscriptions.payment_method` — VARCHAR(50) — derrubando a liberacao
 * do grupo DEPOIS do dinheiro cair.
 *
 *   node scripts/test-metodo-pagamento.ts
 */
import {
  metodoPagamentoSeguro,
  normalizarMetodoPagamento,
  limitarTexto,
} from "../supabase/functions/_shared/metodo-pagamento.ts";

let passou = 0;
let falhou = 0;

function ok(nome: string, condicao: boolean, detalhe = "") {
  if (condicao) {
    passou++;
    console.log(`ok    ${nome}`);
  } else {
    falhou++;
    console.log(`FALHA ${nome}${detalhe ? ` - ${detalhe}` : ""}`);
  }
}

// ── O caso real: o objeto do cartão (489 chars) ────────────────────────────
const CARTAO_IO_PAY = {
  resource: "card",
  id: "3179dfb32c4848789ab27854a21a67aa",
  card_brand: "MasterCard",
  first4_digits: "5502",
  last4_digits: "8433",
  expiration_month: "4",
  expiration_year: "34",
  holder_name: "PEDRO H M FONSECA",
  is_active: true,
  is_verified: false,
  verification_checklist: {
    postal_code_check: false,
    security_code_check: true,
    address_line1_check: false,
    ip_check: false,
  },
  customer: "82f985362fd448ab83d31baa757aa1bc",
  fingerprint: "efad4d4499f603985e067f7f736104cdbdae9c8d",
};

// ── O caso real: o BR Code do Pix (533 chars) ─────────────────────────────
const PIX_IO_PAY = {
  id: "a2e993e2f95844c096e298ceaa614c10",
  resource: "pix",
  provider: "d3857768c70ca58c80ed5f56894092442ab45e77:Z",
  version: "3.1.0",
  type: "DYNAMIC",
  reusable: false,
  allow_update: false,
  expiration_date: "2026-12-18 12:59:45",
  qr_code: {
    emv: "00020101021226850014br.gov.bcb.pix2563qrcode.zoop.com.br/dynamic/029d385a-86c6-4616-b0c3-b609c33ff9065204000053039865802BR5925IFOOD PAGO INSTITUICAO DE6009Sao Paulo610901227-20062070503***63044402",
  },
  qr_code_url: "https://api.iopay.com.br/api/pix/qrcode/a2e993e2f95844c096e298ceaa614c10",
};

// ── O JSON que estava gravado no banco (texto) ────────────────────────────
const JSON_CARTAO_TEXTO = JSON.stringify(CARTAO_IO_PAY);
const JSON_PIX_TEXTO = JSON.stringify(PIX_IO_PAY);

ok("o objeto do cartão cabe em 50 chars depois de normalizado",
  normalizarMetodoPagamento(CARTAO_IO_PAY).length <= 50,
  normalizarMetodoPagamento(CARTAO_IO_PAY));
ok("cartão do IO Pay -> credit_card",
  normalizarMetodoPagamento(CARTAO_IO_PAY) === "credit_card");
ok("BR Code do Pix -> pix",
  normalizarMetodoPagamento(PIX_IO_PAY) === "pix");
ok("JSON do cartão (texto) -> credit_card",
  normalizarMetodoPagamento(JSON_CARTAO_TEXTO) === "credit_card");
ok("JSON do Pix (texto) -> pix",
  normalizarMetodoPagamento(JSON_PIX_TEXTO) === "pix");
ok("texto 'pix' -> pix", normalizarMetodoPagamento("pix") === "pix");
ok("texto 'card' -> credit_card", normalizarMetodoPagamento("card") === "credit_card");
ok("texto 'credit_card' -> credit_card",
  normalizarMetodoPagamento("credit_card") === "credit_card");
ok("texto 'boleto' -> bank_slip", normalizarMetodoPagamento("boleto") === "bank_slip");
ok("texto 'bank_slip' -> bank_slip", normalizarMetodoPagamento("bank_slip") === "bank_slip");
ok("vazio -> credit_card (fallback)", normalizarMetodoPagamento("") === "credit_card");

// ── O que realmente vai para a coluna ────────────────────────────────────
const col1 = metodoPagamentoSeguro(JSON_CARTAO_TEXTO);
ok("metodoPagamentoSeguro(JSON do cartão) -> credit_card", col1 === "credit_card", String(col1));
ok("metodoPagamentoSeguro(JSON do cartão) cabe em 50", (col1?.length ?? 0) <= 50);
const col2 = metodoPagamentoSeguro(JSON_PIX_TEXTO);
ok("metodoPagamentoSeguro(JSON do pix) -> pix", col2 === "pix", String(col2));
ok("metodoPagamentoSeguro(undefined) -> null (coluna fica vazia)",
  metodoPagamentoSeguro(undefined) === null);
ok("metodoPagamentoSeguro('', 'credit_card') -> credit_card (preserva o anterior)",
  metodoPagamentoSeguro("", "credit_card") === "credit_card");
ok("metodoPagamentoSeguro('card') -> credit_card", metodoPagamentoSeguro("card") === "credit_card");
ok("metodoPagamentoSeguro('boleto') -> bank_slip", metodoPagamentoSeguro("boleto") === "bank_slip");

// ── limitarTexto (billing_cycle e companhia) ───────────────────────────────
ok("limitarTexto corta em 20", (limitarTexto("a".repeat(50), 20) || "").length === 20);
ok("limitarTexto devolve null para vazio", limitarTexto("", 20) === null);
ok("limitarTexto devolve null para null", limitarTexto(null, 20) === null);
ok("limitarTexto preserva texto curto", limitarTexto("monthly", 20) === "monthly");

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
