import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Search, X, ShieldCheck, AlertCircle } from 'lucide-react';
import './GroupCreation.css';

/** Remove acento e caixa para a busca do usuário. */
function normalize(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * ETAPA 1 — ESCOLHER A PLATAFORMA
 *
 * Lista as plataformas do banco com campo de busca. As mais usadas (plataforma
 * com mais grupos) ficam fixadas no topo, em "Mais usadas".
 *
 * Ao clicar, abre um popup de confirmação ("é esta plataforma?"). Só depois
 * de "Continuar" a plataforma é escolhida — evita grupo criado na plataforma
 * errada.
 */
export default function PlatformSearchStep({
  services = [],
  usage = {},
  selectedId = '',
  onConfirm,
}) {
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(null);

  const counts = useMemo(() => {
    const map = new Map();
    Object.entries(usage || {}).forEach(([id, count]) => map.set(id, count || 0));
    return map;
  }, [usage]);

  const filtered = useMemo(() => {
    const term = normalize(search.trim());
    return services
      .filter((s) => {
        if (!term) return true;
        return (
          normalize(s.name).includes(term) ||
          normalize(s.full_name).includes(term) ||
          normalize(s.slug).includes(term)
        );
      })
      .sort((a, b) => {
        // 1. fixadas pelo admin (pinned/featured)
        const aPin = a.pinned || a.featured ? 1 : 0;
        const bPin = b.pinned || b.featured ? 1 : 0;
        if (aPin !== bPin) return bPin - aPin;

        // 2. mais usadas (mais grupos na plataforma)
        const aCount = counts.get(a.id) || 0;
        const bCount = counts.get(b.id) || 0;
        if (aCount !== bCount) return bCount - aCount;

        // 3. alfabética
        return normalize(a.name).localeCompare(normalize(b.name), 'pt-BR');
      });
  }, [services, search, counts]);

  // "Mais usadas" = quem tem grupo (ou está fixada pelo admin) — só aparece
  // quando a busca não está filtrando, para não repetir a mesma lista.
  const top = filtered.filter((s) => (counts.get(s.id) || 0) > 0 || s.pinned || s.featured);
  const rest = filtered.filter((s) => !top.includes(s));
  const showSections = !search.trim() && top.length > 0;

  const renderPlatform = (s) => (
    <button
      key={s.id}
      type="button"
      className={`gc-platform ${selectedId === s.id ? 'selected' : ''}`}
      onClick={() => setPending(s)}
    >
      <span className="gc-platform-icon" style={{ background: s.color || 'var(--primary)' }}>
        {s.icon_url
          ? <img src={s.icon_url} alt="" />
          : (s.icon || (s.name || '?').charAt(0))}
      </span>
      <span className="gc-platform-info">
        <span className="gc-platform-name">{s.full_name || s.name}</span>
        <span className="gc-platform-meta">
          {(counts.get(s.id) || 0) > 0
            ? `${counts.get(s.id)} grupo${counts.get(s.id) > 1 ? 's' : ''} nesta plataforma`
            : 'nenhum grupo ainda'}
        </span>
      </span>
      {selectedId === s.id && <Check size={16} className="gc-plan-check" />}
    </button>
  );

  return (
    <div className="gc-platform-step">
      <div className="gc-search">
        <div className="gc-search-box">
          <Search size={17} />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar plataforma pelo nome..."
            autoFocus
          />
          {search && (
            <button type="button" className="gc-search-clear" onClick={() => setSearch('')} aria-label="Limpar busca">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="gc-empty">
          Nenhuma plataforma encontrada para “{search}”.
          <br />
          Peça ao administrador para cadastrar a plataforma.
        </div>
      ) : showSections ? (
        <>
          <div className="gc-section-title">
            Mais usadas <span className="gc-badge">topo da lista</span>
          </div>
          <div className="gc-platform-grid">{top.map(renderPlatform)}</div>

          {rest.length > 0 && (
            <>
              <div className="gc-section-title" style={{ marginTop: '1.4rem' }}>
                Todas as plataformas
              </div>
              <div className="gc-platform-grid">{rest.map(renderPlatform)}</div>
            </>
          )}
        </>
      ) : (
        <div className="gc-platform-grid">{filtered.map(renderPlatform)}</div>
      )}

      {pending && createPortal(
        <div className="gc-modal-backdrop" role="dialog" aria-modal="true">
          <div className="gc-modal">
            <h3 className="gc-modal-title">
              <ShieldCheck size={20} />
              Confirmar plataforma
            </h3>
            <p className="gc-modal-text">
              Você está escolhendo <strong>{pending.full_name || pending.name}</strong>. É esta a plataforma
              cujas credenciais os membros do grupo vão usar?
            </p>
            <div className="gc-modal-platform">
              <span className="gc-platform-icon" style={{ background: pending.color || 'var(--primary)' }}>
                {pending.icon_url
                  ? <img src={pending.icon_url} alt="" />
                  : (pending.icon || (pending.name || '?').charAt(0))}
              </span>
              <span className="gc-platform-info">
                <span className="gc-platform-name">{pending.full_name || pending.name}</span>
                <span className="gc-platform-meta">
                  {(counts.get(pending.id) || 0) > 0
                    ? `${counts.get(pending.id)} grupo(s) nesta plataforma`
                    : 'primeiro grupo nesta plataforma'}
                </span>
              </span>
            </div>
            <div className="gc-modal-actions">
              <button type="button" className="btn btn-outline" onClick={() => setPending(null)}>
                Voltar à lista
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => {
                  onConfirm?.(pending);
                  setPending(null);
                }}
              >
                Continuar
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {selectedId && !pending && (
        <div className="gc-note info">
          <AlertCircle size={16} />
          <span>
            Plataforma escolhida. Você pode trocar a qualquer momento voltando a esta etapa.
          </span>
        </div>
      )}
    </div>
  );
}
