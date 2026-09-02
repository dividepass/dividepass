import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock, ChevronRight, Loader2 } from 'lucide-react';
import { useAppDataContext } from '../../contexts/AppDataContext';
import { useAuth } from '../../hooks/useAuth';
import { supabase } from '../../lib/supabase';
import './MyCredentials.css';

function MyCredentials() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { getActiveServices, refresh } = useAppDataContext();

  const activeServices = getActiveServices();
  const [fallbackServices, setFallbackServices] = useState(null);
  const [loadingFallback, setLoadingFallback] = useState(false);

  useEffect(() => {
    if (activeServices.length > 0 || !user) return;

    let cancelled = false;
    const fetchDirect = async () => {
      setLoadingFallback(true);
      try {
        const { data: subs } = await supabase
          .from('user_subscriptions')
          .select(`
            *,
            group:group_id (*, credential:group_credentials (*), profiles:group_profiles(*), owner:owner_id (id, name, avatar_url, role), members:group_members(*)),
            service:service_id (*)
          `)
          .eq('user_id', user.id)
          .eq('status', 'active');

        if (cancelled) return;

        if (subs && subs.length > 0) {
          const mapped = subs.filter(sub => sub.group).map(sub => ({
            ...sub,
            service: sub.service,
            group: {
              ...sub.group,
              credentials: sub.group?.credential || [],
              profiles: sub.group?.profiles || [],
              owner: sub.group?.owner || null,
            },
          }));
          setFallbackServices(mapped);
          await refresh();
        }
      } catch (e) {
        console.error('[MyCredentials] Direct fetch error:', e);
      } finally {
        if (!cancelled) setLoadingFallback(false);
      }
    };

    fetchDirect();
    return () => { cancelled = true; };
  }, [activeServices.length, user?.id]);

  const services = activeServices.length > 0 ? activeServices : (fallbackServices || []);

  if (loadingFallback && services.length === 0) {
    return (
      <div className="fade-in credentials-page">
        <div className="page-header">
          <h1>Minhas Credenciais 🔐</h1>
        </div>
        <div className="empty-credentials">
          <Loader2 size={32} className="spin" />
          <p>Carregando credenciais...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-in credentials-page">
      <div className="page-header">
        <h1>Minhas Credenciais 🔐</h1>
        <p>Acesse os dados de login das suas assinaturas ativas.</p>
      </div>

      {services.length === 0 ? (
        <div className="empty-credentials">
          <Lock size={48} />
          <h2>Nenhuma credencial disponível</h2>
          <p>
            Você ainda não possui assinaturas ativas. Assine um serviço para visualizar as
            credenciais.
          </p>
          <Link to="/dashboard/catalog" className="btn btn-primary">
            Explorar Catálogo
          </Link>
        </div>
      ) : (
        <div className="credentials-list">
          {services.map(({ service, group }) => (
            <button
              key={group.id}
              className="credential-list-card"
              onClick={() => navigate(`/dashboard/credentials/${service.slug || service.id}?group=${group.id}`)}
              style={{ '--service-color': service.color }}
            >
              <div className="credential-list-icon" style={{ backgroundColor: service.color }}>
                {service.icon_url ? (
                  <img 
                    src={service.icon_url} 
                    alt={service.name} 
                    className="credential-list-icon-img" 
                    onError={(e) => {
                      const target = e.target;
                      if (target.parentElement) {
                        const parent = target.parentElement;
                        parent.innerHTML = '';
                        const fallback = document.createElement('div');
                        fallback.style.display = 'flex';
                        fallback.style.alignItems = 'center';
                        fallback.style.justifyContent = 'center';
                        fallback.style.fontSize = '20px';
                        fallback.style.fontWeight = 'bold';
                        fallback.style.color = 'white';
                        fallback.textContent = service.icon || service.name?.[0] || 'S';
                        parent.appendChild(fallback);
                      }
                    }}
                  />
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%', fontSize: '20px', fontWeight: 'bold', color: 'white' }}>
                    {service.icon || service.name?.[0] || 'S'}
                  </div>
                )}
              </div>
              <div className="credential-list-info">
                <h3>{service.full_name || service.fullName || service.name}</h3>
                <p>{group.name}{(() => {
                  const myCred = group.credentials?.find(c => !c.assigned_to || c.assigned_to === user?.id);
                  return myCred?.profile_assignment ? ` • ${myCred.profile_assignment}` : '';
                })()}</p>
              </div>
              <span className="credential-list-action">
                Acessar
                <ChevronRight size={18} />
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default MyCredentials;
