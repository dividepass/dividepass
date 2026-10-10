import { useState, useEffect } from 'react';
import { Plus, X, Check } from 'lucide-react';
import { supabase } from '../lib/supabase';
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
 */
export default function PlatformPicker({
  categories = [],
  value = [],
  customNames = [],
  customInput = '',
  showNoneOption = false,
  showCustomOption = false,
  onToggle,
  onCustomInputChange,
  onAddCustom,
  onRemoveCustom,
  helper,
  error,
}) {
  const [platforms, setPlatforms] = useState([]);
  const [loading, setLoading] = useState(true);

  // Serializado para comparar por valor: o array de categorias vem de
  // constante e muda de referência a cada render.
  const categoryKey = categories.join(',');

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('streaming_services')
        .select('id, name, icon_url, color')
        .in('category', categoryKey ? categoryKey.split(',') : ['__none__']);

      if (cancelled) return;

      const list = data || [];
      // Fixadas e em destaque primeiro, como no catálogo.
      list.sort((a, b) => (b.pinned === a.pinned ? (a.name || '').localeCompare(b.name || '', 'pt-BR') : b.pinned ? 1 : -1));
      setPlatforms(list);
      setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [categoryKey]);

  const isNone = value.includes(NONE);

  const toggle = (platformId) => {
    // "Nenhuma destas" é exclusivo nos dois sentidos.
    onToggle(isNone ? platformId : value.filter((v) => v !== NONE).concat(platformId));
  };

  const toggleNone = () => {
    onToggle(isNone ? [] : [NONE]);
    if (!isNone && customNames.length) customNames.forEach(onRemoveCustom);
  };

  return (
    <div className="platform-picker">
      {helper && <p className="platform-picker-helper">{helper}</p>}

      {loading ? (
        <div className="platform-picker-loading">Carregando plataformas...</div>
      ) : platforms.length === 0 ? (
        <div className="platform-picker-loading">Nenhuma plataforma disponível nesta categoria.</div>
      ) : (
        <div className="platform-picker-grid">
          {platforms.map((p) => {
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
          })}

          {showNoneOption && (
            <button
              type="button"
              className={`platform-pill platform-pill-none ${isNone ? 'selected' : ''}`}
              aria-pressed={isNone}
              onClick={toggleNone}
            >
              <span className="platform-pill-name">Nenhuma destas</span>
              {isNone && <Check size={13} className="platform-pill-check" />}
            </button>
          )}
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