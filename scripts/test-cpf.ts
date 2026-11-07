/**
 * Teste da validação de CPF (backend + frontend).
 *
 * POR QUE EXISTE
 * --------------
 * A Woovi só cria a ASSINATURA (Pix Automático) de um cliente que ela consiga
 * resolver pelo `taxID` (CPF). Sem CPF:
 *
 *     POST /api/v1/subscriptions
 *     -> 400 {"error":"You need to inform a customer to create a subscription"}
 *
 * (Verificado na API em 07/11/2026.) Antes disso, o código caía no fallback
 * e gerava um PIX AVULSO — o usuário pagava uma vez e nunca mais era
 * cobrado, achando que tinha assinado uma assinatura recorrente.
 *
 * Um CPF errado é pior que nenhum: o mandate nasceria em nome de outra
 * pessoa. Por isso a validação é a oficial (dígitos verificadores).
 *
 *   node scripts/test-cpf.ts
 */
import {
  cpfValido as cpfValidoBackend,
  soDigitos as soDigitosBackend,
  mascararCpf as mascararCpfBackend,
  escolherCpf,
} from "../supabase/functions/_shared/cpf.ts";
import {
  cpfValido as cpfValidoFront,
  mascararCpf as mascararCpfFront,
  soDigitos as soDigitosFront,
} from "../src/lib/cpf.js";

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

// ── CPFs válidos de teste ──────────────────────────────────────────────────
// 111.444.777-35 e 313.242.270-36 são os dois com dígitos verificadores
// corretos (o segundo é o cliente de teste que existe no sandbox da Woovi).
const VALIDOS = ["11144477735", "31324227036", "111.444.777-35", "313.242.270-36"];

const INVALIDOS = [
  ["11144477734", "dígito verificador errado"],
  ["1114447773", "10 dígitos"],
  ["111444777356", "12 dígitos"],
  ["11111111111", "todos iguais"],
  ["00000000000", "zeros"],
  ["", "vazio"],
  ["abcdefghijk", "letras"],
  ["1234567890", "10 dígitos"],
];

for (const cpf of VALIDOS) {
  ok(`backend aceita ${cpf}`, cpfValidoBackend(cpf));
  ok(`front aceita ${cpf}`, cpfValidoFront(cpf));
}

for (const [cpf, motivo] of INVALIDOS) {
  ok(`backend recusa ${motivo} (${cpf || "(vazio)"})`, !cpfValidoBackend(cpf));
  ok(`front recusa ${motivo} (${cpf || "(vazio)"})`, !cpfValidoFront(cpf));
}

// ── Normalização ───────────────────────────────────────────────────────────
ok("soDigitos tira tudo que não é número", soDigitosBackend("313.242.270-36") === "31324227036");
ok("soDigitos do front é igual", soDigitosFront("313.242.270-36") === "31324227036");
ok("soDigitos de null não quebra", soDigitosBackend(null) === "" && soDigitosBackend(undefined) === "");

// ── Máscara ────────────────────────────────────────────────────────────────
ok("máscara no padrão do Brasil", mascararCpfBackend("31324227036") === "313.242.270-36");
ok("máscara do front é igual", mascararCpfFront("31324227036") === "313.242.270-36");
ok("máscara parcial: 3 dígitos", mascararCpfBackend("313") === "313");
ok("máscara parcial: 6 dígitos", mascararCpfBackend("313242") === "313.242");
ok("máscara parcial: 9 dígitos", mascararCpfBackend("313242270") === "313.242.270");
ok("máscara ignora o que passa de 11", mascararCpfBackend("313242270369999") === "313.242.270-36");

// ── As duas implementações precisam concordar ──────────────────────────────
const amostras = [...VALIDOS, ...INVALIDOS.map(([c]) => c), "313.242.270-36", "1", "3132422703"];
let divergentes = 0;
for (const cpf of amostras) {
  if (cpfValidoBackend(cpf) !== cpfValidoFront(cpf)) divergentes++;
  if (mascararCpfBackend(cpf) !== mascararCpfFront(cpf)) divergentes++;
}
ok("backend e front concordam em todas as amostras", divergentes === 0, `${divergentes} divergências`);

// ── ESCOLHER DE ONDE VEM O CPF ─────────────────────────────────────────────
// A REGRA: o CPF CADASTRADO NO PERFIL MANDA. Quem já cadastrou não digita de
// novo, e o que vem no pedido nunca sobrescreve o perfil (um mandate em nome
// de outra pessoa é pior do que nenhum mandate).
const CPF_VALIDO = "31324227036";
const OUTRO_VALIDO = "11144477735";

{
  // Perfil com CPF válido, pedido vazio.
  const e = escolherCpf(CPF_VALIDO, "");
  ok("perfil com CPF: usa o do perfil", e.cpf === CPF_VALIDO && e.origem === "perfil");
  ok("perfil com CPF: não é divergente", e.divergente === false);
  ok("perfil com CPF: perfil não é inválido", e.perfilInvalido === false);
}
{
  // Perfil com CPF válido, pedido com o MESMO CPF.
  const e = escolherCpf(CPF_VALIDO, `313.242.270-36`);
  ok("mesmo CPF nos dois lados: usa o perfil", e.cpf === CPF_VALIDO && e.origem === "perfil");
  ok("mesmo CPF nos dois lados: não é divergente", e.divergente === false);
}
{
  // Perfil com CPF válido, pedido com OUTRO CPF (divergente).
  const e = escolherCpf(CPF_VALIDO, OUTRO_VALIDO);
  ok("CPF divergente: o PERFIL vence", e.cpf === CPF_VALIDO && e.origem === "perfil");
  ok("CPF divergente: sinaliza a divergência", e.divergente === true);
}
{
  // Perfil sem CPF, pedido com CPF válido.
  const e = escolherCpf(null, OUTRO_VALIDO);
  ok("sem CPF no perfil: usa o do checkout", e.cpf === OUTRO_VALIDO && e.origem === "checkout");
  ok("sem CPF no perfil: não é divergente", e.divergente === false);
}
{
  // Perfil vazio (string vazia) e pedido vazio.
  const e = escolherCpf("", "");
  ok("nada em lugar nenhum: não há CPF", e.cpf === null && e.origem === null);
  ok("nada em lugar nenhum: perfil não é inválido", e.perfilInvalido === false);
}
{
  // Perfil com LIXO (CPF inválido gravado) e pedido com CPF válido: o do
  // checkout vale e corrige o perfil.
  const e = escolherCpf("11111111111", OUTRO_VALIDO);
  ok("perfil com lixo: usa o CPF do checkout", e.cpf === OUTRO_VALIDO && e.origem === "checkout");
  ok("perfil com lixo: sinaliza o perfil inválido", e.perfilInvalido === true);
}
{
  // Perfil com lixo e NADA no pedido: não há CPF (e o perfil está sujo).
  const e = escolherCpf("11111111111", null);
  ok("perfil com lixo e sem pedido: não há CPF", e.cpf === null && e.origem === null);
  ok("perfil com lixo e sem pedido: sinaliza o perfil inválido", e.perfilInvalido === true);
}
{
  // A máscara do perfil não atrapalha.
  const e = escolherCpf("313.242.270-36", "");
  ok("perfil mascarado: normaliza", e.cpf === CPF_VALIDO && e.origem === "perfil");
}

console.log(`\n${passou} passou | ${falhou} falhou`);
if (falhou > 0) process.exit(1);
