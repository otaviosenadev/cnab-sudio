import type { LayoutId } from './types';

export interface Detection {
  layoutId: LayoutId | null;
  confidence: 'alta' | 'média' | 'baixa';
  reasons: string[];
  lineLength: number;
}

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  return lines;
}

function dominantLength(lines: string[]): number {
  const counts = new Map<number, number>();
  for (const l of lines) counts.set(l.length, (counts.get(l.length) ?? 0) + 1);
  let best = 0;
  let bestCount = -1;
  for (const [len, c] of counts) if (c > bestCount) [best, bestCount] = [len, c];
  return best;
}

/**
 * Identifica o layout pelo tamanho das linhas e por assinaturas estruturais.
 * 240 → cobrança 240. 444 → pontua sinais de cobrança bancária versus remessa FIDC.
 */
export function detectLayout(text: string): Detection {
  const lines = splitLines(text);
  const len = dominantLength(lines);
  const reasons: string[] = [];

  if (!lines.length) return { layoutId: null, confidence: 'baixa', reasons: ['Arquivo vazio.'], lineLength: 0 };

  if (len >= 238 && len <= 242) {
    const first = lines[0]!;
    const ok = first[7] === '0' && first.slice(3, 7) === '0000';
    reasons.push(`Linhas com ${len} posições.`);
    if (ok) reasons.push('Header de arquivo (lote 0000, tipo 0).');
    const hasP = lines.some((l) => l[7] === '3' && l[13] === 'P');
    if (hasP) reasons.push('Segmentos P de cobrança encontrados.');
    return { layoutId: 'cnab240-cobranca', confidence: ok && hasP ? 'alta' : ok ? 'média' : 'baixa', reasons, lineLength: len };
  }

  if (len >= 440 && len <= 446) {
    reasons.push(`Linhas com ${len} posições.`);
    const header = lines.find((l) => l[0] === '0') ?? '';
    const details = lines.filter((l) => l[0] === '1');
    let cobranca = 0;
    let fidc = 0;
    const c: string[] = [];
    const f: string[] = [];

    const bankData = header.slice(117, 139).trim();
    if (bankData && /^\d+$/.test(bankData)) (fidc += 1), f.push('dados bancários do cedente no header');
    else if (header.slice(117, 438).trim() === '') (cobranca += 1), c.push('header sem dados bancários do cedente');
    if (lines.some((l) => l[0] === '2' || l[0] === '7')) (cobranca += 3), c.push('registros de e-mail/avalista (tipos 2 e 7)');

    const sample = details.slice(0, 50);
    if (sample.length) {
      const ratio = (pred: (l: string) => boolean) => sample.filter(pred).length / sample.length;
      if (ratio((l) => l[149] === 'N') > 0.8) (cobranca += 1), c.push('identificação "N" na posição 150');
      if (ratio((l) => l[20] === '0' && /^\d{3}$/.test(l.slice(21, 24)) && l.slice(21, 24) !== '000') > 0.8)
        (cobranca += 1), c.push('carteira/agência/conta nas posições 21–37');
      if (ratio((l) => ['01', '02'].includes(l.slice(20, 22))) > 0.8) (fidc += 2), f.push('coobrigação 01/02 na posição 21');
      if (ratio((l) => ['01', '02'].includes(l.slice(159, 161))) > 0.8) (fidc += 2), f.push('tipo de pessoa do cedente na posição 160');
      if (ratio((l) => /\d{6}/.test(l.slice(192, 205)) && !/^0+$/.test(l.slice(192, 205))) > 0.8)
        (fidc += 1), f.push('valor de aquisição preenchido');
    }

    if (cobranca > fidc) {
      reasons.push(...c.map((x) => `Cobrança: ${x}.`));
      return { layoutId: 'cnab444-cobranca', confidence: cobranca - fidc >= 3 ? 'alta' : 'média', reasons, lineLength: len };
    }
    reasons.push(...f.map((x) => `FIDC: ${x}.`));
    return {
      layoutId: 'cnab444-fidc',
      confidence: fidc - cobranca >= 3 ? 'alta' : fidc > cobranca ? 'média' : 'baixa',
      reasons,
      lineLength: len,
    };
  }

  reasons.push(`Linhas com ${len} posições — nenhum layout suportado corresponde.`);
  return { layoutId: null, confidence: 'baixa', reasons, lineLength: len };
}
