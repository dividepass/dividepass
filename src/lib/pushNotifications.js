import { supabase } from './supabase';

export const PUSH_PUBLIC_KEY = 'BKkFN3wPIxnfm4FdZ7iPQCy-_eLo4SzfmfIurDUx6ZpXCuWx3VBdl7ovmY0HpU4wPMCir7Ko3aNbT5HJD1018GA';

export function isPushSupported() {
  return typeof window !== 'undefined'
    && 'serviceWorker' in navigator
    && 'PushManager' in window
    && 'Notification' in window;
}

export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getSessionToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || null;
}

async function callPushFunction(path, body) {
  const token = await getSessionToken();
  if (!token) throw new Error('Você precisa estar logado.');

  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
    },
    body: JSON.stringify(body),
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || 'Falha na operação de push');
  }

  return data;
}

export async function registerPushSubscription(subscription, deviceName = 'DividePass Web') {
  return callPushFunction('register-push-subscription', {
    enabled: true,
    subscription,
    device_name: deviceName,
    user_agent: navigator.userAgent,
  });
}

export async function removePushSubscription(subscription) {
  return callPushFunction('register-push-subscription', {
    enabled: false,
    subscription,
  });
}
