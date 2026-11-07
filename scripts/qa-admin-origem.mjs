/**
 * QA — o card "Onde nos conhecem" e os chips por pessoa no /admin/onboarding.
 *
 * A origem do cadastro (users.lead_source) só existe em quem se cadastrou
 * pela página de registro. A conta QA não tem esse campo gravado (e não
 * pode gravá-lo: o UPDATE da tabela users só libera as colunas do
 * onboarding), então este script INJETA a origem na resposta da API — só
 * para conferir que o card e os chips renderizam.
 *
 *   node scripts/qa-admin-origem.mjs
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-admin-origem.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'mobile');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

const perfilQa = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email&email=eq.qa.mavis@divteste.com`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  })
).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada — rode scripts/criar-conta-qa.mjs');
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

/*
 * Injeta o papel de admin e a origem do cadastro na resposta do `users`.
 *
 * Vale para QUALQUER query em `users`: a origem vem numa query separada
 * (select=lead_source,lead_source_other), e essa resposta não traz id nem
 * e-mail — é por isso que o "soOrigem" existe.
 */
const marcarQa = (u, soOrigem = false) => {
  if (!u) return;
  const alvo = u.email === 'qa.mavis@divteste.com' || u.id === QA_ID;
  /* A query de origem da FICHA pede só lead_source/lead_source_other (sem
     id): essa linha é da pessoa que está sendo vista. A query do relatório
     pede o id, então o filtro por id vale. */
  const semIdentificacao = soOrigem && !u.id && !u.email;
  if (!alvo && !semIdentificacao) return;
  u.lead_source = 'ChatGPT e IAs';
  if (!('lead_source_other' in u)) u.lead_source_other = null;
  if (alvo) u.role = 'admin';
};

await page.route('**/rest/v1/users*', async (route) => {
  const resposta = await route.fetch();
  const corpo = await resposta.json().catch(() => null);
  const soOrigem = route.request().url().includes('lead_source');
  if (Array.isArray(corpo)) corpo.forEach((u) => marcarQa(u, soOrigem));
  else marcarQa(corpo, soOrigem);
  await route.fulfill({ response: resposta, json: corpo });
});

/*
 * As respostas novas (group_intent, expectations) e as plataformas com kind
 * 'share'/'join' ainda NÃO existem no banco de produção: dependem da
 * migration database/EXECUTAR-2026-11-02-onboarding-novo-fluxo.sql. Este
 * mock injenta esses campos na resposta para conferir que a tela do admin
 * renderiza tudo — depois que a migration rodar, a tela usa os dados reais.
 */
await page.route('**/rest/v1/user_onboarding_profiles*', async (route) => {
  const resposta = await route.fetch();
  const corpo = await resposta.json().catch(() => null);
  if (Array.isArray(corpo)) {
    for (const p of corpo) {
      if (p.user_id !== QA_ID) continue;
      p.group_intent = 'criar';
      p.expectations =
        'Quero encontrar gente para dividir a Netflix e o Spotify sem combinar pagamento toda vez.';
    }
  }
  await route.fulfill({ response: resposta, json: corpo });
});

await page.route('**/rest/v1/user_onboarding_interests*', async (route) => {
  const resposta = await route.fetch();
  const corpo = await resposta.json().catch(() => null);
  if (Array.isArray(corpo) && corpo.length === 0) {
    corpo.push(
      { id: 'qa-int-1', user_id: QA_ID, platform_id: null, platform_name: 'Netflix', kind: 'share', is_custom: false },
      { id: 'qa-int-2', user_id: QA_ID, platform_id: null, platform_name: 'Spotify', kind: 'join', is_custom: false }
    );
  }
  await route.fulfill({ response: resposta, json: corpo });
});

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

await page.goto(`${BASE_URL}/admin/onboarding`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ob-report-stats', { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(2500);

/* ── Card "Onde nos conhecem" ─────────────────────────────────────── */
const cartao = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('.chart-card')];
  const c = cards.find((x) => x.querySelector('h3')?.innerText.includes('Onde nos conhecem'));
  if (!c) return null;
  const barras = [...c.querySelectorAll('.bar-row')].map((b) => ({
    rotulo: b.querySelector('.bar-label')?.innerText.trim(),
    valor: b.querySelector('.bar-count')?.innerText.trim(),
  }));
  return {
    titulo: c.querySelector('h3')?.innerText.trim(),
    total: c.querySelector('.chart-total')?.innerText.trim(),
    intro: c.querySelector('.ob-card-intro')?.innerText.trim(),
    barras,
  };
});
check('admin: existe o card "Onde nos conhecem"', !!cartao, cartao?.titulo || 'não encontrado');
check(
  'admin: o card mostra quantos cadastros responderam',
  !!cartao && /de\s*\d+\s*cadastros?/i.test(cartao.total || ''),
  cartao?.total || ''
);
check(
  'admin: o card tem a lista de origens',
  !!cartao && cartao.barras.length > 0,
  cartao ? cartao.barras.slice(0, 4).map((b) => `${b.rotulo}: ${b.valor}`).join(' | ') : ''
);
await page.screenshot({ path: path.join(OUT, '06-origem-cadastro.png'), fullPage: true });

/* ── Aba Respostas: chip de origem por pessoa ─────────────────────── */
await page.locator('.ob-report-tab', { hasText: 'Respostas' }).click();
await page.waitForTimeout(2000);

const chips = await page.evaluate(() => {
  const cartoes = [...document.querySelectorAll('.ob-response')];
  return cartoes.map((c) =>
    [...c.querySelectorAll('.ob-chip')].map((ch) => ({
      rotulo: ch.querySelector('b')?.innerText.trim(),
      valor: ch.innerText.replace(ch.querySelector('b')?.innerText || '', '').trim(),
    }))
  );
});
const chipOrigem = chips.flat().find((c) => /onde nos conheceu/i.test(c.rotulo || ''));
check('admin: o chip "Onde nos conheceu" aparece na resposta', !!chipOrigem, chipOrigem?.valor || '');

const chipEsperativa = chips.flat().find((c) => /espera/i.test(c.rotulo || ''));
check('admin: o chip da resposta aberta aparece', !!chipEsperativa, chipEsperativa?.valor?.slice(0, 50) || '');

/* ── Detalhe aberto: a origem e a citação da resposta aberta ───────── */
const expandir = page.locator('.ob-expand-btn').first();
if (await expandir.count()) {
  await expandir.click();
  await page.waitForTimeout(900);
}
const detalhe = await page.evaluate(() => {
  const itens = [...document.querySelectorAll('.ob-detail-item')].map((i) => ({
    q: i.querySelector('.ob-detail-q')?.innerText.trim(),
    a: i.querySelector('.ob-detail-a')?.innerText.trim(),
    largo: i.classList.contains('is-wide'),
  }));
  return itens;
});
check(
  'admin: o detalhe mostra onde a pessoa nos conheceu',
  detalhe.some((d) => /encontraram|conheceu/i.test(d.q || '')),
  detalhe.map((d) => d.q).join(' | ')
);
const citacao = detalhe.find((d) => d.largo);
check(
  'admin: a resposta aberta aparece como citação',
  !!citacao && /[“"]/.test(citacao.a || ''),
  citacao ? `${citacao.a}`.slice(0, 60) : 'não encontrada'
);
await page.screenshot({ path: path.join(OUT, '07-resposta-aberta.png'), fullPage: true });

/* ── Aba de qualificação da ficha do usuário ───────────────────────── */
/* A mesma tela, uma pessoa: /admin/users/[id]?tab=onboarding. */
await page.goto(`${BASE_URL}/admin/users/${QA_ID}?tab=onboarding`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.ob-answers-tab', { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(2500);

const ficha = await page.evaluate(() => {
  const stats = [...document.querySelectorAll('.ob-report-stats .ob-report-stat')].map((s) => ({
    rotulo: s.querySelector('.ob-report-stat-label')?.innerText.trim(),
    valor: s.querySelector('.ob-report-stat-value')?.innerText.trim(),
  }));
  const cards = [...document.querySelectorAll('.chart-card')].map((c) => ({
    titulo: c.querySelector('h3')?.innerText.trim(),
    grupos: c.querySelectorAll('.ob-platform-group').length,
    chips: c.querySelectorAll('.ob-platform-chip').length,
    icones: c.querySelectorAll('.ob-platform-chip img').length,
  }));
  return {
    stats,
    cards,
    quote: document.querySelector('.ob-open-text')?.innerText.trim() || '',
    detalhe: [...document.querySelectorAll('.ob-detail-item')].map((i) => ({
      q: i.querySelector('.ob-detail-q')?.innerText.trim(),
      a: i.querySelector('.ob-detail-a')?.innerText.trim(),
    })),
  };
});

const rotulos = ficha.stats.map((s) => s.rotulo);
check(
  'ficha: os indicadores são os mesmos do relatório',
  ['Onde nos conheceu', 'Quer criar grupo', 'Quer entrar em grupo', 'Pessoas indicadas'].every((r) =>
    rotulos.includes(r)
  ),
  rotulos.join(' | ')
);
check(
  'ficha: o indicador de origem mostra a origem do cadastro',
  ficha.stats.find((s) => s.rotulo === 'Onde nos conheceu')?.valor === 'ChatGPT e IAs',
  ficha.stats.find((s) => s.rotulo === 'Onde nos conheceu')?.valor || ''
);

const cardCriar = ficha.cards.find((c) => c.titulo === 'Quer criar grupo');
const cardEntrar = ficha.cards.find((c) => c.titulo === 'Quer entrar em grupo');
check(
  'ficha: as plataformas para criar estão agrupadas por categoria',
  !!cardCriar && cardCriar.chips >= 1 && cardCriar.grupos >= 1,
  cardCriar ? `${cardCriar.chips} chip(s) em ${cardCriar.grupos} bloco(s)` : 'card ausente'
);
check(
  'ficha: as plataformas para entrar estão agrupadas por categoria',
  !!cardEntrar && cardEntrar.chips >= 1 && cardEntrar.grupos >= 1,
  cardEntrar ? `${cardEntrar.chips} chip(s) em ${cardEntrar.grupos} bloco(s)` : 'card ausente'
);
check(
  'ficha: a resposta aberta aparece em citação',
  /[“"]/.test(ficha.quote),
  ficha.quote.slice(0, 60)
);
check(
  'ficha: o detalhe mostra onde a pessoa nos conheceu',
  ficha.detalhe.some((d) => /encontraram|conheceu/i.test(d.q || '')),
  ficha.detalhe.map((d) => d.q).join(' | ')
);
await page.screenshot({ path: path.join(OUT, '08-ficha-qualificacao.png'), fullPage: true });

console.log('\nerros de console:', erros.slice(0, 5).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`);
console.log('screenshots em', OUT);

await browser.close();
process.exit(falhas ? 1 : 0);
