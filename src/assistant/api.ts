/** Cliente do backend do assistente (server/). */

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

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_start'; id: string; name: string; label: string }
  | { type: 'tool_end'; id: string; name: string; status: string; ok: boolean }
  | { type: 'remessa'; delivery: Delivery }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface Health {
  ok: boolean;
  configured: boolean;
  accessCode: boolean;
  model: string;
}

export interface OutgoingFile {
  name: string;
  type: string;
  size: number;
  data: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}

function headers(accessCode: string, json = true): HeadersInit {
  const h: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {};
  if (accessCode) h['x-access-code'] = accessCode;
  return h;
}

async function fail(res: Response): Promise<never> {
  let body: { error?: string; message?: string } = {};
  try {
    body = await res.json();
  } catch {
    /* corpo não-JSON */
  }
  throw new ApiError(body.message ?? `Erro ${res.status}`, body.error ?? 'http', res.status);
}

export async function getHealth(): Promise<Health> {
  const res = await fetch('/api/health');
  if (!res.ok) return fail(res);
  return res.json();
}

export async function createSession(accessCode: string): Promise<string> {
  const res = await fetch('/api/assistant/sessions', { method: 'POST', headers: headers(accessCode, false) });
  if (!res.ok) return fail(res);
  return (await res.json()).sessionId;
}

/** Envia uma mensagem e repassa os eventos SSE conforme chegam. */
export async function sendMessage(
  sessionId: string,
  payload: { text: string; files: OutgoingFile[] },
  accessCode: string,
  onEvent: (e: AgentEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/assistant/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: headers(accessCode),
    body: JSON.stringify({ text: payload.text, files: payload.files.map(({ name, type, data }) => ({ name, type, data })) }),
    signal,
  });
  if (!res.ok || !res.body) return fail(res);

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let sep: number;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of chunk.split('\n')) {
        if (line.startsWith('data: ')) onEvent(JSON.parse(line.slice(6)) as AgentEvent);
      }
    }
  }
}

// ------------------------------------------------------------------ anexos

const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const IMAGE_MAX_SIDE = 2000;

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** Reduz prints/fotos grandes antes do envio (menos tokens, sem perder legibilidade). */
async function prepareImage(file: File): Promise<{ type: string; data: string; size: number }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024 && file.type !== 'image/heic') {
    const buf = await file.arrayBuffer();
    return { type: file.type, data: toBase64(buf), size: file.size };
  }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('falha ao converter imagem'))), 'image/jpeg', 0.88),
  );
  return { type: 'image/jpeg', data: toBase64(await blob.arrayBuffer()), size: blob.size };
}

export async function prepareFiles(files: File[]): Promise<OutgoingFile[]> {
  const out: OutgoingFile[] = [];
  let total = 0;
  for (const file of files) {
    let item: OutgoingFile;
    if (file.type.startsWith('image/')) {
      const img = await prepareImage(file);
      item = { name: file.name, ...img };
    } else {
      item = { name: file.name, type: file.type, size: file.size, data: toBase64(await file.arrayBuffer()) };
    }
    total += item.size;
    if (total > MAX_TOTAL_BYTES) throw new Error('Os anexos passam de 20 MB. Envie em partes.');
    out.push(item);
  }
  return out;
}
