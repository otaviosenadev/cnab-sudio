import { memo, useCallback, useMemo, useState } from 'react';
import type { FieldRef, FieldSpec, Issue, LayoutSpec, RecordInstance, Titulo } from '../cnab/types';
import { getRaw, optionLabel, toLogical } from '../cnab/codec';
import {
  addChild,
  applySacadoToTitulo,
  duplicateTitulo,
  groupSacados,
  insertTitulo,
  newTituloRecords,
  readShare,
  removeRecord,
  removeTitulo,
  setFieldLogical,
  shareRefs,
  writeShare,
  type SacadoGroup,
} from '../cnab/document';
import { specOf, tituloRecords } from '../cnab/records';
import { canonicalDoc, cnabDateToIso, formatBRL, formatDoc, formatIsoBR, onlyDigits } from '../cnab/format';
import { shareDomId, useEditor } from '../state/editor';
import { link } from '../state/link';
import { Field } from './Field';
import { Icon, type IconName } from './Icon';

const HIDDEN = (f: FieldSpec) => f.fixed !== undefined || f.blank || f.auto || f.group === 'control';

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter((p) => p.length > 2 || /^[A-Z]{2,}$/.test(p));
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function Box({
  icon,
  title,
  subtitle,
  actions,
  children,
  flat,
}: {
  icon: IconName;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
  flat?: boolean;
}) {
  return (
    <section className="box">
      <header className={`box-header${flat ? ' flat' : ''}`}>
        <span className="box-icon">
          <Icon name={icon} />
        </span>
        <div className="box-title">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  );
}

function MoreToggle({ open, count, onToggle, label = 'campos' }: { open: boolean; count: number; onToggle: () => void; label?: string }) {
  if (!count) return null;
  return (
    <div className="more-toggle">
      <button type="button" className="link-btn neutral" onClick={onToggle}>
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={14} />
        {open ? `Ocultar ${label} adicionais` : `Mais ${count} ${label}`}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ campos de um registro

function RecordFields({ rec, fields, scope }: { rec: RecordInstance; fields: FieldSpec[]; scope?: Set<string> }) {
  const { layout, edit, getDoc, issuesByRef } = useEditor();
  return (
    <div className="grid">
      {fields.map((f) => {
        const key = `${rec.uid}:${f.id}`;
        return (
          <Field
            key={f.id}
            spec={f}
            raw={getRaw(rec.raw, f)}
            domId={`fld-${rec.uid}-${f.id}`}
            linkKey={key}
            issues={issuesByRef.get(key)}
            getRefs={() => (f.share && f.group === 'sacado' ? shareRefs(getDoc(), layout, f.share, scope) : [{ uid: rec.uid, field: f.id }])}
            onChange={(v) => edit(key, (doc, l) => setFieldLogical(doc, l, rec.uid, f.id, v))}
          />
        );
      })}
    </div>
  );
}

/** Campo compartilhado (cedente, banco…): um valor lógico escrito em várias posições. */
function SharedField({ shareKey, spec, scope, label, onValue }: { shareKey: string; spec: FieldSpec; scope?: Set<string>; label?: string; onValue?: (v: string) => void }) {
  const { doc, layout, edit, getDoc, issuesByRef } = useEditor();
  const refs = useMemo(() => shareRefs(doc, layout, shareKey, scope), [doc, layout, shareKey, scope]);
  const value = readShare(doc, layout, shareKey, scope);
  const first = refs[0];
  const issues = useMemo(() => {
    const out: Issue[] = [];
    for (const r of refs) out.push(...(issuesByRef.get(`${r.uid}:${r.field}`) ?? []));
    return out.length ? dedupeIssues(out) : undefined;
  }, [refs, issuesByRef]);
  const distinct = useMemo(() => {
    const s = new Set<string>();
    for (const r of refs) {
      const rec = doc.records.find((x) => x.uid === r.uid)!;
      const f = specOf(layout, rec.type).fields.find((x) => x.id === r.field)!;
      s.add(toLogical(f, getRaw(rec.raw, f)));
    }
    return s.size;
  }, [refs, doc, layout]);

  const fieldSpec = value?.field ?? spec;
  return (
    <Field
      spec={fieldSpec}
      raw={value?.raw ?? ''}
      domId={`${shareDomId(shareKey)}${scope ? `-${first?.uid ?? ''}` : ''}`}
      linkKey={first ? `${first.uid}:${first.field}` : `none:${shareKey}`}
      label={label}
      disabled={!first}
      issues={issues}
      note={!first ? 'Adicione um título para preencher.' : distinct > 1 ? `${distinct} valores diferentes no arquivo — editar unifica.` : undefined}
      getRefs={() => shareRefs(getDoc(), layout, shareKey, scope)}
      onChange={(v) => {
        edit(`share:${shareKey}`, (d, l) => writeShare(d, l, shareKey, v, scope));
        onValue?.(v);
      }}
    />
  );
}

function dedupeIssues(list: Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => (seen.has(i.message) ? false : (seen.add(i.message), true)));
}

// ------------------------------------------------------------------ Arquivo

function ArquivoCard() {
  const { doc, layout, ui, setUi } = useEditor();
  const headers = doc.records.filter((r) => {
    const role = specOf(layout, r.type).role;
    return role === 'header' || role === 'batchHeader';
  });
  const seenShare = new Set<string>();
  const items: { rec: RecordInstance; f: FieldSpec }[] = [];
  for (const rec of headers) {
    for (const f of specOf(layout, rec.type).fields) {
      if (f.group !== 'arquivo' || f.fixed !== undefined || f.auto) continue;
      if (f.share) {
        if (seenShare.has(f.share)) continue;
        seenShare.add(f.share);
      }
      items.push({ rec, f });
    }
  }
  const main = items.filter((i) => !i.f.more);
  const more = items.filter((i) => i.f.more);
  const open = !!ui.more.arquivo;
  const render = (list: typeof items) => (
    <div className="grid">
      {list.map(({ rec, f }) =>
        f.share ? <SharedField key={f.id} shareKey={f.share} spec={f} /> : <SingleField key={`${rec.uid}-${f.id}`} rec={rec} f={f} />,
      )}
    </div>
  );
  return (
    <Box
      icon="file"
      title="Arquivo"
      subtitle={`${layout.name} · ${headers.map((h) => specOf(layout, h.type).label.toLowerCase()).join(' e ')}`}
    >
      <div className="box-body">
        {render(main)}
        {open && more.length > 0 && <div style={{ marginTop: 14 }}>{render(more)}</div>}
        <MoreToggle open={open} count={more.length} onToggle={() => setUi((u) => ({ more: { ...u.more, arquivo: !open } }))} />
      </div>
    </Box>
  );
}

function SingleField({ rec, f }: { rec: RecordInstance; f: FieldSpec }) {
  const { edit, issuesByRef } = useEditor();
  const key = `${rec.uid}:${f.id}`;
  return (
    <Field
      spec={f}
      raw={getRaw(rec.raw, f)}
      domId={`fld-${rec.uid}-${f.id}`}
      linkKey={key}
      issues={issuesByRef.get(key)}
      getRefs={() => [{ uid: rec.uid, field: f.id }]}
      onChange={(v) => edit(key, (doc, l) => setFieldLogical(doc, l, rec.uid, f.id, v))}
    />
  );
}

// ------------------------------------------------------------------ Cedente

function cedenteFields(layout: LayoutSpec) {
  const seen = new Set<string>();
  const out: FieldSpec[] = [];
  for (const r of layout.records)
    for (const f of r.fields)
      if (f.group === 'cedente' && f.share && !seen.has(f.share)) {
        seen.add(f.share);
        out.push(f);
      }
  return out;
}

function CedenteCard() {
  const { doc, layout, ui, setUi } = useEditor();
  const fields = useMemo(() => cedenteFields(layout), [layout]);
  const main = fields.filter((f) => !f.more);
  const more = fields.filter((f) => f.more);
  const open = !!ui.more.cedente;
  const nomeKey = fields.find((f) => /nome/.test(f.share!))?.share;
  const nome = nomeKey ? readShare(doc, layout, nomeKey)?.logical : '';
  return (
    <Box
      icon="building"
      title={
        <>
          {layout.labels.cedente}
          {nome && <span className="muted" style={{ fontWeight: 400 }}>· {nome}</span>}
        </>
      }
      subtitle={layout.labels.cedenteHint}
    >
      <div className="box-body">
        <div className="grid">
          {main.map((f) => (
            <SharedField key={f.share} shareKey={f.share!} spec={f} />
          ))}
        </div>
        {open && more.length > 0 && (
          <div className="grid" style={{ marginTop: 14 }}>
            {more.map((f) => (
              <SharedField key={f.share} shareKey={f.share!} spec={f} />
            ))}
          </div>
        )}
        <MoreToggle open={open} count={more.length} onToggle={() => setUi((u) => ({ more: { ...u.more, cedente: !open } }))} />
      </div>
    </Box>
  );
}

// ------------------------------------------------------------------ Sacados

function sacadoFields(layout: LayoutSpec) {
  const seen = new Set<string>();
  const out: FieldSpec[] = [];
  for (const r of layout.records)
    for (const f of r.fields)
      if (f.group === 'sacado' && f.share && !seen.has(f.share)) {
        seen.add(f.share);
        out.push(f);
      }
  return out;
}

function SacadosCard() {
  const { doc, layout, titulos, ui, setUi } = useEditor();
  const groups = useMemo(() => groupSacados(doc, layout, titulos), [doc, layout, titulos]);
  const [showAll, setShowAll] = useState(false);
  const fields = useMemo(() => sacadoFields(layout), [layout]);
  const visible = showAll ? groups : groups.slice(0, 6);
  return (
    <Box
      icon="users"
      title={
        <>
          {layout.labels.sacados} <span className="counter">{groups.length}</span>
        </>
      }
      subtitle="Editar aqui atualiza todos os títulos do mesmo sacado."
      flat={groups.length === 0}
    >
      {groups.length > 0 && (
        <div className="list">
          {visible.map((g) => {
            const open = ui.openSacado === g.key;
            return (
              <div key={g.key}>
                <button
                  type="button"
                  className={`row${open ? ' open' : ''}`}
                  onClick={() => setUi({ openSacado: open ? null : g.key })}
                  onMouseEnter={() => link.setHover(g.titulos.map((t) => ({ uid: t.primary.uid, field: '*' })), 'form')}
                  onMouseLeave={() => link.setHover([], 'form')}
                >
                  <Icon name="chevronRight" className="chev" size={14} />
                  <span className="avatar">{initials(g.nome || '?')}</span>
                  <span className="row-main">
                    <span className="row-title">
                      <span className="t">{g.nome || <span className="subtle">Sem nome</span>}</span>
                    </span>
                    <span className="row-sub mono">
                      {g.doc ? formatDoc(g.doc) : 'sem documento'} · {g.titulos.length} título{g.titulos.length > 1 ? 's' : ''}
                    </span>
                  </span>
                  <span className="row-end">
                    <span className="v">{formatBRL(g.total)}</span>
                  </span>
                </button>
                {open && <SacadoEditor group={g} fields={fields} />}
              </div>
            );
          })}
          {groups.length > 6 && (
            <div className="box-footer">
              <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>
                {showAll ? 'Mostrar menos' : `Ver todos os ${groups.length}`}
              </button>
            </div>
          )}
        </div>
      )}
    </Box>
  );
}

function SacadoEditor({ group, fields }: { group: SacadoGroup; fields: FieldSpec[] }) {
  const { setUi } = useEditor();
  return (
    <div className="expand">
      <div className="expand-body">
        <div className="grid">
          {fields.map((f) => (
            <SharedField
              key={f.share}
              shareKey={f.share!}
              spec={f}
              scope={group.scope}
              onValue={
                f.share === 'sacado.doc'
                  ? (v) => {
                      const c = canonicalDoc(v);
                      if (c) setUi({ openSacado: `doc:${c}` });
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Títulos

function TitulosCard() {
  const { doc, layout, titulos, edit, setUi, ui, issuesByUid, focusDom, getDoc } = useEditor();
  const [q, setQ] = useState('');
  const detail = layout.records.find((r) => r.role === 'detail')!;
  const fOf = (id?: string) => (id ? detail.fields.find((f) => f.id === id) : undefined);
  const fValor = fOf(layout.summary.valor)!;
  const fAq = fOf(layout.summary.aquisicao);
  const fPago = fOf(layout.summary.pago);

  const totals = useMemo(() => {
    let face = 0n;
    let aq = 0n;
    let pago = 0n;
    for (const t of titulos) {
      face += BigInt(onlyDigits(getRaw(t.primary.raw, fValor)) || '0');
      if (fAq) aq += BigInt(onlyDigits(getRaw(t.primary.raw, fAq)) || '0');
      if (fPago) pago += BigInt(onlyDigits(getRaw(t.primary.raw, fPago)) || '0');
    }
    return { face, aq, pago };
  }, [titulos, fValor, fAq, fPago]);

  const filtered = useMemo(() => {
    const term = q.trim().toUpperCase();
    if (!term) return titulos;
    return titulos.filter((t) => tituloRecords(t).some((r) => r.raw.toUpperCase().includes(term)));
  }, [q, titulos]);

  const add = () => {
    // Registros criados fora do reducer: uids estáveis mesmo com StrictMode.
    const recs = newTituloRecords(getDoc(), layout);
    const created = recs[0]!.uid;
    edit('add-titulo', (d, l) => insertTitulo(d, l, recs));
    setQ('');
    setUi({ openTitulo: created });
    const first = detail.fields.find((f) => !HIDDEN(f) && f.group === 'titulo' && !f.more);
    if (first) focusDom(`fld-${created}-${first.id}`);
  };

  return (
    <Box
      icon="list"
      title={
        <>
          Títulos <span className="counter">{titulos.length}</span>
        </>
      }
      subtitle={`Ocorrência padrão para novos títulos: ${doc.defaultOcorrencia}`}
      actions={
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {titulos.length > 4 && (
            <label className="search">
              <Icon name="search" size={14} />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar títulos" aria-label="Filtrar títulos" />
            </label>
          )}
          <button type="button" className="btn btn-sm" onClick={add}>
            <Icon name="plus" size={14} /> Novo título
          </button>
        </div>
      }
      flat={titulos.length === 0}
    >
      {titulos.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <span className="k">Valor de face</span>
              <span className="v">{formatBRL(totals.face)}</span>
            </div>
            {fAq && (
              <div className="stat">
                <span className="k">Valor de aquisição</span>
                <span className="v">{formatBRL(totals.aq)}</span>
              </div>
            )}
            {fPago && totals.pago > 0n && (
              <div className="stat">
                <span className="k">Valor pago</span>
                <span className="v">{formatBRL(totals.pago)}</span>
              </div>
            )}
            {fAq && totals.face > 0n && (
              <div className="stat">
                <span className="k">Deságio</span>
                <span className="v">{(Number(((totals.face - totals.aq) * 10000n) / totals.face) / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</span>
              </div>
            )}
          </div>
          <div className="list">
            {filtered.map((t) => (
              <TituloItem
                key={t.uid}
                titulo={t}
                raws={tituloRecords(t).map((r) => r.raw).join('\n')}
                open={ui.openTitulo === t.uid}
                issues={tituloRecords(t).flatMap((r) => issuesByUid.get(r.uid) ?? [])}
              />
            ))}
            {filtered.length === 0 && <div className="empty">Nenhum título corresponde ao filtro.</div>}
          </div>
        </>
      )}
      {titulos.length === 0 && (
        <div className="empty">
          Nenhum título no arquivo.{' '}
          <button type="button" className="link-btn" onClick={add}>
            Adicionar o primeiro
          </button>
        </div>
      )}
    </Box>
  );
}

interface TituloItemProps {
  titulo: Titulo;
  raws: string;
  open: boolean;
  issues: Issue[];
}

const TituloItem = memo(function TituloItem({ titulo, open, issues }: TituloItemProps) {
  const { layout, setUi } = useEditor();
  const p = titulo.primary;
  const spec = specOf(layout, p.type);
  const f = (id?: string) => (id ? spec.fields.find((x) => x.id === id) : undefined);
  const val = (id?: string) => {
    const fs = f(id);
    return fs ? getRaw(p.raw, fs) : '';
  };
  const sacadoRec = tituloRecords(titulo).find((r) => specOf(layout, r.type).fields.some((x) => x.share === 'sacado.nome'));
  const sacadoNome = sacadoRec
    ? getRaw(sacadoRec.raw, specOf(layout, sacadoRec.type).fields.find((x) => x.share === 'sacado.nome')!).trim()
    : '';
  const numero = val(layout.summary.numero).trim();
  const venc = formatIsoBR(cnabDateToIso(val(layout.summary.vencimento)));
  const valor = formatBRL(onlyDigits(val(layout.summary.valor)) || '0');
  const aq = layout.summary.aquisicao ? onlyDigits(val(layout.summary.aquisicao)) : '';
  const ocF = f(layout.summary.ocorrencia)!;
  const oc = val(layout.summary.ocorrencia).trim();
  const ocLabel = optionLabel(ocF, oc);
  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;

  return (
    <div>
      <button
        type="button"
        className={`row${open ? ' open' : ''}`}
        onClick={() => setUi({ openTitulo: open ? null : titulo.uid })}
        onMouseEnter={() => link.setHover(tituloRecords(titulo).map((r) => ({ uid: r.uid, field: '*' })), 'form')}
        onMouseLeave={() => link.setHover([], 'form')}
        aria-expanded={open}
      >
        <Icon name="chevronRight" className="chev" size={14} />
        <span className="idx">{titulo.index + 1}</span>
        <span className="row-main">
          <span className="row-title">
            <span className="t mono">{numero || <span className="subtle">sem número</span>}</span>
            <span className="kbd" title={ocLabel ?? 'Código não documentado'}>
              {oc || '—'}
            </span>
            {errors > 0 ? (
              <span className="issue-dot error" title={`${errors} erro(s)`} />
            ) : warnings > 0 ? (
              <span className="issue-dot warning" title={`${warnings} alerta(s)`} />
            ) : null}
          </span>
          <span className="row-sub">
            {[sacadoNome || `${layout.labels.sacado} não informado`, venc && `vence ${venc}`]
              .filter(Boolean)
              .join('  ·  ')}
          </span>
        </span>
        <span className="row-end">
          <span className="v">{valor}</span>
          {aq && !/^0*$/.test(aq) && <span className="s">aquisição {formatBRL(aq)}</span>}
        </span>
      </button>
      {open && <TituloEditor titulo={titulo} />}
    </div>
  );
});

function TituloEditor({ titulo }: { titulo: Titulo }) {
  const { doc, layout, titulos, edit, ui, setUi } = useEditor();
  const scope = useMemo(() => new Set(tituloRecords(titulo).map((r) => r.uid)), [titulo]);
  const pSpec = specOf(layout, titulo.primary.type);
  const visible = pSpec.fields.filter((f) => !HIDDEN(f) && f.group === 'titulo');
  const main = visible.filter((f) => !f.more);
  const more = visible.filter((f) => f.more);
  const moreKey = `rec:${titulo.primary.uid}`;
  const moreOpen = !!ui.more[moreKey];

  const sacadoParts = tituloRecords(titulo)
    .map((rec) => ({ rec, fields: specOf(layout, rec.type).fields.filter((f) => !HIDDEN(f) && f.group === 'sacado') }))
    .filter((x) => x.fields.length);

  const groups = useMemo(() => groupSacados(doc, layout, titulos), [doc, layout, titulos]);
  const mine = groups.find((g) => g.titulos.some((t) => t.uid === titulo.uid));
  const others = groups.filter((g) => g !== mine && g.nome);

  const childTypes = layout.records.filter((r) => r.role === 'child');
  const toggleMore = useCallback(
    (key: string) => setUi((u) => ({ more: { ...u.more, [key]: !u.more[key] } })),
    [setUi],
  );

  return (
    <div className="expand">
      <div className="expand-body">
        <div className="section">
          <div className="section-head">
            <h3>Título</h3>
          </div>
          <RecordFields rec={titulo.primary} fields={main} />
          {moreOpen && more.length > 0 && (
            <div style={{ marginTop: 14 }}>
              <RecordFields rec={titulo.primary} fields={more} />
            </div>
          )}
          <MoreToggle open={moreOpen} count={more.length} onToggle={() => toggleMore(moreKey)} />
        </div>

        {sacadoParts.length > 0 && (
          <div className="section">
            <div className="section-head">
              <h3>{layout.labels.sacado}</h3>
              <span className="grow" />
              {others.length > 0 && (
                <select
                  className="input"
                  style={{ width: 'auto', maxWidth: 260, height: 28, fontSize: 12.5 }}
                  value=""
                  aria-label="Usar sacado existente"
                  onChange={(e) => {
                    const g = others.find((x) => x.key === e.target.value);
                    if (g) edit('apply-sacado', (d, l) => applySacadoToTitulo(d, l, g, titulo.uid));
                  }}
                >
                  <option value="">Usar {layout.labels.sacado.toLowerCase()} existente…</option>
                  {others.map((g) => (
                    <option key={g.key} value={g.key}>
                      {g.nome}
                      {g.doc ? ` — ${formatDoc(g.doc)}` : ''}
                    </option>
                  ))}
                </select>
              )}
            </div>
            {sacadoParts.map(({ rec, fields }) => (
              <RecordFields key={rec.uid} rec={rec} fields={fields} scope={scope} />
            ))}
          </div>
        )}

        {childTypes.map((ct) => {
          const recs = titulo.children.filter((c) => c.type === ct.id);
          const canAdd = !ct.requiredChild && (ct.repeatable || recs.length === 0);
          const withFields = recs
            .map((rec) => ({ rec, fields: specOf(layout, rec.type).fields.filter((f) => !HIDDEN(f) && f.group === 'titulo') }))
            .filter((x) => x.fields.length || !ct.requiredChild);
          if (!withFields.length && !canAdd) return null;
          if (!withFields.length) return null;
          return (
            <div className="section" key={ct.id}>
              <div className="section-head">
                <h3>{ct.section ?? ct.label}</h3>
                {ct.repeatable && <span className="counter">{recs.length}</span>}
                <span className="grow" />
                {canAdd && ct.repeatable && (
                  <button type="button" className="btn btn-sm btn-ghost" onClick={() => edit('add-child', (d, l) => addChild(d, l, titulo.uid, ct.id))}>
                    <Icon name="plus" size={14} /> {ct.label}
                  </button>
                )}
              </div>
              {withFields.map(({ rec, fields }, i) => {
                const k = `rec:${rec.uid}`;
                const cMain = fields.filter((f) => !f.more);
                const cMore = fields.filter((f) => f.more);
                const open = !!ui.more[k];
                return (
                  <div className="child-box" key={rec.uid}>
                    <div
                      className="child-box-head"
                      onMouseEnter={() => link.setHover([{ uid: rec.uid, field: '*' }], 'form')}
                      onMouseLeave={() => link.setHover([], 'form')}
                    >
                      <span className="badge child">{ct.short}</span>
                      <span>
                        {ct.label}
                        {ct.repeatable ? ` ${i + 1}` : ''}
                      </span>
                      <span style={{ flex: 1 }} />
                      {!ct.requiredChild && (
                        <button
                          type="button"
                          className="icon-btn sm"
                          title={`Remover ${ct.label.toLowerCase()}`}
                          onClick={() => edit('remove-child', (d) => removeRecord(d, rec.uid))}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="child-box-body">
                      {cMain.length > 0 && <RecordFields rec={rec} fields={cMain} />}
                      {open && cMore.length > 0 && (
                        <div style={{ marginTop: cMain.length ? 14 : 0 }}>
                          <RecordFields rec={rec} fields={cMore} />
                        </div>
                      )}
                      <MoreToggle open={open} count={cMore.length} onToggle={() => toggleMore(k)} />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}

        {childTypes.some((ct) => !ct.requiredChild && titulo.children.every((c) => c.type !== ct.id)) && (
          <div className="add-row">
            <span className="muted" style={{ fontSize: 12 }}>
              Registros opcionais:
            </span>
            {childTypes
              .filter((ct) => !ct.requiredChild && titulo.children.every((c) => c.type !== ct.id))
              .map((ct) => (
                <button
                  key={ct.id}
                  type="button"
                  className="btn btn-sm"
                  title={ct.description}
                  onClick={() => edit('add-child', (d, l) => addChild(d, l, titulo.uid, ct.id))}
                >
                  <Icon name="plus" size={14} /> {ct.label}
                </button>
              ))}
          </div>
        )}
      </div>
      <div className="expand-footer">
        <button type="button" className="btn btn-sm" onClick={() => edit('dup', (d, l) => duplicateTitulo(d, l, titulo.uid))}>
          <Icon name="duplicate" size={14} /> Duplicar
        </button>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger"
          onClick={() => {
            edit('remove-titulo', (d, l) => removeTitulo(d, l, titulo.uid));
            setUi({ openTitulo: null });
          }}
        >
          <Icon name="trash" size={14} /> Remover título
        </button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ painel

function ImportNotice() {
  const { doc, layout } = useEditor();
  const [hidden, setHidden] = useState(false);
  const notes = doc.importNotes ?? [];
  const det = doc.detection;
  if (hidden || (!notes.length && (!det || det.confidence === 'alta'))) return null;
  return (
    <div className={`notice${notes.length || det?.confidence === 'baixa' ? ' attention' : ''}`}>
      <Icon name={notes.length ? 'alert' : 'info'} />
      <div style={{ flex: 1 }}>
        <strong>
          Identificado como {layout.name}
          {det ? ` · confiança ${det.confidence}` : ''}
        </strong>
        {(notes.length > 0 || det) && (
          <ul>
            {notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
            {det?.reasons.slice(0, 3).map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
      </div>
      <button type="button" className="icon-btn sm" onClick={() => setHidden(true)} title="Dispensar">
        <Icon name="x" size={14} />
      </button>
    </div>
  );
}

export function EditorPanel() {
  return (
    <div className="editor">
      <ImportNotice />
      <ArquivoCard />
      <CedenteCard />
      <SacadosCard />
      <TitulosCard />
    </div>
  );
}

export type { FieldRef };
