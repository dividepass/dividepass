import { useEffect, useMemo, useState } from 'react';
import { Download, Smartphone, CheckCircle2, X } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { usePwaInstall } from '../hooks/usePwaInstall';
import './PwaInstallGate.css';

function PwaInstallGate() {
  const { user, profile, refreshProfile } = useAuth();
  const { canInstall, isStandalone, promptInstall } = usePwaInstall();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissed, setDismissed] = useState(() => localStorage.getItem('pwa_gate_dismissed') === '1');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px) and (pointer: coarse)');
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener?.('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener?.('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  const shouldShow = useMemo(() => Boolean(user && isMobile && !profile?.pwa_installed_at && !isStandalone && !dismissed), [user, isMobile, profile?.pwa_installed_at, isStandalone, dismissed]);

  useEffect(() => {
    setOpen(shouldShow);
  }, [shouldShow]);

  useEffect(() => {
    if (isStandalone && user?.id && !profile?.pwa_installed_at) {
      markInstalled();
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isStandalone, user?.id, profile?.pwa_installed_at]);

  const dismissGate = () => {
    setDismissed(true);
    setOpen(false);
    localStorage.setItem('pwa_gate_dismissed', '1');
  };

  const markInstalled = async () => {
    if (!user?.id || profile?.pwa_installed_at) return;
    const now = new Date().toISOString();
    const { error } = await supabase.from('users').update({ pwa_installed_at: now }).eq('id', user.id);
    if (!error) {
      await refreshProfile?.();
    }
  };

  const handleInstall = async () => {
    setBusy(true);
    try {
      const result = await promptInstall();
      if (result.available && result.outcome === 'accepted') {
        await markInstalled();
      }
      dismissGate();
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const iosHint = /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? 'No Safari, toque no botão de compartilhar e depois em “Adicionar à Tela de Início”.'
    : 'Se o navegador não abrir o prompt, use o menu dele para instalar o app.';

  return (
    <div className="pwa-gate-backdrop" role="dialog" aria-modal="true" aria-labelledby="pwa-gate-title">
      <div className="pwa-gate-modal">
        <div className="pwa-gate-header">
          <div className="pwa-gate-badge">
            <Smartphone size={16} />
            <span>Instalação obrigatória</span>
          </div>
          <button className="pwa-gate-close" onClick={dismissGate} aria-label="Fechar">
            <X size={18} />
          </button>
        </div>

        <h2 id="pwa-gate-title">Instale o DividePass para continuar</h2>
        <p className="pwa-gate-text">
          Crie o atalho do app agora. Depois da instalação, este aviso não aparece mais neste dispositivo.
        </p>

        <div className="pwa-gate-points">
          <div><CheckCircle2 size={16} /> Abre mais rápido</div>
          <div><CheckCircle2 size={16} /> Fica na tela inicial</div>
          <div><CheckCircle2 size={16} /> Funciona como app</div>
        </div>

        <div className="pwa-gate-actions">
          <button className="btn btn-primary pwa-gate-btn" onClick={handleInstall} disabled={busy}>
            <Download size={18} /> {busy ? 'Abrindo...' : canInstall ? 'Instalar agora' : 'Ver instruções e continuar'}
          </button>
          <button className="pwa-gate-secondary" onClick={dismissGate}>
            Continuar no navegador
          </button>
          <p className="pwa-gate-hint">{iosHint}</p>
        </div>
      </div>
    </div>
  );
}

export default PwaInstallGate;
