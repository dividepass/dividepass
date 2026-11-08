/**
 * Diagnóstico do deploy no Vercel — por que a build quebrou.
 *
 *   node scripts/vercel-deploy-status.mjs [deploymentId]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

function lerEnv() {
  const env = {};
  for (const nome of ['.env.local', '.env']) {
    try {
      for (const linha of fs.readFileSync(path.join(ROOT, nome), 'utf8').split(/\r?\n/)) {
        const m = linha.match(/^\s*([^#=]+)=(.*)$/);
        if (m) env[m[1].trim()] = m[2].trim();
      }
    } catch {
      /* ausente */
    }
  }
  return env;
}

const token =
  process.env.VERCEL_TOKEN ||
  (() => {
    try {
      return fs.readFileSync(path.join(ROOT, '.vercel_token'), 'utf8').trim();
    } catch {
      return '';
    }
  })();

if (!token) {
  console.error('Sem token: defina VERCEL_TOKEN ou deixe o .vercel_token na raiz.');
  process.exit(1);
}

const projectId = JSON.parse(fs.readFileSync(path.join(ROOT, '.vercel', 'project.json'), 'utf8')).projectId;
const H = { Authorization: `Bearer ${token}` };

const alvos = process.argv[2]
  ? [process.argv[2]]
  : null;

async function api(url) {
  const r = await fetch(`https://api.vercel.com${url}`, { headers: H });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const lista = alvos
  ? null
  : (await api(`/v6/deployments?projectId=${projectId}&limit=6`)).deployments;

const deployments = lista || (await api(`/v6/deployments/${alvos[0]}`)).deployments;

for (const d of deployments) {
  console.log('='.repeat(70));
  console.log(`${d.uid}  state=${d.state}  target=${d.target}  sha=${(d.meta?.githubCommitSha || '').slice(0, 8)}`);
  console.log(`   url: ${d.url}`);
  if (d.errorCode || d.errorMessage) {
    console.log(`   ERRO: ${d.errorCode} ${d.errorMessage}`);
  }
  console.log(`   aliases: ${(d.alias || []).join(', ') || '(nenhum)'}`);

  // Logs da build
  const comBuild = await api(`/v2/deployments/${d.uid}?builds=1`).catch(() => null);
  const builds = comBuild?.builds || [];
  for (const b of builds) {
    console.log(`   -- build ${b.id} state=${b.state}`);
    const ev = await api(`/v2/builds/${b.id}/events?limit=200`).catch(() => null);
    const textos = (ev?.events || [])
      .filter((e) => e.type === 'stdout' || e.type === 'stderr' || e.type === 'error')
      .map((e) => e.text)
      .filter(Boolean);
    if (!textos.length) {
      console.log('      (sem logs)');
      continue;
    }
    for (const t of textos.slice(-40)) console.log('      ' + t.replace(/\n$/, ''));
  }
}
