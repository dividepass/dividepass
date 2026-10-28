import { phoneToWhatsApp } from './maskPhone.js';

/**
 * Texto de abordagem no WhatsApp (voz do dono, do jeito que ele escreveu).
 * Os dois campos mudam por pessoa: o nome dela e as plataformas que ela
 * marcou no onboarding.
 */
export function buildLeadWhatsappMessage(name, plataformas) {
  const primeiroNome = (name || '').trim().split(' ')[0] || '';
  const lista = (plataformas || []).filter(Boolean);

  return [
    `Eai ${primeiroNome} tudo bem? Espero que esteja bem!`,
    'Me chamo Zeca Trabalho na *DividePass*.',
    lista.length
      ? `Vi que você demonstrou interesse em dividir as assinatura ${lista.join(', ')}.`
      : 'Vi que você demonstrou interesse em dividir assinaturas.',
    'Queria te ajudar a entender melhor! você tem alguma duvido? eu posso ver o grupo aqui, Se fizer sentido para você claro.',
    'Me responda quando puder.',
  ].join('\n');
}

/**
 * Link de WhatsApp já com o texto pronto. Devolve null quando o telefone não
 * existe ou não é válido — o botão some em vez de abrir uma conversa quebrada.
 */
export function buildLeadWhatsappUrl(phone, name, plataformas) {
  const numero = phoneToWhatsApp(phone);
  if (!numero) return null;

  // phoneToWhatsApp é tolerante (aceita qualquer coisa com dígito). Um
  // número curto não é telefone: o link abriria uma conversa quebrada, então
  // o botão não aparece.
  const local = numero.startsWith('55') ? numero.slice(2) : numero;
  if (local.length < 10) return null;

  const texto = buildLeadWhatsappMessage(name, plataformas);
  return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
}
