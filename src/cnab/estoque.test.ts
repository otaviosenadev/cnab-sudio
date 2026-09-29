import { describe, expect, it } from 'vitest';
import { autoMap, buildBaixa, extractTitulos, parseDate, parseDelimited, parseMoney, toTable } from './estoque';
import { detectLayout } from './detect';
import { serialize, validate } from './document';
import { fidc444 } from './layouts';
import { withCheckDigits } from './format';

const cedente = withCheckDigits('112223330001');
const sacado = withCheckDigits('045780120001');

// Formato "estoque" (CSV com ;, números brasileiros)
const CSV = [
  'NOME_FUNDO;NOME_CEDENTE;DOC_CEDENTE;NOME_SACADO;DOC_SACADO;SEU_NUMERO;NU_DOCUMENTO;TIPO_RECEBIVEL;VALOR_NOMINAL;VALOR_PRESENTE;VALOR_AQUISICAO;DATA_VENCIMENTO_ORIGINAL;DATA_EMISSAO;SITUACAO_RECEBIVEL;COOBRIGACAO',
  `Fundo Exemplo;ACME LTDA;${cedente};MERCADO BOA VISTA;${sacado};0000000000170000000000204;1895001;Duplicata;232.625,06;228.218,48;214.944,48;24/08/2026;26/05/2026;A VENCER;Sim`,
  `Fundo Exemplo;ACME LTDA;${cedente};MERCADO BOA VISTA;${sacado};0000000000190000000000257;47052001;Duplicata;27.995,08;27.995,08;26.745,78;02/08/2026;04/05/2026;VENCIDO;Não`,
].join('\r\n');

// Formato "posição" (colado do Excel: tabulação, ponto decimal, seu número com espaços)
const TSV = [
  'Id\tNomeCedente\tCpfCnpjCedente\tNomeSacado\tCpfCnpjSacado\tSeuNumero\tNumeroDocumento\tTipoTitulo\tDataVencimento\tValorNominal\tValorPresenteAtualizado\tStatusRecebivel',
  `1\tACME LTDA\t${cedente}\tMERCADO\t${sacado}\t2 00 00 000002 0000000966\t714003509 \tDuplicata\t19/10/2027\t5485.72\t3957.960408\tA vencer`,
].join('\n');

describe('estoque → baixa', () => {
  it('lê valores e datas nos dois formatos', () => {
    expect(parseMoney('232.625,06')).toBe(23262506);
    expect(parseMoney('5485.72')).toBe(548572);
    expect(parseMoney('3957.960408')).toBe(395796);
    expect(parseMoney('')).toBeNull();
    expect(parseDate('24/08/2026')).toBe('2026-08-24');
    expect(parseDate('2026-08-24')).toBe('2026-08-24');
  });

  it('reconhece as colunas do CSV de estoque', () => {
    const table = toTable(parseDelimited(CSV));
    const map = autoMap(table.headers);
    expect(table.rows.length).toBe(2);
    expect(table.headers[map.vencimento!]).toBe('DATA_VENCIMENTO_ORIGINAL');
    const [t] = extractTitulos(table, map);
    expect(t).toMatchObject({ numDocumento: '1895001', valorNominal: 23262506, vencimento: '2026-08-24', coobrigacao: '01', especie: '01' });
  });

  it('gera a baixa FIDC com valor pago e data de liquidação', () => {
    const table = toTable(parseDelimited(TSV));
    const titulos = extractTitulos(table, autoMap(table.headers));
    const doc = buildBaixa(titulos, {
      ocorrencia: '77',
      valorPago: 'valorPresenteAtualizado',
      dataLiquidacao: '2026-09-29',
      termoCessao: 'TC01',
      header: { codOriginador: '123', nomeOriginador: 'ALFA', numBanco: '999', nomeBanco: 'BANCO', seqArquivo: '4' },
    });
    const text = serialize(doc);
    const lines = text.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines.every((l) => l.length === 444)).toBe(true);
    expect(detectLayout(text).layoutId).toBe('cnab444-fidc');
    const d = lines[1]!;
    expect(d.slice(37, 62)).toBe('2 00 00 000002 0000000966'); // seu número intacto
    expect(d.slice(82, 92)).toBe('0000395796'); // valor pago
    expect(d.slice(94, 100)).toBe('290926'); // data da liquidação
    expect(d.slice(108, 110)).toBe('77'); // ocorrência
    expect(d.slice(126, 139)).toBe('0000000548572'); // valor nominal
    const errors = validate(doc, fidc444).filter((i) => i.level === 'error');
    // Endereço e CEP do sacado não existem no arquivo: ficam como pendência.
    expect(new Set(errors.map((e) => e.field))).toEqual(new Set(['sacadoEndereco', 'sacadoCep', 'dataEmissao', 'valorAquisicao']));
  });
});
