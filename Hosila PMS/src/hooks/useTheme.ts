import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'hosila_theme';
const THEME_EVENT = 'hosila-theme-change';

function readStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  const saved = window.localStorage.getItem(STORAGE_KEY);
  return saved === 'dark' ? 'dark' : 'light';
}

export function applyThemeClass(theme: ThemeMode): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', theme === 'dark');
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const initial = readStoredTheme();
    applyThemeClass(initial);
    return initial;
  });

  useEffect(() => {
    applyThemeClass(theme);
  }, [theme]);

  useEffect(() => {
    const syncFromExternal = () => {
      const next = readStoredTheme();
      applyThemeClass(next);
      setThemeState(next);
    };
    window.addEventListener(THEME_EVENT, syncFromExternal);
    window.addEventListener('storage', syncFromExternal);
    return () => {
      window.removeEventListener(THEME_EVENT, syncFromExternal);
      window.removeEventListener('storage', syncFromExternal);
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next);
      applyThemeClass(next);
      window.dispatchEvent(new Event(THEME_EVENT));
    }
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
