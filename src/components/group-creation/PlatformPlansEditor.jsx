import { Plus, Trash2, Info, CheckCircle2, AlertTriangle, Loader2, Save } from 'lucide-react';
import { brl } from '../../lib/platformFee';
import { emptyPlanDraft } from '../../lib/platformPlans';
import './GroupCreation.css';

/**
 * PLANOS DA PLATAFORMA
 *
 * Planos padrão que o dono do grupo escolhe na hora de criar o grupo.
 * O plano define:
 *   - valor cobrado pela plataforma (preço oficial do plano);
 *   - valor sugerido / mínimo / máximo que o grupo pode cobrar;
 *   - quantidade máxima de membros e telas simultâneas.
 *
 * Sem plano cadastrado, o grupo é criado sem vínculo de plano (tipo de
 * conta livre) — e sem teto de preço além do mínimo global.
 *
 * Os planos têm um botão próprio ("Salvar planos"): salvar a plataforma e
 * salvar os planos são coisas separadas — o erro de chave duplicada vinha
 * de salvar os dois juntos.
 */
export default function PlatformPlansEditor({
  plans = [],
  onChange,
  disabled = false,
  onSave,
  saving = false,
  error = '',
  success = '',
}) {
  const list = plans || [];

  const addPlan = () => onChange([...list, emptyPlanDraft()]);

  const updatePlan = (index, patch) => {
    const next = list.map((p, i) => (i === index ? { ...p, ...patch } : p));
    onChange(next);
  };

  const removePlan = (index) => onChange(list.filter((_, i) => i !== index));

  const movePlan = (index, direction) => {
    const target = index + direction;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  /* Dois planos com o MESMO nome recebem chaves diferentes no banco, mas
     é confuso para o gestor: avisamos antes de salvar. */
  const repeatedNames = list.reduce((acc, plan) => {
    const key = (plan.name || '').trim().toLowerCase();
    if (!key) return acc;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const hasRepeatedNames = Object.values(repeatedNames).some(n => n > 1);

  return (
    <section className="pf-section plans-editor">
      <div className="plans-editor-head">
        <div>
          <h2>Planos da plataforma</h2>
          <p className="section-desc">
            Planos padrão que os donos de grupo vão escolher na criação do grupo — a lista
            mostra <strong>somente os planos desta plataforma</strong>. Quem escolher um plano
            fica preso ao preço mínimo e máximo definidos aqui.
          </p>
        </div>
        <button type="button" className="btn btn-outline btn-sm" onClick={addPlan} disabled={disabled}>
          <Plus size={15} /> Adicionar plano
        </button>
      </div>

      {list.length === 0 ? (
        <div className="gc-empty">
          Nenhum plano cadastrado. Enquanto a plataforma não tiver planos, os grupos
          são criados <strong>sem vínculo de plano</strong> e sem teto de preço.
        </div>
      ) : (
        <div className="plans-editor-list">
          {list.map((plan, index) => {
            const min = parseFloat(plan.min_price) || 0;
            const max = parseFloat(plan.max_price) || 0;
            const invalidRange = min > 0 && max > 0 && min > max;

            return (
              <div key={plan.id || `new-${index}`} className="plan-editor-card">
                <div className="plan-editor-head">
                  <strong>{plan.name || `Plano ${index + 1}`}</strong>
                  <div className="plan-editor-actions">
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => movePlan(index, -1)}
                      disabled={disabled || index === 0}
                      title="Subir"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline"
                      onClick={() => movePlan(index, 1)}
                      disabled={disabled || index === list.length - 1}
                      title="Descer"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn-icon danger"
                      onClick={() => removePlan(index)}
                      disabled={disabled}
                      title="Remover plano"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="plan-editor-grid">
                  <div className="gc-field">
                    <label>Nome do plano *</label>
                    <input
                      value={plan.name}
                      onChange={e => updatePlan(index, { name: e.target.value })}
                      placeholder="Padrão com Anúncios"
                      disabled={disabled}
                    />
                  </div>

                  <div className="gc-field">
                    <label>Valor cobrado pela plataforma (R$) *</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={plan.official_price}
                      onChange={e => updatePlan(index, { official_price: e.target.value })}
                      placeholder="25.90"
                      disabled={disabled}
                    />
                  </div>

                  <div className="gc-field">
                    <label>Limite de usuários por grupo *</label>
                    <input
                      type="number"
                      min="1"
                      value={plan.max_members}
                      onChange={e => updatePlan(index, { max_members: e.target.value })}
                      placeholder="4"
                      disabled={disabled}
                    />
                    <small className="gc-field-hint">
                      Máximo de pessoas que podem entrar num grupo que usa este plano.
                    </small>
                  </div>

                  <div className="gc-field">
                    <label>Telas simultâneas</label>
                    <input
                      type="number"
                      min="1"
                      value={plan.max_screens}
                      onChange={e => updatePlan(index, { max_screens: e.target.value })}
                      placeholder="2"
                      disabled={disabled}
                    />
                    <small className="gc-field-hint">
                      Quantas pessoas podem assistir ao mesmo tempo.
                    </small>
                  </div>

                  <div className="gc-field">
                    <label>Valor sugerido por pessoa (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={plan.suggested_price}
                      onChange={e => updatePlan(index, { suggested_price: e.target.value })}
                      placeholder="25.90"
                      disabled={disabled}
                    />
                    <small className="gc-field-hint">
                      Preenchido sozinho na criação do grupo: é o valor que <strong>cada membro</strong> paga por mês.
                    </small>
                  </div>

                  <div className="gc-field">
                    <label>Valor mínimo por pessoa (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={plan.min_price}
                      onChange={e => updatePlan(index, { min_price: e.target.value })}
                      placeholder="19.90"
                      disabled={disabled}
                    />
                    <small className="gc-field-hint">
                      Teto inferior: o dono não pode cobrar menos que isso <strong>por pessoa</strong>.
                    </small>
                  </div>

                  <div className="gc-field">
                    <label>Valor máximo por pessoa (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={plan.max_price}
                      onChange={e => updatePlan(index, { max_price: e.target.value })}
                      placeholder="34.90"
                      disabled={disabled}
                    />
                    <small className="gc-field-hint">
                      Teto superior: o dono não pode cobrar mais que isso <strong>por pessoa</strong>.
                    </small>
                  </div>

                  <div className="gc-field">
                    <label>Qualidade</label>
                    <input
                      value={plan.quality}
                      onChange={e => updatePlan(index, { quality: e.target.value })}
                      placeholder="Full HD (1080p)"
                      disabled={disabled}
                    />
                  </div>
                </div>

                {/* Resumo do que o usuário vai ver no card do plano. */}
                <div className="plan-editor-summary">
                  {plan.max_members ? <span>Até {plan.max_members} usuário(s)</span> : null}
                  {plan.max_screens ? <span>{plan.max_screens} tela(s)</span> : null}
                  {plan.quality ? <span>{plan.quality}</span> : null}
                  {plan.official_price ? <span>R$ {brl(parseFloat(plan.official_price) || 0)}</span> : null}
                  {plan.min_price || plan.max_price ? (
                    <span>
                      R$ {brl(min || 0)}{max ? ` a R$ ${brl(max)}` : ''} por pessoa
                    </span>
                  ) : null}
                </div>

                <div className="gc-field">
                  <label>Limitações e regras (aparecem para o usuário)</label>
                  <textarea
                    rows={2}
                    value={plan.details}
                    onChange={e => updatePlan(index, { details: e.target.value })}
                    placeholder="Ex: 1 tela porvez. Não permite adicionar assinante extra. Sem download."
                    disabled={disabled}
                  />
                  <small className="gc-field-hint">
                    Escreva aqui as regras do plano. Esse texto aparece no card do plano, na tela
                    de criação do grupo — é ele que explica ao usuário o que ele pode ou não pode fazer.
                  </small>
                </div>

                {invalidRange && (
                  <div className="gc-note warn">
                    <Info size={15} />
                    <span>O valor mínimo (R$ {brl(min)}) está acima do máximo (R$ {brl(max)}).</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {hasRepeatedNames && (
        <div className="gc-note warn">
          <AlertTriangle size={15} />
          <span>
            Há dois planos com o mesmo nome. Eles continuam salvos (o banco diferencia pela
            chave interna), mas dá confusão — renomeie um deles para o gestor saber qual é
            qual.
          </span>
        </div>
      )}

      {error && (
        <div className="gc-note error">
          <AlertTriangle size={15} />
          <span>{error}</span>
        </div>
      )}

      {success && (
        <div className="gc-note success">
          <CheckCircle2 size={15} />
          <span>{success}</span>
        </div>
      )}

      {/* Botão próprio dos planos: salvar a plataforma não mexe nos planos
          (antes os dois iam juntos e um conflito de chave derrubava tudo). */}
      {onSave && (
        <div className="plans-editor-footer">
          <p className="gc-field-hint">
            Salvar os planos é separado de salvar a plataforma — os planos são gravados
            agora, sem mexer no resto do cadastro.
          </p>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={onSave}
            disabled={disabled || saving}
          >
            {saving ? <Loader2 size={15} className="spin" /> : <Save size={15} />}
            {saving ? 'Salvando planos...' : 'Salvar planos'}
          </button>
        </div>
      )}
    </section>
  );
}
