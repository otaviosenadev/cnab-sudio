import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ApiError,
  createSession,
  getHealth,
  prepareFiles,
  sendMessage,
  type AgentEvent,
  type Delivery,
  type Health,
} from './api';

export type Part =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; label: string; status?: string; ok?: boolean; done: boolean }
  | { type: 'remessa'; delivery: Delivery }
  | { type: 'error'; message: string };

export type ChatItem =
  | { kind: 'user'; id: string; text: string; files: { name: string; size: number }[] }
  | { kind: 'assistant'; id: string; parts: Part[]; streaming: boolean };

type HealthState = { status: 'loading' } | { status: 'offline' } | { status: 'ready'; health: Health };

interface AssistantContextValue {
  open: boolean;
  setOpen: (v: boolean) => void;
  health: HealthState;
  refreshHealth: () => void;
  items: ChatItem[];
  busy: boolean;
  needsCode: boolean;
  accessCode: string;
  setAccessCode: (code: string) => void;
  send: (text: string, files: File[]) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

const Ctx = createContext<AssistantContextValue | null>(null);
const CODE_KEY = 'cnab-studio:access-code';
let idSeq = 0;
const nextId = () => `c${++idSeq}`;

function readCode() {
  try {
    return localStorage.getItem(CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function applyEvent(parts: Part[], e: AgentEvent): Part[] {
  switch (e.type) {
    case 'text': {
      const last = parts[parts.length - 1];
      if (last?.type === 'text') return [...parts.slice(0, -1), { ...last, text: last.text + e.delta }];
      return [...parts, { type: 'text', text: e.delta }];
    }
    case 'tool_start':
      return [...parts, { type: 'tool', id: e.id, name: e.name, label: e.label, done: false }];
    case 'tool_end':
      return parts.map((p) => (p.type === 'tool' && p.id === e.id ? { ...p, status: e.status, ok: e.ok, done: true } : p));
    case 'remessa':
      return [...parts, { type: 'remessa', delivery: e.delivery }];
    case 'error':
      return [...parts, { type: 'error', message: e.message }];
    default:
      return parts;
  }
}

export function AssistantProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState<HealthState>({ status: 'loading' });
  const [items, setItems] = useState<ChatItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [accessCode, setCodeState] = useState(readCode);
  const [needsCode, setNeedsCode] = useState(false);
  const sessionRef = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const refreshHealth = useCallback(() => {
    setHealth({ status: 'loading' });
    getHealth()
      .then((h) => {
        setHealth({ status: 'ready', health: h });
        if (h.accessCode && !readCode()) setNeedsCode(true);
      })
      .catch(() => setHealth({ status: 'offline' }));
  }, []);

  useEffect(() => {
    if (open && health.status === 'loading') refreshHealth();
  }, [open, health.status, refreshHealth]);

  const setAccessCode = useCallback((code: string) => {
    setCodeState(code);
    setNeedsCode(false);
    try {
      localStorage.setItem(CODE_KEY, code);
    } catch {
      /* sem armazenamento */
    }
  }, []);

  const updateLast = (fn: (item: Extract<ChatItem, { kind: 'assistant' }>) => Extract<ChatItem, { kind: 'assistant' }>) =>
    setItems((list) => {
      const last = list[list.length - 1];
      if (!last || last.kind !== 'assistant') return list;
      return [...list.slice(0, -1), fn(last)];
    });

  const send = useCallback(
    async (text: string, files: File[]) => {
      if (busy) return;
      setBusy(true);
      setItems((list) => [
        ...list,
        { kind: 'user', id: nextId(), text, files: files.map((f) => ({ name: f.name, size: f.size })) },
        { kind: 'assistant', id: nextId(), parts: [], streaming: true },
      ]);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const prepared = await prepareFiles(files);
        const attempt = async () => {
          sessionRef.current ??= await createSession(accessCode);
          await sendMessage(
            sessionRef.current,
            { text, files: prepared },
            accessCode,
            (e) => updateLast((a) => ({ ...a, parts: applyEvent(a.parts, e) })),
            controller.signal,
          );
        };
        try {
          await attempt();
        } catch (err) {
          // Conversa expirada no servidor: recomeça uma nova e reenvia.
          if (err instanceof ApiError && err.code === 'session_not_found') {
            sessionRef.current = null;
            await attempt();
          } else throw err;
        }
      } catch (err) {
        if (controller.signal.aborted) {
          updateLast((a) => ({ ...a, parts: applyEvent(a.parts, { type: 'error', message: 'Resposta interrompida.' }) }));
        } else {
          if (err instanceof ApiError && err.code === 'access_code') setNeedsCode(true);
          const message = err instanceof Error ? err.message : 'Erro inesperado.';
          updateLast((a) => ({ ...a, parts: applyEvent(a.parts, { type: 'error', message }) }));
        }
      } finally {
        updateLast((a) => ({ ...a, streaming: false }));
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, accessCode],
  );

  const stop = useCallback(() => abortRef.current?.abort(), []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    const id = sessionRef.current;
    sessionRef.current = null;
    setItems([]);
    if (id) fetch(`/api/assistant/sessions/${id}`, { method: 'DELETE', headers: accessCode ? { 'x-access-code': accessCode } : {} }).catch(() => {});
  }, [accessCode]);

  const value = useMemo(
    () => ({ open, setOpen, health, refreshHealth, items, busy, needsCode, accessCode, setAccessCode, send, stop, reset }),
    [open, health, refreshHealth, items, busy, needsCode, accessCode, setAccessCode, send, stop, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAssistant() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAssistant fora do AssistantProvider');
  return ctx;
}
