import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ArrowUpRight, ChevronDown, Loader2, X } from 'lucide-react';
import './DrilldownModal.css';

/**
 * Modal de drill-down do painel admin.
 *
 * O painel mostra contagens — "Pagamentos de hoje: 2", "Onboarding
 * incompleto: 4". O número sem nome não serve para decidir nada: este modal
 * abre a LISTA por trás do número, e cada linha carrega:
 *
 *  - `primary`/`secondary`: quem é (nome + e-mail · grupo · quando);
 *  - `links`: hiperlinks para a entidade (usuário, grupo, ticket) — navegar
 *    fecha o modal, para o operador já cair na página de detalhe;
 *  - `detail`: bloco expansível com os campos da transação (código, gateway,
 *    método, datas) — os dados que antes só existiam abrindo tela por tela.
 *
 * As linhas são carregadas POR DEMANDA (só quando o operador clica), igual
 * ao drill-down do financeiro: o carregamento inicial do painel não paga o
 * preço de detalhes que ninguém pediu.
 */

/**
 * @param {Object} props
 * @param {string} props.title           Título do modal.
 * @param {string} [props.description]   Explicação de uma linha do que a lista contém.
 * @param {Array}  props.rows            Linhas (shape abaixo).
 * @param {boolean} props.loading
 * @param {string} [props.error]
 * @param {string} [props.emptyMessage]
 * @param {string} [props.footerTo]      Link para a página completa da seção.
 * @param {string} [props.footerLabel]
 * @param {Function} props.onClose
 *
 * Shape de cada linha:
 * {
 *   key: string,
 *   primary: string,                    // nome/assunto — a linha principal
 *   secondary: string,                  // e-mail · grupo · há quanto tempo
 *   links: [{ to, label }],             // chips de navegação
 *   detail: [{ label, value }],         // detalhes expansíveis
 *   value: string,                      // valor à direita (R$, data, contagem)
 *   tone: 'success'|'error'|'warning'|'info'|'muted',
 *   badge: string,                      // selo (Pago, Falhou, Assinante…)
 * }
 */
function DrilldownModal({
  title,
  description,
  rows = [],
  loading = false,
  error = '',
  emptyMessage = 'Nada encontrado por aqui.',
  footerTo,
  footerLabel,
  onClose,
}) {
  const [expanded, setExpanded] = useState(null);

  // Esc fecha o modal — o mesmo contrato de qualquer dialog nativo.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="drill-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="drill-modal" onClick={(e) => e.stopPropagation()}>
        <header className="drill-header">
          <div>
            <h3>{title}</h3>
            {description && <p>{description}</p>}
          </div>
          <button type="button" className="drill-close" onClick={onClose} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="drill-body">
          {loading ? (
            <div className="drill-loading">
              <Loader2 size={20} className="drill-spin" />
              <span>Carregando...</span>
            </div>
          ) : error ? (
            <div className="drill-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          ) : rows.length === 0 ? (
            <p className="drill-empty">{emptyMessage}</p>
          ) : (
            <ul className="drill-list">
              {rows.map((row) => {
                const isOpen = expanded === row.key;
                const links = (row.links || []).filter(Boolean);
                const detail = (row.detail || []).filter(Boolean);

                return (
                  <li key={row.key} className={`drill-row ${row.tone || ''}`}>
                    <div className="drill-row-main">
                      <div className="drill-row-head">
                        <strong className="drill-row-primary" title={row.primary}>{row.primary}</strong>
                        {row.badge && <span className="drill-badge">{row.badge}</span>}
                      </div>
                      {row.secondary && (
                        <span className="drill-row-secondary" title={row.secondary}>{row.secondary}</span>
                      )}

                      {(links.length > 0 || detail.length > 0) && (
                        <div className="drill-row-links">
                          {links.map((link) => (
                            <Link
                              key={`${link.to}-${link.label}`}
                              to={link.to}
                              className="drill-link"
                              onClick={onClose}
                            >
                              {link.label}
                              <ArrowUpRight size={12} />
                            </Link>
                          ))}
                          {detail.length > 0 && (
                            <button
                              type="button"
                              className="drill-link drill-link--expand"
                              onClick={() => setExpanded(isOpen ? null : row.key)}
                              aria-expanded={isOpen}
                            >
                              Detalhes
                              <ChevronDown size={12} className={isOpen ? 'is-open' : ''} />
                            </button>
                          )}
                        </div>
                      )}

                      {isOpen && detail.length > 0 && (
                        <dl className="drill-detail">
                          {detail.map((item) => (
                            <div key={item.label}>
                              <dt>{item.label}</dt>
                              <dd>{item.value ?? '—'}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </div>

                    {row.value && (
                      <div className="drill-row-side">
                        <strong>{row.value}</strong>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {footerTo && footerLabel && !loading && !error && (
          <footer className="drill-footer">
            <Link to={footerTo} onClick={onClose}>
              {footerLabel}
              <ArrowUpRight size={13} />
            </Link>
          </footer>
        )}
      </div>
    </div>
  );
}

export default DrilldownModal;
