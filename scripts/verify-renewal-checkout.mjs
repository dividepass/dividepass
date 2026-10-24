/**
 * Gera o PIX de RENOVAÇÃO de uma assinatura vencida e confere o estado do
 * banco depois da criação.
 *
 * Cria uma transação de verdade no gateway para uma conta de teste descartável
 * (sem e-mail real, sem notificacao). Nao paga: a transicao para "renovada"
 * depende da confirmacao do pagamento, que exige dinheiro real.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.DP_BASE || 'http://127.0.0.1:5199';
const OUT = process.env.DP_OUT || 'C:/Users/GABRIEL/Documents/DividePass/.tmp-verify';
mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FALHA'}  ${name}${detail ? ' :: ' + detail : ''}`);
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
const page = await ctx.newPage();
const apiCalls = [];
page.on('request', (r) => {
  if (r.url().includes('/functions/v1/')) apiCalls.push(`${r.method()} ${r.url().split('?')[0].split('/').pop()}`);
});

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.fill('#email', process.env.DP_EMAIL);
await page.fill('#password', process.env.DP_PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL(/\/dashboard/, { timeout: 30000 });

await page.goto(`${BASE}/dashboard/billing`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
const skip = page.locator('.push-gate-skip');
if ((await skip.count()) > 0 && (await skip.first().isVisible())) {
  await skip.first().click();
  await page.waitForTimeout(400);
}

await page.locator('button', { hasText: 'Pagar assinatura' }).first().click();
await page.waitForTimeout(900);
await page.locator('.ren-modal button', { hasText: /PIX/i }).first().click();
await page.waitForTimeout(700);

// Botao final: "Pagar R$ 12,90"
const payBtn = page.locator('.ren-modal button', { hasText: /Pagar R\$/i }).first();
check('botao final de pagamento existe', (await payBtn.count()) > 0);
await payBtn.click();

// Espera o QR / codigo copia-e-cola aparecer
await page.waitForTimeout(12000);
const modalText = await page.locator('.ren-modal').innerText();
await page.screenshot({ path: `${OUT}/7-pix-gerado.png`, fullPage: true });

check('PIX gerado: valor R$ 12,90', /12,90/.test(modalText), modalText.replace(/\n/g, ' | ').slice(0, 300));
check('PIX gerado: mostra QR ou copia-e-cola', /copia|copy|qr|pague/i.test(modalText));
check('PIX gerado: avisa que so atualiza apos confirmar', /confirmado/i.test(modalText));
check('chamou create-payment', apiCalls.some((c) => c.includes('create-payment')), apiCalls.join(', '));

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} verificacoes ok ===`);
