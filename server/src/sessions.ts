import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import type { Draft } from '../../src/cnab/draft';

export interface Session {
  id: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  draft?: Draft;
  busy: boolean;
  lastUsed: number;
}

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_SESSIONS = 200;
const sessions = new Map<string, Session>();

export function createSession(): Session {
  if (sessions.size >= MAX_SESSIONS) {
    const oldest = [...sessions.values()].sort((a, b) => a.lastUsed - b.lastUsed)[0];
    if (oldest) sessions.delete(oldest.id);
  }
  const s: Session = { id: randomUUID(), messages: [], busy: false, lastUsed: Date.now() };
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string): Session | undefined {
  const s = sessions.get(id);
  if (s) s.lastUsed = Date.now();
  return s;
}

export function deleteSession(id: string) {
  sessions.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (!s.busy && now - s.lastUsed > TTL_MS) sessions.delete(id);
}, 10 * 60 * 1000).unref();
