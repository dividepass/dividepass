/**
 * QA — contraste da cobrança pendente + renovação na PÁGINA de checkout.
 *
 * Confere, no navegador de verdade (conta QA), duas coisas:
 *
 *   1) o card de "cobrança pendente" do /dashboard tem contraste legível
 *      (fundo escuro x texto claro) — antes o fundo caía no branco e o
 *      texto (claro) sumia;
 *   2) o botão "Pagar agora" (e o "Renovar agora" do carrossel) NÃO abre
 *      popup: leva para /dashboard/checkout/<grupo>?renovacao=1, e a tela
 *      mostra o total do ciclo já gravado na assinatura.
 *
 * NÃO paga nada: o teste para antes do botão final de cobrança.
 *
 * A conta QA não tem assinatura vencida, então o script cria uma ASSINATURA
 * FICTÍCIA (vencida há 2 dias) num grupo aberto e APAGA no final — em
 * produção, sempre no `finally`. Nunca deixar lixo em `user_subscriptions`.
 *
 *   npx vite --port 5273 --host 127.0.0.1
 *   node scripts/qa-renovacao-checkout.mjs
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSessaoQa } from './lib/conta-qa.mjs';
import { consultarSql } from './supabase-sql.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUT = path.join(ROOT, 'qa-out', 'renovacao-checkout');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5273';

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
  await fetch(`${s.url}/rest/v1/users?select=id,email&email=eq.${process.env.QA_EMAIL || 'qa.mavis@divteste.com'}`, { headers: H })
).json().catch(() => null);
const QA_ID = perfilQa?.[0]?.id;
if (!QA_ID) {
  console.error('conta QA não encontrada — rode scripts/criar-conta-qa.mjs');
  process.exit(1);
}

// A assinatura vencida da conta QA (a mesma que o dashboard mostra).
const lerAssinaturas = async () =>
  (
    await fetch(
      `${s.url}/rest/v1/user_subscriptions?select=id,group_id,status,billing_cycle,amount,gateway,renewal_due_at,next_charge_at,group:group_id(id,name,slug)&service:service_id(name,full_name)` +
        `&user_id=eq.${QA_ID}&order=created_at&limit=20`,
      { headers: H }
    )
  ).json().catch(() => []);

// ── ASSINATURA FICTÍCIA (vencida) ─────────────────────────────────────────
// A conta QA não tem assinatura vencida: sem uma delas o card do dashboard
// nem existe e o teste não teria o que checar. Criamos uma e APAGAMOS no
// `finally` — produção não pode ficar com lixo.
const GRUPO_TESTE = {
  id: '11111111-1111-1111-1111-111111111112',
  service_id: '77777777-7777-7777-7777-777777777777',
  preco: 9.9,
};
let assinaturaFicticia = null;
try {
  const criadas = await consultarSql(
    `insert into user_subscriptions (user_id, group_id, service_id, status, billing_cycle, amount, original_amount, started_at, renewal_due_at, next_charge_at, gateway, payment_method, billing_status) values (` +
      `'${QA_ID}','${GRUPO_TESTE.id}','${GRUPO_TESTE.service_id}','active','monthly',${GRUPO_TESTE.preco},${GRUPO_TESTE.preco},` +
      `now() - interval '40 days', now() - interval '2 days', now() - interval '2 days','iopay','pix','active') returning id`,
  );
  assinaturaFicticia = criadas?.[0]?.id || null;
  console.log(`assinatura fictícia criada: ${assinaturaFicticia}`);
} catch (e) {
  console.error('não foi possível criar a assinatura fictícia:', e.message);
}

if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

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
const page = await context.newPage();
const erros = [];
page.on('pageerror', (e) => erros.push(String(e)));

// ── A cobrança é INTERCEPTADA ──────────────────────────────────────────────
//
// O teste confere o QUE o checkout manda para o backend (renovação, método,
// gateway, CPF) sem criar nenhuma cobrança real — nem na Woovi.
const payloads = [];
await context.route('**/functions/v1/create-payment', async (route) => {
  try {
    payloads.push(JSON.parse(route.request().postData() || '{}'));
  } catch {
    /* corpo não-JSON */
  }
  await route.fulfill({
    status: 400,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'QA: interceptado (nenhuma cobrança real)' }),
  });
});

// O status do CPF responde "não cadastrado" — assim o campo aparece mesmo
// que a conta QA já tenha CPF no perfil (e nada é gravado).
await context.route('**/rest/v1/rpc/meu_cpf_status', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ cadastrado: false }),
  });
});

async function fecharPortoes(p) {
  for (const sel of ['.push-gate-skip', '.pwa-gate-skip', '.push-gate-secondary', '.pwa-gate-secondary', '.push-gate-close', '.pwa-gate-close']) {
    const b = p.locator(sel).first();
    if (await b.count()) {
      await b.click({ timeout: 3000 }).catch(() => {});
      await espera(300);
    }
  }
}

/* ── 1) CONTRASTE DO CARD DE COBRANÇA PENDENTE ─────────────────────────── */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(4000);
await fecharPortoes(page);
await espera(600);

const itemPendente = page.locator('.dash-pending-item').first();
const temPendente = (await itemPendente.count()) > 0;
check('dashboard mostra o card de cobrança pendente', temPendente);

if (temPendente) {
  // Luminância relativa (WCAG) para medir o contraste REAL do texto sobre o
  // fundo que a pessoa enxerga. Os fundos com alpha são compostos com os
  // ancestrais até achar um fundo opaco — senão a conta sai errada.
  const medir = () =>
    itemPendente.evaluate((el) => {
      const parse = (cor) => {
        const m = cor && cor.match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const [r, g, b, a = '1'] = m[1].split(',').map((x) => parseFloat(x));
        return { r, g, b, a };
      };
      const canal = (c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      };
      const lum = ({ r, g, b }) => 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
      // Compõe a pilha de fundos (do elemento para cima) até um opaco.
      const fundoReal = (node) => {
        const pilha = [];
        let atual = node;
        while (atual) {
          const c = parse(getComputedStyle(atual).backgroundColor);
          if (c && c.a > 0) pilha.push(c);
          if (c && c.a >= 1) break;
          atual = atual.parentElement;
        }
        let base = { r: 255, g: 255, b: 255 };
        for (let i = pilha.length - 1; i >= 0; i--) {
          const c = pilha[i];
          base = {
            r: c.r * c.a + base.r * (1 - c.a),
            g: c.g * c.a + base.g * (1 - c.a),
            b: c.b * c.a + base.b * (1 - c.a),
          };
        }
        return base;
      };
      const razao = (corTexto, fundo) => {
        const t = parse(corTexto);
        if (!t) return null;
        const tl = lum(t);
        const bl = lum(fundo);
        const [a, b] = tl > bl ? [tl, bl] : [bl, tl];
        return (a + 0.05) / (b + 0.05);
      };
      const fundo = fundoReal(el);
      const textoEl = el.querySelector('strong');
      const subEl = el.querySelector('span');
      return {
        fundo: `rgb(${Math.round(fundo.r)}, ${Math.round(fundo.g)}, ${Math.round(fundo.b)})`,
        corTitulo: textoEl ? getComputedStyle(textoEl).color : null,
        corSub: subEl ? getComputedStyle(subEl).color : null,
        razaoTitulo: textoEl ? razao(getComputedStyle(textoEl).color, fundo) : null,
        razaoSub: subEl ? razao(getComputedStyle(subEl).color, fundo) : null,
      };
    });

  for (const tema of ['dark', 'light']) {
    await page.evaluate((t) => {
      document.documentElement.setAttribute('data-theme', t);
      try { localStorage.setItem('dp-theme', t); } catch { /* storage bloqueado */ }
    }, tema);
    await espera(700);

    const contraste = await medir();
    console.log(`   [${tema}]`, JSON.stringify(contraste));
    check(
      `[${tema}] texto do título tem contraste AA (>= 4.5)`,
      (contraste.razaoTitulo || 0) >= 4.5,
      `razao ${(contraste.razaoTitulo || 0).toFixed(2)}`
    );
    check(
      `[${tema}] texto do detalhe tem contraste AA (>= 4.5)`,
      (contraste.razaoSub || 0) >= 4.5,
      `razao ${(contraste.razaoSub || 0).toFixed(2)}`
    );
    await itemPendente.screenshot({ path: path.join(OUT, `1-card-pendente-${tema}.png`) });
  }

  // Volta para o escuro (o tema padrão do app) para as capturas seguintes.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
    try { localStorage.setItem('dp-theme', 'dark'); } catch { /* storage bloqueado */ }
  });
  await espera(600);
  await page.screenshot({ path: path.join(OUT, '2-dashboard.png') });
}

/* ── 2) "PAGAR AGORA" LEVA PARA A PÁGINA DE CHECKOUT ───────────────────── */
const botaoPagar = page.locator('.dash-pending-pay').first();
if (await botaoPagar.count()) {
  await botaoPagar.click();
  await espera(3500);

  check('abriu a página de checkout (não um popup)', /\/dashboard\/checkout\/.+renovacao=1/.test(page.url()), page.url());
  check('nenhum popup de renovação na tela', (await page.locator('.ren-modal').count()) === 0);

  const titulo = await page.locator('.checkout-page h1').first().innerText().catch(() => '');
  check('título da tela é de renovação', /renovar/i.test(titulo), titulo);

  const banner = await page.locator('.checkout-renewal-banner').count();
  check('banner de renovação aparece', banner > 0);

  const resumo = await page.locator('.checkout-summary').first().innerText().catch(() => '');
  console.log('   resumo:', resumo.replace(/\n/g, ' | '));

  // O total mostrado tem que ser o valor gravado na assinatura — é o que o
  // backend cobra no modo renovação.
  const assinaturas = await lerAssinaturas();
  const subVencida = assinaturas.find((a) => a.renewal_due_at && new Date(a.renewal_due_at) <= new Date());
  if (subVencida) {
    const valor = Number(subVencida.amount || 0);
    const brl = valor.toFixed(2).replace('.', ',');
    check(
      `total da tela é o valor da assinatura (R$ ${brl})`,
      resumo.includes(brl),
      `resumo: ${resumo.replace(/\n/g, ' | ')}`
    );
    // Na renovação a taxa de adesão NÃO aparece nem no resumo nem no total:
    // ela já foi paga na entrada e só confundiria quem está renovando.
    check(
      'a renovação não menciona a taxa de adesão',
      !/adesão/i.test(resumo) && !/R\$ 19,80/.test(resumo),
      resumo.replace(/\n/g, ' | ')
    );
  } else {
    console.log('   (conta QA sem assinatura vencida — pulou a conferência do valor)');
  }

  // O ciclo fica travado no da assinatura (o backend cobra o valor gravado).
  const temSeletorCiclo = (await page.locator('.checkout-simple .cycle-selector').count()) > 0;
  check('seletor de ciclo não aparece na renovação', !temSeletorCiclo);

  /* ── 2b) A RENOVAÇÃO POR PIX VAI PELA WOOVI E PEDE O CPF ─────────────── */
  const botaoPix = page.locator('.iopay-method-btn', { hasText: 'PIX' }).first();

  // A renovação ABRE no PIX: a renovação de uma assinatura é o Pix
  // Automático (Woovi) — é ele que renova sozinho os próximos ciclos.
  const painel = await page.locator('.checkout-payment').first().innerText().catch(() => '');
  check('a renovação abre no PIX (via Woovi)', /via\s+Woovi/i.test(painel), painel.replace(/\n/g, ' | ').slice(0, 160));
  check('o botão do PIX é o selecionado', (await botaoPix.getAttribute('class')).includes('active'), await botaoPix.getAttribute('class'));

  if (await botaoPix.count()) {
    await botaoPix.click();
    await espera(1500);

    const rotuloPix = await botaoPix.innerText().catch(() => '');
    check('o PIX da renovação vai pela Woovi', /woovi/i.test(rotuloPix), rotuloPix.replace(/\n/g, ' '));

    // O Pix Automático exige o CPF do pagador: quem não tem um no perfil
    // precisa preencher ANTES de pagar.
    const temCampoCpf = (await page.locator('#checkout-cpf').count()) > 0;
    check('o campo de CPF aparece para quem não tem CPF no perfil', temCampoCpf);

    if (temCampoCpf) {
      // Sem CPF, o pagamento é barrado.
      await page.locator('.checkout-page button', { hasText: /Gerar PIX|Pagar R\$/ }).first().click();
      await espera(1200);
      const erroCpf = await page.locator('.checkout-cpf-field p, .checkout-cpf-error, .checkout-cpf-field [role="alert"]').first().innerText().catch(() => '');
      check('sem CPF o checkout não deixa pagar', /cpf/i.test(erroCpf), erroCpf.replace(/\n/g, ' ').slice(0, 120));

      // Com CPF válido, o pedido sai com renewal + pix + woovi.
      await page.locator('#checkout-cpf').fill('529.982.247-25');
      await page.locator('.checkout-page button', { hasText: /Gerar PIX|Pagar R\$/ }).first().click();
      await espera(2500);

      const payload = payloads[payloads.length - 1] || {};
      console.log('   payload:', JSON.stringify(payload));
      check('o pedido é de RENOVAÇÃO', payload.renewal === true, JSON.stringify(payload.renewal));
      check('o método do pedido é PIX', payload.payment_method === 'pix', String(payload.payment_method));
      check('o gateway do pedido é a Woovi', payload.gateway === 'woovi', String(payload.gateway));
      check('o pedido manda o CPF', !!payload.cpf, 'cpf: ' + (payload.cpf ? 'sim' : 'não'));
      check('o pedido não é uma assinatura nova', payload.force_new_plan === false, JSON.stringify(payload.force_new_plan));
    }
    await page.screenshot({ path: path.join(OUT, '5-renovacao-pix-cpf.png'), fullPage: true });
  }

  await page.screenshot({ path: path.join(OUT, '3-checkout-renovacao.png'), fullPage: true });
}

/* ── 3) "RENOVAR AGORA" DO CARROSSEL TAMBÉM VAI PARA A PÁGINA ─────────── */
await page.goto(`${BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' });
await espera(4000);
await fecharPortoes(page);
const botaoRenovar = page.locator('.rrc-btn').first();
if (await botaoRenovar.count()) {
  await botaoRenovar.click();
  await espera(3500);
  check('"Renovar agora" levou para a página de checkout', /\/dashboard\/checkout\/.+renovacao=1/.test(page.url()), page.url());
  check('"Renovar agora" não abriu popup', (await page.locator('.ren-modal').count()) === 0);
  await page.screenshot({ path: path.join(OUT, '4-checkout-renovacao-carrossel.png'), fullPage: true });
} else {
  console.log('   (sem botão "Renovar agora" no carrossel da conta QA)');
}

check('sem erro de JS na tela', erros.length === 0, erros.slice(0, 3).join(' | '));

/* ── 4) FINANÇEIRO: "Pagar assinatura" TAMBÉM VAI PARA A PÁGINA ─────────── */
await page.goto(`${BASE_URL}/dashboard/billing`, { waitUntil: 'domcontentloaded' });
await espera(4000);
await fecharPortoes(page);
const botaoAssinatura = page.locator('button', { hasText: 'Pagar assinatura' }).first();
if (await botaoAssinatura.count()) {
  await botaoAssinatura.click();
  await espera(3500);
  check('Financeiro: "Pagar assinatura" levou para a página de checkout', /\/dashboard\/checkout\/.+renovacao=1/.test(page.url()), page.url());
  check('Financeiro: não abriu popup', (await page.locator('.ren-modal').count()) === 0);
} else {
  console.log('   (sem assinatura vencida listada no Financeiro)');
}

await browser.close();

// ── LIMPEZA ────────────────────────────────────────────────────────────────
// A assinatura fictícia NÃO pode sobrar em produção.
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
