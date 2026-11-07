/**
 * TIPOS DE REGRINHA
 *
 * O dono do grupo escolhe "tipos" de regrinha em vez de escrever tudo do zero.
 * Cada tipo tem um id estável e um texto que vai para a coluna `groups.rules`
 * (uma regrinha por linha). O texto gravado é o que o membro lê no checkout,
 * no detalhe do grupo e na tela de credenciais.
 *
 * Por que o id importa: o campo `groups.rules` é TEXT (não tem coluna nova),
 * então o texto guardado é a fonte da verdade. O id serve para reconhecer
 * uma regrinha que já foi escolhida — quando o rascunho é retomado, o texto
 * salvo é comparado com o catálogo e as regrinhas correspondentes voltam
 * marcadas. Se o texto do catálogo mudar no futuro, a regrinha antiga
 * continua valendo como texto livre (não some do grupo).
 *
 * Regras de ouro do catálogo:
 *   - `id`: único, estável, em snake_case.
 *   - `label`: o que aparece no botão (curto).
 *   - `hint`: a explicação curta que aparece embaixo do label.
 *   - `text`: o que é gravado em `groups.rules` (uma linha, sem \n).
 */

/**
 * @typedef {Object} GroupRuleType
 * @property {string} id
 * @property {string} label
 * @property {string} hint
 * @property {string} text
 */

/** @type {GroupRuleType[]} */
export const GROUP_RULE_TYPES = [
  {
    id: 'nao_compartilhar_senha',
    label: 'Não compartilhar a senha',
    hint: 'A credencial não sai do grupo.',
    text: 'Não compartilhe a senha nem o link de acesso fora deste grupo.',
  },
  {
    id: 'um_dispositivo_por_membro',
    label: 'Um dispositivo por membro',
    hint: 'Cada pessoa usa a conta em um aparelho por vez.',
    text: 'Cada membro deve usar a conta em apenas um dispositivo por vez.',
  },
  {
    id: 'sem_revenda',
    label: 'Sem revenda ou empréstimo',
    hint: 'A vaga é pessoal e não pode ser passada adiante.',
    text: 'A vaga é pessoal: não revenda, não empreste e não repasse o acesso a terceiros.',
  },
  {
    id: 'aviso_de_cancelamento',
    label: 'Avisar antes de cancelar',
    hint: 'Manda mensagem ao dono antes de sair.',
    text: 'Avise o dono do grupo com pelo menos 24 horas de antecedência antes de cancelar.',
  },
  {
    id: 'pagamento_em_dia',
    label: 'Pagamento em dia',
    hint: 'O membro paga no prazo combinado.',
    text: 'Mantenha o pagamento em dia para não perder o acesso ao grupo.',
  },
  {
    id: 'sem_conteudo_ilegal',
    label: 'Uso legal do serviço',
    hint: 'Respeita os termos do serviço.',
    text: 'Use a conta apenas dentro dos termos de uso do serviço, sem fins ilícitos.',
  },
  {
    id: 'credencial_confidencial',
    label: 'Credencial confidencial',
    hint: 'Não posta a senha em chat ou grupo aberto.',
    text: 'Não poste a senha em chats, grupos ou comentários públicos.',
  },
  {
    id: 'grupo_pode_mudar',
    label: 'O grupo pode mudar as regras',
    hint: 'O dono pode avisar alterações.',
    text: 'O dono do grupo pode alterar as regras e avisar os membros antes.',
  },
];

/**
 * A regrinha que já vem marcada quando o grupo é criado.
 *
 * Todo grupo compartilhado precisa de pelo menos um aviso para o membro, e
 * o dono raramente escreve isso do zero. Então o rascunho nasce com a
 * regrinha mais básica — "não compartilhe a senha fora do grupo" — e o dono
 * marca as outras ou desmarca esta, como quiser.
 */
export const DEFAULT_RULE_TYPE_IDS = ['nao_compartilhar_senha'];

/**
 * O texto de `groups.rules` que corresponde ao padrão acima.
 */
export const DEFAULT_RULE_TEXT = buildRuleText(DEFAULT_RULE_TYPE_IDS, '');

/**
 * Normaliza um texto de regrinha para comparar (maiúsculas, acentos e
 * espaços extras não podem fazer a regrinha "sumir" do catálogo).
 */
export function normalizeRuleText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Separa o texto gravado em `groups.rules` nas linhas que ele tem.
 * Linhas vazias são descartadas (o \n do fim não deve virar regrinha).
 *
 * @param {string|null|undefined} value
 * @returns {string[]}
 */
export function splitRuleLines(value) {
  return String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Descobre quais tipos do catálogo já estão no texto gravado.
 *
 * @param {string|null|undefined} value texto de `groups.rules`
 * @returns {{ selectedIds: string[], matchedIds: string[] }}
 *   selectedIds: ids do catálogo encontrados no texto
 *   matchedIds: ids do catálogo cujo texto foi encontrado (alias de selectedIds)
 */
export function matchRuleTypes(value) {
  const lines = splitRuleLines(value).map(normalizeRuleText);
  const selectedIds = GROUP_RULE_TYPES
    .filter((type) => lines.includes(normalizeRuleText(type.text)))
    .map((type) => type.id);
  return { selectedIds, matchedIds: selectedIds };
}

/**
 * Monta o texto de `groups.rules` a partir dos tipos marcados e do texto
 * livre digitado pelo dono.
 *
 * A ordem é: tipos do catálogo (na ordem do catálogo) e depois o texto livre.
 * O resultado nunca tem linha vazia no meio e nunca termina com \n.
 *
 * Uma linha livre que seja IGUAL ao texto de um tipo marcado não é repetida
 * (evita a mesma regrinha duas vezes no grupo).
 *
 * @param {string[]} selectedIds
 * @param {string} customText
 * @returns {string}
 */
export function buildRuleText(selectedIds, customText) {
  const selected = Array.isArray(selectedIds) ? selectedIds : [];
  const chosenTexts = GROUP_RULE_TYPES
    .filter((type) => selected.includes(type.id))
    .map((type) => type.text);
  const chosenNormalized = chosenTexts.map(normalizeRuleText);

  const fromCustom = splitRuleLines(customText).filter(
    (line) => !chosenNormalized.includes(normalizeRuleText(line)),
  );

  return [...chosenTexts, ...fromCustom].join('\n');
}

/**
 * Separa o texto gravado em: ids do catálogo já escolhidos + texto livre
 * (as linhas que não batem com nenhuma regrinha do catálogo).
 *
 * É o inverso de `buildRuleText` e é o que permite retomar um rascunho:
 * as regrinhas saldas voltam marcadas e o resto volta na caixa de texto.
 *
 * @param {string|null|undefined} value
 * @returns {{ selectedIds: string[], customText: string }}
 */
export function parseRuleText(value) {
  const lines = splitRuleLines(value);
  const normalized = lines.map(normalizeRuleText);
  const selectedIds = [];
  const customLines = [];

  lines.forEach((line, index) => {
    const type = GROUP_RULE_TYPES.find(
      (candidate) => normalizeRuleText(candidate.text) === normalized[index],
    );
    if (type) {
      if (!selectedIds.includes(type.id)) selectedIds.push(type.id);
    } else {
      customLines.push(line);
    }
  });

  return { selectedIds, customText: customLines.join('\n') };
}

/**
 * Conta quantas regrinhas o grupo tem (tipos do catálogo + texto livre).
 *
 * @param {string|null|undefined} value
 * @returns {number}
 */
export function countRules(value) {
  return splitRuleLines(value).length;
}

/**
 * Resumo curto das regrinhas para a tela de confirmação: quantas são e,
 * quando cabe em uma linha, quais são.
 *
 * @param {string|null|undefined} value
 * @returns {string}
 */
export function rulesSummary(value) {
  const lines = splitRuleLines(value);
  if (!lines.length) return 'Nenhuma';

  const short = lines.length <= 2
    ? lines.join(' · ')
    : `${lines.slice(0, 2).join(' · ')} +${lines.length - 2}`;

  return `${lines.length} — ${short}`;
}

export default GROUP_RULE_TYPES;
