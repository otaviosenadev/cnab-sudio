import type Anthropic from '@anthropic-ai/sdk';
import * as XLSX from 'xlsx';

export interface IncomingFile {
  name: string;
  type: string;
  /** Conteúdo em base64, sem prefixo data:. */
  data: string;
}

export class AttachmentError extends Error {}

type Block = Anthropic.Beta.BetaContentBlockParam;

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SHEET_EXT = /\.(xlsx|xlsm|xls|xlsb|ods|csv|tsv)$/i;
const TEXT_EXT = /\.(txt|rem|ret|json|md|xml)$/i;

/** Limite de texto extraído por mensagem (~200 mil tokens). Acima disso, pedimos para dividir. */
const MAX_TEXT_CHARS = 700_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

function escapeAttr(v: string) {
  return v.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
}

function decodeText(buf: Buffer): string {
  const utf8 = buf.toString('utf8');
  // Arquivos legados (windows-1252) viram U+FFFD em UTF-8; nesse caso, lê como latin1.
  return utf8.includes('�') ? buf.toString('latin1') : utf8;
}

function sheetToText(name: string, buf: Buffer): string {
  const wb = XLSX.read(buf, { type: 'buffer', dateNF: 'yyyy-mm-dd' });
  const parts: string[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName]!;
    const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false }).trim();
    if (!csv) continue;
    const rows = csv.split('\n').length;
    parts.push(`<planilha nome="${escapeAttr(sheetName)}" linhas="${rows}">\n${csv}\n</planilha>`);
  }
  if (!parts.length) throw new AttachmentError(`"${name}" não tem dados legíveis.`);
  return parts.join('\n');
}

export function toContentBlocks(files: IncomingFile[]): Block[] {
  const blocks: Block[] = [];
  let textChars = 0;

  for (const file of files) {
    const buf = Buffer.from(file.data, 'base64');
    const name = file.name || 'anexo';
    const type = (file.type || '').toLowerCase();

    if (IMAGE_TYPES.has(type)) {
      if (buf.length > MAX_IMAGE_BYTES) throw new AttachmentError(`A imagem "${name}" passa de 5 MB.`);
      blocks.push({ type: 'text', text: `Anexo (imagem): ${name}` });
      blocks.push({
        type: 'image',
        source: { type: 'base64', media_type: type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp', data: file.data },
      });
      continue;
    }

    if (type === 'application/pdf' || /\.pdf$/i.test(name)) {
      blocks.push({
        type: 'document',
        title: name,
        source: { type: 'base64', media_type: 'application/pdf', data: file.data },
      });
      continue;
    }

    let text: string;
    let kind: string;
    if (SHEET_EXT.test(name) || type.includes('spreadsheet') || type.includes('excel') || type === 'text/csv') {
      text = sheetToText(name, buf);
      kind = 'planilha';
    } else if (TEXT_EXT.test(name) || type.startsWith('text/') || type === 'application/json') {
      text = decodeText(buf);
      kind = 'texto';
    } else {
      throw new AttachmentError(`Formato não suportado: "${name}". Envie planilhas, CSV, imagens, PDF ou texto.`);
    }

    textChars += text.length;
    if (textChars > MAX_TEXT_CHARS) {
      throw new AttachmentError('O conteúdo enviado é grande demais para uma mensagem. Divida em partes (por exemplo, uma planilha por vez).');
    }
    blocks.push({ type: 'text', text: `<anexo nome="${escapeAttr(name)}" tipo="${kind}">\n${text}\n</anexo>` });
  }
  return blocks;
}
