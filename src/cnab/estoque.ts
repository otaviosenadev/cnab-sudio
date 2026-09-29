/**
 * Estoque de títulos → remessa de baixa (CNAB 444 FIDC).
 * Lê tabelas exportadas pelo custodiante (CSV, Excel ou linhas coladas), reconhece as colunas
 * pelos nomes e monta a remessa com o mesmo motor do editor.
 */
import type { CnabDoc, FieldSpec, RecordInstance } from './types';
import { fidc444 } from './layouts';
import { encode, setRaw } from './codec';
import { createDocument, finalizeDoc, insertTitulo, newTituloRecords, removeTitulo } from './document';
import { groupTitulos, specOf } from './records';
import { canonicalDoc, docKind, isoToCnabDate, normalizeText, onlyDigits } from './format';

// ------------------------------------------------------------------ tabela

export interface Table {
  headers: string[];
  rows: string[][];
}

/** Detecta o separador pela linha de cabeçalho. */
function detectDelimiter(line: string): string {
  const counts = [';', '\t', ',', '|'].map((d) => [d, line.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ';';
}

/** CSV/TSV com suporte a aspas. */
export function parseDelimited(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const d = detectDelimiter(firstLine);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i]!;
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === d) {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && clean[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/** Escolhe a linha de cabeçalho (a primeira com mais colunas reconhecidas) e monta a tabela. */
export function toTable(matrix: string[][]): Table {
  let headerIdx = 0;
  let best = -1;
  matrix.slice(0, 15).forEach((r, i) => {
    const score = r.filter((h) => matchColumn(h) !== null).length;
    if (score > best) [best, headerIdx] = [score, i];
  });
  const headers = (matrix[headerIdx] ?? []).map((h) => String(h ?? '').trim());
  const rows = matrix
    .slice(headerIdx + 1)
    .map((r) => headers.map((_, i) => String(r[i] ?? '').trim()))
    .filter((r) => r.some((v) => v !== ''));
  return { headers, rows };
}

export function decodeBytes(buf: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8').decode(buf);
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(buf) : utf8;
}

// ------------------------------------------------------------------ colunas

export type ColumnKey =
  | 'seuNumero'
  | 'numDocumento'
  | 'sacadoNome'
  | 'sacadoDoc'
  | 'cedenteNome'
  | 'cedenteDoc'
  | 'vencimento'
  | 'emissao'
  | 'valorNominal'
  | 'valorAquisicao'
  | 'valorPresente'
  | 'valorPresenteAtualizado'
  | 'especie'
  | 'coobrigacao'
  | 'chaveNfe'
  | 'nfNumero'
  | 'endereco'
  | 'cep'
  | 'status'
  | 'originadorNome';

export const COLUMNS: { key: ColumnKey; label: string; synonyms: string[]; important?: boolean }[] = [
  { key: 'seuNumero', label: 'Seu número', synonyms: ['seunumero', 'nrcontroleparticipante', 'controleparticipante'], important: true },
  { key: 'numDocumento', label: 'Nº do documento', synonyms: ['numerodocumento', 'nudocumento', 'numdocumento', 'nrdocumento', 'nodocumento', 'documento'], important: true },
  { key: 'sacadoNome', label: 'Sacado', synonyms: ['nomesacado', 'sacado', 'nomepagador', 'pagador', 'nomedevedor'], important: true },
  { key: 'sacadoDoc', label: 'CPF/CNPJ do sacado', synonyms: ['cpfcnpjsacado', 'docsacado', 'cnpjsacado', 'cpfsacado', 'documentosacado'], important: true },
  { key: 'cedenteNome', label: 'Cedente', synonyms: ['nomecedente', 'cedente'], important: true },
  { key: 'cedenteDoc', label: 'CPF/CNPJ do cedente', synonyms: ['cpfcnpjcedente', 'doccedente', 'cnpjcedente'], important: true },
  { key: 'vencimento', label: 'Vencimento', synonyms: ['datavencimentooriginal', 'datavencimento', 'vencimento', 'dtvencimento', 'datavencimentoajustada'], important: true },
  { key: 'emissao', label: 'Emissão', synonyms: ['dataemissaotitulo', 'dataemissao', 'emissao', 'dtemissao'] },
  { key: 'valorNominal', label: 'Valor nominal', synonyms: ['valornominal', 'valorface', 'valortitulo', 'valor'], important: true },
  { key: 'valorAquisicao', label: 'Valor de aquisição', synonyms: ['valoraquisicao'] },
  { key: 'valorPresente', label: 'Valor presente', synonyms: ['valorpresente'] },
  { key: 'valorPresenteAtualizado', label: 'Valor presente atualizado', synonyms: ['valorpresenteatualizado'] },
  { key: 'especie', label: 'Tipo do título', synonyms: ['tipotitulo', 'tiporecebivel', 'especie', 'especietitulo'] },
  { key: 'coobrigacao', label: 'Coobrigação', synonyms: ['coobrigacao'] },
  { key: 'chaveNfe', label: 'Chave da NF-e', synonyms: ['chavenfe', 'nfe', 'chavenota', 'chaveacesso'] },
  { key: 'nfNumero', label: 'Nº da nota fiscal', synonyms: ['nuduplicata', 'numeronf', 'notafiscal', 'numeronotafiscal'] },
  { key: 'endereco', label: 'Endereço do sacado', synonyms: ['endereco', 'enderecosacado'] },
  { key: 'cep', label: 'CEP do sacado', synonyms: ['cep', 'cepsacado'] },
  { key: 'status', label: 'Situação', synonyms: ['situacaorecebivel', 'statusrecebivel', 'situacao', 'status'] },
  { key: 'originadorNome', label: 'Originador', synonyms: ['nomeoriginador', 'originador'] },
];

const normHeader = (h: string) =>
  h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

function matchColumn(header: string): ColumnKey | null {
  const n = normHeader(header);
  if (!n) return null;
  for (const c of COLUMNS) if (c.synonyms.includes(n)) return c.key;
  return null;
}

export type ColumnMap = Partial<Record<ColumnKey, number>>;

/** Mapeia cada campo para a coluna de maior prioridade entre os sinônimos. */
export function autoMap(headers: string[]): ColumnMap {
  const norm = headers.map(normHeader);
  const map: ColumnMap = {};
  for (const c of COLUMNS) {
    for (const syn of c.synonyms) {
      const idx = norm.indexOf(syn);
      if (idx !== -1 && !Object.values(map).includes(idx)) {
        map[c.key] = idx;
        break;
      }
    }
  }
  return map;
}

// ------------------------------------------------------------------ valores

/** "232.625,06" | "5485.72" | "3957.960408" -> centavos (arredondado). */
export function parseMoney(v: string | undefined): number | null {
  const s = String(v ?? '').replace(/[^\d.,-]/g, '');
  if (!s || !/\d/.test(s)) return null;
  const comma = s.lastIndexOf(',');
  const dot = s.lastIndexOf('.');
  const normalized = comma > dot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number(normalized);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
}

/** "24/08/2026" | "2026-08-24" | "24/08/26" -> ISO, ou null. */
export function parseDate(v: string | undefined): string | null {
  const s = String(v ?? '').trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const y = m[3]!.length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  }
  return null;
}

const ESPECIE_MAP: [RegExp, string][] = [
  [/duplicata/i, '01'],
  [/promiss/i, '02'],
  [/seguro/i, '03'],
  [/cheque/i, '51'],
  [/contrato|cedula|ccb/i, '60'],
];

export function mapEspecie(v: string | undefined): string {
  const s = String(v ?? '').trim();
  const options = fidc444.records.find((r) => r.role === 'detail')!.fields.find((f) => f.id === 'especie')!.options!;
  if (/^\d{1,2}$/.test(s) && options.some((o) => o.value === s.padStart(2, '0'))) return s.padStart(2, '0');
  for (const [re, code] of ESPECIE_MAP) if (re.test(s)) return code;
  return '01';
}

export function mapCoobrigacao(v: string | undefined): string | null {
  const s = normalizeText(String(v ?? '')).trim();
  if (/^(S|SIM|01|1)$/.test(s)) return '01';
  if (/^(N|NAO|02|2)$/.test(s)) return '02';
  return null;
}

// ------------------------------------------------------------------ títulos

export interface EstoqueTitulo {
  index: number;
  seuNumero: string;
  numDocumento: string;
  sacadoNome: string;
  sacadoDoc: string;
  cedenteNome: string;
  cedenteDoc: string;
  vencimento: string | null;
  emissao: string | null;
  valorNominal: number | null;
  valorAquisicao: number | null;
  valorPresente: number | null;
  valorPresenteAtualizado: number | null;
  especie: string;
  coobrigacao: string | null;
  chaveNfe: string;
  nfNumero: string;
  endereco: string;
  cep: string;
  status: string;
}

export function extractTitulos(table: Table, map: ColumnMap): EstoqueTitulo[] {
  const get = (row: string[], key: ColumnKey) => (map[key] !== undefined ? (row[map[key]!] ?? '').trim() : '');
  return table.rows.map((row, index) => ({
    index,
    seuNumero: get(row, 'seuNumero'),
    numDocumento: get(row, 'numDocumento'),
    sacadoNome: get(row, 'sacadoNome'),
    sacadoDoc: onlyDigits(get(row, 'sacadoDoc')),
    cedenteNome: get(row, 'cedenteNome'),
    cedenteDoc: onlyDigits(get(row, 'cedenteDoc')),
    vencimento: parseDate(get(row, 'vencimento')),
    emissao: parseDate(get(row, 'emissao')),
    valorNominal: parseMoney(get(row, 'valorNominal')),
    valorAquisicao: parseMoney(get(row, 'valorAquisicao')),
    valorPresente: parseMoney(get(row, 'valorPresente')),
    valorPresenteAtualizado: parseMoney(get(row, 'valorPresenteAtualizado')),
    especie: mapEspecie(get(row, 'especie')),
    coobrigacao: mapCoobrigacao(get(row, 'coobrigacao')),
    chaveNfe: onlyDigits(get(row, 'chaveNfe')),
    nfNumero: get(row, 'nfNumero'),
    endereco: get(row, 'endereco'),
    cep: onlyDigits(get(row, 'cep')),
    status: get(row, 'status'),
  }));
}

export function originadorFrom(table: Table, map: ColumnMap): string {
  if (map.originadorNome === undefined) return '';
  return table.rows.find((r) => (r[map.originadorNome!] ?? '').trim())?.[map.originadorNome!]?.trim() ?? '';
}

// ------------------------------------------------------------------ remessa de baixa

export type ValorPagoBase = 'valorNominal' | 'valorPresenteAtualizado' | 'valorPresente' | 'valorAquisicao' | 'nenhum';

export function valorOf(t: EstoqueTitulo, base: ValorPagoBase): number | null {
  return base === 'nenhum' ? null : t[base];
}

export interface BaixaOptions {
  ocorrencia: string;
  valorPago: ValorPagoBase;
  /** ISO (AAAA-MM-DD). */
  dataLiquidacao: string;
  termoCessao?: string;
  header: {
    codOriginador?: string;
    nomeOriginador?: string;
    numBanco?: string;
    nomeBanco?: string;
    seqArquivo?: string;
  };
}

function setField(rec: RecordInstance, id: string, logical: string) {
  const f = specOf(fidc444, rec.type).fields.find((x) => x.id === id) as FieldSpec | undefined;
  if (f && logical !== '') rec.raw = setRaw(rec.raw, f, encode(f, logical));
}

const tipoPessoa = (doc: string) => (docKind(doc) === 'cpf' ? '01' : '02');
const d6 = (iso: string | null) => (iso ? isoToCnabDate(iso, 6) : '');
const cents = (n: number | null) => (n === null ? '' : String(n));

export function buildBaixa(titulos: EstoqueTitulo[], opts: BaixaOptions): CnabDoc {
  const layout = fidc444;
  let doc = createDocument(layout, opts.ocorrencia);
  for (const t of groupTitulos(layout, doc.records)) doc = removeTitulo(doc, layout, t.uid);

  const header = doc.records[0]!;
  const h = { ...header };
  const { codOriginador, nomeOriginador, numBanco, nomeBanco, seqArquivo } = opts.header;
  setField(h, 'codOriginador', onlyDigits(codOriginador ?? ''));
  setField(h, 'nomeOriginador', nomeOriginador ?? '');
  setField(h, 'numBanco', onlyDigits(numBanco ?? ''));
  setField(h, 'nomeBanco', nomeBanco ?? '');
  setField(h, 'seqArquivo', onlyDigits(seqArquivo ?? ''));
  doc = { ...doc, records: doc.records.map((r) => (r.uid === header.uid ? h : r)) };

  for (const t of titulos) {
    const [rec] = newTituloRecords(doc, layout);
    const r = rec!;
    setField(r, 'ocorrencia', opts.ocorrencia);
    setField(r, 'seuNumero', t.seuNumero);
    setField(r, 'numDocumento', t.numDocumento);
    setField(r, 'vencimento', d6(t.vencimento));
    setField(r, 'dataEmissao', d6(t.emissao));
    setField(r, 'valorFace', cents(t.valorNominal));
    setField(r, 'valorAquisicao', cents(t.valorAquisicao));
    setField(r, 'especie', t.especie);
    if (t.coobrigacao) setField(r, 'coobrigacao', t.coobrigacao);
    setField(r, 'chaveNota', t.chaveNfe);
    setField(r, 'nfNumero', t.nfNumero);
    if (opts.termoCessao) setField(r, 'termoCessao', opts.termoCessao);
    // Baixa: valor pago e data da liquidação.
    if (opts.valorPago !== 'nenhum') {
      setField(r, 'valorPago', cents(valorOf(t, opts.valorPago)));
      setField(r, 'dataLiquidacao', d6(opts.dataLiquidacao));
    }
    // Sacado.
    const sacadoDoc = canonicalDoc(t.sacadoDoc);
    if (sacadoDoc) {
      setField(r, 'sacadoTipo', tipoPessoa(sacadoDoc));
      setField(r, 'sacadoDoc', sacadoDoc);
    }
    setField(r, 'sacadoNome', t.sacadoNome);
    setField(r, 'sacadoEndereco', t.endereco);
    setField(r, 'sacadoCep', t.cep);
    // Cedente por linha: um estoque pode ter vários cedentes.
    const cedenteDoc = canonicalDoc(t.cedenteDoc);
    if (cedenteDoc) {
      setField(r, 'tipoPessoaCedente', tipoPessoa(cedenteDoc));
      setField(r, 'cedenteDoc', cedenteDoc);
    }
    setField(r, 'cedenteNome', t.cedenteNome);
    doc = insertTitulo(doc, layout, [r]);
  }

  const final = finalizeDoc(doc, layout);
  return { ...final, fileName: layout.fileName(final, layout) };
}
