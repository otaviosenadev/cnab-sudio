import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

// ------------------------------------------------------------------ tema

export type ThemePref = 'system' | 'light' | 'dark';
const THEME_KEY = 'cnab-studio:theme';

function readTheme(): ThemePref {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function applyTheme(t: ThemePref) {
  const root = document.documentElement;
  if (t === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', t);
}

export function useTheme(): [ThemePref, () => void] {
  const [theme, setTheme] = useState<ThemePref>(readTheme);
  useEffect(() => {
    applyTheme(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* sem armazenamento */
    }
  }, [theme]);
  const cycle = useCallback(() => setTheme((t) => (t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system')), []);
  return [theme, cycle];
}

// ------------------------------------------------------------------ toast

let toastMsg: { text: string; id: number } | null = null;
const toastListeners = new Set<() => void>();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

export function toast(text: string) {
  toastMsg = { text, id: Date.now() };
  toastListeners.forEach((l) => l());
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastMsg = null;
    toastListeners.forEach((l) => l());
  }, 2200);
}

export function useToast() {
  return useSyncExternalStore(
    (fn) => {
      toastListeners.add(fn);
      return () => toastListeners.delete(fn);
    },
    () => toastMsg,
  );
}

// ------------------------------------------------------------------ utilidades

export function useClickOutside<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);
  return ref;
}

export function usePersistentNumber(key: string, initial: number): [number, (n: number) => void] {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(key);
      const n = s ? Number(s) : NaN;
      return Number.isFinite(n) ? n : initial;
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (n: number) => {
      setV(n);
      try {
        localStorage.setItem(key, String(n));
      } catch {
        /* sem armazenamento */
      }
    },
    [key],
  );
  return [v, set];
}
