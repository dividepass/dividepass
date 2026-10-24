/**
 * Verificacao visual da rodada "assinatura vencida" (rodada 5).
 *
 * Entra no dev server com o usuario de teste (assinatura Spotify 01 vencida
 * em 09/04/2026, fatura de R$ 12,90) e confere as tres telas pedidas:
 *   1. /dashboard/billing               -> card "Vencida" + "Pagar assinatura"
 *   2. /dashboard/credentials/spotify   -> popup de acesso bloqueado
 *   3. /dashboard                        -> tag "Vencida" em Minhas Assinaturas
 *
 * Nao clica em "Pagar assinatura": isso geraria um PIX real.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DP_BASE || 'http://127.0.0.1:5199';
const EMAIL = process.env.DP_EMAIL;
const PASSWORD = process.env.DP_PASSWORD;
const GROUP = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const OUT = process.env.DP_OUT || 'C:/Users/GABRIEL/Documents/DividePass/.tmp-verify';

mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];

function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FALHA'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text().slice(0, 300)}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${String(e).slice(0, 300)}`));
page.on('response', (r) => {
  if (r.status() >= 400 && /functions\/v1|rest\/v1/.test(r.url())) {
    errors.push(`[http ${r.status()}] ${r.url().split('?')[0].slice(-110)}`);
  }
});

/** O gate de push aparece sobre a tela e intercepta os cliques. */
async function dismissPushGate() {
  const skip = page.locator('.push-gate-skip');
  if ((await skip.count()) > 0 && (await skip.first().isVisible())) {
    await skip.first().click();
    await page.waitForTimeout(400);
  }
}

// ── Login ────────────────────────────────────────────────────────────────
await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', EMAIL);
await page.fill('#password', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/dashboard/, { timeout: 30000 });
await page.waitForTimeout(2500);
check('login no dev server', page.url().includes('/dashboard'), page.url());

// ── 1) /dashboard/billing ────────────────────────────────────────────────
await page.goto(`${BASE}/dashboard/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
await dismissPushGate();
const billingText = await page.locator('body').innerText();
await page.screenshot({ path: `${OUT}/1-billing.png`, fullPage: true });

const subCard = page.locator('.billing-sub-card, .billing-subscription-card, [class*="billing-sub-card"]').first();
const cardText = (await subCard.count()) > 0 ? await subCard.innerText() : billingText.slice(0, 600);
console.log('\n--- TEXTO DO CARD DE ASSINATURA ---\n' + cardText + '\n---');

check('billing: tag "Vencida"', /Vencida/i.test(billingText));
check('billing: botao "Pagar assinatura"', /Pagar assinatura/i.test(billingText));
check('billing: total R$ 12,90', /12,90/.test(billingText));
check('billing: sem "Cobrança ainda não gerada"', !/Cobrança ainda n/i.test(billingText));
check('billing: vencimento 09/04/2026', /09\/04\/2026/.test(cardText), cardText.replace(/\n/g, ' | ').slice(0, 300));

// ── 2) /dashboard/credentials/spotify?group=... ──────────────────────────
await page.goto(`${BASE}/dashboard/credentials/spotify?group=${GROUP}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await dismissPushGate();
await page.screenshot({ path: `${OUT}/2-credenciais-bloqueadas.png`, fullPage: true });
const credText = await page.locator('body').innerText();
console.log('\n--- TEXTO DA PAGINA DE CREDENCIAIS ---\n' + credText.slice(0, 900) + '\n---');

const credBtn = page.locator('button', { hasText: 'Acessar Credenciais' }).first();
const hasBtn = (await credBtn.count()) > 0;
check('credenciais: botao "Acessar Credenciais" existe', hasBtn);

if (hasBtn) {
  await credBtn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/3-popup-renovacao.png`, fullPage: true });
  const modalText = await page.locator('body').innerText();
  check('popup: titulo "Renovação em atraso"', /Renovação em atraso/i.test(modalText));
  check('popup: total a pagar R$ 12,90', /12,90/.test(modalText));
  check('popup: botao "Pagar assinatura"', /Pagar assinatura/i.test(modalText));
  check('popup: nao revela a senha', !/senha\s*:/i.test(modalText));
}

// ── 3) /dashboard (Minhas Assinaturas) ──────────────────────────────────
await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);
await dismissPushGate();
await page.screenshot({ path: `${OUT}/4-dashboard-carrossel.png`, fullPage: true });
const dashText = await page.locator('body').innerText();
const sacCard = page.locator('.sac-card').first();
const sacText = (await sacCard.count()) > 0 ? await sacCard.innerText() : '';
check('carrossel: card existe', (await sacCard.count()) > 0);
check('carrossel: tag "Vencida"', /Vencida/i.test(sacText), sacText.replace(/\n/g, ' | '));
check('dashboard: secao Minhas Assinaturas', /Minhas Assinaturas/i.test(dashText));

// ── Erros de console ─────────────────────────────────────────────────────
const relevant = errors.filter((e) => !/favicon|404 \(Not Found\)/i.test(e));
check('sem erro de console/rede nas telas', relevant.length === 0, relevant.slice(0, 6).join(' || '));

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} verificacoes ok ===`);
process.exit(failed.length ? 1 : 0);
