import { useState } from 'react';
import { Bell, Loader2, ShieldAlert, TriangleAlert } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePushNotifications } from '../hooks/usePushNotifications';
import './PushNotificationGate.css';

/*
 * O gate é obrigatório: enquanto o push não estiver ativo, ele volta em toda
 * sessão. O browsersóvolta a perguntar a permissão UMA vez — se a pessoa
 * dispensou, nunca mais aparece — então insistir aqui é o que recupera o
 *Push.
 *
 * A única saída é quando o BLOQUEIO VEIO DO NAVEGADOR (permission ===
 * 'denied'): nesse caso o prompt nunca mais aparece e insistir seria um
 * beco sem saída. Aí mostramos como liberar e deixamos passar SÓ NESTA
 * SESSÃO (sessionStorage), para a oportunidade voltar no próximo acesso.
 */
const SKIP_SESSION_KEY = 'dp_push_gate_skipped';

function PushNotificationGate() {
  const { profile } = useAuth();
  const { supported, permission, enabled, loading, enablePush } = usePushNotifications();
  const [error, setError] = useState('');
  const [skipped, setSkipped] = useState(
    () => sessionStorage.getItem(SKIP_SESSION_KEY) === '1'
  );

  // Enquanto o onboarding não termina, ele ocupa a tela inteira — este
  // gate ficaria empilhado por cima, disputando o mesmo espaço.
  const onboardingPending = Boolean(profile && !profile.onboarding_completed_at);

  // O navegador está bloqueando as notificações deste site: o prompt não
  // vai mais aparecer, então o caminho é o usuário liberar nas configurações.
  const browserBlocked = permission === 'denied';

  const shouldShow = Boolean(
    profile &&
      !onboardingPending &&
      supported &&
      !profile.push_notifications_enabled_at &&
      !enabled
  );

  const handleEnable = async () => {
    setError('');
    try {
      await enablePush();
      sessionStorage.removeItem(SKIP_SESSION_KEY);
    } catch (err) {
      setError(err.message);
    }
  };

  /*
   * Quando o bloqueio veio do navegador, o botão de ativar não adianta
   * (a permissão só muda nas configurações do site). Este botão confere se
   * a pessoa já liberou e, se liberou, conclui a ativação na hora.
   */
  const handleCheckAgain = async () => {
    setError('');
    const current = 'Notification' in window ? Notification.permission : 'default';

    if (current === 'granted') {
      try {
        await enablePush();
        sessionStorage.removeItem(SKIP_SESSION_KEY);
        return;
      } catch (err) {
        setError(err.message);
        return;
      }
    }

    setError('Ainda está bloqueado. Confira as permissões do site no navegador e clique de novo.');
  };

  const handleSkip = () => {
    sessionStorage.setItem(SKIP_SESSION_KEY, '1');
    setSkipped(true);
  };

  if (!shouldShow || skipped) return null;

  return (
    <div className="push-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="push-gate-title">
      <div className="push-gate-modal">
        <div className="push-gate-badge">
          <ShieldAlert size={16} />
          <span>{browserBlocked ? 'Permissão bloqueada' : 'Notificações obrigatórias'}</span>
        </div>

        <h2 id="push-gate-title">
          {browserBlocked ? 'Libere as notificações no navegador' : 'Ative as notificações'}
        </h2>

        {browserBlocked ? (
          <>
            <p className="push-gate-text">
              Seu navegador está bloqueando as notificações deste site, então não conseguimos
              pedir a permissão por aqui. Libere nas configurações do navegador e recarregue a
              página — a DividePass avisa por aqui cobranças, renovações e vagas nos seus grupos.
            </p>
            <ul className="push-gate-steps">
              <li>
                <strong>Chrome / Edge:</strong> clique no cadeado da barra de endereço →
                <em>Permissões do site</em> → <em>Notificações</em> → <em>Permitir</em>.
              </li>
              <li>
                <strong>Firefox:</strong> clique no ícone de permissões da barra de endereço →
                <em>Remover permissões</em> → recarregue a página.
              </li>
              <li>
                <strong>Safari:</strong> menu <em>Safari → Configurações → Notificações</em> →
                remova o site da lista de bloqueados.
              </li>
            </ul>
          </>
        ) : (
          <>
            <p className="push-gate-text">
              Sem o push ligado você não avisa de renewal de assinatura, cobrança pendente nem
              de vaga aberta nos seus grupos — avisamos só por aqui dentro do app. Ative para
              receber em tempo real.
            </p>
          </>
        )}

        <div className="push-gate-actions">
          <button
            className="btn btn-primary push-gate-btn"
            onClick={browserBlocked ? handleCheckAgain : handleEnable}
            disabled={loading}
          >
            {loading ? <Loader2 size={18} className="spin" /> : <Bell size={18} />}
            {loading
              ? 'Ativando...'
              : browserBlocked
                ? 'Já liberei — verificar de novo'
                : 'Ativar notificações'}
          </button>
          {browserBlocked && (
            <button className="btn push-gate-skip" onClick={handleSkip}>
              Continuar sem notificações
            </button>
          )}
        </div>

        {error && (
          <p className="push-gate-error">
            <TriangleAlert size={14} />
            {error}
          </p>
        )}

        {!browserBlocked && (
          <p className="push-gate-hint">O navegador vai pedir a permissão — escolha &ldquo;Permitir&rdquo;.</p>
        )}
      </div>
    </div>
  );
}

export default PushNotificationGate;
