import type { FieldOption, FieldSpec, RecordInstance } from './types';
import { setRaw, width } from './codec';

type Opts = Partial<Omit<FieldSpec, 'id' | 'label' | 'start' | 'end'>>;

export const num = (id: string, label: string, start: number, end: number, o: Opts = {}): FieldSpec => ({
  id,
  label,
  start,
  end,
  kind: 'num',
  input: 'int',
  group: 'titulo',
  ...o,
});

export const alfa = (id: string, label: string, start: number, end: number, o: Opts = {}): FieldSpec => ({
  id,
  label,
  start,
  end,
  kind: 'alfa',
  input: 'text',
  group: 'titulo',
  ...o,
});

export const money = (id: string, label: string, start: number, end: number, o: Opts = {}) =>
  num(id, label, start, end, { input: 'money', decimals: 2, ...o });

export const decimal = (id: string, label: string, start: number, end: number, decimals: number, o: Opts = {}) =>
  num(id, label, start, end, { input: 'decimal', decimals, ...o });

export const date6 = (id: string, label: string, start: number, end: number, o: Opts = {}) =>
  num(id, label, start, end, { input: 'date6', ...o });

export const date8 = (id: string, label: string, start: number, end: number, o: Opts = {}) =>
  num(id, label, start, end, { input: 'date8', ...o });

export const pick = (
  id: string,
  label: string,
  start: number,
  end: number,
  options: FieldOption[],
  o: Opts = {},
): FieldSpec => ({
  id,
  label,
  start,
  end,
  kind: 'num',
  input: 'enum',
  group: 'titulo',
  options,
  ...o,
});

export const fixed = (id: string, label: string, start: number, end: number, value: string, kind: 'num' | 'alfa' = 'num'): FieldSpec => ({
  id,
  label,
  start,
  end,
  kind,
  fixed: value,
  group: 'control',
});

export const blank = (start: number, end: number, kind: 'num' | 'alfa' = 'alfa', label = 'Branco'): FieldSpec => ({
  id: `_${start}`,
  label,
  start,
  end,
  kind,
  blank: true,
  group: 'control',
});

export const seq = (start: number, end: number, label = 'Nº sequencial do registro'): FieldSpec =>
  num('seq', label, start, end, { auto: true, group: 'control' });

export function opts(pairs: Record<string, string>): FieldOption[] {
  return Object.entries(pairs).map(([value, label]) => ({ value, label }));
}

/** Escreve um número em um campo automático, ignorando se o campo não existir. */
export function writeAuto(rec: RecordInstance, f: FieldSpec | undefined, n: number | string) {
  if (!f) return;
  const w = width(f);
  rec.raw = setRaw(rec.raw, f, String(n).padStart(w, '0').slice(-w));
}
