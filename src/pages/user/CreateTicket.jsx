import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, ImageIcon, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../hooks/useAuth';
import { useSupportImageUpload } from '../../hooks/useSupportImageUpload';
import './Support.css';

function CreateTicket() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    subject: '',
    category: 'general',
    message: '',
  });
  const { imagePreview, handleImageChange, removeImage, uploadImage } = useSupportImageUpload();

  const handleChange = (e) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.subject.trim() || !form.message.trim()) {
      setError('Preencha todos os campos.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const imageUrl = await uploadImage();

      const { data: ticket, error: ticketError } = await supabase
        .from('support_tickets')
        .insert({
          user_id: user.id,
          subject: form.subject.trim(),
        })
        .select('id')
        .single();

      if (ticketError) throw ticketError;

      const { error: msgError } = await supabase
        .from('support_messages')
        .insert({
          ticket_id: ticket.id,
          user_id: user.id,
          message: form.message.trim(),
          image_url: imageUrl,
        });

      if (msgError) throw msgError;

      navigate(`/dashboard/support/${ticket.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fade-in create-ticket-page">
      <button onClick={() => navigate('/dashboard/support')} className="back-btn">
        <ArrowLeft size={18} />
        Voltar
      </button>

      <div className="page-header">
        <h1>Novo Ticket de Suporte</h1>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="form-card">
        <div className="form-group">
          <label>Assunto *</label>
          <input
            name="subject"
            value={form.subject}
            onChange={handleChange}
            placeholder="Ex: Problema com acesso à Netflix"
            required
          />
        </div>

        <div className="form-group">
          <label>Categoria</label>
          <select name="category" value={form.category} onChange={handleChange}>
            <option value="general">Geral</option>
            <option value="billing">Financeiro</option>
            <option value="credential">Credenciais</option>
            <option value="technical">Técnico</option>
            <option value="other">Outro</option>
          </select>
        </div>

        <div className="form-group">
          <label>Descrição do problema *</label>
          <textarea
            name="message"
            value={form.message}
            onChange={handleChange}
            placeholder="Descreva detalhadamente seu problema..."
            rows={6}
            required
          />
        </div>

        <div className="form-group">
          <label>Imagem de referência (opcional)</label>
          {imagePreview ? (
            <div className="image-preview-box">
              <img src={imagePreview} alt="Preview" />
              <button type="button" className="remove-image-btn" onClick={removeImage}>
                <X size={16} />
              </button>
            </div>
          ) : (
            <label className="image-upload-area">
              <ImageIcon size={24} />
              <span>Clique para adicionar uma imagem</span>
              <small>Prints, fotos ou evidências do problema (máx. 5MB)</small>
              <input type="file" accept="image/*" onChange={handleImageChange} hidden />
            </label>
          )}
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-outline" onClick={() => navigate('/dashboard/support')}>
            Cancelar
          </button>
          <button type="submit" className="btn btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Loader2 size={16} className="spin" /> : null}
            Enviar Ticket
          </button>
        </div>
      </div>
    </div>
  );
}

export default CreateTicket;
