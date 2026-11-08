/**
 * QA DA VISÃO GERAL — dashboard e página de plataforma (2026-11-08).
 *
 * Confere, no navegador de verdade (conta QA), se o redesenho do dashboard e
 * da página da plataforma aparece:
 *
 *   1) /dashboard — hero direcionado pelo onboarding, "Top N mais vendidos",
 *      "Últimas assinaturas";
 *   2) /dashboard/catalog/:plataforma — slides (tarjas), chips de desconto,
 *      lateral com as últimas assinaturas e o CTA dentro do card de grupo.
 *
 * Roda contra o dev server:
 *   npm run dev
 *   node scripts/qa-dashboard-visao-geral.mjs
 *
 * Ou contra a produção (com o código novo já no ar):
 *   QA_BASE_URL=https://dividepass.com node scripts/qa-dashboard-visao-geral.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'dashboard-visao-geral');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const H = { apikey: s.anon, Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' };

const perfilQa = await (
  await fetch(`${s.url}/rest/v1/users?select=id,email,phone&email=eq.${process.env.QA_EMAIL || 'qa.mavis@divteste.com'}`, { headers: H })
).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada — rode scripts/criar-conta-qa.mjs');
  process.exit(1);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();

/* ── DESKTOP ───────────────────────────────────────────────────────────── */
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
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
      user: { id: QA_ID, email: process.env.QA_EMAIL || 'qa.mavis@divteste.com' },
    }),
  ]
);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  // 404 de rede (a função do banco ainda não aplicada) não é erro de JS.
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  erros.push(m.text());
});

/**
 * Fecha os portões (instalar o app / liberar notificações) que aparecem por
 * cima do dashboard — sem isso a captura sai com o modal no meio.
 */
async function fecharPortoes(p) {
  const alvos = [
    '.push-gate-skip',
    '.pwa-gate-skip',
    '.push-gate-secondary',
    '.pwa-gate-secondary',
    '.push-gate-close',
    '.pwa-gate-close',
  ];
  for (const sel of alvos) {
    const botao = p.locator(sel).first();
    if (await botao.count()) {
      await botao.click({ timeout: 3000 }).catch(() => {});
      await espera(400);
    }
  }
}

/* ── 1) DASHBOARD ──────────────────────────────────────────────────────── */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(page);
await espera(600);

// Se a conta QA cair no onboarding, o teste do dashboard não vale.
const noOnboarding = page.url().includes('/onboarding');
check('dashboard abre sem cair no onboarding', !noOnboarding, page.url());

if (!noOnboarding) {
  const hero = await page.locator('.dash-hero').count();
  check('hero direcionado (pelo onboarding) está na tela', hero > 0);

  const heroTexto = hero ? await page.locator('.dash-hero').first().innerText() : '';
  check('hero mostra o nome da pessoa', /Olá,/.test(heroTexto), heroTexto.split('\n')[0]);

  const topSell = await page.locator('.top-sell-card').count();
  check('carrossel "mais vendidos" tem cards', topSell > 0, `${topSell} cards`);

  if (topSell > 0) {
    const card = await page.locator('.top-sell-card').first().innerText();
    check('card de mais vendido tem preço', /R\$/.test(card), card.replace(/\n/g, ' | ').slice(0, 120));
    check(
      'card de mais vendido tem ranking',
      /MAIS (VENDIDO|PROCURADO)/i.test(card),
      card.split('\n')[0]
    );
  }

  const recentes = await page.locator('.recent-chip').count();
  check('faixa de últimas assinaturas tem gente', recentes > 0, `${recentes} chips`);

  const chipTexto = recentes ? await page.locator('.recent-chip').first().innerText() : '';
  // O nome vem mascarado: primeiro nome + inicial do sobrenome + "***"
  // (sem sobrenome, fica só o primeiro nome).
  check(
    'nome na faixa vem mascarado',
    /^[^\s@]+( [A-Z]\*{3})?$/.test(chipTexto.trim()),
    chipTexto
  );

  await page.screenshot({ path: path.join(OUT, 'dashboard-topo.png') });
  await page.screenshot({ path: path.join(OUT, 'dashboard-inteiro.png'), fullPage: true });
}

/* ── 2) PÁGINA DA PLATAFORMA ──────────────────────────────────────────── */
/* Escolhe a plataforma que tem MAIS gente dentro dos grupos — é a que
   exercita a lateral de "últimas assinaturas" e os selos de desconto. */
const membros = await (
  await fetch(
    `${s.url}/rest/v1/group_members?select=group:group_id(service:service_id(slug,name))&status=eq.active&limit=200`,
    { headers: H }
  )
).json().catch(() => []);

const contagem = new Map();
(Array.isArray(membros) ? membros : []).forEach((m) => {
  const svc = m.group?.service;
  if (!svc?.slug) return;
  contagem.set(svc.slug, (contagem.get(svc.slug) || 0) + 1);
});

const melhorSlug = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;

if (melhorSlug) {
  const url = `${BASE_URL}/dashboard/catalog/${melhorSlug}`;
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await espera(3000);
  await fecharPortoes(page);
  await espera(600);

  check('página da plataforma abre', page.url().includes('/dashboard/catalog/'), page.url());

  const slides = await page.locator('.plat-slide').count();
  check('slide (tarja) da plataforma está na tela', slides > 0, `${slides} slides`);

  const dots = await page.locator('.plat-dot').count();
  check('há mais de um slide para navegar', dots > 1, `${dots} slides`);

  const chips = await page.locator('.catalog-platform-chip').count();
  check('cabeçalho mostra os chips (desconto/grupos)', chips > 0, `${chips} chips`);

  const lateral = await page.locator('.plat-side .recent-item').count();
  check('lateral lista as últimas assinaturas', lateral > 0, `${lateral} itens`);

  const nomeMascarado = lateral ? await page.locator('.plat-side .recent-name').first().innerText() : '';
  check(
    'nome na lateral vem mascarado',
    /^[^\s@]+( [A-Z]\*{3})?$/.test(nomeMascarado.trim()),
    nomeMascarado
  );

  const ctaCard = await page.locator('.gc-cta').count();
  check('card de grupo tem CTA de entrar', ctaCard > 0, `${ctaCard} CTAs`);

  const off = await page.locator('.gc-off').count();
  check('card de grupo mostra o desconto', off > 0, `${off} selos`);

  await page.screenshot({ path: path.join(OUT, 'plataforma-topo.png') });
  await page.screenshot({ path: path.join(OUT, 'plataforma-inteira.png'), fullPage: true });
} else {
  check('existe grupo aberto para testar a plataforma', false, 'nenhum grupo aberto encontrado');
}

check('sem erro de JS na tela', erros.length === 0, erros.slice(0, 3).join(' | '));

/* ── MOBILE ────────────────────────────────────────────────────────────── */
const ctxMobile = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const pMobile = await ctxMobile.newPage();
await ctxMobile.addInitScript(
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
      user: { id: QA_ID, email: process.env.QA_EMAIL || 'qa.mavis@divteste.com' },
    }),
  ]
);

await pMobile.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(3500);
await fecharPortoes(pMobile);
await espera(600);
if (!pMobile.url().includes('/onboarding')) {
  await pMobile.screenshot({ path: path.join(OUT, 'mobile-dashboard.png') });
  const overflow = await pMobile.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
  );
  check('mobile do dashboard não tem rolagem horizontal', !overflow);
}

/* ── TEMA ESCURO ──────────────────────────────────────────────────────── */
await page.evaluate(() => {
  document.documentElement.setAttribute('data-theme', 'dark');
  try {
    localStorage.setItem('dp-theme', 'dark');
  } catch {
    /* storage bloqueado */
  }
});
await espera(700);
await page.screenshot({ path: path.join(OUT, 'dashboard-escuro.png') });
await page.screenshot({ path: path.join(OUT, 'plataforma-escura.png'), fullPage: true });

await browser.close();

const falhas = results.filter((r) => !r.ok);
console.log('');
console.log(`RESULTADO: ${results.length - falhas.length}/${results.length} checks OK`);
console.log(`Screenshots em: ${OUT}`);
if (falhas.length) {
  console.log('');
  falhas.forEach((f) => console.log(`  FALHOU: ${f.name} ${f.detail || ''}`));
  process.exit(1);
}
