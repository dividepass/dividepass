import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocation } from 'react-router-dom'
import { page } from '../lib/motion'

/**
 * Transicao entre rotas.
 *
 * Uso (dentro de um layout, envolvendo o `<Outlet />`):
 *
 *   <AnimatePresence mode="wait" initial={false}>
 *     <PageTransition />
 *   </AnimatePresence>
 *
 * O `key` vem da URL: e ele que faz o Motion entender que "e uma pagina
 * nova" e rodar a animacao de entrada. Quem respeita `prefers-reduced-motion`
 * recebe a troca sem deslocamento.
 */
export function PageTransition({ children }) {
  const location = useLocation()
  const reduced = useReducedMotion()

  if (reduced) {
    return <div key={location.pathname}>{children}</div>
  }

  return (
    <motion.div
      key={location.pathname}
      initial={page.initial}
      animate={page.animate}
      exit={page.exit}
      transition={page.transition}
    >
      {children}
    </motion.div>
  )
}

export default PageTransition
