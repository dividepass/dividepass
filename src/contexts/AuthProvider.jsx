import { useState, useEffect, useCallback } from 'react';
import { LogIn, ShieldAlert } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { AuthContext } from './AuthContext';
import { getGoogleAdsAttribution } from '../lib/googleAds';
import { logPlatformEvent } from '../lib/platformEventLogger';
import { sendWelcomeEmail } from '../lib/welcomeEmail';
import { saveAdminSession, readAdminSession, clearAdminSession, saveImpersonationMarker, readImpersonationMarker, clearImpersonationMarker } from '../lib/impersonacao';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  /* Impersonação (admin dentro da conta do cliente). Guarda quem é o admin,
     quem é o alvo e a sessão do admin — a sessão do admin fica em
     sessionStorage (ver `src/lib/impersonacao.js`). */
  const [impersonation, setImpersonation] = useState(null);
  const [restoringAdmin, setRestoringAdmin] = useState(false);

  const fetchProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, name, email, phone, nickname, avatar_url, birthdate, role, status, email_verified, last_login_at, created_at, updated_at, pwa_installed_at, push_notifications_enabled_at, onboarding_completed_at, onboarding_step, onboarding_started_at')
        .eq('id', userId)
        .single();

      if (error) {
        console.error('Error fetching profile:', error);
      } else {
        setProfile(data);
      }
    } catch (err) {
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);

      /* Sessão do admin guardada de uma impersonação anterior? Se a sessão
         atual já é a do admin, a impersonação acabou (o admin voltou) e o
         estado guardado é lixo — limpa. Se for a sessão do cliente, o
         banner precisa continuar aparecendo. */
      const guardado = readAdminSession();
      const marcador = readImpersonationMarker();

      if (guardado) {
        if (session?.user?.id === guardado.admin_id) {
          clearAdminSession();
          clearImpersonationMarker();
          setImpersonation(null);
        } else {
          setImpersonation(guardado);
        }
      } else if (marcador) {
        if (session?.user?.id === marcador.admin_id) {
          /* O admin voltou a entrar por conta própria — o aviso de
             impersonação não vale mais. */
          clearImpersonationMarker();
        } else if (session?.user?.id === marcador.target_id) {
          /* A aba foi fechada no meio da impersonação: a sessão do admin
             (que vivia no sessionStorage) se perdeu, mas o navegador
             continua logado na conta do cliente. O banner aparece
             explicando a situação e oferecendo o caminho de saída. */
          setImpersonation({ ...marcador, orfa: true });
        }
      }

      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user.id);
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signIn = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) throw error;

    if (data?.user) {
      await logPlatformEvent({
        event_type: 'user_login',
        title: 'Login realizado',
        message: `${data.user.user_metadata?.name || email} entrou na conta.`,
        metadata: { user_id: data.user.id, email },
        created_by: data.user.id,
      });

      // E-mail de boas-vindas no primeiro login (a conta já está confirmada
      // neste ponto). Fire and forget: o login não espera o e-mail. A trava
      // de duplicidade garante UM e-mail só, mesmo com o job diário atrás.
      sendWelcomeEmail(data.session?.access_token);
    }

    return data;
  }, []);

  const signUp = useCallback(async (name, email, phone, password, referralCode = null, extraData = {}) => {
    const attribution = getGoogleAdsAttribution();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          name,
          phone,
          lead_source: extraData.lead_source || null,
          lead_source_other: extraData.lead_source_other || null,
          ga_source: attribution?.source || null,
          ga_gclid: attribution?.gclid || null,
          ga_utm_source: attribution?.utm_source || null,
          ga_utm_medium: attribution?.utm_medium || null,
          ga_utm_campaign: attribution?.utm_campaign || null,
          ga_utm_term: attribution?.utm_term || null,
          ga_utm_content: attribution?.utm_content || null,
          ga_captured_at: attribution?.captured_at || null,
        }
      }
    });

    if (error) throw error;

    if (data?.user) {
      const code = data.user.id.substring(0, 8).toUpperCase();
      await supabase.from('user_referral_codes').insert({
        user_id: data.user.id,
        referral_code: code
      });

      // Platform event: user registered
      try {
        await supabase.from('platform_events').insert({
          event_type: 'user_registered',
          title: 'Novo usuário',
          message: `${name || email} se registrou na plataforma.`,
          metadata: JSON.stringify({ user_id: data.user.id, email, name }),
          created_by: data.user.id,
        });
      } catch (e) { console.error('Platform event error:', e); }

      // Register customers on all payment gateways (fire and forget)
      try {
        const { data: sessionData } = await supabase.auth.getSession();

        // E-mail de boas-vindas. Só sai agora se o Supabase já devolveu
        // sessão (confirmação de e-mail desativada). Com confirmação ativa,
        // ele sai no primeiro login — e o job diário cobre o buraco.
        sendWelcomeEmail(sessionData?.session?.access_token);

        fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/register-customers`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${sessionData?.session?.access_token}`,
            'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          },
          body: JSON.stringify({ user_id: data.user.id }),
        });
      } catch (e) {
        console.error('Customer registration error (non-blocking):', e);
      }

      if (referralCode) {
        const { data: referrerData } = await supabase
          .from('user_referral_codes')
          .select('user_id')
          .eq('referral_code', referralCode)
          .maybeSingle();

        if (referrerData) {
          await supabase.from('referrals').insert({
            referrer_id: referrerData.user_id,
            invitee_id: data.user.id,
            referral_code: referralCode,
            status: 'pending',
            points: 5
          });

          const inviteeCode = data.user.id.substring(0, 8).toUpperCase();
          const { data: inviteeCodeData } = await supabase
            .from('user_referral_codes')
            .select('id')
            .eq('user_id', data.user.id)
            .maybeSingle();

          if (inviteeCodeData) {
            await supabase.from('referrals').insert({
              referrer_id: data.user.id,
              invitee_id: data.user.id,
              referral_code: inviteeCode,
              status: 'completed',
              points: 5,
              completed_at: new Date().toISOString()
            });
          }
        }
      }
    }

    return data;
  }, []);

  const signOut = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    /* Saindo durante a impersonação: a sessão do admin guardada também sai
       junto. Não deixamos token de admin parado no navegador. */
    clearAdminSession();
    clearImpersonationMarker();
    setImpersonation(null);
    if (error) throw error;
  }, []);

  /**
   * Entra na conta de um cliente SEM a senha dele.
   *
   * A senha do cliente não é lida, gerada nem alterada: a edge
   * `admin-impersonate` gera um token magiclink de uso único (sem e-mail,
   * sem senha) e o navegador troca a própria sessão por esse token.
   *
   * Antes de trocar a sessão, a sessão do admin é guardada em
   * sessionStorage — é ela que devolve o admin ao painel no fim.
   */
  const startImpersonation = useCallback(async ({ userId, targetName, targetEmail }) => {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session) throw new Error('Sessão expirada. Faça login novamente.');

    const response = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-impersonate`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ user_id: userId }),
      }
    );

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Não foi possível entrar na conta do usuário');
    }

    const info = {
      admin_id: session.user.id,
      admin_email: session.user.email,
      target_id: userId,
      target_name: targetName || result.target_name || targetEmail || result.email,
      target_email: targetEmail || result.email,
    };

    const guardado = saveAdminSession(session, info);
    if (!guardado) {
      throw new Error('Não foi possível guardar a sessão do admin nesta aba.');
    }

    /* Marcador SEM token: se a aba for fechada no meio da impersonação, o
       navegador continua logado na conta do cliente e o admin precisa
       saber que aquilo não é a conta dele. */
    saveImpersonationMarker(info);

    /* Troca de sessão. O tipo do token varia entre "email" e "magiclink"
       conforme a versão do GoTrue — tentamos os dois para não depender
       de um só. */
    const tipos = [...new Set([result.verification_type, 'email', 'magiclink'].filter(Boolean))];
    let ultimoErro = null;
    let entrou = false;

    for (const tipo of tipos) {
      const { data, error } = await supabase.auth.verifyOtp({
        token_hash: result.token_hash,
        type: tipo,
      });
      if (!error && data?.session) {
        entrou = true;
        break;
      }
      ultimoErro = error;
    }

    if (!entrou) {
      // Não deu para trocar a sessão: desfaz a guarda para não deixar o
      // admin "preso" num estado que não existe.
      clearAdminSession();
      clearImpersonationMarker();
      throw new Error(ultimoErro?.message || 'Não foi possível trocar a sessão do navegador.');
    }

    setImpersonation(guardado);
    return guardado;
  }, []);

  /** Devolve o admin ao painel: recoloca a sessão guardada no navegador. */
  const restoreAdminSession = useCallback(async () => {
    const guardado = readAdminSession();
    if (!guardado) return null;

    const { error } = await supabase.auth.setSession({
      access_token: guardado.access_token,
      refresh_token: guardado.refresh_token,
    });
    if (error) throw error;

    clearAdminSession();
    clearImpersonationMarker();
    setImpersonation(null);
    return guardado;
  }, []);

  /**
   * Caminho de saída da impersonação (botão do banner e da sidebar).
   *
   * Se a sessão do admin ainda está guardada, ele volta ao painel. Se a aba
   * foi fechada no meio da impersonação, essa sessão já não existe: aí o
   * caminho é sair da conta do cliente e fazer login de novo como admin —
   * nunca ficar logado achando que é o admin.
   */
  const returnToAdmin = useCallback(async () => {
    setRestoringAdmin(true);
    try {
      const guardado = await restoreAdminSession();

      if (!guardado) {
        await supabase.auth.signOut();
        clearImpersonationMarker();
        setImpersonation(null);
        window.location.assign('/login');
        return;
      }

      /* Navegação dura de propósito: recarregar a página garante que o app
         suba limpo com a sessão do admin (nada do que o app carregou
         enquanto estava impersonando fica na tela). */
      const destino = guardado.target_id ? `/admin/users/${guardado.target_id}` : '/admin';
      window.location.assign(destino);
    } catch (err) {
      console.error('[impersonacao] falha ao voltar ao painel admin:', err);
      alert('Não foi possível voltar ao painel admin: ' + err.message);
    } finally {
      setRestoringAdmin(false);
    }
  }, [restoreAdminSession]);

  const value = {
    user,
    profile,
    loading,
    isAuthenticated: !!user,
    isAdmin: profile?.role === 'admin',
    /* Impersonação: `impersonation` é null fora da impersonação. */
    impersonation,
    impersonating: !!impersonation,
    startImpersonation,
    restoreAdminSession,
    returnToAdmin,
    signIn,
    signUp,
    signOut,
    refreshProfile: useCallback(() => user && fetchProfile(user.id), [user, fetchProfile])
  };

  return (
    <AuthContext.Provider value={value}>
      {children}

      {/* Banner de impersonação. Fica AQUI (e não dentro de uma página)
          porque o admin pode cair em telas fora do painel do cliente — o
          onboarding, o modal de avatar, a tela de login. Se o banner
          morresse junto com a página, o admin ficaria preso na conta do
          cliente sem como voltar. O z-index fica acima do gate de avatar
          (700) justamente por isso. */}
      {impersonation && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-3 z-[800] mx-auto flex w-[calc(100%_-_1.5rem)] max-w-xl flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-card/95 px-3 py-2.5 shadow-lg backdrop-blur-xl"
        >
          <ShieldAlert size={18} className="shrink-0 text-warning" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">
              Você está como {impersonation.target_name || impersonation.target_email}
            </p>
            <p className="text-xs text-muted-foreground">
              {impersonation.orfa
                ? 'A aba foi fechada no meio do acesso: a sessão do admin se perdeu. Saia e entre de novo como admin.'
                : 'A senha do cliente não foi alterada. A sessão do admin ficou guardada só nesta aba.'}
            </p>
          </div>
          <button
            type="button"
            onClick={returnToAdmin}
            disabled={restoringAdmin}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-warning px-3 py-1.5 text-xs font-bold text-warning-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
          >
            {restoringAdmin ? (
              <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-warning-foreground/40 border-t-warning-foreground" />
            ) : (
              <LogIn size={14} aria-hidden="true" />
            )}
            {impersonation.orfa ? 'Entrar como admin' : 'Voltar ao painel admin'}
          </button>
        </div>
      )}
    </AuthContext.Provider>
  );
}
