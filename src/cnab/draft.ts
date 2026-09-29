/**
 * Rascunho semântico de uma remessa — o formato que o assistente de IA preenche.
 * Os valores chegam em formato "humano" (datas ISO, valores decimais) e são convertidos
 * aqui para o texto posicional, usando o mesmo motor do editor.
 */
import type { CnabDoc, FieldSpec, Issue, LayoutId, LayoutSpec } from './types';
import { getLayout } from './layouts';
import { getRaw } from './codec';
import {
  createDocument,
  finalizeDoc,
  insertTitulo,
  newTituloRecords,
  removeTitulo,
  serialize,
  setFieldLogical,
  validate,
  writeShare,
} from './document';
import { groupTitulos, specOf, tituloRecords } from './records';
import { formatBRL, isoToCnabDate, onlyDigits, parseDecimal } from './format';

export type DraftValue = string | number;

export interface DraftTitulo {
  campos?: Record<string, DraftValue>;
  sacado?: Record<string, DraftValue>;
}

export interface Draft {
  layout: LayoutId;
  ocorrencia_padrao?: string;
  nome_arquivo?: string;
  arquivo?: Record<string, DraftValue>;
  cedente?: Record<string, DraftValue>;
  titulos: DraftTitulo[];
}

export interface DraftIssue {
  nivel: 'erro' | 'alerta' | 'aviso';
  onde: string;
  mensagem: string;
}

export interface DraftResult {
  doc: CnabDoc;
  text: string;
  issues: DraftIssue[];
  resumo: {
    layout: string;
    titulos: number;
    valorTotal: string;
    erros: number;
    alertas: number;
  };
}

// ------------------------------------------------------------------ conversão de valores

/** Converte o valor "humano" do rascunho no valor lógico que o codec espera. */
export function toFieldLogical(f: FieldSpec, value: DraftValue): string {
  const v = String(value ?? '').trim();
  if (!v) return '';
  switch (f.input) {
    case 'date6':
    case 'date8': {
      const w = f.input === 'date6' ? 6 : 8;
      let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) return isoToCnabDate(`${m[1]}-${m[2]}-${m[3]}`, w);
      m = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (m) return isoToCnabDate(`${m[3]}-${m[2]}-${m[1]}`, w);
      m = v.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
      if (m) return isoToCnabDate(`20${m[3]}-${m[2]}-${m[1]}`, w);
      return onlyDigits(v);
    }
    case 'money': {
      const dec = f.decimals ?? 2;
      return parseDecimal(normalizeNumber(v), dec);
    }
    case 'decimal':
      return parseDecimal(normalizeNumber(v), f.decimals ?? 2);
    case 'time6':
      return onlyDigits(v).padEnd(6, '0').slice(0, 6);
    case 'doc':
    case 'doc15':
    case 'cep':
      return onlyDigits(v);
    default:
      return v;
  }
}

/** "1.234,56" | "1234.56" | "1234,5" | 1234.56 -> "1234,56" (formato aceito por parseDecimal). */
function normalizeNumber(v: string): string {
  const s = v.replace(/[^\d.,-]/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) return s.replace(/\./g, '');
  if (lastDot > -1) return s.replace(/,/g, '').replace('.', ',');
  return s;
}

// ------------------------------------------------------------------ montagem

function fieldsByGroup(layout: LayoutSpec) {
  const arquivo = new Map<string, FieldSpec>();
  const cedente = new Map<string, FieldSpec>();
  const sacado = new Map<string, FieldSpec>();
  for (const r of layout.records) {
    for (const f of r.fields) {
      if (f.fixed !== undefined || f.blank || f.auto) continue;
      if (f.group === 'arquivo' && (r.role === 'header' || r.role === 'batchHeader')) {
        const key = f.share ?? f.id;
        if (!arquivo.has(key)) arquivo.set(key, f);
      } else if (f.group === 'cedente' && f.share) {
        if (!cedente.has(f.share)) cedente.set(f.share, f);
      } else if (f.group === 'sacado' && f.share) {
        if (!sacado.has(f.share)) sacado.set(f.share, f);
      }
    }
  }
  const detail = layout.records.find((r) => r.role === 'detail')!;
  const titulo = new Map(
    detail.fields.filter((f) => f.group === 'titulo' && f.fixed === undefined && !f.blank && !f.auto).map((f) => [f.id, f]),
  );
  return { arquivo, cedente, sacado, titulo };
}

export function buildFromDraft(draft: Draft): DraftResult {
  const layout = getLayout(draft.layout);
  const groups = fieldsByGroup(layout);
  const unknown: DraftIssue[] = [];
  const oc = draft.ocorrencia_padrao ?? layout.presets[0]?.ocorrencia ?? '01';

  // Documento base sem títulos.
  let doc = createDocument(layout, oc);
  for (const t of groupTitulos(layout, doc.records)) doc = removeTitulo(doc, layout, t.uid);

  // Arquivo (headers).
  for (const [key, value] of Object.entries(draft.arquivo ?? {})) {
    const f = groups.arquivo.get(key);
    if (!f) {
      unknown.push({ nivel: 'aviso', onde: 'arquivo', mensagem: `Campo "${key}" não existe neste layout — ignorado.` });
      continue;
    }
    const logical = toFieldLogical(f, value);
    if (f.share) doc = writeShare(doc, layout, f.share, logical);
    else {
      const rec = doc.records.find((r) => specOf(layout, r.type).fields.includes(f));
      if (rec) doc = setFieldLogical(doc, layout, rec.uid, f.id, logical);
    }
  }

  // Títulos (antes do cedente para que os campos replicados existam).
  draft.titulos.forEach((t, i) => {
    const recs = newTituloRecords(doc, layout);
    const oco = t.campos?.[layout.summary.ocorrencia];
    doc = insertTitulo(doc, layout, recs);
    const primary = recs[0]!;
    const scope = new Set(recs.map((r) => r.uid));
    for (const [key, value] of Object.entries(t.campos ?? {})) {
      const f = groups.titulo.get(key);
      if (!f) {
        unknown.push({ nivel: 'aviso', onde: `título ${i + 1}`, mensagem: `Campo "${key}" não existe neste layout — ignorado.` });
        continue;
      }
      doc = setFieldLogical(doc, layout, primary.uid, f.id, toFieldLogical(f, value));
    }
    if (oco === undefined) {
      const f = groups.titulo.get(layout.summary.ocorrencia);
      if (f) doc = setFieldLogical(doc, layout, primary.uid, f.id, oc);
    }
    for (const [key, value] of Object.entries(t.sacado ?? {})) {
      const shareKey = key.startsWith('sacado.') ? key : `sacado.${key}`;
      const f = groups.sacado.get(shareKey);
      if (!f) {
        unknown.push({ nivel: 'aviso', onde: `título ${i + 1}`, mensagem: `Campo de sacado "${key}" não existe neste layout — ignorado.` });
        continue;
      }
      doc = writeShare(doc, layout, shareKey, toFieldLogical(f, value), scope);
    }
  });

  // Cedente (replicado em todas as linhas).
  for (const [key, value] of Object.entries(draft.cedente ?? {})) {
    const f = groups.cedente.get(key);
    if (!f) {
      unknown.push({ nivel: 'aviso', onde: 'cedente', mensagem: `Campo "${key}" não existe neste layout — ignorado.` });
      continue;
    }
    doc = writeShare(doc, layout, key, toFieldLogical(f, value));
  }

  doc = finalizeDoc(doc, layout);
  doc = { ...doc, fileName: draft.nome_arquivo?.trim() || layout.fileName(doc, layout) };

  const issues = [...unknown, ...describeIssues(doc, layout, validate(doc, layout))];
  const titulos = groupTitulos(layout, doc.records);
  const valorF = layout.records.find((r) => r.role === 'detail')!.fields.find((f) => f.id === layout.summary.valor)!;
  const total = titulos.reduce((s, t) => s + BigInt(onlyDigits(getRaw(t.primary.raw, valorF)) || '0'), 0n);

  return {
    doc,
    text: serialize(doc),
    issues,
    resumo: {
      layout: layout.name,
      titulos: titulos.length,
      valorTotal: formatBRL(total),
      erros: issues.filter((i) => i.nivel === 'erro').length,
      alertas: issues.filter((i) => i.nivel === 'alerta').length,
    },
  };
}

/** Traduz os apontamentos do validador para referências que a IA entende (título N · campo). */
function describeIssues(doc: CnabDoc, layout: LayoutSpec, issues: Issue[]): DraftIssue[] {
  const titulos = groupTitulos(layout, doc.records);
  const nivel = { error: 'erro', warning: 'alerta', info: 'aviso' } as const;
  const out: DraftIssue[] = [];
  const seenShared = new Set<string>();
  for (const i of issues) {
    const rec = i.uid ? doc.records.find((r) => r.uid === i.uid) : undefined;
    const spec = rec ? specOf(layout, rec.type) : undefined;
    const f = spec?.fields.find((x) => x.id === i.field);
    // Campos fora do layout em registros recém-criados não interessam à IA.
    if (f?.blank) continue;
    let onde = 'arquivo';
    let campo = f ? `${f.share && f.group !== 'titulo' ? f.share : f.id} (${f.label})` : '';
    if (f?.group === 'cedente' || (f?.group === 'control' && f.share)) {
      const key = `${f.share}:${i.message}`;
      if (seenShared.has(key)) continue;
      seenShared.add(key);
      onde = f.group === 'cedente' ? 'cedente' : 'arquivo';
    } else if (spec && (spec.role === 'detail' || spec.role === 'child')) {
      const t = titulos.find((x) => tituloRecords(x).some((r) => r.uid === rec!.uid));
      onde = t ? `título ${t.index + 1}` : spec.label;
      if (f?.group === 'sacado') campo = `sacado.${f.share!.split('.')[1]} (${f.label})`;
      else if (spec.role === 'child') campo = `${spec.label} · ${f?.label ?? ''}`;
    }
    out.push({ nivel: nivel[i.level], onde, mensagem: campo ? `${campo}: ${i.message}` : i.message });
  }
  return out;
}

/** Aplica alterações pontuais a um rascunho (usado pela ferramenta atualizar_rascunho). */
export interface DraftChange {
  alvo: 'arquivo' | 'cedente' | 'titulo' | 'sacado';
  /** Índice do título, base 1. Ausente = todos os títulos. */
  titulo?: number;
  campo: string;
  valor: DraftValue;
}

export function applyChanges(draft: Draft, changes: DraftChange[]): { draft: Draft; problems: string[] } {
  const next: Draft = structuredClone(draft);
  const problems: string[] = [];
  for (const c of changes) {
    if (c.alvo === 'arquivo') (next.arquivo ??= {})[c.campo] = c.valor;
    else if (c.alvo === 'cedente') (next.cedente ??= {})[c.campo] = c.valor;
    else {
      const targets = c.titulo === undefined ? next.titulos : [next.titulos[c.titulo - 1]];
      if (targets.some((t) => !t)) {
        problems.push(`Título ${c.titulo} não existe (há ${next.titulos.length}).`);
        continue;
      }
      for (const t of targets as DraftTitulo[]) {
        if (c.alvo === 'titulo') (t.campos ??= {})[c.campo] = c.valor;
        else (t.sacado ??= {})[c.campo] = c.valor;
      }
    }
  }
  return { draft: next, problems };
}
