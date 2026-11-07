import { useState, useEffect } from 'react';
import { Mail, Copy, Check, Sparkles, ShieldCheck, Loader2, AlertTriangle } from 'lucide-react';
import {
  buscarEmailGerenciado,
  provisionarEmailGerenciado,
  registrarEmailGerenciado,
  emailGerenciadoDisponivel,
} from '../lib/managedGroupEmail';
import './ManagedEmailCard.css';

/**
 * CARD — E-MAIL GERENCIADO DO GRUPO
 *
 * Mostra o e-mail exclusivo do grupo (criado pela DividePass) e o passo a
 * passo para trocar o e-mail da conta da plataforma por ele. Com essa troca,
 * todo codigo de verificacao cai na caixa do grupo — e a IA busca para o
 * membro a qualquer hora.
 *
 * Quando usado pelo DONO (`canProvision`), o card tambem cria a caixa se ela
 * ainda nao existir.
 */
export default function ManagedEmailCard({
  groupId,
  serviceName = '',
  canProvision = false,
  className = '',
}) {
  const [email, setEmail] = useState('');
  const [aiEnabled, setAiEnabled] = useState(true);
  const [disponivel, setDisponivel] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [criando, setCriando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState('');
  const [modoManual, setModoManual] = useState(false);
  const [registrando, setRegistrando] = useState(false);
  const [emailManual, setEmailManual] = useState('');
  const [senhaManual, setSenhaManual] = useState('');
  const [servidorManual, setServidorManual] = useState('');

  useEffect(() => {
    let cancelado = false;

    (async () => {
      try {
        const ok = await emailGerenciadoDisponivel();
        if (cancelado) return;
        if (!ok) {
          setDisponivel(false);
          setCarregando(false);
          return;
        }

        const dados = await buscarEmailGerenciado(groupId);
        if (cancelado) return;
        if (dados?.email) {
          setEmail(dados.email);
          setAiEnabled(dados.aiEnabled);
        }
      } catch {
        if (!cancelado) setDisponivel(false);
      } finally {
        if (!cancelado) setCarregando(false);
      }
    })();

    return () => { cancelado = true; };
  }, [groupId]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(email);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  };

  const handleCreate = async () => {
    if (!groupId || criando) return;
    setCriando(true);
    setErro('');

    const resultado = await provisionarEmailGerenciado(groupId);
    setCriando(false);

    if (resultado.success && resultado.email) {
      setEmail(resultado.email);
      setAiEnabled(true);
      setDisponivel(true);
      return;
    }

    setErro(resultado.error || 'Não foi possível criar o e-mail do grupo agora.');
    // Sem automação configurada, o dono ainda pode apontar para uma caixa que
    // ele mesmo criou no painel do cPanel.
    setModoManual(true);
  };

  const handleRegister = async (event) => {
    event?.preventDefault?.();
    if (!groupId || registrando) return;
    setRegistrando(true);
    setErro('');

    const resultado = await registrarEmailGerenciado(groupId, {
      email: emailManual.trim(),
      password: senhaManual,
      imapServer: servidorManual.trim() || undefined,
    });
    setRegistrando(false);

    if (resultado.success) {
      setEmail(resultado.email || emailManual.trim());
      setAiEnabled(true);
      setDisponivel(true);
      setModoManual(false);
      setSenhaManual('');
      return;
    }

    setErro(resultado.error || 'Não foi possível registrar a caixa do grupo.');
  };

  if (!disponivel || (carregando && !email)) return null;

  /* O grupo ainda não tem caixa e o dono não pode criar (membro): nada a mostrar. */
  if (!email && !canProvision) return null;

  return (
    <div className={`managed-email-card ${className}`}>
      <div className="managed-email-head">
        <span className="managed-email-icon">
          <Sparkles size={18} />
        </span>
        <div>
          <h3>
            {email ? 'E-mail gerenciado pelo grupo' : 'Deixar a DividePass gerenciar seu e-mail'}
            {aiEnabled && <span className="managed-email-tag">com IA</span>}
          </h3>
          <p>
            {email
              ? 'A IA busca aqui o código de verificação que a plataforma enviar.'
              : 'Crie a caixa de e-mail do grupo para a IA buscar os códigos de verificação.'}
          </p>
        </div>
      </div>

      {email && (
        <>
          <div className="managed-email-address">
            <Mail size={16} />
            <code>{email}</code>
            <button
              type="button"
              className="managed-email-copy"
              onClick={handleCopy}
              title="Copiar o e-mail do grupo"
            >
              {copiado ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>

          <ol className="managed-email-steps">
            <li>Entre na sua conta da plataforma com o e-mail e a senha do grupo.</li>
            <li>
              Vá em <strong>Minha conta</strong> (ou <strong>Configurações</strong>) e troque o
              e-mail para o e-mail do grupo acima.
            </li>
            <li>
              Salve. A partir daí, toda confirmação chega nesta caixa — e a IA entrega o código
              pronto, a qualquer hora, em qualquer dia.
            </li>
          </ol>

          <p className="managed-email-foot">
            <ShieldCheck size={14} />
            O e-mail do grupo é compartilhado por todos os membros. Não use senha de rede social
            nele.
          </p>
        </>
      )}

      {!email && canProvision && (
        <>
          <p className="managed-email-intro">
            {serviceName
              ? `Recomendado para ${serviceName} e outras plataformas que pedem confirmação por e-mail toda vez que alguém entra.`
              : 'Recomendado para plataformas que pedem confirmação por e-mail toda vez que alguém entra.'}
          </p>
          <button
            type="button"
            className="btn btn-primary managed-email-create"
            onClick={handleCreate}
            disabled={criando}
          >
            {criando ? (
              <>
                <Loader2 size={16} className="spin" />
                Criando o e-mail do grupo...
              </>
            ) : (
              <>
                <Sparkles size={16} />
                Criar e-mail do grupo
              </>
            )}
          </button>

          <button
            type="button"
            className="managed-email-toggle-manual"
            onClick={() => setModoManual((v) => !v)}
          >
            {modoManual
              ? 'Ocultar cadastro manual'
              : 'Já criei a caixa no painel — cadastrar aqui'}
          </button>

          {modoManual && (
            <form className="managed-email-manual" onSubmit={handleRegister}>
              <p className="managed-email-manual-title">
                Cadastre a caixa que você criou no painel do servidor de e-mail
              </p>
              <label className="managed-email-label">
                E-mail da caixa do grupo
                <input
                  type="email"
                  value={emailManual}
                  onChange={(e) => setEmailManual(e.target.value)}
                  placeholder="grupo-abc123@dividepass.com"
                  autoComplete="off"
                />
              </label>
              <label className="managed-email-label">
                Senha da caixa
                <input
                  type="password"
                  value={senhaManual}
                  onChange={(e) => setSenhaManual(e.target.value)}
                  autoComplete="new-password"
                />
              </label>
              <label className="managed-email-label">
                Servidor IMAP (opcional)
                <input
                  type="text"
                  value={servidorManual}
                  onChange={(e) => setServidorManual(e.target.value)}
                  placeholder="mail.dividepass.com"
                  autoComplete="off"
                />
              </label>
              <button
                type="submit"
                className="btn btn-secondary managed-email-create"
                disabled={registrando || !emailManual.trim() || !senhaManual}
              >
                {registrando ? (
                  <>
                    <Loader2 size={16} className="spin" />
                    Cadastrando...
                  </>
                ) : (
                  'Cadastrar caixa do grupo'
                )}
              </button>
            </form>
          )}
        </>
      )}

      {erro && (
        <p className="managed-email-error">
          <AlertTriangle size={15} />
          {erro}
        </p>
      )}
    </div>
  );
}
