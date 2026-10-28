import { useEffect, useId, useMemo, useRef, useState } from 'react';
import './AdminChart.css';

/**
 * Gráfico SVG do painel admin: barras + linhas, com eixo duplo opcional.
 *
 * Por que SVG feito à mão em vez de uma biblioteca: o projeto não tem
 * dependência de gráficos e nenhuma precisa entrar no bundle. Um gráfico
 * aqui é math pura — escala, caminho, área — e sai em ~250 linhas.
 *
 * DECISÕES DE DESIGN
 * ------------------
 * - Barra com gradiente vertical e **cantos arredondados só no topo** (a
 *   base é reta, encostada na linha do zero). Retângulo de cantos reto
 *   deixava o gráfico com cara de planilha.
 * - Grade só na horizontal, bem discreta: a grade vertical compete com as
 *   barras e suja a leitura.
 * - Rótulo de valor sobre a barra quando há poucos buckets — o gráfico
 *   responde sozinho, sem precisar passar o mouse.
 * - Eixo com piso e TETO: valor negativo (lucro negativo) fica dentro da
 *   área plotada em vez de vazar para o conteúdo seguinte da página.
 * - Tooltip em HTML sobreposto: é mais fácil de estilizar e formatar do
 *   que texto dentro do próprio SVG.
 */

/** Mede a largura real do container para o SVG ficar nítido (sem escalonar). */
function useContainerWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;

    const update = () => setWidth(element.clientWidth);
    update();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }

    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/**
 * Escala com topo/base arredondados — e com suporte a valores NEGATIVOS.
 *
 * O lucro de um mês pode ser negativo (receita menor que custo). Numa
 * escala que só conhece "0 até o máximo", o ponto negativo sai PARA BAIXO
 * da base do gráfico e invade o conteúdo que vem depois. Aqui a escala tem
 * piso e teto, e a linha do zero fica dentro da área plotada.
 *
 * @param {number} rawMin menor valor da série (0 se não houver negativo)
 * @param {number} rawMax maior valor da série
 * @param {number} tickCount quantos intervalos a grade deve ter
 */
function niceScale(rawMin, rawMax, tickCount = 4) {
  const min = Math.min(0, Number.isFinite(rawMin) ? rawMin : 0);
  const max = Math.max(0, Number.isFinite(rawMax) ? rawMax : 0);

  if (max === 0 && min === 0) {
    return { min: 0, max: 1, ticks: [0, 0.25, 0.5, 0.75, 1] };
  }

  // Com valor negativo a faixa é maior e 4 intervalos deixavam metade do
  // gráfico vazio acima dos dados (custo máximo R$ 538 com teto em R$ 1.000).
  // Com 5 intervalos o teto cai para R$ 600 e o desenho preenche o espaço.
  const intervals = min < 0 ? tickCount + 1 : tickCount;

  const span = max - min;
  const rough = span / intervals;
  const exponent = Math.floor(Math.log10(rough));
  const base = 10 ** exponent;
  const normalized = rough / base;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * base;

  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;

  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    ticks.push(Number(value.toFixed(10)));
  }

  return { min: niceMin, max: niceMax, ticks };
}

/** Caminho SVG de uma linha (segmentos retos — dados não devem ser suavizados). */
function buildLinePath(points) {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');
}

/** Área entre a linha e a linha do zero. */
function buildAreaPath(points, baselineY) {
  if (!points.length) return '';
  const line = buildLinePath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(2)},${baselineY.toFixed(2)} Z`;
}

/**
 * Barra com cantos arredondados só na ponta (a que está longe da linha do
 * zero). Barra crescendo para cima arredonda o topo; barra negativa
 * (crescendo para baixo) arredonda a base.
 */
function buildBarPath(x, y, width, height, radius) {
  const size = Math.abs(height);
  const r = Math.max(0, Math.min(radius, width / 2, size));
  const right = x + width;

  if (height >= 0) {
    return `M${x},${y + size} L${x},${y + r} Q${x},${y} ${x + r},${y} L${right - r},${y} Q${right},${y} ${right},${y + r} L${right},${y + size} Z`;
  }

  return `M${x},${y} L${x},${y + size - r} Q${x},${y + size} ${x + r},${y + size} L${right - r},${y + size} Q${right},${y + size} ${right},${y + size - r} L${right},${y} Z`;
}

/**
 * @param {object[]} data        linhas do gráfico: [{ [seriesKey]: number }]
 * @param {object[]} series      [{ key, label, type: 'bar'|'line'|'area', color, axis }]
 * @param {string[]} labels      rótulo do eixo X de cada linha
 * @param {number} height        altura do SVG em px
 * @param {Function} formatValue valor formatado no tooltip
 * @param {Function} formatLabel valor formatado sobre a barra (padrão: formatValue)
 * @param {Function} formatAxis  valor formatado no eixo
 * @param {boolean} showValues   escreve o valor sobre a barra
 */
export default function AdminChart({
  data = [],
  series = [],
  labels = [],
  height = 280,
  formatValue = (value) => String(value),
  formatLabel = null,
  formatAxis = (value) => String(value),
  showValues = false,
  emptyMessage = 'Sem dados no período selecionado.',
}) {
  const [wrapRef, width] = useContainerWidth();
  const [hoverIndex, setHoverIndex] = useState(null);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9]/g, '');

  const hasRightAxis = series.some((item) => item.axis === 'right');
  const barSeries = series.filter((item) => item.type === 'bar');
  const barCount = Math.max(1, barSeries.length);

  const scales = useMemo(() => {
    let leftMin = 0;
    let leftMax = 0;
    let rightMin = 0;
    let rightMax = 0;

    series.forEach((item) => {
      data.forEach((row) => {
        const value = Number(row[item.key]);
        if (!Number.isFinite(value)) return;
        if (item.axis === 'right') {
          rightMin = Math.min(rightMin, value);
          rightMax = Math.max(rightMax, value);
        } else {
          leftMin = Math.min(leftMin, value);
          leftMax = Math.max(leftMax, value);
        }
      });
    });

    return {
      left: niceScale(leftMin, leftMax),
      right: niceScale(rightMin, rightMax),
    };
  }, [data, series]);

  const padding = { top: showValues ? 26 : 18, right: hasRightAxis ? 64 : 18, bottom: 32, left: 60 };
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = Math.max(0, height - padding.top - padding.bottom);
  const baselineY = padding.top + plotHeight;

  const slot = data.length > 0 ? plotWidth / data.length : plotWidth;
  const barWidth = Math.max(3, Math.min(34, (slot * 0.58) / barCount));

  /**
   * Converte um valor em coordenada Y. A escala tem PISO e TETO: um valor
   * negativo (lucro negativo) fica dentro da área plotada, e não abaixo
   * dela — fora do SVG ele invadia o conteúdo seguinte da página.
   */
  const scaleY = (value, axis) => {
    const scale = axis === 'right' ? scales.right : scales.left;
    const range = scale.max - scale.min || 1;
    const numeric = Number(value);
    const safe = Number.isFinite(numeric) ? numeric : 0;
    const clamped = Math.max(scale.min, Math.min(scale.max, safe));
    return baselineY - ((clamped - scale.min) / range) * plotHeight;
  };

  /** Posição da linha do zero (base das barras e das áreas). */
  const zeroY = (axis) => scaleY(0, axis);

  const centerX = (index) => padding.left + slot * (index + 0.5);

  const rendered = series.map((item) => {
    const points = data.map((row, index) => ({
      x: centerX(index),
      y: scaleY(row[item.key], item.axis),
      value: Number(row[item.key]) || 0,
    }));

    return { item, points };
  });

  // Rótulos do eixo X ficam espaçados quando há muitos buckets.
  const maxLabels = Math.max(1, Math.floor(plotWidth / 54));
  const labelStride = Math.max(1, Math.ceil(data.length / maxLabels));

  // Com muitos buckets o rótulo de valor sobre a barra vira ruído.
  const valueLabelsVisible = showValues && data.length > 0 && data.length <= 16;
  const labelFormatter = formatLabel || formatValue;

  const isEmpty = data.length === 0 || series.length === 0;
  const hover = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div className="chart-wrap" ref={wrapRef}>
      {isEmpty ? (
        <div className="chart-empty">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M3 3v18h18"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span>{emptyMessage}</span>
        </div>
      ) : (
        <svg
          className="chart-svg"
          width={width || 600}
          height={height}
          viewBox={`0 0 ${width || 600} ${height}`}
          role="img"
          aria-label="Gráfico de evolução"
        >
          <defs>
            {series.map((item) => (
              <linearGradient
                key={`grad-${item.key}`}
                id={`chart-grad-${uid}-${item.key}`}
                x1="0"
                y1="0"
                x2="0"
                y2="1"
              >
                <stop offset="0%" stopColor={item.color} stopOpacity="1" />
                <stop offset="100%" stopColor={item.color} stopOpacity="0.42" />
              </linearGradient>
            ))}
            {series
              .filter((item) => item.type === 'area')
              .map((item) => (
                <linearGradient
                  key={`area-${item.key}`}
                  id={`chart-area-${uid}-${item.key}`}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="1"
                >
                  <stop offset="0%" stopColor={item.color} stopOpacity="0.3" />
                  <stop offset="100%" stopColor={item.color} stopOpacity="0.01" />
                </linearGradient>
              ))}
          </defs>

          {/* Grade + eixo Y esquerdo */}
          {scales.left.ticks.map((tick) => {
            const y = scaleY(tick, 'left');
            const isZero = tick === 0;
            return (
              <g key={`gl-${tick}`}>
                <line
                  x1={padding.left}
                  x2={padding.left + plotWidth}
                  y1={y}
                  y2={y}
                  className={isZero ? 'chart-axis-line' : 'chart-grid-line'}
                />
                <text x={padding.left - 12} y={y + 4} className="chart-axis-text" textAnchor="end">
                  {formatAxis(tick)}
                </text>
              </g>
            );
          })}

          {/* Eixo Y direito */}
          {hasRightAxis &&
            scales.right.ticks.map((tick) => {
              const y = scaleY(tick, 'right');
              return (
                <text
                  key={`gr-${tick}`}
                  x={padding.left + plotWidth + 12}
                  y={y + 4}
                  className="chart-axis-text"
                  textAnchor="start"
                >
                  {formatAxis(tick)}
                </text>
              );
            })}

          {/* Barras */}
          {rendered
            .filter(({ item }) => item.type === 'bar')
            .map(({ item, points }) =>
              points.map((point, index) => {
                const barIndex = barSeries.findIndex((candidate) => candidate.key === item.key);
                const groupWidth = barWidth * barCount;
                const offset = -groupWidth / 2 + barIndex * barWidth;
                const base = zeroY(item.axis);
                const y = Math.min(point.y, base);
                const barHeight = Math.abs(base - point.y);
                const dimmed = hoverIndex !== null && hoverIndex !== index;

                return (
                  <g key={`${item.key}-${index}`}>
                    <path
                      d={buildBarPath(point.x + offset, y, Math.max(2, barWidth - 3), barHeight, 5)}
                      fill={`url(#chart-grad-${uid}-${item.key})`}
                      className="chart-bar"
                      opacity={dimmed ? 0.38 : 1}
                    />
                    {valueLabelsVisible && (
                      <text
                        x={point.x + offset + (barWidth - 3) / 2}
                        y={point.y < base ? point.y - 8 : point.y + 16}
                        className="chart-value-text"
                        textAnchor="middle"
                      >
                        {labelFormatter(point.value)}
                      </text>
                    )}
                  </g>
                );
              })
            )}

          {/* Áreas e linhas */}
          {rendered
            .filter(({ item }) => item.type === 'area' || item.type === 'line')
            .map(({ item, points }) => (
              <g key={item.key}>
                {item.type === 'area' && (
                  <path
                    d={buildAreaPath(points, zeroY(item.axis))}
                    fill={`url(#chart-area-${uid}-${item.key})`}
                  />
                )}
                <path
                  d={buildLinePath(points)}
                  fill="none"
                  stroke={item.color}
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="chart-line"
                  strokeDasharray={item.dashed ? '6 5' : undefined}
                />
                {points.map((point, index) => (
                  <circle
                    key={`${item.key}-dot-${index}`}
                    cx={point.x}
                    cy={point.y}
                    r={hoverIndex === index ? 5.5 : 4}
                    fill="var(--surface)"
                    stroke={item.color}
                    strokeWidth="2.5"
                    className="chart-dot"
                  />
                ))}
              </g>
            ))}

          {/* Eixo X */}
          {labels.map((label, index) => {
            if (index % labelStride !== 0) return null;
            return (
              <text
                key={`${label}-${index}`}
                x={centerX(index)}
                y={baselineY + 21}
                className="chart-axis-text chart-axis-text-x"
                textAnchor="middle"
              >
                {label}
              </text>
            );
          })}

          {/* Alvos de hover (um por bucket) */}
          {data.map((row, index) => (
            <rect
              key={`hit-${index}`}
              x={padding.left + slot * index}
              y={padding.top}
              width={slot}
              height={plotHeight}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(index)}
              onMouseLeave={() => setHoverIndex(null)}
            />
          ))}
        </svg>
      )}

      {hover && !isEmpty && (
        <div
          className="chart-tooltip"
          style={{
            left: `${padding.left + slot * (hoverIndex + 0.5)}px`,
            top: `${padding.top}px`,
          }}
          role="status"
        >
          <span className="chart-tooltip-title">{labels[hoverIndex]}</span>
          {series.map((item) => (
            <span key={item.key} className="chart-tooltip-row">
              <i style={{ background: item.color }} aria-hidden />
              <span className="chart-tooltip-label">{item.label}</span>
              <strong>{formatValue(hover[item.key])}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
