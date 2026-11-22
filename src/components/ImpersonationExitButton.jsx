import { useLocation } from 'react-router-dom';
import { Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

/**
 * Saída da impersonação para telas FORA do painel do cliente.
 *
 * Dentro de `/dashboard` quem está impersonando usa o ícone amarelo do
 * menu lateral (gaveta no mobile, barra fixa no desktop) — ali o card
 * flutuante antigo só atrapalhava, cobrindo botões.
 *
 * Aqui (onboarding, gate de avatar, home, login) não existe menu do
 * cliente, então este botão pequeno no canto da tela é a única forma de o
 * admin voltar ao painel. Sem ele o admin ficaria preso na conta do
 * cliente: a sessão do navegador é a do cliente e o `/admin` rejeita o
 * acesso. O z-index fica acima do gate de avatar (700) por isso.
 */
export default function ImpersonationExitButton() {
  const { impersonating, impersonation, returnToAdmin, restoringAdmin } = useAuth();
  const location = useLocation();

  // Dentro do painel do cliente o ícone do menu já resolve.
  if (!impersonating || location.pathname.startsWith('/dashboard')) return null;

  const rotulo = impersonation?.orfa ? 'Entrar como admin' : 'Voltar ao painel admin';
  const alvo = impersonation?.target_name || impersonation?.target_email;

  return (
    <button
      type="button"
      onClick={returnToAdmin}
      disabled={restoringAdmin}
      aria-label={rotulo}
      title={alvo ? `${rotulo} — você está como ${alvo}` : rotulo}
      className="fixed bottom-4 right-4 z-[800] flex size-11 items-center justify-center rounded-full border border-warning/50 bg-warning text-warning-foreground shadow-lg transition-opacity hover:opacity-90 disabled:opacity-60"
    >
      {restoringAdmin ? (
        <Loader2 size={20} className="animate-spin" aria-hidden="true" />
      ) : (
        <ShieldCheck size={20} aria-hidden="true" />
      )}
    </button>
  );
}
