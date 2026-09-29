import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FieldSpec, LayoutSpec, RecordInstance } from '../cnab/types';
import { getRaw, readable, width } from '../cnab/codec';
import { expandRef } from '../cnab/document';
import { specOf } from '../cnab/records';
import { useEditor } from '../state/editor';
import { link, useLinkVersion } from '../state/link';

const LINE_H = 22;
const RULER_H = 26;
const OVERSCAN = 12;

interface LineProps {
  rec: RecordInstance;
  index: number;
  top: number;
  layout: LayoutSpec;
  showSpaces: boolean;
  /** campos destacados: field id -> 'hover' | 'active' */
  marks: string;
  lineState: string;
  issueLevel: '' | 'error' | 'warning';
  issueFields: string;
}

function renderText(text: string, showSpaces: boolean) {
  if (!showSpaces || !text.includes(' ')) return text;
  const parts: React.ReactNode[] = [];
  let buf = '';
  let spaces = 0;
  const flush = () => {
    if (buf) parts.push(buf);
    buf = '';
  };
  for (const ch of text) {
    if (ch === ' ') {
      flush();
      spaces += 1;
    } else {
      if (spaces) parts.push(<span key={parts.length} className="ws">{'·'.repeat(spaces)}</span>);
      spaces = 0;
      buf += ch;
    }
  }
  flush();
  if (spaces) parts.push(<span key={parts.length} className="ws">{'·'.repeat(spaces)}</span>);
  return parts;
}

const Line = memo(function Line({ rec, index, top, layout, showSpaces, marks, lineState, issueLevel, issueFields }: LineProps) {
  const spec = specOf(layout, rec.type);
  const markMap = marks ? new Map(marks.split('|').map((m) => m.split('=') as [string, string])) : null;
  const errSet = issueFields ? new Set(issueFields.split('|')) : null;
  const badgeCls = spec.role === 'detail' ? 'detail' : spec.role === 'child' ? 'child' : spec.role === 'unknown' ? 'unknown' : '';
  return (
    <div className={`fv-line${lineState ? ` ${lineState}` : ''}`} style={{ top }} data-uid={rec.uid}>
      <span className="fv-gutter">
        <span className="ln">{index + 1}</span>
        <span className={`badge ${badgeCls}`} title={spec.label}>
          {spec.short}
        </span>
        <span className={`mark ${issueLevel}`} />
      </span>
      <span className="fv-code">
        {spec.fields.map((f, i) => {
          const m = markMap?.get(f.id);
          const cls = [
            'seg',
            i % 2 ? 'alt' : '',
            f.blank ? 'blank' : '',
            f.fixed !== undefined ? 'fixed' : '',
            f.auto ? 'auto' : '',
            errSet?.has(`e:${f.id}`) ? 'err' : errSet?.has(`w:${f.id}`) ? 'warn' : '',
            m === 'active' ? 'active' : m ? 'hover' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <span key={f.id} className={cls} data-f={f.id}>
              {renderText(getRaw(rec.raw, f), showSpaces)}
            </span>
          );
        })}
      </span>
    </div>
  );
});

function Ruler({ length, ch, gutter }: { length: number; ch: number; gutter: number }) {
  const ticks: React.ReactNode[] = [];
  for (let p = 1; p <= length; p++) {
    const major = p === 1 || p % 10 === 0;
    const x = (p - 0.5) * ch;
    if (major) ticks.push(<span key={`l${p}`} style={{ left: x }}>{p}</span>);
    if (p % 5 === 0 || p === 1) ticks.push(<i key={`t${p}`} className={major ? 'major' : ''} style={{ left: x }} />);
  }
  return (
    <div className="fv-ruler" style={{ width: gutter + 8 + length * ch + 24 }}>
      <span className="fv-gutter" style={{ width: gutter }} />
      <span className="fv-ticks" style={{ width: length * ch, marginLeft: 8 }}>
        {ticks}
      </span>
    </div>
  );
}

export function FileView({ showSpaces }: { showSpaces: boolean }) {
  const { doc, layout, issuesByUid, locate, getDoc } = useEditor();
  const linkState = useLinkVersion();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 600 });
  const [ch, setCh] = useState(7.5);
  const [gutter, setGutter] = useState(92);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; pos: string; read: string } | null>(null);

  // Mede a largura de um caractere monoespaçado.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;white-space:pre;font:inherit';
    probe.textContent = '0'.repeat(100);
    el.appendChild(probe);
    setCh(probe.getBoundingClientRect().width / 100);
    el.removeChild(probe);
    const g = el.querySelector('.fv-line .fv-gutter') as HTMLElement | null;
    if (g) setGutter(g.getBoundingClientRect().width);
  }, [doc.records.length > 0]);

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewport({ top: el.scrollTop, height: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const records = doc.records;
  const first = Math.max(0, Math.floor((viewport.top - RULER_H) / LINE_H) - OVERSCAN);
  const last = Math.min(records.length, Math.ceil((viewport.top + viewport.height) / LINE_H) + OVERSCAN);

  // Destaques por linha, serializados para permitir memo das linhas.
  const marksByUid = useMemo(() => {
    const map = new Map<string, Map<string, string>>();
    const put = (uid: string, field: string, v: string) => {
      let m = map.get(uid);
      if (!m) map.set(uid, (m = new Map()));
      if (m.get(field) !== 'active') m.set(field, v);
    };
    for (const r of linkState.hover) put(r.uid, r.field, 'hover');
    for (const r of linkState.active) put(r.uid, r.field, 'active');
    const out = new Map<string, string>();
    for (const [uid, m] of map) out.set(uid, [...m].map(([f, v]) => `${f}=${v}`).join('|'));
    return out;
  }, [linkState.hover, linkState.active]);

  const issueInfo = useMemo(() => {
    const out = new Map<string, { level: '' | 'error' | 'warning'; fields: string }>();
    for (const [uid, list] of issuesByUid) {
      const level = list.some((i) => i.level === 'error') ? 'error' : list.some((i) => i.level === 'warning') ? 'warning' : '';
      const fields = list
        .filter((i) => i.field && i.level !== 'info' && i.code !== 'required')
        .map((i) => `${i.level === 'error' ? 'e' : 'w'}:${i.field}`)
        .join('|');
      out.set(uid, { level, fields });
    }
    return out;
  }, [issuesByUid]);

  // Rola até o campo ativo quando a origem é o formulário ou o inspetor.
  useEffect(() => {
    if (linkState.source !== 'form' && linkState.source !== 'inspector') return;
    const ref = linkState.active[0];
    const el = scrollRef.current;
    if (!ref || !el) return;
    const idx = records.findIndex((r) => r.uid === ref.uid);
    if (idx < 0) return;
    const f = specOf(layout, records[idx]!.type).fields.find((x) => x.id === ref.field);
    const y = RULER_H + idx * LINE_H;
    let top = el.scrollTop;
    if (y < el.scrollTop + RULER_H || y + LINE_H > el.scrollTop + el.clientHeight) top = y - el.clientHeight / 2;
    let left = el.scrollLeft;
    if (f) {
      const x0 = gutter + 8 + (f.start - 1) * ch;
      const x1 = x0 + width(f) * ch;
      const visibleW = el.clientWidth;
      if (x0 < el.scrollLeft + gutter + 8 || x1 > el.scrollLeft + visibleW) left = Math.max(0, x0 - gutter - 8 - 48);
    }
    if (top !== el.scrollTop || left !== el.scrollLeft) el.scrollTo({ top, left, behavior: 'smooth' });
  }, [linkState.active, linkState.source, records, layout, ch, gutter]);

  const hit = useCallback(
    (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      const seg = el?.closest?.('[data-f]') as HTMLElement | null;
      const line = el?.closest?.('[data-uid]') as HTMLElement | null;
      if (!line) return null;
      return { uid: line.dataset.uid!, field: seg?.dataset.f ?? null, seg };
    },
    [],
  );

  const onMove = (e: React.MouseEvent) => {
    const h = hit(e.target);
    if (!h || !h.field) {
      if (link.get().hoverSource === 'file') link.setHover([], 'file');
      setTip(null);
      return;
    }
    const d = getDoc();
    const rec = d.records.find((r) => r.uid === h.uid);
    if (!rec) return;
    const f = specOf(layout, rec.type).fields.find((x) => x.id === h.field) as FieldSpec;
    link.setHover(expandRef(d, layout, { uid: h.uid, field: h.field }), 'file');
    const rect = h.seg!.getBoundingClientRect();
    setTip({
      x: Math.min(rect.left, window.innerWidth - 330),
      y: rect.bottom + 6,
      title: f.label,
      pos: f.start === f.end ? `${f.start}` : `${f.start}–${f.end}`,
      read: readable(f, getRaw(rec.raw, f)),
    });
  };

  const onClick = (e: React.MouseEvent) => {
    const h = hit(e.target);
    if (!h) return;
    scrollRef.current?.focus({ preventScroll: true });
    if (!h.field) {
      link.setActive([], 'file', h.uid);
      return;
    }
    const d = getDoc();
    link.setActive(expandRef(d, layout, { uid: h.uid, field: h.field }), 'file', h.uid);
    locate({ uid: h.uid, field: h.field });
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const cur = records.findIndex((r) => r.uid === link.get().selectedUid);
    const next = Math.max(0, Math.min(records.length - 1, (cur < 0 ? -1 : cur) + (e.key === 'ArrowDown' ? 1 : -1)));
    const rec = records[next]!;
    link.setActive([], 'file', rec.uid);
    const el = scrollRef.current!;
    const y = RULER_H + next * LINE_H;
    if (y < el.scrollTop + RULER_H) el.scrollTop = y - RULER_H;
    else if (y + LINE_H > el.scrollTop + el.clientHeight) el.scrollTop = y + LINE_H - el.clientHeight;
  };

  const totalW = gutter + 8 + layout.lineLength * ch + 24;

  return (
    <div
      className="fv"
      ref={scrollRef}
      tabIndex={0}
      onScroll={(e) => {
        const t = e.currentTarget;
        setViewport({ top: t.scrollTop, height: t.clientHeight });
        setTip(null);
      }}
      onMouseMove={onMove}
      onMouseLeave={() => {
        link.setHover([], 'file');
        setTip(null);
      }}
      onClick={onClick}
      onKeyDown={onKey}
      aria-label="Conteúdo do arquivo"
    >
      <Ruler length={layout.lineLength} ch={ch} gutter={gutter} />
      <div className="fv-body" style={{ height: records.length * LINE_H, width: totalW }}>
        {records.slice(first, last).map((rec, i) => {
          const index = first + i;
          const info = issueInfo.get(rec.uid);
          const marks = marksByUid.get(rec.uid) ?? '';
          const lineState = [
            linkState.selectedUid === rec.uid ? 'selected' : '',
            marks.includes('*=hover') ? 'line-hover' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <Line
              key={rec.uid}
              rec={rec}
              index={index}
              top={index * LINE_H}
              layout={layout}
              showSpaces={showSpaces}
              marks={marks}
              lineState={lineState}
              issueLevel={info?.level ?? ''}
              issueFields={info?.fields ?? ''}
            />
          );
        })}
      </div>
      {tip && (
        <div className="fv-tip" style={{ left: tip.x, top: tip.y }}>
          <span className="p">{tip.pos}</span>
          {tip.title}
          {tip.read && <span className="r">{tip.read}</span>}
        </div>
      )}
    </div>
  );
}
