import './dashboard-insights.css';

/**
 * Tópicos do catálogo — cards pequenos numa fileira que rola pro lado.
 *
 * É o mesmo desenho do iFood na home: um ícone redondo + o nome do tópico,
 * em scroll horizontal. Tocar num tópico filtra a grade de serviços logo
 * abaixo, então a pessoa não precisa ler a lista inteira para achar o que
 * quer.
 */
export default function TopicCards({ topics = [], selected = 'all', onSelect }) {
  if (!topics.length) return null;

  return (
    <section className="topic-cards" aria-label="Tópicos">
      <div className="topic-cards-track">
        {topics.map((topic) => {
          const ativo = topic.key === selected;
          return (
            <button
              key={topic.key}
              type="button"
              className={`topic-card ${ativo ? 'active' : ''}`}
              onClick={() => onSelect?.(topic.key)}
              aria-pressed={ativo}
            >
              <span className="topic-card-icon">{topic.icon}</span>
              <span className="topic-card-label">{topic.label}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
