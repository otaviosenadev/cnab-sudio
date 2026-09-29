import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { agentConfig, runTurn, type AgentEvent } from './agent';
import { AttachmentError, toContentBlocks } from './files';
import { createSession, deleteSession, getSession } from './sessions';
import { runMockTurn } from './mock';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? '127.0.0.1';
const ACCESS_CODE = process.env.ACCESS_CODE ?? '';
const MOCK = process.env.ASSISTANT_MOCK === '1';

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? 'info' },
  bodyLimit: 30 * 1024 * 1024,
  trustProxy: true,
});

await app.register(rateLimit, { global: false });

function hasCredentials() {
  return MOCK || Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

function checkAccess(req: FastifyRequest, reply: FastifyReply): boolean {
  if (!ACCESS_CODE) return true;
  const given = Buffer.from(String(req.headers['x-access-code'] ?? ''));
  const expected = Buffer.from(ACCESS_CODE);
  if (given.length === expected.length && timingSafeEqual(given, expected)) return true;
  reply.code(401).send({ error: 'access_code', message: 'Código de acesso inválido.' });
  return false;
}

app.get('/api/health', async () => ({
  ok: true,
  configured: hasCredentials(),
  accessCode: Boolean(ACCESS_CODE),
  model: MOCK ? 'simulação' : agentConfig.model,
}));

app.post('/api/assistant/sessions', async (req, reply) => {
  if (!checkAccess(req, reply)) return;
  if (!hasCredentials()) return reply.code(503).send({ error: 'not_configured', message: 'O servidor não tem credenciais da Anthropic configuradas.' });
  return { sessionId: createSession().id };
});

app.delete<{ Params: { id: string } }>('/api/assistant/sessions/:id', async (req, reply) => {
  if (!checkAccess(req, reply)) return;
  deleteSession(req.params.id);
  return { ok: true };
});

const MessageBody = z.object({
  text: z.string().max(50_000).default(''),
  files: z
    .array(z.object({ name: z.string().max(300), type: z.string().max(200), data: z.string() }))
    .max(20)
    .default([]),
});

app.post<{ Params: { id: string } }>(
  '/api/assistant/sessions/:id/messages',
  { config: { rateLimit: { max: Number(process.env.RATE_LIMIT_MAX ?? 30), timeWindow: '10 minutes' } } },
  async (req, reply) => {
    if (!checkAccess(req, reply)) return;
    const session = getSession(req.params.id);
    if (!session) return reply.code(404).send({ error: 'session_not_found', message: 'Conversa expirada. Comece uma nova.' });
    if (session.busy) return reply.code(409).send({ error: 'busy', message: 'Aguarde a resposta anterior terminar.' });

    const body = MessageBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_body', message: 'Requisição inválida.' });
    const { text, files } = body.data;
    if (!text.trim() && !files.length) return reply.code(400).send({ error: 'empty', message: 'Envie um texto ou um anexo.' });

    let attachments;
    try {
      attachments = toContentBlocks(files);
    } catch (err) {
      if (err instanceof AttachmentError) return reply.code(400).send({ error: 'attachment', message: err.message });
      req.log.error(err);
      return reply.code(400).send({ error: 'attachment', message: 'Não foi possível ler um dos anexos.' });
    }

    // Server-Sent Events sobre a própria resposta do POST.
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const emit = (e: AgentEvent) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    };
    const controller = new AbortController();
    res.on('close', () => controller.abort());
    const heartbeat = setInterval(() => !res.writableEnded && res.write(': ping\n\n'), 15_000);

    session.busy = true;
    try {
      const content = [...attachments, { type: 'text' as const, text: text.trim() || '(sem mensagem, apenas anexos)' }];
      if (MOCK) await runMockTurn(session, text, emit);
      else await runTurn(session, content, emit, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        req.log.error(err);
        emit({ type: 'error', message: describeError(err) });
      }
    } finally {
      session.busy = false;
      clearInterval(heartbeat);
      emit({ type: 'done' });
      res.end();
    }
  },
);

function describeError(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'Credenciais da Anthropic inválidas no servidor.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'A chave configurada não tem permissão para este modelo.';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de uso da API atingido. Tente novamente em instantes.';
  if (err instanceof Anthropic.BadRequestError) return `A API recusou a requisição: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Falha de conexão com a API da Anthropic.';
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status ?? 'sem status'}). Tente novamente.`;
  return 'Erro inesperado no servidor.';
}

try {
  await app.listen({ port: PORT, host: HOST });
  if (!hasCredentials()) app.log.warn('ANTHROPIC_API_KEY não definida: o assistente ficará indisponível até configurar server/.env');
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
