import { Sparkles, Hand, ShieldCheck, Mail, AlertTriangle, Phone } from 'lucide-react';
import './GroupCreation.css';

/**
 * ETAPA — COMO O CÓDIGO DE CONFIRMAÇÃO CHEGA AO MEMBRO
 *
 * Só aparece quando a PLATAFORMA pede confirmação por e-mail ao acessar com
 * um dispositivo diferente (o admin liga isso em /admin/plataformas).
 *
 * A pergunta tem duas respostas e cada uma muda o dia a dia do grupo:
 *
 *   'managed' — a DividePass cria a caixa de e-mail do grupo e a IA busca o
 *               código sozinho. O dono abre a tela do grupo, clica em "Buscar
 *               código" e repassa com 1 clique. Funciona a qualquer hora.
 *
 *   'manual'  — o dono usa o e-mail que já tem na conta da plataforma e passa
 *               o código na mão para cada membro. Nesse caso o membro
 *               PRECISA de um meio para falar com o dono (e-mail ou
 *               telefone) — e o dono precisa saber que esse contato será
 *               mostrado ao membro depois do pagamento.
 */
export default function EmailCodeDeliveryStep({
  value = {},
  onChange,
  serviceName = '',
  ownerEmail = '',
}) {
  const {
    email_code_delivery = 'managed',
    owner_contact = '',
  } = value;

  const set = (patch) => onChange?.(patch);

  const choose = (mode) => {
    /* Ao trocar de modo, o contato do dono continua valendo — mas o padrão
       sugere o e-mail cadastrado, que é o que o membro já conhece. */
    set({
      email_code_delivery: mode,
      owner_contact: mode === 'manual' ? (owner_contact || ownerEmail || '') : owner_contact,
    });
  };

  return (
    <div className="gc-block gc-code-delivery">
      <p className="gc-section-label">CONFIRMAÇÃO POR E-MAIL</p>

      <div className="gc-code-delivery-question">
        <p className="gc-code-delivery-title">
          <AlertTriangle size={16} />
          {serviceName ? serviceName : 'Esta plataforma'} pede confirmação por e-mail quando
          alguém entra com um dispositivo diferente.
        </p>
        <p className="gc-code-delivery-sub">
          Como você quer que o código chegue aos membros do grupo?
        </p>
      </div>

      <div className="gc-code-delivery-options" role="radiogroup" aria-label="Como entregar o código de confirmação">
        <button
          type="button"
          role="radio"
          aria-checked={email_code_delivery === 'managed'}
          className={`gc-code-option ${email_code_delivery === 'managed' ? 'active' : ''}`}
          onClick={() => choose('managed')}
        >
          <span className="gc-code-option-radio" />
          <span className="gc-code-option-body">
            <span className="gc-code-option-head">
              <span className="gc-code-option-icon managed"><Sparkles size={15} /></span>
              <strong>DividePass controla com IA</strong>
              <span className="gc-code-tag">Recomendado</span>
            </span>
            <span className="gc-code-option-desc">
              O nosso bot busca o código no e-mail do grupo e entrega com 1 clique para todos os
              membros — não importa a hora nem o dia. O membro pede o código na hora em que a
              plataforma pede e recebe na hora.
            </span>
          </span>
        </button>

        <button
          type="button"
          role="radio"
          aria-checked={email_code_delivery === 'manual'}
          className={`gc-code-option ${email_code_delivery === 'manual' ? 'active' : ''}`}
          onClick={() => choose('manual')}
        >
          <span className="gc-code-option-radio" />
          <span className="gc-code-option-body">
            <span className="gc-code-option-head">
              <span className="gc-code-option-icon manual"><Hand size={15} /></span>
              <strong>Eu mesmo passo o código</strong>
            </span>
            <span className="gc-code-option-desc">
              Você olha o e-mail da conta da plataforma e repassa o código manualmente para cada
              membro, toda vez que a plataforma pedir.
            </span>
          </span>
        </button>
      </div>

      {email_code_delivery === 'managed' && (
        <div className="gc-managed-note">
          <p className="gc-managed-note-title">
            <Sparkles size={15} />
            Como funciona
          </p>
          <ul className="gc-managed-steps">
            <li>
              <span className="gc-managed-step-num">1</span>
              <span>
                A DividePass cria um <strong>e-mail exclusivo do grupo</strong> e você troca o
                e-mail da conta da plataforma por ele — assim toda confirmação cai nessa caixa.
              </span>
            </li>
            <li>
              <span className="gc-managed-step-num">2</span>
              <span>
                Quando a plataforma pedir o código, o grupo busca e entrega <strong>com 1
                clique</strong>, a qualquer hora, em qualquer dia.
              </span>
            </li>
          </ul>
          <p className="gc-managed-note-foot">
            <ShieldCheck size={14} />
            O e-mail do grupo é criado assim que você publica o grupo.
          </p>
        </div>
      )}

      {email_code_delivery === 'manual' && (
        <div className="gc-code-manual">
          <p className="gc-code-manual-title">
            <Mail size={15} />
            O membro vai precisar falar com você para receber o código
          </p>
          <p className="gc-code-manual-text">
            Como você vai passar o código na mão, deixe um contato para o membro conseguir te
            ligar ou te mandar um e-mail. Esse contato é o que o membro usa para pedir o código
            de acesso.
          </p>

          <div className="gc-field">
            <label>Contato para os membros *</label>
            <input
              value={owner_contact}
              onChange={(e) => set({ owner_contact: e.target.value })}
              placeholder="seu@email.com ou (11) 99999-9999"
              inputMode="text"
            />
            <small className="gc-field-hint">
              <Phone size={12} />
              E-mail ou telefone. Pode ser o mesmo e-mail da sua conta.
            </small>
          </div>

          <p className="gc-code-manual-warning">
            <AlertTriangle size={14} />
            Ao escolher esta opção, os seus dados de contato serão informados aos membros do
            grupo depois que eles pagarem.
          </p>
        </div>
      )}
    </div>
  );
}
