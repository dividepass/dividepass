/**
 * QA RESPONSIVO DO PAINEL ADMIN — viewport de celular.
 *
 * O painel é usado pelo operador no celular. Este script confere as três
 * regras do contrato de densidade (ver src/pages/admin/admin-responsive.css):
 *
 *   1) TABELA VIRA CARTÃO — a lista de usuários não exige rolagem lateral e
 *      o cabeçalho da tabela some (o rótulo da coluna aparece na linha);
 *   2) FILTRO NÃO EMPILHA — os filtros de /admin/users ocupam 2 colunas;
 *   3) NADA ESTOURA A LARGURA — nenhuma página rola na horizontal.
 *
 * Além disso, confere o link do grupo na aba Assinaturas
 * (/admin/users/[id]?tab=subscriptions).
 *
 * NADA é gravado no banco: só leitura + um login de QA com papel de admin
 * injetado na resposta de `GET /rest/v1/users`.
 *
 *   node scripts/qa-admin-mobile.mjs
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-admin-mobile.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'mobile');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

/* O id real da conta QA: o app busca o perfil por `users?id=eq.<id>` e um id
   falso derruba a tela antes de qualquer verificação. */
const perfilQa = await (await fetch(`${s.url}/rest/v1/users?select=id,email&email=eq.qa.mavis@divteste.com`, {
  headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
})).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada no banco — rode scripts/criar-conta-qa.mjs');
  process.exit(1);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const page = await context.newPage();

/* Sessão da conta QA + papel de admin injetado na resposta do perfil. */
await context.addInitScript(
  ([key, sessao]) => {
    localStorage.setItem(key, sessao);
  },
  [
    SESSION_KEY,
    JSON.stringify({
      access_token: s.token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'qa-refresh',
      user: { id: QA_ID, email: 'qa.mavis@divteste.com' },
    }),
  ]
);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

await page.route('**/rest/v1/users*', async (route) => {
  const resposta = await route.fetch();
  const corpo = await resposta.json().catch(() => null);
  if (Array.isArray(corpo)) {
    for (const u of corpo) if (u && u.email === 'qa.mavis@divteste.com') u.role = 'admin';
  } else if (corpo && corpo.email === 'qa.mavis@divteste.com') {
    corpo.role = 'admin';
  }
  await route.fulfill({ response: resposta, json: corpo });
});

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

async function medirPagina(nome, url, seletor) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' });
  if (seletor) {
    await page.waitForSelector(seletor, { timeout: 30000 }).catch(() => null);
  }
  await espera(2500);

  const rolagemHorizontal = await page.evaluate(() => {
    const d = document.documentElement;
    return { scrollWidth: d.scrollWidth, clientWidth: d.clientWidth };
  });
  const estourou = rolagemHorizontal.scrollWidth > rolagemHorizontal.clientWidth + 1;
  check(
    `${nome}: não rola na horizontal`,
    !estourou,
    estourou ? `scrollWidth ${rolagemHorizontal.scrollWidth} > ${rolagemHorizontal.clientWidth}` : ''
  );

  await page.screenshot({ path: path.join(OUT, `${nome}-viewport.png`) });
  await page.screenshot({ path: path.join(OUT, `${nome}-completo.png`), fullPage: true });
  return { rolagemHorizontal, estourou };
}

/* ------------------------------------------------------------------ */
/* 1) Painel /admin — os 9 indicadores                               */
/* ------------------------------------------------------------------ */
await medirPagina('01-painel', '/admin', '.metrics-grid');

const metricas = await page.evaluate(() => {
  const grid = document.querySelector('.metrics-grid');
  if (!grid) return null;
  const colunas = getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length;
  const cartoes = grid.querySelectorAll('.metric-card').length;
  const altura = Math.round(grid.getBoundingClientRect().height);
  return { colunas, cartoes, altura };
});
check(
  'painel: indicadores em 2 colunas',
  !!metricas && metricas.colunas === 2,
  metricas ? `${metricas.colunas} colunas, ${metricas.cartoes} cartões, ${metricas.altura}px de altura` : 'grade não encontrada'
);
check(
  'painel: bloco de indicadores cabe na tela (sem rolagem interna)',
  !!metricas && metricas.altura < 700,
  metricas ? `${metricas.altura}px` : ''
);

/* Sonda: cria uma lista alta com a mesma classe e confere se o teto de
   altura some no celular (é o que trava o painel em dois eixos). */
const scrollAninhado = await page.evaluate(() => {
  const alvo = document.querySelector('.admin-content');
  if (!alvo) return null;
  const el = document.createElement('ul');
  el.className = 'activity-list';
  el.style.height = '900px';
  el.style.flex = '0 0 auto';
  alvo.appendChild(el);
  const cs = getComputedStyle(el);
  const r = {
    maxHeight: cs.maxHeight,
    overflowY: cs.overflowY,
    altura: Math.round(el.getBoundingClientRect().height),
  };
  el.remove();
  return r;
});
check(
  'painel: lista de atividade sem rolagem aninhada',
  !!scrollAninhado && scrollAninhado.maxHeight === 'none' && scrollAninhado.altura >= 900,
  scrollAninhado ? `max-height ${scrollAninhado.maxHeight}, altura ${scrollAninhado.altura}px` : ''
);

/* ------------------------------------------------------------------ */
/* 2) /admin/users — filtros em grade e tabela vira cartão             */
/* ------------------------------------------------------------------ */
await medirPagina('02-usuarios', '/admin/users', '.users-table');

const filtros = await page.evaluate(() => {
  const grid = document.querySelector('.users-filters');
  if (!grid) return null;
  const cs = getComputedStyle(grid);
  const filhos = [...grid.children].map((c) => {
    const r = c.getBoundingClientRect();
    return { tag: c.tagName, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  });
  return {
    display: cs.display,
    colunas: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
    filhos,
  };
});
check(
  'usuários: filtros em grade (não empilhados)',
  !!filtros && filtros.display === 'grid' && filtros.colunas === 2,
  filtros ? `display ${filtros.display}, ${filtros.colunas} colunas` : 'filtros não encontrados'
);

const linhas = filtros?.filhos?.filter((f) => f.y === filtros.filhos[0].y).length ?? 0;
check(
  'usuários: filtros ocupam no máximo 2 linhas',
  !!filtros && linhas <= 2,
  filtros ? `${linhas} linha(s) para ${filtros.filhos.length} controles` : ''
);

const tabela = await page.evaluate(() => {
  const t = document.querySelector('.users-table');
  if (!t) return null;
  const thead = t.querySelector('thead');
  const primeiraLinha = t.querySelector('tbody tr');
  const celulas = [...(primeiraLinha?.querySelectorAll('td') || [])].map((td) => {
    const r = td.getBoundingClientRect();
    const especial = ['ad-pick', 'ad-lead', 'ad-actions'].find((cl) => td.classList.contains(cl)) || null;
    return {
      label: td.getAttribute('data-label'),
      especial,
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      rotulo: getComputedStyle(td, '::before').content,
    };
  });
  return {
    theadVisivel: thead ? getComputedStyle(thead).position !== 'absolute' : false,
    linhas: t.querySelectorAll('tbody tr').length,
    celulas,
  };
});
check(
  'usuários: cabeçalho da tabela some no celular (viram rótulos)',
  !!tabela && !tabela.theadVisivel
);
check(
  'usuários: célula de metadado tem data-label',
  !!tabela && tabela.celulas.every((c) => c.label || c.especial),
  tabela ? tabela.celulas.map((c) => `${c.label || c.especial}`).join(', ') : ''
);
check(
  'usuários: cartão não estoura a largura',
  !!tabela && tabela.celulas.every((c) => c.w <= 340),
  tabela ? `larguras ${tabela.celulas.map((c) => c.w).join('/')}` : ''
);

/* Os botões de ação precisam ficar em UMA linha no rodapé do cartão —
   empilhados, cada cartão vira meio tela de rolagem. */
const acoes = await page.evaluate(() => {
  const td = document.querySelector('.users-table td.ad-actions');
  if (!td) return null;
  const cell = td.querySelector('.actions-cell');
  if (!cell) return null;
  const csTd = getComputedStyle(td);
  const csCell = getComputedStyle(cell);
  const botoes = [...cell.children].map((b) => {
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width) };
  });
  return {
    tdDisplay: csTd.display,
    tdDirection: csTd.flexDirection,
    cellDisplay: csCell.display,
    cellDirection: csCell.flexDirection,
    cellWrap: csCell.flexWrap,
    cellWidth: Math.round(cell.getBoundingClientRect().width),
    botoes,
  };
});
const linhasAcao = acoes ? new Set(acoes.botoes.map((b) => b.y)).size : 0;
check(
  'usuários: botões de ação em uma linha só',
  !!acoes && linhasAcao === 1 && acoes.botoes.length > 1,
  acoes
    ? `${acoes.botoes.length} botões em ${linhasAcao} linha(s) | td ${acoes.tdDisplay}/${acoes.tdDirection} | cell ${acoes.cellDisplay}/${acoes.cellDirection}/wrap ${acoes.cellWrap} largura ${acoes.cellWidth}px`
    : 'célula de ações não encontrada'
);

/* ------------------------------------------------------------------ */
/* 3) /admin/users/[id] — abas roláveis + link do grupo               */
/* ------------------------------------------------------------------ */
/* Pega um usuário real pela REST da conta QA e abre a ficha dele. */
const usuarioReal = await (await fetch(`${s.url}/rest/v1/users?select=id,email&limit=1`, {
  headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
})).json().catch(() => null);

const idUsuario = usuarioReal?.[0]?.id;
if (!idUsuario) {
  check('ficha do usuário: existe um usuário para abrir', false, 'REST devolveu vazio');
} else {
  /* A conta QA não é admin no banco, então a RLS esconde as assinaturas.
     Injetamos UMA assinatura fictícia só para conferir o link do grupo
     (é a única coisa que a tela precisa mostrar). */
  await page.route('**/rest/v1/user_subscriptions*', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 'sub-qa-0001',
          user_id: idUsuario,
          group_id: '22222222-2222-2222-2222-222222222222',
          service_id: '33333333-3333-3333-3333-333333333333',
          status: 'active',
          amount: 59.5,
          billing_cycle: 'monthly',
          next_charge_at: '2026-12-01T00:00:00Z',
          service: { name: 'Max', full_name: 'Max' },
          group: { name: 'Grupo QA' },
        },
      ]),
    });
  });

  await medirPagina('03-ficha', `/admin/users/${idUsuario}?tab=subscriptions`, '.user-tabs');

  const abas = await page.evaluate(() => {
    const row = document.querySelector('.user-tabs');
    if (!row) return null;
    const cs = getComputedStyle(row);
    return {
      direcao: cs.flexDirection,
      overflowX: cs.overflowX,
      scrollWidth: row.scrollWidth,
      clientWidth: row.clientWidth,
      abas: row.querySelectorAll('.user-tab').length,
    };
  });
  check(
    'ficha: abas numa faixa rolável (não 7 linhas empilhadas)',
    !!abas && abas.direcao === 'row' && abas.overflowX === 'auto',
    abas ? `${abas.abas} abas, flex-direction ${abas.direcao}, overflow-x ${abas.overflowX}` : ''
  );

  const linkGrupo = await page.evaluate(() => {
    const a = document.querySelector('.user-sub-group-link');
    if (!a) return null;
    return { href: a.getAttribute('href'), texto: a.innerText.trim() };
  });
  check(
    'ficha: o grupo da assinatura é um hyperlink',
    !!linkGrupo && /\/admin\/groups\/[^/]+\/edit/.test(linkGrupo.href),
    linkGrupo ? `${linkGrupo.texto} -> ${linkGrupo.href}` : 'nenhum link encontrado'
  );
}

/* ------------------------------------------------------------------ */
/* 4) /admin/events — chips roláveis                                   */
/* ------------------------------------------------------------------ */
await medirPagina('04-eventos', '/admin/events', '.ev-chips');

const chips = await page.evaluate(() => {
  const c = document.querySelector('.ev-chips');
  if (!c) return null;
  const cs = getComputedStyle(c);
  const r = c.getBoundingClientRect();
  return {
    wrap: cs.flexWrap,
    overflowX: cs.overflowX,
    altura: Math.round(r.height),
    filhos: c.children.length,
  };
});
check(
  'eventos: chips numa faixa rolável (não 5 linhas de filtro)',
  !!chips && chips.wrap === 'nowrap' && chips.overflowX === 'auto',
  chips ? `${chips.filhos} chips, wrap ${chips.wrap}, altura ${chips.altura}px` : ''
);
check(
  'eventos: faixa de chips cabe numa linha',
  !!chips && chips.altura < 70,
  chips ? `${chips.altura}px` : ''
);

/* ------------------------------------------------------------------ */
/* 5) /admin/onboarding — indicadores e abas                           */
/* ------------------------------------------------------------------ */
await medirPagina('05-onboarding', '/admin/onboarding', '.ob-report-stats');

const onboarding = await page.evaluate(() => {
  const grid = document.querySelector('.ob-report-stats');
  const tabs = document.querySelector('.ob-report-tabs');
  if (!grid) return null;
  const cs = getComputedStyle(grid);
  return {
    colunas: cs.gridTemplateColumns.split(' ').filter(Boolean).length,
    cartoes: grid.children.length,
    abasOverflow: tabs ? getComputedStyle(tabs).overflowX : null,
  };
});
check(
  'onboarding: indicadores em 2 colunas',
  !!onboarding && onboarding.colunas === 2,
  onboarding ? `${onboarding.colunas} colunas, ${onboarding.cartoes} cartões` : 'grade não encontrada'
);
check(
  'onboarding: abas numa faixa rolável',
  !!onboarding && onboarding.abasOverflow === 'auto',
  onboarding ? `overflow-x ${onboarding.abasOverflow}` : ''
);

/* ------------------------------------------------------------------ */
/* 6) Desktop — o redesenho é do celular; a mesa não pode quebrar    */
/* ------------------------------------------------------------------ */
await page.setViewportSize({ width: 1280, height: 900 });
await page.goto(`${BASE_URL}/admin/users`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.users-table', { timeout: 60000 }).catch(async () => {
  console.log('sem tabela no desktop. URL:', page.url());
  console.log('texto:', (await page.locator('body').innerText().catch(() => '')).slice(0, 300));
});
await page.waitForTimeout(2000);

const mesa = await page.evaluate(() => {
  const t = document.querySelector('.users-table');
  const thead = t?.querySelector('thead');
  const filtros = document.querySelector('.users-filters');
  const cabecalhos = [...(thead?.querySelectorAll('th') || [])].map((th) => th.innerText.trim());
  return {
    theadVisivel: thead ? getComputedStyle(thead).position !== 'absolute' : false,
    colunas: cabecalhos.length,
    cabecalhos,
    filtrosDisplay: filtros ? getComputedStyle(filtros).display : null,
    filtrosLinhas: filtros
      ? new Set([...filtros.children].map((c) => Math.round(c.getBoundingClientRect().y))).size
      : 0,
  };
});
check(
  'desktop: a tabela continua sendo tabela (cabeçalho visível)',
  mesa.theadVisivel && mesa.colunas === 7,
  `${mesa.colunas} colunas: ${mesa.cabecalhos.join(' | ')}`
);
check(
  'desktop: os filtros continuam em uma linha',
  mesa.filtrosDisplay === 'flex' && mesa.filtrosLinhas === 1,
  `display ${mesa.filtrosDisplay}, ${mesa.filtrosLinhas} linha(s)`
);

await page.screenshot({ path: path.join(OUT, '06-desktop-usuarios.png') });

/* ------------------------------------------------------------------ */
console.log('\nerros de console:', erros.slice(0, 8).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`);
console.log('screenshots em', OUT);

await browser.close();
process.exit(falhas ? 1 : 0);
