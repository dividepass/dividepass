/* QA dos avatares do rodape do card de grupo no catalogo (rota /dashboard/catalog/:slug).
 *
 * Regra que este script confere:
 *   - quem tem foto de perfil aparece com FOTO;
 *   - quem nao tem foto de perfil cai no ICONE DE LETRA (inicial do nome);
 *   - as fotos vem PRIMEIRO (fica mais bonito) e no maximo 4 retratos + "+N".
 *
 * A fonte da verdade e o proprio banco: o script le os membros do grupo pela
 * REST (conta QA unica) e compara com o que o DOM desenhou.
 *
 * Nao grava nada: e leitura pura.
 *
 * Uso: node scripts/qa-catalog-avatares.cjs
 *      QA_BASE_URL=https://dividepass.com node scripts/qa-catalog-avatares.cjs
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'qa-out');
const BASE_URL = process.env.QA_BASE_URL || 'http://127.0.0.1:5173';
const SERVICE_SLUG = process.env.QA_SERVICE_SLUG || 'max';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const cfg = {};
for (const nome of ['.env.local', '.env']) {
  try {
    fs.readFileSync(path.join(__dirname, '..', nome), 'utf8').split(/\r?\n/).forEach((line) => {
      const m = line.match(/^\s*([^#=]+)=(.*)$/);
      if (m) cfg[m[1].trim()] = m[2].trim();
    });
  } catch { /* arquivo ausente */ }
}
const BASE = cfg.VITE_SUPABASE_URL;
const ANON = cfg.VITE_SUPABASE_ANON_KEY;
const REF = new URL(BASE).hostname.split('.')[0];
const SESSION_KEY = `sb-${REF}-auth-token`;

// A senha vem do .env local (ignorado pelo git) — nunca fica no repositorio.
const QA_USER = {
  email: cfg.QA_EMAIL || process.env.QA_EMAIL || 'qa.mavis@divteste.com',
  password: cfg.QA_PASSWORD || process.env.QA_PASSWORD || '',
};
if (!QA_USER.password) {
  console.error('Falta QA_PASSWORD no .env local (veja .env.example).');
  process.exit(1);
}

(async () => {
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const login = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify(QA_USER),
  });
  const body = await login.json().catch(() => ({}));
  if (!body.access_token) {
    console.error('sem sessao da conta QA:', login.status, JSON.stringify(body).slice(0, 200));
    process.exit(1);
  }
  const token = body.access_token;

  const restGet = async (path) => {
    const res = await fetch(`${BASE}/rest/v1/${path}`, {
      headers: { apikey: ANON, Authorization: `Bearer ${token}` },
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
    return data;
  };

  /* Fonte da verdade: membros ativos do grupo com avatar_url de cada um. */
  const grupos = await restGet(
    'groups?select=id,name,slug,service:service_id(slug),members:group_members(status,user_id,user:user_id(id,name,avatar_url))&status=in.(open,forming)&visibility=eq.public'
  );
  const grupo = grupos.find(
    (g) => g.service?.slug === SERVICE_SLUG && g.members?.some((m) => m.status === 'active')
  );
  if (!grupo) {
    console.error(`nenhum grupo publico aberto com membros na plataforma "${SERVICE_SLUG}"`);
    process.exit(1);
  }
  const ativos = grupo.members.filter((m) => m.status === 'active');
  const comFoto = ativos.filter((m) => m.user?.avatar_url);
  const semFoto = ativos.filter((m) => !m.user?.avatar_url);
  // Ordem esperada no card: quem tem foto primeiro (ordem original preservada).
  const esperados = [
    ...comFoto.map((m) => ({ tipo: 'foto', src: m.user.avatar_url, nome: m.user.name })),
    ...semFoto.map((m) => ({ tipo: 'letra', letra: (m.user?.name || '?').trim()[0].toUpperCase(), nome: m.user?.name })),
  ].slice(0, 4);
  const ocultos = Math.max(0, ativos.length - esperados.length);

  console.log(`grupo: "${grupo.name}" | ${ativos.length} membros ativos | ${comFoto.length} com foto | ${semFoto.length} sem foto`);
  console.log(`esperado no card: ${esperados.length} retratos (${esperados.filter(e => e.tipo === 'foto').length} fotos) + ${ocultos} oculto(s)\n`);

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  const erros = [];
  page.on('pageerror', (e) => erros.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()); });

  await page.addInitScript(([key, value]) => {
    window.localStorage.setItem(key, value);
    window.sessionStorage.setItem('dp_push_gate_skipped', '1');
  }, [SESSION_KEY, JSON.stringify({
    access_token: body.access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: body.refresh_token,
    user: body.user,
  })]);

  /* A conta QA nunca terminou o onboarding e nao tem avatar: sem esse remendo
   * de LEITURA, o /dashboard vira /onboarding e o AvatarGate toma a tela.
   * Nenhum POST sai daqui. */
  await page.route('**/rest/v1/users**', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const res = await route.fetch();
    const json = await res.json().catch(() => null);
    const remendar = (u) => (u && typeof u === 'object'
      ? { ...u, onboarding_completed_at: u.onboarding_completed_at || '2026-01-01T00:00:00Z', avatar_url: u.avatar_url || '/avatars/avatar-03.svg' }
      : u);
    const bodyOut = Array.isArray(json) ? json.map(remendar) : remendar(json);
    return route.fulfill({
      status: res.status(),
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify(bodyOut),
    });
  });

  await page.goto(`${BASE_URL}/dashboard/catalog/${SERVICE_SLUG}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  check('abre em /dashboard/catalog/:slug (nao virou /onboarding)',
    !page.url().includes('/onboarding') && page.url().includes(`/dashboard/catalog/${SERVICE_SLUG}`), page.url());

  const card = page.locator('.group-card', { hasText: grupo.name }).first();
  check('o card do grupo aparece na listagem da plataforma', (await card.count()) === 1, `count=${await card.count()}`);

  if (await card.count()) {
    const lidos = await card.locator('.gc-member-avatars .gc-member-avatar').evaluateAll((els) =>
      els.map((el) => {
        const img = el.querySelector('img');
        return {
          temImg: !!img,
          src: img ? img.getAttribute('src') : null,
          carregada: img ? img.complete && img.naturalWidth > 0 : null,
          letra: el.querySelector('span') ? el.querySelector('span').textContent.trim() : null,
          texto: el.textContent.trim(),
          mais: el.classList.contains('gc-member-more'),
          vazio: el.classList.contains('gc-member-avatar-empty'),
        };
      })
    );

    const retratos = lidos.filter((l) => !l.mais && !l.vazio);
    const fotos = retratos.filter((l) => l.temImg);
    const letras = retratos.filter((l) => !l.temImg);

    check('o rodape mostra os retratos dos membros', retratos.length > 0, `${retratos.length} retrato(s)`);
    check('no maximo 4 retratos por card', retratos.length <= 4, `${retratos.length}`);
    check('tem pelo menos uma FOTO de perfil no card', fotos.length > 0, `${fotos.length} foto(s)`);
    check('tem pelo menos uma LETRA (quem nao tem foto)', letras.length > 0, `${letras.length} letra(s)`);

    // A foto vem antes da letra (ordem do rodape).
    const primeiraLetra = retratos.findIndex((l) => !l.temImg);
    const ultimaFoto = retratos.map((l) => l.temImg).lastIndexOf(true);
    check('as fotos vem ANTES das letras', primeiraLetra === -1 || ultimaFoto < primeiraLetra,
      `ultimaFoto=${ultimaFoto} primeiraLetra=${primeiraLetra}`);

    // As fotos do DOM batem com as do banco (por URL).
    const srcsBanco = esperados.filter((e) => e.tipo === 'foto').map((e) => e.src);
    const srcsDom = fotos.map((f) => f.src);
    const bate = srcsBanco.every((s) => srcsDom.some((d) => d && d.includes(s.split('/').pop())));
    check('as fotos do card sao as fotos de perfil do banco', bate, `banco=${srcsBanco.length} dom=${srcsDom.length}`);

    // As letras batem com a inicial do nome de quem nao tem foto.
    const letrasBanco = esperados.filter((e) => e.tipo === 'letra').map((e) => e.letra);
    const letrasDom = letras.map((l) => l.letra);
    check('as letras do card sao a inicial de quem nao tem foto',
      letrasBanco.every((l) => letrasDom.includes(l)), `banco=${letrasBanco.join('')} dom=${letrasDom.join('')}`);

    // As fotos realmente carregam (URL de storage valida).
    const quebradas = fotos.filter((f) => !f.carregada);
    check('todas as fotos carregam de verdade', quebradas.length === 0,
      quebradas.map((f) => f.src).join(' | ').slice(0, 160));

    // Membros ocultos viram o badge "+N".
    const badge = lidos.find((l) => l.mais);
    if (ocultos > 0) {
      check(`o badge "+${ocultos}" aparece para os membros ocultos`, !!badge && badge.texto === `+${ocultos}`, badge ? badge.texto : 'ausente');
    } else {
      check('sem badge "+N" (cabe tudo em 4)', !badge, badge ? badge.texto : 'ok');
    }

    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
    await card.screenshot({ path: path.join(OUT, 'catalogo-card-rodape.png') });
    const rodape = card.locator('.gc-bottom');
    if (await rodape.count()) {
      await rodape.screenshot({ path: path.join(OUT, 'catalogo-card-rodape-isolado.png') });
    }

    // Print da listagem inteira (a pagina que o usuario pediu para ver)
    await page.screenshot({ path: path.join(OUT, 'catalogo-listagem.png'), fullPage: true });

    // Print em mobile (o rodape nao pode estourar a linha)
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(600);
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await card.screenshot({ path: path.join(OUT, 'catalogo-card-rodape-mobile.png') });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }

  check('sem erro de JS no console', erros.length === 0, erros.slice(0, 3).join(' | '));

  await browser.close();

  const falhou = results.filter((r) => !r.ok);
  console.log(`\n${results.length - falhou.length}/${results.length} checks OK`);
  console.log(`prints em: ${OUT}`);
  process.exit(falhou.length ? 1 : 0);
})().catch((e) => {
  console.error('erro no QA:', e);
  process.exit(1);
});
