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
 */
export function phoneToWhatsApp(value) {
  const digits = onlyDigits(value);
  if (!digits) return null;
  return digits.startsWith('55') ? digits : `55${digits}`;
}

/**
 * true quando o celular tem DDD + número (10 ou 11 dígitos).
 */
export const isValidPhone = (value) => {
  const digits = onlyDigits(value);
  return digits.length === 10 || digits.length === 11;
};