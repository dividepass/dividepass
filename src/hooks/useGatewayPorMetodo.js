import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  CHAVES_GATEWAY,
  ESCOPO_ALL,
  ESCOPO_V2,
  gatewayDoMetodo,
  gatewayPadrao,
  escopoDoSplit,
  settingsDeLinhas,
  splitAtivo,
} from '../lib/gatewayPorMetodo';

/**
 * Carrega a configuração de gateway do `app_settings`.
 *
 * Devolve o gateway PADRÃO e, se a divisão por método estiver ligada, o
 * gateway de cada método.
 *
 * VARIANTE
 * --------
 *   'v1' → o checkout de produção (o que já funciona). A divisão só vale
 *           aqui se o admin puser o escopo em 'todos'.
 *   'v2' → o checkout de teste. A divisão vale aqui por padrão (é o
 *           propósito dele) — sem mexer no checkout V1.
 *
 * COMPORTAMENTO ENQUANTO A MIGRATION NÃO FOR EXECUTADA
 * ----------------------------------------------------
 * A policy pública do `app_settings` só libera algumas chaves. Se a migration
 * `database/add-split-gateway.sql` ainda não rodou, as chaves `split_*` não
 * voltam na consulta — e aí `splitAtivo` é `false`, ou seja, **o site se
 * comporta exatamente como hoje** (tudo no gateway padrão). A degradação é
 * automática e segura.
 *
 * @param {'v1'|'v2'} variante
 */
export function useGatewayPorMetodo(variante = 'v1') {
  const [settings, setSettings] = useState({});
  const [carregado, setCarregado] = useState(false);

  useEffect(() => {
    let cancelado = false;

    supabase
      .from('app_settings')
      .select('key, value')
      .in('key', CHAVES_GATEWAY)
      .then(({ data }) => {
        if (cancelado) return;
        setSettings(settingsDeLinhas(data));
        setCarregado(true);
      })
      .catch(() => {
        if (cancelado) return;
        // Falhou a leitura: segue com o padrão (gateway de sempre).
        setCarregado(true);
      });

    return () => {
      cancelado = true;
    };
  }, []);

  return useMemo(() => {
    const padrao = gatewayPadrao(settings);
    const escopo = escopoDoSplit(settings);
    const ligado = splitAtivo(settings);

    // A divisão vale NESTE checkout quando: o admin ligou E (o escopo é
    // 'todos' OU este é o checkout V2).
    const usarSplit = ligado && (escopo === ESCOPO_ALL || variante === 'v2');

    return {
      carregado,
      settings,
      gatewayPadrao: padrao,
      splitAtivo: ligado,
      escopo,
      usarSplit,
      gatewayPix: settings.split_gateway_pix || '',
      gatewayCard: settings.split_gateway_card || '',
      gatewayDoMetodo: (metodo) => gatewayDoMetodo(settings, metodo, { split: usarSplit }),
    };
  }, [settings, carregado, variante]);
}
