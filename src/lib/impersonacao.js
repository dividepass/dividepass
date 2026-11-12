/**
 * IMPERSONAÇÃO — o admin entra na conta do cliente para conferir o que
 * ele está vendo (suporte), sem saber a senha e sem alterar a senha.
 *
 * Como o fluxo funciona (resumo):
 *  1. o admin pede acesso à conta alvo (a edge gera um token de uso único);
 *  2. ANTES de trocar a sessão, a sessão do admin é guardada AQUI;
 *  3. o navegador troca a sessão para a do cliente;
 *  4. quando o admin quer voltar, `readAdminSession()` devolve a sessão
 *     guardada e o `supabase.auth.setSession()` recoloca o admin no lugar.
 *
 * POR QUE sessionStorage e não localStorage:
 * a sessão do admin é uma credencial de alto privilégio. No sessionStorage
 * ela morre junto com a aba — se o admin fechar o navegador no meio da
 * impersonação, o acesso de admin não fica guardado em disco na máquina
 * dele. O sessionStorage sobrevive a recarregamento da página (o que
 * acontece na troca de sessão), então a impersonação não se perde por causa
 * de um F5.
 */

export const IMPERSONATION_STORAGE_KEY = 'dividepass:impersonacao:admin';

/**
 * Marcador da impersonação em localStorage.
 *
 * É só um aviso — NENHUM token mora aqui. Ele existe para o caso em que o
 * admin fecha a aba no meio da impersonação: a sessão do admin (que vivia
 * no sessionStorage) morre com a aba, mas o navegador continua logado na
 * conta do CLIENTE. Sem esse marcador o admin abriria o site achando que
 * ainda é ele mesmo e mexeria na conta do cliente sem saber.
 */
const IMPERSONATION_MARKER_KEY = 'dividepass:impersonacao:marcador';

export function saveImpersonationMarker(info) {
  try {
    window.localStorage.setItem(
      IMPERSONATION_MARKER_KEY,
      JSON.stringify({
        admin_id: info?.admin_id || null,
        target_id: info?.target_id || null,
        target_name: info?.target_name || null,
        target_email: info?.target_email || null,
        at: new Date().toISOString(),
      })
    );
  } catch (e) {
    console.error('[impersonacao] não foi possível gravar o marcador:', e);
  }
}

export function readImpersonationMarker() {
  try {
    const raw = window.localStorage.getItem(IMPERSONATION_MARKER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.error('[impersonacao] marcador ilegível:', e);
    return null;
  }
}

export function clearImpersonationMarker() {
  try {
    window.localStorage.removeItem(IMPERSONATION_MARKER_KEY);
  } catch (e) {
    console.error('[impersonacao] falha ao limpar o marcador:', e);
  }
}


/**
 * Guarda a sessão do admin (access_token + refresh_token) junto com os
 * dados de quem está sendo impersonado.
 *
 * @param {object} session  sessão do admin vinda do `supabase.auth.getSession()`
 * @param {object} info     { admin_id, admin_email, target_id, target_name, target_email }
 */
export function saveAdminSession(session, info) {
  if (!session?.access_token || !session?.refresh_token) return null;

  const payload = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    admin_id: info?.admin_id || null,
    admin_email: info?.admin_email || null,
    target_id: info?.target_id || null,
    target_name: info?.target_name || null,
    target_email: info?.target_email || null,
    saved_at: new Date().toISOString(),
  };

  try {
    window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(payload));
    return payload;
  } catch (e) {
    // Navegador em modo privado / storage bloqueado: sem sessão guardada o
    // admin não consegue voltar, então a impersonação nem deve começar.
    console.error('[impersonacao] não foi possível guardar a sessão do admin:', e);
    return null;
  }
}

/** Lê a sessão do admin guardada (ou null se não houver). */
export function readAdminSession() {
  try {
    const raw = window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.access_token || !parsed?.refresh_token) return null;
    return parsed;
  } catch (e) {
    console.error('[impersonacao] sessão do admin ilegível:', e);
    return null;
  }
}

/** Apaga a sessão do admin guardada (volta ao normal / logout). */
export function clearAdminSession() {
  try {
    window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY);
  } catch (e) {
    console.error('[impersonacao] falha ao limpar a sessão do admin:', e);
  }
}
