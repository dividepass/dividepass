/**
 * Máscara das chaves PIX (DividePass).
 *
 * A chave é escolhida pelo DONO do grupo e mostrada de novo para ele — no
 * formulário de gestão e no dropdown de saque. Deixar o campo livre faz o
 * usuário digitar "12345678900" num campo que deveria ser de CPF, e a chave
 * salva fica sem pontuação — o que não dá para conferir depois.
 *
 * A MÁSCARA é só de exibição: o que vai para o banco é o valor cru (só
 * dígitos no CPF/CNPJ/telefone), porque chave PIX é consumida por máquina.
 */

import { maskPhone, onlyDigits } from './maskPhone';

export const PIX_TYPE_OPTIONS = [
  { value: 'cpf', label: 'CPF', placeholder: '000.000.000-00' },
  { value: 'cnpj', label: 'CNPJ', placeholder: '00.000.000/0000-00' },
  { value: 'email', label: 'E-mail', placeholder: 'email@banco.com' },
  { value: 'phone', label: 'Telefone', placeholder: '(00) 00000-0000' },
  { value: 'random', label: 'Chave aleatória', placeholder: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' },
];

export const pixTypeLabel = (type) =>
  PIX_TYPE_OPTIONS.find(t => t.value === type)?.label || 'Chave PIX';

export const pixTypePlaceholder = (type) =>
  PIX_TYPE_OPTIONS.find(t => t.value === type)?.placeholder || 'chave pix do grupo';

/** Formata a chave conforme o tipo escolhido. */
export function maskPixKey(value, type) {
  const raw = String(value ?? '');

  if (type === 'cpf') {
    const d = onlyDigits(raw).slice(0, 11);
    if (d.length <= 3) return d;
    if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
    if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
    return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  }

  if (type === 'cnpj') {
    const d = onlyDigits(raw).slice(0, 14);
    if (d.length <= 2) return d;
    if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`;
    if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`;
    if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`;
    return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  }

  if (type === 'phone') return maskPhone(raw);

  // e-mail e chave aleatória não têm máscara.
  return raw;
}

/** Tira a máscara — é o valor que vai para o banco. */
export function unmaskPixKey(value, type) {
  const raw = String(value ?? '').trim();
  if (type === 'cpf' || type === 'cnpj' || type === 'phone') return onlyDigits(raw);
  return raw;
}

/** Troca a máscara quando o dono troca o tipo da chave. */
export function remaskPixKey(value, fromType, toType) {
  if (fromType === toType) return value;
  if (toType === 'email' || toType === 'random') {
    // Texto solto (e-mail) ou chave aleatória: joga fora a pontuação numérica.
    return toType === 'email' ? String(value ?? '').replace(/[^\w@.\-+]/g, '') : String(value ?? '').trim();
  }
  return maskPixKey(unmaskPixKey(value, fromType), toType);
}
