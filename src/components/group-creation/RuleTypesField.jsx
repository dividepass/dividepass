import { useMemo, useState } from 'react';
import { Check, Info, Plus, ScrollText, Trash2 } from 'lucide-react';
import {
  GROUP_RULE_TYPES,
  buildRuleText,
  countRules,
  parseRuleText,
} from '../../lib/groupRuleTypes';
import './GroupCreation.css';

/**
 * ETAPA 4 — COBRANÇA (parte das regras)
 *
 * O dono do grupo não precisa escrever as regrinhas do zero: ele marca os
 * TIPOS que quer (uso pessoal, sem revenda, avisar antes de cancelar…) e,
 * se quiser, acrescenta uma regrinha só dele.
 *
 * O texto final é montado em `groups.rules`, uma regrinha por linha. O texto
 * gravado é a fonte da verdade (a coluna é TEXT): ao montar o componente,
 * `parseRuleText` reconhece as regrinhas do catálogo que já estavam gravadas
 * e devolve as marcadas + as livres.
 */
export default function RuleTypesField({
  value = '',
  onChange,
  /* Quando a tela já tem um título e uma explicação do bloco (ex.: o card
     "Regras do grupo" no Gerenciar Grupo), o componente esconde o rótulo e a
     dica para não repetir o mesmo texto duas vezes na tela. */
  hideLabel = false,
}) {
  const parsed = useMemo(() => parseRuleText(value), [value]);
  const [newRule, setNewRule] = useState('');
  const selected = parsed.selectedIds;
  const total = countRules(value);

  const emit = (nextSelectedIds, nextCustomText) => {
    onChange?.({ rules: buildRuleText(nextSelectedIds, nextCustomText) });
  };

  const toggleType = (id) => {
    const next = selected.includes(id)
      ? selected.filter((current) => current !== id)
      : [...selected, id];
    emit(next, parsed.customText);
  };

  const addCustomRule = () => {
    const line = newRule.trim();
    if (!line) return;
    const existing = parsed.customText ? `${parsed.customText}\n${line}` : line;
    emit(selected, existing);
    setNewRule('');
  };

  const removeCustomLine = (lineToRemove) => {
    const remaining = parsed.customText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => line !== lineToRemove);
    emit(selected, remaining.join('\n'));
  };

  const customLines = parsed.customText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return (
    <div className="gc-field">
      {!hideLabel && (
        <>
          <label>Regras do grupo</label>
          <small style={{ marginBottom: '0.35rem' }}>
            <Info size={12} style={{ verticalAlign: 'middle' }} /> Escolha os tipos de regrinha que
            valem para o grupo. Você pode escrever uma regrinha só sua também.
          </small>
        </>
      )}

      <div className="gc-rule-types">
        {GROUP_RULE_TYPES.map((type) => {
          const isSelected = selected.includes(type.id);
          return (
            <button
              key={type.id}
              type="button"
              className={`gc-rule-type ${isSelected ? 'active' : ''}`}
              onClick={() => toggleType(type.id)}
              aria-pressed={isSelected}
            >
              <span className="gc-rule-type-check" aria-hidden="true">
                {isSelected && <Check size={13} />}
              </span>
              <span className="gc-rule-type-body">
                <strong>{type.label}</strong>
                <small>{type.hint}</small>
              </span>
            </button>
          );
        })}
      </div>

      {customLines.length > 0 && (
        <div className="gc-rule-custom-list">
          {customLines.map((line, index) => (
            <span key={`${line}-${index}`} className="gc-rule-custom-item">
              <ScrollText size={13} />
              <span>{line}</span>
              <button
                type="button"
                onClick={() => removeCustomLine(line)}
                aria-label={`Remover a regrinha "${line}"`}
                title="Remover esta regrinha"
              >
                <Trash2 size={13} />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="gc-rule-custom-add">
        <input
          type="text"
          value={newRule}
          onChange={(e) => setNewRule(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addCustomRule();
            }
          }}
          placeholder="Ex: Não usar a conta fora de casa"
          aria-label="Escrever uma regrinha para o grupo"
        />
        <button
          type="button"
          className="btn btn-outline btn-sm"
          onClick={addCustomRule}
          disabled={!newRule.trim()}
        >
          <Plus size={15} /> Adicionar
        </button>
      </div>

      <small>
        {total === 0
          ? 'Nenhuma regrinha ainda — o grupo aparece sem aviso para o membro.'
          : `${total} regrinha${total === 1 ? '' : 's'} no grupo.`}
      </small>
    </div>
  );
}
