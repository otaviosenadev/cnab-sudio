/**
 * Catálogo dos layouts em texto, gerado a partir das especificações.
 * Vai no prompt do assistente de IA: é determinístico (ordem fixa) para não quebrar o cache.
 */
import type { FieldSpec, LayoutSpec } from './types';
import { LAYOUTS } from './layouts';
import { width } from './codec';

function formatOf(f: FieldSpec): string {
  switch (f.input) {
    case 'money':
      return 'valor em reais (ex.: 1234.56)';
    case 'decimal':
      return `número decimal (até ${f.decimals} casas)`;
    case 'date6':
    case 'date8':
      return 'data AAAA-MM-DD';
    case 'time6':
      return 'hora HH:MM:SS';
    case 'doc':
    case 'doc15':
      return 'CPF/CNPJ, só dígitos';
    case 'cep':
      return 'CEP, 8 dígitos';
    case 'enum':
      return `código: ${f.options!.map((o) => `${o.value}=${o.label}`).join('; ')}`;
    case 'email':
      return `texto até ${width(f)} caracteres (e-mail ou mensagem)`;
    default:
      return f.kind === 'num' ? `número até ${width(f)} dígitos` : `texto até ${width(f)} caracteres`;
  }
}

function line(key: string, f: FieldSpec): string {
  const req = f.required ? ' [obrigatório]' : '';
  const hint = f.hint ? ` — ${f.hint}` : '';
  return `- ${key}: ${f.label}${req}; ${formatOf(f)}${hint}`;
}

export function describeLayout(layout: LayoutSpec): string {
  const arquivo: string[] = [];
  const cedente: string[] = [];
  const sacado: string[] = [];
  const seen = new Set<string>();
  for (const r of layout.records) {
    for (const f of r.fields) {
      if (f.fixed !== undefined || f.blank || f.auto) continue;
      const key = f.share ?? f.id;
      if (f.group === 'arquivo' && (r.role === 'header' || r.role === 'batchHeader') && !seen.has(`a:${key}`)) {
        seen.add(`a:${key}`);
        arquivo.push(line(key, f));
      } else if (f.group === 'cedente' && f.share && !seen.has(`c:${key}`)) {
        seen.add(`c:${key}`);
        cedente.push(line(key, f));
      } else if (f.group === 'sacado' && f.share && !seen.has(`s:${key}`)) {
        seen.add(`s:${key}`);
        sacado.push(line(key.replace(/^sacado\./, ''), f));
      }
    }
  }
  const detail = layout.records.find((r) => r.role === 'detail')!;
  const titulo = detail.fields
    .filter((f) => f.group === 'titulo' && f.fixed === undefined && !f.blank && !f.auto)
    .map((f) => line(f.id, f) + (f.more ? ' (opcional/secundário)' : ''));

  return [
    `### ${layout.id} — ${layout.name}`,
    layout.description,
    `Operações comuns: ${layout.presets.map((p) => `${p.label} (ocorrência ${p.ocorrencia})`).join('; ')}.`,
    '',
    '`arquivo`:',
    ...arquivo,
    '',
    `\`cedente\` (${layout.labels.cedente}, replicado em todas as linhas):`,
    ...cedente,
    '',
    `\`titulos[].sacado\` (${layout.labels.sacado}):`,
    ...sacado,
    '',
    '`titulos[].campos`:',
    ...titulo,
  ].join('\n');
}

export function layoutCatalog(): string {
  return LAYOUTS.map(describeLayout).join('\n\n');
}
