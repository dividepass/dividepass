/**
 * QA DO CARD DE PAGAMENTOS DO PAINEL ADMIN (/admin/).
 *
 * O card mostra o total pago e a quantidade; o clique abre a lista com quem
 * pagou, em qual grupo, o valor e o status.
 *
 * A tabela `payments` está VAZIA em produção, então a lista é injetada na
 * resposta da API — o teste é da TELA, não do dado. O caso "sem pagamento"
 * (o card não aparece) é conferido com os dados reais.
 *
 *   node scripts/qa-admin-pagamentos.mjs
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-admin-pagamentos.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'admin-pagamentos');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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
  console.error('conta QA não encontrada');
  process.exit(1);
}

/* Pagamentos de exemplo: um pago de cada status + um pago a mais, para o
   total e a contagem não baterem com o número de linhas. */
const PAGAMENTOS_FAKE = [
  {
    id: 'pay-1', amount: 55.9, status: 'paid', method: 'pix', gateway: 'mercadopago',
    paid_at: '2026-11-04T12:00:00Z', created_at: '2026-11-04T12:00:00Z', transaction_code: 'MP-9001',
    user_id: QA_ID, group_id: 'g1',
    user: { id: QA_ID, name: 'Ana Paula Souza', email: 'ana.souza@divteste.com' },
    group: { id: 'g1', name: 'Netflix Premium — 4 vagas', service: { id: 's1', name: 'Netflix' } },
  },
  {
    id: 'pay-2', amount: 27.95, status: 'paid', method: 'credit_card', gateway: 'stripe',
    paid_at: '2026-11-03T09:30:00Z', created_at: '2026-11-03T09:30:00Z', transaction_code: 'ST-4412',
    user_id: QA_ID, group_id: 'g2',
    user: { id: QA_ID, name: 'Bruno Lima', email: 'bruno.lima@divteste.com' },
    group: { id: 'g2', name: 'Spotify Família', service: { id: 's2', name: 'Spotify' } },
  },
  {
    id: 'pay-3', amount: 19.9, status: 'pending', method: 'pix', gateway: 'mercadopago',
    paid_at: null, created_at: '2026-11-02T18:10:00Z', transaction_code: 'MP-9013',
    user_id: QA_ID, group_id: 'g3',
    user: { id: QA_ID, name: 'Carla Menezes', email: 'carla@divteste.com' },
    group: { id: 'g3', name: 'Disney+ Combo', service: { id: 's3', name: 'Disney Plus' } },
  },
  {
    id: 'pay-4', amount: 39.9, status: 'failed', method: 'credit_card', gateway: 'mercado_pago',
    paid_at: null, created_at: '2026-11-01T21:45:00Z', transaction_code: 'MP-9014',
    user_id: QA_ID, group_id: 'g4',
    user: { id: QA_ID, name: 'Diego Ramos', email: 'diego@divteste.com' },
    group: { id: 'g4', name: 'Max — 5 vagas', service: { id: 's4', name: 'Max' } },
  },
  {
    id: 'pay-5', amount: 45, status: 'refunded', method: 'pix', gateway: 'woovi',
    paid_at: '2026-10-30T10:00:00Z', created_at: '2026-10-30T10:00:00Z', transaction_code: 'WO-778',
    user_id: QA_ID, group_id: 'g5',
    user: { id: QA_ID, name: 'Elisa Ferreira', email: 'elisa@divteste.com' },
    group: { id: 'g5', name: 'Globoplay + Canais', service: { id: 's5', name: 'Globoplay' } },
  },
];

const browser = await chromium.launch();
const ctx = await browser.newContext({
  ...devices['iPhone 13'],
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();

await ctx.addInitScript(
  ([key, sessao]) => { localStorage.setItem(key, sessao); },
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

/* Papel de admin (o painel exige) + a lista de pagamentos injetada. */
await page.route('**/rest/v1/users*', async (route) => {
  const resposta = await route.fetch();
  const corpo = await resposta.json().catch(() => null);
  const marcar = (u) => {
    if (u && u.email === 'qa.mavis@divteste.com') u.role = 'admin';
  };
  if (Array.isArray(corpo)) corpo.forEach(marcar); else marcar(corpo);
  await route.fulfill({ response: resposta, json: corpo });
});

/* O primeiro carregamento usa os dados REAIS (a tabela está vazia): é o
   caso "sem pagamento o card não aparece". Depois liga a injeção. */
let injetarPagamentos = false;

await page.route('**/rest/v1/payments*', async (route) => {
  if (!injetarPagamentos) return route.continue();
  const url = route.request().url();
  /* Só a query do card (que traz o join de usuário e grupo). A query da
     receita passa direto — é outra informação. O select vem codificado
     ("user%3Auser_id"), então a comparação é no texto decodificado. */
  const urlLida = decodeURIComponent(url);
  if (!urlLida.includes('user:user_id')) return route.continue();
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(PAGAMENTOS_FAKE),
  });
});

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

/* ── 1) SEM pagamento o card não aparece (dados reais) ─────────── */
await page.goto(`${BASE_URL}/admin/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.metrics-grid', { timeout: 60000 }).catch(() => null);
await page.waitForTimeout(2500);
check(
  'sem pagamento: o card não aparece',
  (await page.locator('.pay-panel').count()) === 0,
  'tabela payments vazia em produção'
);

/* ── 2) COM pagamento o card aparece ────────────────────────────── */
injetarPagamentos = true;
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.pay-panel', { timeout: 60000 });
check('com pagamento: o card aparece', true, 'painel de pagamentos');

const resumo = await page.evaluate(() => {
  const p = document.querySelector('.pay-panel');
  return {
    titulo: p.querySelector('.pay-head-label')?.innerText?.trim() || '',
    total: p.querySelector('.pay-head-total')?.innerText?.trim() || '',
    sub: p.querySelector('.pay-head-sub')?.innerText?.trim() || '',
    aberto: p.querySelector('.pay-list') !== null,
    chevron: !!p.querySelector('.pay-chevron'),
  };
});
check('card: mostra o total pago', /R\$\s*83,85/.test(resumo.total), resumo.total);
check('card: mostra a quantidade', /5 pagamentos/.test(resumo.sub), resumo.sub);
check('card: começa fechado', !resumo.aberto);
await page.screenshot({ path: path.join(OUT, '01-card-fechado.png') });

/* ── 3) O clique abre a lista ───────────────────────────────────── */
await page.locator('.pay-head').click();
await page.waitForSelector('.pay-list', { timeout: 10000 });
const lista = await page.evaluate(() => {
  const linhas = [...document.querySelectorAll('.pay-row')];
  return {
    linhas: linhas.length,
    dados: linhas.map((l) => ({
      quem: l.querySelector('.pay-who strong')?.innerText?.trim() || '',
      grupo: l.querySelector('.pay-group strong')?.innerText?.trim() || '',
      servico: l.querySelector('.pay-group span')?.innerText?.trim() || '',
      valor: l.querySelector('.pay-money strong')?.innerText?.trim() || '',
      status: l.querySelector('.pay-badge')?.innerText?.trim() || '',
    })),
  };
});
check('toggle: o clique abre a lista', lista.linhas === 5, `${lista.linhas} linhas`);
check(
  'lista: mostra quem pagou',
  lista.dados.some((d) => d.quem === 'Ana Paula Souza'),
  lista.dados.map((d) => d.quem).join(' | ')
);
check(
  'lista: mostra o grupo e o serviço',
  lista.dados.some((d) => d.grupo.includes('Netflix') && d.servico === 'Netflix'),
  lista.dados.map((d) => d.grupo).join(' | ')
);
/* O Intl.NumberFormat usa espaço não separável (U+00A0) entre "R$" e o
   número — normalizar antes de comparar. */
const normaliza = (t) => String(t || '').replace(/\u00a0/g, ' ').trim();

check(
  'lista: mostra o valor',
  lista.dados.some((d) => normaliza(d.valor) === 'R$ 55,90'),
  lista.dados.map((d) => normaliza(d.valor)).join(' | ')
);
const statusVistos = lista.dados.map((d) => d.status);
check(
  'lista: mostra o status de cada pagamento',
  ['Pago', 'Pendente', 'Falhou', 'Estornado'].every((st) => statusVistos.includes(st)),
  statusVistos.join(' | ')
);
await page.screenshot({ path: path.join(OUT, '02-card-aberto.png'), fullPage: true });

/* ── 4) O clique de novo fecha ──────────────────────────────────── */
await page.locator('.pay-head').click();
await page.waitForTimeout(400);
check('toggle: o segundo clique fecha', (await page.locator('.pay-list').count()) === 0);

/* ── 5) No celular não pode estourar a largura ──────────────────── */
const largura = await page.evaluate(() => ({
  scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
  painel: Math.round(document.querySelector('.pay-panel').getBoundingClientRect().width),
  tela: window.innerWidth,
}));
check('celular: o painel não estourou a largura', !largura.scrollX, `${largura.painel}px de ${largura.tela}px`);

/* ── 6) No desktop a linha fica em uma só altura ─────────────────── */
await page.setViewportSize({ width: 1440, height: 900 });
await page.waitForTimeout(600);
/* A lista foi fechada no passo 4 — reabre para medir as linhas. */
if ((await page.locator('.pay-list').count()) === 0) {
  await page.locator('.pay-head').click();
  await page.waitForSelector('.pay-list', { timeout: 10000 });
}
await page.waitForTimeout(400);
const desktop = await page.evaluate(() => {
  const linhas = [...document.querySelectorAll('.pay-row')];
  const alturas = linhas.map((l) => Math.round(l.getBoundingClientRect().height));
  const quem = document.querySelector('.pay-who')?.getBoundingClientRect();
  const grupo = document.querySelector('.pay-group')?.getBoundingClientRect();
  const dinheiro = document.querySelector('.pay-money')?.getBoundingClientRect();
  return {
    scrollX: document.documentElement.scrollWidth > window.innerWidth + 1,
    alturas,
    mesmaLinha: quem && grupo && dinheiro
      ? Math.abs(quem.top - grupo.top) < 20 && Math.abs(quem.top - dinheiro.top) < 20
      : false,
  };
});
check('desktop: a linha do pagamento fica em uma só linha', desktop.mesmaLinha, `alturas: ${desktop.alturas.join(', ')}`);
check('desktop: a página não rola na horizontal', !desktop.scrollX);
await page.screenshot({ path: path.join(OUT, '03-desktop.png'), fullPage: false });

console.log('\nerros de console:', erros.slice(0, 5).join(' | ') || '(nenhum)');
const falhas = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - falhas}/${results.length} verificações passaram`);
console.log('screenshots em', OUT);

await browser.close();
process.exit(falhas ? 1 : 0);
