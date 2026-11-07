// ============================================================================
// AMBIENTE DE OPERAÇÃO — o toggle entre produção e sandbox.
//
// A IDEIA
// -------
// Um único interruptor decide se a operação é em PRODUÇÃO ou em SANDBOX.
// Todo o resto do sistema (a URL da Woovi, o script do webhook, o que mais
// vier) lê o mesmo interruptor. Assim:
//
//   - o CÓDIGO é o mesmo nos dois ambientes (o que se faz em sandbox é
//     literalmente o mesmo caminho de código que roda em produção);
//   - o BANCO é o que separa as duas pontas (instância de staging na VPS x
//     instância de produção) — o toggle não mexe no banco, ele mexe em
//     QUAL gateway externo a operação está falando.
//
// ONDE FICA
// ---------
// app_settings.ambiente = 'production' | 'sandbox'
//
// Uma variável de ambiente `AMBIENTE` tem o mesmo efeito e tem PRECEDÊNCIA
// sobre o banco — é assim que a instância de staging da VPS se declara
// sandbox sem precisar mexer no painel.
//
// VALORES ACEITOS (aliases)
// --------------------------
// Qualquer coisa que não seja um alias de sandbox é tratado como produção.
// Isso é proposital: o padrão seguro é produção.
// ============================================================================

export type AmbienteOperacao = "production" | "sandbox";

/** Chave no app_settings. */
export const AMBIENTE_KEY = "ambiente";

/** O que acontece quando ninguém configurou nada: produção. */
export const AMBIENTE_DEFAULT: AmbienteOperacao = "production";

/** Variável de ambiente que tem precedência sobre o banco. */
export const AMBIENTE_ENV_VAR = "AMBIENTE";

const ALIASES_SANDBOX = ["sandbox", "test", "testing", "staging", "homolog", "homologacao", "dev"];

/**
 * Normaliza qualquer valor para "production" ou "sandbox".
 *
 * Regra: o que não for reconhecidamente sandbox é produção. Errar para
 * produção é perigoso; errar para sandbox só custa um retrabalho.
 */
export function normalizarAmbiente(valor: string | null | undefined): AmbienteOperacao {
  const v = String(valor ?? "").trim().toLowerCase();
  if (!v) return AMBIENTE_DEFAULT;
  return ALIASES_SANDBOX.includes(v) ? "sandbox" : "production";
}

/**
 * Descobre o ambiente em operação.
 *
 * Precedência:
 *   1. variável de ambiente `AMBIENTE` (o deploy da VPS se declara aqui);
 *   2. app_settings.ambiente (o toggle do Admin);
 *   3. produção.
 */
export function getAmbiente(settings: Record<string, string> | null | undefined): AmbienteOperacao {
  const doEnv = safeEnv(AMBIENTE_ENV_VAR);
  if (doEnv) return normalizarAmbiente(doEnv);

  const doBanco = settings?.[AMBIENTE_KEY];
  if (doBanco) return normalizarAmbiente(doBanco);

  return AMBIENTE_DEFAULT;
}

/** Atalho booleano: estamos em ambiente de teste? */
export function ehSandbox(settings: Record<string, string> | null | undefined): boolean {
  return getAmbiente(settings) === "sandbox";
}

/** Rótulo para a tela do Admin. */
export function ambienteLabel(ambiente: AmbienteOperacao): string {
  return ambiente === "sandbox" ? "Sandbox (teste)" : "Produção";
}

/**
 * Lê uma variável de ambiente sem explodir quando o runtime não tem
 * `process` (o Deno usa `Deno.env`).
 */
function safeEnv(nome: string): string | null {
  try {
    const denoEnv = (globalThis as any).Deno?.env;
    if (denoEnv) {
      const v = denoEnv.get(nome);
      if (v) return v;
    }
  } catch {
    /* sem Deno */
  }
  try {
    const v = (globalThis as any).process?.env?.[nome];
    if (v) return v;
  } catch {
    /* sem process */
  }
  return null;
}
