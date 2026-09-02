import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, ChevronDown, ChevronUp, Mail, Phone, Calendar } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './InterestList.css';

function InterestList({ embedded }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedService, setExpandedService] = useState(null);

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const { data, error: fetchError } = await supabase
          .from('group_interest')
          .select(`
            *,
            user:user_id (id, name, email, phone),
            service:service_id (id, name, full_name, color, icon, icon_url)
          `)
          .order('created_at', { ascending: false });

        if (fetchError) throw fetchError;

        setEntries(data || []);
        setError('');

        if (data?.length > 0) {
          const serviceIds = [...new Set(data.map(e => e.service?.id).filter(Boolean))];
          if (serviceIds.length > 0) {
            setExpandedService(serviceIds[0]);
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('pt-BR');
  };

  const groupedByService = entries.reduce((acc, entry) => {
    const serviceId = entry.service?.id || 'unknown';
    if (!acc[serviceId]) {
      acc[serviceId] = { service: entry.service, entries: [] };
    }
    acc[serviceId].entries.push(entry);
    return acc;
  }, {});

  const serviceGroups = Object.values(groupedByService);

  return (
    <div className="fade-in interest-list-page">
      {!embedded && (
        <div className="admin-header">
          <div>
            <h1>Lista de Espera</h1>
            <p className="page-subtitle">{entries.length} {entries.length === 1 ? 'interessado' : 'interessados'} cadastrados</p>
          </div>
          <Link to="/admin/groups" className="btn btn-outline btn-sm">
            Voltar para Grupos
          </Link>
        </div>
      )}

      {error && (
        <div className="error-banner">{error}</div>
      )}

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
        <div className="interest-accordion">
          {serviceGroups.map(({ service, entries: serviceEntries }) => {
            const isExpanded = expandedService === service?.id;

            return (
              <div key={service?.id} className={`service-section ${isExpanded ? 'expanded' : ''}`}>
                <button
                  className="service-header"
                  onClick={() => setExpandedService(isExpanded ? null : service?.id)}
                >
                  <div className="service-info">
                    <div
                      className="service-icon"
                      style={{ backgroundColor: service?.color || '#6B7280' }}
                    >
                      {service?.icon_url ? (
                        <img src={service.icon_url} alt="" />
                      ) : (
                        service?.icon || service?.name?.[0] || '?'
                      )}
                    </div>
                    <div>
                      <h3>{service?.full_name || service?.name || 'Serviço'}</h3>
                      <span className="service-meta">
                        {serviceEntries.length} {serviceEntries.length === 1 ? 'interessado' : 'interessados'}
                      </span>
                    </div>
                  </div>
                  <div className="service-actions">
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </button>

                {isExpanded && (
                  <div className="interest-entries">
                    {serviceEntries.map((entry) => (
                      <div key={entry.id} className="interest-entry-card">
                        <div className="entry-user">
                          <div className="entry-avatar">
                            {entry.user?.name?.[0]?.toUpperCase() || '?'}
                          </div>
                          <div className="entry-details">
                            <strong>{entry.user?.name || 'Usuário'}</strong>
                            <div className="entry-contact">
                              {entry.user?.phone && (
                                <span className="contact-item">
                                  <Phone size={14} />
                                  {entry.user.phone}
                                </span>
                              )}
                              {entry.user?.email && (
                                <span className="contact-item">
                                  <Mail size={14} />
                                  {entry.user.email}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="entry-meta">
                          <span className="entry-date">
                            <Calendar size={14} />
                            {formatDate(entry.created_at)}
                          </span>
                          {entry.message && (
                            <p className="entry-message">{entry.message}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default InterestList;
