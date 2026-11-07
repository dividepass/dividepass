import { useRef } from 'react';
import { Camera, Check, Palette } from 'lucide-react';
import { AVATAR_PRESETS } from '../lib/avatarPresets';
import './AvatarPicker.css';

/**
 * Seletor de avatar do DividePass.
 *
 * Duas formas de resolver o mesmo problema:
 *   - enviar uma foto (fica no bucket `profile-photos`);
 *   - escolher um avatar pronto da galeria (24 rostos + o logo da marca).
 *
 * O componente NÃO salva nada: ele só avisa o pai. Quem decide o que
 * acontece com a escolha é o gate (primeiro acesso) ou a tela de perfil.
 */
export default function AvatarPicker({
  selectedPreset = null,
  onSelectPreset,
  onSelectFile,
  disabled = false,
  compact = false,
}) {
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    // Limpa o value para permitir reenviar o mesmo arquivo.
    e.target.value = '';
    if (!file) return;
    onSelectFile?.(file);
  };

  return (
    <div className={`avatar-picker ${compact ? 'avatar-picker-compact' : ''}`}>
      <button
        type="button"
        className="avatar-picker-upload"
        onClick={() => inputRef.current?.click()}
        disabled={disabled}
      >
        <span className="avatar-picker-upload-icon">
          <Camera size={18} />
        </span>
        <span className="avatar-picker-upload-text">
          <strong>Enviar uma foto</strong>
          <small>JPG, PNG ou WEBP · até 5MB</small>
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={handleFile}
        hidden
      />

      <div className="avatar-picker-divider">
        <Palette size={14} />
        <span>ou escolha um avatar pronto</span>
      </div>

      <div className="avatar-picker-grid" role="radiogroup" aria-label="Avatares prontos">
        {AVATAR_PRESETS.map((preset) => {
          const selected = selectedPreset === preset.id;
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={preset.label}
              title={preset.label}
              className={`avatar-picker-item ${selected ? 'is-selected' : ''}`}
              onClick={() => onSelectPreset?.(preset)}
              disabled={disabled}
            >
              <img src={preset.url} alt={preset.label} loading="lazy" />
              {selected && (
                <span className="avatar-picker-check">
                  <Check size={12} strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
