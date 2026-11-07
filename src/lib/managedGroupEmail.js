import { supabase } from './supabase';

/**
 * E-MAIL GERENCIADO PELA DIVIDEPASS (lado do cliente)
 *
 * O grupo pode ter uma caixa de e-mail EXCLUSIVA, criada pela plataforma no
 * servidor de e-mail. A IA dela busca o codigo de verificacao e entrega
 * pronto para o membro.
 *
 * Tres caminhos, todos com degradacao elegante (a feature simplesmente nao
 * aparece enquanto o banco/function nao existirem):
 *   - `buscarE-mailGerenciado`  le o e-mail do grupo (RPC do banco);
 *   - `provisionarE-mailGerenciado`  cria a caixa (edge function);
 *   - `e-mailGerenciadoDisponivel`  diz se a feature esta de pe.
 *
 * A senha IMAP do grupo NUNCA chega no navegador: a leitura passa por uma
 * funcao do banco que so devolve o endereco.
 */

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://lasoouwboxspstqvjbsv.supabase.co';
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_wEPiY05_TmJVND5a6D812g_9Mw-_LXR';

const EDGE_TIMEOUT_MS = 60000;

/** Cache da disponibilidade da feature (a RPC responde erro quando nao existe). */
let cacheDisponibilidade = null;

/**
 * Le o e-mail gerenciado do grupo.
 * @returns {Promise<{email: string, aiEnabled: boolean}|null>} null quando o
 *          grupo nao tem e-mail gerenciado (ou a feature ainda nao existe).
 */
export async function buscarEmailGerenciado(groupId) {
  if (!groupId) return null;

  try {
    const { data, error } = await supabase.rpc('group_managed_email', {
      p_group_id: groupId,
    });

    if (error) {
      // PGRST202 = funcao nao encontrada no banco (migration ainda nao rodou).
      if (error.code === 'PGRST202' || /function .* does not exist/i.test(error.message || '')) {
        cacheDisponibilidade = false;
      }
      return null;
    }

    const linha = Array.isArray(data) ? data[0] : data;
    if (!linha || !linha.email_address) return null;

    return {
      email: linha.email_address,
      aiEnabled: linha.ai_enabled !== false,
    };
  } catch {
    return null;
  }
}

/**
 * Cria (ou reaproveita) a caixa de e-mail gerenciada do grupo.
 * @returns {Promise<{success: boolean, email?: string, created?: boolean, error?: string}>}
 */
export async function provisionarEmailGerenciado(groupId) {
  if (!groupId) {
    return { success: false, error: 'Grupo não informado.' };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/provision-group-mailbox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({ group_id: groupId, action: 'provision' }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rawBody = await res.text();
    let json = null;
    if (rawBody.trim()) {
      try {
        json = JSON.parse(rawBody);
      } catch {
        json = null;
      }
    }

    if (!json) {
      return {
        success: false,
        error: res.status === 404
          ? 'A criação automática de e-mail ainda não está disponível na plataforma.'
          : `O servidor não respondeu de forma válida (HTTP ${res.status}).`,
      };
    }

    if (!res.ok || json.error) {
      return { success: false, error: json.error || `Falha ao criar o e-mail (HTTP ${res.status}).` };
    }

    cacheDisponibilidade = true;

    return {
      success: true,
      email: json.email || null,
      created: !!json.created,
    };
  } catch (err) {
    const isAbort = err?.name === 'AbortError';
    return {
      success: false,
      error: isAbort
        ? 'A criação do e-mail demorou demais. Tente de novo.'
        : (err?.message || 'Não foi possível falar com o servidor.'),
    };
  }
}

/**
 * Cadastra uma caixa de e-mail que o dono ja criou no painel do cPanel.
 * Usado enquanto a criacao automatica nao esta configurada na plataforma.
 * @param {string} groupId
 * @param {{email: string, password: string, imapServer?: string, imapPort?: number|string}} dados
 */
export async function registrarEmailGerenciado(groupId, dados) {
  if (!groupId) return { success: false, error: 'Grupo não informado.' };
  if (!dados?.email || !dados?.password) {
    return { success: false, error: 'Informe o e-mail e a senha da caixa.' };
  }

  try {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), EDGE_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(`${SUPABASE_URL}/functions/v1/provision-group-mailbox`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
          apikey: SUPABASE_KEY,
        },
        body: JSON.stringify({
          group_id: groupId,
          action: 'register',
          email: dados.email,
          password: dados.password,
          imap_server: dados.imapServer || undefined,
          imap_port: dados.imapPort || undefined,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }

    const rawBody = await res.text();
    let json = null;
    try {
      json = rawBody.trim() ? JSON.parse(rawBody) : null;
    } catch {
      json = null;
    }

    if (!json) {
      return {
        success: false,
        error: res.status === 404
          ? 'A criação automática de e-mail ainda não está disponível na plataforma.'
          : `O servidor não respondeu de forma válida (HTTP ${res.status}).`,
      };
    }

    if (!res.ok || json.error) {
      return { success: false, error: json.error || `Falha ao registrar a caixa (HTTP ${res.status}).` };
    }

    cacheDisponibilidade = true;
    return { success: true, email: json.email || dados.email, created: false };
  } catch (err) {
    return {
      success: false,
      error: err?.name === 'AbortError'
        ? 'O registro demorou demais. Tente de novo.'
        : (err?.message || 'Não foi possível falar com o servidor.'),
    };
  }
}

/**
 * A feature esta de pe? (a RPC do banco responde)
 * @returns {Promise<boolean>}
 */
export async function emailGerenciadoDisponivel() {
  if (cacheDisponibilidade !== null) return cacheDisponibilidade;
  try {
    const { error } = await supabase.rpc('group_managed_email', { p_group_id: null });
    // A funcao existe (nao erro de "function not found") -> feature disponivel.
    cacheDisponibilidade = !(error && (error.code === 'PGRST202' || /does not exist/i.test(error.message || '')));
  } catch {
    cacheDisponibilidade = false;
  }
  return cacheDisponibilidade;
}

/**
 * O banco respondeu que não conhece a coluna de busca de código (42703 /
 * PGRST204). Aí o insert/update do grupo é refeito sem o campo.
 */
export function isMissingEmailCodeColumn(error) {
  if (!error) return false;
  const texto = `${error.message || ''} ${error.details || ''} ${error.code || ''} ${error.hint || ''}`;
  return /email_code_enabled|email_code_method|managed_email/i.test(texto)
    && /(does not exist|nao existe|não existe|unknown column|PGRST204|42703)/i.test(texto);
}

/**
 * Monta o texto que o dono/membro precisa para trocar o e-mail da conta da
 * plataforma para o e-mail do grupo.
 */
export function instrucaoTrocaEmail(email, serviceName = 'a plataforma') {
  return [
    `Entre na sua conta do ${serviceName} com o e-mail e a senha que o grupo passou.`,
    'Vá em "Minha conta" (ou "Configurações da conta") e troque o e-mail para o e-mail do grupo abaixo.',
    'Salve. A partir daí, todo código que o serviço enviar chega nesta caixa — e a IA busca para você.',
  ];
}
