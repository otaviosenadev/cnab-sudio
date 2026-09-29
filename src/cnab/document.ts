import type {
  CnabDoc,
  FieldRef,
  FieldSpec,
  Issue,
  LayoutSpec,
  RecordInstance,
  Titulo,
} from './types';
import { blankLine, encode, getRaw, isEmptyRaw, setRaw, toLogical } from './codec';
import { splitLines } from './detect';
import { groupTitulos, newUid, specOf, tituloRecords, unknownSpec } from './records';
import { canonicalDoc, cnabDateToIso, docKind, isValidCnpj, isValidCpf, onlyDigits } from './format';

// ------------------------------------------------------------------ parse / serialize

export function parseText(text: string, layout: LayoutSpec, fileName = 'remessa.rem'): CnabDoc {
  const lines = splitLines(text);
  const notes: string[] = [];
  let wrongLength = 0;
  let unknown = 0;
  const records: RecordInstance[] = lines.map((line) => {
    if (line.length !== layout.lineLength) wrongLength += 1;
    const fixedLine = line.padEnd(layout.lineLength, ' ').slice(0, layout.lineLength);
    const spec = layout.records.find((r) => r.match(fixedLine));
    if (!spec) unknown += 1;
    return { uid: newUid(), type: spec?.id ?? unknownSpec(layout).id, raw: fixedLine };
  });
  if (wrongLength) notes.push(`${wrongLength} linha(s) com tamanho diferente de ${layout.lineLength} posições foram ajustadas.`);
  if (unknown) notes.push(`${unknown} linha(s) com tipo de registro não reconhecido.`);
  const def = layout.presets[0]?.ocorrencia ?? '01';
  return { layoutId: layout.id, fileName, records, defaultOcorrencia: def, sourceText: text, importNotes: notes };
}

export function serialize(doc: CnabDoc): string {
  return doc.records.map((r) => r.raw).join('\r\n') + '\r\n';
}

export function toBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out[i] = c < 256 ? c : 0x20;
  }
  return out;
}

/** Recalcula campos automáticos. Retorna um novo documento. */
export function finalizeDoc(doc: CnabDoc, layout: LayoutSpec): CnabDoc {
  const records = doc.records.map((r) => ({ ...r }));
  layout.finalize(records, layout);
  const changed = records.some((r, i) => r.raw !== doc.records[i]!.raw);
  return changed ? { ...doc, records } : doc;
}

// ------------------------------------------------------------------ criação

function newRecord(layout: LayoutSpec, type: string): RecordInstance {
  return { uid: newUid(), type, raw: blankLine(specOf(layout, type), layout.lineLength) };
}

export function createDocument(layout: LayoutSpec, ocorrencia?: string): CnabDoc {
  const byRole = (role: string) => layout.records.filter((r) => r.role === role).map((r) => newRecord(layout, r.id));
  const doc: CnabDoc = {
    layoutId: layout.id,
    fileName: '',
    records: [...byRole('header'), ...byRole('batchHeader'), ...byRole('batchTrailer'), ...byRole('trailer')],
    defaultOcorrencia: ocorrencia ?? layout.presets[0]?.ocorrencia ?? '01',
  };
  const withTitulo = insertTitulo(doc, layout, newTituloRecords(doc, layout));
  const final = finalizeDoc(withTitulo, layout);
  return { ...final, fileName: layout.fileName(final, layout) };
}

/** Cria os registros de um novo título, herdando valores globais (cedente, banco…). */
export function newTituloRecords(doc: CnabDoc, layout: LayoutSpec): RecordInstance[] {
  const primarySpec = layout.records.find((r) => r.role === 'detail')!;
  const primary = newRecord(layout, primarySpec.id);
  const oc = specOf(layout, primary.type).fields.find((f) => f.id === layout.summary.ocorrencia);
  if (oc) primary.raw = setRaw(primary.raw, oc, encode(oc, doc.defaultOcorrencia));
  const children = layout.records.filter((r) => r.role === 'child' && r.requiredChild).map((r) => newRecord(layout, r.id));
  const recs = [primary, ...children];
  inheritGlobals(doc, layout, recs);
  return recs;
}

function inheritGlobals(doc: CnabDoc, layout: LayoutSpec, target: RecordInstance[]) {
  for (const key of globalShareKeys(layout)) {
    const src = readShare(doc, layout, key);
    if (!src || src.logical === '') continue;
    for (const rec of target) {
      for (const f of specOf(layout, rec.type).fields) {
        if (f.share === key) rec.raw = setRaw(rec.raw, f, encode(f, src.logical));
      }
    }
  }
}

function insertIndexForTitulo(doc: CnabDoc, layout: LayoutSpec, afterUid?: string): number {
  const titulos = groupTitulos(layout, doc.records);
  const anchor = afterUid ? titulos.find((t) => t.uid === afterUid) : titulos[titulos.length - 1];
  if (anchor) {
    const last = anchor.children[anchor.children.length - 1] ?? anchor.primary;
    return doc.records.indexOf(last) + 1;
  }
  const idx = doc.records.findIndex((r) => {
    const role = specOf(layout, r.type).role;
    return role === 'batchTrailer' || role === 'trailer';
  });
  return idx === -1 ? doc.records.length : idx;
}

export function insertTitulo(doc: CnabDoc, layout: LayoutSpec, recs: RecordInstance[], afterUid?: string): CnabDoc {
  const at = insertIndexForTitulo(doc, layout, afterUid);
  const records = [...doc.records.slice(0, at), ...recs, ...doc.records.slice(at)];
  return { ...doc, records };
}

export function duplicateTitulo(doc: CnabDoc, layout: LayoutSpec, uid: string): CnabDoc {
  const t = groupTitulos(layout, doc.records).find((x) => x.uid === uid);
  if (!t) return doc;
  const copies = tituloRecords(t).map((r) => ({ ...r, uid: newUid() }));
  return insertTitulo(doc, layout, copies, uid);
}

export function removeTitulo(doc: CnabDoc, layout: LayoutSpec, uid: string): CnabDoc {
  const t = groupTitulos(layout, doc.records).find((x) => x.uid === uid);
  if (!t) return doc;
  const drop = new Set(tituloRecords(t).map((r) => r.uid));
  return { ...doc, records: doc.records.filter((r) => !drop.has(r.uid)) };
}

export function addChild(doc: CnabDoc, layout: LayoutSpec, tituloUid: string, type: string): CnabDoc {
  const t = groupTitulos(layout, doc.records).find((x) => x.uid === tituloUid);
  if (!t) return doc;
  const rec = newRecord(layout, type);
  inheritGlobals(doc, layout, [rec]);
  prefillChild(layout, t, rec);
  // Mantém a ordem dos tipos de filho definida no layout.
  const order = layout.records.map((r) => r.id);
  const rank = order.indexOf(type);
  const siblings = t.children;
  let insertAfter: RecordInstance = t.primary;
  for (const c of siblings) if (order.indexOf(c.type) <= rank) insertAfter = c;
  const at = doc.records.indexOf(insertAfter) + 1;
  return { ...doc, records: [...doc.records.slice(0, at), rec, ...doc.records.slice(at)] };
}

/** Pré-preenche um registro filho com dados do título (ex.: lastro herda datas, valor e sacado). */
function prefillChild(layout: LayoutSpec, t: Titulo, rec: RecordInstance) {
  const pSpec = specOf(layout, t.primary.type);
  const cSpec = specOf(layout, rec.type);
  const copy = (from: string, to: string) => {
    const a = pSpec.fields.find((f) => f.id === from);
    const b = cSpec.fields.find((f) => f.id === to);
    if (a && b) rec.raw = setRaw(rec.raw, b, encode(b, toLogical(a, getRaw(t.primary.raw, a))));
  };
  if (layout.id === 'cnab444-fidc' && rec.type === 'lastro') {
    copy('dataEmissao', 'dataEmissao');
    copy('vencimento', 'vencimento');
    copy('valorFace', 'valorNominal');
    copy('valorFace', 'valorNF');
    copy('especie', 'tipoRecebivel');
    copy('numDocumento', 'numeroLastro');
    copy('sacadoTipo', 'sacadoTipo');
    copy('sacadoDoc', 'sacadoDoc');
    copy('sacadoNome', 'sacadoNome');
    copy('sacadoEndereco', 'sacadoEndereco');
    copy('sacadoCep', 'sacadoCep');
    copy('nfNumero', 'numeroNF');
    copy('chaveNota', 'chaveNFe');
  }
  if (layout.id === 'cnab444-cobranca' && rec.type === 'avalista') {
    copy('carteira', 'carteira');
    copy('agencia', 'agencia');
    copy('conta', 'conta');
    copy('dvConta', 'dvConta');
    copy('nossoNumero', 'nossoNumero');
    copy('dvNossoNumero', 'dvNossoNumero');
  }
}

export function removeRecord(doc: CnabDoc, uid: string): CnabDoc {
  return { ...doc, records: doc.records.filter((r) => r.uid !== uid) };
}

// ------------------------------------------------------------------ edição de campos

export function setFieldRaw(doc: CnabDoc, layout: LayoutSpec, uid: string, fieldId: string, raw: string): CnabDoc {
  const records = doc.records.map((r) => {
    if (r.uid !== uid) return r;
    const f = specOf(layout, r.type).fields.find((x) => x.id === fieldId);
    return f ? { ...r, raw: setRaw(r.raw, f, raw) } : r;
  });
  return { ...doc, records };
}

/** Edita um campo a partir de um valor lógico, propagando para os campos ligados. */
export function setFieldLogical(
  doc: CnabDoc,
  layout: LayoutSpec,
  uid: string,
  fieldId: string,
  logical: string,
): CnabDoc {
  const rec = doc.records.find((r) => r.uid === uid);
  const f = rec && specOf(layout, rec.type).fields.find((x) => x.id === fieldId);
  if (!rec || !f) return doc;
  if (f.share && f.group !== 'titulo') {
    const scope = f.group === 'sacado' ? scopeOfRecord(doc, layout, uid) : undefined;
    return writeShare(doc, layout, f.share, logical, scope);
  }
  return setFieldRaw(doc, layout, uid, fieldId, encode(f, logical));
}

export function scopeOfRecord(doc: CnabDoc, layout: LayoutSpec, uid: string): Set<string> {
  const t = groupTitulos(layout, doc.records).find((x) => tituloRecords(x).some((r) => r.uid === uid));
  return new Set(t ? tituloRecords(t).map((r) => r.uid) : [uid]);
}

/**
 * Expande uma referência para todas as posições ligadas ao mesmo dado:
 * cedente/arquivo → todas as linhas; sacado → as linhas do título.
 */
export function expandRef(doc: CnabDoc, layout: LayoutSpec, ref: FieldRef): FieldRef[] {
  const rec = doc.records.find((r) => r.uid === ref.uid);
  const f = rec && specOf(layout, rec.type).fields.find((x) => x.id === ref.field);
  if (!rec || !f?.share || f.group === 'titulo') return [ref];
  const scope = f.group === 'sacado' ? scopeOfRecord(doc, layout, rec.uid) : undefined;
  return shareRefs(doc, layout, f.share, scope);
}

export function globalShareKeys(layout: LayoutSpec): string[] {
  const keys = new Set<string>();
  for (const r of layout.records) for (const f of r.fields) if (f.share && f.group !== 'sacado') keys.add(f.share);
  return [...keys];
}

export interface ShareValue {
  field: FieldSpec;
  rec: RecordInstance;
  raw: string;
  logical: string;
}

export function readShare(doc: CnabDoc, layout: LayoutSpec, key: string, scope?: Set<string>): ShareValue | null {
  for (const rec of doc.records) {
    if (scope && !scope.has(rec.uid)) continue;
    for (const f of specOf(layout, rec.type).fields) {
      if (f.share === key) {
        const raw = getRaw(rec.raw, f);
        return { field: f, rec, raw, logical: toLogical(f, raw) };
      }
    }
  }
  return null;
}

export function shareRefs(doc: CnabDoc, layout: LayoutSpec, key: string, scope?: Set<string>): FieldRef[] {
  const refs: FieldRef[] = [];
  for (const rec of doc.records) {
    if (scope && !scope.has(rec.uid)) continue;
    for (const f of specOf(layout, rec.type).fields) if (f.share === key) refs.push({ uid: rec.uid, field: f.id });
  }
  return refs;
}

/** Tipo de inscrição correspondente ao documento (CPF/CNPJ) nas opções do campo. */
function tipoFor(field: FieldSpec, kind: 'cpf' | 'cnpj'): string | undefined {
  const re = kind === 'cpf' ? /cpf|f[ií]sica/i : /cnpj|jur[ií]dica/i;
  return field.options?.find((o) => re.test(o.label))?.value;
}

export function writeShare(doc: CnabDoc, layout: LayoutSpec, key: string, logical: string, scope?: Set<string>): CnabDoc {
  const tipoKey = key.endsWith('.doc') ? key.replace(/\.doc$/, '.tipo') : null;
  const kind = tipoKey ? docKind(logical) : null;
  const records = doc.records.map((rec) => {
    if (scope && !scope.has(rec.uid)) return rec;
    let raw = rec.raw;
    for (const f of specOf(layout, rec.type).fields) {
      if (f.share === key) raw = setRaw(raw, f, encode(f, logical));
      else if (tipoKey && kind && f.share === tipoKey) {
        const v = tipoFor(f, kind);
        if (v) raw = setRaw(raw, f, encode(f, v));
      }
    }
    return raw === rec.raw ? rec : { ...rec, raw };
  });
  return { ...doc, records };
}

// ------------------------------------------------------------------ sacados

export interface SacadoGroup {
  key: string;
  titulos: Titulo[];
  scope: Set<string>;
  nome: string;
  doc: string;
  total: bigint;
}

export function sacadoKeyOf(doc: CnabDoc, layout: LayoutSpec, t: Titulo): { key: string; nome: string; doc: string } {
  const scope = new Set(tituloRecords(t).map((r) => r.uid));
  const d = readShare(doc, layout, 'sacado.doc', scope)?.logical ?? '';
  const nome = readShare(doc, layout, 'sacado.nome', scope)?.logical ?? '';
  const canon = canonicalDoc(d);
  return { key: canon ? `doc:${canon}` : nome ? `nome:${nome}` : `titulo:${t.uid}`, nome, doc: canon };
}

export function groupSacados(doc: CnabDoc, layout: LayoutSpec, titulos: Titulo[]): SacadoGroup[] {
  const map = new Map<string, SacadoGroup>();
  const valorId = layout.summary.valor;
  for (const t of titulos) {
    const { key, nome, doc: d } = sacadoKeyOf(doc, layout, t);
    let g = map.get(key);
    if (!g) {
      g = { key, titulos: [], scope: new Set(), nome, doc: d, total: 0n };
      map.set(key, g);
    }
    g.titulos.push(t);
    for (const r of tituloRecords(t)) g.scope.add(r.uid);
    const vf = specOf(layout, t.primary.type).fields.find((f) => f.id === valorId);
    if (vf) g.total += BigInt(onlyDigits(getRaw(t.primary.raw, vf)) || '0');
  }
  return [...map.values()];
}

/** Copia os dados de sacado de um grupo para um título. */
export function applySacadoToTitulo(doc: CnabDoc, layout: LayoutSpec, from: SacadoGroup, tituloUid: string): CnabDoc {
  const t = groupTitulos(layout, doc.records).find((x) => x.uid === tituloUid);
  if (!t) return doc;
  const scope = new Set(tituloRecords(t).map((r) => r.uid));
  let next = doc;
  for (const key of sacadoShareKeys(layout)) {
    const v = readShare(doc, layout, key, from.scope);
    if (v) next = writeShare(next, layout, key, v.logical, scope);
  }
  return next;
}

export function sacadoShareKeys(layout: LayoutSpec): string[] {
  const keys: string[] = [];
  for (const r of layout.records)
    for (const f of r.fields) if (f.group === 'sacado' && f.share && !keys.includes(f.share)) keys.push(f.share);
  return keys;
}

// ------------------------------------------------------------------ validação

export function validate(doc: CnabDoc, layout: LayoutSpec): Issue[] {
  const issues: Issue[] = [];
  for (const rec of doc.records) {
    const spec = specOf(layout, rec.type);
    if (spec.role === 'unknown') {
      issues.push({ level: 'warning', message: 'Tipo de registro não reconhecido pelo layout.', uid: rec.uid, field: 'conteudo' });
      continue;
    }
    for (const f of spec.fields) {
      const raw = getRaw(rec.raw, f);
      const push = (level: Issue['level'], message: string) => issues.push({ level, message, uid: rec.uid, field: f.id });

      if (f.fixed !== undefined) {
        if (raw !== encode(f, f.fixed)) push('warning', `Conteúdo esperado: "${f.fixed}".`);
        continue;
      }
      if (f.blank) {
        if (!isEmptyRaw(f, raw) && raw.trim() !== '') push('info', 'Conteúdo em campo fora do layout (branco/reservado).');
        continue;
      }
      if (f.kind === 'num' && raw.trim() !== '' && /[^\d]/.test(f.cpfSpaces ? raw.trimStart() : raw)) {
        push('error', 'Campo numérico com caracteres não numéricos.');
        continue;
      }
      const empty = isEmptyRaw(f, raw);
      if (empty) {
        if (f.required && !f.auto)
          issues.push({ level: 'error', message: 'Campo obrigatório não preenchido.', uid: rec.uid, field: f.id, code: 'required' });
        continue;
      }
      if (f.input === 'date6' || f.input === 'date8') {
        if (!cnabDateToIso(raw)) push('error', 'Data inválida.');
      } else if (f.input === 'doc' || f.input === 'doc15') {
        const d = toLogical(f, raw);
        const k = docKind(d);
        const ok = k === 'cpf' ? isValidCpf(d) : k === 'cnpj' ? isValidCnpj(d) : false;
        if (!ok) push('warning', 'CPF/CNPJ com dígito verificador inválido.');
      } else if (f.options && !f.options.some((o) => o.value === raw.trim() || o.value === raw)) {
        push('info', `Código "${raw.trim()}" não consta na documentação.`);
      }
    }
  }
  if (layout.crossValidate) issues.push(...layout.crossValidate(doc, layout));
  return issues;
}

// ------------------------------------------------------------------ classificação

export type OperationKind =
  | 'aquisicao'
  | 'entrada'
  | 'liquidacao'
  | 'baixa'
  | 'recompra'
  | 'instrucao'
  | 'misto'
  | 'vazio';

export const OPERATION_LABEL: Record<OperationKind, string> = {
  aquisicao: 'Aquisição',
  entrada: 'Entrada de títulos',
  liquidacao: 'Liquidação',
  baixa: 'Baixa',
  recompra: 'Recompra',
  instrucao: 'Instruções',
  misto: 'Operações mistas',
  vazio: 'Sem títulos',
};

export interface Classification {
  kind: OperationKind;
  label: string;
  breakdown: { code: string; label: string; count: number }[];
}

export function classify(layout: LayoutSpec, titulos: Titulo[]): Classification {
  const counts = new Map<string, number>();
  const cats = new Set<OperationKind>();
  const detailSpec = layout.records.find((r) => r.role === 'detail')!;
  const oc = detailSpec.fields.find((f) => f.id === layout.summary.ocorrencia)!;
  const pago = layout.summary.pago ? detailSpec.fields.find((f) => f.id === layout.summary.pago) : undefined;
  for (const t of titulos) {
    const code = getRaw(t.primary.raw, oc).trim();
    counts.set(code, (counts.get(code) ?? 0) + 1);
    const opt = oc.options?.find((o) => o.value === code);
    if (opt?.category) cats.add(opt.category);
    else if (pago && !isEmptyRaw(pago, getRaw(t.primary.raw, pago))) cats.add('liquidacao');
    else cats.add('instrucao');
  }
  const breakdown = [...counts.entries()]
    .map(([code, count]) => ({ code, count, label: oc.options?.find((o) => o.value === code)?.label ?? `Código ${code}` }))
    .sort((a, b) => b.count - a.count);
  const kind: OperationKind = cats.size === 0 ? 'vazio' : cats.size === 1 ? [...cats][0]! : 'misto';
  return { kind, label: OPERATION_LABEL[kind], breakdown };
}
