import { useState } from 'react';
import { X, Send, Loader2, CheckCircle, AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './ContactAdminModal.css';

function ContactAdminModal({ groupId, groupName, isOfficial, onClose }) {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [recipientName, setRecipientName] = useState('');

  const handleSend = async (e) => {
    e.preventDefault();
    if (!subject.trim() || !message.trim()) return;

    setSending(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-support-email`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({
            group_id: groupId,
            subject: subject.trim(),
            message: message.trim(),
          }),
        }
      );

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Falha ao enviar mensagem');
        return;
      }

      setSent(true);
      setRecipientName(json.recipient || '');
    } catch (err) {
      setError(`Erro ao conectar: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="contact-modal-overlay" onClick={onClose}>
      <div className="contact-modal" onClick={(e) => e.stopPropagation()}>
        <div className="contact-modal-header">
          <div>
            <h3>Contatar Administrador</h3>
            <p>{isOfficial ? 'Suporte DividePass' : groupName}</p>
          </div>
          <button className="contact-modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {sent ? (
          <div className="contact-modal-success">
            <CheckCircle size={48} />
            <h4>Mensagem Enviada!</h4>
            <p>Sua mensagem foi enviada para <strong>{recipientName}</strong>.</p>
            <p className="contact-success-note">
              Aguarde a resposta por e-mail. Caso tenha urgência, verifique sua caixa de entrada.
            </p>
            <button className="btn btn-primary" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSend} className="contact-modal-form">
            <div className="contact-field">
              <label>Assunto</label>
              <select
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                required
              >
                <option value="">Selecione o motivo...</option>
                <option value="Código de verificação não recebido">Código de verificação não recebido</option>
                <option value="Código inválido ou expirado">Código inválido ou expirado</option>
                <option value="Dúvida sobre o grupo">Dúvida sobre o grupo</option>
                <option value="Problema com acesso">Problema com acesso</option>
                <option value="Solicitar reembolso">Solicitar reembolso</option>
                <option value="Outro assunto">Outro assunto</option>
              </select>
            </div>

            <div className="contact-field">
              <label>Sua mensagem</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Descreva seu problema ou dúvida..."
                rows={5}
                maxLength={1000}
                required
              />
              <span className="contact-char-count">{message.length}/1000</span>
            </div>

            {error && (
              <div className="contact-error">
                <AlertTriangle size={16} />
                {error}
              </div>
            )}

            <div className="contact-actions">
              <button
                type="button"
                className="btn btn-outline"
                onClick={onClose}
                disabled={sending}
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={sending || !subject.trim() || !message.trim()}
              >
                {sending ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Send size={16} />
                    Enviar Mensagem
                  </>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default ContactAdminModal;
