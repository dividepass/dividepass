import { useEffect, useMemo, useState } from 'react';

let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}

export function usePwaInstall() {
  const [canInstall, setCanInstall] = useState(Boolean(deferredInstallPrompt));
  const [isStandalone, setIsStandalone] = useState(() => isStandaloneDisplay());

  useEffect(() => {
    setIsStandalone(isStandaloneDisplay());

    const handleBeforeInstallPrompt = (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      setCanInstall(true);
    };

    const handleAppInstalled = () => {
      deferredInstallPrompt = null;
      setCanInstall(false);
      setIsStandalone(true);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const promptInstall = async () => {
    const promptEvent = deferredInstallPrompt;
    if (!promptEvent) {
      return { available: false, outcome: 'unavailable' };
    }

    promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    if (choice?.outcome === 'accepted') {
      deferredInstallPrompt = null;
      setCanInstall(false);
    }
    return { available: true, outcome: choice?.outcome || 'dismissed' };
  };

  return useMemo(() => ({
    canInstall,
    isStandalone,
    promptInstall,
  }), [canInstall, isStandalone]);
}
