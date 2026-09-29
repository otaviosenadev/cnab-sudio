import { useState } from 'react';
import { LAYOUTS, getLayout } from '../cnab/layouts';
import { groupTitulos } from '../cnab/records';
import { clearDraft, loadDraft, useShell } from '../state/editor';
import { useActions } from './actions';
import { Icon } from './Icon';

export function Welcome() {
  const actions = useActions();
  const { load } = useShell();
  const [over, setOver] = useState(false);
  const [draft, setDraft] = useState(loadDraft);

  return (
    <main className="welcome">
      <div className="welcome-inner">
        <div className="hero">
          <span className="brand-mark">
            <Icon name="code" size={22} />
          </span>
          <h1>Editor de remessas CNAB</h1>
          <p>Importe um arquivo .rem para identificar o layout e a operação, ou crie um do zero. Cada campo do formulário mostra exatamente onde vai parar no arquivo.</p>
        </div>

        <div className="tiles">
          <button
            type="button"
            className={`tile drop${over ? ' over' : ''}`}
            onClick={actions.openPicker}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(true);
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setOver(false);
              const f = e.dataTransfer.files[0];
              if (f) actions.importFile(f);
            }}
          >
            <span className="tile-icon">
              <Icon name="upload" size={20} />
            </span>
            <h3>Importar arquivo</h3>
            <p>Arraste um arquivo .rem ou .txt aqui, ou clique para escolher.</p>
          </button>
          <button type="button" className="tile" onClick={actions.showNewDialog}>
            <span className="tile-icon">
              <Icon name="fileNew" size={20} />
            </span>
            <h3>Criar do zero</h3>
            <p>Escolha o layout e o tipo de operação — aquisição, baixa, recompra ou instruções.</p>
          </button>
          <button type="button" className="tile tile-accent" onClick={actions.openEstoque}>
            <span className="tile-icon">
              <Icon name="table" size={20} />
            </span>
            <h3>
              Baixa pelo estoque <span className="pill accent">novo</span>
            </h3>
            <p>Suba ou cole a planilha de estoque do fundo, selecione os títulos e gere o CNAB de baixa.</p>
          </button>
        </div>

        {draft && (
          <div className="draft">
            <Icon name="file" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 500 }} className="mono">
                {draft.fileName || 'remessa.rem'}
              </div>
              <div className="muted" style={{ fontSize: 12 }}>
                Rascunho salvo · {getLayout(draft.layoutId).name} · {groupTitulos(getLayout(draft.layoutId), draft.records).length} título(s)
              </div>
            </div>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => {
                clearDraft();
                setDraft(null);
              }}
            >
              Descartar
            </button>
            <button type="button" className="btn btn-sm" onClick={() => load(draft)}>
              Continuar editando
            </button>
          </div>
        )}

        <section className="welcome-section">
          <h4>Layouts suportados</h4>
          <div className="layout-cards">
            {LAYOUTS.map((l) => (
              <div key={l.id} className="layout-card">
                <div className="lc-top">
                  <h5>{l.variant}</h5>
                  <span className="pill">{l.family}</span>
                </div>
                <p>{l.description}</p>
                <div>
                  <button type="button" className="link-btn" onClick={() => actions.openSample(l.id)}>
                    Abrir exemplo <Icon name="chevronRight" size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
