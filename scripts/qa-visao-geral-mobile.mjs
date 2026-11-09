/**
 * QA DA VISÃO GERAL E DOS CARDS DE GRUPO (08/11/2026) — mobile.
 *
 * Confere no navegador (conta QA):
 *   - "Mais populares" vem logo depois do botão do WhatsApp;
 *   - os tópicos são ÍCONES de verdade (não emoji) e são CLICÁVEIS:
 *     tocar neles leva para os serviços da categoria;
 *   - as fileiras andam sozinhas (auto-scroll de 5s);
 *   - o card do hero é clicável inteiro e no celular não tem botão
 *     "Ver grupos" nem a linha de números;
 *   - o card de grupo não tem mais a row de rodapé e mostra a tag CHEIO
 *     no topo, ao lado do nome;
 *   - a tag "Com/Sem anúncios" é grande e legível;
 *   - nenhuma rolagem horizontal.
 *
 *   npm run dev
 *   node scripts/qa-visao-geral-mobile.mjs
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'visao-geral-mobile');
const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ' - ' + detail : ''}`);
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms));

const s = await getSessaoQa();
const REF = new URL(s.url).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;
const QA_EMAIL = process.env.QA_EMAIL || 'qa.mavis@divteste.com';
const perfil = await (
  await fetch(`${s.url}/rest/v1/users?select=id&email=eq.${QA_EMAIL}`, {
    headers: { apikey: s.anon, Authorization: `Bearer ${s.token}` },
  })
).json().catch(() => null);
const QA_ID = perfil?.[0]?.id;

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

function sessao(page) {
  return page.addInitScript(
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
        user: { id: QA_ID, email: QA_EMAIL },
      }),
    ]
  );
}

async function fecharPortoes(p) {
  for (const sel of [
    '.push-gate-skip',
    '.pwa-gate-skip',
    '.push-gate-secondary',
    '.pwa-gate-secondary',
    '.push-gate-close',
    '.pwa-gate-close',
  ]) {
    const botao = p.locator(sel).first();
    if (await botao.count()) {
      await botao.click({ timeout: 3000 }).catch(() => {});
      await espera(350);
    }
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
await sessao(page);

const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (/Failed to load resource/i.test(m.text())) return;
  erros.push(m.text());
});

/* ── VISÃO GERAL ─────────────────────────────────────────────────────── */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await espera(5000);
await fecharPortoes(page);
await espera(1500);

/* ATALHOS: as quatro telas que a pessoa mais usa, na cara do gol */
const atalhos = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.quick-card')).map((el) => ({
    label: el.textContent.trim(),
    href: el.getAttribute('href') || '',
  }))
);
check(
  'os 4 atalhos estão na tela',
  atalhos.length === 4,
  atalhos.map((a) => a.label).join(', ')
);
const esperado = [
  ['Catálogo', '/dashboard/catalog'],
  ['Credenciais', '/dashboard/credentials'],
  ['Assinaturas', '/dashboard/billing'],
  ['Perfil', '/dashboard/profile'],
];
for (const [label, href] of esperado) {
  const achou = atalhos.find((a) => a.label === label && a.href === href);
  check(`atalho "${label}" aponta para ${href}`, !!achou, achou ? achou.href : 'não encontrado');
}
const ordemAtalhos = await page.evaluate(() => {
  const y = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + window.scrollY : null;
  };
  return {
    whatsapp: y('.whatsapp-vip-chip'),
    atalhos: y('.quick-shortcuts'),
    populares: y('.storefront-section'),
  };
});
check(
  'os atalhos ficam logo abaixo do botão do WhatsApp',
  ordemAtalhos.whatsapp !== null &&
    ordemAtalhos.atalhos !== null &&
    ordemAtalhos.whatsapp < ordemAtalhos.atalhos &&
    ordemAtalhos.atalhos < ordemAtalhos.populares,
  JSON.stringify(ordemAtalhos)
);

/* HERO É SLIDE: o card troca de plataforma sozinho */
const bonequinhos = await page.locator('.dash-hero-dot').count();
check('o hero tem mais de um slide (bonequinhos)', bonequinhos > 1, `${bonequinhos} slides`);
const titulo1 = await page.locator('.dash-hero-pick em').first().innerText().catch(() => '');
await espera(6500);
const titulo2 = await page.locator('.dash-hero-pick em').first().innerText().catch(() => '');
check(
  'o hero troca de plataforma sozinho (a cada 5s)',
  bonequinhos > 1 && titulo1 !== titulo2,
  `${titulo1} -> ${titulo2}`
);

/* ORDEM: WhatsApp -> Mais populares -> tópicos -> banner */
const ordem = await page.evaluate(() => {
  const y = (sel) => {
    const el = document.querySelector(sel);
    return el ? el.getBoundingClientRect().top + window.scrollY : null;
  };
  return {
    whatsapp: y('.whatsapp-vip-chip'),
    populares: y('.storefront-section'),
    topicos: y('.topic-cards'),
    banner: y('.cat-banner'),
  };
});
check(
  '"Mais populares" vem logo abaixo do botão do WhatsApp',
  ordem.whatsapp !== null &&
    ordem.populares !== null &&
    ordem.whatsapp < ordem.populares &&
    ordem.populares < ordem.topicos,
  JSON.stringify(ordem)
);
check(
  'os tópicos vêm depois de "Mais populares"',
  ordem.topicos !== null && ordem.populares !== null && ordem.populares < ordem.topicos,
  `${ordem.populares} < ${ordem.topicos}`
);

/* TÓPICOS: ícone de verdade (svg) e clicáveis */
const topicos = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.topic-cards .topic-card')).map((el) => ({
    tag: el.tagName,
    href: el.getAttribute('href') || '',
    temSvg: !!el.querySelector('svg'),
    texto: el.textContent.trim(),
  }))
);
check('têm tópicos na vitrine', topicos.length >= 5, `${topicos.length} tópicos`);
check('os tópicos usam ÍCONE (svg), não emoji', topicos.every((t) => t.temSvg));
check(
  'os tópicos são LINKS (clicáveis)',
  topicos.length > 0 && topicos.every((t) => t.tag === 'A' && t.href.includes('categoria=')),
  topicos[0] ? `${topicos[0].tag} ${topicos[0].href}` : 'nenhum'
);

/* AUTO-SCROLL: a fileira anda sozinha.
   Não dá para comparar só dois instantes: a fileira faz um loop, então
   pode estar em 0 no início e em 0 no fim (deu a volta). O certo é
   amostrar alguns segundos e ver se o valor MUDA ao longo do tempo.
   O mouse sai do caminho antes: com o ponteiro em cima da fileira ela
   pausa de propósito (ninguém quer a lista mexendo na hora de clicar). */
await page.mouse.move(2, 2);
const amostras = [];
for (let i = 0; i < 14; i++) {
  amostras.push(await page.locator('.storefront-circles').evaluate((el) => Math.round(el.scrollLeft)));
  await espera(600);
}
const distintos = new Set(amostras.filter((v) => v !== amostras[0]));
check(
  'a fileira de populares rola sozinha',
  distintos.size >= 1,
  amostras.join(' → ')
);

/* HERO: card clicável, sem botão e sem números no celular */
const botaoVerGrupos = await page.locator('.dash-hero-actions .dash-hero-btn').first().isVisible().catch(() => false);
check('no celular o hero NÃO tem o botão "Ver grupos"', !botaoVerGrupos);

const stats = await page.locator('.dash-hero-stats').first().isVisible().catch(() => false);
check('no celular o hero NÃO mostra os números (preço/off/grupos)', !stats);

const heroTemLink = await page.locator('.dash-hero-overlay').count();
check('o hero tem o link que cobre o card inteiro', heroTemLink === 1);

/* Clique no card (o overlay que cobre tudo) redireciona.
   O clique no TEXTO é interceptado pelo próprio overlay — é o link esticado
   que faz o card inteiro ser clicável. */
await page.locator('.dash-hero-overlay').first().click();
await espera(2500);
const urlHero = page.url();
check(
  'clicar no card do hero abre a plataforma',
  /\/dashboard\/catalog\//.test(urlHero),
  urlHero.replace(BASE_URL, '')
);

await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await espera(5000);
await fecharPortoes(page);
await espera(1200);
await page.screenshot({ path: path.join(OUT, 'mobile-visao-geral.png') });
await page.screenshot({ path: path.join(OUT, 'mobile-visao-geral-inteira.png'), fullPage: true });

/* ── TÓPICO LEVA PARA OS SERVIÇOS DA CATEGORIA ─────────────────────── */
const linkStreaming = await page.locator('.topic-cards .topic-card').first().getAttribute('href');
await page.locator('.topic-cards .topic-card').first().click();
await espera(3000);
const urlTopico = page.url();
check(
  'tocar no tópico leva para o catálogo filtrado',
  urlTopico.includes('categoria='),
  `${linkStreaming} -> ${urlTopico.replace(BASE_URL, '')}`
);

/* ── CARDS DE GRUPO ─────────────────────────────────────────────────── */
await page.goto(`${BASE_URL}/dashboard/catalog/netflix`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await espera(5000);
await fecharPortoes(page);
await espera(1200);

const cardInfo = await page.evaluate(() => {
  const card = document.querySelector('.group-card');
  if (!card) return null;
  const nome = card.querySelector('.gc-name-row');
  const cheio = card.querySelector('.gc-cheio');
  const ads = card.querySelector('.group-tag-ads, .group-tag-noads');
  const r = (el) => (el ? el.getBoundingClientRect() : null);
  return {
    temRodape: !!card.querySelector('.gc-cta-row'),
    temCheio: !!cheio,
    textoCheio: cheio ? cheio.textContent.trim() : '',
    cheioNaMesmaLinha: !!(nome && cheio && nome.contains(cheio)),
    cheioNaDireita: !!(nome && cheio && r(cheio).right > r(nome).right - 12),
    alturaAds: ads ? Math.round(r(ads).height) : 0,
    fonteAds: ads ? getComputedStyle(ads).fontSize : '',
    alturaCard: Math.round(card.getBoundingClientRect().height),
  };
});
check('o card de grupo NÃO tem mais a row de rodapé', cardInfo && !cardInfo.temRodape, JSON.stringify(cardInfo));
check(
  'a tag CHEIO aparece no card cheio',
  cardInfo && cardInfo.temCheio,
  cardInfo ? cardInfo.textoCheio : 'sem card'
);
check(
  'a tag CHEIO fica na mesma linha do nome, à direita',
  cardInfo && cardInfo.cheioNaMesmaLinha && cardInfo.cheioNaDireita,
  cardInfo ? `mesmaLinha=${cardInfo.cheioNaMesmaLinha} direita=${cardInfo.cheioNaDireita}` : ''
);
check(
  'a tag "Com/Sem anúncios" é grande e legível',
  cardInfo && cardInfo.alturaAds >= 20 && parseFloat(cardInfo.fonteAds) >= 0.7,
  cardInfo ? `${cardInfo.alturaAds}px / ${cardInfo.fonteAds}` : ''
);
check(
  'o card de grupo ficou compacto (altura < 330px)',
  cardInfo && cardInfo.alturaCard < 330,
  cardInfo ? `${cardInfo.alturaCard}px` : ''
);

const overflowPlat = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 2
);
check('plataforma no celular não tem rolagem horizontal', !overflowPlat);
await page.screenshot({ path: path.join(OUT, 'mobile-plataforma.png') });
await page.screenshot({ path: path.join(OUT, 'mobile-plataforma-inteira.png'), fullPage: true });

/* ── TABLET (abaixo de 850px a barra lateral some) ───────────────────── */
const tctx = await browser.newContext({ viewport: { width: 820, height: 1000 } });
const t = await tctx.newPage();
await sessao(t);
await t.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await espera(4000);
await fecharPortoes(t);
await espera(800);

const sidebarVisivel = await t.locator('aside').first().isVisible().catch(() => false);
const topoVisivel = await t.locator('header.fixed').first().isVisible().catch(() => false);
check('em 820px a barra lateral some', !sidebarVisivel);
check('em 820px o topo fixo (com a seta de voltar) aparece', topoVisivel);
await t.screenshot({ path: path.join(OUT, 'tablet-820.png') });

/* E em 900px a barra lateral volta */
const wctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
const w = await wctx.newPage();
await sessao(w);
await w.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded', timeout: 60000 });
await espera(4000);
await fecharPortoes(w);
await espera(800);
const sidebar900 = await w.locator('aside').first().isVisible().catch(() => false);
check('em 900px a barra lateral volta', sidebar900);

check('sem erro de JS', erros.length === 0, erros.slice(0, 2).join(' | '));

await browser.close();

const passou = results.filter((r) => r.ok).length;
console.log(`\n${passou}/${results.length} verificacoes OK`);
if (passou !== results.length) {
  console.log('\nFALHAS:');
  for (const r of results.filter((x) => !x.ok)) console.log(` - ${r.name} ${r.detail}`);
  process.exitCode = 1;
}
