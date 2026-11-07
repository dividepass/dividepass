import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  WHATSAPP_VIP_FALLBACK,
  WHATSAPP_VIP_SETTING_KEY,
  normalizeWhatsappVipUrl,
} from '../lib/siteLinks';

/**
 * Link do Grupo VIP do WhatsApp, lido de `app_settings`.
 *
 * A configuração é editável em Configurações (admin), então trocar o convite
 * (que expira) não exige novo deploy: o site lê do banco na visita.
 *
 * Detalhes que importam:
 *  - O resultado fica em cache no módulo: a home e o rodapé (e o painel)
 *    compartilham a MESMA requisição, em vez de uma por componente.
 *  - Falha de rede, RLS bloqueando ou link inválido no banco caem no valor
 *    padrão — o botão nunca fica sem href.
 */

let cache = null; // { url, promise }
const listeners = new Set();

function publish(url) {
  cache = { ...cache, url };
  listeners.forEach((fn) => fn(url));
}

export function loadWhatsappVipUrl() {
  if (cache?.promise) return cache.promise;

  const promise = supabase
    .from('app_settings')
    .select('value')
    .eq('key', WHATSAPP_VIP_SETTING_KEY)
    .limit(1)
    .maybeSingle()
    .then(({ data }) => {
      const url = normalizeWhatsappVipUrl(data?.value) || WHATSAPP_VIP_FALLBACK;
      publish(url);
      return url;
    })
    .catch(() => {
      const url = WHATSAPP_VIP_FALLBACK;
      publish(url);
      return url;
    });

  cache = { url: WHATSAPP_VIP_FALLBACK, promise };
  return promise;
}

export function useWhatsappVipUrl() {
  const [url, setUrl] = useState(() => cache?.url || WHATSAPP_VIP_FALLBACK);

  useEffect(() => {
    listeners.add(setUrl);
    loadWhatsappVipUrl();
    return () => {
      listeners.delete(setUrl);
    };
  }, []);

  return url;
}
