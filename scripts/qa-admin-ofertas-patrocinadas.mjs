/**
 * QA do painel ADMIN de "Ofertas Patrocinadas" (/admin/sponsored-offers).
 *
 * É a tela que VENDE o espaço: quem paga para o serviço aparecer destacado no
 * topo do catálogo e nos recomendados é registrado aqui. Se ela não funciona,
 * a monetização não existe.
 *
 * O que este script confere:
 *   1) a rota abre para o admin e mostra o resumo (cadastradas / no ar /
 *      patrocínio / cliques);
 *   2) a lista mostra as ofertas com selo, período e métricas;
 *   3) "Nova Oferta" abre o formulário com os campos de venda (patrocinador,
 *      título, selo, onde aparece, valor pago, período);
 *   4) a validação barra oferta sem título e sem patrocinador;
 *   5) o SALVAR manda o payload certo para a tabela `sponsored_offers`
 *      (placement, amount_paid como número, período, badge padrão).
 *
 * NADA é gravado: as escritas em `sponsored_offers` são interceptadas e
 * devolvidas em memória. Os serviços e grupos vêm do banco REAL.
 *
 *   node scripts/qa-admin-ofertas-patrocinadas.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

const ADMIN_PROFILE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Admin QA',
  email: 'admin.qa@dividepass.com',
  role: 'admin',
  status: 'active',
  email_verified: true,
  avatar_url: '/avatars/avatar-03.svg',
  created_at: '2026-01-01T00:00:00Z',
  onboarding_started_at: '2026-01-01T00:00:05Z',
  onboarding_completed_at: '2026-01-01T00:00:10Z',
  onboarding_step: 'concluido',
};

/* Ofertas de mentira — só para o painel ter o que mostrar. */
const HOJE = new Date();
const emDias = (d) =>
  new Date(HOJE.getTime() + d * 86400000).toISOString().slice(0, 10);

const OFERTAS_FAKE = [
  {
    id: 'aaaaaaaa',
    service_id: null,
    group_id: null,
    sponsor_user_id: null,
    sponsor_name: 'Studio Aurora',
    headline: 'Oferta em destaque',
    description: '30% de desconto no primeiro mês',
    badge: 'Oferta em destaque',
    cta_label: 'Ver oferta',
    cta_url: null,
    banner_url: null,
    placement: 'both',
    amount_paid: 250,
    period_start: emDias(-2),
    period_end: emDias(28),
    status: 'active',
    priority: 10,
    impressions: 340,
    clicks: 27,
    notes: null,
    created_at: new Date().toISOString(),
    service: { id: 's1', name: 'Netflix', slug: 'netflix', icon: null, icon_url: null, color: '#E50914' },
    group: null,
  },
  {
    id: 'bbbbbbbb',
    service_id: null,
    group_id: null,
    sponsor_user_id: null,
    sponsor_name: 'Play Store BR',
    headline: 'Streaming em promoção',
    description: null,
    badge: 'Patrocinado',
    cta_label: 'Ver oferta',
    cta_url: 'https://exemplo.com',
    banner_url: null,
    placement: 'catalog',
    amount_paid: 90,
    period_start: emDias(-10),
    period_end: emDias(-1), // vencida
    status: 'active',
    priority: 0,
    impressions: 12,
    clicks: 0,
    notes: null,
    created_at: new Date().toISOString(),
    service: { id: 's2', name: 'Spotify', slug: 'spotify', icon: null, icon_url: null, color: '#1DB954' },
    group: null,
  },
];

/* Payload capturado no POST (a escrita é mockada). */
let payloadEnviado = null;
let metodoEnviado = null;

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

async function mockRest(route, request) {
  const url = request.url();
  const method = request.method();
  const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object');

  if (url.includes('/rest/v1/sponsored_offers')) {
    if (method === 'POST' || method === 'PATCH') {
      metodoEnviado = method;
      payloadEnviado = JSON.parse(request.postData() || '{}');
      const criado = {
        ...OFERTAS_FAKE[0],
        ...payloadEnviado,
        id: 'cccccccc',
      };
      return json(route, wantsObject ? criado : [criado], 201);
    }
    if (method === 'DELETE') return json(route, []);
    // GET (a lista)
    return json(route, OFERTAS_FAKE);
  }

  if (url.includes('/rest/v1/users')) {
    return json(route, wantsObject ? ADMIN_PROFILE : [ADMIN_PROFILE]);
  }

  return route.continue();
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });

await page.addInitScript(
  ([key, value]) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('dp_push_gate_skipped', '1');
  },
  [
    SESSION_KEY,
    JSON.stringify({
      access_token: s.token,
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      refresh_token: 'qa-refresh',
      user: { id: 'qa', email: 'qa.mavis@divteste.com' },
    }),
  ]
);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') erros.push(m.text());
});

await page.route('**/rest/v1/**', mockRest);

/* ============================ a rota abre ============================ */
await page.goto(`${BASE_URL}/admin/sponsored-offers`, { waitUntil: 'domcontentloaded' });

const abriu = await page
  .waitForSelector('.spon-admin', { timeout: 30000 })
  .then(() => true)
  .catch(() => false);
check('/admin/sponsored-offers abre o painel de ofertas', abriu);

if (!abriu) {
  await page.screenshot({ path: path.join(OUT, 'admin-ofertas-nao-abriu.png'), fullPage: true });
  console.log('\nerros de console:', erros.slice(0, 5).join(' | ') || '(nenhum)');
  await browser.close();
  process.exit(1);
}

const titulo = await page.locator('.spon-admin h1').innerText();
check(
  'o painel se chama "Ofertas Patrocinadas"',
  /Ofertas Patrocinadas/i.test(titulo),
  titulo.trim()
);

/* ============================ o resumo ============================ */
await page.waitForSelector('.spon-stat-val', { timeout: 15000 });
const statCards = await page.locator('.spon-stat-card').allInnerTexts();
const resumo = statCards.map((t) => t.replace(/\s+/g, ' ').trim());
check('o resumo mostra as 4 métricas', statCards.length === 4, resumo.join(' | '));
check(
  'o resumo soma o patrocínio (R$)',
  resumo.some((t) => /Patrocínio/.test(t) && /340,00/.test(t)),
  resumo.find((t) => /Patrocínio/.test(t)) || ''
);
check(
  'o resumo soma os cliques',
  resumo.some((t) => /Cliques/.test(t) && /\b27\b/.test(t)),
  resumo.find((t) => /Cliques/.test(t)) || ''
);

/* ============================ a lista ============================ */
const linhas = await page.locator('.spon-offer-card, .spon-offer-row, .spon-card').count();
const textoDaPagina = await page.locator('.spon-admin').innerText();
check(
  'a lista mostra as ofertas cadastradas',
  /Studio Aurora/.test(textoDaPagina) && /Play Store BR/.test(textoDaPagina),
  `${linhas} card(s)`
);
check(
  'a lista mostra o selo "Oferta em destaque"',
  /Oferta em destaque/.test(textoDaPagina)
);
check(
  'a lista avisa qual oferta está vencida',
  /Período encerrado/i.test(textoDaPagina),
  textoDaPagina.match(/[^\n]*(Período encerrado|encerrad[ao]|expirad[ao]|vencid[ao])[^\n]*/i)?.[0]?.trim() || '(sem aviso de vencimento)'
);

/* ============================ criar oferta ============================ */
await page.locator('button:has-text("Nova Oferta")').click();
await page.waitForSelector('.spon-form', { timeout: 10000 });
check('"Nova Oferta" abre o formulário', true);

const rotulos = await page.locator('.spon-form .form-group label').allInnerTexts();
const exigidos = [
  'Serviço',
  'Patrocinador',
  'Título da oferta',
  'Selo',
  'Onde aparece',
  'Valor pago',
  'Início do período',
];
const faltando = exigidos.filter((r) => !rotulos.some((x) => x.includes(r)));
check(
  'o formulário tem os campos de venda',
  faltando.length === 0,
  faltando.length ? `faltou: ${faltando.join(', ')}` : rotulos.join(' | ').slice(0, 200)
);

/* a validação barra oferta sem título */
await page.locator('.spon-form button[type="submit"]').click();
await page.waitForTimeout(400);
const erro1 = await page.locator('.spon-result--error').innerText().catch(() => '');
check(
  'a validação barra oferta sem título',
  /título/i.test(erro1),
  erro1.replace(/\s+/g, ' ').slice(0, 120)
);

/* preenche e salva */
const grupo = (rotulo) =>
  page.locator('.spon-form .form-group').filter({ has: page.locator(`label:text-is("${rotulo}")`) });

await grupo('Patrocinador *').locator('input').fill('Parceiro QA');
await grupo('Título da oferta *').locator('input').fill('Oferta de teste da QA');
await grupo('Selo').locator('input').fill('Oferta em destaque');
await grupo('Valor pago (R$)').locator('input').fill('199,90');
await grupo('Onde aparece').locator('select').selectOption('both');
await grupo('Status').locator('select').selectOption('active');

// serviço: usa o primeiro serviço real que a tela carregou
const servicos = await grupo('Serviço').locator('select option').allInnerTexts();
check('a lista de serviços vem do banco', servicos.length > 1, servicos.join(' | ').slice(0, 140));
if (servicos.length > 1) {
  const valor = await grupo('Serviço').locator('select option').nth(1).getAttribute('value');
  await grupo('Serviço').locator('select').selectOption(valor);
}

await page.locator('.spon-form button[type="submit"]').click();
await page.waitForTimeout(900);

check('o salvamento manda um INSERT em sponsored_offers', metodoEnviado === 'POST', String(metodoEnviado));

const p = payloadEnviado || {};
check('o payload leva o patrocinador', p.sponsor_name === 'Parceiro QA', String(p.sponsor_name));
check('o payload leva o título', p.headline === 'Oferta de teste da QA', String(p.headline));
check(
  'o payload leva o selo padrão "Oferta em destaque"',
  p.badge === 'Oferta em destaque',
  String(p.badge)
);
check(
  'o payload leva "onde aparece" = nos dois lugares',
  p.placement === 'both',
  String(p.placement)
);
check(
  'o payload leva o valor pago como número',
  typeof p.amount_paid === 'number' && p.amount_paid === 199.9,
  `${typeof p.amount_paid} ${p.amount_paid}`
);
check(
  'o payload leva o período com data de início e fim',
  !!p.period_start && p.period_end === null,
  `${p.period_start} -> ${p.period_end}`
);
check(
  'o payload leva o serviço escolhido',
  !!p.service_id,
  String(p.service_id)
);

const sucesso = await page.locator('.spon-result--success').innerText().catch(() => '');
check('a tela confirma "Oferta criada!"', /criada/i.test(sucesso), sucesso.replace(/\s+/g, ' ').slice(0, 120));

await page.screenshot({ path: path.join(OUT, 'admin-ofertas-patrocinadas.png'), fullPage: true });

/* ============================ sem erro de JS ============================ */
const errosRelevantes = erros.filter((e) => !/favicon|404 \(Not Found\)|Failed to load resource/i.test(e));
check('sem erro de javascript na tela', errosRelevantes.length === 0, errosRelevantes.slice(0, 3).join(' | '));

await browser.close();

const falhou = results.filter((r) => !r.ok);
console.log(`\n${results.length - falhou.length}/${results.length} ok`);
if (falhou.length) {
  console.log('\nfalhas:');
  falhou.forEach((f) => console.log(`  - ${f.name} ${f.detail}`));
  process.exit(1);
}
