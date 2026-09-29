import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { applyChanges, buildFromDraft, type Draft, type DraftResult } from '../../src/cnab/draft';
import { LAYOUTS } from '../../src/cnab/layouts';

// ------------------------------------------------------------------ schemas

const Value = z.union([z.string(), z.number()]);
const ValueMap = z.record(z.string(), Value);
const TituloSchema = z.object({ campos: ValueMap.optional(), sacado: ValueMap.optional() });
const DraftSchema = z.object({
  layout: z.enum(LAYOUTS.map((l) => l.id) as [string, ...string[]]),
  ocorrencia_padrao: z.string().optional(),
  nome_arquivo: z.string().optional(),
  arquivo: ValueMap.optional(),
  cedente: ValueMap.optional(),
  titulos: z.array(TituloSchema).min(1),
});

const ValidarInput = z.object({ rascunho: DraftSchema });
const AtualizarInput = z.object({
  alteracoes: z
    .array(
      z.object({
        alvo: z.enum(['arquivo', 'cedente', 'titulo', 'sacado']),
        titulo: z.number().int().positive().optional(),
        campo: z.string(),
        valor: Value,
      }),
    )
    .optional(),
  novos_titulos: z.array(TituloSchema).optional(),
  remover_titulos: z.array(z.number().int().positive()).optional(),
});
const EntregarInput = z.object({ resumo: z.string() });

const valueMapJson = { type: 'object', additionalProperties: { type: ['string', 'number'] } } as const;
const tituloJson = {
  type: 'object',
  properties: {
    campos: { ...valueMapJson, description: 'Campos do título (chaves de `titulos[].campos` no catálogo).' },
    sacado: { ...valueMapJson, description: 'Dados do sacado/pagador (chaves de `titulos[].sacado`).' },
  },
} as const;

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'validar_rascunho',
    description:
      'Monta a remessa a partir de um rascunho completo, guarda o rascunho na sessão e devolve os apontamentos de validação (erros, alertas, avisos) sem entregar nada ao usuário. Use depois de ler o material e sempre que refizer o rascunho do zero.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        rascunho: {
          type: 'object',
          properties: {
            layout: { type: 'string', enum: LAYOUTS.map((l) => l.id) },
            ocorrencia_padrao: { type: 'string', description: 'Ocorrência usada quando o título não informar a sua.' },
            nome_arquivo: { type: 'string', description: 'Opcional. Se omitido, segue a convenção do layout.' },
            arquivo: { ...valueMapJson, description: 'Campos do header (chaves de `arquivo`).' },
            cedente: { ...valueMapJson, description: 'Campos do cedente (chaves de `cedente`).' },
            titulos: { type: 'array', items: tituloJson },
          },
          required: ['layout', 'titulos'],
        },
      },
      required: ['rascunho'],
    },
  },
  {
    name: 'atualizar_rascunho',
    description:
      'Altera o rascunho guardado na sessão e valida de novo. Use para aplicar respostas do usuário ou corrigir campos, sem reenviar o rascunho inteiro. `titulo` é a posição base 1; omitido, a alteração vale para todos os títulos.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        alteracoes: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              alvo: { type: 'string', enum: ['arquivo', 'cedente', 'titulo', 'sacado'] },
              titulo: { type: 'integer', minimum: 1 },
              campo: { type: 'string' },
              valor: { type: ['string', 'number'] },
            },
            required: ['alvo', 'campo', 'valor'],
          },
        },
        novos_titulos: { type: 'array', items: tituloJson, description: 'Títulos a acrescentar ao final.' },
        remover_titulos: { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'Posições (base 1) a remover.' },
      },
    },
  },
  {
    name: 'entregar_remessa',
    description:
      'Gera o arquivo final a partir do rascunho guardado e entrega ao usuário, que abre no editor para revisar. Use quando não houver erros ou quando o usuário pedir para gerar mesmo com pendências.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        resumo: { type: 'string', description: 'Uma ou duas frases sobre o que foi gerado, mostradas no cartão da remessa.' },
      },
      required: ['resumo'],
    },
  },
];

// ------------------------------------------------------------------ execução

export interface ToolSession {
  draft?: Draft;
}

export interface Delivery {
  remessa: string;
  fileName: string;
  layoutId: string;
  resumo: string;
  titulos: number;
  valorTotal: string;
  erros: number;
  alertas: number;
}

export interface ToolOutcome {
  content: string;
  isError?: boolean;
  /** Texto curto para a interface ("12 títulos · 2 erros"). */
  status: string;
  delivery?: Delivery;
}

const MAX_ISSUES = 80;

function report(result: DraftResult) {
  const { issues, resumo } = result;
  return JSON.stringify({
    resumo,
    apontamentos: issues.slice(0, MAX_ISSUES),
    omitidos: Math.max(0, issues.length - MAX_ISSUES),
  });
}

function statusOf(r: DraftResult) {
  const parts = [`${r.resumo.titulos} título${r.resumo.titulos === 1 ? '' : 's'}`, r.resumo.valorTotal];
  if (r.resumo.erros) parts.push(`${r.resumo.erros} erro${r.resumo.erros === 1 ? '' : 's'}`);
  else if (r.resumo.alertas) parts.push(`${r.resumo.alertas} alerta${r.resumo.alertas === 1 ? '' : 's'}`);
  else parts.push('sem erros');
  return parts.join(' · ');
}

function invalid(name: string, input: unknown, error: z.ZodError): ToolOutcome {
  return {
    isError: true,
    status: 'Entrada inválida, refazendo',
    content: JSON.stringify({
      INVALID_JSON: JSON.stringify(input).slice(0, 2000),
      erros: error.issues.slice(0, 10).map((i) => `${i.path.join('.')}: ${i.message}`),
      dica: `Reenvie ${name} com o formato do schema.`,
    }),
  };
}

export function runTool(session: ToolSession, name: string, input: unknown): ToolOutcome {
  switch (name) {
    case 'validar_rascunho': {
      const parsed = ValidarInput.safeParse(input);
      if (!parsed.success) return invalid(name, input, parsed.error);
      const draft = parsed.data.rascunho as Draft;
      const result = buildFromDraft(draft);
      session.draft = draft;
      return { content: report(result), status: statusOf(result) };
    }
    case 'atualizar_rascunho': {
      const parsed = AtualizarInput.safeParse(input);
      if (!parsed.success) return invalid(name, input, parsed.error);
      if (!session.draft)
        return { isError: true, status: 'Sem rascunho', content: 'Não há rascunho na sessão. Use validar_rascunho primeiro.' };
      const { alteracoes = [], novos_titulos = [], remover_titulos = [] } = parsed.data;
      const { draft, problems } = applyChanges(session.draft, alteracoes);
      const remove = new Set(remover_titulos);
      draft.titulos = [...draft.titulos.filter((_, i) => !remove.has(i + 1)), ...novos_titulos];
      if (!draft.titulos.length)
        return { isError: true, status: 'Rascunho vazio', content: 'A alteração removeria todos os títulos.' };
      const result = buildFromDraft(draft);
      session.draft = draft;
      const content = problems.length ? JSON.stringify({ problemas: problems, ...JSON.parse(report(result)) }) : report(result);
      return { content, status: statusOf(result) };
    }
    case 'entregar_remessa': {
      const parsed = EntregarInput.safeParse(input);
      if (!parsed.success) return invalid(name, input, parsed.error);
      if (!session.draft)
        return { isError: true, status: 'Sem rascunho', content: 'Não há rascunho na sessão. Use validar_rascunho primeiro.' };
      const result = buildFromDraft(session.draft);
      return {
        status: `Remessa gerada · ${statusOf(result)}`,
        content: JSON.stringify({ entregue: true, arquivo: result.doc.fileName, resumo: result.resumo }),
        delivery: {
          remessa: result.text,
          fileName: result.doc.fileName,
          layoutId: result.doc.layoutId,
          resumo: parsed.data.resumo,
          ...result.resumo,
        },
      };
    }
    default:
      return { isError: true, status: 'Ferramenta desconhecida', content: `Ferramenta desconhecida: ${name}` };
  }
}

export const TOOL_LABEL: Record<string, string> = {
  validar_rascunho: 'Montando e validando o rascunho',
  atualizar_rascunho: 'Aplicando alterações',
  entregar_remessa: 'Gerando a remessa',
};
