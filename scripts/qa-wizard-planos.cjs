/* QA do wizard de criacao de grupo com os planos REAIS de producao.
 *
 * O wizard tem 6 ETAPAS (a mesma trilha em /dashboard/my-groups/create e
 * /admin/groups/new):
 *   1. Plataforma  — busca, "Mais usadas" no topo e POPUP de confirmacao;
 *   2. Plano       — planos da plataforma + vagas + status da assinatura;
 *   3. Grupo       — visibilidade publico/privado + regras do grupo;
 *   4. Credenciais — acesso dos membros;
 *   5. Pagamentos  — ciclos, PIX e o valor (faixa do plano por pessoa);
 *   6. Resumo      — resumo + politicas; "Criar grupo" so libera com a
 *                    politica aceita.
 *
 * O que e MOCKADO (para nao sujar a producao):
 *   - `groups` e `group_credentials` (o wizard grava rascunho automaticamente)
 *   - `users` (perfil de admin, para abrir /admin/groups/new)
 *
 * O que e REAL (o que esta sob teste):
 *   - `service_plans`, `streaming_services`, `app_settings`
 *
 * Uso: node scripts/qa-wizard-planos.cjs
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

/* So intercepta o que grava; o resto (planos, plataformas) vai pro banco real. */
async function mockWrites(route, request) {
  const url = request.url();
  const method = request.method();
  const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object');

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

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  /* sessao de QA (conta descartavel) */
  const email = `qa.wizard.${Date.now()}@dividepass.com`;
  const signup = await fetch(`${BASE}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'QaDividePass123!', data: { name: 'QA Wizard' } }),
  });
  const signupBody = await signup.json().catch(() => ({}));
  if (!signupBody.access_token) {
    console.error('sem sessao de QA:', signup.status, JSON.stringify(signupBody).slice(0, 200));
    process.exit(1);
  }
  const accessToken = signupBody.access_token;

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
    // o gate de notificacoes e modal e bloqueia o clique: dispensa nesta sessao
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

  /* ===== ETAPA 1 - plataforma (busca + mais usadas + popup) ===== */
  await page.goto(`${BASE_URL}/dashboard/my-groups/create`, { waitUntil: 'networkidle' });
  await page.waitForSelector('.gc-platform-step', { timeout: 20000 });

  check('abre na etapa 1 (plataforma)', (await stepLabel(page)).includes('etapa 1 de 6'), await stepLabel(page));
  check('tem campo de busca de plataforma', await page.locator('.gc-search-box input[type="search"]').count() === 1);

  const maisUsadas = await page.locator('.gc-section-title').first().innerText().catch(() => '');
  check('mostra a secao "Mais usadas" no topo', /mais usadas/i.test(maisUsadas), maisUsadas.replace(/\n/g, ' '));

  /* a busca filtra de verdade */
  await page.locator('.gc-search-box input[type="search"]').fill('netflix');
  await page.waitForTimeout(400);
  const busca = await page.locator('.gc-platform-name').allInnerTexts();
  check('a busca filtra as plataformas', busca.length >= 1 && busca.every((t) => /netflix/i.test(t)), busca.join(' | '));
  await page.locator('.gc-search-box input[type="search"]').fill('');
  await page.waitForTimeout(400);

  /* clicar na plataforma abre o popup de confirmacao */
  await page.locator('.gc-platform:has-text("Netflix")').first().click();
  await page.waitForSelector('.gc-modal', { timeout: 8000 });
  const modalText = await page.locator('.gc-modal').innerText();
  check('clicar na plataforma abre o popup de confirmacao', /Netflix/i.test(modalText), modalText.split('\n')[0]);
  check('o popup tem "Voltar a lista"', await page.locator('.gc-modal button:has-text("Voltar")').count() === 1);
  check('o popup tem "Continuar"', await page.locator('.gc-modal button:has-text("Continuar")').count() === 1);

  await page.screenshot({ path: path.join(OUT, 'qa-01-popup-plataforma.png') });

  await page.locator('.gc-modal button:has-text("Continuar")').click();
  await page.waitForSelector('.gc-plan-list', { timeout: 15000 });

  /* ===== ETAPA 2 - planos da plataforma (+ vagas + assinatura) ===== */
  check('vai para a etapa 2 (plano)', (await stepLabel(page)).includes('etapa 2 de 6'), await stepLabel(page));

  const planoCards = page.locator('.gc-plan');
  const nPlanos = await planoCards.count();
  check('lista os planos da plataforma', nPlanos === 3, `${nPlanos} plano(s)`);

  const cardTexto = await planoCards.first().innerText();
  check('o card do plano mostra o preco', /R\$\s*\d/.test(cardTexto), cardTexto.split('\n').slice(0, 3).join(' | '));
  check('o card do plano mostra os detalhes (telas/qualidade)',
    /Telas simult/i.test(cardTexto), cardTexto.replace(/\n/g, ' | ').slice(0, 160));

  await page.screenshot({ path: path.join(OUT, 'qa-02-planos.png') });

  /* escolhe o plano "Basico com anuncios" (tem min/max cadastrados) */
  await planoCards.filter({ hasText: 'com an' }).first().click();
  await page.waitForTimeout(500);

  /* as VAGAS ficam na MESMA etapa do plano (etapa 2) */
  await page.waitForSelector('.gc-slots-card', { timeout: 10000 });
  const vagas = await page.locator('.gc-stepper-value').innerText();
  check('as vagas seguem o limite do plano (4)', vagas.trim() === '4', vagas);
  const slotsText = await page.locator('.gc-note.info').first().innerText();
  check('a etapa de vagas mostra o valor por pessoa do plano',
    /R\$\s*7,90/.test(slotsText), slotsText.replace(/\n/g, ' ').slice(0, 180));

  /* ===== ETAPA 3 - grupo: visibilidade + regras ===== */
  await nextButton(page).click();
  await page.waitForSelector('.gc-visibility-grid', { timeout: 10000 });
  check('vai para a etapa 3 (grupo)', (await stepLabel(page)).includes('etapa 3 de 6'), await stepLabel(page));
  const visTitles = await page.locator('.gc-visibility-title').allInnerTexts();
  check('a etapa de visibilidade tem Publico e Privado',
    visTitles.length === 2 && /P/i.test(visTitles[0]) && /Privado/i.test(visTitles[1]),
    visTitles.join(' | '));
  check('a etapa do grupo tem as regras do grupo',
    await page.locator('.gc-rule-types').count() === 1);

  /* ===== ETAPA 5 - pagamentos (teto do plano) ===== */
  await nextButton(page).click();                 // -> credenciais
  await page.waitForTimeout(600);
  const emailInput = page.locator('.gc-field:has(label:has-text("e-mail")) input').first();
  if (await emailInput.count()) await emailInput.fill('qa.conta@exemplo.com');
  const senha = page.locator('input[type="password"]').first();
  if (await senha.count()) await senha.fill('SenhaDeTeste123!');
  await nextButton(page).click();                 // -> pagamentos
  await page.waitForSelector('.gc-price-box', { timeout: 10000 });

  check('a etapa de pagamento mostra a faixa do plano por pessoa',
    await page.locator('.gc-note.info:has-text("por pessoa")').count() >= 1);

  const totalInput = page.locator('.gc-field:has(label:has-text("Valor total do grupo")) input');
  const total = await totalInput.inputValue();
  check('o total vem preenchido com a sugestao do plano (7,90 x 4 = 31,60)',
    Math.abs(parseFloat(total) - 31.60) < 0.01, total);

  /* total ACIMA do teto: 40,00 / 4 = 10,00 por pessoa (max = 9,90) */
  await totalInput.fill('40.00');
  await page.waitForTimeout(300);
  await nextButton(page).click();
  await page.waitForTimeout(700);
  const erro = await page.locator('.wizard-step-error').innerText().catch(() => '');
  check('total fora do teto e BLOQUEADO', /fora da faixa/i.test(erro), erro);
  check('continua na etapa de pagamentos', (await stepLabel(page)).includes('etapa 5 de 6'), await stepLabel(page));

  await page.screenshot({ path: path.join(OUT, 'qa-03-teto-bloqueado.png') });

  /* total dentro do teto: 9,50 x 4 = 38,00 -> 9,50 por pessoa (max 9,90) */
  await totalInput.fill('38.00');
  await page.waitForTimeout(300);
  await nextButton(page).click();
  await page.waitForSelector('.gc-summary', { timeout: 10000 });
  check('total dentro do teto AVANCA para o resumo', (await stepLabel(page)).includes('etapa 6 de 6'), await stepLabel(page));

  /* ===== ETAPA 6 - resumo + politicas (ultima etapa) ===== */
  const resumo = await page.locator('.gc-summary').innerText();
  check('o resumo mostra o nome automatico (plataforma + plano)',
    /Netflix.*com an/i.test(resumo), resumo.replace(/\n/g, ' | ').slice(0, 120));
  check('o resumo mostra o valor por pessoa (9,50)',
    /9,50/.test(resumo), resumo.replace(/\n/g, ' | ').slice(-160));

  const politicas = await page.locator('.gc-policies').innerText();
  check('a ultima etapa traz as politicas (DividePass como facilitadora)',
    /facilitadora/i.test(politicas) && /responsabilidade/i.test(politicas),
    politicas.replace(/\n/g, ' | ').slice(0, 200));

  const criarBtn = page.locator('.wizard-foot button:has-text("Criar grupo")');
  check('o resumo e a ULTIMA etapa (botao criar grupo)', await criarBtn.count() === 1);

  await criarBtn.click();
  await page.waitForTimeout(700);
  const erroSemPolitica = await page.locator('.wizard-step-error').innerText().catch(() => '');
  check('sem aceitar a politica o grupo NAO e criado', /pol.ticas/i.test(erroSemPolitica), erroSemPolitica);

  await page.locator('.gc-policies-check input[type="checkbox"]').check();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'qa-04-resumo-politicas.png') });

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
