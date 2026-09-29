import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT } from './prompt';
import { runTool, TOOL_LABEL, TOOLS, type Delivery } from './tools';
import type { Session } from './sessions';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; status: string; ok: boolean }
  | { type: 'remessa'; delivery: Delivery }
  | { type: 'error'; message: string }
  | { type: 'done' };

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-opus-5-5';
const EFFORT = (process.env.CLAUDE_EFFORT ?? 'high') as 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const MAX_ITERATIONS = 12;

let client: Anthropic | null = null;
function getClient() {
  client ??= new Anthropic();
  return client;
}

export const agentConfig = { model: MODEL, effort: EFFORT };

/**
 * Executa um turno do usuário: chama o modelo, roda as ferramentas no servidor e repete
 * até o modelo responder sem ferramentas. O histórico da sessão só recebe acréscimos
 * (nunca é editado), o que mantém o cache e os blocos de raciocínio válidos.
 */
export async function runTurn(
  session: Session,
  userContent: Anthropic.Beta.BetaContentBlockParam[],
  emit: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  session.messages.push({ role: 'user', content: userContent });
  let jsonRetries = 0;

  for (let i = 0; i < MAX_ITERATIONS; i++) {
    if (signal.aborted) return;

    const stream = getClient().beta.messages.stream(
      {
        model: MODEL,
        max_tokens: 64000,
        thinking: { type: 'adaptive' },
        output_config: { effort: EFFORT },
        // Se o modelo recusar por política, o servidor tenta o modelo recomendado.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        // Cache automático do maior prefixo estável (ferramentas + sistema + histórico).
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: session.messages,
      },
      { signal },
    );

    stream.on('text', (delta) => emit({ type: 'text', delta }));
    stream.on('streamEvent', (event) => {
      if (event.type === 'content_block_start' && event.content_block.type === 'tool_use') {
        const { id, name } = event.content_block;
        emit({ type: 'tool_start', id, name, label: TOOL_LABEL[name] ?? name });
      }
    });

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
      jsonRetries = 0;
    } catch (err) {
      // Com entrada de ferramenta em streaming, JSON impossível de ler rejeita o turno:
      // só esse caso é repetido. Erros da API sobem.
      if (err instanceof Anthropic.APIError || signal.aborted || jsonRetries++ >= 2) throw err;
      continue;
    }

    if (message.stop_reason === 'refusal') {
      emit({ type: 'error', message: 'O modelo não pôde continuar com esta solicitação. Reformule ou envie outro material.' });
      return;
    }

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');

    if (message.stop_reason === 'max_tokens' && toolUses.length) {
      emit({ type: 'error', message: 'O rascunho ficou grande demais para uma resposta. Envie o estoque em partes menores.' });
      return;
    }

    session.messages.push({ role: 'assistant', content: message.content });

    if (message.stop_reason === 'pause_turn') continue;
    if (!toolUses.length) return;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const outcome = runTool(session, use.name, use.input);
      emit({ type: 'tool_end', id: use.id, name: use.name, status: outcome.status, ok: !outcome.isError });
      if (outcome.delivery) emit({ type: 'remessa', delivery: outcome.delivery });
      results.push({ type: 'tool_result', tool_use_id: use.id, content: outcome.content, is_error: outcome.isError });
    }
    session.messages.push({ role: 'user', content: results });
  }

  emit({ type: 'error', message: 'A análise passou do limite de etapas. Tente dividir o material.' });
}
