import { useCallback, useEffect, useState } from 'react';
import { PUSH_PUBLIC_KEY, isPushSupported, registerPushSubscription, removePushSubscription, urlBase64ToUint8Array } from '../lib/pushNotifications';

const STORAGE_KEY = 'dp_push_enabled';

export function usePushNotifications() {
  const [supported, setSupported] = useState(false);
  const [permission, setPermission] = useState('default');
  const [enabled, setEnabled] = useState(() => localStorage.getItem(STORAGE_KEY) === '1');
  const [loading, setLoading] = useState(false);

  const refreshStatus = useCallback(async () => {
    if (!isPushSupported()) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      const active = !!sub;
      setEnabled(active);
      if ('Notification' in window) setPermission(Notification.permission);
      if (active) localStorage.setItem(STORAGE_KEY, '1');
      else localStorage.removeItem(STORAGE_KEY);
      return sub;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    const ok = isPushSupported();
    setSupported(ok);
    if ('Notification' in window) setPermission(Notification.permission);
    if (ok) {
      refreshStatus();
    }
  }, [refreshStatus]);

  const enablePush = useCallback(async () => {
    if (!isPushSupported()) {
      throw new Error('Este navegador não suporta notificações push.');
    }

    setLoading(true);
    try {
      let currentPermission = Notification.permission;

      if (currentPermission === 'denied') {
        throw new Error('Notificações bloqueadas no navegador. Permita nas configurações do navegador e tente novamente.');
      }

      if (currentPermission === 'default') {
        currentPermission = await Notification.requestPermission();
      }

      if (currentPermission !== 'granted') {
        throw new Error('Permissão de notificações negada. Você pode ativar depois nas configurações do perfil.');
      }

      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(PUSH_PUBLIC_KEY),
        });
      }

      await registerPushSubscription(sub.toJSON(), navigator.platform || 'DividePass Web');
      setEnabled(true);
      setPermission(currentPermission);
      localStorage.setItem(STORAGE_KEY, '1');
      return sub;
    } catch (err) {
      if (err.name === 'NotAllowedError') {
        throw new Error('Permissão de notificações negada. Você pode ativar depois nas configurações do perfil.');
      }
      if (err.name === 'AbortError' || err.name === 'InvalidStateError') {
        throw new Error('Erro ao registrar notificações. Tente novamente.');
      }
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const disablePush = useCallback(async () => {
    if (!isPushSupported()) return;
    setLoading(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await removePushSubscription(sub.toJSON());
        await sub.unsubscribe();
      }
      setEnabled(false);
      localStorage.removeItem(STORAGE_KEY);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    supported,
    permission,
    enabled,
    loading,
    refreshStatus,
    enablePush,
    disablePush,
  };
}
