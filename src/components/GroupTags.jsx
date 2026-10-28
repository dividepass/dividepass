import { BadgeCheck, Megaphone, MegaphoneOff, Crown } from 'lucide-react';
import './GroupTags.css';

/**
 * Selos do grupo, usados no catálogo, na página do grupo e em Meus Grupos.
 *
 * - "Verificado pela DividePass": destaque máximo. Grupo verificado é compra
 *   mais segura (a equipe conferiu o grupo), então o selo precisa de mais
 *   peso que o iconezinho de check ao lado do nome.
 * - "Com anúncios" / "Sem anúncios": o comprador precisa saber se a
 *   assinatura que vai receber tem propaganda — muda o que ele está
 *   pagando. `has_ads === null` (grupo antigo) não mostra selo nenhum.
 * - Tipo de conta ("Conta Família", "Conta Premium"...): o que o membro
 *   recebe de fato.
 */
export default function GroupTags({ group, size = 'md', showPlanType = true, showVerified = true, className = '' }) {
  if (!group) return null;

  const tags = [];

  if (showVerified && group.verified) {
    tags.push({
      key: 'verified',
      label: 'Verificado pela DividePass',
      short: 'Verificado',
      icon: BadgeCheck,
      tone: 'verified',
      title: 'A equipe DividePass conferiu este grupo. Compra mais segura.',
    });
  }

  if (group.has_ads === true) {
    tags.push({
      key: 'ads',
      label: 'Com anúncios',
      short: 'Com anúncios',
      icon: Megaphone,
      tone: 'ads',
      title: 'Esta assinatura exibe anúncios.',
    });
  } else if (group.has_ads === false) {
    tags.push({
      key: 'ads',
      label: 'Sem anúncios',
      short: 'Sem anúncios',
      icon: MegaphoneOff,
      tone: 'noads',
      title: 'Esta assinatura é sem anúncios (Premium).',
    });
  }

  const plano = group.plan_type_custom || group.plan_type;
  if (showPlanType && plano) {
    tags.push({
      key: 'plan',
      label: plano,
      short: plano,
      icon: Crown,
      tone: 'plan',
      title: `Tipo de conta compartilhada: ${plano}`,
    });
  }

  if (!tags.length) return null;

  return (
    <div className={`group-tags group-tags-${size} ${className}`.trim()}>
      {tags.map(tag => {
        const Icon = tag.icon;
        // O selo de verificado é o mais importante: nunca abrevia, senão o
        // comprador não sabe que a verificação é DA DIVIDEPASS.
        const texto = size === 'sm' && tag.key !== 'verified' ? tag.short : tag.label;
        return (
          <span key={tag.key} className={`group-tag group-tag-${tag.tone}`} title={tag.title || tag.label}>
            <Icon size={size === 'sm' ? 12 : 14} className="group-tag-icon" aria-hidden />
            <span className="group-tag-label">{texto}</span>
          </span>
        );
      })}
    </div>
  );
}
