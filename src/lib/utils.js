import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Helper de classe do shadcn/ui.
 *
 * `clsx` monta a lista (aceita arrays, objetos, condicoes) e `twMerge`
 * resolve conflito entre utilities do Tailwind: `cn('p-2', 'p-4')` -> `p-4`.
 * Sem o twMerge, o `className` passado pelo consumidor nao sobrescreve o
 * default do componente.
 */
export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
