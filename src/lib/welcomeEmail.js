/**
 * Dispara o e-mail de boas-vindas do DividePass.
 *
 * POR QUE ISSO AQUI E NÃO NO CADASTRO DIRETO
 * ------------------------------------------
 * O Supabase exige confirmação de e-mail no cadastro, então no momento do
 * `signUp` a pessoa ainda NÃO tem sessão — e a função exige um token para
 * saber a quem enviar. Por isso o e-mail é disparado em dois momentos:
 *
 *   1) no `signIn` — a pessoa acabou de confirmar o e-mail e entrou. É o
 *      caminho principal, e o e-mail chega na hora.
 *   2) no `signUp` — se o Supabase devolver sessão já pronta (confirmação
 *      desativada), o e-mail sai ainda mais cedo.
 *
 * Se nenhum dos dois funcionan (e-mail de confirmação atrasou, chamada
 * bloqueada por rede), o job diário `send-lifecycle-emails` recupera: ele
 * envia as boas-vindas de quem se cadastrou e ainda não recebeu.
 *
 * A trava de duplicidade é o `dedup_key` (`welcome:<user_id>`) com índice
 * UNIQUE no banco — por isso os dois caminhos podem disparar à vontade que
 * o cliente recebe UM e-mail só.
 *
 * Fire and forget de propósito: o e-mail não pode travar o login nem a tela
 * de "Conta criada!".
 */
export function sendWelcomeEmail(accessToken) {
  if (!accessToken) return;

  const baseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

  if (!baseUrl) {
    console.warn('E-mail de boas-vindas: VITE_SUPABASE_URL não configurado.');
    return;
  }

  fetch(`${baseUrl}/functions/v1/send-welcome-email`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      ...(anonKey ? { apikey: anonKey } : {}),
    },
    body: JSON.stringify({}),
  })
    .then(async (res) => {
      if (!res.ok) {
        console.warn('E-mail de boas-vindas não dispatched:', res.status);
      }
    })
    .catch((err) => {
      // Silencioso de propósito: o job diário é a rede de segurança.
      console.warn('E-mail de boas-vindas não dispatched:', err?.message);
    });
}
