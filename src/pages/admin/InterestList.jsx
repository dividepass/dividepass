import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Loader2, Phone, Calendar, Users, Send, CheckCircle2, Info,
  Search, X, MessageCircle, Filter, ChevronDown, ChevronUp,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { phoneToWhatsApp } from '../../lib/maskPhone';
import './InterestList.css';

/*
 * LISTA DE ESPERA / INTERESSES
 * =============================
 *
 * Quem cliquei em "Quero entrar" (ou "Avise-me quando abrir vaga") em algum
 * grupo de uma plataforma. A tela é para o GESTOR: ver a fila, entender quem
 * está esperando e — o principal — falar com essas pessoas.
 *
 * O envio usa a mesma engrenagem de "Avisos" (edge function send-notification):
 * notificação no app, e-mail, push e WhatsApp. O alvo são os user_ids
 * selecionados (sem duplicar quando a mesma pessoa se interessou em duas
 * plataformas).
 */

const DEFAULT_MESSAGE = '';

function InterestList({ embedded }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // filtros
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [onlyWithPhone, setOnlyWithPhone] = useState(false);

  // seleção
  const [selected, setSelected] = useState([]);
  const [showAll, setShowAll] = useState(false);

  // compositor
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState(DEFAULT_MESSAGE);
  const [channels, setChannels] = useState(['in_app', 'push']);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('group_interest')
          .select(`
            *,
            user:user_id (id, name, email, phone),
            service:service_id (id, name, full_name, color, icon, icon_url),
            group:group_id (id, name)
          `)
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;
        if (cancelled) return;

        setEntries(data || []);
        setError('');
      } catch (err) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  /* ────────────────────────────────────────────── dados derivados */

  const services = useMemo(() => {
    const map = new Map();
    for (const e of entries) {
      if (!e.service?.id) continue;
      if (!map.has(e.service.id)) {
        map.set(e.service.id, {
          id: e.service.id,
          name: e.service.full_name || e.service.name || 'Plataforma',
          color: e.service.color || '#4F46E5',
          icon: e.service.icon,
          icon_url: e.service.icon_url,
          count: 0,
        });
      }
      map.get(e.service.id).count += 1;
    }
    return [...map.values()].sort((a, b) => b.count - a.count);
  }, [entries]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (serviceFilter !== 'all' && e.service?.id !== serviceFilter) return false;
      if (onlyWithPhone && !e.user?.phone) return false;
      if (!term) return true;
      const haystack = [
        e.user?.name, e.user?.email, e.user?.phone,
        e.service?.name, e.service?.full_name, e.group?.name, e.message,
      ].filter(Boolean).join(' ').toLowerCase();
      return haystack.includes(term);
    });
  }, [entries, search, serviceFilter, onlyWithPhone]);

  /* A mesma pessoa pode searis interested em dois grupos: para o envio vale
     um aviso por pessoa, então a contagem é de usuários únicos. */
  const selectedUsers = useMemo(() => {
    const map = new Map();
    for (const id of selected) {
      const entry = entries.find((e) => e.id === id);
      if (entry?.user?.id) map.set(entry.user.id, entry);
    }
    return [...map.values()];
  }, [selected, entries]);

  const peopleCount = useMemo(
    () => new Set(entries.map((e) => e.user?.id).filter(Boolean)).size,
    [entries],
  );
  const withoutPhone = useMemo(
    () => entries.filter((e) => !e.user?.phone).length,
    [entries],
  );

  const isSelected = (id) => selected.includes(id);
  const toggleEntry = (id) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };
  const selectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      filtered.forEach((e) => next.add(e.id));
      return [...next];
    });
  };
  const clearSelection = () => setSelected([]);

  /* ────────────────────────────────────────────── envio */

  const toggleChannel = (id) => {
    setChannels((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      setSendError('Escreva um título e a mensagem antes de enviar.');
      return;
    }
    if (!selectedUsers.length) {
      setSendError('Selecione pelo menos uma pessoa.');
      return;
    }
    if (!channels.length) {
      setSendError('Escolha pelo menos um canal de envio.');
      return;
    }

    setSending(true);
    setSendError('');

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token;
      if (!accessToken) throw new Error('Você precisa estar autenticado.');

      const userIds = selectedUsers.map((e) => e.user.id).filter(Boolean);

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-notification`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({
          title: title.trim(),
          message: message.trim(),
          event_type: 'interest_list_message',
          metadata: {
            source: 'admin_interest_list',
            service_id: serviceFilter !== 'all' ? serviceFilter : null,
            recipients: selectedUsers.map((e) => ({
              id: e.user.id,
              name: e.user.name,
              email: e.user.email,
            })),
          },
          audience: { type: 'users', user_ids: userIds },
          channels,
          url: '/dashboard',
          created_by: sessionData?.session?.user?.id || null,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Erro desconhecido');

      setSuccess(resumoEnvio(result, channels, userIds.length));
      setSelected([]);
      setTitle('');
      setMessage(DEFAULT_MESSAGE);
    } catch (err) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  const whatsappUrl = (entry) => {
    const numero = phoneToWhatsApp(entry.user?.phone);
    if (!numero) return null;
    const texto = message.trim() || `Oi ${(entry.user?.name || '').split(' ')[0]}! Vimos seu interesse na plataforma. Podemos te contar mais?`;
    return `https://wa.me/${numero}?text=${encodeURIComponent(texto)}`;
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const visible = showAll ? filtered : filtered.slice(0, 25);

  /* ────────────────────────────────────────────── render */

  return (
    <div className="fade-in interest-list-page">
      {!embedded && (
        <div className="admin-header">
          <div>
            <h1>Lista de Espera</h1>
            <p className="page-subtitle">
              {peopleCount} {peopleCount === 1 ? 'pessoa interessada' : 'pessoas interessadas'}
              {services.length > 0 && ` em ${services.length} ${services.length === 1 ? 'plataforma' : 'plataformas'}`}
            </p>
          </div>
          <Link to="/admin/platforms" className="btn btn-outline btn-sm">
            Voltar para Plataformas
          </Link>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}
      {success && (
        <div className="interest-success">
          <CheckCircle2 size={16} />
          {success}
        </div>
      )}

      {/* Guia rápido: o gestor precisa saber o que fazer com a fila. */}
      <div className="interest-guide">
        <div className="interest-guide-step">
          <span className="interest-guide-num">1</span>
          <div>
            <strong>Escolha as pessoas</strong>
            <span>Marque as linhas (ou use “selecionar todos”) para montar o público da mensagem.</span>
          </div>
        </div>
        <div className="interest-guide-step">
          <span className="interest-guide-num">2</span>
          <div>
            <strong>Escreva a mensagem</strong>
            <span>Título + texto. O mesmo texto serve para notificação, e-mail, push e WhatsApp.</span>
          </div>
        </div>
        <div className="interest-guide-step">
          <span className="interest-guide-num">3</span>
          <div>
            <strong>Envie</strong>
            <span>Todos os selecionados recebem de uma vez — o relatório mostra o que saiu.</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="loading-state">
          <Loader2 size={32} className="spin" />
          <p>Carregando lista de espera...</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="empty-state">
          <p>Nenhum interessado cadastrado na lista de espera.</p>
        </div>
      ) : (
        <>
          {/* ─────────────────────────── filtros + seleção */}
          <div className="interest-toolbar">
            <div className="interest-search">
              <Search size={16} />
              <input
                type="text"
                placeholder="Buscar por nome, telefone, e-mail, plataforma ou grupo..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button className="search-clear" onClick={() => setSearch('')} aria-label="Limpar busca">
                  <X size={14} />
                </button>
              )}
            </div>

            <div className="interest-filter">
              <Filter size={15} />
              <select value={serviceFilter} onChange={(e) => setServiceFilter(e.target.value)}>
                <option value="all">Todas as plataformas ({entries.length})</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.count})
                  </option>
                ))}
              </select>
            </div>

            <label className="interest-check-filter">
              <input
                type="checkbox"
                checked={onlyWithPhone}
                onChange={(e) => setOnlyWithPhone(e.target.checked)}
              />
              Só quem tem telefone
            </label>
          </div>

          <div className="interest-selection-bar">
            <div className="interest-selection-info">
              <Users size={16} />
              <span>
                {selectedUsers.length > 0
                  ? `${selectedUsers.length} ${selectedUsers.length === 1 ? 'pessoa selecionada' : 'pessoas selecionadas'}`
                  : `${filtered.length} ${filtered.length === 1 ? 'pessoa' : 'pessoas'} na lista`}
              </span>
              {withoutPhone > 0 && (
                <span className="interest-warn-chip" title="Sem telefone não dá para mandar WhatsApp">
                  {withoutPhone} sem telefone
                </span>
              )}
            </div>
            <div className="interest-selection-actions">
              <button type="button" className="btn btn-outline btn-sm" onClick={selectVisible} disabled={!filtered.length}>
                Selecionar todos
              </button>
              <button type="button" className="btn btn-outline btn-sm" onClick={clearSelection} disabled={!selected.length}>
                Limpar seleção
              </button>
            </div>
          </div>

          {/* ─────────────────────────── lista */}
          <div className="interest-table-wrap">
            <table className="interest-table">
              <thead>
                <tr>
                  <th className="interest-col-check" />
                  <th>Pessoa</th>
                  <th>Contato</th>
                  <th>Plataforma</th>
                  <th>Grupo</th>
                  <th>Desde</th>
                  <th>Mensagem</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visible.map((entry) => {
                  const checked = isSelected(entry.id);
                  const wa = whatsappUrl(entry);
                  return (
                    <tr key={entry.id} className={checked ? 'is-selected' : ''}>
                      <td className="interest-col-check">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleEntry(entry.id)}
                          aria-label={`Selecionar ${entry.user?.name || 'pessoa'}`}
                        />
                      </td>
                      <td>
                        <div className="entry-user">
                          <div className="entry-avatar">
                            {entry.user?.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="entry-details">
                            <strong>{entry.user?.name || 'Usuário'}</strong>
                            {entry.user?.email && <span className="entry-email">{entry.user.email}</span>}
                          </div>
                        </div>
                      </td>
                      <td>
                        {entry.user?.phone ? (
                          <span className="contact-item">
                            <Phone size={14} />
                            {entry.user.phone}
                          </span>
                        ) : (
                          <span className="interest-no-contact">sem telefone</span>
                        )}
                      </td>
                      <td>
                        <span className="interest-service-chip">
                          {entry.service?.icon_url ? (
                            <img src={entry.service.icon_url} alt="" />
                          ) : (
                            <span className="interest-service-dot" style={{ backgroundColor: entry.service?.color || '#4F46E5' }}>
                              {entry.service?.icon || entry.service?.name?.[0] || '?'}
                            </span>
                          )}
                          {entry.service?.full_name || entry.service?.name || '—'}
                        </span>
                      </td>
                      <td className="interest-group-cell">
                        {entry.group?.name || '—'}
                      </td>
                      <td className="interest-date-cell">
                        <span className="entry-date">
                          <Calendar size={14} />
                          {formatDate(entry.created_at)}
                        </span>
                      </td>
                      <td className="interest-message-cell">
                        {entry.message ? entry.message : <span className="interest-no-contact">—</span>}
                      </td>
                      <td className="interest-actions-cell">
                        {wa && (
                          <a
                            className="btn btn-sm btn-outline interest-wa-btn"
                            href={wa}
                            target="_blank"
                            rel="noreferrer"
                            title={`Chamar no WhatsApp ${entry.user?.name || ''}`}
                          >
                            <MessageCircle size={14} />
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filtered.length === 0 && (
              <div className="interest-no-results">Nenhum resultado para o filtro atual.</div>
            )}

            {filtered.length > 25 && (
              <button
                type="button"
                className="btn btn-outline interest-show-all"
                onClick={() => setShowAll((v) => !v)}
              >
                {showAll ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
                {showAll ? 'Mostrar só 25' : `Mostrar todos (${filtered.length})`}
              </button>
            )}
          </div>

          {/* ─────────────────────────── compositor */}
          <div className={`interest-composer ${selectedUsers.length ? 'is-active' : ''}`}>
            <div className="interest-composer-head">
              <div>
                <h3>Enviar mensagem para os selecionados</h3>
                <p>
                  {selectedUsers.length > 0
                    ? `A mensagem vai para ${selectedUsers.length} ${selectedUsers.length === 1 ? 'pessoa' : 'pessoas'}.`
                    : 'Marque as pessoas na lista acima para habilitar o envio.'}
                </p>
              </div>
              {selectedUsers.length > 0 && (
                <span className="interest-composer-badge">{selectedUsers.length} destinatários</span>
              )}
            </div>

            <div className="interest-composer-grid">
              <div className="form-group">
                <label>Título</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Ex: Abrimos vagas na Netflix!"
                  disabled={!selectedUsers.length}
                />
              </div>
              <div className="form-group interest-composer-message">
                <label>Mensagem</label>
                <textarea
                  rows={3}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  placeholder="Oi! Vimos que você se interessou pelo grupo. As vagas estão abrindo..."
                  disabled={!selectedUsers.length}
                />
              </div>
            </div>

            <div className="interest-channels">
              <label>Canais de envio</label>
              <div className="interest-channels-list">
                {[
                  { id: 'in_app', label: 'Notificação' },
                  { id: 'email', label: 'E-mail' },
                  { id: 'push', label: 'Push' },
                  { id: 'whatsapp', label: 'WhatsApp' },
                ].map((c) => (
                  <button
                    type="button"
                    key={c.id}
                    className={`interest-channel-btn ${channels.includes(c.id) ? 'active' : ''}`}
                    onClick={() => toggleChannel(c.id)}
                    disabled={!selectedUsers.length}
                    aria-pressed={channels.includes(c.id)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              <p className="interest-channels-hint">
                Cada canal marcado roda o seu próprio envio. E-mail e WhatsApp dependem das
                configurações do servidor — o resultado aparece depois do envio.
              </p>
            </div>

            {sendError && (
              <div className="interest-composer-error">
                <Info size={15} />
                {sendError}
              </div>
            )}

            <div className="interest-composer-footer">
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSend}
                disabled={sending || !selectedUsers.length || !title.trim() || !message.trim()}
              >
                {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
                {sending ? 'Enviando...' : `Enviar para ${selectedUsers.length || 0}`}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default InterestList;

/**
 * Resumo do que saiu, por canal — o mesmo formato de "Avisos".
 * Um canal que ficou de fora (SMTP sem senha, WhatsApp sem token) aparece
 * aqui em vez de sumir em silêncio.
 */
function resumoEnvio(result, channels, total) {
  const partes = [];

  if (channels.includes('in_app')) {
    const n = result.notifications || 0;
    partes.push(`${n} notificaç${n !== 1 ? 'ões' : 'ão'} no app`);
  }
  if (channels.includes('push')) {
    const push = result.push || {};
    partes.push(`${push.sent || 0}/${push.attempted || 0} push`);
  }
  if (channels.includes('email')) {
    const email = result.email || {};
    if (email.error) partes.push(`e-mail não enviado (${email.error})`);
    else partes.push(`${email.sent || 0}/${email.attempted || 0} e-mail`);
  }
  if (channels.includes('whatsapp')) {
    const wa = result.whatsapp || {};
    if (wa.error) partes.push(`WhatsApp não enviado (${wa.error})`);
    else partes.push(`${wa.sent || 0}/${wa.attempted || 0} WhatsApp`);
  }

  return `Mensagem enviada para ${total} ${total === 1 ? 'pessoa' : 'pessoas'} — ${partes.join(', ')}.`;
}
