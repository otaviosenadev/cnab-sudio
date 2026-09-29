import { useEffect, useState } from 'react';
import type { LayoutId } from '../cnab/types';
import { LAYOUTS, getLayout } from '../cnab/layouts';
import { Icon } from './Icon';

export function NewFileDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (layoutId: LayoutId, ocorrencia: string) => void }) {
  const [layoutId, setLayoutId] = useState<LayoutId>('cnab444-fidc');
  const layout = getLayout(layoutId);
  const [preset, setPreset] = useState(layout.presets[0]!.id);

  useEffect(() => setPreset(getLayout(layoutId).presets[0]!.id), [layoutId]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const chosen = layout.presets.find((p) => p.id === preset) ?? layout.presets[0]!;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="new-title">
        <div className="modal-head">
          <div style={{ flex: 1 }}>
            <h2 id="new-title">Novo arquivo de remessa</h2>
            <p>Escolha o layout e o tipo de operação. Você poderá ajustar cada título depois.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Fechar">
            <Icon name="x" />
          </button>
        </div>
        <div className="modal-body">
          <p className="step-label">Layout</p>
          <div className="choice-grid">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                type="button"
                className={`choice${l.id === layoutId ? ' selected' : ''}`}
                onClick={() => setLayoutId(l.id)}
                aria-pressed={l.id === layoutId}
              >
                <span className="c-v">
                  {l.family} · {l.lineLength} posições
                </span>
                <span className="c-t">{l.variant}</span>
                <span className="c-d">{l.description}</span>
              </button>
            ))}
          </div>

          <p className="step-label" style={{ marginTop: 20 }}>
            Operação
          </p>
          <div className={`choice-grid${layout.presets.length === 4 ? ' two' : ''}`}>
            {layout.presets.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`choice${p.id === preset ? ' selected' : ''}`}
                onClick={() => setPreset(p.id)}
                aria-pressed={p.id === preset}
              >
                <span className="c-t">{p.label}</span>
                <span className="c-d">{p.description}</span>
                <span className="c-v">ocorrência {p.ocorrencia}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => onCreate(layoutId, chosen.ocorrencia)}>
            Criar arquivo
          </button>
        </div>
      </div>
    </div>
  );
}
