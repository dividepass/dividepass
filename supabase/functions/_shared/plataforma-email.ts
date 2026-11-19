/**
 * IDENTIFICAÇÃO DA PLATAFORMA DE UM E-MAIL
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * A caixa de e-mail do grupo é COMPARTILHADA entre plataformas: o mesmo
 * endereço (ex.: `grupo1@dividepass.com`) costuma estar cadastrado no
 * Netflix, no Crunchyroll e em outras contas ao mesmo tempo.
 *
 * Sem esta checagem, a busca de código pegava o e-mail mais recente da
 * caixa — que podia ser de OUTRA plataforma. O código vinha "certo" do
 * ponto de vista do regex e completava o campo, mas não servia para
 * nada: o usuário estava na tela do Crunchyroll e recebia um código do
 * Netflix (ou o contrário).
 *
 * A REGRA
 * -------
 * Cada e-mail é classificado em três faixas:
 *   - "match"   → o e-mail é da plataforma pedida; serve.
 *   - "foreign" → o e-mail é de outra plataforma CONHECIDA; NÃO serve e
 *                 é descartado (a resposta final avisa qual era).
 *   - "unknown" → não dá pra saber; entra como fallback (comportamento
 *                 antigo), para não quebrar plataformas que ainda não
 *                 estão na tabela.
 *
 * SINAIS (do mais forte para o mais fraco)
 * ----------------------------------------
 *   1. domínio do remetente  → quase sempre decide.
 *   2. marca no assunto      → decide quando o remetente é genérico.
 *   3. marca no corpo        → fraco; só vale se UMA única plataforma
 *                              aparecer (senão é ambíguo e fica unknown).
 */

/** Plataforma à qual o e-mail pertence. */
export interface PlatformInfo {
  /** Slug canônico ("netflix", "crunchyroll", ...). */
  key: string;
  /** Nome para exibição ("Netflix", "Crunchyroll"). */
  label: string;
}

interface KnownPlatform extends PlatformInfo {
  /** Nomes do serviço em `streaming_services` que caem nesta plataforma. */
  services: string[];
  /** Domínio do remetente — sinal mais forte. */
  senders: RegExp;
  /** Marca no assunto. */
  subject: RegExp;
  /** Marca no corpo — só usado quando é o único sinal. */
  body: RegExp;
}

/**
 * Tabela das plataformas conhecidas.
 *
 * `services` guarda o nome do serviço como está no banco (`name` de
 * `streaming_services`), normalizado — ver `normalizarNome`.
 */
const KNOWN: KnownPlatform[] = [
  {
    key: "netflix",
    label: "Netflix",
    services: ["netflix", "netflixcomum", "netflixpremium"],
    senders: /netflix/i,
    subject: /\bnetflix\b/i,
    body: /\bnetflix\b/i,
  },
  {
    key: "disney",
    label: "Disney+",
    services: ["disney", "disneyplus", "disneypremium"],
    senders: /disney/i,
    subject: /disney\s*\+|disneyplus/i,
    body: /disney\s*\+|disneyplus/i,
  },
  {
    key: "max",
    label: "Max",
    services: ["max", "hbo", "hbomax", "maxhbo"],
    senders: /max\.com|hbo\.com|discovery\.com|hbo/i,
    subject: /\bhbo\s*max\b|\bmax\b/i,
    body: /\bhbo\s*max\b/i,
  },
  {
    key: "primevideo",
    label: "Prime Video",
    services: ["primevideo", "prime", "amazonprime", "amazonprimevideo"],
    senders: /amazon\.com|primevideo/i,
    subject: /prime\s*video|amazon\s*prime/i,
    body: /prime\s*video|amazon\s*prime/i,
  },
  {
    key: "spotify",
    label: "Spotify",
    services: ["spotify", "spotifyfamily"],
    senders: /spotify/i,
    subject: /\bspotify\b/i,
    body: /\bspotify\b/i,
  },
  {
    key: "globoplay",
    label: "Globoplay",
    services: ["globoplay", "globoplaycanais"],
    senders: /globoplay|globo\.com/i,
    subject: /\bgloboplay\b/i,
    body: /\bgloboplay\b/i,
  },
  {
    key: "crunchyroll",
    label: "Crunchyroll",
    services: ["crunchyroll", "crunchyrollmegafan"],
    senders: /crunchyroll/i,
    subject: /\bcrunchyroll\b/i,
    body: /\bcrunchyroll\b/i,
  },
  {
    key: "youtube",
    label: "YouTube",
    services: ["youtube", "youtubepremium", "youtubemusic"],
    senders: /youtube/i,
    subject: /\byoutube\b/i,
    body: /youtube\s*premium/i,
  },
  {
    key: "paramount",
    label: "Paramount+",
    services: ["paramount", "paramountplus"],
    senders: /paramount/i,
    subject: /\bparamount\b/i,
    body: /\bparamount\b/i,
  },
  {
    key: "appletv",
    label: "Apple TV+",
    services: ["appletv", "appletvplus", "appleone"],
    senders: /apple\.com|appleid\.com/i,
    subject: /apple\s*tv/i,
    body: /apple\s*tv/i,
  },
  {
    key: "mubi",
    label: "MUBI",
    services: ["mubi"],
    senders: /mubi/i,
    subject: /\bmubi\b/i,
    body: /\bmubi\b/i,
  },
  {
    key: "deezer",
    label: "Deezer",
    services: ["deezer", "deezerpremium"],
    senders: /deezer/i,
    subject: /\bdeezer\b/i,
    body: /\bdeezer\b/i,
  },
  {
    key: "tidal",
    label: "Tidal",
    services: ["tidal"],
    senders: /tidal/i,
    subject: /\btidal\b/i,
    body: /\btidal\b/i,
  },
  {
    key: "chatgpt",
    label: "ChatGPT",
    services: ["chatgpt", "chatgptplus"],
    senders: /openai\.com|chatgpt/i,
    subject: /\bchatgpt\b/i,
    body: /\bchatgpt\b/i,
  },
  {
    key: "claude",
    label: "Claude",
    services: ["claude", "claudepro"],
    senders: /anthropic\.com|claude/i,
    subject: /\bclaude\b/i,
    body: /\bclaude\b/i,
  },
  {
    key: "notion",
    label: "Notion",
    services: ["notion"],
    senders: /notion\.so/i,
    subject: /\bnotion\b/i,
    body: /\bnotion\b/i,
  },
  {
    key: "canva",
    label: "Canva",
    services: ["canva", "canvapro"],
    senders: /canva\.com/i,
    subject: /\bcanva\b/i,
    body: /\bcanva\b/i,
  },
  {
    key: "figma",
    label: "Figma",
    services: ["figma"],
    senders: /figma\.com/i,
    subject: /\bfigma\b/i,
    body: /\bfigma\b/i,
  },
];

/** Palavras que não helped a montar a regex de uma plataforma genérica. */
const STOPWORDS = new Set([
  "premium", "plus", "pro", "family", "basico", "basico", "padrao", "mensal",
  "anual", "com", "ads", "ad", "gratuito", "free", "oficial", "grupo", "app",
]);

/** Deixa o nome comparável: minúsculas, sem acento e só letras/números. */
export function normalizarNome(valor: string): string {
  return String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Monta a regex de conteúdo de uma plataforma que NÃO está na tabela,
 * a partir do nome do serviço ("ChatGPT Plus" → /chatgpt/i).
 */
function regexDoNomeDoServico(nome: string): RegExp | null {
  const partes = String(nome || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((p) => p.length >= 3 && !STOPWORDS.has(p));
  if (partes.length === 0) return null;
  return new RegExp(`\\b${partes.join("[\\s\\-_]*")}\\b`, "i");
}

/**
 * Plataforma do GRUPO — vem do `service_id` do grupo (`streaming_services`).
 *
 * Quando o serviço não está na tabela, devolve uma plataforma "genérica"
 * com regex derivada do nome: assim uma plataforma nova ainda é
 * comparada com o e-mail pelo nome, e não por um remetente genérico.
 */
export function plataformaDoServico(nomeServico: string): PlatformInfo {
  const nome = String(nomeServico || "").trim();
  const chave = normalizarNome(nome);

  for (const p of KNOWN) {
    if (p.services.includes(chave)) return { key: p.key, label: p.label };
  }

  return {
    key: chave || "desconhecida",
    label: nome || "desconhecida",
  };
}

/** Regex de conteúdo da plataforma pedida (para quando não está na tabela). */
function regexDaPlataformaGenerica(p: PlatformInfo): RegExp | null {
  const known = KNOWN.find((k) => k.key === p.key);
  if (known) return known.subject;
  return regexDoNomeDoServico(p.label);
}

/**
 * Descobre de qual plataforma o e-mail veio.
 *
 * Devolve `null` quando nenhum sinal convincente existe (remetente
 * genérico, assunto sem marca) — nesse caso o e-mail é tratado como
 * "unknown" e entra no fallback.
 */
export function detectarPlataformaDoEmail(email: {
  sender: string;
  subject: string;
  body: string;
}): PlatformInfo | null {
  const sender = String(email.sender || "");
  const subject = String(email.subject || "");
  const body = String(email.body || "");

  let melhor: KnownPlatform | null = null;
  let melhorScore = 0;

  for (const p of KNOWN) {
    let score = 0;
    if (p.senders.test(sender)) score += 4;
    if (p.subject.test(subject)) score += 3;
    if (score > melhorScore) {
      melhor = p;
      melhorScore = score;
    }
  }

  if (melhor && melhorScore >= 3) return { key: melhor.key, label: melhor.label };

  // Só o corpo acusou a marca: vale se UM e somente um aparecer (senão é
  // ambíguo — e-mail de Netflix que cita "Disney+" não pode virar Disney+).
  const noCorpo = KNOWN.filter((p) => p.body.test(body));
  if (noCorpo.length === 1) return { key: noCorpo[0].key, label: noCorpo[0].label };

  return null;
}

/**
 * Mesma ideia de `detectarPlataformaDoEmail`, mas SEM olhar o remetente.
 *
 * POR QUE EXISTE
 * --------------
 * Quando a plataforma pedida NÃO está na tabela (`KNOWN`), o nome do
 * serviço é a única informação que temos — e o remetente não diz nada
 * sobre ele (serviços novos mandam de domínios vários). Usar o domínio
 * aqui só serviria para classificar como "estrangeiro" um e-mail que era
 * do próprio serviço. Por isso, para esse caso, só valem as marcas no
 * assunto e no corpo.
 */
export function detectarMarcaNoTexto(subject: string, body: string): PlatformInfo | null {
  const subj = String(subject || "");
  const txt = String(body || "");

  let melhor: KnownPlatform | null = null;
  let melhorScore = 0;

  for (const p of KNOWN) {
    let score = 0;
    if (p.subject.test(subj)) score += 3;
    if (score > melhorScore) {
      melhor = p;
      melhorScore = score;
    }
  }

  if (melhor && melhorScore >= 3) return { key: melhor.key, label: melhor.label };

  const noCorpo = KNOWN.filter((p) => p.body.test(txt));
  if (noCorpo.length === 1) return { key: noCorpo[0].key, label: noCorpo[0].label };

  return null;
}

/** Resultado da comparação entre um e-mail e a plataforma pedida. */
export type ClassificacaoEmail = "match" | "foreign" | "unknown";

/**
 * Compara o e-mail com a plataforma do grupo.
 *
 * - "match"   → serve para a tela em que o usuário está.
 * - "foreign" → é de outra plataforma; o e-mail NÃO pode virar código.
 * - "unknown" → sem sinal claro; entra como fallback.
 */
export function classificarEmailParaPlataforma(
  email: { sender: string; subject: string; body: string },
  plataforma: PlatformInfo,
): ClassificacaoEmail {
  const detectada = detectarPlataformaDoEmail(email);

  // Plataforma genérica (serviço fora da tabela): só o NOME do serviço
  // ajuda. O remetente não é usado aqui — ele não diz qual é o serviço e
  // faria um e-mail legítimo ser marcado como estrangeiro.
  if (!KNOWN.some((k) => k.key === plataforma.key)) {
    const regex = regexDaPlataformaGenerica(plataforma);
    const texto = `${email.subject || ""}\n${email.body || ""}`;
    if (regex && regex.test(texto)) return "match";

    const detectadaTexto = detectarMarcaNoTexto(email.subject || "", email.body || "");
    if (detectadaTexto) {
      // "ChatGPT Plus" (serviço) e "ChatGPT" (marca detectada) são a MESMA
      // plataforma com nomes diferentes — comparar as chaves direto seria
      // erro. O nome detectado está contido no nome do serviço (ou vice-versa).
      const chaveServico = normalizarNome(plataforma.label);
      if (
        chaveServico.includes(detectadaTexto.key)
        || detectadaTexto.key.includes(chaveServico)
        || plataforma.key.includes(detectadaTexto.key)
        || detectadaTexto.key.includes(plataforma.key)
      ) {
        return "match";
      }
      return "foreign";
    }
    return "unknown";
  }

  if (!detectada) return "unknown";
  return detectada.key === plataforma.key ? "match" : "foreign";
}
