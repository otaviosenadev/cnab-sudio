import type { FieldSpec, RecordSpec } from './types';
import {
  canonicalDoc,
  cnabDateToIso,
  formatBRL,
  formatCep,
  formatCents,
  formatDecimal,
  formatDoc,
  formatIsoBR,
  normalizeText,
  onlyDigits,
} from './format';

export const width = (f: FieldSpec) => f.end - f.start + 1;

export function getRaw(line: string, f: FieldSpec): string {
  return line.slice(f.start - 1, f.end);
}

export function setRaw(line: string, f: FieldSpec, raw: string): string {
  const w = width(f);
  const value = raw.length === w ? raw : raw.padEnd(w, ' ').slice(0, w);
  return line.slice(0, f.start - 1) + value + line.slice(f.end);
}

export function isEmptyRaw(f: FieldSpec, raw: string): boolean {
  if (f.kind === 'num') return /^[0\s]*$/.test(raw);
  return raw.trim() === '';
}

/** Valor "vazio" do campo, conforme regras do layout (zeros ou brancos). */
export function emptyRaw(f: FieldSpec): string {
  return (f.kind === 'num' ? '0' : ' ').repeat(width(f));
}

/**
 * Converte um valor lógico (o que o usuário digita / o que se transfere entre registros)
 * para o texto posicional do campo, com alinhamento e preenchimento do layout.
 */
export function encode(f: FieldSpec, logical: string): string {
  const w = width(f);
  if (f.fixed !== undefined) return f.fixed.padEnd(w, ' ').slice(0, w);

  if (f.input === 'doc15') {
    const d = canonicalDoc(logical);
    let v = '';
    if (d.length === 14) v = `0${d}`;
    else if (d.length === 11) v = `${d.slice(0, 9)}0000${d.slice(9)}`;
    return v.padStart(w, '0').slice(-w);
  }

  if (f.kind === 'num') {
    let digits = onlyDigits(logical);
    if (f.cpfSpaces) {
      const d = canonicalDoc(digits);
      if (d.length === 11) return d.padStart(w, ' ');
      digits = d;
    }
    if (!digits) return '0'.repeat(w);
    return digits.padStart(w, '0').slice(-w);
  }

  const text = normalizeText(logical, f.keepCase);
  return text.padEnd(w, ' ').slice(0, w);
}

/** Inverso de encode: valor lógico canônico, usado para copiar dados entre registros. */
export function toLogical(f: FieldSpec, raw: string): string {
  if (f.input === 'doc15') {
    const d = onlyDigits(raw);
    if (!d || /^0+$/.test(d)) return '';
    if (d.length === 15 && d.slice(9, 13) === '0000') return d.slice(0, 9) + d.slice(13);
    return d.slice(1);
  }
  if (f.kind === 'num') {
    if (f.input === 'doc') return canonicalDoc(raw);
    const d = raw.replace(/\s/g, '');
    return /^0*$/.test(d) ? '' : d.replace(/^0+(?=\d)/, '');
  }
  return raw.replace(/\s+$/, '');
}

export function optionLabel(f: FieldSpec, raw: string): string | undefined {
  const v = raw.trim();
  return f.options?.find((o) => o.value === v || o.value === raw)?.label;
}

/** Leitura humana do conteúdo (coluna "Leitura" do inspetor). */
export function readable(f: FieldSpec, raw: string): string {
  if (f.options) {
    const label = optionLabel(f, raw);
    if (label) return label;
    return isEmptyRaw(f, raw) ? '' : 'código não documentado';
  }
  if (isEmptyRaw(f, raw)) return '';
  switch (f.input) {
    case 'money':
      return formatBRL(onlyDigits(raw));
    case 'decimal':
      return formatDecimal(raw, f.decimals ?? 2);
    case 'date6':
    case 'date8': {
      const iso = cnabDateToIso(raw);
      return iso ? formatIsoBR(iso) : 'data inválida';
    }
    case 'time6':
      return `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
    case 'doc':
    case 'doc15':
      return formatDoc(toLogical(f, raw));
    case 'cep':
      return formatCep(raw);
    default:
      if (f.kind === 'num' && f.decimals) return formatCents(raw, f.decimals);
      return '';
  }
}

export function defaultRaw(f: FieldSpec): string {
  if (f.fixed !== undefined) return encode(f, f.fixed);
  if (f.def !== undefined) {
    const v = typeof f.def === 'function' ? f.def() : f.def;
    return encode(f, v);
  }
  return f.kind === 'num' ? '0'.repeat(width(f)) : ' '.repeat(width(f));
}

export function blankLine(spec: RecordSpec, length: number): string {
  let line = ' '.repeat(length);
  for (const f of spec.fields) line = setRaw(line, f, defaultRaw(f));
  return line;
}

export function fieldById(spec: RecordSpec, id: string): FieldSpec | undefined {
  return spec.fields.find((f) => f.id === id);
}
