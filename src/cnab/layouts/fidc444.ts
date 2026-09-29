import type { FieldOption, Issue, LayoutSpec, RecordInstance } from '../types';
import { alfa, blank, date6, decimal, fixed, money, num, opts, pick, seq } from '../dsl';
import { groupTitulos, rawOf } from '../records';
import { todayIso, isoToCnabDate, onlyDigits, cnabDateToIso } from '../format';
import { finalizeSequential444 } from './common';

/**
 * CNAB 444 — Remessa de títulos para FIDC
 */

export const FIDC_OCORRENCIAS: FieldOption[] = [
  { value: '01', label: 'Remessa — aquisição de títulos', category: 'aquisicao' },
  { value: '06', label: 'Alteração de vencimento (conciliação)', category: 'instrucao' },
  { value: '14', label: 'Pagamento parcial', category: 'liquidacao' },
  { value: '71', label: 'Baixa por recompra (liquidação p/ consultoria)', category: 'recompra' },
  { value: '73', label: 'Recompra parcial com adiantamento', category: 'recompra' },
  { value: '74', label: 'Baixa por recompra (liquidação p/ cedente)', category: 'recompra' },
  { value: '81', label: 'Contrapartida da ocorrência 71', category: 'recompra' },
  { value: '84', label: 'Contrapartida da ocorrência 74', category: 'recompra' },
];

const ESPECIES = opts({
  '01': 'Duplicata',
  '02': 'Nota promissória',
  '03': 'Nota de seguro',
  '51': 'Cheque',
  '60': 'Contrato',
});

const PESSOA = opts({ '01': 'Pessoa física', '02': 'Pessoa jurídica' });

const today6 = () => isoToCnabDate(todayIso(), 6);

export const fidc444: LayoutSpec = {
  id: 'cnab444-fidc',
  name: 'CNAB 444 · FIDC',
  family: 'CNAB 444',
  variant: 'FIDC',
  lineLength: 444,
  description: 'Remessa de títulos para fundos de direitos creditórios: aquisição, baixas, recompras e instruções.',
  labels: {
    cedente: 'Cedente',
    cedenteHint: 'Replicado em todos os títulos (posições 160–161 e 335–394).',
    sacado: 'Sacado',
    sacados: 'Sacados',
  },
  summary: {
    numero: 'numDocumento',
    vencimento: 'vencimento',
    valor: 'valorFace',
    aquisicao: 'valorAquisicao',
    pago: 'valorPago',
    ocorrencia: 'ocorrencia',
  },
  presets: [
    { id: 'aquisicao', label: 'Aquisição', description: 'Cessão de novos títulos ao fundo', ocorrencia: '01' },
    { id: 'liquidacao', label: 'Pagamento parcial', description: 'Informar valores pagos', ocorrencia: '14' },
    { id: 'recompra', label: 'Recompra', description: 'Baixa por recompra pelo cedente', ocorrencia: '74' },
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
        fixed('codServico', 'Código de serviço', 10, 11, '01'),
        fixed('literalServico', 'Literal serviço', 12, 26, 'COBRANCA', 'alfa'),
        num('codOriginador', 'Código do originador (consultoria)', 27, 46, {
          group: 'arquivo',
          required: true,
          hint: 'Fornecido pelo custodiante no cadastramento.',
          span: 2,
        }),
        alfa('nomeOriginador', 'Nome do originador (consultoria)', 47, 76, { group: 'arquivo', required: true, span: 2 }),
        num('numBanco', 'Número do banco', 77, 79, { group: 'arquivo', required: true, input: 'text' }),
        alfa('nomeBanco', 'Nome do banco', 80, 94, { group: 'arquivo', required: true }),
        date6('dataGravacao', 'Data da gravação', 95, 100, { group: 'arquivo', required: true, def: today6 }),
        blank(101, 108),
        fixed('sistema', 'Identificação do sistema', 109, 110, 'MX', 'alfa'),
        num('seqArquivo', 'Nº sequencial do arquivo', 111, 117, { group: 'arquivo', required: true, def: '1' }),
        num('bancoCedente', 'Banco do cedente', 118, 120, { group: 'arquivo', more: true, input: 'text' }),
        num('agenciaCedente', 'Agência do cedente', 121, 125, { group: 'arquivo', more: true, input: 'text' }),
        num('dvAgenciaCedente', 'DV agência', 126, 126, { group: 'arquivo', more: true, input: 'text' }),
        num('contaCedente', 'Conta corrente do cedente', 127, 138, { group: 'arquivo', more: true, input: 'text' }),
        num('dvContaCedente', 'DV conta', 139, 139, { group: 'arquivo', more: true, input: 'text' }),
        blank(140, 438),
        seq(439, 444),
      ],
    },
    {
      id: 'detalhe',
      label: 'Detalhe',
      short: 'D',
      role: 'detail',
      match: (l) => l[0] === '1',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '1'),
        date6('dataCarencia', 'Data de carência', 2, 7, { more: true }),
        pick('tipoJuros', 'Tipo de juros', 8, 8, opts({
          '0': 'Título sem correção',
          '1': 'Juros fixo',
          '2': 'CDI',
          '3': 'IPCA-15',
          '4': 'IPCA',
          '5': 'IGPM',
        }), { more: true, def: '0' }),
        blank(9, 10),
        decimal('taxaJuros', 'Taxa de juros', 11, 20, 7, { more: true, hint: 'Correção fixa ou % do indexador (7 decimais).' }),
        pick('coobrigacao', 'Coobrigação', 21, 22, opts({ '01': 'Com coobrigação', '02': 'Sem coobrigação' }), {
          required: true,
          def: '02',
        }),
        num('caracteristica', 'Característica especial', 23, 24, { more: true, input: 'text', hint: 'SCR 3040 — anexo 8' }),
        num('modalidade', 'Modalidade da operação', 25, 28, { more: true, input: 'text', hint: 'SCR 3040 — anexo 3 (domínio + subdomínio)' }),
        num('natureza', 'Natureza da operação', 29, 30, { more: true, input: 'text', hint: 'SCR 3040 — anexo 2' }),
        num('origemRecurso', 'Origem do recurso', 31, 34, { more: true, input: 'text', hint: 'SCR 3040 — anexo 4' }),
        alfa('classeRisco', 'Classe de risco', 35, 36, { more: true, hint: 'SCR 3040 — anexo 17' }),
        blank(37, 37, 'num', 'Zeros'),
        alfa('seuNumero', 'Nº de controle do participante (Seu Número)', 38, 62, {
          required: true,
          span: 2,
          hint: 'Deve ser o mesmo informado ao banco cobrador.',
        }),
        num('bancoCheque', 'Banco do cheque', 63, 65, { more: true, input: 'text', hint: 'Obrigatório para cheque.' }),
        blank(66, 70),
        blank(71, 81, 'num'),
        blank(82, 82),
        money('valorPago', 'Valor pago', 83, 92, { hint: 'Somente para ocorrências de liquidação.' }),
        alfa('condicaoPapeleta', 'Condição p/ emissão da papeleta', 93, 93, { blank: true, group: 'control' }),
        alfa('papeletaDebito', 'Emite papeleta p/ débito automático', 94, 94, { blank: true, group: 'control' }),
        date6('dataLiquidacao', 'Data da liquidação', 95, 100, { hint: 'Somente para liquidação do título.' }),
        alfa('idOperacaoBanco', 'Identificação da operação do banco', 101, 104, { blank: true, group: 'control' }),
        alfa('rateio', 'Indicador rateio crédito', 105, 105, { blank: true, group: 'control' }),
        alfa('avisoDebito', 'Endereçamento do aviso de débito', 106, 106, { blank: true, group: 'control' }),
        blank(107, 108),
        pick('ocorrencia', 'Identificação da ocorrência', 109, 110, FIDC_OCORRENCIAS, { required: true, def: '01', span: 2 }),
        alfa('numDocumento', 'Nº do documento', 111, 120, { required: true }),
        date6('vencimento', 'Vencimento', 121, 126, { required: true }),
        money('valorFace', 'Valor de face (nominal)', 127, 139, { required: true }),
        num('bancoCobranca', 'Banco encarregado da cobrança', 140, 142, { more: true, input: 'text' }),
        num('agenciaDepositaria', 'Agência depositária', 143, 147, { more: true, input: 'text' }),
        pick('especie', 'Espécie do título', 148, 149, ESPECIES, { required: true, def: '01' }),
        alfa('identificacao', 'Identificação', 150, 150, { blank: true, group: 'control' }),
        date6('dataEmissao', 'Data de emissão', 151, 156, { required: true }),
        num('instrucao1', '1ª instrução', 157, 158, { more: true, input: 'text' }),
        num('instrucao2', '2ª instrução', 159, 159, { more: true, input: 'text' }),
        pick('tipoPessoaCedente', 'Tipo de pessoa do cedente', 160, 161, PESSOA, {
          kind: 'alfa',
          group: 'cedente',
          share: 'cedente.tipo',
          required: true,
          def: '02',
        }),
        decimal('jurosMora', 'Juros/mora por dia de atraso', 162, 173, 7, { more: true }),
        alfa('termoCessao', 'Nº do termo de cessão', 174, 192, { required: true }),
        money('valorAquisicao', 'Valor de aquisição (presente)', 193, 205, { required: true }),
        money('valorAbatimento', 'Valor do abatimento', 206, 218, { more: true }),
        pick('sacadoTipo', 'Tipo de inscrição', 219, 220, PESSOA, { group: 'sacado', share: 'sacado.tipo', required: true, def: '02' }),
        num('sacadoDoc', 'CPF/CNPJ', 221, 234, { input: 'doc', group: 'sacado', share: 'sacado.doc', required: true }),
        alfa('sacadoNome', 'Nome', 235, 274, { group: 'sacado', share: 'sacado.nome', required: true, span: 2 }),
        alfa('sacadoEndereco', 'Endereço completo', 275, 314, { group: 'sacado', share: 'sacado.endereco', required: true, span: 3 }),
        alfa('nfNumero', 'Nº da nota fiscal', 315, 323, { hint: 'Obrigatório para duplicata.' }),
        alfa('nfSerie', 'Série da nota fiscal', 324, 326, { more: true }),
        num('sacadoCep', 'CEP', 327, 334, { input: 'cep', group: 'sacado', share: 'sacado.cep', required: true }),
        alfa('cedenteNome', 'Nome do cedente', 335, 380, { group: 'cedente', share: 'cedente.nome', required: true, span: 3 }),
        num('cedenteDoc', 'CNPJ do cedente', 381, 394, { input: 'doc', group: 'cedente', share: 'cedente.doc', required: true }),
        alfa('chaveNota', 'Chave da NF-e', 395, 438, { span: 4, hint: 'Obrigatório para duplicata.' }),
        seq(439, 444),
      ],
    },
    {
      id: 'lastro',
      label: 'Lastro',
      short: 'L',
      role: 'child',
      section: 'Lastros',
      repeatable: true,
      description: 'Registro tipo 3 — documentos que lastreiam o título.',
      match: (l) => l[0] === '3',
      fields: [
        fixed('tipo', 'Identificação do registro', 1, 1, '3'),
        date6('dataEmissao', 'Data de emissão', 2, 7, { required: true }),
        date6('vencimento', 'Vencimento', 8, 13, { required: true }),
        money('valorNominal', 'Valor nominal', 14, 26, { required: true }),
        money('valorPedido', 'Valor total do pedido', 27, 39, { more: true, hint: 'Obrigatório para letra de câmbio.' }),
        money('valorNF', 'Valor da nota fiscal', 40, 50, { required: true }),
        pick('tipoRecebivel', 'Tipo de recebível/lastro', 51, 52, ESPECIES, { required: true, def: '01' }),
        pick('tipoLastro', 'Tipo de lastro performado', 53, 54, opts({
          SN: 'Serviços não performado',
          SP: 'Serviços performado',
          BN: 'Bens não performado',
          BP: 'Bens performado',
          MN: 'Bens e serviços não performado',
          MP: 'Bens e serviços performado',
        }), { kind: 'alfa', more: true }),
        alfa('numeroLastro', 'Nº do título/lastro', 55, 64, { required: true, hint: 'Deve corresponder ao nº do documento do detalhe.' }),
        alfa('numeroPedido', 'Nº do pedido', 65, 79, { more: true }),
        pick('sacadoTipo', 'Sacado — tipo de inscrição', 80, 81, PESSOA, { more: true }),
        num('sacadoDoc', 'Sacado — CPF/CNPJ', 82, 95, { input: 'doc', more: true }),
        alfa('sacadoNome', 'Sacado — nome', 96, 135, { more: true, span: 2 }),
        alfa('sacadoEndereco', 'Sacado — endereço', 136, 175, { more: true, span: 2 }),
        num('sacadoCep', 'Sacado — CEP', 176, 183, { input: 'cep', more: true }),
        alfa('codVerificacaoNfse', 'Código de verificação NFS-e', 184, 215, { more: true, span: 2 }),
        alfa('inscricaoMunicipal', 'Inscrição municipal do prestador', 216, 230, { more: true }),
        alfa('codMunicipio', 'Código do município (IBGE)', 231, 237, { more: true }),
        alfa('numeroNF', 'Nº da nota fiscal', 238, 257, {}),
        alfa('chaveNFe', 'Chave de acesso NF-e', 258, 301, { span: 3 }),
        alfa('cedenteNome', 'Nome do cedente', 302, 347, { group: 'cedente', share: 'cedente.nome' }),
        num('cedenteDoc', 'CNPJ do cedente', 348, 361, { input: 'doc', group: 'cedente', share: 'cedente.doc' }),
        blank(362, 438),
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
    const seqArq = header ? onlyDigits(rawOf(layout, header, 'seqArquivo')) : '';
    const ddmm = /^\d{6}$/.test(date) && cnabDateToIso(date) ? date.slice(0, 4) : isoToCnabDate(todayIso(), 6).slice(0, 4);
    return `CB${ddmm}${(seqArq || '01').slice(-2).padStart(2, '0')}.REM`;
  },
  crossValidate(doc, layout) {
    const issues: Issue[] = [];
    const titulos = groupTitulos(layout, doc.records);
    const codes = new Set(titulos.map((t) => rawOf(layout, t.primary, 'ocorrencia')));
    if (codes.has('71') && !codes.has('81'))
      issues.push({ level: 'warning', message: 'Ocorrência 71 exige contrapartida 81 no mesmo arquivo.' });
    if (codes.has('74') && !codes.has('84'))
      issues.push({ level: 'warning', message: 'Ocorrência 74 exige contrapartida 84 no mesmo arquivo.' });

    for (const t of titulos) {
      const oc = rawOf(layout, t.primary, 'ocorrencia');
      const liquidacao = ['14', '71', '73', '74'].includes(oc);
      if (liquidacao && /^0*$/.test(rawOf(layout, t.primary, 'valorPago')))
        issues.push({ level: 'warning', message: 'Valor pago é obrigatório para ocorrências de liquidação.', uid: t.uid, field: 'valorPago' });

      const lastros = t.children.filter((c: RecordInstance) => c.type === 'lastro');
      if (lastros.length) {
        const total = lastros.reduce((s, l) => s + BigInt(onlyDigits(rawOf(layout, l, 'valorNominal')) || '0'), 0n);
        const face = BigInt(onlyDigits(rawOf(layout, t.primary, 'valorFace')) || '0');
        if (total !== face)
          issues.push({
            level: 'warning',
            message: 'Soma do valor nominal dos lastros difere do valor de face do título.',
            uid: t.uid,
            field: 'valorFace',
          });
      }
    }
    return issues;
  },
};
