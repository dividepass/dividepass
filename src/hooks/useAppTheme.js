import { useCallback, useEffect, useState } from 'react'
import { applyTheme, getStoredTheme, getSystemTheme, THEME_CHANGE_EVENT } from '../lib/themeUtils'

/**
 * Tema do app em uma fonte so.
 *
 * O DividePass nao usa a classe `.dark`: o tema vive no atributo
 * `data-theme` da raiz (`dark` | `light`). Como cada tela historicamente
 * guardava o tema em um `useState` local, este hook le do DOM e escuta o
 * evento `dp-theme-change` — assim toasts, graficos e o botao de tema
 * reagem a troca feita em qualquer lugar.
 */

function readCurrentTheme() {
  if (typeof document === 'undefined') return 'dark'
  return (
    document.documentElement.getAttribute('data-theme') ||
    getStoredTheme() ||
    getSystemTheme()
  )
}

export function useAppTheme() {
  const [theme, setThemeState] = useState(readCurrentTheme)

  useEffect(() => {
    const onChange = (event) => {
      setThemeState(event.detail?.theme || readCurrentTheme())
    }
    window.addEventListener(THEME_CHANGE_EVENT, onChange)
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }, [])

  const setTheme = useCallback((next) => {
    applyTheme(next)
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setTheme(readCurrentTheme() === 'dark' ? 'light' : 'dark')
  }, [setTheme])

  return { theme, setTheme, toggleTheme }
}
