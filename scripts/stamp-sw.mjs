/**
 * CARIMBA A VERSAO DO BUILD NO SERVICE WORKER (postbuild).
 *
 * O `public/sw.js` chega no `dist/` com o placeholder `__DP_BUILD__`. Aqui
 * ele vira `dividepass-pwa-<versao>-<commit>`.
 *
 * POR QUE IMPORTA: com o nome do cache fixo, o cache do service worker
 * sobrevivia a todos os deploys. O `index.html` guardado no cache
 * continuava apontando para o bundle velho e o cliente ficava preso na
 * primeira versao que abriu (com a tela antiga, mesmo com o site novo no
 * ar). Com o nome mudando a cada build, o `activate` apaga o cache
 * antigo e a versao nova entra.
 *
 * Roda no `postbuild` (npm run build).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const swDestino = join(root, 'dist', 'sw.js');
const versaoArquivo = join(root, 'src', 'version.json');

if (!existsSync(swDestino)) {
  console.warn('[stamp-sw] dist/sw.js nao existe — nada a carimbar.');
  process.exit(0);
}

let carimbo = 'dev';
try {
  const v = JSON.parse(readFileSync(versaoArquivo, 'utf8'));
  carimbo = `${v.version || '0'}-${v.commit || 'local'}`;
} catch {
  /* sem version.json: mantem o placeholder */
}

const antes = readFileSync(swDestino, 'utf8');
if (!antes.includes('__DP_BUILD__')) {
  console.log('[stamp-sw] sw.js ja carimbado — nada a fazer.');
  process.exit(0);
}

const depois = antes.replaceAll('__DP_BUILD__', carimbo);
writeFileSync(swDestino, depois, 'utf8');
console.log(`[stamp-sw] cache do service worker -> dividepass-pwa-${carimbo}`);
