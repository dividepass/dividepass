/**
 * Questionário de qualificação do onboarding.
 *
 * Fica no código, e não no banco, de propósito: as respostas são gravadas
 * em colunas tipadas de user_onboarding_profiles, então cada pergunta
 * carrega a `column` que ela alimenta. Se o questionário vivesse numa
 * tabela editável pelo admin, Bastaria alguém reordenar uma etapa para o
 * vínculo com a coluna quebrar em silêncio.
 *
 * A página de relatório (/admin/onboarding) renderiza os textos e as barras
 * a partir daqui — é a mesma fonte que o gate usa para perguntar.
 *
 * Cada `value` precisa ser único dentro da pergunta: o relatório agrupa por
 * value, e valor repetido faz duas respostas diferentes aparecerem somadas
 * na mesma barra (foi o que acontecia na pesquisa "utilizacao").
 */

export const INTEREST_CATEGORIES = {
  STREAMING: ['streaming'],
  MUSIC: ['musica'],
  HEALTH: ['saude'],
  // Idiomas, finanças e cursos propriamente ditos (Duolingo, Busuu,
  // Nath Finanças, Descomplica, Brainly...).
  EDUCATION: ['cursos'],
  AI: ['ia', 'produtividade', 'ferramentas'],
  OTHER: ['leitura', 'games', 'seguranca'],
};

/* Nome legível de cada categoria de streaming_services. O relatório do
   onboarding usa para separar as plataformas dentro de cada pergunta — sem
   isso, o card de "filmes e séries" acaba mostrando junto o Spotify e o
   ChatGPT, porque o banco só guarda a categoria do serviço. */
export const CATEGORY_LABELS = {
  streaming: 'Filmes e séries',
  musica: 'Música',
  cursos: 'Educação e idiomas',
  ia: 'Inteligência artificial',
  produtividade: 'Produtividade',
  ferramentas: 'Ferramentas',
  leitura: 'Leitura',
  games: 'Games',
  saude: 'Saúde e bem-estar',
  seguranca: 'Segurança',
};

export const categoryLabel = (category) => CATEGORY_LABELS[category] || category || 'Outras';

/* Todas as categorias: as duas perguntas de plataforma do fluxo novo
   (quer criar / quer entrar) aceitam qualquer serviço do catálogo. */
const ALL_CATEGORIES = [
  ...INTEREST_CATEGORIES.STREAMING,
  ...INTEREST_CATEGORIES.MUSIC,
  ...INTEREST_CATEGORIES.HEALTH,
  ...INTEREST_CATEGORIES.EDUCATION,
  ...INTEREST_CATEGORIES.AI,
  ...INTEREST_CATEGORIES.OTHER,
];

/**
 * Fluxo do onboarding — versão curta (02/11/2026).
 *
 * Antes eram 11 perguntas (quantas assinaturas, já compartilha, com quem,
 * dificuldade, 5 perguntas de plataforma e as indicações). O usuário reclamou
 * de cansaço: cada pergunta extra custava uma tela. Agora o caminho é:
 *
 *   avatar → dificuldade → 2 convidados → criar/entrar/ambos
 *          → [serviços para criar] → [serviços para entrar] → texto livre
 *
 * O passo `group_intent` é a bifurcação: cada opção aponta o próximo passo.
 * "Ambos" responde as duas perguntas de plataforma (criar e depois entrar).
 */
export const ONBOARDING_STEPS = [
  {
    id: 'welcome',
    type: 'info',
    title: 'Bem-vindo ao DividePass!',
    content:
      'Compartilhamos assinaturas digitais para você pagar até 80% menos ' +
      'em serviços como Netflix, Disney+ e Spotify.\n\n' +
      'Responda rapidinho para a gente encontrar as melhores oportunidades para você.',
  },

  {
    id: 'main_barrier',
    type: 'single',
    column: 'main_barrier',
    thenNext: 'invites',
    title: 'Qual é a maior dificuldade para você começar a compartilhar assinaturas?',
    customField: 'main_barrier_other',
    customOption: 'outro',
    options: [
      { value: 'falta_confianca', label: 'Falta de confiança' },
      { value: 'nao_conheco_pessoas', label: 'Não conheço pessoas para dividir' },
      { value: 'receio_senha', label: 'Tenho receio de compartilhar senhas' },
      { value: 'esquecem_pagar', label: 'Pessoas esquecem de pagar' },
      { value: 'alguem_sai', label: 'Alguém pode sair do grupo' },
      { value: 'organizar_pagamentos', label: 'Dificuldade para organizar os pagamentos' },
      { value: 'nunca_pensei', label: 'Nunca pensei nisso' },
      { value: 'dificuldade_tudo', label: 'Tenho dificuldade com tudo isso' },
      { value: 'outro', label: 'Outro motivo' },
    ],
  },

  {
    // Pedir uma pessoa é o que dá ao time um grupo real para abrir. O
    // mínimo é 1: exigir 2 fazia parte do fluxo largar no meio — no
    // primeiro acesso as pessoas paravam de responder justamente nessa
    // etapa (o próprio número delas não conta como indicação).
    id: 'invites',
    type: 'invites',
    minInvites: 1,
    thenNext: 'group_intent',
    title: 'Se você fosse criar um grupo hoje para dividir assinaturas, tem amigos ou familiares que faria sentido convidar para participar?',
    helper: 'Adicione pelo menos 1 pessoa. Podemos avisar quando abrir grupos que combinam com ela.',
  },

  {
    // Bifurcação do fluxo. `next` de cada opção é o passo que vem a seguir.
    id: 'group_intent',
    type: 'single',
    column: 'group_intent',
    title: 'Hoje você gostaria de entrar em grupos para dividir ou deseja criar o seu grupo?',
    options: [
      { value: 'entrar', label: 'Entrar em grupo existente', next: 'join_platforms' },
      { value: 'criar', label: 'Quero criar meu grupo', next: 'share_platforms' },
      { value: 'ambos', label: 'Ambos', next: 'share_platforms' },
    ],
  },

  {
    id: 'share_platforms',
    type: 'platforms',
    kind: 'share',
    title: 'Quais destes serviços você quer criar um grupo?',
    helper: 'Marque os serviços que você quer compartilhar com o seu grupo.',
    categories: ALL_CATEGORIES,
    // "Quero criar" termina aqui; "Ambos" segue para a pergunta de entrar.
    nextWhen: (answers) => (answers?.group_intent === 'criar' ? 'expectations' : 'join_platforms'),
  },

  {
    id: 'join_platforms',
    type: 'platforms',
    kind: 'join',
    title: 'Quais destas plataformas você tem interesse de entrar em grupos?',
    helper: 'Marque as plataformas que te interessam para entrar em um grupo.',
    categories: ALL_CATEGORIES,
  },

  {
    // Última pergunta: aberta. O que a pessoa espera encontrar e o que a faria
    // usar é o insumo mais valioso que o time recebe do onboarding.
    id: 'expectations',
    type: 'text',
    column: 'expectations',
    title: 'O que você espera encontrar na plataforma? E o que te faria usar a nossa plataforma?',
    helper: 'Responda com as suas palavras — essa resposta é lida pelo time.',
    placeholder:
      'Ex: quero encontrar gente para dividir a Netflix e o Spotify sem ficar combinando pagamento toda vez.',
  },
];

/** Passo inicial usado quando o gate abre, antes de qualquer pergunta. */
export const AVATAR_STEP_ID = 'avatar';

/**
 * Sequência effective de passos, resolvendo a ramificação.
 * `answers` usa o formato { [id]: value } com value cru (string, array ou
 * booleano), que é o que `pickColumnValue` converte para gravar.
 *
 * Três formas de escolher o próximo passo, nesta ordem:
 *
 *  1. `options[].next` — bifurcação pela resposta (o passo "criar, entrar ou
 *     ambos" manda o usuário para perguntas diferentes);
 *  2. `nextWhen(answers)` — o próximo depende de uma resposta de OUTRO passo
 *     (quem quer criar vai direto para a pergunta aberta; quem quer os dois
 *     passa antes pela de entrar);
 *  3. `thenNext` — próximo passo fixo.
 *
 * Sem nenhum desses, segue a posição na lista.
 */
export function buildOnboardingPath(answers) {
  const byId = Object.fromEntries(ONBOARDING_STEPS.map((s) => [s.id, s]));
  const path = [];
  const seen = new Set();
  let cursor = ONBOARDING_STEPS[0].id;

  while (cursor && byId[cursor] && !seen.has(cursor)) {
    seen.add(cursor);
    const step = byId[cursor];
    path.push(step);

    // 1. Bifurcação pela resposta escolhida.
    if (step.options?.some((o) => o.next)) {
      const chosen = step.options.find((o) => o.value === answers?.[step.id]);
      if (chosen?.next) {
        cursor = chosen.next;
        continue;
      }
      // Sem resposta ainda: segue a lista até a primeira pergunta de
      // plataforma, e o caminho se refaz quando a pessoa escolher.
      const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
      cursor = next?.id ?? null;
      continue;
    }

    // 2. Próximo passo que depende de outra resposta.
    if (step.nextWhen) {
      cursor = step.nextWhen(answers);
      continue;
    }

    // 3. Próximo passo fixo.
    if (step.thenNext) {
      cursor = step.thenNext;
      continue;
    }

    const next = ONBOARDING_STEPS[ONBOARDING_STEPS.indexOf(step) + 1];
    cursor = next?.id ?? null;
  }

  return path;
}

/**
 * Colunas tipadas alimentadas por um conjunto de respostas.
 * Só entra o que o passo realmente salva — os passos de plataforma vão
 * para user_onboarding_interests e ficam de fora daqui.
 */
export function pickColumnValues(answers) {
  const row = {};

  for (const step of ONBOARDING_STEPS) {
    // Precisa vir antes dos `continue` por tipo: a coluna complementar é de
    // um passo do tipo single (o "Outro motivo"), que sairia no primeiro if.
    if (step.customField && answers?.[step.id] === step.customOption) {
      const other = answers?.[step.customField];
      if (typeof other === 'string' && other.trim()) {
        row[step.customField] = other.trim();
      }
    }

    if (!step.column) continue;
    const value = answers?.[step.id];

    if (step.type === 'yes_no') {
      if (typeof value === 'boolean') row[step.column] = value;
      continue;
    }

    if (step.type === 'multiple') {
      if (Array.isArray(value) && value.length) row[step.column] = value;
      continue;
    }

    if (step.type === 'single' || step.type === 'text') {
      if (typeof value === 'string' && value.trim()) row[step.column] = value.trim();
      continue;
    }
  }

  return row;
}

/**
 * Reconstroi o objeto `answers` a partir de uma linha de
 * user_onboarding_profiles — o inverso de pickColumnValues. Usado na
 * retomada do onboarding para preencher as etapas já respondidas.
 */
export function restoreAnswersFromProfile(row) {
  const answers = {};
  if (!row) return answers;

  for (const step of ONBOARDING_STEPS) {
    if (!step.column) continue;
    const value = row[step.column];
    if (value === null || value === undefined) continue;

    if (step.type === 'yes_no') {
      if (typeof value === 'boolean') answers[step.id] = value;
      continue;
    }
    if (step.type === 'multiple') {
      if (Array.isArray(value) && value.length) answers[step.id] = value;
      continue;
    }
    if (step.type === 'single') {
      answers[step.id] = value;
      continue;
    }

    // Texto livre (a pergunta aberta final): volta como string.
    if (step.type === 'text') {
      answers[step.id] = value;
      continue;
    }
  }

  // Campo complementar do "Outro motivo".
  const barrier = ONBOARDING_STEPS.find((s) => s.column === 'main_barrier');
  if (barrier && answers[barrier.id] === barrier.customOption && row.main_barrier_other) {
    answers.main_barrier_other = row.main_barrier_other;
  }

  return answers;
}

/** Rótulo legível de uma opção, para o relatório e para o perfil. */
export function labelForValue(step, value) {
  if (!step?.options) return value;
  return step.options.find((o) => o.value === value)?.label ?? value;
}

/** Rótulo legível de uma coluna, para a aba do UserDetail. */
export function columnLabel(column) {
  const step = ONBOARDING_STEPS.find((s) => s.column === column);
  return step ? step.title : column;
}