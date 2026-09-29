import type { FieldOption, FieldSpec, LayoutSpec, RecordInstance } from '../types';
import { alfa, blank, date8, fixed, money, num, opts, pick, writeAuto } from '../dsl';
import { fieldOf, rawOf, specOf } from '../records';
import { getRaw, setRaw } from '../codec';
import { cnabDateToIso, isoToCnabDate, nowTime6, onlyDigits, todayIso } from '../format';

/**
 * CNAB 240 posições — Títulos em Cobrança (remessa)
 */

export const COBRANCA240_MOVIMENTOS: FieldOption[] = [
  { value: '01', label: 'Entrada de títulos', category: 'entrada' },
  { value: '02', label: 'Pedido de baixa', category: 'baixa' },
  { value: '03', label: 'Protesto para fins falimentares', category: 'instrucao' },
  { value: '04', label: 'Concessão de abatimento', category: 'instrucao' },
  { value: '05', label: 'Cancelamento de abatimento', category: 'instrucao' },
  { value: '06', label: 'Alteração de vencimento', category: 'instrucao' },
  { value: '07', label: 'Concessão de desconto', category: 'instrucao' },
  { value: '08', label: 'Cancelamento de desconto', category: 'instrucao' },
  { value: '09', label: 'Protestar', category: 'instrucao' },
  { value: '10', label: 'Sustar protesto e baixar título', category: 'baixa' },
  { value: '11', label: 'Sustar protesto e manter em carteira', category: 'instrucao' },
  { value: '12', label: 'Alteração de juros de mora', category: 'instrucao' },
  { value: '13', label: 'Dispensar cobrança de juros de mora', category: 'instrucao' },
  { value: '14', label: 'Alteração de valor/percentual de multa', category: 'instrucao' },
  { value: '15', label: 'Dispensar cobrança de multa', category: 'instrucao' },
  { value: '16', label: 'Alteração de valor/data de desconto', category: 'instrucao' },
  { value: '17', label: 'Não conceder desconto', category: 'instrucao' },
  { value: '18', label: 'Alteração do valor de abatimento', category: 'instrucao' },
  { value: '19', label: 'Prazo limite de recebimento — alterar', category: 'instrucao' },
  { value: '20', label: 'Prazo limite de recebimento — dispensar', category: 'instrucao' },
  { value: '21', label: 'Alterar nº do título dado pelo beneficiário', category: 'instrucao' },
  { value: '22', label: 'Alterar nº de controle do participante', category: 'instrucao' },
  { value: '23', label: 'Alterar dados do pagador', category: 'instrucao' },
  { value: '24', label: 'Alterar dados do sacador/avalista', category: 'instrucao' },
  { value: '30', label: 'Recusa da alegação do pagador', category: 'instrucao' },
  { value: '31', label: 'Alteração de outros dados', category: 'instrucao' },
  { value: '33', label: 'Alteração dos dados do rateio de crédito', category: 'instrucao' },
  { value: '34', label: 'Cancelamento dos dados do rateio de crédito', category: 'instrucao' },
  { value: '35', label: 'Desagendamento do débito automático', category: 'instrucao' },
  { value: '40', label: 'Alteração de carteira', category: 'instrucao' },
  { value: '41', label: 'Cancelar protesto', category: 'instrucao' },
  { value: '42', label: 'Alteração de espécie de título', category: 'instrucao' },
  { value: '43', label: 'Transferência de carteira/modalidade', category: 'instrucao' },
  { value: '44', label: 'Alteração de contrato de cobrança', category: 'instrucao' },
  { value: '45', label: 'Negativação sem protesto', category: 'instrucao' },
  { value: '46', label: 'Baixa de título negativado sem protesto', category: 'baixa' },
  { value: '47', label: 'Alteração do valor nominal do título', category: 'instrucao' },
  { value: '48', label: 'Alteração do valor mínimo/percentual', category: 'instrucao' },
  { value: '49', label: 'Alteração do valor máximo/percentual', category: 'instrucao' },
  { value: '61', label: 'Inclusão/manutenção de QR Code Pix', category: 'instrucao' },
];

const ESPECIES = opts({
  '01': 'CH — Cheque',
  '02': 'DM — Duplicata mercantil',
  '03': 'DMI — Duplicata mercantil p/ indicação',
  '04': 'DS — Duplicata de serviço',
  '05': 'DSI — Duplicata de serviço p/ indicação',
  '06': 'DR — Duplicata rural',
  '07': 'LC — Letra de câmbio',
  '08': 'NCC — Nota de crédito comercial',
  '09': 'NCE — Nota de crédito à exportação',
  '10': 'NCI — Nota de crédito industrial',
  '11': 'NCR — Nota de crédito rural',
  '12': 'NP — Nota promissória',
  '13': 'NPR — Nota promissória rural',
  '14': 'TM — Triplicata mercantil',
  '15': 'TS — Triplicata de serviço',
  '16': 'NS — Nota de seguro',
  '17': 'RC — Recibo',
  '18': 'FAT — Fatura',
  '19': 'ND — Nota de débito',
  '20': 'AP — Apólice de seguro',
  '21': 'ME — Mensalidade escolar',
  '22': 'PC — Parcela de consórcio',
  '23': 'NF — Nota fiscal',
  '24': 'DD — Documento de dívida',
  '25': 'Cédula de produto rural',
  '26': 'Warrant',
  '27': 'Dívida ativa de estado',
  '28': 'Dívida ativa de município',
  '29': 'Dívida ativa da União',
  '30': 'Encargos condominiais',
  '31': 'CC — Cartão de crédito',
  '32': 'BDP — Boleto de proposta',
  '99': 'Outros',
});

const INSCRICAO = opts({ '1': 'CPF', '2': 'CNPJ' });
const DESCONTO = opts({
  '0': 'Sem desconto',
  '1': 'Valor fixo até a data',
  '2': 'Percentual até a data',
  '3': 'Valor por antecipação (dia corrido)',
  '4': 'Valor por antecipação (dia útil)',
  '5': 'Percentual sobre valor nominal (dia corrido)',
  '6': 'Percentual sobre valor nominal (dia útil)',
  '7': 'Cancelamento de desconto',
});

const today8 = () => isoToCnabDate(todayIso(), 8);

/** Campos de controle comuns (posições 1–8) de todo registro 240. */
function control(tipo: string, lote?: string): FieldSpec[] {
  return [
    num('banco', 'Código do banco na compensação', 1, 3, { group: 'control', share: 'banco.codigo', input: 'text' }),
    lote !== undefined
      ? fixed('lote', 'Lote de serviço', 4, 7, lote)
      : num('lote', 'Lote de serviço', 4, 7, { auto: true, group: 'control' }),
    fixed('tipo', 'Tipo de registro', 8, 8, tipo),
  ];
}

function segmento(letra: string): FieldSpec[] {
  return [
    ...control('3'),
    num('seqLote', 'Nº sequencial do registro no lote', 9, 13, { auto: true, group: 'control' }),
    fixed('segmento', 'Código do segmento', 14, 14, letra, 'alfa'),
    blank(15, 15),
  ];
}

const isSeg = (l: string, s: string) => l[7] === '3' && l[13] === s;

export const cobranca240: LayoutSpec = {
  id: 'cnab240-cobranca',
  name: 'CNAB 240 · Cobrança',
  family: 'CNAB 240',
  variant: 'Cobrança',
  lineLength: 240,
  description: 'Títulos em cobrança no padrão de 240 posições (segmentos P, Q, R e S).',
  labels: {
    cedente: 'Cedente · beneficiário',
    cedenteHint: 'Empresa conveniada — replicada no header de arquivo, header de lote e segmentos P.',
    sacado: 'Pagador',
    sacados: 'Pagadores',
  },
  summary: {
    numero: 'numeroDocumento',
    vencimento: 'vencimento',
    valor: 'valor',
    ocorrencia: 'movimento',
  },
  presets: [
    { id: 'entrada', label: 'Entrada de títulos', description: 'Registro de novos títulos em cobrança', ocorrencia: '01' },
    { id: 'baixa', label: 'Pedido de baixa', description: 'Baixa de títulos registrados', ocorrencia: '02' },
    { id: 'instrucao', label: 'Alteração de vencimento', description: 'Instrução de prorrogação', ocorrencia: '06' },
  ],
  records: [
    {
      id: 'headerArquivo',
      label: 'Header de arquivo',
      short: 'H',
      role: 'header',
      match: (l) => l[7] === '0',
      fields: [
        ...control('0', '0000').map((f) => (f.id === 'banco' ? { ...f, group: 'arquivo' as const, required: true, label: 'Código do banco' } : f)),
        blank(9, 17),
        pick('tipoInscricao', 'Tipo de inscrição', 18, 18, INSCRICAO, { group: 'cedente', share: 'emp.tipo', required: true, def: '2' }),
        num('inscricao', 'CPF/CNPJ', 19, 32, { input: 'doc', group: 'cedente', share: 'emp.doc', required: true }),
        alfa('convenio', 'Código do convênio no banco', 33, 52, { group: 'cedente', share: 'emp.convenio', span: 2 }),
        num('agencia', 'Agência', 53, 57, { group: 'cedente', share: 'emp.agencia', required: true, input: 'text' }),
        alfa('dvAgencia', 'DV agência', 58, 58, { group: 'cedente', share: 'emp.dvAgencia' }),
        num('conta', 'Conta corrente', 59, 70, { group: 'cedente', share: 'emp.conta', required: true, input: 'text' }),
        alfa('dvConta', 'DV conta', 71, 71, { group: 'cedente', share: 'emp.dvConta' }),
        alfa('dvAgConta', 'DV agência/conta', 72, 72, { group: 'cedente', share: 'emp.dvAgConta', more: true }),
        alfa('nomeEmpresa', 'Nome da empresa', 73, 102, { group: 'cedente', share: 'emp.nome', required: true, span: 2 }),
        alfa('nomeBanco', 'Nome do banco', 103, 132, { group: 'arquivo', span: 2 }),
        blank(133, 142),
        pick('codigoRemessa', 'Código remessa/retorno', 143, 143, opts({ '1': 'Remessa', '2': 'Retorno' }), {
          group: 'arquivo',
          def: '1',
          more: true,
        }),
        date8('dataGeracao', 'Data de geração', 144, 151, { group: 'arquivo', required: true, def: today8 }),
        num('horaGeracao', 'Hora de geração', 152, 157, { group: 'arquivo', input: 'time6', def: nowTime6, more: true }),
        num('nsa', 'Nº sequencial do arquivo (NSA)', 158, 163, { group: 'arquivo', required: true, def: '1' }),
        num('versaoLayout', 'Versão do layout do arquivo', 164, 166, { group: 'arquivo', def: '103', more: true, input: 'text' }),
        num('densidade', 'Densidade de gravação', 167, 171, { group: 'arquivo', more: true, input: 'text' }),
        alfa('reservadoBanco', 'Reservado ao banco', 172, 191, { group: 'arquivo', more: true }),
        alfa('reservadoEmpresa', 'Reservado à empresa', 192, 211, { group: 'arquivo', more: true }),
        blank(212, 240),
      ],
    },
    {
      id: 'headerLote',
      label: 'Header de lote',
      short: 'HL',
      role: 'batchHeader',
      match: (l) => l[7] === '1',
      fields: [
        ...control('1'),
        fixed('operacao', 'Tipo de operação', 9, 9, 'R', 'alfa'),
        fixed('servico', 'Tipo de serviço', 10, 11, '01'),
        blank(12, 13),
        num('versaoLote', 'Versão do layout do lote', 14, 16, { group: 'arquivo', def: '060', more: true, input: 'text' }),
        blank(17, 17),
        pick('tipoInscricao', 'Tipo de inscrição', 18, 18, INSCRICAO, { group: 'cedente', share: 'emp.tipo' }),
        num('inscricao', 'CPF/CNPJ', 19, 33, { input: 'doc', group: 'cedente', share: 'emp.doc' }),
        alfa('convenio', 'Código do convênio', 34, 53, { group: 'cedente', share: 'emp.convenio' }),
        num('agencia', 'Agência', 54, 58, { group: 'cedente', share: 'emp.agencia', input: 'text' }),
        alfa('dvAgencia', 'DV agência', 59, 59, { group: 'cedente', share: 'emp.dvAgencia' }),
        num('conta', 'Conta corrente', 60, 71, { group: 'cedente', share: 'emp.conta', input: 'text' }),
        alfa('dvConta', 'DV conta', 72, 72, { group: 'cedente', share: 'emp.dvConta' }),
        alfa('dvAgConta', 'DV agência/conta', 73, 73, { group: 'cedente', share: 'emp.dvAgConta' }),
        alfa('nomeEmpresa', 'Nome da empresa', 74, 103, { group: 'cedente', share: 'emp.nome' }),
        alfa('mensagem1', 'Mensagem 1', 104, 143, { group: 'arquivo', more: true, span: 2 }),
        alfa('mensagem2', 'Mensagem 2', 144, 183, { group: 'arquivo', more: true, span: 2 }),
        num('numeroRemessa', 'Nº remessa/retorno', 184, 191, { group: 'arquivo', required: true, def: '1' }),
        date8('dataGravacao', 'Data de gravação da remessa', 192, 199, { group: 'arquivo', required: true, def: today8 }),
        date8('dataCredito', 'Data do crédito', 200, 207, { group: 'arquivo', more: true, hint: 'Informação de retorno.' }),
        blank(208, 240),
      ],
    },
    {
      id: 'segP',
      label: 'Segmento P',
      short: 'P',
      role: 'detail',
      match: (l) => isSeg(l, 'P'),
      fields: [
        ...segmento('P'),
        pick('movimento', 'Código de movimento remessa', 16, 17, COBRANCA240_MOVIMENTOS, { required: true, def: '01', span: 2 }),
        num('agencia', 'Agência mantenedora', 18, 22, { group: 'control', share: 'emp.agencia', input: 'text' }),
        alfa('dvAgencia', 'DV agência', 23, 23, { group: 'control', share: 'emp.dvAgencia' }),
        num('conta', 'Conta corrente', 24, 35, { group: 'control', share: 'emp.conta', input: 'text' }),
        alfa('dvConta', 'DV conta', 36, 36, { group: 'control', share: 'emp.dvConta' }),
        alfa('dvAgConta', 'DV agência/conta', 37, 37, { group: 'control', share: 'emp.dvAgConta' }),
        alfa('nossoNumero', 'Nosso número', 38, 57, { span: 2, hint: 'Identificação do título no banco.' }),
        pick('carteira', 'Carteira', 58, 58, opts({
          '1': 'Cobrança simples',
          '2': 'Cobrança vinculada',
          '3': 'Cobrança caucionada',
          '4': 'Cobrança descontada',
          '5': 'Cobrança variant',
          '6': 'Cobrança cessão',
        }), { def: '1', more: true }),
        pick('cadastramento', 'Forma de cadastramento', 59, 59, opts({
          '1': 'Com cadastramento (registrada)',
          '2': 'Sem cadastramento',
          '3': 'Com cadastramento / recusa do débito automático',
        }), { def: '1', more: true }),
        pick('tipoDocumento', 'Tipo de documento', 60, 60, opts({ '1': 'Tradicional', '2': 'Escritural' }), { def: '1', more: true, kind: 'alfa' }),
        pick('emissaoBoleto', 'Emissão do boleto', 61, 61, opts({
          '1': 'Banco emite',
          '2': 'Cliente emite',
          '3': 'Banco pré-emite e cliente complementa',
          '4': 'Banco reemite',
          '5': 'Banco não reemite',
          '7': 'Banco emitente — aberta',
          '8': 'Banco emitente — auto-envelopável',
        }), { def: '2', more: true }),
        pick('distribuicao', 'Distribuição do boleto', 62, 62, opts({
          '1': 'Banco distribui',
          '2': 'Cliente distribui',
          '3': 'Banco envia e-mail',
          '4': 'Banco envia SMS',
          P: 'Banco registra, cliente distribui (Pix)',
          Q: 'Banco registra e distribui (Pix)',
        }), { def: '2', more: true, kind: 'alfa' }),
        alfa('numeroDocumento', 'Nº do documento de cobrança', 63, 77, { required: true }),
        date8('vencimento', 'Vencimento', 78, 85, { required: true }),
        money('valor', 'Valor nominal', 86, 100, { required: true }),
        num('agenciaCobradora', 'Agência cobradora', 101, 105, { more: true, input: 'text' }),
        alfa('dvAgenciaCobradora', 'DV agência cobradora', 106, 106, { more: true }),
        pick('especie', 'Espécie do título', 107, 108, ESPECIES, { required: true, def: '02' }),
        pick('aceite', 'Aceite', 109, 109, opts({ A: 'Aceite', N: 'Não aceite' }), { kind: 'alfa', def: 'N' }),
        date8('dataEmissao', 'Data de emissão', 110, 117, { required: true }),
        pick('codJuros', 'Código de juros de mora', 118, 118, opts({ '1': 'Valor por dia', '2': 'Taxa mensal', '3': 'Isento' }), {
          def: '3',
          more: true,
        }),
        date8('dataJuros', 'Data de juros de mora', 119, 126, { more: true }),
        money('juros', 'Juros de mora por dia/taxa', 127, 141, { more: true }),
        pick('codDesconto1', 'Código do desconto 1', 142, 142, DESCONTO, { def: '0', more: true }),
        date8('dataDesconto1', 'Data do desconto 1', 143, 150, { more: true }),
        money('desconto1', 'Valor/percentual do desconto 1', 151, 165, { more: true }),
        money('iof', 'Valor do IOF', 166, 180, { more: true }),
        money('abatimento', 'Valor do abatimento', 181, 195, { more: true }),
        alfa('usoEmpresa', 'Identificação do título na empresa', 196, 220, { span: 2 }),
        pick('codProtesto', 'Código para protesto', 221, 221, opts({
          '1': 'Protestar dias corridos',
          '2': 'Protestar dias úteis',
          '3': 'Não protestar',
          '4': 'Protestar fim falimentar — dias úteis',
          '5': 'Protestar fim falimentar — dias corridos',
          '8': 'Negativação sem protesto',
          '9': 'Cancelamento protesto automático',
        }), { def: '3', more: true }),
        num('prazoProtesto', 'Dias para protesto', 222, 223, { more: true }),
        pick('codBaixa', 'Código para baixa/devolução', 224, 224, opts({
          '1': 'Baixar / devolver',
          '2': 'Não baixar / não devolver',
          '3': 'Cancelar prazo para baixa / devolução',
        }), { more: true }),
        num('prazoBaixa', 'Dias para baixa/devolução', 225, 227, { more: true, input: 'text' }),
        pick('moeda', 'Código da moeda', 228, 229, opts({ '09': 'Real' }), { def: '09', more: true }),
        num('contrato', 'Nº do contrato da operação de crédito', 230, 239, { more: true, input: 'text' }),
        alfa('usoLivre', 'Uso livre banco/empresa', 240, 240, { more: true }),
      ],
    },
    {
      id: 'segQ',
      label: 'Segmento Q',
      short: 'Q',
      role: 'child',
      requiredChild: true,
      section: 'Sacador/avalista e banco correspondente',
      description: 'Dados do pagador (obrigatório).',
      match: (l) => isSeg(l, 'Q'),
      fields: [
        ...segmento('Q'),
        num('movimento', 'Código de movimento remessa', 16, 17, { auto: true, group: 'control' }),
        pick('tipoInscricao', 'Tipo de inscrição', 18, 18, INSCRICAO, { group: 'sacado', share: 'sacado.tipo', required: true, def: '2' }),
        num('inscricao', 'CPF/CNPJ', 19, 33, { input: 'doc', group: 'sacado', share: 'sacado.doc', required: true }),
        alfa('nome', 'Nome', 34, 73, { group: 'sacado', share: 'sacado.nome', required: true, span: 2 }),
        alfa('endereco', 'Endereço', 74, 113, { group: 'sacado', share: 'sacado.endereco', required: true, span: 2 }),
        alfa('bairro', 'Bairro', 114, 128, { group: 'sacado', share: 'sacado.bairro' }),
        num('cep', 'CEP', 129, 136, { input: 'cep', group: 'sacado', share: 'sacado.cep', required: true }),
        alfa('cidade', 'Cidade', 137, 151, { group: 'sacado', share: 'sacado.cidade', required: true }),
        alfa('uf', 'UF', 152, 153, { group: 'sacado', share: 'sacado.uf', required: true }),
        pick('tipoInscricaoSacador', 'Sacador/avalista — tipo de inscrição', 154, 154, opts({ '0': 'Não informado', '1': 'CPF', '2': 'CNPJ' }), {
          more: true,
        }),
        num('inscricaoSacador', 'Sacador/avalista — CPF/CNPJ', 155, 169, { input: 'doc', more: true }),
        alfa('nomeSacador', 'Sacador/avalista — nome', 170, 209, { more: true, span: 2 }),
        num('bancoCorrespondente', 'Banco correspondente', 210, 212, { more: true, input: 'text' }),
        alfa('nossoNumeroCorrespondente', 'Nosso nº no banco correspondente', 213, 232, { more: true, span: 2 }),
        blank(233, 240),
      ],
    },
    {
      id: 'segR',
      label: 'Segmento R',
      short: 'R',
      role: 'child',
      section: 'Descontos, multa e mensagens',
      description: 'Segmento R (opcional).',
      match: (l) => isSeg(l, 'R'),
      fields: [
        ...segmento('R'),
        num('movimento', 'Código de movimento remessa', 16, 17, { auto: true, group: 'control' }),
        pick('codDesconto2', 'Código do desconto 2', 18, 18, DESCONTO, { def: '0' }),
        date8('dataDesconto2', 'Data do desconto 2', 19, 26),
        money('desconto2', 'Desconto 2', 27, 41),
        pick('codDesconto3', 'Código do desconto 3', 42, 42, DESCONTO, { def: '0' }),
        date8('dataDesconto3', 'Data do desconto 3', 43, 50),
        money('desconto3', 'Desconto 3', 51, 65),
        pick('codMulta', 'Código da multa', 66, 66, opts({ '0': 'Isento', '1': 'Valor fixo', '2': 'Percentual' }), { def: '0', kind: 'alfa' }),
        date8('dataMulta', 'Data da multa', 67, 74),
        money('multa', 'Valor/percentual da multa', 75, 89),
        alfa('infoPagador', 'Informação ao pagador', 90, 99, { more: true }),
        alfa('mensagem3', 'Mensagem 3', 100, 139, { span: 2 }),
        alfa('mensagem4', 'Mensagem 4', 140, 179, { span: 2 }),
        blank(180, 199),
        num('codOcorPagador', 'Código de ocorrência do pagador', 200, 207, { more: true, input: 'text' }),
        num('bancoDebito', 'Banco p/ débito', 208, 210, { more: true, input: 'text' }),
        num('agenciaDebito', 'Agência p/ débito', 211, 215, { more: true, input: 'text' }),
        alfa('dvAgenciaDebito', 'DV agência débito', 216, 216, { more: true }),
        num('contaDebito', 'Conta p/ débito', 217, 228, { more: true, input: 'text' }),
        alfa('dvContaDebito', 'DV conta débito', 229, 229, { more: true }),
        alfa('dvAgContaDebito', 'DV ag/conta débito', 230, 230, { more: true }),
        num('avisoDebito', 'Aviso para débito automático', 231, 231, { more: true, input: 'text' }),
        blank(232, 240),
      ],
    },
    {
      id: 'segS',
      label: 'Segmento S',
      short: 'S',
      role: 'child',
      section: 'Impressão (segmento S)',
      description: 'Segmento S (opcional) — conteúdo varia conforme o tipo de impressão.',
      match: (l) => isSeg(l, 'S'),
      fields: [
        ...segmento('S'),
        num('movimento', 'Código de movimento remessa', 16, 17, { auto: true, group: 'control' }),
        pick('tipoImpressao', 'Tipo de impressão', 18, 18, opts({ '1': 'Frente do boleto', '2': 'Verso do boleto', '3': 'Corpo de instruções' }), {
          def: '3',
        }),
        alfa('conteudo', 'Conteúdo (varia conforme o tipo de impressão)', 19, 240, { span: 4 }),
      ],
    },
    {
      id: 'trailerLote',
      label: 'Trailer de lote',
      short: 'TL',
      role: 'batchTrailer',
      match: (l) => l[7] === '5',
      fields: [
        ...control('5'),
        blank(9, 17),
        num('qtdRegistros', 'Quantidade de registros no lote', 18, 23, { auto: true, group: 'control' }),
        num('qtdSimples', 'Cobrança simples — quantidade', 24, 29, { group: 'control' }),
        money('valorSimples', 'Cobrança simples — valor total', 30, 46, { group: 'control' }),
        num('qtdVinculada', 'Cobrança vinculada — quantidade', 47, 52, { group: 'control' }),
        money('valorVinculada', 'Cobrança vinculada — valor total', 53, 69, { group: 'control' }),
        num('qtdCaucionada', 'Cobrança caucionada — quantidade', 70, 75, { group: 'control' }),
        money('valorCaucionada', 'Cobrança caucionada — valor total', 76, 92, { group: 'control' }),
        num('qtdDescontada', 'Cobrança descontada — quantidade', 93, 98, { group: 'control' }),
        money('valorDescontada', 'Cobrança descontada — valor total', 99, 115, { group: 'control' }),
        alfa('aviso', 'Nº do aviso de lançamento', 116, 123, { group: 'control' }),
        blank(124, 240),
      ],
    },
    {
      id: 'trailerArquivo',
      label: 'Trailer de arquivo',
      short: 'T',
      role: 'trailer',
      match: (l) => l[7] === '9',
      fields: [
        ...control('9', '9999'),
        blank(9, 17),
        num('qtdLotes', 'Quantidade de lotes do arquivo', 18, 23, { auto: true, group: 'control' }),
        num('qtdRegistros', 'Quantidade de registros do arquivo', 24, 29, { auto: true, group: 'control' }),
        num('qtdContas', 'Qtde. de contas p/ conciliação', 30, 35, { group: 'control' }),
        blank(36, 240),
      ],
    },
  ],
  finalize(records: RecordInstance[], layout: LayoutSpec) {
    let lote = 0;
    let seqInLote = 0;
    let recsInLote = 0;
    let lotes = 0;
    let lastMovimento = '';
    for (const rec of records) {
      const role = specOf(layout, rec.type).role;
      if (role === 'batchHeader') {
        lote += 1;
        lotes += 1;
        seqInLote = 0;
        recsInLote = 1;
        writeAuto(rec, fieldOf(layout, rec, 'lote'), lote);
      } else if (role === 'detail' || role === 'child') {
        seqInLote += 1;
        recsInLote += 1;
        writeAuto(rec, fieldOf(layout, rec, 'lote'), lote);
        writeAuto(rec, fieldOf(layout, rec, 'seqLote'), seqInLote);
        const mov = fieldOf(layout, rec, 'movimento');
        if (mov) {
          if (role === 'detail') lastMovimento = getRaw(rec.raw, mov);
          else if (mov.auto && lastMovimento) rec.raw = setRaw(rec.raw, mov, lastMovimento);
        }
      } else if (role === 'batchTrailer') {
        recsInLote += 1;
        writeAuto(rec, fieldOf(layout, rec, 'lote'), lote);
        writeAuto(rec, fieldOf(layout, rec, 'qtdRegistros'), recsInLote);
      } else if (role === 'trailer') {
        writeAuto(rec, fieldOf(layout, rec, 'qtdLotes'), lotes);
        writeAuto(rec, fieldOf(layout, rec, 'qtdRegistros'), records.length);
      }
    }
  },
  fileName(doc, layout) {
    const header = doc.records.find((r) => r.type === 'headerArquivo');
    const banco = header ? onlyDigits(rawOf(layout, header, 'banco')) : '';
    const iso = (header && cnabDateToIso(rawOf(layout, header, 'dataGeracao'))) || todayIso();
    const nsa = header ? onlyDigits(rawOf(layout, header, 'nsa')).replace(/^0+(?=\d)/, '') : '1';
    return `CNAB240_${banco || '000'}_${isoToCnabDate(iso, 8)}_${nsa || '1'}.rem`;
  },
};
