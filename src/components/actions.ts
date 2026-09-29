import { createContext, useContext } from 'react';
import type { LayoutId } from '../cnab/types';

export interface FileActions {
  openPicker: () => void;
  importFile: (file: File) => void;
  createNew: (layoutId: LayoutId, ocorrencia: string) => void;
  openSample: (layoutId: LayoutId) => void;
  showNewDialog: () => void;
  switchLayout: (layoutId: LayoutId) => void;
}

export const ActionsContext = createContext<FileActions | null>(null);

export function useActions(): FileActions {
  const ctx = useContext(ActionsContext);
  if (!ctx) throw new Error('useActions fora do provider');
  return ctx;
}
