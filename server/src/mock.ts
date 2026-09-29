import type { AgentEvent } from './agent';
import type { Session } from './sessions';
import { runTool } from './tools';

/**
 * Modo de simulação (ASSISTANT_MOCK=1): percorre as ferramentas reais com um rascunho
 * fixo, sem chamar a API. Serve para desenvolver e demonstrar a interface sem custo.
 */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function type(emit: (e: AgentEvent) => void, text: string) {
  for (const chunk of text.match(/.{1,12}/gs) ?? []) {
    emit({ type: 'text', delta: chunk });
    await sleep(25);
  }
}

const DRAFT = {
  layout: 'cnab444-fidc',
  arquivo: { codOriginador: '23523', nomeOriginador: 'ALFA CONSULTORIA', numBanco: '999', nomeBanco: 'BANCO EXEMPLO', seqArquivo: 1 },
  cedente: { 'cedente.nome': 'ACME INDUSTRIA E COMERCIO LTDA' },
  titulos: [
    {
      campos: { seuNumero: '1001', numDocumento: '1001', vencimento: '2026-12-10', dataEmissao: '2026-09-10', valorFace: 1234.56, valorAquisicao: 1190.2 },
      sacado: { doc: '04578012000159', nome: 'MERCADO BOA VISTA LTDA', endereco: 'AV PAULISTA 1000', cep: '01310100' },
    },
    {
      campos: { seuNumero: '1002', numDocumento: '1002', vencimento: '2027-01-10', dataEmissao: '2026-09-10', valorFace: 890, valorAquisicao: 851.4 },
      sacado: { doc: '07845123000172', nome: 'DISTRIBUIDORA HORIZONTE SA', endereco: 'RUA DAS FLORES 245', cep: '30130010' },
    },
  ],
};

export async function runMockTurn(session: Session, text: string, emit: (e: AgentEvent) => void) {
  const first = !session.draft;
  if (first) {
    await type(emit, 'Li o material: são **2 títulos** de 2 sacados, cedente ACME. Vou montar o rascunho e validar.\n\n');
    emit({ type: 'tool_start', id: 't1', name: 'validar_rascunho', label: 'Montando e validando o rascunho' });
    await sleep(700);
    const r = runTool(session, 'validar_rascunho', { rascunho: DRAFT });
    emit({ type: 'tool_end', id: 't1', name: 'validar_rascunho', status: r.status, ok: !r.isError });
    await type(
      emit,
      'Para fechar a remessa, preciso de:\n\n- **CNPJ do cedente** (ACME Indústria e Comércio)\n- **Nº do termo de cessão** (o mesmo para todos os títulos?)\n- Coobrigação: uso **02 — sem coobrigação**?',
    );
    return;
  }
  const cnpj = text.replace(/\D/g, '').match(/\d{14}/)?.[0] ?? '11222333000181';
  emit({ type: 'tool_start', id: 't2', name: 'atualizar_rascunho', label: 'Aplicando alterações' });
  await sleep(500);
  const u = runTool(session, 'atualizar_rascunho', {
    alteracoes: [
      { alvo: 'cedente', campo: 'cedente.doc', valor: cnpj },
      { alvo: 'titulo', campo: 'termoCessao', valor: 'TC2026-001' },
      { alvo: 'titulo', campo: 'coobrigacao', valor: '02' },
    ],
  });
  emit({ type: 'tool_end', id: 't2', name: 'atualizar_rascunho', status: u.status, ok: !u.isError });
  emit({ type: 'tool_start', id: 't3', name: 'entregar_remessa', label: 'Gerando a remessa' });
  await sleep(400);
  const d = runTool(session, 'entregar_remessa', { resumo: 'Aquisição de 2 duplicatas da ACME, termo TC2026-001, sem coobrigação.' });
  emit({ type: 'tool_end', id: 't3', name: 'entregar_remessa', status: d.status, ok: !d.isError });
  if (d.delivery) emit({ type: 'remessa', delivery: d.delivery });
  await type(emit, 'Pronto. Abra no editor para conferir os dados do banco e baixar o arquivo.');
}
