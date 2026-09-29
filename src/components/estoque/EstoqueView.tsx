import { useEffect, useMemo, useRef, useState } from 'react';
import type { CnabDoc } from '../../cnab/types';
import {
  autoMap,
  buildBaixa,
  COLUMNS,
  decodeBytes,
  extractTitulos,
  originadorFrom,
  parseDelimited,
  toTable,
  type BaixaOptions,
  type ColumnKey,
  type ColumnMap,
  type EstoqueTitulo,
  type Table,
  type ValorPagoBase,
  valorOf,
} from '../../cnab/estoque';
import { FIDC_BAIXA_OCORRENCIAS } from '../../cnab/layouts/fidc444';
import { addDaysIso, formatBRL, formatDoc, formatIsoBR, todayIso } from '../../cnab/format';
import { useShell } from '../../state/editor';
import { toast, useClickOutside } from '../../state/ui';
import { Icon } from '../Icon';

export interface EstoqueSession {
  fileName: string;
  sheet?: string;
  table: Table;
  map: ColumnMap;
  selected: number[];
}

interface Props {
  session: EstoqueSession | null;
  onSession: (s: EstoqueSession | null) => void;
  onClose: () => void;
  onGenerate: (doc: CnabDoc) => void;
}

// ------------------------------------------------------------------ leitura

async function readSpreadsheet(file: File): Promise<{ matrix: string[][]; sheet?: string }> {
  const buf = await file.arrayBuffer();
  if (/\.(csv|txt|tsv)$/i.test(file.name)) return { matrix: parseDelimited(decodeBytes(buf)) };
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array', dateNF: 'dd/mm/yyyy' });
  // Usa a aba com mais colunas reconhecidas.
  let best: { matrix: string[][]; sheet: string; score: number } | null = null;
  for (const name of wb.SheetNames) {
    const matrix = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name]!, { header: 1, raw: false, blankrows: false, defval: '' });
    const table = toTable(matrix);
    const score = Object.keys(autoMap(table.headers)).length * 1000 + table.rows.length;
    if (!best || score > best.score) best = { matrix, sheet: name, score };
  }
  if (!best) throw new Error('A planilha está vazia.');
  return { matrix: best.matrix, sheet: wb.SheetNames.length > 1 ? best.sheet : undefined };
}

function toSession(matrix: string[][], fileName: string, sheet?: string): EstoqueSession {
  const table = toTable(matrix);
  if (!table.rows.length) throw new Error('Não encontrei linhas de dados. Confira se o cabeçalho foi incluído.');
  const map = autoMap(table.headers);
  if (map.seuNumero === undefined && map.numDocumento === undefined)
    throw new Error('Não reconheci as colunas de identificação do título (Seu número ou Nº do documento).');
  return { fileName, sheet, table, map, selected: [] };
}

// ------------------------------------------------------------------ configuração lembrada

const CONFIG_KEY = 'cnab-studio:baixa';

interface Config {
  ocorrencia: string;
  /** Código digitado quando ocorrencia === 'outro'. */
  ocorrenciaOutro: string;
  valorPago: ValorPagoBase;
  termoCessao: string;
  header: BaixaOptions['header'];
}

const DEFAULT_CONFIG: Config = { ocorrencia: '77', ocorrenciaOutro: '', valorPago: 'valorNominal', termoCessao: '', header: {} };

function loadConfig(): Config {
  try {
    return { ...DEFAULT_CONFIG, ...JSON.parse(localStorage.getItem(CONFIG_KEY) ?? '{}') };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(c: Config) {
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
  } catch {
    /* sem armazenamento */
  }
}

// ------------------------------------------------------------------ importação

function ImportPanel({ onLoaded }: { onLoaded: (s: EstoqueSession) => void }) {
  const [over, setOver] = useState(false);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    setError('');
    setLoading(true);
    try {
      const { matrix, sheet } = await readSpreadsheet(file);
      onLoaded(toSession(matrix, file.name, sheet));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler o arquivo.');
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = () => {
    setError('');
    try {
      onLoaded(toSession(parseDelimited(pasted), 'Dados colados'));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível ler os dados colados.');
    }
  };

  return (
    <div className="estoque-import">
      <div className="estoque-import-inner">
        <span className="intro-mark">
          <Icon name="table" size={22} />
        </span>
        <h1>Baixa a partir do estoque</h1>
        <p className="lead">
          Use a exportação de estoque ou posição do custodiante. As colunas são reconhecidas pelo nome; depois é só escolher os títulos e
          gerar o CNAB de baixa.
        </p>

        <div className="import-grid">
          <button
            type="button"
            className={`tile drop${over ? ' over' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) void handleFile(f);
            }}
          >
            <span className="tile-icon">{loading ? <span className="spinner" /> : <Icon name="upload" size={20} />}</span>
            <h3>{loading ? 'Lendo arquivo…' : 'Enviar planilha'}</h3>
            <p>Arraste ou clique para escolher. Excel (.xlsx, .xls) ou CSV.</p>
          </button>

          <div className="tile paste-tile">
            <span className="tile-icon">
              <Icon name="copy" size={20} />
            </span>
            <h3>Colar do Excel</h3>
            <p>Copie as linhas com o cabeçalho e cole aqui.</p>
            <textarea
              className="input paste-area mono"
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              placeholder={'SeuNumero\tNumeroDocumento\tNomeSacado\tDataVencimento\tValorNominal\n…'}
              spellCheck={false}
            />
            <button type="button" className="btn btn-sm" disabled={!pasted.trim()} onClick={handlePaste}>
              Usar dados colados
            </button>
          </div>
        </div>

        {error && (
          <div className="chat-error" style={{ marginTop: 16 }}>
            <Icon name="alert" size={14} /> {error}
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          className="sr-only"
          tabIndex={-1}
          accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ mapeamento de colunas

function ColumnsMenu({ session, onChange }: { session: EstoqueSession; onChange: (map: ColumnMap) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const mapped = COLUMNS.filter((c) => session.map[c.key] !== undefined).length;
  const missingImportant = COLUMNS.filter((c) => c.important && session.map[c.key] === undefined);
  return (
    <div className="popover-anchor" ref={ref}>
      <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
        <Icon name="sliders" size={14} /> Colunas
        <span className={`counter${missingImportant.length ? ' warn' : ''}`}>
          {mapped}/{COLUMNS.length}
        </span>
      </button>
      {open && (
        <div className="popover right columns-pop">
          <div className="menu-label">Colunas do arquivo</div>
          <p className="columns-help">Reconhecidas pelo nome do cabeçalho. Ajuste se alguma estiver errada.</p>
          {COLUMNS.map((c) => (
            <label key={c.key} className="column-row">
              <span>
                {c.label}
                {c.important && session.map[c.key] === undefined && <span className="dot-warn" title="Não encontrada" />}
              </span>
              <select
                className="input"
                value={session.map[c.key] ?? ''}
                onChange={(e) => {
                  const next = { ...session.map };
                  if (e.target.value === '') delete next[c.key];
                  else next[c.key] = Number(e.target.value);
                  onChange(next);
                }}
              >
                <option value="">— não usar —</option>
                {session.table.headers.map((h, i) => (
                  <option key={i} value={i}>
                    {h || `Coluna ${i + 1}`}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ tabela

const VALOR_LABEL: Record<ValorPagoBase, string> = {
  valorNominal: 'Valor nominal',
  valorPresenteAtualizado: 'Valor presente atualizado',
  valorPresente: 'Valor presente',
  valorAquisicao: 'Valor de aquisição',
  nenhum: 'Não informar',
};

const VALOR_COLUMN: Partial<Record<ValorPagoBase, ColumnKey>> = {
  valorNominal: 'valorNominal',
  valorPresenteAtualizado: 'valorPresenteAtualizado',
  valorPresente: 'valorPresente',
  valorAquisicao: 'valorAquisicao',
};

// ------------------------------------------------------------------ filtro de data

type DateField = 'vencimento' | 'emissao';

interface DateRange {
  field: DateField;
  from: string;
  to: string;
}

const DATE_FIELD_LABEL: Record<DateField, string> = { vencimento: 'Vencimento', emissao: 'Emissão' };

function presets(): { label: string; from: string; to: string }[] {
  const today = todayIso();
  const [y, m] = today.split('-').map(Number) as [number, number];
  const first = `${y}-${String(m).padStart(2, '0')}-01`;
  const nextMonth = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
  return [
    { label: 'Vencidos', from: '', to: addDaysIso(today, -1) },
    { label: 'Hoje', from: today, to: today },
    { label: 'Próximos 7 dias', from: today, to: addDaysIso(today, 7) },
    { label: 'Próximos 30 dias', from: today, to: addDaysIso(today, 30) },
    { label: 'Este mês', from: first, to: addDaysIso(nextMonth, -1) },
  ];
}

function describeRange(r: DateRange) {
  if (r.from && r.to) return r.from === r.to ? formatIsoBR(r.from) : `${formatIsoBR(r.from)} – ${formatIsoBR(r.to)}`;
  if (r.from) return `a partir de ${formatIsoBR(r.from)}`;
  if (r.to) return `até ${formatIsoBR(r.to)}`;
  return '';
}

function DateFilter({ value, onChange, hasEmissao }: { value: DateRange; onChange: (r: DateRange) => void; hasEmissao: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  const active = Boolean(value.from || value.to);
  const clear = () => onChange({ ...value, from: '', to: '' });
  return (
    <div className="popover-anchor" ref={ref}>
      <div className={`filter-btn${active ? ' on' : ''}`}>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(!open)}>
          <Icon name="calendar" size={14} />
          {active ? `${DATE_FIELD_LABEL[value.field]}: ${describeRange(value)}` : 'Data'}
        </button>
        {active && (
          <button type="button" className="btn btn-sm filter-clear" aria-label="Limpar filtro de data" onClick={clear}>
            <Icon name="x" size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="popover left date-pop">
          {hasEmissao && (
            <div className="segmented">
              {(['vencimento', 'emissao'] as DateField[]).map((f) => (
                <button key={f} type="button" className={value.field === f ? 'on' : ''} onClick={() => onChange({ ...value, field: f })}>
                  {DATE_FIELD_LABEL[f]}
                </button>
              ))}
            </div>
          )}
          <div className="date-range">
            <label className="field">
              <span className="field-label">
                <span className="lbl">De</span>
              </span>
              <input className="input" type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
            </label>
            <label className="field">
              <span className="field-label">
                <span className="lbl">Até</span>
              </span>
              <input className="input" type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
            </label>
          </div>
          <div className="date-presets">
            {presets().map((p) => (
              <button
                key={p.label}
                type="button"
                className={`chip${value.from === p.from && value.to === p.to ? ' on' : ''}`}
                onClick={() => onChange({ ...value, from: p.from, to: p.to })}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="date-foot">
            <button type="button" className="link-btn neutral" onClick={clear} disabled={!active}>
              Limpar
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
              Aplicar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SortKey = 'vencimento' | 'emissao' | 'valorNominal';
type Sort = { key: SortKey; dir: 1 | -1 } | null;

function SortHeader({ label, k, sort, onSort, className }: { label: string; k: SortKey; sort: Sort; onSort: (k: SortKey) => void; className?: string }) {
  const on = sort?.key === k;
  return (
    <th
      className={`sortable${on ? ' sorted' : ''}${className ? ` ${className}` : ''}`}
      onClick={() => onSort(k)}
      aria-sort={on ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="sort-ind">{on ? (sort!.dir === 1 ? '↑' : '↓') : '↕'}</span>
    </th>
  );
}

function statusTone(s: string) {
  const n = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  if (n.includes('vencid')) return 'danger';
  if (n.includes('vencer') || n.includes('aberto')) return 'success';
  return '';
}

export function EstoqueView({ session, onSession, onClose, onGenerate }: Props) {
  const { doc } = useShell();
  const [q, setQ] = useState('');
  const [cedente, setCedente] = useState('');
  const [status, setStatus] = useState('');
  const [range, setRange] = useState<DateRange>({ field: 'vencimento', from: '', to: '' });
  const [sort, setSort] = useState<Sort>(null);
  const [config, setConfig] = useState<Config>(loadConfig);
  const [dataLiquidacao, setDataLiquidacao] = useState(todayIso());
  const lastClicked = useRef<number | null>(null);

  useEffect(() => saveConfig(config), [config]);

  const titulos = useMemo(() => (session ? extractTitulos(session.table, session.map) : []), [session]);
  const selected = useMemo(() => new Set(session?.selected ?? []), [session]);

  // Nome do originador vem do arquivo quando ainda não foi informado.
  useEffect(() => {
    if (!session || config.header.nomeOriginador) return;
    const nome = originadorFrom(session.table, session.map);
    if (nome) setConfig((c) => ({ ...c, header: { ...c.header, nomeOriginador: nome } }));
  }, [session, config.header.nomeOriginador]);

  const cedentes = useMemo(() => [...new Set(titulos.map((t) => t.cedenteNome).filter(Boolean))].sort(), [titulos]);
  const statuses = useMemo(() => [...new Set(titulos.map((t) => t.status).filter(Boolean))].sort(), [titulos]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = titulos.filter((t) => {
      if (cedente && t.cedenteNome !== cedente) return false;
      if (status && t.status !== status) return false;
      if (range.from || range.to) {
        const d = t[range.field];
        if (!d || (range.from && d < range.from) || (range.to && d > range.to)) return false;
      }
      if (!term) return true;
      return [t.seuNumero, t.numDocumento, t.sacadoNome, t.sacadoDoc, t.cedenteNome, t.cedenteDoc].some((v) => v.toLowerCase().includes(term));
    });
    if (!sort) return list;
    return [...list].sort((a, b) => {
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va === vb) return 0;
      if (va === null) return 1; // vazios sempre no fim
      if (vb === null) return -1;
      return (va < vb ? -1 : 1) * sort.dir;
    });
  }, [titulos, q, cedente, status, range, sort]);

  if (!session) {
    return (
      <main className="estoque-view">
        <ViewHead onClose={onClose} hasDoc={!!doc} />
        <ImportPanel onLoaded={onSession} />
      </main>
    );
  }

  const toggleSort = (k: SortKey) =>
    setSort((cur) => (cur?.key !== k ? { key: k, dir: 1 } : cur.dir === 1 ? { key: k, dir: -1 } : null));

  const setSelected = (next: Set<number>) => onSession({ ...session, selected: [...next].sort((a, b) => a - b) });

  const toggle = (t: EstoqueTitulo, shift: boolean) => {
    const next = new Set(selected);
    if (shift && lastClicked.current !== null) {
      const a = filtered.findIndex((x) => x.index === lastClicked.current);
      const b = filtered.findIndex((x) => x.index === t.index);
      if (a !== -1 && b !== -1) {
        const on = !selected.has(t.index);
        for (const x of filtered.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(x.index) : next.delete(x.index);
        lastClicked.current = t.index;
        return setSelected(next);
      }
    }
    next.has(t.index) ? next.delete(t.index) : next.add(t.index);
    lastClicked.current = t.index;
    setSelected(next);
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.index));
  const someFilteredSelected = filtered.some((t) => selected.has(t.index));
  const toggleAll = () => {
    const next = new Set(selected);
    for (const t of filtered) allFilteredSelected ? next.delete(t.index) : next.add(t.index);
    setSelected(next);
  };

  const chosen = titulos.filter((t) => selected.has(t.index));
  const totalNominal = chosen.reduce((s, t) => s + (t.valorNominal ?? 0), 0);
  const totalPago = config.valorPago === 'nenhum' ? 0 : chosen.reduce((s, t) => s + (valorOf(t, config.valorPago) ?? 0), 0);
  const semValorPago = config.valorPago !== 'nenhum' ? chosen.filter((t) => valorOf(t, config.valorPago) === null).length : 0;
  const ocorrencia = config.ocorrencia === 'outro' ? config.ocorrenciaOutro.trim() : config.ocorrencia;
  const missing = (['endereco', 'cep'] as ColumnKey[]).filter((k) => session.map[k] === undefined);

  const generate = () => {
    const built = buildBaixa(chosen, {
      ocorrencia,
      valorPago: config.valorPago,
      dataLiquidacao,
      termoCessao: config.termoCessao.trim() || undefined,
      header: config.header,
    });
    toast(`Baixa gerada com ${chosen.length} título${chosen.length > 1 ? 's' : ''}`);
    onGenerate({ ...built, detection: { confidence: 'alta', reasons: [`Gerado a partir do estoque "${session.fileName}".`] } });
  };

  const setHeader = (k: keyof Config['header'], v: string) => setConfig((c) => ({ ...c, header: { ...c.header, [k]: v } }));

  return (
    <main className="estoque-view">
      <ViewHead onClose={onClose} hasDoc={!!doc}>
        <span className="estoque-file">
          <Icon name="file" size={14} />
          <span className="mono">{session.fileName}</span>
          {session.sheet && <span className="muted">· aba {session.sheet}</span>}
          <span className="muted">· {titulos.length} títulos</span>
        </span>
        <button type="button" className="btn btn-sm" onClick={() => onSession(null)}>
          Trocar arquivo
        </button>
      </ViewHead>

      <div className="estoque-body">
        <section className="estoque-main">
          <div className="estoque-toolbar">
            <label className="search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar número, sacado, cedente, CNPJ" style={{ width: 230 }} />
            </label>
            {cedentes.length > 1 && (
              <select className="input input-sm" value={cedente} onChange={(e) => setCedente(e.target.value)}>
                <option value="">Todos os cedentes</option>
                {cedentes.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            )}
            {statuses.length > 1 && (
              <select className="input input-sm" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Todas as situações</option>
                {statuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            )}
            <DateFilter value={range} onChange={setRange} hasEmissao={session.map.emissao !== undefined} />
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 12 }}>
              {filtered.length === titulos.length ? `${titulos.length} títulos` : `${filtered.length} de ${titulos.length}`}
            </span>
            <ColumnsMenu session={session} onChange={(map) => onSession({ ...session, map })} />
          </div>

          <div className="estoque-table-wrap">
            <table className="estoque-table">
              <thead>
                <tr>
                  <th className="c-check">
                    <input
                      type="checkbox"
                      aria-label="Selecionar todos os títulos filtrados"
                      checked={allFilteredSelected}
                      ref={(el) => {
                        if (el) el.indeterminate = !allFilteredSelected && someFilteredSelected;
                      }}
                      onChange={toggleAll}
                    />
                  </th>
                  <th>Seu número</th>
                  <th>Documento</th>
                  <th>Sacado</th>
                  <th>Cedente</th>
                  <SortHeader label="Vencimento" k="vencimento" sort={sort} onSort={toggleSort} />
                  <SortHeader label="Valor nominal" k="valorNominal" sort={sort} onSort={toggleSort} className="num" />
                  {config.valorPago !== 'nenhum' && config.valorPago !== 'valorNominal' && <th className="num">{VALOR_LABEL[config.valorPago]}</th>}
                  <th>Situação</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => {
                  const on = selected.has(t.index);
                  return (
                    <tr key={t.index} className={on ? 'on' : ''} onClick={(e) => toggle(t, e.shiftKey)}>
                      <td className="c-check">
                        <input type="checkbox" checked={on} readOnly tabIndex={-1} aria-label={`Selecionar ${t.numDocumento || t.seuNumero}`} />
                      </td>
                      <td className="mono nowrap">{t.seuNumero || '—'}</td>
                      <td className="mono nowrap">{t.numDocumento || '—'}</td>
                      <td>
                        <div className="cell-main">{t.sacadoNome || '—'}</div>
                        {t.sacadoDoc && <div className="cell-sub mono">{formatDoc(t.sacadoDoc)}</div>}
                      </td>
                      <td>
                        <div className="cell-main">{t.cedenteNome || '—'}</div>
                        {t.cedenteDoc && <div className="cell-sub mono">{formatDoc(t.cedenteDoc)}</div>}
                      </td>
                      <td className="nowrap tnum">{formatIsoBR(t.vencimento) || '—'}</td>
                      <td className="num tnum nowrap">{t.valorNominal === null ? '—' : formatBRL(t.valorNominal)}</td>
                      {config.valorPago !== 'nenhum' && config.valorPago !== 'valorNominal' && (
                        <td className="num tnum nowrap">{valorOf(t, config.valorPago) === null ? '—' : formatBRL(valorOf(t, config.valorPago)!)}</td>
                      )}
                      <td>{t.status && <span className={`pill ${statusTone(t.status)}`}>{t.status}</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div className="empty">Nenhum título corresponde aos filtros.</div>}
          </div>
        </section>

        <aside className="estoque-side">
          <div className="box">
            <div className="side-summary">
              <div className="stat">
                <span className="k">Selecionados</span>
                <span className="v">{chosen.length}</span>
              </div>
              <div className="stat">
                <span className="k">Valor nominal</span>
                <span className="v">{formatBRL(totalNominal)}</span>
              </div>
              {config.valorPago !== 'nenhum' && (
                <div className="stat">
                  <span className="k">Valor pago</span>
                  <span className="v">{formatBRL(totalPago)}</span>
                </div>
              )}
            </div>

            <div className="side-form">
              <label className="field">
                <span className="field-label">
                  <span className="lbl">Tipo de baixa (ocorrência)</span>
                  <span className="req">*</span>
                </span>
                <select className="input" value={config.ocorrencia} onChange={(e) => setConfig((c) => ({ ...c, ocorrencia: e.target.value }))}>
                  <option value="">Selecione…</option>
                  {FIDC_BAIXA_OCORRENCIAS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.value} — {o.label}
                    </option>
                  ))}
                  <option value="outro">Outro código…</option>
                </select>
              </label>
              {config.ocorrencia === 'outro' && (
                <label className="field">
                  <span className="field-label">
                    <span className="lbl">Código da ocorrência</span>
                  </span>
                  <input className="input mono" maxLength={2} value={config.ocorrenciaOutro} onChange={(e) => setConfig((c) => ({ ...c, ocorrenciaOutro: e.target.value.replace(/\D/g, '') }))} placeholder="ex.: 77" />
                </label>
              )}

              <label className="field">
                <span className="field-label">
                  <span className="lbl">Valor pago (pos. 83–92)</span>
                </span>
                <select className="input" value={config.valorPago} onChange={(e) => setConfig((c) => ({ ...c, valorPago: e.target.value as ValorPagoBase }))}>
                  {(Object.keys(VALOR_LABEL) as ValorPagoBase[]).map((k) => {
                    const col = VALOR_COLUMN[k];
                    const available = !col || session.map[col] !== undefined;
                    return (
                      <option key={k} value={k} disabled={!available}>
                        {VALOR_LABEL[k]}
                        {available ? '' : ' (não há no arquivo)'}
                      </option>
                    );
                  })}
                </select>
              </label>

              {config.valorPago !== 'nenhum' && (
                <label className="field">
                  <span className="field-label">
                    <span className="lbl">Data da liquidação</span>
                  </span>
                  <input className="input" type="date" value={dataLiquidacao} onChange={(e) => setDataLiquidacao(e.target.value)} />
                </label>
              )}

              <label className="field">
                <span className="field-label">
                  <span className="lbl">Nº do termo de cessão</span>
                </span>
                <input
                  className="input"
                  value={config.termoCessao}
                  maxLength={19}
                  onChange={(e) => setConfig((c) => ({ ...c, termoCessao: e.target.value }))}
                  placeholder="Opcional — aplica a todos"
                />
              </label>

              <details className="side-details">
                <summary>Dados do arquivo (header)</summary>
                <div className="side-details-body">
                  <label className="field">
                    <span className="field-label">
                      <span className="lbl">Código do originador</span>
                    </span>
                    <input className="input mono" value={config.header.codOriginador ?? ''} onChange={(e) => setHeader('codOriginador', e.target.value.replace(/\D/g, ''))} />
                  </label>
                  <label className="field">
                    <span className="field-label">
                      <span className="lbl">Nome do originador</span>
                    </span>
                    <input className="input" value={config.header.nomeOriginador ?? ''} maxLength={30} onChange={(e) => setHeader('nomeOriginador', e.target.value)} />
                  </label>
                  <div className="side-row">
                    <label className="field">
                      <span className="field-label">
                        <span className="lbl">Nº do banco</span>
                      </span>
                      <input className="input mono" value={config.header.numBanco ?? ''} maxLength={3} onChange={(e) => setHeader('numBanco', e.target.value.replace(/\D/g, ''))} />
                    </label>
                    <label className="field">
                      <span className="field-label">
                        <span className="lbl">Seq. do arquivo</span>
                      </span>
                      <input className="input mono" value={config.header.seqArquivo ?? ''} maxLength={7} onChange={(e) => setHeader('seqArquivo', e.target.value.replace(/\D/g, ''))} />
                    </label>
                  </div>
                  <label className="field">
                    <span className="field-label">
                      <span className="lbl">Nome do banco</span>
                    </span>
                    <input className="input" value={config.header.nomeBanco ?? ''} maxLength={15} onChange={(e) => setHeader('nomeBanco', e.target.value)} />
                  </label>
                  <p className="side-note">Esses dados ficam salvos neste navegador para as próximas baixas.</p>
                </div>
              </details>

              {(missing.length > 0 || semValorPago > 0) && (
                <div className="side-warn">
                  <Icon name="info" size={14} />
                  <div>
                    {missing.length > 0 && <div>O arquivo não traz endereço/CEP do sacado — ficam como pendência no editor.</div>}
                    {semValorPago > 0 && (
                      <div>
                        {semValorPago} título{semValorPago > 1 ? 's' : ''} sem {VALOR_LABEL[config.valorPago].toLowerCase()} no arquivo.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="side-foot">
              <button type="button" className="btn btn-primary side-generate" disabled={!chosen.length || !ocorrencia} onClick={generate}>
                <Icon name="download" size={14} />
                Gerar CNAB de baixa{chosen.length ? ` (${chosen.length})` : ''}
              </button>
              <p className="side-note">
                {!chosen.length ? 'Selecione os títulos na tabela.' : !ocorrencia ? 'Escolha a ocorrência.' : 'Abre no editor para revisar antes de baixar.'}
              </p>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function ViewHead({ onClose, hasDoc, children }: { onClose: () => void; hasDoc: boolean; children?: React.ReactNode }) {
  return (
    <header className="view-head">
      <button type="button" className="btn btn-sm btn-ghost" onClick={onClose}>
        <Icon name="arrowLeft" size={14} /> {hasDoc ? 'Voltar ao editor' : 'Início'}
      </button>
      <span className="topbar-sep" />
      <div className="view-title">
        <Icon name="table" size={15} />
        <strong>Baixa pelo estoque</strong>
      </div>
      <span style={{ flex: 1 }} />
      {children}
    </header>
  );
}
