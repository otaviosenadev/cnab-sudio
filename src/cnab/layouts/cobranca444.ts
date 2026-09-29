import type { FieldOption, FieldSpec, Issue, LayoutSpec } from '../types';
import { alfa, blank, date6, decimal, fixed, money, num, opts, pick, seq } from '../dsl';
import { groupTitulos, rawOf } from '../records';
import { cnabDateToIso, isoToCnabDate, nossoNumeroDv, normalizeText, todayIso } from '../format';
import { finalizeSequential444 } from './common';

/**
 * CNAB 444 — Cobrança bancária por remessa
 */

export const COBRANCA444_OCORRENCIAS: FieldOption[] = [
  { value: '01', label: 'Remessa (registro do título)', category: 'entrada' },
  { value: '02', label: 'Pedido de baixa', category: 'baixa' },
  { value: '04', label: 'Concessão de abatimento', category: 'instrucao' },
  { value: '06', label: 'Alteração de vencimento', category: 'instrucao' },
  { value: '07', label: 'Atualização do nº de controle do participante', category: 'instrucao' },
  { value: '08', label: 'Atualização do nº do documento (Seu Número)', category: 'instrucao' },
  { value: '09', label: 'Instrução para protesto', category: 'instrucao' },
  { value: '10', label: 'Atualização/inclusão da chave da NF', category: 'instrucao' },
  { value: '19', label: 'Desistência/cancelamento de protesto', category: 'instrucao' },
  { value: '23', label: 'Instrução de titularidade', category: 'instrucao' },
  { value: '31', label: 'Alteração de outros dados', category: 'instrucao' },
  { value: '33', label: 'Devolução de titularidade', category: 'instrucao' },
];

const ESPECIES = opts({
  '01': 'Duplicata',
  '02': 'Nota promissória',
  '03': 'Nota de seguro',
  '04': 'Cobrança seriada',
  '05': 'Recibo',
  '10': 'Letras de câmbio',
  '11': 'Nota de débito',
  '12': 'Duplicata de serviço',
  '31': 'Cartão de crédito',
  '32': 'Boleto de proposta',
  '99': 'Outros',
});

const today6 = () => isoToCnabDate(todayIso(), 6);

function recebedor(n: 1 | 2 | 3): FieldSpec[] {
  const o = (n - 1) * 117;
  const nome = ['primeiro', 'segundo', 'terceiro'][n - 1];
  return [
    num(`r${n}Banco`, `Recebedor ${n} — banco`, 44 + o, 46 + o, { input: 'text' }),
    num(`r${n}Agencia`, `Recebedor ${n} — agência`, 47 + o, 51 + o, { input: 'text' }),
    alfa(`r${n}DvAgencia`, `Recebedor ${n} — DV agência`, 52 + o, 52 + o),
    num(`r${n}Conta`, `Recebedor ${n} — conta corrente`, 53 + o, 64 + o, { input: 'text' }),
    alfa(`r${n}DvConta`, `Recebedor ${n} — DV conta`, 65 + o, 65 + o),
    decimal(`r${n}Percentual`, `Recebedor ${n} — percentual`, 66 + o, 80 + o, 2),
    alfa(`r${n}Nome`, `Razão social do ${nome} recebedor`, 81 + o, 120 + o, { span: 2 }),
    blank(121 + o, 157 + o),
    blank(158 + o, 160 + o, 'num', 'Zeros'),
  ];
}

export const cobranca444: LayoutSpec = {
  id: 'cnab444-cobranca',
  name: 'CNAB 444 · Cobrança',
  family: 'CNAB 444',
  variant: 'Cobrança bancária',
  lineLength: 444,
  description: 'Cobrança bancária por remessa: registro de boletos, baixas, split de pagamentos e instruções.',
  labels: {
    cedente: 'Cedente',
    cedenteHint: 'Beneficiário (carteira/agência/conta, pos. 21–37) e sacador/avalista (pos. 335–394), replicados em todos os títulos.',
    sacado: 'Pagador',
    sacados: 'Pagadores',
  },
  summary: {
    numero: 'seuNumero',
    vencimento: 'vencimento',
    valor: 'valor',
    ocorrencia: 'ocorrencia',
  },
  presets: [
    { id: 'entrada', label: 'Registro de títulos', description: 'Remessa de novos boletos', ocorrencia: '01' },
    { id: 'baixa', label: 'Baixa', description: 'Pedido de baixa de títulos', ocorrencia: '02' },
    { id: 'instrucao', label: 'Alteração de vencimento', description: 'Instrução de prorrogação', ocorrencia: '06' },
  ],
  records: [
    {
      id: 'header',
      label: 'Header',
      short: 'H',
      role: 'header',
      match: (l) => l[0] === '0',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '0'),
        fixed('idArquivo', 'Identificação do arquivo remessa', 2, 2, '1'),
        fixed('literal', 'Literal remessa', 3, 9, 'REMESSA', 'alfa'),
        fixed('codServico', 'Código do serviço', 10, 11, '01'),
        fixed('literalServico', 'Literal do serviço', 12, 26, 'COBRANCA', 'alfa'),
        num('contaEmpresa', 'Nº da conta (sem dígito)', 27, 46, { group: 'arquivo', required: true, span: 2 }),
        alfa('nomeEmpresa', 'Nome da empresa', 47, 76, { group: 'arquivo', required: true, span: 2 }),
        num('numBanco', 'Banco emissor', 77, 79, { group: 'arquivo', required: true, input: 'text', more: true }),
        alfa('nomeBanco', 'Nome do banco', 80, 94, { group: 'arquivo', required: true, more: true }),
        date6('dataGravacao', 'Data de gravação', 95, 100, { group: 'arquivo', required: true, def: today6 }),
        blank(101, 108),
        fixed('sistema', 'Identificação do sistema', 109, 110, 'MX', 'alfa'),
        num('seqRemessa', 'Nº sequencial de remessa', 111, 117, {
          group: 'arquivo',
          required: true,
          def: '1',
          hint: 'Incrementado a cada envio; nunca repetido ou zerado.',
        }),
        blank(118, 438),
        seq(439, 444),
      ],
    },
    {
      id: 'detalhe',
      label: 'Dados do título',
      short: 'D',
      role: 'detail',
      match: (l) => l[0] === '1',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '1'),
        blank(2, 6, 'num', 'Não utilizado'),
        blank(7, 7, 'alfa', 'Não utilizado'),
        blank(8, 12, 'num', 'Não utilizado'),
        blank(13, 19, 'num', 'Não utilizado'),
        blank(20, 20, 'alfa', 'Não utilizado'),
        fixed('zero', 'Identificação da empresa — zero', 21, 21, '0'),
        num('carteira', 'Carteira', 22, 24, { group: 'cedente', share: 'benef.carteira', required: true, input: 'text' }),
        num('agencia', 'Agência (sem dígito)', 25, 29, { group: 'cedente', share: 'benef.agencia', required: true, input: 'text' }),
        num('conta', 'Conta corrente', 30, 36, { group: 'cedente', share: 'benef.conta', required: true, input: 'text' }),
        alfa('dvConta', 'DV conta', 37, 37, { group: 'cedente', share: 'benef.dv', required: true }),
        alfa('controleParticipante', 'Nº de controle do participante', 38, 62, { span: 2, hint: 'Uso da empresa; retornado no arquivo retorno.' }),
        num('bancoDebitado', 'Banco a ser debitado', 63, 65, { more: true, input: 'text' }),
        pick('campoMulta', 'Campo de multa', 66, 66, opts({ '0': 'Sem multa (usa configuração da plataforma)', '2': 'Considerar multa' }), {
          more: true,
          def: '0',
        }),
        decimal('percentualMulta', 'Percentual de multa', 67, 70, 2, { more: true }),
        num('nossoNumero', 'Nosso número', 71, 81, { input: 'text', hint: 'Zeros para o banco gerar.' }),
        alfa('dvNossoNumero', 'DV do nosso número', 82, 82, { hint: 'Módulo 11 base 7 com a carteira.' }),
        money('descontoDia', 'Desconto por dia', 83, 92, { more: true }),
        blank(93, 93, 'num', 'Não utilizado'),
        blank(94, 94, 'alfa', 'Não utilizado'),
        blank(95, 104, 'alfa', 'Não utilizado'),
        blank(105, 105, 'alfa', 'Não utilizado'),
        blank(106, 106, 'alfa', 'Não utilizado'),
        alfa('qtdPagamentos', 'Quantidade de pagamentos possíveis', 107, 108, { def: '01', more: true }),
        pick('ocorrencia', 'Identificação da ocorrência', 109, 110, COBRANCA444_OCORRENCIAS, { required: true, def: '01', span: 2 }),
        alfa('seuNumero', 'Nº do documento (Seu Número)', 111, 120, { required: true }),
        date6('vencimento', 'Vencimento', 121, 126, { required: true }),
        money('valor', 'Valor do título', 127, 139, { required: true }),
        blank(140, 142, 'num', 'Banco encarregado da cobrança'),
        blank(143, 147, 'num', 'Agência depositária'),
        pick('especie', 'Espécie do título', 148, 149, ESPECIES, { required: true, def: '01' }),
        fixed('identificacao', 'Identificação', 150, 150, 'N', 'alfa'),
        date6('dataEmissao', 'Data de emissão', 151, 156, { required: true }),
        blank(157, 158, 'num', 'Não utilizado'),
        blank(159, 160, 'num', 'Não utilizado'),
        money('moraDia', 'Mora por dia de atraso', 161, 173, { more: true }),
        date6('dataLimiteDesconto', 'Data limite p/ desconto', 174, 179, { more: true }),
        money('valorDesconto', 'Valor do desconto', 180, 192, { more: true }),
        money('valorIOF', 'Valor do IOF', 193, 205, { more: true }),
        money('valorAbatimento', 'Valor do abatimento', 206, 218, { more: true }),
        pick('pagadorTipo', 'Tipo de inscrição', 219, 220, opts({ '01': 'CPF', '02': 'CNPJ' }), {
          group: 'sacado',
          share: 'sacado.tipo',
          required: true,
          def: '02',
        }),
        num('pagadorDoc', 'CPF/CNPJ', 221, 234, {
          input: 'doc',
          cpfSpaces: true,
          group: 'sacado',
          share: 'sacado.doc',
          required: true,
          hint: 'CPF: brancos à esquerda.',
        }),
        alfa('pagadorNome', 'Nome', 235, 274, { group: 'sacado', share: 'sacado.nome', required: true, span: 2 }),
        alfa('pagadorEndereco', 'Endereço completo', 275, 314, { group: 'sacado', share: 'sacado.endereco', required: true, span: 3 }),
        alfa('mensagem1', 'Primeira mensagem', 315, 326, { more: true }),
        num('pagadorCep', 'CEP', 327, 334, { input: 'cep', group: 'sacado', share: 'sacado.cep', required: true }),
        num('sacadorDoc', 'Sacador/avalista — CNPJ/CPF', 335, 349, {
          input: 'doc15',
          group: 'cedente',
          share: 'sacador.doc',
          hint: 'CNPJ: 0+CNPJ · CPF: CPF+0000+dígitos.',
        }),
        blank(350, 351),
        alfa('sacadorNome', 'Sacador/avalista — nome (ou 2ª mensagem)', 352, 394, { group: 'cedente', share: 'sacador.nome', span: 3 }),
        num('chaveNF', 'Chave da nota fiscal', 395, 438, { input: 'text', span: 4 }),
        seq(439, 444),
      ],
    },
    {
      id: 'email',
      label: 'E-mail / mensagem / descontos',
      short: '2',
      role: 'child',
      section: 'E-mail, mensagem e descontos adicionais',
      description: 'Registro 2 (opcional).',
      match: (l) => l[0] === '2',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '2'),
        alfa('emailMensagem', 'E-mail do pagador ou mensagem', 2, 321, { input: 'email', keepCase: true, span: 4 }),
        date6('dataDesconto2', 'Data limite desconto 2', 322, 327),
        money('valorDesconto2', 'Valor do desconto 2', 328, 340),
        date6('dataDesconto3', 'Data limite desconto 3', 341, 346),
        money('valorDesconto3', 'Valor do desconto 3', 347, 359),
        blank(360, 438),
        seq(439, 444),
      ],
    },
    {
      id: 'split',
      label: 'Split de pagamentos',
      short: '3',
      role: 'child',
      section: 'Split de pagamentos',
      description: 'Registro 3 (opcional) — até 3 recebedores.',
      match: (l) => l[0] === '3',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '3'),
        num('idEmpresa', 'Carteira, agência e conta', 2, 17, { input: 'text', span: 2 }),
        alfa('nossoNumero', 'Nosso número do título', 18, 29),
        fixed('codRateio', 'Código p/ cálculo do rateio', 30, 30, '1'),
        fixed('tipoValor', 'Tipo de valor informado', 31, 31, '1'),
        blank(32, 43),
        ...recebedor(1),
        ...recebedor(2),
        ...recebedor(3),
        blank(395, 438, 'num', 'Zeros'),
        seq(439, 444),
      ],
    },
    {
      id: 'avalista',
      label: 'Pagador / sacador avalista',
      short: '7',
      role: 'child',
      section: 'Endereço do sacador/avalista',
      description: 'Registro 7 (opcional).',
      match: (l) => l[0] === '7',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '7'),
        alfa('endereco', 'Endereço', 2, 46, { span: 3 }),
        num('cep', 'CEP', 47, 54, { input: 'cep' }),
        alfa('cidade', 'Cidade', 55, 74, { span: 2 }),
        alfa('uf', 'UF', 75, 76),
        blank(77, 366, 'alfa', 'Reserva'),
        num('carteira', 'Carteira', 367, 369, { input: 'text' }),
        num('agencia', 'Agência do beneficiário', 370, 374, { input: 'text' }),
        num('conta', 'Conta corrente', 375, 381, { input: 'text' }),
        alfa('dvConta', 'DV conta', 382, 382),
        num('nossoNumero', 'Nosso número', 383, 393, { input: 'text' }),
        alfa('dvNossoNumero', 'DV nosso número', 394, 394),
        blank(395, 438, 'num', 'Zeros'),
        seq(439, 444),
      ],
    },
    {
      id: 'trailer',
      label: 'Trailer',
      short: 'T',
      role: 'trailer',
      match: (l) => l[0] === '9',
      fields: [fixed('tipo', 'Identificação do registro', 1, 1, '9'), blank(2, 438), seq(439, 444)],
    },
  ],
  finalize: finalizeSequential444,
  fileName(doc, layout) {
    const header = doc.records.find((r) => r.type === 'header');
    const date = header ? rawOf(layout, header, 'dataGravacao') : '';
    const iso = cnabDateToIso(date) ?? todayIso();
    const ddmmaaaa = isoToCnabDate(iso, 8);
    const nome = header ? normalizeText(rawOf(layout, header, 'nomeEmpresa')).replace(/[^A-Z0-9]/g, '') : '';
    return `CB${ddmmaaaa}${(nome || 'EMPRESA').slice(0, 10).toLowerCase()}.rem`;
  },
  crossValidate(doc, layout) {
    const issues: Issue[] = [];
    for (const t of groupTitulos(layout, doc.records)) {
      const nn = rawOf(layout, t.primary, 'nossoNumero');
      const dv = rawOf(layout, t.primary, 'dvNossoNumero').trim();
      if (/^\d{11}$/.test(nn) && !/^0+$/.test(nn)) {
        const expected = nossoNumeroDv(rawOf(layout, t.primary, 'carteira'), nn);
        if (dv !== expected)
          issues.push({
            level: 'warning',
            message: `DV do nosso número deveria ser "${expected}".`,
            uid: t.uid,
            field: 'dvNossoNumero',
          });
      }
    }
    return issues;
  },
};
