import { useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import './Confetti.css';

/* Cores da marca: o confete tem que parecer do DividePass, não de festa de
   aniversário genérica. */
export const CORES_CONFETE = [
  '#4F46E5', // indigo
  '#7C3AED', // violeta
  '#F97316', // laranja
  '#FBBF24', // âmbar
  '#10B981', // verde
  '#EC4899', // rosa
];

/**
 * Confete.
 *
 * O gatilho é o `fire`: troque o valor (normalmente um contador) e o
 * confete dispara de novo. A camada é `position: absolute` dentro de quem
 * renderiza — no card da home o confete fica contido no card; no cadastro e
 * no onboarding ele é montado dentro de um overlay de tela cheia.
 *
 * A animação é só `transform` + `opacity` de um elemento descartável, então
 * não depende de nenhuma biblioteca nova: o projeto já usa `motion`.
 */
export default function Confetti({
  fire = 0,
  count = 64,
  colors = CORES_CONFETE,
  fall = 420,
  className = '',
}) {
  const reduced = useReducedMotion();

  /* Cada disparo sorteia posições novas — por isso as peças são regeradas
     junto com o `fire`. */
  const pieces = useMemo(() => {
    return Array.from({ length: count }, (_, i) => {
      const tamanho = 6 + Math.random() * 7;
      return {
        id: `${fire}-${i}`,
        left: Math.random() * 100,
        queda: fall + Math.random() * 120,
        deriva: (Math.random() - 0.5) * 120,
        giro: Math.random() * 720 - 360,
        atraso: Math.random() * 0.4,
        duracao: 1.5 + Math.random() * 1.4,
        tamanho,
        redondo: Math.random() > 0.55,
        cor: colors[i % colors.length],
      };
    });
  }, [count, fall, fire, colors]);

  /* Quem pediu menos movimento no sistema operacional não ganha confete. */
  if (!fire || reduced) return null;

  return (
    <div className={`confetti-layer ${className}`} key={fire} aria-hidden="true">
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className={`confetti-piece ${p.redondo ? 'is-round' : ''}`}
          style={{
            left: `${p.left}%`,
            width: p.tamanho,
            height: p.redondo ? p.tamanho : p.tamanho * 0.55,
            background: p.cor,
          }}
          initial={{ y: -40, x: 0, rotate: 0, opacity: 0 }}
          animate={{ y: p.queda, x: p.deriva, rotate: p.giro, opacity: [0, 1, 1, 0] }}
          transition={{ duration: p.duracao, delay: p.atraso, ease: 'easeIn' }}
        />
      ))}
    </div>
  );
}
