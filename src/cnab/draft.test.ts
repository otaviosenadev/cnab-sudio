import { describe, expect, it } from 'vitest';
import { applyChanges, buildFromDraft, type Draft } from './draft';
import { layoutCatalog } from './catalog';
import { withCheckDigits } from './format';
import { detectLayout } from './detect';

const cnpj = withCheckDigits('112223330001');
const sacadoDoc = withCheckDigits('045780120001');

const base: Draft = {
  layout: 'cnab444-fidc',
  arquivo: { codOriginador: '23523', nomeOriginador: 'Alfa Consultoria', numBanco: '999', nomeBanco: 'Banco Exemplo', seqArquivo: 7 },
  cedente: { 'cedente.nome': 'ACME Indústria Ltda', 'cedente.doc': cnpj },
  titulos: [
    {
      campos: { seuNumero: 'A1', numDocumento: '1001', vencimento: '2026-12-10', dataEmissao: '10/09/2026', valorFace: '1.234,56', valorAquisicao: 1200.5, termoCessao: 'TC01' },
      sacado: { doc: sacadoDoc, nome: 'Mercado Boa Vista', endereco: 'Av Paulista 1000', cep: '01310-100' },
    },
    {
      campos: { seuNumero: 'A2', numDocumento: '1002', vencimento: '2027-01-10', dataEmissao: '2026-09-10', valorFace: 500, valorAquisicao: 480, termoCessao: 'TC01' },
      sacado: { doc: sacadoDoc, nome: 'Mercado Boa Vista', endereco: 'Av Paulista 1000', cep: '01310100' },
    },
  ],
};

describe('rascunho → remessa', () => {
  it('monta um arquivo FIDC completo sem erros', () => {
    const r = buildFromDraft(base);
    expect(r.issues.filter((i) => i.nivel === 'erro'), JSON.stringify(r.issues)).toEqual([]);
    expect(r.resumo.titulos).toBe(2);
    expect(r.resumo.valorTotal).toBe('R$ 1.734,56');
    const lines = r.text.trim().split('\r\n');
    expect(lines.every((l) => l.length === 444)).toBe(true);
    expect(detectLayout(r.text).layoutId).toBe('cnab444-fidc');
    expect(lines[1]!.slice(126, 139)).toBe('0000000123456'); // valor de face
    expect(lines[1]!.slice(120, 126)).toBe('101226'); // vencimento DDMMAA
    expect(lines[1]!.slice(334, 380).trim()).toBe('ACME INDUSTRIA LTDA');
  });

  it('aponta o que falta e aceita correções', () => {
    const incompleto: Draft = { ...base, cedente: {} };
    const r = buildFromDraft(incompleto);
    expect(r.issues.some((i) => i.onde === 'cedente' && i.nivel === 'erro')).toBe(true);
    const { draft } = applyChanges(incompleto, [
      { alvo: 'cedente', campo: 'cedente.nome', valor: 'ACME' },
      { alvo: 'cedente', campo: 'cedente.doc', valor: cnpj },
    ]);
    expect(buildFromDraft(draft).issues.filter((i) => i.nivel === 'erro')).toEqual([]);
  });

  it('campo inexistente vira aviso', () => {
    const r = buildFromDraft({ ...base, arquivo: { ...base.arquivo, inventado: 'x' } });
    expect(r.issues.some((i) => i.mensagem.includes('inventado'))).toBe(true);
  });

  it('funciona para os outros layouts', () => {
    const r240 = buildFromDraft({
      layout: 'cnab240-cobranca',
      arquivo: { 'banco.codigo': '999', nsa: 1, numeroRemessa: 1 },
      cedente: { 'emp.doc': cnpj, 'emp.nome': 'ACME', 'emp.agencia': '1234', 'emp.conta': '5678' },
      titulos: [{ campos: { numeroDocumento: 'D1', vencimento: '2026-12-01', valor: '100.00', dataEmissao: '2026-09-01' }, sacado: { doc: sacadoDoc, nome: 'X', endereco: 'Y', cep: '01310100', cidade: 'SAO PAULO', uf: 'SP' } }],
    });
    expect(r240.issues.filter((i) => i.nivel === 'erro'), JSON.stringify(r240.issues)).toEqual([]);
    expect(r240.text.split('\r\n')[0]!.length).toBe(240);
  });

  it('catálogo cobre os três layouts', () => {
    const c = layoutCatalog();
    expect(c).toContain('cnab444-fidc');
    expect(c).toContain('cnab240-cobranca');
    expect(c).toContain('valorAquisicao');
  });
});
