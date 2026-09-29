import { useState } from 'react';
import type { Issue } from '../cnab/types';
import { LAYOUTS } from '../cnab/layouts';
import { specOf } from '../cnab/records';
import { useEditor } from '../state/editor';
import { link } from '../state/link';
import { useClickOutside, useTheme, toast } from '../state/ui';
import { downloadDoc } from '../io';
import { useActions } from './actions';
import { Icon } from './Icon';

const KIND_TONE: Record<string, string> = {
  aquisicao: 'accent',
  entrada: 'accent',
  liquidacao: 'success',
  baixa: 'attention',
  recompra: 'done',
  instrucao: '',
  misto: 'attention',
  vazio: '',
};

function useToggle() {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(open, () => setOpen(false));
  return { open, setOpen, ref };
}

export function TopBar() {
  const { doc, layout, classification, issues, canUndo, canRedo, undo, redo, edit, close, locate, titulos } = useEditor();
  const actions = useActions();
  const [theme, cycleTheme] = useTheme();
  const layoutMenu = useToggle();
  const opMenu = useToggle();
  const issuesMenu = useToggle();
  const newMenu = useToggle();

  const errors = issues.filter((i) => i.level === 'error').length;
  const warnings = issues.filter((i) => i.level === 'warning').length;

  const goTo = (i: Issue) => {
    issuesMenu.setOpen(false);
    if (!i.uid) return;
    const field = i.field ?? specOf(layout, doc.records.find((r) => r.uid === i.uid)?.type ?? '').fields[0]?.id ?? '';
    link.setActive([{ uid: i.uid, field }], 'inspector', i.uid);
    locate({ uid: i.uid, field });
  };

  const where = (i: Issue) => {
    if (!i.uid) return 'Arquivo';
    const idx = doc.records.findIndex((r) => r.uid === i.uid);
    const rec = doc.records[idx];
    if (!rec) return '';
    const spec = specOf(layout, rec.type);
    const f = spec.fields.find((x) => x.id === i.field);
    const t = titulos.find((x) => x.primary.uid === rec.uid || x.children.some((c) => c.uid === rec.uid));
    return [`Linha ${idx + 1}`, t ? `título ${t.index + 1}` : spec.label.toLowerCase(), f?.label].filter(Boolean).join(' · ');
  };

  return (
    <header className="topbar">
      <button
        type="button"
        className="brand"
        title="Voltar ao início"
        onClick={() => {
          if (confirm('Fechar este arquivo? As alterações não baixadas ficam apenas no rascunho deste navegador.')) close();
        }}
      >
        <span className="brand-mark">
          <Icon name="code" size={16} />
        </span>
        <span className="brand-name">CNAB Studio</span>
      </button>
      <span className="topbar-sep" />
      <div className="filename">
        <input
          value={doc.fileName}
          aria-label="Nome do arquivo"
          spellCheck={false}
          onChange={(e) => {
            const v = e.target.value;
            edit('rename', (d) => ({ ...d, fileName: v }));
          }}
        />
      </div>

      <div className="popover-anchor hide-sm" ref={layoutMenu.ref}>
        <button type="button" className="pill" style={{ cursor: 'pointer' }} onClick={() => layoutMenu.setOpen(!layoutMenu.open)}>
          {layout.name}
          <Icon name="chevronDown" size={12} />
        </button>
        {layoutMenu.open && (
          <div className="popover left" style={{ width: 320 }}>
            <div className="menu-label">Layout do arquivo</div>
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`menu-item${l.id === layout.id ? ' checked' : ''}`}
                disabled={!doc.sourceText && l.id !== layout.id}
                style={!doc.sourceText && l.id !== layout.id ? { opacity: 0.5, cursor: 'default' } : undefined}
                onClick={() => {
                  layoutMenu.setOpen(false);
                  if (l.id !== layout.id && doc.sourceText) actions.switchLayout(l.id);
                }}
              >
                <Icon name="layers" />
                <span>
                  <span className="mi-title">{l.name}</span>
                  <span className="mi-desc" style={{ display: 'block' }}>
                    {l.variant} · {l.lineLength} posições
                  </span>
                </span>
              </button>
            ))}
            <div className="menu-sep" />
            <div className="mi-desc muted" style={{ padding: '4px 10px 6px', fontSize: 12 }}>
              {doc.sourceText ? 'Reinterpreta o arquivo importado com outro layout.' : 'Disponível para arquivos importados.'}
            </div>
          </div>
        )}
      </div>

      <div className="popover-anchor hide-sm" ref={opMenu.ref}>
        <button
          type="button"
          className={`pill ${KIND_TONE[classification.kind] ?? ''}`}
          style={{ cursor: 'pointer' }}
          onClick={() => opMenu.setOpen(!opMenu.open)}
          title="Tipo de operação identificado pelas ocorrências"
        >
          <span className="dot" />
          {classification.label}
        </button>
        {opMenu.open && (
          <div className="popover left" style={{ width: 340 }}>
            <div className="menu-label">Ocorrências no arquivo</div>
            {classification.breakdown.length === 0 && <div className="empty">Nenhum título.</div>}
            {classification.breakdown.map((b) => (
              <div key={b.code} className="menu-item" style={{ cursor: 'default' }}>
                <span className="kbd">{b.code}</span>
                <span style={{ flex: 1 }}>{b.label}</span>
                <span className="counter">{b.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="topbar-spacer" />

      <div className="topbar-actions">
        <div className="popover-anchor" ref={issuesMenu.ref}>
          <button
            type="button"
            className={`btn btn-sm ${errors ? '' : 'btn-ghost'}`}
            onClick={() => issuesMenu.setOpen(!issuesMenu.open)}
            title="Apontamentos de validação"
          >
            {errors || warnings ? (
              <>
                <Icon name="alert" size={14} style={{ color: errors ? 'var(--danger)' : 'var(--attention)' }} />
                <span className="tnum">{errors + warnings}</span>
                <span className="hide-sm">apontamento{errors + warnings > 1 ? 's' : ''}</span>
              </>
            ) : (
              <>
                <Icon name="checkCircle" size={14} style={{ color: 'var(--success)' }} />
                <span className="hide-sm">Sem apontamentos</span>
              </>
            )}
          </button>
          {issuesMenu.open && (
            <div className="popover right issues-pop">
              <div className="menu-label">
                {errors} erro(s) · {warnings} alerta(s) · {issues.length - errors - warnings} aviso(s)
              </div>
              {issues.length === 0 && <div className="empty">Tudo certo com o arquivo.</div>}
              {[...issues]
                .sort((a, b) => rank(a) - rank(b))
                .slice(0, 200)
                .map((i, n) => (
                  <button key={n} type="button" className="issue-item" onClick={() => goTo(i)}>
                    <span className={`issue-dot ${i.level}`} />
                    <span>
                      <span style={{ display: 'block' }}>{i.message}</span>
                      <span className="where">{where(i)}</span>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </div>

        <span className="topbar-sep hide-sm" />
        <button type="button" className="icon-btn" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)">
          <Icon name="undo" />
        </button>
        <button type="button" className="icon-btn" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Shift+Z)">
          <Icon name="redo" />
        </button>
        <button type="button" className="icon-btn" onClick={cycleTheme} title={`Tema: ${theme === 'system' ? 'sistema' : theme === 'light' ? 'claro' : 'escuro'}`}>
          <Icon name={theme === 'system' ? 'monitor' : theme === 'light' ? 'sun' : 'moon'} />
        </button>
        <span className="topbar-sep hide-sm" />

        <button type="button" className="btn btn-sm" onClick={actions.openEstoque} title="Gerar baixa a partir do estoque do fundo">
          <Icon name="table" size={14} />
          <span className="hide-sm">Estoque</span>
        </button>
        <div className="popover-anchor" ref={newMenu.ref}>
          <button type="button" className="btn btn-sm" onClick={() => newMenu.setOpen(!newMenu.open)}>
            <Icon name="plus" size={14} />
            <span className="hide-sm">Arquivo</span>
            <Icon name="chevronDown" size={12} />
          </button>
          {newMenu.open && (
            <div className="popover right" style={{ width: 260 }}>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  newMenu.setOpen(false);
                  actions.openPicker();
                }}
              >
                <Icon name="upload" />
                <span>
                  <span className="mi-title">Importar .rem</span>
                  <span className="mi-desc" style={{ display: 'block' }}>
                    Ctrl+O
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="menu-item"
                onClick={() => {
                  newMenu.setOpen(false);
                  actions.showNewDialog();
                }}
              >
                <Icon name="fileNew" />
                <span>
                  <span className="mi-title">Novo arquivo</span>
                  <span className="mi-desc" style={{ display: 'block' }}>
                    Criar do zero
                  </span>
                </span>
              </button>
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-sm btn-primary"
          onClick={() => {
            downloadDoc(doc);
            toast(errors ? `Baixado com ${errors} erro(s) de validação` : 'Arquivo baixado');
          }}
          title="Baixar arquivo (Ctrl+S)"
        >
          <Icon name="download" size={14} /> Baixar .rem
        </button>
      </div>
    </header>
  );
}

function rank(i: Issue) {
  return i.level === 'error' ? 0 : i.level === 'warning' ? 1 : 2;
}
