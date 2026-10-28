const PHONE_DIGITS = 11;

/**
 * Remove tudo que não é dígito.
 * Use antes de enviar para o backend, já que o input é controlado pela máscara.
 */
export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '');

/**
 * Máscara de celular brasileiro: (00) 00000-0000
 * - ignora letras e qualquer caractere não numérico
 * - trava em 11 dígitos, então não aceita número a mais
 * - funciona colando texto com pontuação já existente
 */
export function maskPhone(value) {
  const digits = onlyDigits(value).slice(0, PHONE_DIGITS);

  if (digits.length <= 2) return digits.length ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

/**
 * Dígitos sem máscara, com o código do país, para links de WhatsApp.
 * null quando não há número utilizável.
 *
 * O onboarding grava o número como o usuário digitou (DDD + 8/9 dígitos, sem
 * o 55), mas a coluna também aceita o formato com DDI. `startsWith('55')` não
 * serve para decidir: DDD 55 (55123456789) começa com "55" e é número
 * nacional. O que separa os dois casos é o TAMANHO.
 */
export function phoneToWhatsApp(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  // 12 ou 13 dígitos: já vem com DDI (55 + DDD + 8/9).
  if (digits.length >= 12) return digits;
  // 10 ou 11 dígitos: número nacional — falta o código do país.
  return `55${digits}`;
}

/**
 * Só o número nacional (sem o 55), para exibir mascarado.
 * Vazio quando não há número.
 */
export function phoneToNational(value) {
  const digits = onlyDigits(value);
  if (!digits) return '';
  if (digits.length >= 12 && digits.startsWith('55')) return digits.slice(2);
  return digits;
}

/**
 * true quando o celular tem DDD + número (10 ou 11 dígitos).
 */
export const isValidPhone = (value) => {
  const digits = onlyDigits(value);
  return digits.length === 10 || digits.length === 11;
};