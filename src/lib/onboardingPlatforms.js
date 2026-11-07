/**
 * Leitura das plataformas marcadas no onboarding.
 *
 * Fica num módulo próprio porque as DUAS telas do admin precisam da mesma
 * coisa: o relatório (/admin/onboarding) e a aba de qualificação da ficha do
 * usuário (/admin/users/[id]?tab=onboarding). Antes essa lógica estava
 * escrita dentro do relatório e a ficha mostrava os nomes crus — as duas
 * telas podiam acabar mostrando coisas diferentes.
 *
 * O detalhe que exige cuidado: a plataforma digitada à mão não tem
 * platform_id nem categoria, mas continua sendo a mesma plataforma escrita
 * de outro jeito ("Apple music" x "Apple Music"). Casar pelo nome devolve a
 * categoria e o ícone, e a plataforma entra no bloco certo.
 */
import { categoryLabel } from './onboardingQuestions';

/* "Nenhuma destas" é uma resposta, não uma plataforma. O gate oferece a
   opção e a pessoa pode digitar "nenhuma" no campo livre — nos dois casos
   não faz sentido contar isso como plataforma usada ou desejada. */
const NONE_ANSWER = /^(nenhuma|nenhum|nada|sem)\b/i;

export const isNoneAnswer = (name) => NONE_ANSWER.test((name || '').trim());

/**
 * Índice do catálogo de serviços (por id e por nome normalizado).
 * `services` vem de `streaming_services`.
 */
export function buildServiceLookup(services) {
  const byId = {};
  const byName = {};

  for (const s of services || []) {
    if (s?.id) byId[s.id] = s;
    byName[(s?.name || '').trim().toLowerCase()] = s;
  }

  return {
    byId,
    byName,
    /** O serviço real por trás de uma linha de interesse (ou null). */
    resolve(interest) {
      if (!interest) return null;
      if (interest.platform_id && byId[interest.platform_id]) return byId[interest.platform_id];
      return byName[(interest.platform_name || '').trim().toLowerCase()] || null;
    },
  };
}

/**
 * Agrupa as plataformas por categoria, na ordem alfabética das categorias.
 * Cada item já vem pronto para renderizar (ícone, cor, etiqueta de "outra").
 */
export function groupPlatformsByCategory(list, lookup) {
  const map = new Map();

  for (const item of list || []) {
    if (isNoneAnswer(item.platform_name)) continue;
    const svc = lookup?.resolve?.(item) || null;
    const key = svc?.category || 'outras';
    if (!map.has(key)) {
      map.set(key, { key, label: categoryLabel(svc?.category), items: [] });
    }

    const name = svc?.name || item.platform_name;
    // A mesma plataforma pode entrar duas vezes (id e nome digitado).
    if (map.get(key).items.some((p) => p.name === name)) continue;

    map.get(key).items.push({
      name,
      icon: svc?.icon_url || null,
      color: svc?.color || null,
      custom: !!item.is_custom && !svc,
    });
  }

  return [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}
