import type { FieldSpec, LayoutSpec, RecordInstance, RecordSpec, Titulo } from './types';
import { fieldById, getRaw } from './codec';

const specCache = new WeakMap<LayoutSpec, Map<string, RecordSpec>>();

export function specOf(layout: LayoutSpec, type: string): RecordSpec {
  let map = specCache.get(layout);
  if (!map) {
    map = new Map(layout.records.map((r) => [r.id, r]));
    specCache.set(layout, map);
  }
  return map.get(type) ?? unknownSpec(layout);
}

const unknownCache = new WeakMap<LayoutSpec, RecordSpec>();
export function unknownSpec(layout: LayoutSpec): RecordSpec {
  let s = unknownCache.get(layout);
  if (!s) {
    s = {
      id: '__unknown',
      label: 'Registro não reconhecido',
      short: '?',
      role: 'unknown',
      match: () => false,
      fields: [
        {
          id: 'conteudo',
          label: 'Conteúdo da linha',
          start: 1,
          end: layout.lineLength,
          kind: 'alfa',
          input: 'text',
          group: 'control',
        },
      ],
    };
    unknownCache.set(layout, s);
  }
  return s;
}

export function fieldOf(layout: LayoutSpec, rec: RecordInstance, id: string): FieldSpec | undefined {
  return fieldById(specOf(layout, rec.type), id);
}

export function rawOf(layout: LayoutSpec, rec: RecordInstance, id: string): string {
  const f = fieldOf(layout, rec, id);
  return f ? getRaw(rec.raw, f) : '';
}

export function groupTitulos(layout: LayoutSpec, records: RecordInstance[]): Titulo[] {
  const out: Titulo[] = [];
  let current: Titulo | null = null;
  for (const rec of records) {
    const role = specOf(layout, rec.type).role;
    if (role === 'detail') {
      current = { uid: rec.uid, index: out.length, primary: rec, children: [] };
      out.push(current);
    } else if (role === 'child' && current) {
      current.children.push(rec);
    } else {
      current = null;
    }
  }
  return out;
}

export function tituloRecords(t: Titulo): RecordInstance[] {
  return [t.primary, ...t.children];
}

let counter = 0;
export function newUid(): string {
  counter += 1;
  return `r${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
