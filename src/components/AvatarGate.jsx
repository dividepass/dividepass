import { useEffect, useMemo, useState } from 'react';
import { Loader2, AlertCircle, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import { saveAvatar } from '../lib/uploadAvatar';
import AvatarPicker from './AvatarPicker';
import './AvatarGate.css';
/**
 * Gate de avatar: quem entra sem avatar é obrigado a escolher um.
 *
 * Regra: `users.avatar_url` vazio = ainda não escolheu. Depois de escolhido
 * (foto ou avatar pronto), o gate nunca mais aparece para aquela pessoa.
 *
 * Enquanto o onboarding está em andamento o gate NÃO aparece: a própria
 * tela de onboarding já resolve o avatar, e dois modais empilhados
 * disputariam a tela (o mesmo cuidado do PwaInstallGate).
 */
export default function AvatarGate() {
  const { user, profile, refreshProfile } = useAuth();

  const [preset, setPreset] = useState(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onboardingPending = Boolean(profile && !profile.onboarding_completed_at);
  const needsAvatar = Boolean(user && profile && !profile.avatar_url && !onboardingPending);

  // Libera a URL temporária da pré-visualização ao desmontar.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Escolhe uma foto: guarda o arquivo e a pré-visualização local.
  const handleFile = (f) => {
    if (!f) return;
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setFile(f);
    setPreset(null);
    setError('');
  };

  const handlePreset = (p) => {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(null);
    setFile(null);
    setPreset(p);
    setError('');
  };

  const currentPreview = useMemo(() => {
    if (preview) return preview;
    if (preset) return preset.url;
    return null;
  }, [preview, preset]);

  if (!needsAvatar) return null;

  const handleSave = async () => {
    setError('');

    if (!preset && !file) {
      setError('Escolha um avatar pronto ou envie uma foto para continuar.');
      return;
    }

    setBusy(true);
    try {
      if (file) {
        await saveAvatar(file, user.id);
      } else {
        const { error: updErr } = await supabase
          .from('users')
          .update({ avatar_url: preset.url })
          .eq('id', user.id);
        if (updErr) throw updErr;
      }
      await refreshProfile?.();
    } catch (err) {
      console.error('AvatarGate: falha ao salvar avatar', err);
      setError(err.message || 'Não foi possível salvar seu avatar. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  // Nome "de verdade" para a saudação: sem e-mail e sem vazio.
  const name = (profile?.name || profile?.email || '').trim();
  const rawName = (profile?.name || '').trim();
  const firstName = rawName && !rawName.includes('@') ? rawName.split(' ')[0] : '';

  return (
    <div className="avatar-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="avatar-gate-title">
      <div className="avatar-gate-modal">
        <div className="avatar-gate-header">
          <span className="avatar-gate-badge">
            <ShieldCheck size={15} />
            <span>Obrigatório</span>
          </span>
        </div>

        <div className="avatar-gate-intro">
          <div className="avatar-gate-avatar">
            {currentPreview ? (
              <img src={currentPreview} alt="Pré-visualização do avatar" />
            ) : (
              <span>{(name || '?').trim()[0].toUpperCase()}</span>
            )}
          </div>
          <div>
            <h2 id="avatar-gate-title">Escolha seu avatar</h2>
            <p>
              {firstName ? `${firstName}, ` : ''}as pessoas que dividem grupos com você
              reconhecem mais rápido um rosto. Suba uma foto ou escolha um avatar pronto —
              dá para trocar depois.
            </p>
          </div>
        </div>

        <AvatarPicker
          selectedPreset={preset?.id || null}
          onSelectPreset={handlePreset}
          onSelectFile={handleFile}
          disabled={busy}
        />

        {error && (
          <div className="avatar-gate-error">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <button className="btn btn-primary avatar-gate-save" onClick={handleSave} disabled={busy}>
          {busy ? (
            <>
              <Loader2 size={17} className="spin" /> Salvando...
            </>
          ) : (
            'Salvar e continuar'
          )}
        </button>
      </div>
    </div>
  );
}
