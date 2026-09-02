import { useState, useEffect } from 'react';
import { Sun, Moon } from 'lucide-react';
import { getSystemTheme, getStoredTheme, applyTheme } from '../lib/themeUtils';

export default function ThemeToggle({ className = '' }) {
  const [theme, setTheme] = useState(() => {
    return getStoredTheme() || getSystemTheme();
  });

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e) => {
      if (!getStoredTheme()) {
        const newTheme = e.matches ? 'dark' : 'light';
        setTheme(newTheme);
      }
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggle = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  return (
    <button
      onClick={toggle}
      className={`theme-toggle ${className}`}
      title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
      aria-label={theme === 'dark' ? 'Alternar para modo claro' : 'Alternar para modo escuro'}
    >
      {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
