/**
 * AMBIENTE DE OPERAÇÃO — o interruptor entre produção e sandbox.
 *
 * É o MESMO conceito do backend (`supabase/functions/_shared/ambiente.ts`).
 * As duas pontas precisam falar a mesma língua: o valor salvo é
 * `app_settings.ambiente` e o valor aceito é `production` | `sandbox`.
 *
 * Um único interruptor, um único lugar para trocar.
 */

export const AMBIENTE_KEY = 'ambiente';
export const AMBIENTE_DEFAULT = 'production';

/** Aliases aceitos. O que não for alias de sandbox é produção. */
const ALIASES_SANDBOX = ['sandbox', 'test', 'testing', 'staging', 'homolog', 'homologacao', 'dev'];

/**
 * Normaliza qualquer valor para 'production' ou 'sandbox'.
 *
 * Regra: o que não for reconhecidamente sandbox é produção. Errar para
 * produção é perigoso; errar para sandbox só custa um retrabalho.
 */
export function normalizarAmbiente(valor) {
  const v = String(valor ?? '').trim().toLowerCase();
  if (!v) return AMBIENTE_DEFAULT;
  return ALIASES_SANDBOX.includes(v) ? 'sandbox' : 'production';
}

/** Rótulo para a tela do Admin. */
export function ambienteLabel(ambiente) {
  return normalizarAmbiente(ambiente) === 'sandbox' ? 'Sandbox (teste)' : 'Produção';
}

/** Texto de aviso do banner de sandbox. */
export function ambienteAviso(ambiente) {
  if (normalizarAmbiente(ambiente) !== 'sandbox') return null;
  return 'As cobranças estão indo para o ambiente de TESTE do gateway. Nenhum dinheiro real é movimentado e nenhum Pix válido é gerado.';
}
