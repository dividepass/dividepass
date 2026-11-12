/**
 * QA — a taxa de adesão: quando é cobrada e quando NÃO é.
 *
 * Confere as três situations que a regra exige:
 *
 *   1) PRIMEIRA COMPRA num grupo que TEM taxa de adesão → a taxa é cobrada
 *      (junto com o 1º ciclo) e aparece no resumo;
 *   2) RENOVAÇÃO (a pessoa já está no grupo) → a taxa NÃO é cobrada, e o
 *      texto da tela diz isso sem dar ambiguidade;
 *   3) grupo SEM taxa de adesão → nada de taxa em lugar nenhum.
 *
 * A cobrança é interceptada (nada é cobrado de verdade).
 *
 *   npx vite --port 5273 --host 127.0.0.1
 *   node scripts/qa-taxa-adesao.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';
import { consultarSql } from './supabase-sql.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'taxa-adesao');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5273';

const GRUPO_COM_TAXA = process.env.QA_GRUPO_COM_TAXA || '111111'; // Grupo 3 (taxa R$ 9,90)
const GRUPO_SEM_TAXA = process.env.QA_GRUPO_SEM_TAXA || '222222';

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
  await fetch(`${s.url}/rest/v1/users?select=id&email=eq.${process.env.QA_EMAIL || 'qa.mavis@divteste.com'}`, { headers: H })
).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada');
  process.exit(1);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

// ── Assinatura FICTÍCIA (para a tela de renovação ter o que mostrar) ──────
// A conta QA não tem assinatura: sem uma delas a tela de renovação nem
// abre. Criamos uma e APAGAMOS no final — produção não pode ficar com lixo.
const GRUPO_TESTE_ID = '11111111-1111-1111-1111-111111111112';
let assinaturaFicticia = null;
try {
  const criadas = await consultarSql(
    `insert into user_subscriptions (user_id, group_id, service_id, status, billing_cycle, amount, original_amount, started_at, renewal_due_at, next_charge_at, gateway, payment_method, billing_status) values (` +
      `'${QA_ID}','${GRUPO_TESTE_ID}','77777777-7777-7777-7777-777777777777','active','monthly',9.90,9.90,` +
      `now() - interval '40 days', now() - interval '2 days', now() - interval '2 days','iopay','pix','active') returning id`,
  );
  assinaturaFicticia = criadas?.[0]?.id || null;
  console.log(`assinatura fictícia criada: ${assinaturaFicticia}`);
} catch (e) {
  console.error('não foi possível criar a assinatura fictícia:', e.message);
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
await context.addInitScript(
  ([key, sessao]) => { localStorage.setItem(key, sessao); },
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

const payloads = [];
await context.route('**/functions/v1/create-payment', async (route) => {
  try {
    payloads.push(JSON.parse(route.request().postData() || '{}'));
  } catch {
    /* não-JSON */
  }
  await route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'QA: interceptado (nenhuma cobrança real)' }),
  });
});

const page = await context.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));

async function fecharPortoes(p) {
  for (const sel of ['.push-gate-skip', '.pwa-gate-skip', '.push-gate-secondary', '.pwa-gate-secondary', '.push-gate-close', '.pwa-gate-close']) {
    const b = p.locator(sel).first();
    if (await b.count()) {
      await b.click({ timeout: 3000 }).catch(() => {});
      await espera(300);
    }
  }
}

/* ── 1) PRIMEIRA COMPRA num grupo COM taxa de adesão ─────────────────────── */
await page.goto(`${BASE_URL}/dashboard/checkout/${GRUPO_COM_TAXA}`, { waitUntil: 'domcontentloaded' });
await espera(4500);
await fecharPortoes(page);
await espera(800);

const tela = await page.locator('.checkout-page').innerText().catch(() => '');
console.log('--- tela da primeira compra ---\n' + tela.replace(/\n/g, ' | ').slice(0, 700));

check('a tela de primeira compra mostra a taxa de adesão', /taxa de ades/i.test(tela));
check('a primeira compra explica que a taxa é única', /única|uma única vez|pagamento único/i.test(tela), tela.replace(/\n/g, ' | ').slice(0, 200));

// Avança as telas até o pagamento (a 1ª tela é a explicação da adesão).
for (let i = 0; i < 3; i++) {
  const botao = page.locator('.checkout-page button').filter({ hasText: /Continuar|Próximo|Entendi|Pagar|Gerar PIX/ }).first();
  if (!(await botao.count())) break;
  const texto = await botao.innerText().catch(() => '');
  if (/Gerar PIX|Pagar R\$/.test(texto)) break;
  await botao.click().catch(() => {});
  await espera(1800);
}

const resumoFinal = await page.locator('.checkout-summary').first().innerText().catch(() => '');
console.log('--- resumo ---\n' + resumoFinal.replace(/\n/g, ' | '));
check('o resumo da 1ª compra mostra a linha da taxa de adesão', /Taxa de Ades/i.test(resumoFinal), resumoFinal.replace(/\n/g, ' | '));

const totalNaTela = /R\$ 19,80/.test(resumoFinal);
check('o total do resumo é taxa + ciclo (R$ 19,80)', totalNaTela, resumoFinal.replace(/\n/g, ' | '));

await page.screenshot({ path: path.join(OUT, '1-primeira-compra-com-taxa.png'), fullPage: true });

/* ── 2) A RENOVAÇÃO: a taxa NÃO é cobrada ────────────────────────────────── */
await page.goto(`${BASE_URL}/dashboard/checkout/${GRUPO_COM_TAXA}?renovacao=1`, { waitUntil: 'domcontentloaded' });
await espera(4500);
await fecharPortoes(page);
await espera(800);

const telaRenovacao = await page.locator('.checkout-page').innerText().catch(() => '');
console.log('--- tela da renovação ---\n' + telaRenovacao.replace(/\n/g, ' | ').slice(0, 700));

const temBanner = (await page.locator('.checkout-renewal-banner').count()) > 0;
check('a renovação mostra o banner de renovação', temBanner);

const banner = await page.locator('.checkout-renewal-banner').innerText().catch(() => '');
console.log('--- banner ---\n' + banner.replace(/\n/g, ' | '));

// O texto NÃO pode falar da taxa de adesão na renovação: ela já foi paga na
// entrada e só confunde quem está renovando.
check('o banner da renovação não fala de taxa de adesão', !/adesão/i.test(banner), banner.replace(/\n/g, ' | '));

const resumoRenovacao = await page.locator('.checkout-summary').first().innerText().catch(() => '');
// Na renovação a taxa de adesão não aparece: nem no resumo, nem no total.
// Só o ciclo.
check(
  'o resumo da renovação NÃO menciona a taxa de adesão',
  !/adesão/i.test(resumoRenovacao),
  resumoRenovacao.replace(/\n/g, ' | ')
);
check('o total da renovação é só o ciclo (R$ 9,90)', /R\$ 9,90/.test(resumoRenovacao) && !/R\$ 19,80/.test(resumoRenovacao), resumoRenovacao.replace(/\n/g, ' | '));

await page.screenshot({ path: path.join(OUT, '2-renovacao-sem-taxa.png'), fullPage: true });

/* ── 2b) MEMBRO DO GRUPO COM ASSINATURA ATRASADA (sem ?renovacao=1) ────── */
//
// O caso que a regra cobre: a pessoa JÁ está no grupo (o vínculo existe) e
// a assinatura está atrasada. A taxa de adesão é da PRIMEIRA entrada — ela
// já entrou, então a taxa não é cobrada de novo.
let membroFicticio = null;
try {
  const criados = await consultarSql(
    `insert into group_members (group_id, user_id, status, payment_status, joined_at) values ` +
      `('${GRUPO_TESTE_ID}','${QA_ID}','active','overdue', now() - interval '40 days') returning id`,
  );
  membroFicticio = criados?.[0]?.id || null;
  console.log(`vínculo fictício criado: ${membroFicticio}`);
} catch (e) {
  console.error('não foi possível criar o vínculo fictício:', e.message);
}

await page.goto(`${BASE_URL}/dashboard/checkout/${GRUPO_COM_TAXA}`, { waitUntil: 'domcontentloaded' });
await espera(4500);
await fecharPortoes(page);
await espera(1200);

const telaAtrasada = await page.locator('.checkout-page').innerText().catch(() => '');
check('membro com assinatura atrasada NÃO vê a taxa de adesão', !/taxa de ades/i.test(telaAtrasada), telaAtrasada.replace(/\n/g, ' | ').slice(0, 260));
await page.screenshot({ path: path.join(OUT, '2b-membro-atrasado-sem-taxa.png'), fullPage: true });

/* ── 3) GRUPO SEM TAXA DE ADESÃO ─────────────────────────────────────────── */
await page.goto(`${BASE_URL}/dashboard/checkout/${GRUPO_SEM_TAXA}`, { waitUntil: 'domcontentloaded' });
await espera(4500);
await fecharPortoes(page);
await espera(800);

const telaSemTaxa = await page.locator('.checkout-page').innerText().catch(() => '');
check('grupo sem taxa não fala de taxa de adesão', !/taxa de ades/i.test(telaSemTaxa), telaSemTaxa.replace(/\n/g, ' | ').slice(0, 200));
await page.screenshot({ path: path.join(OUT, '3-grupo-sem-taxa.png'), fullPage: true });

check('sem erro de JS na tela', erros.length === 0, erros.slice(0, 3).join(' | '));

await browser.close();

// ── LIMPEZA ────────────────────────────────────────────────────────────────
if (membroFicticio) {
  try {
    await consultarSql(`delete from group_members where id = '${membroFicticio}'`);
    console.log(`vínculo fictício apagado: ${membroFicticio}`);
  } catch (e) {
    console.error(`ATENÇÃO: não consegui apagar o vínculo fictício ${membroFicticio}: ${e.message}`);
  }
}

if (assinaturaFicticia) {
  try {
    await consultarSql(`delete from user_subscriptions where id = '${assinaturaFicticia}'`);
    console.log(`assinatura fictícia apagada: ${assinaturaFicticia}`);
  } catch (e) {
    console.error(`ATENÇÃO: não consegui apagar a assinatura fictícia ${assinaturaFicticia}: ${e.message}`);
  }
}

const falhas = results.filter((r) => !r.ok);
console.log('');
console.log(`RESULTADO: ${results.length - falhas.length}/${results.length} checks OK`);
console.log(`Screenshots em: ${OUT}`);
if (falhas.length) {
  falhas.forEach((f) => console.log(`  FALHOU: ${f.name} ${f.detail || ''}`));
  process.exit(1);
}
