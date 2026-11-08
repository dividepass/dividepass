import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Rocket, X } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { supabase } from '../lib/supabase';
import './CreateGroupCta.css';

const DISMISS_KEY = 'dividepass:cta-criar-groupo';

/**
 * CARD DE CHAMADA — "Comece a criar o seu grupo agora"
 *
 * Aparece no topo da home de quem, no onboarding, disse que quer CRIAR um
 * grupo ("criar" ou "ambos") e ainda não tem nenhum grupo seu.
 *
 * Regras:
 *  - só aparece para quem tem a intenção de criar (vem do onboarding);
 *  - some assim que a pessoa cria o primeiro grupo (ou fecha o card);
 *  - nunca trava a home: se a consulta falhar, o card simplesmente não aparece.
 */
export default function CreateGroupCta() {
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);

  /* O "fechou o card" é uma decisão local do navegador — não vale a pena
     gravar no banco uma preferência que só importa para este aparelho. */
  const [dismissed, setDismissed] = useState(() => {
    try {
      return window.localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      /* localStorage bloqueado (modo privado): segue sem dismiss */
      return false;
    }
  });

  useEffect(() => {
    if (!user?.id) return undefined;

    let cancelled = false;

    (async () => {
      try {
        const [perfilRes, gruposRes] = await Promise.all([
          supabase
            .from('user_onboarding_profiles')
            .select('group_intent')
            .eq('user_id', user.id)
            .maybeSingle(),
          supabase
            .from('groups')
            .select('id', { count: 'exact', head: true })
            .eq('owner_id', user.id),
        ]);

        if (cancelled) return;

        const intencao = perfilRes.data?.group_intent;
        const querCriar = intencao === 'criar' || intencao === 'ambos';
        const jaTemGrupo = (gruposRes.count || 0) > 0;

        if (querCriar && !jaTemGrupo) setVisible(true);
      } catch {
        /* Falha de rede/RLS: o card não aparece — a home continua igual. */
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id]);

  if (!visible || dismissed) return null;

  const fechar = () => {
    setDismissed(true);
    try {
      window.localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* sem storage: some só nesta sessão */
    }
  };

  return (
    <div className="create-group-cta">
      <div className="create-group-cta-icon">
        <Rocket size={20} />
      </div>

      <div className="create-group-cta-text">
        <strong>Comece a criar o seu grupo agora</strong>
        <span>
          Você disse que quer criar um grupo. Em poucos minutos ele fica pronto para os
          membros entrarem.
        </span>
      </div>

      <Link to="/dashboard/my-groups/create" className="create-group-cta-button">
        Criar meu grupo
      </Link>

      <button
        type="button"
        className="create-group-cta-close"
        onClick={fechar}
        aria-label="Fechar aviso"
      >
        <X size={16} />
      </button>
    </div>
  );
}
