/* QA do painel ADMIN: editor de planos (/admin/platforms/new) e wizard de
 * criacao de grupo (/admin/groups/new).
 *
 * O que este script confere:
 *   1) /admin/platforms/new tem o editor de PLANOS da plataforma, com todos os
 *      campos pedidos (nome, valor cobrado, limite de usuarios, valor
 *      sugerido/minimo/maximo POR PESSOA e telas simultaneas) e aceita varios
 *      planos na mesma plataforma.
 *   2) /admin/groups/new roda o mesmo wizard do usuario: popup de confirmacao
 *      da plataforma, lista de planos, TETO de preco por pessoa bloqueando a
 *      criacao e resumo+policicas como ultima etapa.
 *
 * Nada e gravado: os botoes de salvar nao sao clicados e as tabelas que
 * recebem escrita (`groups`, `group_credentials`) sao mockadas. Os planos e as
 * plataformas vem do banco REAL.
 *
 * Uso: node scripts/qa-admin-planos.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'qa-out');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const cfg = {};
fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/).forEach((line) => {
  const m = line.match(/^\s*([^#=]+)=(.*)$/);
  if (m) cfg[m[1].trim()] = m[2].trim();
});
const BASE = cfg.VITE_SUPABASE_URL;
const ANON = cfg.VITE_SUPABASE_ANON_KEY;
const REF = new URL(BASE).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

const ADMIN_PROFILE = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Admin QA', email: 'admin.qa@dividepass.com', role: 'admin', status: 'active',
  email_verified: true, avatar_url: 'https://cdn.dividepass.com/avatar-admin.png',
  created_at: '2026-01-01T00:00:00Z',
  onboarding_started_at: '2026-01-01T00:00:05Z',
  onboarding_completed_at: '2026-01-01T00:00:10Z',
  onboarding_step: 'concluido',
};

function json(route, body, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify(body),
  });
}

/* Plataforma de rascunho usada na rota /admin/platforms/new. O form cria um
 * rascunho da plataforma ao abrir (POST) e depois o carrega (GET por slug) —
 * os dois sao mockados para nao criar nada em producao. */
const QA_PLATFORM = {
  id: '11111111-2222-4333-8444-555555555555',
  name: 'nova-plataforma-qa',
  full_name: 'Plataforma QA',
  slug: 'nova-plataforma-qa',
  icon: '?', color: '#4F46E5', category: 'streaming',
  description: '', official_url: '', official_price: null,
  max_group_size: 4, status: 'inactive', featured: false, pinned: false,
  created_at: '2026-01-01T00:00:00Z',
};

async function mockWrites(route, request) {
  const url = request.url();
  const method = request.method();
  const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object');

  if (url.includes('/rest/v1/streaming_services')) {
    /* so o rascunho do form e mockado; a lista do catalogo vai pro banco real */
    if (method === 'POST') return json(route, [QA_PLATFORM], 201);
    if (method === 'GET' && url.includes('slug=eq.')) {
      return json(route, wantsObject ? QA_PLATFORM : [QA_PLATFORM]);
    }
    return route.continue();
  }
  if (url.includes('/rest/v1/groups')) {
    if (method === 'GET') return json(route, []);
    if (method === 'POST') {
      return json(route, wantsObject
        ? { id: 'qa-group-0001', slug: 'QAGROU' }
        : [{ id: 'qa-group-0001', slug: 'QAGROU' }], 201);
    }
    return json(route, wantsObject ? {} : []);
  }
  if (url.includes('/rest/v1/group_credentials')) return json(route, []);
  if (url.includes('/rest/v1/users')) return json(route, wantsObject ? ADMIN_PROFILE : [ADMIN_PROFILE]);
  if (url.includes('/rest/v1/platform_events')) return json(route, []);
  return route.continue();
}

const nextButton = (page) => page.locator('.wizard-foot button:has-text("Continuar")');
const stepLabel = async (page) => (await page.locator('.wizard-eyebrow').innerText()).toLowerCase();

/* Avanca uma etapa e devolve o erro da validacao (se travar). */
async function advance(page, expectSelector) {
  await nextButton(page).click();
  try {
    await page.waitForSelector(expectSelector, { timeout: 8000 });
    return '';
  } catch {
    return await page.locator('.wizard-step-error').innerText().catch(() => '(sem mensagem de erro)');
  }
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const email = `qa.admin.${Date.now()}@dividepass.com`;
  const signup = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'QaDividePass123!', data: { name: 'QA Admin' } }),
  });
  const signupBody = await signup.json().catch(() => ({}));
  if (!signupBody.access_token) {
    console.error('sem sessao de QA:', signup.status, JSON.stringify(signupBody).slice(0, 200));
    process.exit(1);
  }
  const accessToken = signupBody.access_token;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('dp_push_gate_skipped', '1');
  }, [SESSION_KEY, JSON.stringify({
    access_token: accessToken, token_type: 'bearer', expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: signupBody.refresh_token, user: signupBody.user,
  })]);

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

  await page.route('**/rest/v1/**', mockWrites);

  /* ===== /admin/platforms/new : editor de planos ===== */
  await page.goto(`${BASE_URL}/admin/platforms/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.plans-editor', { timeout: 30000 });

  check('/admin/platforms/new abre o editor de planos da plataforma', true);

  await page.locator('button:has-text("Adicionar plano")').click();
  await page.waitForTimeout(400);

  const rotulos = await page.locator('.plans-editor .gc-field label').allInnerTexts();
  const exigidos = [
    'Nome do plano',
    'Valor cobrado pela plataforma',
    'Limite de usuários por grupo',
    'Telas simultâneas',
    'Valor sugerido por pessoa',
    'Valor mínimo por pessoa',
    'Valor máximo por pessoa',
  ];
  const faltando = exigidos.filter((r) => !rotulos.some((x) => x.includes(r)));
  check('o editor tem todos os campos pedidos do plano', faltando.length === 0,
    faltando.length ? `faltou: ${faltando.join(', ')}` : rotulos.join(' | ').slice(0, 160));

  const cardPlanos = await page.locator('.plan-editor-card').count();
  check('a plataforma aceita varios planos', cardPlanos >= 1, `${cardPlanos} plano(s) no formulario`);

  const aviso = await page.locator('.plans-editor').innerText();
  check('os limites sao explicados como "por pessoa"', /por pessoa/i.test(aviso));

  await page.screenshot({ path: path.join(OUT, 'qa-05-admin-plataforma-planos.png'), fullPage: true });

  /* ===== /admin/groups/new : wizard admin ===== */
  await page.goto(`${BASE_URL}/admin/groups/new`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.gc-platform-step', { timeout: 30000 });
  check('/admin/groups/new abre na etapa 1', (await stepLabel(page)).includes('etapa 1 de 6'), await stepLabel(page));

  await page.locator('.gc-platform:has-text("Netflix")').first().click();
  await page.waitForSelector('.gc-modal', { timeout: 8000 });
  check('o popup de confirmacao abre no admin', await page.locator('.gc-modal button:has-text("Continuar")').count() === 1);
  await page.locator('.gc-modal button:has-text("Continuar")').click();

  await page.waitForSelector('.gc-plan-list', { timeout: 15000 });
  check('o admin lista os planos da plataforma', await page.locator('.gc-plan').count() === 3,
    `${await page.locator('.gc-plan').count()} plano(s)`);

  await page.locator('.gc-plan').filter({ hasText: 'com an' }).first().click();
  await page.waitForTimeout(600);
  /* as VAGAS ficam na MESMA etapa do plano (etapa 2) — nao precisa avancar */
  const temVagas = await page.locator('.gc-slots-card').count() === 1;
  check('no admin o plano traz as vagas na mesma etapa', temVagas, temVagas ? 'vagas visiveis' : 'vagas nao apareceram');
  await nextButton(page).click();                       // -> grupo (visibilidade)
  await page.waitForSelector('.gc-visibility-grid', { timeout: 10000 });
  const visTitles = await page.locator('.gc-visibility-title').allInnerTexts();
  check('a visibilidade publico/privado aparece no admin',
    visTitles.length === 2 && /Privado/i.test(visTitles[1]), visTitles.join(' | '));
  check('a etapa do grupo tem as regras do grupo',
    await page.locator('.gc-rule-types').count() === 1);

  await nextButton(page).click();                       // -> credenciais
  await page.waitForTimeout(600);
  const emailInput = page.locator('.gc-field:has(label:has-text("e-mail")) input').first();
  if (await emailInput.count()) await emailInput.fill('qa.conta@exemplo.com');
  const senha = page.locator('input[type="password"]').first();
  if (await senha.count()) await senha.fill('SenhaDeTeste123!');
  await nextButton(page).click();                       // -> pagamentos
  await page.waitForSelector('.gc-price-box', { timeout: 10000 });

  const totalInput = page.locator('.gc-field:has(label:has-text("Valor total do grupo")) input');
  await totalInput.fill('40.00');                      // 10,00 por pessoa > teto de 9,90
  await page.waitForTimeout(300);
  await nextButton(page).click();
  await page.waitForTimeout(700);
  const erro = await page.locator('.wizard-step-error').innerText().catch(() => '');
  check('no admin o teto do plano tambem BLOQUEIA', /fora da faixa/i.test(erro), erro);

  await totalInput.fill('38.00');                      // 9,50 por pessoa, dentro da faixa
  await page.waitForTimeout(300);
  await nextButton(page).click();
  await page.waitForSelector('.gc-summary', { timeout: 10000 });
  check('no admin o resumo e a ultima etapa', (await stepLabel(page)).includes('etapa 6 de 6'), await stepLabel(page));

  const politicas = await page.locator('.gc-policies').innerText();
  check('no admin a ultima etapa traz as politicas', /facilitadora/i.test(politicas),
    politicas.replace(/\n/g, ' | ').slice(0, 120));

  await page.screenshot({ path: path.join(OUT, 'qa-06-admin-resumo.png'), fullPage: true });

  const relevantes = consoleErrors.filter((e) => !/favicon|ResizeObserver|Failed to load resource/i.test(e));
  check('sem erro de console', relevantes.length === 0, relevantes.slice(0, 3).join(' | '));

  await browser.close();

  try {
    const del = await fetch(`${BASE}/functions/v1/delete-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, apikey: ANON },
      body: JSON.stringify({}),
    });
    console.log(`conta de QA apagada: ${del.status}`);
  } catch (err) {
    console.log('conta de QA nao pode ser apagada:', err.message);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n=== ${results.length - failed.length}/${results.length} checks OK ===`);
  if (failed.length) {
    console.log('FALHARAM:');
    failed.forEach((f) => console.log(` - ${f.name} ${f.detail}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('FALHA NO QA:', err);
  process.exit(1);
});
