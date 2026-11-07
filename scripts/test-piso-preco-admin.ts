/**
 * Teste do piso de preço por vaga (R$ 5,00) e da exceção do ADMIN.
 *
 * A regra: o usuário comum não pode criar/ajustar um grupo com menos de
 * R$ 5,00 por vaga. O ADMIN da plataforma (users.role = 'admin') não passa
 * por essa regra — ele controla os grupos.
 *
 *   node scripts/test-piso-preco-admin.ts
 */
import {
  MIN_PRICE_PER_SLOT,
  platformFeePercent,
  simulatePrice,
  valorAbaixoDoMinimo,
} from "../src/lib/platformFee.js";

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

// ── O piso continua valendo para o usuário comum ─────────────────────────
ok("o piso é R$ 5,00", MIN_PRICE_PER_SLOT === 5, String(MIN_PRICE_PER_SLOT));
ok("usuário comum: R$ 4,99 é abaixo do mínimo",
  valorAbaixoDoMinimo(4.99, false) === true);
ok("usuário comum: R$ 5,00 não é abaixo do mínimo",
  valorAbaixoDoMinimo(5, false) === false);
ok("usuário comum: R$ 9,90 não é abaixo do mínimo",
  valorAbaixoDoMinimo(9.9, false) === false);
ok("usuário comum: R$ 1,00 é abaixo do mínimo",
  valorAbaixoDoMinimo(1, false) === true);
ok("valor zero não conta como abaixo do mínimo",
  valorAbaixoDoMinimo(0, false) === false);
ok("valor inválido não conta como abaixo do mínimo",
  valorAbaixoDoMinimo("abc", false) === false);

// ── O admin não passa pelo piso ──────────────────────────────────────────
ok("admin: R$ 4,99 NÃO é abaixo do mínimo",
  valorAbaixoDoMinimo(4.99, true) === false);
ok("admin: R$ 1,00 NÃO é abaixo do mínimo",
  valorAbaixoDoMinimo(1, true) === false);
ok("admin: R$ 0,01 NÃO é abaixo do mínimo",
  valorAbaixoDoMinimo(0.01, true) === false);
ok("admin sem o parâmetro explícito também passa (default = não admin)",
  valorAbaixoDoMinimo(4.99) === true);

// ── A simulação respeita a exceção ──────────────────────────────────────
ok("simulatePrice: usuário comum marca abaixo do mínimo",
  simulatePrice(4.99).belowMinimum === true);
ok("simulatePrice: admin NÃO marca abaixo do mínimo",
  simulatePrice(4.99, true).belowMinimum === false);
ok("simulatePrice: R$ 10 nunca marca (acima do piso)",
  simulatePrice(10).belowMinimum === false);

// ── A margem continua a mesma nos dois casos ─────────────────────────────
const sComum = simulatePrice(4.99);
const sAdmin = simulatePrice(4.99, true);
ok("a margem não muda com a exceção do admin",
  sComum.percent === sAdmin.percent, `${sComum.percent} vs ${sAdmin.percent}`);
ok("a taxa não muda com a exceção do admin",
  sComum.platformFee === sAdmin.platformFee);
ok("a faixa de R$ 4,99 é a de 50%", platformFeePercent(4.99) === 50);
ok("a faixa de R$ 10 é a de 40%", platformFeePercent(10) === 40);
ok("a faixa de R$ 20 é a de 35%", platformFeePercent(20) === 35);

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
