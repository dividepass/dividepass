/**
 * Publica as edge functions do DividePass pela Management API do Supabase.
 *
 * Por que existe: o CLI do Supabase e o painel nao deixam este agente publicar
 * (o CLI da 403 neste projeto), entao a alternativa era colar 7 arquivos de
 * ~150 KB no editor do painel. Com um Personal Access Token (PAT) do
 * proprio dono do projeto, isso vira um comando.
 *
 * Como usar
 * ---------
 * 1) No painel do Supabase: Account -> Access Tokens -> Generate new token
 *    (escopo: apenas "Management API", nao precisa de conta).
 * 2) Salve o token em `.supabase_token` (nao versionado) OU exporte
 *    SUPABASE_ACCESS_TOKEN no terminal.
 * 3) `node scripts/publicar-functions.mjs`            -> so o plano (dry-run)
 *    `node scripts/publicar-functions.mjs --real`     -> publica
 *    `node scripts/publicar-functions.mjs --verificar` -> compara o publicado
 *                                                          com o pacote local
 *
 * O que e publicado
 * -----------------
 * Os pacotes ja empacotados em `.tmp-verify/painel/<slug>.ts` (arquivo unico,
 * sem import externo - o mesmo arquivo que se cola no painel).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PASTA_PAINEL = path.join(ROOT, '.tmp-verify', 'painel');
const API = 'https://api.supabase.com/v1';

const exec = promisify(execFile);

/**
 * Ordem de publicacao importa:
 *  - `create-payment` primeiro: e o que cria a cobranca; enquanto ele for o
 *    antigo, o front (novo) manda `payment_type: combined` e nada understande.
 *  - `confirm-payment` depois: e quem libera a assinatura.
 *  - o resto: webhook, polling, forca e o job de reconciliacao.
 */
const FUNCOES = [
  {
    slug: 'create-payment',
    verify_jwt: true,
    nota: 'front (JWT do usuario); cria a cobranca no fluxo combinado',
  },
  {
    slug: 'confirm-payment',
    verify_jwt: true,
    nota: 'libera assinatura + vinculo + e-mail (idempotente)',
  },
  {
    slug: 'iopay-webhook',
    verify_jwt: false,
    nota: 'chamada do gateway (sem JWT) - precisa ser 503 no retryable',
  },
  {
    slug: 'check-iopay-tx',
    verify_jwt: true,
    nota: 'polling do front (JWT do usuario)',
  },
  {
    // A Woovi chama a webhook sem JWT (é o gateway que avisa). O `503` aqui
    // é o que faz a Woovi REENVIAR o evento — nunca trocar por 200 na
    // correria, senão o "cliente pagou e não entrou" volta.
    slug: 'woovi-webhook',
    verify_jwt: false,
    nota: 'chamada do gateway Woovi (sem JWT) - 503 no retryable',
  },
  {
    slug: 'check-woovi-tx',
    verify_jwt: true,
    nota: 'polling do front (JWT do usuario) - confirma parcela do Pix Automatico',
  },
  {
    slug: 'force-confirm-payment',
    verify_jwt: true,
    nota: 'acao manual do admin',
  },
  {
    slug: 'reconcile-payments',
    verify_jwt: false,
    nota: 'job de 15 min (cron) - varre pagamento aprovado sem liberacao',
  },
  {
    slug: 'update-subscription-statuses',
    verify_jwt: false,
    nota: 'job de cron',
  },
  {
    slug: 'process-overdue-invoices',
    verify_jwt: false,
    nota: 'job de cron - fatura vencida deixa a assinatura ATRASADA (7 dias de carencia)',
  },
  {
    slug: 'send-lifecycle-emails',
    verify_jwt: false,
    nota: 'job de cron - lembrete de renovacao e aviso de atraso',
  },
  {
    slug: 'check-entrance-deadline',
    verify_jwt: false,
    nota: 'job de cron - prazo de 12h da entrada (nao cancela quem tem assinatura paga)',
  },
  {
    slug: 'asaas-webhook',
    verify_jwt: true,
    nota: 'webhook do Asaas - embute o confirm-payment',
  },
  {
    slug: 'pagarme-webhook',
    verify_jwt: true,
    nota: 'webhook do Pagar.me - embute o confirm-payment',
  },
  {
    slug: 'stripe-webhook',
    verify_jwt: true,
    nota: 'webhook do Stripe - embute o confirm-payment',
  },
  {
    slug: 'mercado-pago-webhook',
    verify_jwt: false,
    nota: 'webhook do Mercado Pago (gateway legado)',
  },
  {
    slug: 'mercado-pago-create-subscription',
    verify_jwt: true,
    nota: 'assinatura no Mercado Pago (gateway legado)',
  },
  // Revenda Pulse Coding (06/11/2026)
  {
    slug: 'pulse-admin',
    verify_jwt: true,
    nota: 'painel do admin (JWT do admin): saldo, sync, remapeamento, dry_run',
  },
  {
    slug: 'pulse-entrega',
    verify_jwt: true,
    nota: 'o cliente busca a SUA entrega (JWT do usuario)',
  },
  {
    slug: 'pulse-webhook',
    verify_jwt: false,
    nota: 'chamada da Pulse (sem JWT) - valida X-Pulse-Signature',
  },
  {
    slug: 'pulse-poll',
    verify_jwt: false,
    nota: 'job de polling dos pedidos pendentes (segredo do cron)',
  },
  // Suporte (rodada de 10/11/2026): o admin entra na conta do cliente SEM a
  // senha dele. `verify_jwt = false` porque a própria função valida o admin
  // no código (papel em `app_metadata` E em `public.users`) — o mesmo padrão
  // das outras funções deste projeto.
  {
    slug: 'admin-impersonate',
    verify_jwt: false,
    nota: 'suporte: admin entra na conta do cliente sem a senha (magiclink de uso unico)',
  },
];

/**
 * Teste de BOOT de um pacote empacotado — o mesmo que o runtime do Supabase
 * faz ao iniciar a edge function.
 *
 * POR QUE IMPORTA
 * ---------------
 * Em 09/11/2026 o `create-payment` foi publicado com um SyntaxError
 * (`return { default, handleWoovi };` — `default` é palavra reservada). O
 * arquivo não compilava, a função NÃO subiu, e o Supabase respondeu
 * 503 BOOT_ERROR — SEM header de CORS, então o navegador mostrava
 * "Failed to fetch" e o PIX do cliente parou de funcionar.
 *
 * O teste importa o pacote no Deno (é o que o runtime faz) e pergunta se ele
 * sobe. Erro de SINTAXE reprova e cancela a publicação; erro de TIPO passa,
 * porque o runtime apaga os tipos e a função sobe normalmente.
 */
async function verificarBoot(arquivo) {
  const runner = path.join(ROOT, '.tmp-verify', 'runner-boot-publicar.mjs');
  fs.mkdirSync(path.dirname(runner), { recursive: true });
  fs.writeFileSync(
    runner,
    `const alvo = ${JSON.stringify(pathToFileURL(path.resolve(arquivo)).href)};\n` +
      `try {\n` +
      `  const mod = await import(alvo);\n` +
      `  const temDefault = typeof mod.default !== "undefined" && mod.default !== null;\n` +
      `  console.log("__RESULTADO__OK" + (temDefault ? ":com-default" : ":sem-default"));\n` +
      `} catch (e) {\n` +
      `  console.log("__RESULTADO__ERRO:" + e.name + ": " + e.message);\n` +
      `}\n`,
    'utf8',
  );

  try {
    // No Windows o `npx` precisa de `shell: true` — sem isso a execFile
    // falha em silêncio (saída vazia) e o erro real nunca aparece.
    const { stdout, stderr } = await exec(
      'npx',
      ['-y', 'deno', 'run', '--allow-net', '--allow-env', '--allow-read', runner],
      { maxBuffer: 16 * 1024 * 1024, timeout: 240000, shell: true },
    );
    const m = `${stdout}\n${stderr}`.match(/__RESULTADO__([^\n]*)/);
    if (!m) return { ok: false, erro: 'sem resultado do teste de boot' };
    const resultado = m[1];
    if (!resultado.startsWith('OK')) {
      return { ok: false, erro: resultado.slice(4).trim() || 'não sobe' };
    }
    const comDefault = resultado.endsWith(':com-default');
    return { ok: true, comDefault, erro: comDefault ? '' : 'sem export default' };
  } catch (e) {
    return { ok: false, erro: `falha ao rodar o teste: ${String(e.message).slice(0, 200)}` };
  }
}

function lerToken() {
  const doEnv = process.env.SUPABASE_ACCESS_TOKEN?.trim();
  if (doEnv) return doEnv;
  for (const nome of ['.supabase_token', '.supabase_pat']) {
    const p = path.join(ROOT, nome);
    if (fs.existsSync(p)) {
      const t = fs.readFileSync(p, 'utf8').trim();
      if (t) return t;
    }
  }
  // Token que a propria CLI guarda depois de `supabase login` / `supabase login --token ...`
  const daCli = path.join(os.homedir(), '.supabase', 'access-token');
  if (fs.existsSync(daCli)) {
    const t = fs.readFileSync(daCli, 'utf8').trim();
    if (t) return t;
  }
  return null;
}

function lerRef() {
  for (const nome of ['.env.local', '.env']) {
    const p = path.join(ROOT, nome);
    if (!fs.existsSync(p)) continue;
    const m = fs.readFileSync(p, 'utf8').match(/VITE_SUPABASE_URL\s*=\s*(\S+)/);
    if (m) {
      const ref = m[1].match(/https:\/\/([a-z0-9]+)\.supabase\./i)?.[1];
      if (ref) return ref;
    }
  }
  return 'lasoouwboxspstqvjbsv';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function apiListar(ref, token) {
  const r = await fetch(`${API}/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`GET functions -> HTTP ${r.status}: ${JSON.stringify(corpo).slice(0, 300)}`);
  return corpo;
}

async function apiCorpo(ref, slug, token) {
  const r = await fetch(`${API}/projects/${ref}/functions/${slug}/body`, {
    headers: { Authorization: `Bearer ${token}`, accept: 'application/json' },
  });
  if (!r.ok) return null;
  const texto = await r.text();
  // A API devolve o corpo como texto ou base64 (dependendo do deploy).
  if (/^[A-Za-z0-9+/=\s]+$/.test(texto) && texto.length > 1000) {
    try {
      const dec = Buffer.from(texto.replace(/\s/g, ''), 'base64').toString('utf8');
      if (dec.includes('Deno.serve') || dec.includes('export default')) return dec;
    } catch {
      /* nao era base64 */
    }
  }
  return texto;
}

async function publicar(ref, slug, token, verifyJwt) {
  const arquivo = path.join(PASTA_PAINEL, `${slug}.ts`);
  if (!fs.existsSync(arquivo)) throw new Error(`pacote ausente: ${arquivo} (rode: node scripts/empacotar-function-painel.mjs)`);
  const codigo = fs.readFileSync(arquivo, 'utf8');

  const form = new FormData();
  form.append('file', new Blob([codigo], { type: 'text/typescript' }), 'index.ts');
  form.append(
    'metadata',
    JSON.stringify({
      entrypoint_path: 'index.ts',
      verify_jwt: verifyJwt,
      name: slug,
    }),
  );

  const r = await fetch(`${API}/projects/${ref}/functions/deploy?slug=${slug}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const corpo = await r.json().catch(() => null);
  if (!r.ok) {
    throw new Error(`deploy ${slug} -> HTTP ${r.status}: ${JSON.stringify(corpo).slice(0, 400)}`);
  }
  return corpo;
}

async function main() {
  const args = process.argv.slice(2);
  const real = args.includes('--real');
  const verificar = args.includes('--verificar');
  const ref = lerRef();
  const token = lerToken();

  // `--only=slug1,slug2` publica só as functions indicadas. Existe para
  // publicar uma rodada nova sem tocar no resto do que já está no ar: uma
  // falha (ou um arquivo local desatualizado) fica restrita à rodada.
  const soArg = args.find((a) => a.startsWith('--only='));
  const apenas = soArg
    ? soArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean)
    : null;
  const funcoes = apenas ? FUNCOES.filter((f) => apenas.includes(f.slug)) : FUNCOES;

  if (apenas) {
    const desconhecidas = apenas.filter((s) => !FUNCOES.some((f) => f.slug === s));
    if (desconhecidas.length) {
      console.error(`--only: funcao desconhecida: ${desconhecidas.join(', ')}`);
      process.exit(1);
    }
  }

  console.log(`Projeto: ${ref}`);
  console.log(`Pacotes: ${path.relative(ROOT, PASTA_PAINEL)}`);
  if (apenas) console.log(`Rodada (--only): ${apenas.join(', ')}`);
  console.log('');

  if (!token && (real || verificar)) {
    console.error('FALTA TOKEN. Gere um PAT em Account -> Access Tokens e salve em .supabase_token');
    console.error('(ou exporte SUPABASE_ACCESS_TOKEN). Sem token nao da para ler nem publicar.');
    process.exit(1);
  }

  // 1) Estado atual (o que esta no ar agora)
  if (token) {
    try {
      const lista = await apiListar(ref, token);
      const alvo = new Set(funcoes.map((f) => f.slug));
      console.log('ESTADO ATUAL (o que esta no ar):');
      for (const f of lista.filter((x) => alvo.has(x.slug))) {
        console.log(`  ${f.slug.padEnd(28)} v${String(f.version).padEnd(4)} verify_jwt=${f.verify_jwt}  ${f.status}`);
      }
      for (const f of funcoes.filter((x) => !lista.some((y) => y.slug === x.slug))) {
        console.log(`  ${f.slug.padEnd(28)} (ainda nao existe no projeto)`);
      }
      console.log('');
    } catch (e) {
      console.error(`Nao consegui listar as functions: ${e.message}`);
      console.error('');
    }
  }

  // 2) Plano
  console.log('PLANO DE PUBLICACAO:');
  for (const f of funcoes) {
    const arquivo = path.join(PASTA_PAINEL, `${f.slug}.ts`);
    const existe = fs.existsSync(arquivo);
    const kb = existe ? (fs.statSync(arquivo).size / 1024).toFixed(0) : '-';
    console.log(`  ${real ? 'PUBLICAR' : 'publicar '} ${f.slug.padEnd(28)} verify_jwt=${String(f.verify_jwt).padEnd(5)} ${kb} KB  ${f.nota}`);
  }
  console.log('');

  if (verificar && !real) {
    console.log('--verificar: comparando o publicado com o pacote local...');
    for (const f of funcoes) {
      const local = path.join(PASTA_PAINEL, `${f.slug}.ts`);
      if (!fs.existsSync(local)) {
        console.log(`  ${f.slug.padEnd(28)} pacote local ausente`);
        continue;
      }
      const publicado = await apiCorpo(ref, f.slug, token);
      if (!publicado) {
        console.log(`  ${f.slug.padEnd(28)} sem corpo publicado (404?)`);
        continue;
      }
      const mesmo = sha256(publicado) === sha256(fs.readFileSync(local, 'utf8'));
      const contem = publicado.includes('liberacaoConcluida');
      console.log(`  ${f.slug.padEnd(28)} ${mesmo ? 'IDENTICO ao pacote local' : 'DIFERENTE do pacote local'}  (tem liberacaoConcluida: ${contem})`);
    }
    return;
  }

  if (!real) {
    console.log('Dry-run. Nada foi publicado. Use --real para publicar (ou --verificar para comparar).');
    return;
  }

  // 2.5) TRAVA DE BOOT — nenhuma função quebrada vai para o ar
  //
  // O que aconteceu em 09/11/2026: o `create-payment` foi publicado com
  // `return { default, handleWoovi };` (`default` é palavra reservada) e com
  // seis `const mod` no mesmo escopo. O arquivo não compilava, a função NÃO
  // subiu, e o Supabase respondeu 503 BOOT_ERROR — SEM header de CORS, o
  // que faz o navegador mostrar "Failed to fetch" em vez de uma mensagem de
  // erro. A cobrança de PIX ficou 100% fora do ar até a função voltar.
  //
  // O teste abaixo é o mesmo que o runtime faz: importa o pacote empacotado
  // e pergunta se ele sobe. Se não sobe, a publicação é CANCELADA.
  console.log('TRAVA DE BOOT (o pacote empacotado sobe?):');
  const quebradas = [];
  for (const f of funcoes) {
    const arquivo = path.join(PASTA_PAINEL, `${f.slug}.ts`);
    if (!fs.existsSync(arquivo)) continue;
    process.stdout.write(`  ${f.slug.padEnd(28)} `);
    const r = await verificarBoot(arquivo);
    if (r.ok) {
      console.log(`sobe${r.comDefault ? '' : ' (SEM export default!)'}`);
      if (!r.comDefault) quebradas.push(`${f.slug} (sem export default)`);
    } else {
      console.log(`NAO SOBE -> ${r.erro}`);
      quebradas.push(`${f.slug} -> ${r.erro}`);
    }
  }
  console.log('');
  if (quebradas.length) {
    console.error('PUBLICACAO CANCELADA. Estes pacotes nao sobem:');
    for (const q of quebradas) console.error(`  - ${q}`);
    console.error('');
    console.error('Rode `node scripts/empacotar-function-painel.mjs <funcao>` e corrija');
    console.error('a causa antes de publicar de novo.');
    process.exit(1);
  }

  // 3) Publica (uma por vez: se uma falhar, as anteriores continuam valendo)
  console.log('PUBLICANDO:');
  for (const f of funcoes) {
    process.stdout.write(`  ${f.slug.padEnd(28)} `);
    try {
      const r = await publicar(ref, f.slug, token, f.verify_jwt);
      console.log(`OK  v${r?.version ?? '?'}  id=${String(r?.id ?? '').slice(0, 8)}`);
    } catch (e) {
      console.log(`FALHOU -> ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 1200));
  }
  console.log('');
  console.log('Fim. Rode com --verificar para conferir o que foi para.');
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
