import { useState, useEffect } from 'react';
import { Star, CheckCircle, XCircle, Trash2, MessageSquare, Loader2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import './TestimonialsAdmin.css';

function TestimonialsAdmin() {
  const [testimonials, setTestimonials] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [processing, setProcessing] = useState(null);

  useEffect(() => {
    loadTestimonials();
  }, []);

  const loadTestimonials = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('testimonials')
      .select('*')
      .order('created_at', { ascending: false });
    setTestimonials(data || []);
    setLoading(false);
  };

  const updateStatus = async (id, status) => {
    setProcessing(id);
    await supabase.from('testimonials').update({ status, updated_at: new Date().toISOString() }).eq('id', id);
    loadTestimonials();
    setProcessing(null);
  };

  const handleDelete = async (id) => {
    if (!confirm('Excluir este depoimento permanentemente?')) return;
    setProcessing(id);
    await supabase.from('testimonials').delete().eq('id', id);
    loadTestimonials();
    setProcessing(null);
  };

  const filtered = filter === 'all' ? testimonials : testimonials.filter((t) => t.status === filter);

  const counts = {
    all: testimonials.length,
    pending: testimonials.filter((t) => t.status === 'pending').length,
    approved: testimonials.filter((t) => t.status === 'approved').length,
    rejected: testimonials.filter((t) => t.status === 'rejected').length,
  };

  return (
    <div className="ta-page fade-in">
      <div className="ta-header">
        <h1>Gerenciar Depoimentos</h1>
        <p>Aprove, rejeite ou exclua depoimentos de usuários.</p>
      </div>

      <div className="ta-filters">
        {['all', 'pending', 'approved', 'rejected'].map((f) => (
          <button
            key={f}
            className={`ta-filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'all' ? 'Todos' : f === 'pending' ? 'Pendentes' : f === 'approved' ? 'Aprovados' : 'Rejeitados'}
            <span className="ta-count">{counts[f]}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="ta-loading">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="ta-empty">
          <MessageSquare size={48} />
          <p>Nenhum depoimento {filter !== 'all' ? `com status "${filter}"` : 'encontrado'}.</p>
        </div>
      ) : (
        <div className="ta-list">
          {filtered.map((t) => (
            <div key={t.id} className={`ta-card ${t.status}`}>
              <div className="ta-card-header">
                <div className="ta-user">
                  <div className="ta-avatar">{t.user_name?.[0] || '?'}</div>
                  <div>
                    <strong>{t.user_name}</strong>
                    <span>{t.user_role || 'Usuário'}</span>
                  </div>
                </div>
                <div className="ta-card-right">
                  <div className="ta-stars">
                    {Array.from({ length: t.rating }).map((_, i) => (
                      <Star key={i} size={14} fill="#FBBF24" color="#FBBF24" />
                    ))}
                  </div>
                  <span className={`ta-status ${t.status}`}>
                    {t.status === 'approved' ? 'Aprovado' : t.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                  </span>
                </div>
              </div>

              <p className="ta-text">"{t.text}"</p>

              <div className="ta-card-footer">
                <span className="ta-date">{new Date(t.created_at).toLocaleDateString('pt-BR')} às {new Date(t.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                <div className="ta-actions">
                  {t.status !== 'approved' && (
                    <button className="ta-approve-btn" onClick={() => updateStatus(t.id, 'approved')} disabled={processing === t.id}>
                      {processing === t.id ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
                      Aprovar
                    </button>
                  )}
                  {t.status !== 'rejected' && (
                    <button className="ta-reject-btn" onClick={() => updateStatus(t.id, 'rejected')} disabled={processing === t.id}>
                      <XCircle size={14} />
                      Rejeitar
                    </button>
                  )}
                  <button className="ta-delete-btn" onClick={() => handleDelete(t.id)} disabled={processing === t.id}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default TestimonialsAdmin;
