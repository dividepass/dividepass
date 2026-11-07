import { useMemo, useState } from 'react';
import { ThumbsUp, Users } from 'lucide-react';
import ServiceLogo from './ServiceLogo';
import { useEngagement } from '../hooks/useEngagement';
import { buildVoteCandidates } from '../lib/catalogEngagement';
import './engagement.css';

/**
 * "O que você gostaria de compartilhar?"
 *
 * Voto de interesse: a pessoa aponta o que ela quer dividir. O voto ajuda a
 * decidir quais grupos abrir primeiro — quem votou mostra no topo da fila.
 *
 * Os candidatos saem do próprio comportamento da plataforma: o que a pessoa
 * já está esperando vaga, o que tem mais votos e o que tem mais gente na
 * lista de espera.
 */
export default function InterestPollCard({ services = [], groups = [], limit = 6 }) {
  const { votes, voteCounts, interestCounts, watchlist, toggleVote } = useEngagement();
  const [busyId, setBusyId] = useState(null);

  const candidates = useMemo(
    () =>
      buildVoteCandidates({
        services,
        groups,
        watchlist,
        votes,
        voteCounts,
        interestCounts,
        limit,
      }),
    [services, groups, watchlist, votes, voteCounts, interestCounts, limit]
  );

  if (candidates.length === 0) return null;

  const handleVote = async (serviceId) => {
    if (busyId) return;
    setBusyId(serviceId);
    try {
      await toggleVote(serviceId);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="vote-card">
      <div className="vote-card-header">
        <h2>O que você gostaria de compartilhar?</h2>
        <p>
          Vote em um serviço para demonstrar interesse e ajudar a definir os
          próximos grupos.
        </p>
      </div>

      <div className="vote-grid">
        {candidates.map((candidate) => {
          const { service } = candidate;
          const voted = votes.has(service.id);
          const count = voteCounts.get(service.id) || 0;

          return (
            <div
              key={service.id}
              className={`vote-item${voted ? ' vote-item--voted' : ''}`}
            >
              <ServiceLogo service={service} className="vote-item-logo" />

              <span className="vote-item-main">
                <span className="vote-item-name">{service.name}</span>
                <span className="vote-item-sub">
                  {candidate.waiting > 0 ? (
                    <>
                      <Users size={10} /> {candidate.waiting}{' '}
                      {candidate.waiting === 1 ? 'pessoa esperando' : 'pessoas esperando'}
                    </>
                  ) : candidate.hasOpenGroup ? (
                    'Já tem grupo aberto'
                  ) : (
                    'Nenhum grupo ainda'
                  )}
                </span>
              </span>

              <button
                type="button"
                className={`vote-btn${voted ? ' vote-btn--active' : ''}`}
                onClick={() => handleVote(service.id)}
                disabled={busyId === service.id}
                aria-pressed={voted}
                title={voted ? 'Tirar meu voto' : 'Votar neste serviço'}
              >
                <ThumbsUp size={13} />
                {count > 0 ? count : 'Votar'}
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
