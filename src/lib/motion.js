/**
 * Motion (Framer Motion) — vocabulario de animacao do DividePass.
 *
 * Todas as variantes sao "opacas": nao conflitam com o CSS legado porque
 * usam apenas `opacity` e `transform`. As telas que ainda usam o CSS antigo
 * continuam animando por CSS; as migradas usam estas variantes.
 *
 * IMPORTANTE: qualquer animacao que troque de posicao (layout) deve usar
 * `layout` do Motion ou uma classe utilitaria — o modo `popLayout` do
 * `AnimatePresence` evita que o layout "pule" durante a troca de rota.
 */

/* Curvas de easing. `out` e a curva padrao da interface (rapida no inicio,
   suave no final). */
export const easing = {
  out: [0.22, 1, 0.36, 1],
  inOut: [0.65, 0, 0.35, 1],
  spring: { type: 'spring', stiffness: 260, damping: 28, mass: 0.9 },
}

/* Entrada/saida simples de opacidade. */
export const fade = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
}

/* Entrada padrao de um bloco de conteudo: sobe 12px enquanto aparece. */
export const fadeUp = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.32, ease: easing.out },
}

/* Entrada de um cartao com escala discreta — bom para grids de KPI. */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: 0.28, ease: easing.out },
}

/* Item de lista que entra depois do container (ver `stagger`). */
export const listItem = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.26, ease: easing.out },
}

/**
 * Container que escalona a entrada dos filhos.
 * Uso: `<motion.div variants={staggerContainer()}>` com filhos `listItem`.
 */
export function staggerContainer(stagger = 0.06, delayChildren = 0) {
  return {
    animate: {
      transition: { staggerChildren: stagger, delayChildren },
    },
  }
}

/* Transicao de pagina. Curta de proposito: em um app de dashboard, uma
   animacao de 400ms na troca de rota comeca a atrasar o trabalho do usuario. */
export const page = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.26, ease: easing.out },
}

/* Transicao usada nos itens que saem da tela (toast, dialog, sheet). */
export const pop = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.97 },
  transition: { duration: 0.18, ease: easing.out },
}

/**
 * Sem movimento para quem pediu no sistema operacional.
 * Use no `transition` para cortar animacoes sem desmontar a arvore.
 */
export function motionTransition(reduced, duration = 0.3, ease = easing.out) {
  if (reduced) return { duration: 0 }
  return { duration, ease }
}
