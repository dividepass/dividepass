/**
 * CPF — máscara e validação (lado do navegador).
 *
 * POR QUE O CHECKOUT PEDE O CPF
 * -----------------------------
 * A Woovi só cria uma ASSINATURA (Pix Automático) de um cliente que ela
 * consiga resolver pelo `taxID` (CPF). Sem CPF, a API responde:
 *
 *     POST /api/v1/subscriptions
 *     -> 400 {"error":"You need to inform a customer to create a subscription"}
 *
 * (Verificado na API em 07/11/2026.) A cobrança avulsa funciona sem CPF —
 * só o mandate (recorrência) exige.
 *
 * A validação é a oficial (dígitos verificadores, módulo 11): um mandate em
 * nome de outra pessoa é pior do que nenhum mandate.
 */

/** Só os dígitos. */
export function soDigitos(valor) {
  return String(valor ?? '').replace(/\D/g, '');
}

/** Formata enquanto o usuário digita: 000.000.000-00 */
export function mascararCpf(valor) {
  const d = soDigitos(valor).slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

/** CPF válido pelos dígitos verificadores. */
export function cpfValido(valor) {
  const d = soDigitos(valor);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;

  let soma = 0;
  for (let i = 0; i < 9; i++) soma += Number(d[i]) * (10 - i);
  let dv1 = (soma * 10) % 11;
  if (dv1 === 10) dv1 = 0;

  soma = 0;
  for (let i = 0; i < 10; i++) soma += Number(d[i]) * (11 - i);
  let dv2 = (soma * 10) % 11;
  if (dv2 === 10) dv2 = 0;

  return dv1 === Number(d[9]) && dv2 === Number(d[10]);
}
