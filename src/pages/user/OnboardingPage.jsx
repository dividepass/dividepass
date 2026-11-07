import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import OnboardingFlow from '../../components/OnboardingFlow';
import './OnboardingPage.css';

/**
 * Página dedicada do onboarding.
 *
 * Fica fora do bloco /dashboard de propósito: sem cabeçalho, sem menu, sem
 * nada que dê para o usuário escapar antes de responder. O UserLayout
 * redireciona para cá enquanto onboarding_completed_at estiver nulo.
 */
export default function OnboardingPage() {
  const { profile, loading } = useAuth();
  /* O fluxo avisa quando terminou. Sem isso, o refresh do perfil (que acontece
     no "Concluir") já trazia onboarding_completed_at preenchido e esta página
     redirecionava para o dashboard ANTES da tela de "Tudo pronto!" — o
     usuário nunca via a confirmação de que as respostas foram salvas. */
  const [finished, setFinished] = useState(false);

  if (loading) {
    return (
      <div className="onboarding-page-loading">
        <Loader2 size={32} className="spin" />
      </div>
    );
  }

  // Já respondeu antes: não faz sentido mostrar de novo.
  if (profile?.onboarding_completed_at && !finished) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="onboarding-page">
      <OnboardingFlow onFinished={() => setFinished(true)} />
    </div>
  );
}