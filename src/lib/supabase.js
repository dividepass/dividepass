import { createClient } from '@supabase/supabase-js';

// Config publica do cliente Supabase.
//
// A publishable key e uma credencial DE CLIENTE: ela viaja no bundle do
// navegador de qualquer forma e o acesso dela e limitado pelas politicas
// RLS do banco. Manter o fallback aqui evita que um build sem as variaveis
// de ambiente (Vercel/Dokploy) derrube o site inteiro com tela branca.
//
// Em qualquer ambiente novo, defina VITE_SUPABASE_URL e
// VITE_SUPABASE_ANON_KEY: eles tem prioridade sobre o fallback.
const FALLBACK_SUPABASE_URL = 'https://lasoouwboxspstqvjbsv.supabase.co';
const FALLBACK_SUPABASE_KEY = 'sb_publishable_wEPiY05_TmJVND5a6D812g_9Mw-_LXR';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || FALLBACK_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || FALLBACK_SUPABASE_KEY;

if (!import.meta.env.VITE_SUPABASE_URL || !import.meta.env.VITE_SUPABASE_ANON_KEY) {
  console.warn(
    '[supabase] VITE_SUPABASE_URL/VITE_SUPABASE_ANON_KEY ausentes no build. ' +
      'Usando a configuracao publica de fallback.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    detectSessionInUrl: false,
  },
});
