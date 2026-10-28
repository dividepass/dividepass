import { useState, useEffect } from 'react';
import {
  Mail, Loader2, Clock, ExternalLink, Shield, AlertTriangle, Check, Copy,
} from 'lucide-react';
import { supabase } from '../lib/supabase';
import { logPlatformEvent } from '../lib/platformEventLogger';
import { useAuth } from '../hooks/useAuth';
import './EmailCodeSearch.css';

const COOLDOWN_SECONDS = 40;
const REQUEST_TIMEOUT_MS = 120000;

/**
 * Busca de código de acesso enviado por e-mail.
 *
 * Usado em dois lugares:
 *  - `ServiceCredentials` (membro com assinatura ativa);
 *  - `ManageGroup` (dono/gestor do grupo, em "Gerenciar Grupo").
 *
 * A edge function `fetch-email-code` decide quem pode chamar — o grupo
 * precisa ter `email_code_enabled` ligado e o chamador precisa ter
 * vínculo com ele (membro ativo, assinante, dono do grupo ou admin).
 */
export default function EmailCodeSearch({
  groupId,
  serviceId = null,
  serviceName = '',
  title = 'Código de Verificação',
  description = 'Busque o código mais recente enviado para a conta compartilhada.',
  footer = null,
  className = '',
}) {
  const { user } = useAuth();

  const [verificationCode, setVerificationCode] = useState(null);
  const [fetchingCode, setFetchingCode] = useState(false);
  const [codeMessage, setCodeMessage] = useState('');
  const [sensitiveWarning, setSensitiveWarning] = useState(null);
  const [manualAction, setManualAction] = useState(null);
  const [cooldown, setCooldown] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown > 0]);

  const handleCopy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleFetchCode = async () => {
    if (!groupId || cooldown > 0) return;

    if (user?.id) {
      void logPlatformEvent({
        event_type: 'email_code_requested',
        title: 'Código solicitado',
        message: `${user.user_metadata?.name || user.email || 'Usuário'} clicou para buscar o código de ${serviceName || 'acesso'}.`,
        metadata: {
          user_id: user.id,
          group_id: groupId,
          service_id: serviceId,
        },
        created_by: user.id,
      });
    }

    setFetchingCode(true);
    setCodeMessage('');
    setVerificationCode(null);
    setSensitiveWarning(null);
    setManualAction(null);
    setCooldown(COOLDOWN_SECONDS);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;

      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lasoouwboxspstqvjbsv.supabase.co';
      const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_wEPiY05_TmJVND5a6D812g_9Mw-_LXR';

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      let res;
      try {
        res = await fetch(
          `${supabaseUrl}/functions/v1/fetch-email-code`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
              'apikey': supabaseKey,
            },
            body: JSON.stringify({ group_id: groupId }),
            signal: controller.signal,
          }
        );
      } finally {
        clearTimeout(timeoutId);
      }

      // A função pode ser encerrada por timeout e devolver corpo vazio.
      const rawBody = await res.text();
      let json = null;
      if (rawBody.trim()) {
        try {
          json = JSON.parse(rawBody);
        } catch {
          json = null;
        }
      }

      if (!json) {
        setCodeMessage(
          res.status === 504 || res.status === 403 || res.status === 408
            ? 'O servidor demorou demais para responder. Aguarde alguns segundos e busque novamente.'
            : `O servidor não retornou uma resposta válida (HTTP ${res.status}). Tente novamente.`
        );
        return;
      }

      if (!res.ok) {
        setCodeMessage(json.error || `Erro ${res.status}: falha ao buscar código`);
        return;
      }

      if (json.sensitive) {
        setSensitiveWarning({
          message: json.sensitiveMessage,
          type: json.sensitiveType,
          sender: json.sender || '',
          subject: json.subject || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setVerificationCode(null);
        setCodeMessage('');
      } else if (json.requires_manual_action) {
        // Netflix ou outro serviço que exige clique no link (ex.: "Sim, fui eu")
        setManualAction({
          url: json.manual_action_url,
          message: json.message || 'Este serviço enviou uma confirmação em vez de um código. Clique no botão abaixo para ativar o acesso.',
          note: json.manual_action_note || '',
          label: json.manual_action_label || 'Abrir e confirmar',
          details: json.manual_action_details || null,
          type: json.manual_action_type || 'generic',
          sender: json.sender || '',
          subject: json.subject || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setVerificationCode(null);
        setCodeMessage('');
        setSensitiveWarning(null);
      } else if (json.code) {
        setVerificationCode({
          code: json.code,
          sender: json.sender || '',
          subject: json.subject || '',
          source_url: json.source_url || '',
          received_at: json.received_at || new Date().toISOString(),
        });
        setCodeMessage('');
        setSensitiveWarning(null);
        setManualAction(null);
      } else {
        setCodeMessage(json.message || 'Nenhum código encontrado');
        setSensitiveWarning(null);
        setManualAction(null);
      }
    } catch (err) {
      const isAbort = err?.name === 'AbortError';
      setCodeMessage(
        isAbort
          ? 'A busca demorou demais e foi cancelada. Aguarde alguns segundos e tente novamente.'
          : `Erro ao conectar: ${err?.message || 'falha de comunicação'}`
      );
    } finally {
      setFetchingCode(false);
    }
  };

  return (
    <div className={`verification-code-section ${className}`}>
      <div className="verification-code-header">
        <Mail size={20} />
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
      </div>

      <button
        className="btn btn-primary fetch-code-btn"
        onClick={handleFetchCode}
        disabled={fetchingCode || cooldown > 0}
      >
        {fetchingCode ? (
          <>
            <Loader2 size={16} className="spin" />
            Buscando...
          </>
        ) : cooldown > 0 ? (
          <>
            <Mail size={16} />
            Buscar Código ({cooldown}s)
          </>
        ) : (
          <>
            <Mail size={16} />
            Buscar Código
          </>
        )}
      </button>

      {footer}

      {verificationCode && (
        <div className="verification-code-result">
          <div className="code-display">
            <code className="code-value">{verificationCode.code}</code>
            <button
              className="cred-action-btn"
              onClick={() => handleCopy(verificationCode.code)}
              title="Copiar código"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <div className="code-meta">
            {verificationCode.sender && (
              <span>Enviado por: <strong>{verificationCode.sender}</strong></span>
            )}
            {verificationCode.subject && (
              <span>Assunto: {verificationCode.subject}</span>
            )}
            {verificationCode.source_url && (
              <span>
                Código obtido via{' '}
                <a href={verificationCode.source_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--primary)' }}>
                  link de verificação
                </a>{' '}
                <ExternalLink size={12} style={{ verticalAlign: 'middle' }} />
              </span>
            )}
            <span className="code-timestamp">
              <Clock size={14} />
              Recebido: {new Date(verificationCode.received_at).toLocaleString('pt-BR')}
            </span>
          </div>
        </div>
      )}

      {sensitiveWarning && (
        <div className="verification-code-result sensitive-warning">
          <div className="sensitive-icon">
            <Shield size={24} />
          </div>
          <div className="sensitive-content">
            <span className="sensitive-label">PIN de Segurança Detectado</span>
            <span className="sensitive-message">{sensitiveWarning.message}</span>
            {sensitiveWarning.sender && (
              <span className="sensitive-meta">Enviado por: <strong>{sensitiveWarning.sender}</strong></span>
            )}
            <span className="code-timestamp">
              <Clock size={14} />
              Recebido: {new Date(sensitiveWarning.received_at).toLocaleString('pt-BR')}
            </span>
          </div>
        </div>
      )}

      {codeMessage && (
        <div className="verification-code-empty">
          <AlertTriangle size={18} />
          <span>{codeMessage}</span>
        </div>
      )}

      {manualAction && (
        <div className="manual-action-card">
          <div className="manual-action-content">
            <span className="manual-action-title">
              {manualAction.type === 'confirm_household' || manualAction.type === 'netflix_verify_link'
                ? 'Confirmação necessária'
                : 'Ação necessária'}
            </span>
            <span className="manual-action-desc">
              {manualAction.message}
            </span>
            {manualAction.details?.requester && (
              <div className="manual-action-details">
                <span className="manual-action-detail">
                  <span className="manual-action-detail-label">Solicitado por</span>
                  <strong>{manualAction.details.requester}</strong>
                </span>
                {manualAction.details.device && (
                  <span className="manual-action-detail">
                    <span className="manual-action-detail-label">Aparelho</span>
                    <strong>{manualAction.details.device}</strong>
                  </span>
                )}
                {manualAction.details.when && (
                  <span className="manual-action-detail">
                    <span className="manual-action-detail-label">Quando</span>
                    <strong>{manualAction.details.when}</strong>
                  </span>
                )}
              </div>
            )}
            <a
              href={manualAction.url}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary manual-action-btn"
            >
              <ExternalLink size={16} />
              {manualAction.label}
            </a>
            <p className="manual-action-hint">
              {manualAction.note || 'Abra o link em uma nova aba e conclua a ação para liberar o acesso.'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
