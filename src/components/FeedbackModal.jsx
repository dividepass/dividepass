import { useState } from 'react';
import { X, Send, Loader2, CheckCircle, AlertTriangle, Lightbulb, Sparkles } from 'lucide-react';
import { supabase } from '../lib/supabase';
import './FeedbackModal.css';

const MAX_LENGTH = 2000;
const MIN_LENGTH = 5;

/**
 * Formulário livre de feedback.
 *
 * A mensagem chega em dois lugares ao mesmo tempo: na tabela `user_feedback`
 * e no e-mail da equipe. Se um dos dois falhar, o outro ainda segura o
 * feedback — a edge function `send-feedback` trata isso.
 */
export default function FeedbackModal({ page = 'dashboard', onClose }) {
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const trimmed = message.trim();
  const tooShort = touched && trimmed.length > 0 && trimmed.length < MIN_LENGTH;
  const canSend = trimmed.length >= MIN_LENGTH && !sending;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setTouched(true);
    if (trimmed.length < MIN_LENGTH || sending) return;

    setSending(true);
    setError('');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-feedback`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ message: trimmed, page }),
        }
      );

      const json = await res.json();

      if (!res.ok) {
        setError(json.error || 'Não foi possível enviar seu feedback. Tente novamente.');
        return;
      }

      setSent(true);
    } catch (err) {
      setError(`Erro ao conectar: ${err.message}`);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="feedback-modal-overlay" onClick={onClose}>
      <div className="feedback-modal" onClick={(e) => e.stopPropagation()}>
        <button className="feedback-modal-close" onClick={onClose} aria-label="Fechar">
          <X size={20} />
        </button>

        {sent ? (
          <div className="feedback-modal-success">
            <div className="feedback-success-icon"><CheckCircle size={44} /></div>
            <h3>Feedback enviado!</h3>
            <p>
              Obrigado por compartilhar sua ideia. A gente lê cada mensagem —
              sua opinião ajuda a construir a DividePass.
            </p>
            <button className="btn btn-primary feedback-modal-btn" onClick={onClose}>
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="feedback-modal-header">
              <div className="feedback-modal-icon"><Lightbulb size={26} /></div>
              <div>
                <h3>O que você gostaria de ter na DividePass?</h3>
                <p>Escreva livremente — toda ideia é lida pelo time.</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="feedback-modal-form">
              <div className="feedback-field">
                <label htmlFor="feedback-message">Seu feedback</label>
                <textarea
                  id="feedback-message"
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value);
                    setError('');
                  }}
                  onBlur={() => setTouched(true)}
                  placeholder="Ex.: Gostaria de poder dividir a assinatura em 3 iguais, ou de ver o histórico de quanto já economizei..."
                  rows={7}
                  maxLength={MAX_LENGTH}
                  disabled={sending}
                  className={tooShort ? 'field-error' : ''}
                  autoFocus
                />
                <div className="feedback-field-footer">
                  {tooShort ? (
                    <span className="feedback-error-hint">Escreva um pouco mais para enviar.</span>
                  ) : (
                    <span className="feedback-hint">
                      <Sparkles size={12} /> Sugestões, ideias ou reclamações — tudo vale.
                    </span>
                  )}
                  <span className="feedback-char-count">{message.length}/{MAX_LENGTH}</span>
                </div>
              </div>

              {error && (
                <div className="feedback-error">
                  <AlertTriangle size={16} />
                  {error}
                </div>
              )}

              <div className="feedback-actions">
                <button
                  type="button"
                  className="btn btn-outline feedback-modal-btn"
                  onClick={onClose}
                  disabled={sending}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="btn btn-primary feedback-modal-btn"
                  disabled={!canSend}
                >
                  {sending ? (
                    <>
                      <Loader2 size={16} className="spin" /> Enviando...
                    </>
                  ) : (
                    <>
                      <Send size={16} /> Enviar feedback
                    </>
                  )}
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
