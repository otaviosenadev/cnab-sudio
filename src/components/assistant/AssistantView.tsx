import { useEffect, useRef, useState } from 'react';
import type { LayoutId } from '../../cnab/types';
import { getLayout } from '../../cnab/layouts';
import { importText } from '../../io';
import { useShell } from '../../state/editor';
import { toast } from '../../state/ui';
import { useAssistant, type ChatItem, type Part } from '../../assistant/state';
import type { Delivery } from '../../assistant/api';
import { Icon } from '../Icon';
import { RichText } from './RichText';

const EXAMPLES = [
  'Segue o estoque do fundo para uma remessa de aquisição.',
  'Monte a remessa com os títulos deste print. O cedente é o mesmo de todos.',
  'Planilha de títulos para recompra pelo cedente.',
];

function formatSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function fileIcon(name: string) {
  if (/\.(png|jpe?g|gif|webp|heic)$/i.test(name)) return 'image' as const;
  if (/\.(xlsx?|xlsm|xlsb|ods|csv|tsv)$/i.test(name)) return 'table' as const;
  return 'file' as const;
}

// ------------------------------------------------------------------ mensagens

function RemessaCard({ delivery }: { delivery: Delivery }) {
  const { load } = useShell();
  const { setOpen } = useAssistant();
  let layoutName = delivery.layoutId;
  try {
    layoutName = getLayout(delivery.layoutId as LayoutId).name;
  } catch {
    /* layout desconhecido */
  }
  const openInEditor = () => {
    const res = importText(delivery.remessa, delivery.fileName, delivery.layoutId as LayoutId);
    if (!res.ok) {
      toast(res.message);
      return;
    }
    load({ ...res.doc, detection: { confidence: 'alta', reasons: ['Gerado pelo assistente a partir do estoque enviado.'] } });
    setOpen(false);
  };
  return (
    <div className="remessa-card">
      <div className="remessa-card-head">
        <span className="box-icon">
          <Icon name="file" />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="remessa-card-title">Remessa pronta</div>
          <div className="mono muted remessa-card-file">{delivery.fileName}</div>
        </div>
        <span className="pill">{layoutName}</span>
      </div>
      {delivery.resumo && <p className="remessa-card-resumo">{delivery.resumo}</p>}
      <div className="remessa-card-stats">
        <div className="stat">
          <span className="k">Títulos</span>
          <span className="v">{delivery.titulos}</span>
        </div>
        <div className="stat">
          <span className="k">Valor total</span>
          <span className="v">{delivery.valorTotal}</span>
        </div>
        <div className="stat">
          <span className="k">Pendências</span>
          <span className="v" style={{ color: delivery.erros ? 'var(--danger)' : delivery.alertas ? 'var(--attention)' : 'var(--success)' }}>
            {delivery.erros ? `${delivery.erros} erro${delivery.erros > 1 ? 's' : ''}` : delivery.alertas ? `${delivery.alertas} alerta${delivery.alertas > 1 ? 's' : ''}` : 'nenhuma'}
          </span>
        </div>
      </div>
      <div className="remessa-card-foot">
        <span className="muted" style={{ fontSize: 12 }}>
          Revise e finalize no editor antes de enviar.
        </span>
        <button type="button" className="btn btn-sm btn-primary" onClick={openInEditor}>
          Abrir no editor <Icon name="chevronRight" size={14} />
        </button>
      </div>
    </div>
  );
}

function PartView({ part }: { part: Part }) {
  switch (part.type) {
    case 'text':
      return <RichText text={part.text} />;
    case 'tool':
      return (
        <div className={`tool-row${part.done ? '' : ' running'}${part.ok === false ? ' failed' : ''}`}>
          {part.done ? <Icon name={part.ok === false ? 'alert' : 'check'} size={14} /> : <span className="spinner" />}
          <span className="tool-label">{part.label}</span>
          {part.status && <span className="tool-status">{part.status}</span>}
        </div>
      );
    case 'remessa':
      return <RemessaCard delivery={part.delivery} />;
    case 'error':
      return (
        <div className="chat-error">
          <Icon name="alert" size={14} /> {part.message}
        </div>
      );
  }
}

function Message({ item }: { item: ChatItem }) {
  if (item.kind === 'user') {
    return (
      <div className="msg user">
        <div className="bubble">
          {item.files.length > 0 && (
            <div className="bubble-files">
              {item.files.map((f, i) => (
                <span key={i} className="file-chip static">
                  <Icon name={fileIcon(f.name)} size={13} />
                  <span className="fname">{f.name}</span>
                  <span className="fsize">{formatSize(f.size)}</span>
                </span>
              ))}
            </div>
          )}
          {item.text && <div className="bubble-text">{item.text}</div>}
        </div>
      </div>
    );
  }
  const thinking = item.streaming && item.parts.length === 0;
  return (
    <div className="msg assistant">
      <span className="assistant-avatar">
        <Icon name="sparkle" size={14} />
      </span>
      <div className="assistant-body">
        {thinking && (
          <div className="tool-row running">
            <span className="spinner" />
            <span className="tool-label">Analisando o material</span>
          </div>
        )}
        {item.parts.map((p, i) => (
          <PartView key={i} part={p} />
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ estados especiais

function StatusNotice() {
  const { health, refreshHealth } = useAssistant();
  if (health.status === 'offline')
    return (
      <div className="notice attention">
        <Icon name="alert" />
        <div style={{ flex: 1 }}>
          <strong>Servidor do assistente indisponível.</strong>
          <div className="muted">Em desenvolvimento, rode <code>npm run dev</code> dentro de <code>server/</code>.</div>
        </div>
        <button type="button" className="btn btn-sm" onClick={refreshHealth}>
          Tentar de novo
        </button>
      </div>
    );
  if (health.status === 'ready' && !health.health.configured)
    return (
      <div className="notice attention">
        <Icon name="alert" />
        <div style={{ flex: 1 }}>
          <strong>Assistente sem credenciais.</strong>
          <div className="muted">
            Defina <code>ANTHROPIC_API_KEY</code> em <code>server/.env</code> e reinicie o servidor.
          </div>
        </div>
        <button type="button" className="btn btn-sm" onClick={refreshHealth}>
          Verificar
        </button>
      </div>
    );
  return null;
}

function AccessCodeCard() {
  const { setAccessCode } = useAssistant();
  const [code, setCode] = useState('');
  return (
    <form
      className="notice"
      onSubmit={(e) => {
        e.preventDefault();
        if (code.trim()) setAccessCode(code.trim());
      }}
    >
      <Icon name="info" />
      <div style={{ flex: 1 }}>
        <strong>Código de acesso</strong>
        <div className="muted" style={{ marginBottom: 8 }}>
          Este assistente usa uma API paga. Informe o código que você recebeu para usá-lo.
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" type="password" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Código" style={{ maxWidth: 240 }} autoFocus />
          <button type="submit" className="btn">
            Continuar
          </button>
        </div>
      </div>
    </form>
  );
}

function Intro({ onPick }: { onPick: (t: string) => void }) {
  return (
    <div className="assistant-intro">
      <span className="intro-mark">
        <Icon name="sparkle" size={22} />
      </span>
      <h1>Monte uma remessa a partir do estoque</h1>
      <p>
        Envie o estoque do fundo como estiver: planilha, print, PDF ou texto colado. O assistente organiza os títulos, confere o que
        falta, pergunta o necessário e entrega o arquivo pronto para revisar no editor.
      </p>
      <div className="intro-caps">
        <div>
          <Icon name="table" />
          <span>
            <strong>Planilhas</strong>
            <br />
            Excel, CSV, ODS
          </span>
        </div>
        <div>
          <Icon name="image" />
          <span>
            <strong>Imagens</strong>
            <br />
            Prints e fotos
          </span>
        </div>
        <div>
          <Icon name="file" />
          <span>
            <strong>Documentos</strong>
            <br />
            PDF e texto
          </span>
        </div>
      </div>
      <div className="intro-examples">
        {EXAMPLES.map((e) => (
          <button key={e} type="button" className="example" onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ view

export function AssistantView() {
  const { items, busy, send, stop, reset, setOpen, needsCode, health } = useAssistant();
  const { doc } = useShell();
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const stick = useRef(true);

  const available = health.status === 'ready' && health.health.configured && !needsCode;

  // Acompanha o fim da conversa enquanto o usuário não rolar para cima.
  useEffect(() => {
    const el = scrollRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text]);

  const addFiles = (list: FileList | File[]) => setFiles((prev) => [...prev, ...Array.from(list)].slice(0, 20));

  const submit = () => {
    if (busy || !available || (!text.trim() && !files.length)) return;
    stick.current = true;
    void send(text.trim(), files);
    setText('');
    setFiles([]);
  };

  return (
    <main
      className="assistant-view"
      onDragOver={(e) => {
        if (Array.from(e.dataTransfer.types).includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
    >
      <header className="assistant-head">
        <button type="button" className="btn btn-sm btn-ghost" onClick={() => setOpen(false)}>
          <Icon name="arrowLeft" size={14} /> {doc ? 'Voltar ao editor' : 'Início'}
        </button>
        <span className="topbar-sep" />
        <div className="assistant-title">
          <Icon name="sparkle" size={15} />
          <strong>Assistente de estoque</strong>
          <span className="muted hide-sm">· monta a remessa a partir dos títulos do fundo</span>
        </div>
        <span style={{ flex: 1 }} />
        {items.length > 0 && (
          <button type="button" className="btn btn-sm" onClick={reset} disabled={busy}>
            <Icon name="plus" size={14} /> Nova conversa
          </button>
        )}
      </header>

      <div
        className="assistant-scroll"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className="assistant-inner">
          <StatusNotice />
          {needsCode && <AccessCodeCard />}
          {items.length === 0 ? (
            <Intro
              onPick={(t) => {
                setText(t);
                inputRef.current?.focus();
              }}
            />
          ) : (
            items.map((item) => <Message key={item.id} item={item} />)
          )}
        </div>
      </div>

      <div className="composer-wrap">
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          {files.length > 0 && (
            <div className="composer-files">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className="file-chip">
                  <Icon name={fileIcon(f.name)} size={13} />
                  <span className="fname">{f.name}</span>
                  <span className="fsize">{formatSize(f.size)}</span>
                  <button type="button" aria-label={`Remover ${f.name}`} onClick={() => setFiles((l) => l.filter((_, j) => j !== i))}>
                    <Icon name="x" size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            placeholder={available ? 'Descreva o estoque ou cole os dados. Anexe planilhas, prints ou PDFs.' : 'Assistente indisponível'}
            disabled={!available}
            onChange={(e) => setText(e.target.value)}
            onPaste={(e) => {
              if (e.clipboardData.files.length) {
                e.preventDefault();
                addFiles(e.clipboardData.files);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="composer-actions">
            <button type="button" className="icon-btn" title="Anexar arquivos" onClick={() => fileRef.current?.click()} disabled={!available}>
              <Icon name="paperclip" />
            </button>
            <span className="muted composer-hint hide-sm">Enter envia · Shift+Enter quebra linha · cole prints com Ctrl+V</span>
            <span style={{ flex: 1 }} />
            {busy ? (
              <button type="button" className="send-btn" onClick={stop} title="Interromper">
                <Icon name="stop" size={14} />
              </button>
            ) : (
              <button type="submit" className="send-btn" disabled={!available || (!text.trim() && !files.length)} title="Enviar">
                <Icon name="arrowUp" size={15} />
              </button>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            accept=".xlsx,.xls,.xlsm,.xlsb,.ods,.csv,.tsv,.txt,.pdf,.png,.jpg,.jpeg,.webp,.gif,.json,.rem"
            onChange={(e) => {
              if (e.target.files) addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </form>
        <p className="composer-note">A IA pode errar. Tudo que ela gerar abre no editor para você revisar antes de baixar.</p>
      </div>

      {over && (
        <div className="assistant-drop">
          <Icon name="paperclip" size={22} />
          Solte para anexar
        </div>
      )}
    </main>
  );
}
