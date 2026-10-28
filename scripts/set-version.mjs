/**
 * Gera a versao do app a partir do historico de commits do repositorio.
 *
 * O numero da versao e a quantidade de commits da branch atual: `1.0.<commits>`.
 * Como cada release vira um commit, o contador volta a andar sozinho - sem
 * ninguem precisar lembrar de editar um numero em dois lugares.
 *
 * Roda no `prebuild` (npm run build). Em ambiente sem historico git (build da
 * Vercel com shallow clone ou sem .git) o arquivo ja enviado e preservado.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, 'src', 'version.json');

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}

function readCurrent() {
  if (!existsSync(target)) return null;
  try {
    return JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    return null;
  }
}

const current = readCurrent();
const count = Number(git(['rev-list', '--count', 'HEAD']) || 0);
const commit = git(['rev-parse', '--short', 'HEAD']);

// Sem historico util: preserva o que veio no upload (build da Vercel).
if (!count || count <= 1) {
  if (current?.version) {
    console.log(`[version] mantida ${current.version} (sem historico git completo)`);
    process.exit(0);
  }
  console.log('[version] sem historico git e sem version.json - usando fallback');
  process.exit(0);
}

const version = `1.0.${count}`;

if (current?.version === version && current?.commit === commit) {
  console.log(`[version] ${version} (sem mudancas)`);
  process.exit(0);
}

writeFileSync(
  target,
  JSON.stringify({ version, count, commit, builtAt: new Date().toISOString() }, null, 2) + '\n',
  'utf8'
);

console.log(`[version] ${version} (${commit})`);
