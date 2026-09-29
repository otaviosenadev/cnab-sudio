import type { CnabDoc, LayoutSpec } from './types';
import {
  addChild,
  createDocument,
  finalizeDoc,
  insertTitulo,
  newTituloRecords,
  setFieldLogical,
  writeShare,
} from './document';
import { groupTitulos } from './records';
import { addDaysIso, isoToCnabDate, todayIso, withCheckDigits } from './format';

const CEDENTE = { nome: 'ACME INDUSTRIA E COMERCIO LTDA', doc: withCheckDigits('112223330001') };
const SACADOS = [
  { nome: 'MERCADO BOA VISTA LTDA', doc: withCheckDigits('045780120001'), end: 'AV PAULISTA 1000 CONJ 12', cep: '01310100', bairro: 'BELA VISTA', cidade: 'SAO PAULO', uf: 'SP' },
  { nome: 'DISTRIBUIDORA HORIZONTE SA', doc: withCheckDigits('078451230001'), end: 'RUA DAS FLORES 245', cep: '30130010', bairro: 'CENTRO', cidade: 'BELO HORIZONTE', uf: 'MG' },
  { nome: 'MARIA APARECIDA SOUZA', doc: withCheckDigits('529982247'), end: 'RUA SETE DE SETEMBRO 88', cep: '80060070', bairro: 'CENTRO', cidade: 'CURITIBA', uf: 'PR' },
];
const TITULOS = [
  { numero: '1600005301', valor: '15184026', aquisicao: '14892310', dias: 30, sacado: 0 },
  { numero: '1600005302', valor: '2120000', aquisicao: '2071544', dias: 45, sacado: 1 },
  { numero: '1600005303', valor: '2083448', aquisicao: '2011870', dias: 60, sacado: 0 },
  { numero: '1600005304', valor: '875990', aquisicao: '851203', dias: 28, sacado: 2 },
];

export function sampleDocument(layout: LayoutSpec): CnabDoc {
  let doc = createDocument(layout);
  const today = todayIso();
  const d6 = (iso: string) => isoToCnabDate(iso, 6);
  const d8 = (iso: string) => isoToCnabDate(iso, 8);
  const dateFor = (iso: string) => (layout.lineLength === 240 ? d8(iso) : d6(iso));

  const header = doc.records[0]!;
  const set = (uid: string, field: string, v: string) => {
    doc = setFieldLogical(doc, layout, uid, field, v);
  };

  if (layout.id === 'cnab444-fidc') {
    set(header.uid, 'codOriginador', '23523');
    set(header.uid, 'nomeOriginador', 'ALFA CONSULTORIA FINANCEIRA');
    set(header.uid, 'numBanco', '999');
    set(header.uid, 'nomeBanco', 'BANCO EXEMPLO');
    set(header.uid, 'seqArquivo', '53');
    doc = writeShare(doc, layout, 'cedente.nome', CEDENTE.nome);
    doc = writeShare(doc, layout, 'cedente.doc', CEDENTE.doc);
  } else if (layout.id === 'cnab444-cobranca') {
    set(header.uid, 'contaEmpresa', '1045879');
    set(header.uid, 'nomeEmpresa', 'FUNDO DE INVESTIMENTOS ALFA');
    set(header.uid, 'numBanco', '999');
    set(header.uid, 'nomeBanco', 'BANCO EXEMPLO');
    set(header.uid, 'seqRemessa', '12');
    doc = writeShare(doc, layout, 'benef.carteira', '009');
    doc = writeShare(doc, layout, 'benef.agencia', '00001');
    doc = writeShare(doc, layout, 'benef.conta', '1045879');
    doc = writeShare(doc, layout, 'benef.dv', '3');
    doc = writeShare(doc, layout, 'sacador.doc', CEDENTE.doc);
    doc = writeShare(doc, layout, 'sacador.nome', CEDENTE.nome);
  } else {
    doc = writeShare(doc, layout, 'banco.codigo', '999');
    set(header.uid, 'nomeBanco', 'BANCO EXEMPLO SA');
    set(header.uid, 'nsa', '27');
    doc = writeShare(doc, layout, 'emp.doc', CEDENTE.doc);
    doc = writeShare(doc, layout, 'emp.nome', CEDENTE.nome);
    doc = writeShare(doc, layout, 'emp.convenio', '0000000000001234567');
    doc = writeShare(doc, layout, 'emp.agencia', '1234');
    doc = writeShare(doc, layout, 'emp.dvAgencia', '0');
    doc = writeShare(doc, layout, 'emp.conta', '56789');
    doc = writeShare(doc, layout, 'emp.dvConta', '1');
  }

  // Cria os demais títulos a partir do primeiro (já existente).
  for (let i = 1; i < TITULOS.length; i++) doc = insertTitulo(doc, layout, newTituloRecords(doc, layout));

  groupTitulos(layout, doc.records).forEach((t, i) => {
    const spec = TITULOS[i]!;
    const s = SACADOS[spec.sacado]!;
    const venc = dateFor(addDaysIso(today, spec.dias));
    const emissao = dateFor(addDaysIso(today, -5));
    const uid = t.uid;
    const sacadoUid = layout.id === 'cnab240-cobranca' ? t.children[0]!.uid : uid;
    doc = setFieldLogical(doc, layout, sacadoUid, layout.id === 'cnab240-cobranca' ? 'inscricao' : layout.id === 'cnab444-cobranca' ? 'pagadorDoc' : 'sacadoDoc', s.doc);
    doc = writeShare(doc, layout, 'sacado.nome', s.nome, scopeOf(doc, layout, uid));
    doc = writeShare(doc, layout, 'sacado.endereco', s.end, scopeOf(doc, layout, uid));
    doc = writeShare(doc, layout, 'sacado.cep', s.cep, scopeOf(doc, layout, uid));
    doc = writeShare(doc, layout, 'sacado.bairro', s.bairro, scopeOf(doc, layout, uid));
    doc = writeShare(doc, layout, 'sacado.cidade', s.cidade, scopeOf(doc, layout, uid));
    doc = writeShare(doc, layout, 'sacado.uf', s.uf, scopeOf(doc, layout, uid));

    if (layout.id === 'cnab444-fidc') {
      set(uid, 'seuNumero', `2000005${spec.numero.slice(-4)}`);
      set(uid, 'numDocumento', spec.numero);
      set(uid, 'vencimento', venc);
      set(uid, 'dataEmissao', emissao);
      set(uid, 'valorFace', spec.valor);
      set(uid, 'valorAquisicao', spec.aquisicao);
      set(uid, 'termoCessao', `TC${today.replace(/-/g, '')}01`);
      set(uid, 'nfNumero', spec.numero.slice(-6));
    } else if (layout.id === 'cnab444-cobranca') {
      set(uid, 'controleParticipante', `CTRL${spec.numero}`);
      set(uid, 'seuNumero', spec.numero);
      set(uid, 'vencimento', venc);
      set(uid, 'dataEmissao', emissao);
      set(uid, 'valor', spec.valor);
    } else {
      set(uid, 'nossoNumero', `000000${spec.numero}`);
      set(uid, 'numeroDocumento', spec.numero);
      set(uid, 'vencimento', venc);
      set(uid, 'dataEmissao', emissao);
      set(uid, 'valor', spec.valor);
      set(uid, 'usoEmpresa', `ACME-${spec.numero}`);
    }
  });

  if (layout.id === 'cnab444-fidc') {
    const first = groupTitulos(layout, doc.records)[0]!;
    doc = addChild(doc, layout, first.uid, 'lastro');
  }

  const final = finalizeDoc(doc, layout);
  return { ...final, fileName: layout.fileName(final, layout) };
}

function scopeOf(doc: CnabDoc, layout: LayoutSpec, uid: string): Set<string> {
  const t = groupTitulos(layout, doc.records).find((x) => x.uid === uid);
  return new Set(t ? [t.primary.uid, ...t.children.map((c) => c.uid)] : [uid]);
}
