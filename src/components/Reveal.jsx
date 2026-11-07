import { motion, useReducedMotion } from 'motion/react';

/**
 * Revela o conteúdo quando ele entra na tela (rolando a página).
 *
 * A animação é SÓ de `transform` (deslocamento + escala). A regra do
 * projeto é não usar `opacity: 0` no estado inicial: se o navegador pausar o
 * requestAnimationFrame (aba em segundo plano), o conteúdo fica com opacidade
 * zero e não volta sozinho — a tela fica branca. Com transform, o pior
 * caso é o bloco parado 20px abaixo, o que ainda é legível.
 *
 * Uso:
 *   <Reveal delay={0.1} as="section"> ... </Reveal>
 */
export default function Reveal({
  children,
  as = 'div',
  delay = 0,
  y = 20,
  scale = 0.985,
  className = '',
  once = true,
  amount = 0.15,
  ...rest
}) {
  const reduced = useReducedMotion();
  const Tag = as;

  if (reduced) {
    return (
      <Tag className={className} {...rest}>
        {children}
      </Tag>
    );
  }

  const Comp = motion[as] || motion.div;

  return (
    <Comp
      className={className}
      {...rest}
      initial={{ y, scale }}
      whileInView={{ y: 0, scale: 1 }}
      viewport={{ once, amount, margin: '0px 0px -60px 0px' }}
      transition={{ duration: 0.55, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </Comp>
  );
}
