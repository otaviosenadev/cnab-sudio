import { useEffect, useRef, useState } from 'react';
import type { FieldSpec } from '../cnab/types';
import { getRaw, isEmptyRaw, readable, width } from '../cnab/codec';
import { expandRef, setFieldRaw } from '../cnab/document';
import { specOf, groupTitulos } from '../cnab/records';
import { cnabDateToIso, formatBRL, formatIsoBR, onlyDigits } from '../cnab/format';
import { useEditor } from '../state/editor';
import { link, refKey, useLinkVersion } from '../state/link';

function showWs(v: string) {
  return v.replace(/ /g, '·');
}

export function Inspector() {
  const { doc, layout, issuesByRef, edit, locate, getDoc } = useEditor();
  const ls = useLinkVersion();
  const [onlyFilled, setOnlyFilled] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const selected = doc.records.find((r) => r.uid === ls.selectedUid) ?? doc.records.find((r) => specOf(layout, r.type).role === 'detail') ?? doc.records[0];

  useEffect(() => setEditing(null), [selected?.uid]);

  // Mantém a linha ativa visível no inspetor.
  useEffect(() => {
    if (ls.source === 'inspector') return;
    const row = bodyRef.current?.querySelector('tr.hl-active') as HTMLElement | null;
    row?.scrollIntoView({ block: 'nearest' });
  }, [ls.active, ls.source]);

  if (!selected) return null;
  const spec = specOf(layout, selected.type);
  const index = doc.records.indexOf(selected);

  let summary = '';
  if (spec.role === 'detail') {
    const f = (id?: string) => (id ? spec.fields.find((x) => x.id === id) : undefined);
    const v = (id?: string) => {
      const fs = f(id);
      return fs ? getRaw(selected.raw, fs) : '';
    };
    const t = groupTitulos(layout, doc.records).find((x) => x.uid === selected.uid);
    summary = [
      t ? `Título ${t.index + 1}` : '',
      v(layout.summary.numero).trim() && `doc. ${v(layout.summary.numero).trim()}`,
      formatIsoBR(cnabDateToIso(v(layout.summary.vencimento))) && `venc. ${formatIsoBR(cnabDateToIso(v(layout.summary.vencimento)))}`,
      formatBRL(onlyDigits(v(layout.summary.valor)) || '0'),
      `ocorrência ${v(layout.summary.ocorrencia).trim()}`,
    ]
      .filter(Boolean)
      .join(' · ');
  } else {
    summary = spec.description ?? '';
  }

  const rows = spec.fields.filter((f) => {
    if (!onlyFilled) return true;
    const raw = getRaw(selected.raw, f);
    if (f.blank) return raw.trim() !== '' && !/^[\s]*$/.test(raw) && !isEmptyRaw(f, raw);
    return !isEmptyRaw(f, raw) || f.fixed !== undefined;
  });

  const commit = (f: FieldSpec, value: string) => {
    const w = width(f);
    const raw = f.kind === 'num' ? value.padStart(w, '0').slice(-w) : value.padEnd(w, ' ').slice(0, w);
    edit(`raw:${selected.uid}:${f.id}`, (d, l) => setFieldRaw(d, l, selected.uid, f.id, raw));
    setEditing(null);
  };

  return (
    <div className="inspector" style={{ height: '100%' }}>
      <div className="inspector-head">
        <div style={{ minWidth: 0, flex: 1 }}>
          <h3>
            Linha {index + 1} · {spec.label}
          </h3>
          {summary && <div className="sum">{summary}</div>}
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyFilled} onChange={(e) => setOnlyFilled(e.target.checked)} />
          Só campos preenchidos
        </label>
      </div>
      <div className="inspector-body" ref={bodyRef}>
        <table className="itable">
          <thead>
            <tr>
              <th>Posição</th>
              <th>Campo</th>
              <th>Valor no arquivo</th>
              <th>Leitura</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const raw = getRaw(selected.raw, f);
              const key = refKey({ uid: selected.uid, field: f.id });
              const issues = issuesByRef.get(key);
              const worst = issues?.find((i) => i.level === 'error') ?? issues?.find((i) => i.level === 'warning') ?? issues?.[0];
              const hl = ls.activeKeys.has(key) ? 'hl-active' : ls.hoverKeys.has(key) ? 'hl-hover' : '';
              const read = readable(f, raw);
              const isEditing = editing === f.id;
              return (
                <tr
                  key={f.id}
                  className={hl}
                  onMouseEnter={() => link.setHover(expandRef(getDoc(), layout, { uid: selected.uid, field: f.id }), 'inspector')}
                  onMouseLeave={() => link.setHover([], 'inspector')}
                  onClick={() => {
                    link.setActive(expandRef(getDoc(), layout, { uid: selected.uid, field: f.id }), 'inspector', selected.uid);
                    locate({ uid: selected.uid, field: f.id });
                  }}
                >
                  <td className="c-pos">{f.start === f.end ? f.start : `${f.start}–${f.end}`}</td>
                  <td className="c-name">{f.label}</td>
                  <td
                    className="c-val"
                    title={f.auto ? 'Calculado automaticamente' : 'Duplo clique para editar o conteúdo bruto'}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!f.auto) setEditing(f.id);
                    }}
                  >
                    {isEditing ? (
                      <RawEditor
                        initial={raw}
                        maxLength={width(f)}
                        onCancel={() => setEditing(null)}
                        onCommit={(v) => commit(f, v)}
                      />
                    ) : (
                      showWs(raw)
                    )}
                  </td>
                  <td className="c-read">
                    {worst ? (
                      <span className={`pill ${worst.level === 'error' ? 'danger' : worst.level === 'warning' ? 'attention' : ''}`} title={worst.message}>
                        {f.blank ? 'fora do layout' : worst.message}
                      </span>
                    ) : f.auto ? (
                      <span className="subtle">automático</span>
                    ) : f.fixed !== undefined ? (
                      <span className="subtle">{read || 'fixo'}</span>
                    ) : (
                      read
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <div className="empty">Nenhum campo preenchido nesta linha.</div>}
      </div>
    </div>
  );
}

function RawEditor({ initial, maxLength, onCommit, onCancel }: { initial: string; maxLength: number; onCommit: (v: string) => void; onCancel: () => void }) {
  const [v, setV] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      value={v}
      maxLength={maxLength}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => finish(() => onCommit(v))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(() => onCommit(v));
        if (e.key === 'Escape') finish(onCancel);
      }}
    />
  );
}
