import { useSyncExternalStore } from 'react';
import type { FieldRef } from '../cnab/types';

/**
 * Store externo que liga o formulário (esquerda) ao arquivo (direita).
 * Mantido fora do React para que passar o mouse sobre o arquivo re-renderize
 * apenas os campos afetados, e não a árvore inteira.
 */

export type LinkSource = 'form' | 'file' | 'inspector' | null;

export const refKey = (r: FieldRef) => `${r.uid}:${r.field}`;

interface LinkState {
  active: FieldRef[];
  hover: FieldRef[];
  activeKeys: Set<string>;
  hoverKeys: Set<string>;
  activeLines: Set<string>;
  hoverLines: Set<string>;
  source: LinkSource;
  hoverSource: LinkSource;
  selectedUid: string | null;
  version: number;
}

let state: LinkState = {
  active: [],
  hover: [],
  activeKeys: new Set(),
  hoverKeys: new Set(),
  activeLines: new Set(),
  hoverLines: new Set(),
  source: null,
  hoverSource: null,
  selectedUid: null,
  version: 0,
};

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function sameRefs(a: FieldRef[], b: FieldRef[]) {
  return a.length === b.length && a.every((r, i) => r.uid === b[i]!.uid && r.field === b[i]!.field);
}

export const link = {
  get: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  setHover(refs: FieldRef[], source: LinkSource = null) {
    if (sameRefs(refs, state.hover) && source === state.hoverSource) return;
    state = {
      ...state,
      hover: refs,
      hoverSource: source,
      hoverKeys: new Set(refs.map(refKey)),
      hoverLines: new Set(refs.map((r) => r.uid)),
      version: state.version + 1,
    };
    emit();
  },
  setActive(refs: FieldRef[], source: LinkSource, selectUid?: string | null) {
    const selectedUid = selectUid !== undefined ? selectUid : refs[0]?.uid ?? state.selectedUid;
    if (sameRefs(refs, state.active) && source === state.source && selectedUid === state.selectedUid) return;
    state = {
      ...state,
      active: refs,
      activeKeys: new Set(refs.map(refKey)),
      activeLines: new Set(refs.map((r) => r.uid)),
      source,
      selectedUid,
      version: state.version + 1,
    };
    emit();
  },
  select(uid: string | null) {
    if (uid === state.selectedUid) return;
    state = { ...state, selectedUid: uid, version: state.version + 1 };
    emit();
  },
  reset() {
    state = {
      active: [],
      hover: [],
      activeKeys: new Set(),
      hoverKeys: new Set(),
      activeLines: new Set(),
      hoverLines: new Set(),
      source: null,
      hoverSource: null,
      selectedUid: null,
      version: state.version + 1,
    };
    emit();
  },
};

export function useLinkVersion(): LinkState {
  return useSyncExternalStore(link.subscribe, link.get);
}

/** Estado de destaque de um campo do formulário: 'active' | 'hover' | ''. */
export function useFieldLink(key: string): '' | 'active' | 'hover' {
  return useSyncExternalStore(link.subscribe, () => {
    const s = link.get();
    if (s.activeKeys.has(key) && s.source !== 'form') return 'active';
    if (s.hoverKeys.has(key) && s.hoverSource !== 'form') return 'hover';
    return '';
  });
}

export function useSelectedUid(): string | null {
  return useSyncExternalStore(link.subscribe, () => link.get().selectedUid);
}
