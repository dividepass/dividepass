/**
 * Classificação do e-mail do grupo: o que é RESTRIÇÃO (não pode virar
 * código nem botão) e o que é código de verdade.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REGRA (pedido do produto) — vale para QUALQUER plataforma
 * ─────────────────────────────────────────────────────────────────────
 * 1. Primeiro se LÊ O E-MAIL. Se ele está PEDINDO para trocar dados
 *    sensíveis da conta — senha, e-mail da conta, cartão de crédito /
 *    forma de pagamento — ou avisando que a conta está bloqueada/suspensa,
 *    o e-mail é RESTRIÇÃO: nada dele é mostrado ao grupo.
 *
 * 2. Se o e-mail NÃO é nada disso, ele NÃO é restrição. Aí, nesta ordem:
 *    a) tem CÓDIGO (ou token) no texto? → o código é mostrado;
 *    b) tem BOTÃO que direciona para a plataforma? → o botão é mostrado.
 *
 * ─────────────────────────────────────────────────────────────────────
 * SÓ CONTA PEDIDO, NÃO CONTA MENÇÃO
 * ─────────────────────────────────────────────────────────────────────
 * Quase todo e-mail de segurança traz no rodapé uma DICA: "Você também pode
 * alterar a senha", "recomendamos desconectar os aparelhos
 * desconhecidos". Isso NÃO é pedido de troca de senha — e era exatamente
 * isso que escondia o botão "Receber código" da Netflix atrás do aviso de
 * PIN.
 *
 * Por isso as regras de CORPO exigem PEDIDO: verbo no imperativo
 * ("redefina sua senha"), forma nominal ("redefinição de senha"),
 * "esqueceu sua senha", confirmação de que o dado FOI trocado, ou um
 * verbo de ação colado no infinitivo ("clique para alterar a senha").
 * A dica do rodapé, que vem em frase solta, não casaria com nada disso.
 *
 * ─────────────────────────────────────────────────────────────────────
 * POR QUE O TEXTO VISÍVEL
 * ─────────────────────────────────────────────────────────────────────
 * A checagem roda sobre o TEXTO VISÍVEL do e-mail (sem <style>, sem
 * <script>, sem <head>). O e-mail da Netflix não tem parte "plain" limpa:
 * o corpo chegava como HTML sem tags, mas COM o CSS dentro. E o CSS da
 * Netflix traz uma classe chamada "suspended" — que casava com a regra de
 * "conta bloqueada".
 *
 * A mesma lógica vale para o código: o número procurado nunca pode ser
 * uma data, um horário, um ano ou o token dentro de uma URL.
 */

/** Categoria de e-mail que não pode virar código/botão do grupo. */
export interface Restricao {
  tipo: string;
  mensagem: string;
}

interface RegraRestricao {
  tipo: string;
  /** Padrão do ASSUNTO: o assunto é curto, então o tema basto já decide. */
  assunto: RegExp;
  /** Padrão do CORPO: exige PEDIDO explícito, não menção em dica de rodapé. */
  corpo: RegExp;
  mensagem: string;
}

const REGRAS: RegraRestricao[] = [
  {
    tipo: "senha",
    assunto:
      /(?:redefini[çc][ãa]o|recupera[çc][ãa]o|altera[çc][ãa]o|mudan[çc]a|troca|atualiza[çc][ãa]o|cria[çc][ãa]o|reset)\s+(?:de\s+|da\s+)?(?:sua\s+|minha\s+)?senha|senha\s+(?:foi|acaba\s+de\s+ser|acabou\s+de\s+ser|expirou|venceu)\s+(?:alterada|trocada|redefinida|atualizada|mudada|resetada|expirada)?|(?:sua|a)\s+senha\s+(?:foi|expirou)|(?:nova|redefini[çc][ãa]o)\s+senha|password\s*(?:reset|change|changed|update|updated|expired|recovery)|(?:reset|change|update|forgot|recover)\s+(?:your\s+|the\s+|a\s+|minha\s+|sua\s+)?password/i,
    corpo:
      /(?:redefina|defina|crie|altere|troque|mude|atualize|esqueceu|esqueci|resetou|recuperou)\s+(?:a\s+|o\s+|sua\s+|seu\s+|minha\s+)?(?:nova\s+|nova\s+)?senha|(?:clique|toque|selecione|pressione|use\s+o\s+bot[ãa]o|acesse|v[áa]|enter|tap|click)[\s\S]{0,60}?(?:redefinir|definir|criar|alterar|trocar|mudar|atualizar)\s+(?:a\s+|sua\s+|uma\s+|nova\s+)?senha|(?:redefini[çc][ãa]o|altera[çc][ãa]o|mudan[çc]a|troca|atualiza[çc][ãa]o|cria[çc][ãa]o|solicita[çc][ãa]o)\s+de\s+(?:redefinir\s+)?(?:sua\s+|minha\s+)?senha|(?:sua\s+|a\s+)?senha\s+(?:foi|acaba\s+de\s+ser|acabou\s+de\s+ser)\s+(?:alterada|trocada|redefinida|atualizada|mudada|resetada)|(?:sua\s+)?senha\s+(?:expirou|venceu|expirada)|(?:your|the|a)\s+(?:new\s+)?password\s+(?:has\s+been\s+)?(?:been\s+)?(?:reset|changed|updated|expired)|(?:reset|change|update|create|set|forgot)\s+(?:your\s+|the\s+|a\s+)?(?:new\s+)?password|password\s+(?:reset|change|update|recovery|expiration)|nova\s+senha|new\s+password/i,
    mensagem:
      "Este e-mail é de redefinição/alteração de senha. Por segurança, não é possível exibir o código.",
  },
  {
    tipo: "email",
    assunto:
      /(?:altera[çc][ãa]o|troca|mudan[çc]a|atualiza[çc][ãa]o|confirma[çc][ãa]o|verifica[çc][ãa]o)\s+(?:de\s+|do\s+|de\s+seu\s+)?(?:e[- ]?mail|endere[çc]o\s+de\s+e[- ]?mail)|(?:change|update|confirm|verify)\s+(?:your\s+|the\s+|a\s+)?(?:new\s+)?e-?mail/i,
    corpo:
      /(?:altere|troque|mude|atualize|confirme|verifique|adicione)\s+(?:o\s+|a\s+|seu\s+|sua\s+)?(?:novo\s+)?(?:endere[çc]o\s+de\s+)?e-?mail|(?:clique|toque|selecione|acesse|v[áa]|enter|tap|click)[\s\S]{0,60}?(?:alterar|trocar|mudar|atualizar|confirmar|verificar)\s+(?:o\s+|seu\s+|este\s+|novo\s+)?(?:endere[çc]o\s+de\s+)?e-?mail|(?:altera[çc][ãa]o|troca|mudan[çc]a|atualiza[çc][ãa]o|solicita[çc][ãa]o|confirma[çc][ãa]o)\s+(?:de\s+|do\s+|no\s+)(?:seu\s+|minha\s+)?(?:e[- ]?mail|endere[çc]o\s+de\s+e[- ]?mail)|(?:seu|o)\s+(?:endere[çc]o\s+de\s+)?e-?mail\s+(?:foi|acaba\s+de\s+ser)\s+(?:alterado|trocado|mudado|atualizado|confirmado)|(?:your|the|a)\s+(?:new\s+)?e-?mail\s+(?:address\s+)?(?:has\s+been\s+)?(?:been\s+)?(?:changed|updated|confirmed)|(?:change|update|confirm|verify)\s+(?:your\s+|the\s+|a\s+)?(?:new\s+)?(?:e-?mail|email\s+address)|new\s+(?:e-?mail\s+)?address/i,
    mensagem:
      "Este e-mail é de alteração de e-mail da conta. Por segurança, não é possível exibir o código.",
  },
  {
    tipo: "pagamento",
    assunto:
      /cart[ãa]o(?:\s+de\s+cr[ée]dito)?|credit\s+card|cart[ãa]o\s+recusado|dados\s+de\s+pagamento|forma\s+de\s+pagamento|m[ée]todo\s+de\s+pagamento|endere[çc]o\s+de\s+cobran[çc]a|pagamento\s+(?:recusado|negado|falhou|expirado|pendente)|cobran[çc]a\s+(?:recusada|falhou)|payment\s+(?:declined|failed|expired)|billing|fatura|invoice/i,
    corpo:
      /(?:atualize|adicione|troque|mude|altere|confirme|cadastre)\s+(?:o\s+|um\s+|seu\s+|sua\s+|uma\s+)?(?:novo\s+)?(?:cart[ãa]o|forma\s+de\s+pagamento|dados\s+de\s+pagamento|m[ée]todo\s+de\s+pagamento|endere[çc]o\s+de\s+cobran[çc]a)|(?:clique|toque|selecione|acesse|v[áa]|enter|tap|click)[\s\S]{0,60}?(?:atualizar|adicionar|trocar|mudar|alterar|confirmar|cadastrar)\s+(?:o\s+|um\s+|seu\s+|sua\s+)?(?:cart[ãa]o|forma\s+de\s+pagamento|dados\s+de\s+pagamento|m[ée]todo\s+de\s+pagamento|endere[çc]o\s+de\s+cobran[çc]a)|(?:cart[ãa]o|forma\s+de\s+pagamento|dados\s+de\s+pagamento|m[ée]todo\s+de\s+pagamento|cobran[çc]a|pagamento)\W{0,30}(?:recusad\w+|expirad\w+|vencid\w+|inv[áa]lid\w+|falhou|negad\w+|pendente)|(?:recusad\w+|expirad\w+|vencid\w+|inv[áa]lid\w+|negad\w+)\W{0,30}(?:cart[ãa]o|forma\s+de\s+pagamento|pagamento|cobran[çc]a)|(?:atualiza[çc][ãa]o|troca|mudan[çc]a|altera[çc][ãa]o|adicionar|inclus[ãa]o)\s+(?:de\s+|do\s+|da\s+|de\s+sua\s+)?(?:cart[ãa]o|forma\s+de\s+pagamento|dados\s+de\s+pagamento|m[ée]todo\s+de\s+pagamento|pagamento)|(?:update|add|change|verify|confirm)\s+(?:your\s+|a\s+|the\s+)?(?:new\s+)?(?:credit\s+card|payment\s+method|payment\s+information|billing|card|payment\s+details)|payment\s+(?:was\s+)?(?:declined|failed|expired|method\s+needs)|(?:your|the)\s+(?:credit\s+)?card\s+(?:was\s+)?(?:declined|expired|rejected)/i,
    mensagem:
      "Este e-mail é de alteração de pagamento (cartão/forma de pagamento). Por segurança, não é possível exibir o código.",
  },
  {
    tipo: "conta_bloqueada",
    assunto:
      /(?:conta|account)\s+(?:foi\s+|est[áa]\s+|ser[áa]\s+|seria\s+|parece\s+que\s+a\s+)?(?:bloqueada|suspensa|encerrada|desativada|desabilitada|limitada)|(?:suspended|locked|deactivated|disabled|restricted)\s+account|account\s+(?:has\s+been\s+|was\s+|is\s+)?(?:suspended|locked|deactivated|disabled|restricted)/i,
    corpo:
      /(?:sua\s+|a\s+)?conta\s+(?:foi\s+|est[áa]\s+|acaba\s+de\s+ser\s+|agora\s+está\s+)?(?:bloqueada|suspensa|suspensa|encerrada|desativada|desabilitada|limitada)|(?:suspended|locked|deactivated|disabled|restricted)\s+(?:your|the)\s+account|account\s+(?:has\s+been\s+|was\s+|is\s+)?(?:suspended|locked|deactivated|disabled|restricted)|(?:bloqueio|suspens[ãa]o|desativa[çc][ãa]o)\s+da\s+(?:sua\s+)?conta/i,
    mensagem:
      "Este e-mail avisa sobre restrição na conta. Por segurança, nada dele é exibido. Verifique com o administrador.",
  },
];

/**
 * Decide se o e-mail é RESTRIÇÃO.
 *
 * Só o que o e-mail ESCREVE decide — a IA não tem poder de bloqueio aqui
 * (ela marcava a dica de segurança do rodapé como "sensível").
 *
 * @param subject assunto do e-mail (já decodificado)
 * @param corpo   texto VISÍVEL do e-mail (ver `textoVisivel`)
 */
export function classificarRestricao(
  subject: string,
  corpo: string,
): Restricao | null {
  const s = subject || "";
  const c = corpo || "";

  // 1) Assunto: o tema do e-mail.
  for (const regra of REGRAS) {
    if (regra.assunto.test(s)) return { tipo: regra.tipo, mensagem: regra.mensagem };
  }

  // 2) Corpo: só vale se for um PEDIDO explícito.
  for (const regra of REGRAS) {
    if (regra.corpo.test(c)) return { tipo: regra.tipo, mensagem: regra.mensagem };
  }

  return null;
}

/** Tira <style>, <script> e <head> do HTML. */
export function limparHtml(html: string): string {
  let h = html || "";
  h = h.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ");
  h = h.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ");
  h = h.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, " ");
  return h;
}

/** Converte HTML em texto (mesma conversão do `stripHtml` da função). */
export function stripHtml(html: string): string {
  let t = html.replace(/<br\s*\/?>/gi, "\n");
  t = t.replace(/<\/p>/gi, "\n");
  t = t.replace(/<\/div>/gi, "\n");
  t = t.replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ");
  t = t.replace(/&amp;/g, "&");
  t = t.replace(/&lt;/g, "<");
  t = t.replace(/&gt;/g, ">");
  t = t.replace(/&quot;/g, '"');
  t = t.replace(/&#39;/g, "'");
  t = t.replace(/&#x27;/g, "'");
  t = t.replace(/&atilde;/g, "ã");
  t = t.replace(/&ccedil;/g, "ç");
  t = t.replace(/&otilde;/g, "õ");
  t = t.replace(/&aacute;/g, "á");
  t = t.replace(/&eacute;/g, "é");
  t = t.replace(/&iacute;/g, "í");
  t = t.replace(/&oacute;/g, "ó");
  t = t.replace(/&uacute;/g, "ú");

  // ENTIDADES NUMÉRICAS. Sem decodificar, "&#8199;" (espaço fino) virava o
  // número 8199 para o extrator de código — e o "código" do e-mail era
  // uma dessas sequências de preenchimento.
  const ponto = (cod: number): string => {
    try {
      return String.fromCodePoint(cod);
    } catch {
      return " ";
    }
  };
  t = t.replace(/&#x([0-9a-fA-F]{1,6});/g, (_m, h: string) => ponto(parseInt(h, 16)));
  t = t.replace(/&#(\d{1,7});/g, (_m, d: string) => ponto(parseInt(d, 10)));
  t = t.replace(/&(zwnj|zwj|shy|lrm|rlm|thinsp|ensp|emsp);/gi, " ");

  // Caracteres invisíveis (Disney/Netflix enchem o e-mail deles para
  // despistar filtro de spam): fora do texto.
  t = t.replace(/[\u00ad\u200b-\u200f\u202f\u2060\ufeff]/g, "");

  return t;
}

/**
 * Texto VISÍVEL do e-mail: sem CSS, sem script, sem <head>.
 *
 * Junta a parte "plain" (quando existe) com o HTML limpo — assim o botão
 * e o código aparecem mesmo quando o e-mail só veio em HTML.
 *
 * OS QUEBRAS DE LINHA FICAM DE PROPÓSITO: o código de verificação costuma
 * vir sozinho numa linha, e o extrator procura exatamente por isso. Colapsar
 * tudo em uma linha só (como fazia antes) matava essa regra.
 */
export function textoVisivel(html: string, plain: string): string {
  const doHtml = stripHtml(limparHtml(html || ""));
  const fonte = plain && plain.trim() ? plain : doHtml;
  return `${fonte}\n${doHtml}`
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Padrões de código com CONTEXTO (a palavra precisa estar colada no número). */
const CODE_PATTERNS: RegExp[] = [
  /c[oó]digo\s+de\s+(?:verifica[çc][ãa]o|valida[çc][ãa]|acesso)[:=\s]*(\d{4,8})/i,
  /verification\s+code[:=\s]*(\d{4,8})/i,
  /your\s+(?:verification\s+)?code[:=\s]*(\d{4,8})/i,
  /use\s+(?:this\s+)?code[:=\s]*(\d{4,8})/i,
  /seu\s+c[oó]digo[:=\s]*(\d{4,8})/i,
  /c[oó]digo[:=\s]*(\d{4,8})/i,
  /pin[:=\s]*(\d{4,8})/i,
  /(\d{4,8})\s+(?:is\s+your|for\s+your|é\s+seu|para\s+seu)/i,
  /enter\s+(\d{4,8})/i,
  /digite\s+(\d{4,8})/i,
  /insira\s+(\d{4,8})/i,
  /(?:your|seu|o\s+seu)\s+(?:code|c[oó]digo)\s+(?:is|é|e)[:=\s]*(\d{4,8})/i,
  /(?:access|invite)\s+(?:code|link)[:=\s]*(\d{4,8})/i,
  /(?:c[oó]digo|code)\s*(?:de|for)\s*(?:convite|invite|entry)[:=\s]*(\d{4,8})/i,
  // Token rotulado (alfanumérico). Ex.: "seu token de acesso: A7K9P2".
  /(?:token|senha\s+de\s+acesso|access\s+token|c[oó]digo\s+de\s+entrada)[:=\s]*([A-Z0-9]{4,12})/i,
];

/** Contexto que indica que o e-mail fala de código. */
const CONTEXTO_CODIGO =
  /(?:code|c[oó]digo|verify|verifica[çc][ãa]o|access|acesso|enter|digite|insira|use|utilize|token|senha)/i;

/** Remove números que NÃO são código: data, hora, ano, telefone, URL. */
function limparNumeros(texto: string): string {
  return texto
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/g, " ")
    .replace(/\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/g, " ")
    .replace(/\d{1,2}:\d{2}(?::\d{2})?/g, " ")
    .replace(/\d{1,2}\s+de\s+[a-zç]{3,}\.?(?:\s*,?\s*\d{0,2}\s*(?:hor[áa]rio\s+de\s+[^\s]{2,})?)?/gi, " ")
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/\d{1,2}\s+hor[áa]rio\s+de\s+[^\s]{2,}/gi, " ");
}

/**
 * Procura um número perto de uma palavra-chave.
 *
 * A versão antiga pegava o PRIMEIRO número de 4+ dígitos do e-mail: no
 * e-mail da Netflix isso era a data ("22 de novembro, 20:25") ou um
 * número do token da URL — e o botão acabava escondido.
 *
 * O recorte é `(?<![\w.-]) ... (?![\w.-])`: um código é um número SOLTO.
 * "5096137e" (pedaço de UUID), "9628-4775" (pedaço de GUID) e "653956AC"
 * (código de rastreamento) ficam de fora.
 */
function numeroPertoDaPalavra(texto: string, palavra: string, janela = 70): string | null {
  const kw = (palavra || "").trim().toLowerCase();
  if (!kw) return null;
  const lower = texto.toLowerCase();
  let idx = lower.indexOf(kw);
  while (idx !== -1) {
    const janelaTexto = texto.slice(Math.max(0, idx - janela), idx + kw.length + janela);
    const limpo = limparNumeros(janelaTexto);
    const m = limpo.match(/(?<![\w.\-])(\d{4,8})(?![\w.\-])/);
    if (m) return m[1];
    idx = lower.indexOf(kw, idx + kw.length);
  }
  return null;
}

/**
 * Palavras que, no e-mail de verificação, ficam COLADAS no código:
 * "Informe este código para entrar 2804", "digite o código 123456".
 * O número precisa estar no mesmo fôlego (70 caracteres) da palavra.
 */
const PALAVRAS_CODIGO = [
  "código",
  "codigo",
  "code",
  "token",
  "pin",
  "otp",
  "digite",
  "insira",
  "informe",
  "use este",
  "enter this",
  "verification",
  "verificação",
];

/**
 * Plausibilidade do código. "0000", "1111", "9999" são placeholders de
 * layout (CSS, máscara de telefone, exemplo), não código de verificação —
 * e já apareceram como resultado falso no lugar de "nenhum código".
 */
export function codigoPlausivel(codigo: string | null): boolean {
  const d = (codigo || "").replace(/\D/g, "");
  if (d.length < 4 || d.length > 8) return false;
  if (/^(\d)\1+$/.test(d)) return false;
  return true;
}

/**
 * Extrai o código (ou token) do texto do e-mail.
 *
 * @param corpo        texto visível do e-mail
 * @param opcoes.padroes        regexes extras configuradas pelo grupo
 * @param opcoes.palavrasChave   palavras-chave configuradas pelo grupo
 */
export function extrairCodigo(
  corpo: string,
  opcoes?: { padroes?: string[]; palavrasChave?: string[] },
): string | null {
  const texto = corpo || "";
  const semUrl = texto.replace(/https?:\/\/\S+/gi, " ");
  const aceita = (valor: string | null): string | null => (codigoPlausivel(valor) ? valor : null);

  const padroes: RegExp[] = [];
  for (const p of opcoes?.padroes || []) {
    try {
      padroes.push(new RegExp(p, "i"));
    } catch {
      /* padrão inválido do grupo: ignora */
    }
  }

  // 1) Código com contexto forte (a palavra ao lado do número).
  for (const re of [...padroes, ...CODE_PATTERNS]) {
    const m = semUrl.match(re);
    if (m && m[1]) {
      const ok = aceita(m[1]);
      if (ok) return ok;
    }
  }

  // 2) Número sozinho numa linha, num e-mail que fala de código.
  if (CONTEXTO_CODIGO.test(texto)) {
    for (const m of semUrl.matchAll(/^\s*(\d{4,8})\s*$/gm)) {
      const ok = aceita(m[1]);
      if (ok) return ok;
    }
  }

  // 3) Palavras-chave do grupo: o número precisa estar PERTO da palavra.
  for (const kw of opcoes?.palavrasChave || []) {
    const achado = aceita(numeroPertoDaPalavra(semUrl, kw));
    if (achado) return achado;
  }

  // 4) Palavra de código + número perto, em formato livre. Cobre o e-mail
  //    da Netflix "Informe este código para entrar 2804", em que a palavra
  //    e o número não estão colados (o regex com [: =] não alcança) e o
  //    número não está sozinho na linha.
  for (const kw of PALAVRAS_CODIGO) {
    const achado = aceita(numeroPertoDaPalavra(semUrl, kw));
    if (achado) return achado;
  }

  return null;
}

/**
 * Confere se o código (IA) aparece de fato no texto do e-mail.
 *
 * Barreira contra alucinação: a IA pode devolver "1522" quando no
 * e-mail estava "15:22" (horário) ou "2026" (ano). O código precisa
 * estar no texto como número de verdade — sem data, hora ou ano.
 */
export function codigoPresenteNoTexto(codigo: string, corpo: string): boolean {
  const digitos = (codigo || "").replace(/\D/g, "");
  if (digitos.length < 4 || digitos.length > 8) return false;
  const limpo = limparNumeros(corpo || "");
  const re = new RegExp(`(?<!\\d)${digitos.split("").join("[\\s.\\-]?")}(?!\\d)`);
  return re.test(limpo);
}
