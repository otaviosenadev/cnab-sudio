import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import type { CnabDoc, FieldRef, Issue, LayoutSpec, Titulo } from '../cnab/types';
import { getLayout } from '../cnab/layouts';
import { classify, finalizeDoc, validate, type Classification } from '../cnab/document';
import { groupTitulos, specOf } from '../cnab/records';
import { link } from './link';

// ------------------------------------------------------------------ histórico

interface History {
  doc: CnabDoc | null;
  past: CnabDoc[];
  future: CnabDoc[];
  lastKey: string | null;
  lastAt: number;
}

type EditFn = (doc: CnabDoc, layout: LayoutSpec) => CnabDoc;

type Action =
  | { type: 'load'; doc: CnabDoc }
  | { type: 'close' }
  | { type: 'edit'; key: string; fn: EditFn }
  | { type: 'undo' }
  | { type: 'redo' };

const LIMIT = 200;

function reducer(state: History, action: Action): History {
  switch (action.type) {
    case 'load': {
      const layout = getLayout(action.doc.layoutId);
      return { doc: finalizeDoc(action.doc, layout), past: [], future: [], lastKey: null, lastAt: 0 };
    }
    case 'close':
      return { doc: null, past: [], future: [], lastKey: null, lastAt: 0 };
    case 'edit': {
      if (!state.doc) return state;
      const layout = getLayout(state.doc.layoutId);
      const next = finalizeDoc(action.fn(state.doc, layout), layout);
      if (next === state.doc) return state;
      const now = Date.now();
      const coalesce = action.key === state.lastKey && now - state.lastAt < 1200;
      return {
        doc: next,
        past: coalesce ? state.past : [...state.past, state.doc].slice(-LIMIT),
        future: [],
        lastKey: action.key,
        lastAt: now,
      };
    }
    case 'undo': {
      const prev = state.past[state.past.length - 1];
      if (!prev || !state.doc) return state;
      return { doc: prev, past: state.past.slice(0, -1), future: [state.doc, ...state.future], lastKey: null, lastAt: 0 };
    }
    case 'redo': {
      const [next, ...rest] = state.future;
      if (!next || !state.doc) return state;
      return { doc: next, past: [...state.past, state.doc], future: rest, lastKey: null, lastAt: 0 };
    }
  }
}

// ------------------------------------------------------------------ contexto

export interface UiState {
  openTitulo: string | null;
  openSacado: string | null;
  more: Record<string, boolean>;
}

interface EditorContextValue {
  doc: CnabDoc;
  layout: LayoutSpec;
  titulos: Titulo[];
  issues: Issue[];
  issuesByRef: Map<string, Issue[]>;
  issuesByUid: Map<string, Issue[]>;
  classification: Classification;
  canUndo: boolean;
  canRedo: boolean;
  edit: (key: string, fn: EditFn) => void;
  /** Documento mais recente (para handlers memoizados). */
  getDoc: () => CnabDoc;
  undo: () => void;
  redo: () => void;
  load: (doc: CnabDoc) => void;
  close: () => void;
  ui: UiState;
  setUi: (patch: Partial<UiState> | ((ui: UiState) => Partial<UiState>)) => void;
  locate: (ref: FieldRef) => void;
  /** Rola e foca um elemento do formulário assim que ele existir. */
  focusDom: (id: string) => void;
}

const EditorContext = createContext<EditorContextValue | null>(null);

interface ShellContextValue {
  doc: CnabDoc | null;
  load: (doc: CnabDoc) => void;
  close: () => void;
}
const ShellContext = createContext<ShellContextValue | null>(null);

const DRAFT_KEY = 'cnab-studio:draft';

export const shareDomId = (key: string) => `shr-${key.replace(/\./g, '-')}`;

export function loadDraft(): CnabDoc | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const doc = JSON.parse(raw) as CnabDoc;
    getLayout(doc.layoutId);
    return doc.records?.length ? doc : null;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* sem armazenamento */
  }
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [history, dispatch] = useReducer(reducer, { doc: null, past: [], future: [], lastKey: null, lastAt: 0 });
  const [ui, setUiState] = useState<UiState>({ openTitulo: null, openSacado: null, more: {} });
  const [pendingFocus, setPendingFocus] = useState<{ id: string; n: number } | null>(null);
  const docRef = useRef(history.doc);
  docRef.current = history.doc;
  const getDoc = useCallback(() => docRef.current!, []);
  const edit = useCallback((key: string, fn: EditFn) => dispatch({ type: 'edit', key, fn }), []);

  const load = useCallback((doc: CnabDoc) => {
    link.reset();
    dispatch({ type: 'load', doc });
    const layout = getLayout(doc.layoutId);
    const first = groupTitulos(layout, doc.records)[0];
    setUiState({ openTitulo: first?.uid ?? null, openSacado: null, more: {} });
  }, []);
  const close = useCallback(() => {
    link.reset();
    clearDraft();
    dispatch({ type: 'close' });
  }, []);

  // Rascunho automático.
  useEffect(() => {
    if (!history.doc) return;
    const t = setTimeout(() => {
      try {
        const { sourceText: _s, ...rest } = history.doc!;
        localStorage.setItem(DRAFT_KEY, JSON.stringify(rest));
      } catch {
        /* armazenamento indisponível */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [history.doc]);

  // Foco pendente: espera o elemento existir (título expandido etc.).
  useEffect(() => {
    if (!pendingFocus) return;
    let frames = 0;
    let raf = 0;
    const tick = () => {
      const el = document.getElementById(pendingFocus.id);
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        const input = (el.matches('input,select,textarea') ? el : el.querySelector('input,select,textarea')) as HTMLElement | null;
        input?.focus({ preventScroll: true });
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
        return;
      }
      if (frames++ < 20) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [pendingFocus]);

  const shell = useMemo(() => ({ doc: history.doc, load, close }), [history.doc, load, close]);

  const derived = useMemo(() => {
    const doc = history.doc;
    if (!doc) return null;
    const layout = getLayout(doc.layoutId);
    const titulos = groupTitulos(layout, doc.records);
    const issues = validate(doc, layout);
    const issuesByRef = new Map<string, Issue[]>();
    const issuesByUid = new Map<string, Issue[]>();
    for (const i of issues) {
      if (i.uid) {
        const list = issuesByUid.get(i.uid) ?? [];
        list.push(i);
        issuesByUid.set(i.uid, list);
      }
      if (i.uid && i.field) {
        const k = `${i.uid}:${i.field}`;
        const list = issuesByRef.get(k) ?? [];
        list.push(i);
        issuesByRef.set(k, list);
      }
    }
    return { doc, layout, titulos, issues, issuesByRef, issuesByUid, classification: classify(layout, titulos) };
  }, [history.doc]);

  const value = useMemo<EditorContextValue | null>(() => {
    if (!derived) return null;
    const { doc, layout, titulos } = derived;
    const setUi: EditorContextValue['setUi'] = (patch) =>
      setUiState((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) }));

    const locate = (ref: FieldRef) => {
      const rec = doc.records.find((r) => r.uid === ref.uid);
      if (!rec) return;
      const f = specOf(layout, rec.type).fields.find((x) => x.id === ref.field);
      if (!f || f.fixed !== undefined || f.blank || f.auto || f.group === 'control') return;
      if (f.group === 'cedente') {
        if (f.more) setUi((u) => ({ more: { ...u.more, cedente: true } }));
        setPendingFocus({ id: shareDomId(f.share!), n: Date.now() });
        return;
      }
      if (f.group === 'arquivo') {
        if (f.more) setUi((u) => ({ more: { ...u.more, arquivo: true } }));
        setPendingFocus({ id: f.share ? shareDomId(f.share) : `fld-${rec.uid}-${f.id}`, n: Date.now() });
        return;
      }
      const t = titulos.find((x) => x.primary.uid === rec.uid || x.children.some((c) => c.uid === rec.uid));
      if (!t) return;
      setUi((u) => ({
        openTitulo: t.uid,
        more: f.more && f.group === 'titulo' ? { ...u.more, [`rec:${rec.uid}`]: true } : u.more,
      }));
      setPendingFocus({ id: `fld-${rec.uid}-${f.id}`, n: Date.now() });
    };

    return {
      ...derived,
      canUndo: history.past.length > 0,
      canRedo: history.future.length > 0,
      edit,
      getDoc,
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      load,
      close,
      ui,
      setUi,
      locate,
      focusDom: (id: string) => setPendingFocus({ id, n: Date.now() }),
    };
  }, [derived, history.past.length, history.future.length, ui, load, close, edit, getDoc]);

  return (
    <ShellContext.Provider value={shell}>
      {value ? <EditorContext.Provider value={value}>{children}</EditorContext.Provider> : children}
    </ShellContext.Provider>
  );
}

export function useEditor(): EditorContextValue {
  const ctx = useContext(EditorContext);
  if (!ctx) throw new Error('useEditor fora do EditorProvider');
  return ctx;
}

export function useShell(): ShellContextValue {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell fora do EditorProvider');
  return ctx;
}
