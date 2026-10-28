import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

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

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
