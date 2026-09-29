/** Utilitários de texto, datas, valores e documentos (CPF/CNPJ). */

export function normalizeText(value: string, keepCase = false): string {
  const noAccents = value.normalize('NFD').replace(/[̀-ͯ]/g, '');
  const cased = keepCase ? noAccents : noAccents.toUpperCase();
  // CNAB aceita apenas ASCII imprimível; caracteres especiais viram espaço.
  return cased.replace(/[^\x20-\x7E]/g, ' ');
}

export const onlyDigits = (v: string) => v.replace(/\D/g, '');

// ---------------------------------------------------------------- valores

const brl = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "15184026" (centavos) -> "151.840,26" */
export function formatCents(cents: string | number | bigint, decimals = 2): string {
  const digits = typeof cents === 'string' ? onlyDigits(cents) || '0' : String(cents);
  const n = BigInt(digits);
  const base = 10n ** BigInt(decimals);
  const int = n / base;
  const frac = (n % base).toString().padStart(decimals, '0');
  const intFmt = int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return decimals > 0 ? `${intFmt},${frac}` : intFmt;
}

export function formatBRL(cents: string | number | bigint): string {
  return `R$ ${formatCents(cents)}`;
}

export function formatNumber(n: number): string {
  return brl.format(n);
}

/** Converte "1,5" em inteiro escalado: decimals=7 -> "15000000". */
export function parseDecimal(input: string, decimals: number): string {
  const clean = input.replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  if (!clean) return '';
  const [int = '0', frac = ''] = clean.split('.');
  const scaled = (int.replace(/^0+/, '') || '0') + frac.padEnd(decimals, '0').slice(0, decimals);
  return scaled.replace(/^0+(?=\d)/, '');
}

export function formatDecimal(raw: string, decimals: number): string {
  const digits = onlyDigits(raw);
  if (!digits || /^0+$/.test(digits)) return '';
  const padded = digits.padStart(decimals + 1, '0');
  const int = padded.slice(0, padded.length - decimals).replace(/^0+(?=\d)/, '');
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, '');
  return frac ? `${int},${frac}` : int;
}

// ---------------------------------------------------------------- datas

/** DDMMAA ou DDMMAAAA -> ISO (yyyy-mm-dd) ou null se vazio/inválido. */
export function cnabDateToIso(raw: string): string | null {
  const d = onlyDigits(raw);
  if (!d || /^0+$/.test(d)) return null;
  let day: number, month: number, year: number;
  if (raw.length === 6 && d.length === 6) {
    day = +d.slice(0, 2);
    month = +d.slice(2, 4);
    const yy = +d.slice(4, 6);
    year = yy < 70 ? 2000 + yy : 1900 + yy;
  } else if (raw.length === 8 && d.length === 8) {
    day = +d.slice(0, 2);
    month = +d.slice(2, 4);
    year = +d.slice(4, 8);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isoToCnabDate(iso: string, width: 6 | 8): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  if (!y || !m || !d) return '';
  return width === 6 ? `${d}${m}${y.slice(2)}` : `${d}${m}${y}`;
}

export function formatIsoBR(iso: string | null): string {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export function todayIso(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y!, m! - 1, d! + days));
  return date.toISOString().slice(0, 10);
}

export function nowTime6(): string {
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

// ---------------------------------------------------------------- CPF / CNPJ

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  const calc = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += +cpf[i]! * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === +cpf[9]! && calc(10) === +cpf[10]!;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1{13}$/.test(cnpj)) return false;
  const calc = (len: number) => {
    const weights = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    let sum = 0;
    for (let i = 0; i < len; i++) sum += +cnpj[i]! * weights[i]!;
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === +cnpj[12]! && calc(13) === +cnpj[13]!;
}

/** Completa os dígitos verificadores de uma base de CPF (9) ou CNPJ (12). */
export function withCheckDigits(base: string): string {
  const b = onlyDigits(base);
  if (b.length === 9) {
    for (let d1 = 0; d1 <= 9; d1++)
      for (let d2 = 0; d2 <= 9; d2++) if (isValidCpf(`${b}${d1}${d2}`)) return `${b}${d1}${d2}`;
  }
  if (b.length === 12) {
    for (let d1 = 0; d1 <= 9; d1++)
      for (let d2 = 0; d2 <= 9; d2++) if (isValidCnpj(`${b}${d1}${d2}`)) return `${b}${d1}${d2}`;
  }
  return b;
}

/** Normaliza um documento vindo de um campo largo: remove zeros à esquerda excedentes. */
export function canonicalDoc(value: string, hint?: 'cpf' | 'cnpj'): string {
  const d = onlyDigits(value);
  if (!d || /^0+$/.test(d)) return '';
  if (hint === 'cpf') return d.slice(-11).padStart(11, '0');
  if (hint === 'cnpj') return d.slice(-14).padStart(14, '0');
  const stripped = d.replace(/^0+/, '');
  if (stripped.length <= 11) {
    const cpf = stripped.padStart(11, '0');
    const cnpj = stripped.padStart(14, '0');
    if (isValidCpf(cpf)) return cpf;
    if (isValidCnpj(cnpj)) return cnpj;
    return cpf;
  }
  return stripped.padStart(14, '0').slice(-14);
}

export function formatDoc(value: string, hint?: 'cpf' | 'cnpj'): string {
  const d = canonicalDoc(value, hint);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return d;
}

/** Máscara progressiva enquanto o usuário digita. */
export function maskDocInput(value: string): string {
  const d = onlyDigits(value).slice(0, 14);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  }
  return d
    .replace(/^(\d{2})(\d)/, '$1.$2')
    .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2');
}

export function docKind(value: string): 'cpf' | 'cnpj' | null {
  const d = canonicalDoc(value);
  if (d.length === 11) return 'cpf';
  if (d.length === 14) return 'cnpj';
  return null;
}

export function formatCep(value: string): string {
  const d = onlyDigits(value);
  if (!d || /^0+$/.test(d)) return '';
  const p = d.padStart(8, '0');
  return `${p.slice(0, 5)}-${p.slice(5)}`;
}

/** Módulo 11 base 7 (DV do nosso número): carteira(2) + nosso número(11). */
export function nossoNumeroDv(carteira: string, nossoNumero: string): string {
  const s = onlyDigits(carteira).slice(-2).padStart(2, '0') + onlyDigits(nossoNumero).padStart(11, '0');
  let sum = 0;
  let w = 2;
  for (let i = s.length - 1; i >= 0; i--) {
    sum += +s[i]! * w;
    w = w === 7 ? 2 : w + 1;
  }
  const r = sum % 11;
  if (r === 0) return '0';
  if (r === 1) return 'P';
  return String(11 - r);
}
