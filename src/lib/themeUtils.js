export function getSystemTheme() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'dark';
}

export function getStoredTheme() {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('dp-theme');
  }
  return null;
}

export const THEME_CHANGE_EVENT = 'dp-theme-change';

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('dp-theme', theme);
  // Avisa quem reage ao tema (toasts, graficos, icone de sol/lua) sem
  // precisar que todos compartilhem o mesmo estado do React.
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
  }
}
