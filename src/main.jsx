import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { captureGoogleAdsAttribution } from './lib/googleAds'

// A camada nova (Tailwind v4 + shadcn/ui) entra DEPOIS de todo o CSS legado.
// As utilities do Tailwind vao sem camada: no empate de especificidade com
// uma classe do legado, vence a que vem por ultimo — entao o Tailwind
// sobrepoe o legado, e nao o contrario.
import './styles/shadcn.css'

const stored = localStorage.getItem('dp-theme')
const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches
document.documentElement.setAttribute('data-theme', stored || (systemDark ? 'dark' : 'light'))

captureGoogleAdsAttribution()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
