export type LayoutId = 'cnab444-fidc' | 'cnab444-cobranca' | 'cnab240-cobranca';

/** Como o valor é editado na interface. O arquivo sempre guarda o texto posicional bruto. */
export type FieldInput =
  | 'text'
  | 'int'
  | 'money'
  | 'decimal'
  | 'date6'
  | 'date8'
  | 'time6'
  | 'enum'
  | 'doc'
  | 'doc15'
  | 'cep'
  | 'email';

/**
 * Onde o campo aparece no editor.
 * - arquivo: card "Arquivo" (header / header de lote)
 * - cedente: card "Cedente" (valor único replicado em todas as linhas)
 * - sacado: card "Sacados" e seção sacado do título (replicado dentro do título)
 * - titulo: card do título (ou do registro filho)
 * - control: controle interno, visível apenas no inspetor
 */
export type FieldGroup = 'arquivo' | 'cedente' | 'sacado' | 'titulo' | 'control';

export type OcorrenciaCategory =
  | 'aquisicao'
  | 'entrada'
  | 'liquidacao'
  | 'baixa'
  | 'recompra'
  | 'instrucao';

export interface FieldOption {
  value: string;
  label: string;
  category?: OcorrenciaCategory;
}

export interface FieldSpec {
  id: string;
  label: string;
  /** Posição inicial, base 1, inclusiva (como na documentação). */
  start: number;
  /** Posição final, base 1, inclusiva. */
  end: number;
  kind: 'num' | 'alfa';
  decimals?: number;
  input?: FieldInput;
  /** Conteúdo literal fixo definido pelo layout. */
  fixed?: string;
  /** Branco / reservado / não utilizado. */
  blank?: boolean;
  /** Calculado automaticamente (sequenciais, totalizadores). */
  auto?: boolean;
  options?: FieldOption[];
  required?: boolean;
  hint?: string;
  /** Valor padrão (lógico) para novos registros. */
  def?: string | (() => string);
  group?: FieldGroup;
  /** Chave lógica que liga o mesmo dado em registros diferentes (ex.: cedente.doc). */
  share?: string;
  /** Campo secundário — aparece em "Mais campos". */
  more?: boolean;
  /** CPF alinhado à direita com brancos à esquerda. */
  cpfSpaces?: boolean;
  /** Mantém minúsculas (e-mail). */
  keepCase?: boolean;
  /** Largura no grid do formulário (de 4 colunas). */
  span?: 1 | 2 | 3 | 4;
}

export type RecordRole =
  | 'header'
  | 'batchHeader'
  | 'detail'
  | 'child'
  | 'batchTrailer'
  | 'trailer'
  | 'unknown';

export interface RecordSpec {
  id: string;
  label: string;
  /** Rótulo curto exibido no badge da linha. */
  short: string;
  role: RecordRole;
  fields: FieldSpec[];
  match: (line: string) => boolean;
  /** Título da seção dentro do card do título (registros filhos). */
  section?: string;
  description?: string;
  /** Filho obrigatório: criado junto com o título. */
  requiredChild?: boolean;
  /** Filho que pode se repetir (ex.: lastros). */
  repeatable?: boolean;
}

export interface RecordInstance {
  uid: string;
  type: string;
  raw: string;
}

export interface OperationPreset {
  id: string;
  label: string;
  description: string;
  ocorrencia: string;
}

export interface TituloSummaryFields {
  numero: string;
  vencimento: string;
  valor: string;
  aquisicao?: string;
  pago?: string;
  ocorrencia: string;
}

export interface LayoutSpec {
  id: LayoutId;
  name: string;
  family: string;
  variant: string;
  lineLength: number;
  description: string;
  records: RecordSpec[];
  summary: TituloSummaryFields;
  presets: OperationPreset[];
  /** Recalcula campos automáticos (sequenciais, contadores). Muta a cópia recebida. */
  finalize: (records: RecordInstance[], layout: LayoutSpec) => void;
  fileName: (doc: CnabDoc, layout: LayoutSpec) => string;
  /** Validações que dependem do arquivo inteiro. */
  crossValidate?: (doc: CnabDoc, layout: LayoutSpec) => Issue[];
  /** Rótulos das seções do editor. */
  labels: {
    cedente: string;
    cedenteHint: string;
    sacado: string;
    sacados: string;
  };
}

export interface CnabDoc {
  layoutId: LayoutId;
  fileName: string;
  records: RecordInstance[];
  /** Ocorrência padrão para novos títulos. */
  defaultOcorrencia: string;
  /** Texto original (quando importado), para trocar de layout sem perdas. */
  sourceText?: string;
  importNotes?: string[];
  detection?: { confidence: 'alta' | 'média' | 'baixa'; reasons: string[] };
}

export type IssueLevel = 'error' | 'warning' | 'info';

export interface Issue {
  level: IssueLevel;
  message: string;
  /** 'required' = obrigatório vazio (exibido de forma discreta no formulário). */
  code?: 'required';
  uid?: string;
  field?: string;
}

export interface Titulo {
  uid: string;
  index: number;
  primary: RecordInstance;
  children: RecordInstance[];
}

export interface FieldRef {
  uid: string;
  field: string;
}
