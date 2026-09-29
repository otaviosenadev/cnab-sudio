import { useRef, useState } from 'react';
import { serialize } from '../cnab/document';
import { useEditor } from '../state/editor';
import { toast, usePersistentNumber } from '../state/ui';
import { EditorPanel } from './EditorPanel';
import { FileView } from './FileView';
import { Inspector } from './Inspector';
import { Icon } from './Icon';

function useDrag(onMove: (e: PointerEvent) => void) {
  const [dragging, setDragging] = useState(false);
  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev: PointerEvent) => onMove(ev);
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return { dragging, start };
}

function PreviewPanel() {
  const { doc, titulos, issues } = useEditor();
  const [showSpaces, setShowSpaces] = useState(false);
  const [inspectorH, setInspectorH] = usePersistentNumber('cnab-studio:inspector-h', 300);
  const panelRef = useRef<HTMLDivElement>(null);
  const drag = useDrag((e) => {
    const rect = panelRef.current!.getBoundingClientRect();
    const h = Math.round(rect.bottom - e.clientY);
    setInspectorH(Math.max(120, Math.min(rect.height - 160, h)));
  });
  const withIssues = new Set(issues.filter((i) => i.uid && i.level !== 'info').map((i) => i.uid)).size;

  return (
    <div className="pane-right" ref={panelRef}>
      <div className="preview-head">
        <h2>Arquivo</h2>
        <span className="meta">
          {doc.records.length} linha{doc.records.length !== 1 ? 's' : ''} · {titulos.length} título{titulos.length !== 1 ? 's' : ''}
        </span>
        {withIssues > 0 && <span className="pill danger">{withIssues} com apontamento</span>}
        <span style={{ flex: 1 }} />
        <span className="muted hide-sm" style={{ fontSize: 12, marginRight: 4 }}>
          Clique num trecho para editar · <span className="kbd">↑</span> <span className="kbd">↓</span> navegam
        </span>
        <button
          type="button"
          className={`icon-btn sm${showSpaces ? ' on' : ''}`}
          title={showSpaces ? 'Ocultar espaços' : 'Mostrar espaços'}
          aria-pressed={showSpaces}
          onClick={() => setShowSpaces(!showSpaces)}
          style={showSpaces ? { color: 'var(--accent)', background: 'var(--accent-subtle)' } : undefined}
        >
          <Icon name="eye" size={15} />
        </button>
        <button
          type="button"
          className="icon-btn sm"
          title="Copiar conteúdo"
          onClick={() => {
            navigator.clipboard
              .writeText(serialize(doc))
              .then(() => toast('Conteúdo copiado'))
              .catch(() => toast('Não foi possível copiar'));
          }}
        >
          <Icon name="copy" size={15} />
        </button>
      </div>
      <FileView showSpaces={showSpaces} />
      <div className={`hsplitter${drag.dragging ? ' dragging' : ''}`} onPointerDown={drag.start} role="separator" aria-orientation="horizontal" />
      <div style={{ height: inspectorH, flex: 'none', minHeight: 0 }}>
        <Inspector />
      </div>
    </div>
  );
}

export function Workspace() {
  const [leftPct, setLeftPct] = usePersistentNumber('cnab-studio:left-pct', 46);
  const [tab, setTab] = useState<'editor' | 'file'>('editor');
  const ref = useRef<HTMLDivElement>(null);
  const drag = useDrag((e) => {
    const rect = ref.current!.getBoundingClientRect();
    const pct = ((e.clientX - rect.left) / rect.width) * 100;
    setLeftPct(Math.max(28, Math.min(70, Math.round(pct * 10) / 10)));
  });

  return (
    <>
      <div className="mobile-tabs">
        <button type="button" className={`btn btn-sm${tab === 'editor' ? '' : ' btn-ghost'}`} onClick={() => setTab('editor')}>
          Editor
        </button>
        <button type="button" className={`btn btn-sm${tab === 'file' ? '' : ' btn-ghost'}`} onClick={() => setTab('file')}>
          Arquivo
        </button>
      </div>
      <div className="workspace" ref={ref} data-tab={tab}>
        <div className="pane-left" style={{ width: `${leftPct}%` }}>
          <EditorPanel />
        </div>
        <div className={`splitter${drag.dragging ? ' dragging' : ''}`} onPointerDown={drag.start} role="separator" aria-orientation="vertical" />
        <PreviewPanel />
      </div>
    </>
  );
}
