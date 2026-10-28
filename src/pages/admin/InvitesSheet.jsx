import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { X, Search, MessageCircle, Phone, UserPlus } from 'lucide-react';
import { maskPhone, phoneToNational, phoneToWhatsApp } from '../../lib/maskPhone';
import './InvitesSheet.css';

/** Primeiro nome, para a saudação do WhatsApp. */
function firstName(value) {
  return String(value || '').trim().split(' ')[0] || '';
}

/**
 * Mensagem pronta do WhatsApp. A pessoa indicada não conhece a marca ainda,
 * então a mensagem se apresenta e diz quem indicou.
 */
function inviteMessage(invitee, referrer) {
  const to = firstName(invitee) || 'tudo bem';
  const from = firstName(referrer);
  return (
    `Olá, ${to}! Aqui é do DividePass.` +
    (from ? ` ${from} indicou você pra gente.` : '') +
    ' Quer dividir assinaturas e economizar? Posso te explicar como funciona.'
  );
}

/**
 * Sheet com todas as indicações do onboarding, agrupadas por quem indicou.
 *
 * O card "Pessoas indicadas" do relatório abre esta sheet: o admin precisa
 * da lista completa — nome, telefone e um botão de WhatsApp pronto para
 * a abordagem — e não só do contador.
 */
export default function InvitesSheet({ invites = [], usersById = {}, onClose }) {
  const [search, setSearch] = useState('');
  const searchRef = useRef(null);

  // ESC fecha, o fundo trava o scroll e a busca já começa focada.
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    searchRef.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  /* Um grupo por quem indicou. O contador do card é o total de indicações,
     mas o que interessa na hora da abordagem é saber quem indicou cada
     contato — é o que dá contexto para a conversa. */
  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const byUser = new Map();

    for (const iv of invites) {
      const referrer = usersById[iv.user_id] || null;
      const referrerName = referrer?.name || 'Usuário removido';
      const national = phoneToNational(iv.phone);

      const haystack = [
        iv.name,
        national,
        maskPhone(national),
        referrerName,
        referrer?.email,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (q && !haystack.includes(q)) continue;

      if (!byUser.has(iv.user_id)) {
        byUser.set(iv.user_id, { id: iv.user_id, referrer, referrerName, items: [] });
      }
      byUser.get(iv.user_id).items.push(iv);
    }

    return [...byUser.values()].sort(
      (a, b) => b.items.length - a.items.length || a.referrerName.localeCompare(b.referrerName, 'pt-BR')
    );
  }, [invites, usersById, search]);

  const totalShown = groups.reduce((sum, g) => sum + g.items.length, 0);
  const referrerCount = groups.length;

  /*
   * Portal no body: a página do relatório usa a animação `.fade-in`, que
   * termina com `transform`/`filter` permanentes. Isso faz do container
   * da página o bloco Containers dos `position: fixed` — sem o portal, a
   * sheet sairia do lugar (e sumiria no celular).
   */
  return createPortal(
    <div className="ob-sheet-overlay" onClick={onClose}>
      <div
        className="ob-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-sheet-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="ob-sheet-header">
          <div className="ob-sheet-heading">
            <span className="ob-sheet-icon">
              <UserPlus size={18} />
            </span>
            <div>
              <h3 id="ob-sheet-title">Pessoas indicadas</h3>
              <p>
                {totalShown} {totalShown === 1 ? 'indicação' : 'indicações'} de{' '}
                {referrerCount} {referrerCount === 1 ? 'pessoa' : 'pessoas'}
              </p>
            </div>
          </div>
          <button type="button" className="ob-sheet-close" onClick={onClose} aria-label="Fechar">
            <X size={20} />
          </button>
        </header>

        <div className="ob-sheet-toolbar">
          <div className="ob-sheet-search">
            <Search size={16} />
            <input
              ref={searchRef}
              type="text"
              placeholder="Buscar por nome, telefone ou quem indicou..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Buscar indicações"
            />
          </div>
        </div>

        <div className="ob-sheet-body">
          {groups.length === 0 ? (
            <div className="ob-sheet-empty">
              <UserPlus size={28} />
              <p>
                {search
                  ? 'Nenhuma indicação encontrada para essa busca.'
                  : 'Nenhuma pessoa foi indicada ainda.'}
              </p>
            </div>
          ) : (
            groups.map((group) => (
              <section className="ob-invite-group" key={group.id}>
                <header className="ob-invite-group-head">
                  {group.referrer?.avatar_url ? (
                    <img className="ob-invite-group-avatar" src={group.referrer.avatar_url} alt="" />
                  ) : (
                    <span className="ob-invite-group-avatar is-initials">
                      {group.referrerName.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <div className="ob-invite-group-who">
                    {group.referrer ? (
                      <Link to={`/admin/users/${group.referrer.id}`} className="link-name">
                        {group.referrer.name}
                      </Link>
                    ) : (
                      <strong>{group.referrerName}</strong>
                    )}
                    <span>{group.referrer?.email || 'conta removida'}</span>
                  </div>
                  <span className="ob-invite-group-count">
                    {group.items.length} {group.items.length === 1 ? 'pessoa' : 'pessoas'}
                  </span>
                </header>

                <div className="ob-invite-group-list">
                  {group.items.map((iv) => {
                    const national = phoneToNational(iv.phone);
                    const waNumber = phoneToWhatsApp(iv.phone);
                    const displayPhone = maskPhone(national);
                    const waLink = waNumber
                      ? `https://wa.me/${waNumber}?text=${encodeURIComponent(
                          inviteMessage(iv.name, group.referrer?.name)
                        )}`
                      : null;

                    return (
                      <div className="ob-invite-item" key={iv.id}>
                        <span className="ob-invite-item-avatar">
                          {(iv.name || '?').charAt(0).toUpperCase()}
                        </span>
                        <div className="ob-invite-item-info">
                          <strong>{iv.name || 'Sem nome'}</strong>
                          <span>{displayPhone || 'sem telefone'}</span>
                        </div>
                        <div className="ob-invite-item-actions">
                          {waLink ? (
                            <>
                              <a
                                className="ob-invite-item-wa"
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={`Falar com ${iv.name} no WhatsApp`}
                              >
                                <MessageCircle size={15} />
                                WhatsApp
                              </a>
                              <a
                                className="ob-invite-item-call"
                                href={`tel:+${waNumber}`}
                                title={`Ligar para ${iv.name}`}
                                aria-label={`Ligar para ${iv.name}`}
                              >
                                <Phone size={15} />
                              </a>
                            </>
                          ) : (
                            <span className="ob-invite-item-wa is-disabled">sem número</span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
