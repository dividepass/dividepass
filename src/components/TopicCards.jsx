import { Link } from 'react-router-dom';
import { IconeCategoria } from '../lib/categorias';
import useAutoScroll from '../hooks/useAutoScroll';
import './dashboard-insights.css';

/**
 * Tópicos do catálogo — cards pequenos numa fileira que rola pro lado.
 *
 * É o mesmo desenho do iFood na home: um ícone redondo + o nome do tópico,
 * em scroll horizontal. Tocar num tópico filtra a grade de serviços logo
 * abaixo, então a pessoa não precisa ler a lista inteira para achar o que
 * quer.
 *
 * Dois modos:
 *  - `onSelect`: o tópico FILTRA a grade na hora (usado no catálogo);
 *  - `hrefFor`: o tópico é um LINK que leva para a listagem já filtrada
 *    (usado na home, onde tocar no ícone precisa abrir os serviços da
 *    categoria — antes o clique não levava a lugar nenhum).
 *
 * A fileira também anda sozinha, um passo a cada 5 segundos.
 */
export default function TopicCards({
  topics = [],
  selected = 'all',
  onSelect,
  hrefFor,
}) {
  const trackRef = useAutoScroll({ interval: 5000 });

  if (!topics.length) return null;

  return (
    <section className="topic-cards" aria-label="Tópicos">
      <div className="topic-cards-track" ref={trackRef}>
        {topics.map((topic) => {
          const ativo = topic.key === selected;
          const Icon = topic.Icon || IconeCategoria({ category: topic.key });
          const conteudo = (
            <>
              <span className="topic-card-icon">
                {Icon ? <Icon size={22} strokeWidth={2} aria-hidden /> : topic.icon}
              </span>
              <span className="topic-card-label">{topic.label}</span>
            </>
          );

          if (hrefFor) {
            return (
              <Link
                key={topic.key}
                to={hrefFor(topic.key)}
                className={`topic-card ${ativo ? 'active' : ''}`}
                aria-label={`Ver serviços de ${topic.label}`}
              >
                {conteudo}
              </Link>
            );
          }

          return (
            <button
              key={topic.key}
              type="button"
              className={`topic-card ${ativo ? 'active' : ''}`}
              onClick={() => onSelect?.(topic.key)}
              aria-pressed={ativo}
            >
              {conteudo}
            </button>
          );
        })}
      </div>
    </section>
  );
}
