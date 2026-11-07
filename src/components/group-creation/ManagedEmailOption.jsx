import { Sparkles, Mail, ShieldCheck } from 'lucide-react';
import './GroupCreation.css';

/**
 * ETAPA — GERENCIAMENTO DE ACESSO (opção "e-mail gerenciado com IA")
 *
 * O dono pode deixar a DividePass cuidar do e-mail da conta compartilhada:
 * a plataforma cria uma caixa EXCLUSIVA do grupo e a IA dela busca o código
 * de verificação e entrega pronto para o membro.
 *
 * Quando isso ajuda: em plataformas que pedem confirmação por e-mail toda vez
 * que alguém entra, o membro fica parado esperando o e-mail. Com a caixa do
 * grupo, ele clica em "Buscar Código" e recebe o número na hora — a qualquer
 * hora, em qualquer dia.
 */
export default function ManagedEmailOption({ value = {}, onChange, serviceName = '' }) {
  const { managed_email = false } = value;
  const set = (patch) => onChange?.(patch);

  return (
    <div className="gc-block">
      <p className="gc-section-label">GERENCIAMENTO DE ACESSO</p>

      <div className="gc-toggle-row">
        <div className="gc-toggle-text">
          <strong>Deixar a DividePass gerenciar o e-mail do grupo com IA</strong>
          <span>
            Recomendado para {serviceName ? serviceName : 'plataformas'} que pedem confirmação por
            e-mail toda vez que alguém entra.
          </span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={managed_email === true}
          aria-label="Gerenciar o e-mail do grupo com IA"
          className={`gc-switch ${managed_email === true ? 'on' : ''}`}
          onClick={() => set({ managed_email: managed_email !== true })}
        >
          <span className="gc-switch-knob" />
        </button>
      </div>

      {managed_email === true && (
        <div className="gc-managed-note">
          <p className="gc-managed-note-title">
            <Sparkles size={15} />
            Como funciona
          </p>
          <ul className="gc-managed-steps">
            <li>
              <span className="gc-managed-step-num">1</span>
              <span>
                A DividePass cria um <strong>e-mail exclusivo para o grupo</strong> e passa a
                cuidar dele por aqui.
              </span>
            </li>
            <li>
              <span className="gc-managed-step-num">2</span>
              <span>
                Você troca o e-mail da conta da plataforma para o e-mail do grupo — assim toda
                confirmação cai nessa caixa.
              </span>
            </li>
            <li>
              <span className="gc-managed-step-num">3</span>
              <span>
                Quando a plataforma pedir um código, o membro clica em <strong>Buscar Código</strong>{' '}
                e a IA entrega o número na hora. Não importa a hora nem o dia.
              </span>
            </li>
          </ul>
          <p className="gc-managed-note-foot">
            <ShieldCheck size={14} />
            O e-mail do grupo é criado assim que você publica o grupo. Você pode cancelar esta
            opção depois.
          </p>
        </div>
      )}

      {managed_email !== true && (
        <p className="gc-managed-hint">
          <Mail size={14} />
          Sem esta opção, cada membro precisa olhar o próprio e-mail para copiar o código de
          verificação.
        </p>
      )}
    </div>
  );
}
