import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

/**
 * Versao do app injetada no bundle.
 *
 * Ordem: variavel de ambiente -> src/version.json (gerado por
 * scripts/set-version.mjs no prebuild) -> numero de commits do git ->
 * package.json. O fallback por commit e o que mantem o contador andando
 * mesmo que o arquivo gerado nao tenha vindo no upload.
 */
function resolveAppVersion() {
  const fromEnv = (process.env.APP_VERSION || '').trim()
  if (fromEnv) return fromEnv

  const versionFile = new URL('./src/version.json', import.meta.url)
  if (existsSync(versionFile)) {
    try {
      const parsed = JSON.parse(readFileSync(versionFile, 'utf8'))
      if (parsed?.version) return parsed.version
    } catch {
      // arquivo invalido: cai para o proximo metodo
    }
  }

  try {
    const count = execFileSync('git', ['rev-list', '--count', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (count && Number(count) > 0) return `1.0.${count}`
  } catch {
    // sem git (build isolado): proximo metodo
  }

  try {
    const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
    return pkg.version || '1.0.0'
  } catch {
    return '1.0.0'
  }
}

/**
 * Carimba a versao do build no service worker.
 *
 * O `public/sw.js` chega no `dist/` com o placeholder `__DP_BUILD__`. O
 * nome do cache PRECISA mudar a cada build: com o nome fixo, o cache
 * sobrevivia a todos os deploys, o index.html guardado continuava
 * apontando para o bundle velho e o cliente ficava preso na primeira
 * versao que abriu (com a tela antiga, mesmo com o site novo no ar).
 */
function stampServiceWorker() {
  return {
    name: 'stamp-service-worker',
    apply: 'build',
    closeBundle() {
      const destino = new URL('./dist/sw.js', import.meta.url)
      if (!existsSync(destino)) return
      const antes = readFileSync(destino, 'utf8')
      if (!antes.includes('__DP_BUILD__')) return

      let carimbo = 'dev'
      const versaoFile = new URL('./src/version.json', import.meta.url)
      if (existsSync(versaoFile)) {
        try {
          const parsed = JSON.parse(readFileSync(versaoFile, 'utf8'))
          carimbo = `${parsed?.version || '0'}-${parsed?.commit || 'local'}`
        } catch {
          /* sem version.json valido */
        }
      }

      writeFileSync(destino, antes.replaceAll('__DP_BUILD__', carimbo), 'utf8')
      console.log(`[vite] cache do service worker -> dividepass-pwa-${carimbo}`)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), stampServiceWorker()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  define: {
    __APP_VERSION__: JSON.stringify(resolveAppVersion()),
  },
  css: {
    transformer: 'esbuild',
    devSourcemap: true,
  },
  build: {
    cssMinify: false,
    codeSplitting: false,
  },
})
