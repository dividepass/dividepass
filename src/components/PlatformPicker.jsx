import { useState, useEffect, useMemo } from 'react';
import { Plus, X, Check, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { categoryLabel } from '../lib/onboardingQuestions';
import './PlatformPicker.css';

const NONE = '__nenhuma__';

/**
 * Grade de seleção de plataformas, carregada de streaming_services por
 * categoria.
 *
 * - showNoneOption: chip "Nenhuma destas" exclusivo. Marcar ele limpa as
 *   outras; marcar qualquer outra desmarca ele. Sem isso, o usuário acaba
 *   com "Nenhuma destas + Netflix" marcados ao mesmo tempo.
 * - showCustomOption: campo livre para plataforma que não está no catálogo.
 * - searchable: campo de busca. Com o catálogo inteiro (100+ serviços) a
 *   rolagem até o serviço é o que mais cansa, então o filtro por nome é
 *   obrigatório nesse caso.
 * - groupByCategory: separa os serviços por categoria, em blocos com título.
 */
export default function PlatformPicker({
  categories = [],
  value = [],
  customNames = [],
  customInput = '',
  showNoneOption = false,
  showCustomOption = false,
  searchable = false,
  groupByCategory = false,
  onToggle,
  onCustomInputChange,
  onAddCustom,
  onRemoveCustom,
  helper,
  error,
}) {
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  // Serializado para comparar por valor: o array de categorias vem de
  // constante e muda de referência a cada render.
  const categoryKey = categories.join(',');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const catList = categoryKey ? categoryKey.split(',') : ['__none__'];

      const [svcRes, groupsRes] = await Promise.all([
        supabase
          .from('streaming_services')
          .select('id, name, icon_url, color, category, pinned, featured')
          // Só plataformas ativas: um rascunho de plataforma (novo fluxo
          // /admin/platforms/:id/new) não pode aparecer para o usuário.
          .eq('status', 'active')
          .in('category', catList),
        // Só os ids: 23 linhas hoje, e é o que alimenta a 2ª ordem.
        supabase.from('groups').select('service_id'),
      ]);

      if (cancelled) return;

      // Quantos grupos cada plataforma tem. Uma plataforma com grupo é o que
      // realmente vendemos, então sobe na lista mesmo sem ser destaque.
      const groupCount = new Map();
      for (const g of groupsRes.data || []) {
        if (!g.service_id) continue;
        groupCount.set(g.service_id, (groupCount.get(g.service_id) || 0) + 1);
      }

      const list = svcRes.data || [];
      list.sort((a, b) => {
        // 1. destaques (pinned ou featured) — o que a plataforma quer mostrar
        const aHot = a.pinned === true || a.featured === true ? 1 : 0;
        const bHot = b.pinned === true || b.featured === true ? 1 : 0;
        if (aHot !== bHot) return bHot - aHot;

        // 2. quem já tem grupo — é o que temos pra vender agora
        const aGroups = groupCount.get(a.id) || 0;
        const bGroups = groupCount.get(b.id) || 0;
        if (aGroups !== bGroups) return bGroups - aGroups;

        // 3. alfabética, para achar o resto
        return (a.name || '').localeCompare(b.name || '', 'pt-BR');
      });

      setPlatforms(list);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [categoryKey]);

  /* A busca filtra por nome; o agrupamento é montado depois, para que um
     serviço encontrado pela busca apareça direto no bloco da categoria. */
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return platforms;
    return platforms.filter((p) => (p.name || '').toLowerCase().includes(q));
  }, [platforms, search]);

  /* Blocos por categoria, na ordem em que as categorias foram pedidas. */
  const groups = useMemo(() => {
    if (!groupByCategory) return [];

    const order = categories.length ? categories : ['__todas__'];
    const byCategory = new Map();
    for (const p of visible) {
      const key = p.category || '__outras__';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(p);
    }

    return order
      .filter((c) => byCategory.has(c))
      .map((c) => ({
        key: c,
        label: categoryLabel(c === '__outras__' ? null : c),
        items: byCategory.get(c),
      }));
  }, [visible, groupByCategory, categories]);

  const isNone = value.includes(NONE);

  const toggle = (platformId) => {
    // Sempre um array: o gate chama .filter() na validação, e um id solto
    // aqui estouraria TypeError e travaria a etapa sem mensagem na tela.
    onToggle(isNone ? [platformId] : value.filter((v) => v !== NONE).concat(platformId));
  };

  const toggleNone = () => {
    onToggle(isNone ? [] : [NONE]);
    if (!isNone && customNames.length) customNames.forEach(onRemoveCustom);
  };

  const renderPill = (p) => {
    const selected = isNone ? false : value.includes(String(p.id));
    return (
      <button
        key={p.id}
        type="button"
        className={`platform-pill ${selected ? 'selected' : ''}`}
        aria-pressed={selected}
        onClick={() => toggle(String(p.id))}
      >
        {p.icon_url ? (
          <img src={p.icon_url} alt="" className="platform-pill-icon" />
        ) : (
          <span className="platform-pill-icon" style={{ background: p.color || '#4F46E5' }}>
            {p.name?.charAt(0)}
          </span>
        )}
        <span className="platform-pill-name">{p.name}</span>
        {selected && <Check size={13} className="platform-pill-check" />}
      </button>
    );
  };

  const noneButton = showNoneOption ? (
    <button
      type="button"
      className={`platform-pill platform-pill-none ${isNone ? 'selected' : ''}`}
      aria-pressed={isNone}
      onClick={toggleNone}
    >
      <span className="platform-pill-name">Nenhuma destas</span>
      {isNone && <Check size={13} className="platform-pill-check" />}
    </button>
  ) : null;

  return (
    <div className="platform-picker">
      {helper && <p className="platform-picker-helper">{helper}</p>}

      {searchable && (
        <div className="platform-picker-search">
          <Search size={15} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar serviço..."
            aria-label="Buscar serviço"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Limpar busca">
              <X size={14} />
            </button>
          )}
        </div>
      )}

      {loading ? (
        <div className="platform-picker-loading">Carregando plataformas...</div>
      ) : platforms.length === 0 ? (
        <div className="platform-picker-loading">Nenhuma plataforma disponível nesta categoria.</div>
      ) : visible.length === 0 ? (
        <div className="platform-picker-loading">
          Nenhum serviço encontrado para “{search.trim()}”.
        </div>
      ) : groupByCategory ? (
        <div className="platform-picker-groups">
          {/* "Nenhuma destas" fica no topo: quem não quer nenhum serviço não
              precisa rolar a lista inteira para achar a saída. */}
          {noneButton && <div className="platform-picker-none-row">{noneButton}</div>}

          {groups.map((g) => (
            <div className="platform-picker-group" key={g.key}>
              <span className="platform-picker-group-label">{g.label}</span>
              <div className="platform-picker-grid is-grouped">{g.items.map(renderPill)}</div>
            </div>
          ))}
        </div>
      ) : (
        <div className="platform-picker-grid">
          {visible.map(renderPill)}
          {noneButton}
        </div>
      )}

      {showCustomOption && (
        <div className="platform-picker-custom">
          {customNames.map((name) => (
            <span key={name} className="platform-custom-tag">
              {name}
              <button type="button" onClick={() => onRemoveCustom(name)} aria-label={`Remover ${name}`}>
                <X size={12} />
              </button>
            </span>
          ))}

          <div className="platform-custom-add">
            <Plus size={14} />
            <input
              type="text"
              value={customInput}
              onChange={(e) => onCustomInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onAddCustom(); } }}
              placeholder="Outra plataforma"
              aria-label="Outra plataforma"
            />
            <button type="button" onClick={onAddCustom} disabled={!customInput.trim()}>
              Adicionar
            </button>
          </div>
        </div>
      )}

      {error && <span className="field-error">{error}</span>}
    </div>
  );
}

export { NONE as NONE_PLATFORM };
