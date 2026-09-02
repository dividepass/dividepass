import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Send, User, Headphones, MessageSquare, ImageIcon, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useSupportImageUpload } from '../../hooks/useSupportImageUpload';
import '../user/Support.css';

function AdminTicketDetail() {
  const { ticketId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef(null);
  const { imageFile, imagePreview, handleImageChange, removeImage, uploadImage } = useSupportImageUpload();

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const [ticketRes, messagesRes] = await Promise.all([
        supabase.from('support_tickets').select('*, user:user_id (id, name, email)').eq('id', ticketId).single(),
        supabase.from('support_messages').select('*, user:user_id (name)').eq('ticket_id', ticketId).order('created_at'),
      ]);

      if (!cancelled) {
        if (ticketRes.error || !ticketRes.data) {
          navigate('/admin/support');
          return;
        }
        setTicket(ticketRes.data);
        setMessages(messagesRes.data || []);
        setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [ticketId, navigate]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e) => {
    e.preventDefault();
    if ((!replyText.trim() && !imageFile) || sending) return;

    setSending(true);
    try {
      const imageUrl = await uploadImage();

      const { data, error } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticketId,
          user_id: user.id,
          message: replyText.trim() || '(imagem enviada)',
          is_admin: true,
          image_url: imageUrl,
        })
        .select('*, user:user_id (name)')
        .single();

      if (error) throw error;

      setMessages(prev => [...prev, data]);

      if (ticket.status === 'open') {
        await supabase.from('support_tickets').update({ status: 'answered' }).eq('id', ticketId);
        setTicket(prev => ({ ...prev, status: 'answered' }));
      }

      setReplyText('');
      removeImage();
    } catch (err) {
      alert('Erro ao enviar: ' + err.message);
    } finally {
      setSending(false);
    }
  };

  const handleStatusChange = async (newStatus) => {
    await supabase.from('support_tickets').update({ status: newStatus }).eq('id', ticketId);
    setTicket(prev => ({ ...prev, status: newStatus }));
  };

  const statusConfig = {
    open: { label: 'Aberto', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
    answered: { label: 'Respondido', color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
    closed: { label: 'Fechado', color: '#22C55E', bg: 'rgba(34,197,94,0.1)' },
  };

  const categoryLabels = {
    general: 'Geral', billing: 'Financeiro', credential: 'Credenciais',
    technical: 'Técnico', other: 'Outro',
  };

  if (loading) {
    return <div className="loading-state"><Loader2 size={32} className="spin" /><p>Carregando...</p></div>;
  }

  const st = statusConfig[ticket.status] || statusConfig.open;

  return (
    <div className="fade-in ticket-detail-page">
      <button onClick={() => navigate('/admin/support')} className="back-btn">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="ticket-detail-header">
        <Headphones size={24} style={{ color: 'var(--primary)' }} />
        <h1>{ticket.subject}</h1>
      </div>

      <div className="ticket-detail-meta">
        <span className="ticket-status-badge" style={{ background: st.bg, color: st.color }}>{st.label}</span>
        <span className="ticket-category" style={{ fontSize: '0.85rem' }}>{categoryLabels[ticket.category]}</span>
        <span className="ticket-date">
          <User size={14} /> {ticket.user?.name || ticket.user?.email}
        </span>
        <span className="ticket-date">
          {new Date(ticket.created_at).toLocaleDateString('pt-BR')} às {new Date(ticket.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem' }}>
          {ticket.status !== 'open' && (
            <button className="btn btn-sm btn-outline" onClick={() => handleStatusChange('open')}>Reabrir</button>
          )}
          {ticket.status !== 'closed' && (
            <button className="btn btn-sm btn-outline" onClick={() => handleStatusChange('closed')}>Fechar</button>
          )}
        </div>
      </div>

      <div className="messages-list">
        {messages.map(msg => (
          <div key={msg.id} className={`message-bubble ${msg.is_admin ? 'admin' : 'user'}`}>
            <div className="message-header">
              <strong>{msg.is_admin ? 'Suporte (Admin)' : msg.user?.name || 'Usuário'}</strong>
              <span>{new Date(msg.created_at).toLocaleString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
            <div className="message-body">{msg.message}</div>
            {msg.image_url && (
              <a href={msg.image_url} target="_blank" rel="noopener noreferrer" className="message-image">
                <img src={msg.image_url} alt="Anexo" />
              </a>
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {ticket.status !== 'closed' && (
        <form className="reply-form" onSubmit={handleSend}>
          {imagePreview && (
            <div className="image-preview-box">
              <img src={imagePreview} alt="Preview" />
              <button type="button" className="remove-image-btn" onClick={removeImage}>
                <X size={16} />
              </button>
            </div>
          )}
          <textarea
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            placeholder="Digite sua resposta como administrador..."
          />
          <div className="reply-form-actions">
            <label className="reply-image-btn" title="Anexar imagem">
              <ImageIcon size={18} />
              <input type="file" accept="image/*" onChange={handleImageChange} hidden />
            </label>
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              <MessageSquare size={14} style={{ verticalAlign: 'middle' }} /> {messages.length}
            </span>
            <button type="submit" className="btn btn-primary" disabled={sending || (!replyText.trim() && !imageFile)}>
              {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
              Responder
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export default AdminTicketDetail;
