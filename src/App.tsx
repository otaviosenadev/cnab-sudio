import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LayoutId } from './cnab/types';
import { getLayout } from './cnab/layouts';
import { createDocument } from './cnab/document';
import { sampleDocument } from './cnab/samples';
import { EditorProvider, useEditor, useShell } from './state/editor';
import { toast, useTheme, useToast } from './state/ui';
import { downloadDoc, importText, readFileText } from './io';
import { ActionsContext, type FileActions } from './components/actions';
import { TopBar } from './components/TopBar';
import { Workspace } from './components/Workspace';
import { Welcome } from './components/Welcome';
import { NewFileDialog } from './components/NewFileDialog';
import { Icon } from './components/Icon';
import { Footer } from './components/Footer';

function Shortcuts() {
  const { undo, redo, doc } = useEditor();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      const inRawEditor = (e.target as HTMLElement)?.closest?.('.itable input');
      if (k === 'z' && !inRawEditor) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (k === 'y') {
        e.preventDefault();
        redo();
      } else if (k === 's') {
        e.preventDefault();
        downloadDoc(doc);
        toast('Arquivo baixado');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, doc]);
  return null;
}

function Toaster() {
  const t = useToast();
  if (!t) return null;
  return (
    <div className="toast" key={t.id} role="status">
      <Icon name="check" size={14} /> {t.text}
    </div>
  );
}

function Shell() {
  useTheme();
  const { doc, load } = useShell();
  const inputRef = useRef<HTMLInputElement>(null);
  const [showNew, setShowNew] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const text = await readFileText(file);
        const res = importText(text, file.name);
        if (!res.ok) {
          alert(res.message);
          return;
        }
        load(res.doc);
        toast(`${getLayout(res.doc.layoutId).name} identificado`);
      } catch (err) {
        alert(`Não foi possível ler o arquivo: ${(err as Error).message}`);
      }
    },
    [load],
  );

  const actions = useMemo<FileActions>(
    () => ({
      openPicker: () => inputRef.current?.click(),
      importFile,
      showNewDialog: () => setShowNew(true),
      createNew: (layoutId: LayoutId, ocorrencia: string) => {
        load(createDocument(getLayout(layoutId), ocorrencia));
        setShowNew(false);
      },
      openSample: (layoutId: LayoutId) => load(sampleDocument(getLayout(layoutId))),
      switchLayout: (layoutId: LayoutId) => {
        if (!doc?.sourceText) return;
        const res = importText(doc.sourceText, doc.fileName, layoutId);
        if (res.ok) load(res.doc);
      },
    }),
    [importFile, load, doc],
  );

  // Ctrl+O e arrastar-e-soltar em qualquer lugar.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        inputRef.current?.click();
      }
    };
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');
    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current += 1;
      setDragging(true);
    };
    const onLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const onOver = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const f = e.dataTransfer?.files[0];
      if (f) void importFile(f);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [importFile]);

  return (
    <ActionsContext.Provider value={actions}>
      <div className="app">
        {doc ? (
          <>
            <TopBar />
            <Workspace />
            <Shortcuts />
          </>
        ) : (
          <Welcome />
        )}
        <Footer />
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".rem,.REM,.txt,.TXT,.ret,.RET"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importFile(f);
          e.target.value = '';
        }}
      />
      {showNew && <NewFileDialog onClose={() => setShowNew(false)} onCreate={actions.createNew} />}
      {dragging && (
        <div className="drop-overlay">
          <div className="inner">
            <Icon name="upload" size={28} />
            Solte para importar o arquivo
          </div>
        </div>
      )}
      <Toaster />
    </ActionsContext.Provider>
  );
}

export default function App() {
  return (
    <EditorProvider>
      <Shell />
    </EditorProvider>
  );
}
