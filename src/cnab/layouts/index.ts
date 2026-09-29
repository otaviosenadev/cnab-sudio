import type { LayoutId, LayoutSpec } from '../types';
import { fidc444 } from './fidc444';
import { cobranca444 } from './cobranca444';
import { cobranca240 } from './cobranca240';

export const LAYOUTS: LayoutSpec[] = [fidc444, cobranca444, cobranca240];

export function getLayout(id: LayoutId): LayoutSpec {
  const l = LAYOUTS.find((x) => x.id === id);
  if (!l) throw new Error(`Layout desconhecido: ${id}`);
  return l;
}

export { fidc444, cobranca444, cobranca240 };
