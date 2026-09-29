import type { CnabDoc, LayoutId } from './cnab/types';
import { detectLayout } from './cnab/detect';
import { getLayout } from './cnab/layouts';
import { parseText, serialize, toBytes } from './cnab/document';

export async function readFileText(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  // Arquivos CNAB são ASCII; windows-1252 preserva qualquer byte legado sem perdas.
  return new TextDecoder('windows-1252').decode(buf);
}

export type ImportResult = { ok: true; doc: CnabDoc } | { ok: false; message: string };

export function importText(text: string, fileName: string, forceLayout?: LayoutId): ImportResult {
  const det = detectLayout(text);
  const layoutId = forceLayout ?? det.layoutId;
  if (!layoutId) {
    return {
      ok: false,
      message: det.lineLength
        ? `Não foi possível identificar o layout (linhas com ${det.lineLength} posições). Suportados: CNAB 240 e CNAB 444.`
        : 'O arquivo está vazio.',
    };
  }
  const layout = getLayout(layoutId);
  const doc = parseText(text, layout, fileName);
  doc.detection = forceLayout ? { confidence: 'alta', reasons: ['Layout escolhido manualmente.'] } : { confidence: det.confidence, reasons: det.reasons };
  return { ok: true, doc };
}

export function downloadDoc(doc: CnabDoc) {
  const blob = new Blob([toBytes(serialize(doc)) as BlobPart], { type: 'text/plain;charset=windows-1252' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = doc.fileName || 'remessa.rem';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
