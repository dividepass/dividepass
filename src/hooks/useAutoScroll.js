import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * ROLA O TRILHO SOZINHO — um passo de cada vez, num intervalo fixo.
 *
 * As fileiras da vitrine (ícones redondos, cards de oferta) ficavam
 * paradas esperando a pessoa arrastar. Numa vitrine de app, a fileira anda
 * sozinha: dá para ver o conteúdo inteiro sem tocar em nada.
 *
 * Regras:
 *  - só rola se o conteúdo for MAIOR que a área visível (senão fica parado);
 *  - quando chega no fim, volta pro começo (loop);
 *  - pausa enquanto a pessoa está com o mouse em cima ou arrastando o dedo
 *    — ninguém quer a lista mexendo sozinha na hora de clicar;
 *  - qualquer rolagem manual reinicia a contagem, então a pessoa tem sempre
 *    os `interval` segundos de sossego antes do próximo passo.
 *
 * USO:
 *   const trackRef = useAutoScroll({ interval: 5000 });
 *   <div ref={trackRef}>...</div>
 *
 * O hook devolve um REF DE CALLBACK (e não um `useRef`), porque a fileira
 * pode não existir no primeiro render — a vitrine só aparece quando os
 * dados chegam. Com um `useRef` comum, o efeito rodaria uma vez no mount,
 * com `ref.current` ainda nulo, e a fileira nunca andaria sozinha.
 *
 * @param {object} options  { interval: ms entre um passo e outro }
 * @returns {function}       ref de callback para colocar no trilho
 */
export default function useAutoScroll({ interval = 5000 } = {}) {
  const [el, setEl] = useState(null);
  const estado = useRef({ timer: null, pausado: false });

  const ref = useCallback((node) => {
    setEl(node);
  }, []);

  useEffect(() => {
    if (!el) return undefined;

    const parar = () => {
      if (estado.current.timer) {
        clearInterval(estado.current.timer);
        estado.current.timer = null;
      }
    };

    const passo = () => {
      const max = el.scrollWidth - el.clientWidth;
      // Não cabe mais nada -> não tem o que rolar.
      if (max <= 4) return;

      const primeiro = el.firstElementChild;
      const estilos = getComputedStyle(el);
      const gap = parseFloat(estilos.columnGap || estilos.gap || '0') || 0;
      const largura = primeiro
        ? primeiro.getBoundingClientRect().width + gap
        : el.clientWidth * 0.8;

      let destino = el.scrollLeft + largura;
      // Chegou no fim: volta pro começo (loop).
      if (destino >= max - 2) destino = 0;
      el.scrollTo({ left: destino, behavior: 'smooth' });
    };

    const iniciar = () => {
      parar();
      estado.current.timer = setInterval(() => {
        if (estado.current.pausado) return;
        passo();
      }, interval);
    };

    iniciar();

    const pausar = () => {
      estado.current.pausado = true;
    };
    const retomar = () => {
      estado.current.pausado = false;
    };
    // Rolagem manual: a contagem recomeça (a pessoa fica com o controle).
    const aoRolar = () => {
      if (estado.current.pausado) return;
      iniciar();
    };

    el.addEventListener('mouseenter', pausar);
    el.addEventListener('mouseleave', retomar);
    el.addEventListener('touchstart', pausar, { passive: true });
    el.addEventListener('touchend', retomar, { passive: true });
    el.addEventListener('scroll', aoRolar, { passive: true });

    return () => {
      parar();
      el.removeEventListener('mouseenter', pausar);
      el.removeEventListener('mouseleave', retomar);
      el.removeEventListener('touchstart', pausar);
      el.removeEventListener('touchend', retomar);
      el.removeEventListener('scroll', aoRolar);
    };
  }, [el, interval]);

  return ref;
}
