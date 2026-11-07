import { splitRuleLines } from '../lib/groupRuleTypes';
import './GroupRules.css';

/**
 * REGRINHAS DO GRUPO
 *
 * As regras são gravadas em `groups.rules`, uma regrinha por linha. Este
 * componente quebra o texto em linhas e mostra cada uma como um item de
 * lista — o mesmo formato em todas as telas (detalhe do grupo, checkout e
 * credenciais), para o membro ler igual em todo lugar.
 *
 * A classe é `group-rules-list` (não `group-rules`): o `App.css` já usa
 * `.group-rules` num seletor global e a colisão mudaria o visual.
 */
export default function GroupRules({ rules, className = '' }) {
  const lines = splitRuleLines(rules);
  if (!lines.length) return null;

  return (
    <ul className={`group-rules-list ${className}`.trim()}>
      {lines.map((line, index) => (
        <li key={`${index}-${line}`}>{line}</li>
      ))}
    </ul>
  );
}
