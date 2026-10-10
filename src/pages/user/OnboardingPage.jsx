import { Navigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
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

  if (loading) {
    return (
      <div className="onboarding-page-loading">
        <Loader2 size={32} className="spin" />
      </div>
    );
  }

  // Já respondeu antes: não faz sentido mostrar de novo.
  if (profile?.onboarding_completed_at) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="onboarding-page">
      <OnboardingFlow />
    </div>
  );
}