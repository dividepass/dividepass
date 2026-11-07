// ============================================================================
// CPF — validação e normalização
//
// POR QUE EXISTE
// --------------
// A Woovirecusa criar uma ASSINATURA (Pix Automático) quando o cliente não tem
// `taxID` (CPF/CNPJ):
//
//     POST /api/v1/subscriptions
//     -> 400 {"error":"You need to inform a customer to create a subscription"}
//
// (Verificado na API em 07/11/2026 — sandbox e produção.)
//
// A cobrança avulsa (`POST /api/v1/charge`) funciona sem CPF; só o mandate
// exige. Por isso o CPF é obrigatório só nos fluxos com recorrência.
//
// COMO A API RESOLVE O CLIENTE
// ----------------------------
// O `customer` enviado na assinatura NÃO é um objeto livre: a API procura o
// cliente pelo `taxID`. Se ela não encontra ninguém com aquele CPF, devolve o
// 400 acima. Por isso o CPF precisa bater com o dono do pagamento.
//
// DÍGITOS VERIFICADORES
// ---------------------
// O CPF tem 11 dígitos: os 9 primeiros são a base e os 2 últimos são o
// dígito verificador (módulo 11). A validação aqui é a oficial — sem ela, um
// CPF digitado errado viraria um mandate em nome de outra pessoa.
// ============================================================================

/** Só os dígitos de uma string. */
export function soDigitos(valor: string | null | undefined): string {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Valida um CPF pelos dígitos verificadores.
 *
 * Rejeita: menos/mais de 11 dígitos, todos os dígitos iguais (111.111.111-11
 * passa no cálculo mas não existe) e dígito verificador errado.
 */
export function cpfValido(cpf: string | null | undefined): boolean {
  const digitos = soDigitos(cpf);
  if (digitos.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digitos)) return false;

  // 1º dígito: pesos 10..2
  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(digitos[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;

  // 2º dígito: pesos 11..2
  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(digitos[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;

  return dv1 === Number(digitos[9]) && dv2 === Number(digitos[10]);
}

/**
 * Formata o CPF no padrão do Brasil: 000.000.000-00.
 *
 * A máscara é PROGRESSIVA (enquanto o usuário digita): 6 dígitos já viram
 * "313.242". É a mesma regra do `src/lib/cpf.js` — as duas implementações
 * precisam concordar (há teste em `scripts/test-cpf.ts`).
 */
export function mascararCpf(cpf: string | null | undefined): string {
  const d = soDigitos(cpf).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/**
 * De onde vem o CPF do mandate.
 *
 * - `cpf`       o CPF a usar (null = não há nenhum);
 * - `origem`    de onde ele veio;
 * - `divergente` o pedido trouxe um CPF DIFERENTE do que está no perfil;
 * - `perfilInvalido` o perfil tem algo gravado que não é um CPF válido.
 */
export type CpfEscolhido = {
  cpf: string | null;
  origem: "perfil" | "checkout" | null;
  divergente: boolean;
  perfilInvalido: boolean;
};

/**
 * ESCOLHE O CPF DO MANDATE.
 *
 * A REGRA: o CPF CADASTRADO NO PERFIL MANDA.
 *
 * Quem já cadastrou o CPF não pode ser obrigado a digitar de novo a cada
 * compra — e o que vem no pedido NUNCA sobrescreve o que está no perfil. Um
 * mandate em nome de outra pessoa é pior do que nenhum mandate: o CPF é o
 * que amarra a cobrança recorrente a uma conta específica.
 *
 * Quem NÃO tem CPF no perfil usa o que digitou no checkout (e ele é gravado
 * no perfil para a próxima compra não perguntar de novo).
 *
 * Se o perfil tem algo que não é um CPF válido (digitado errado em outro
 * momento), ele é tratado como se não houvesse — o CPF novo do checkout
 * vale e corrige o perfil.
 */
export function escolherCpf(
  cpfDoPerfil: string | null | undefined,
  cpfInformado: string | null | undefined,
): CpfEscolhido {
  const perfil = soDigitos(cpfDoPerfil);
  const informado = soDigitos(cpfInformado);

  const perfilValido = perfil.length === 11 && cpfValido(perfil);
  if (perfilValido) {
    return {
      cpf: perfil,
      origem: "perfil",
      divergente: Boolean(informado && informado !== perfil),
      perfilInvalido: false,
    };
  }

  if (informado) {
    return {
      cpf: informado,
      origem: "checkout",
      divergente: false,
      perfilInvalido: Boolean(perfil),
    };
  }

  return { cpf: null, origem: null, divergente: false, perfilInvalido: Boolean(perfil) };
}
