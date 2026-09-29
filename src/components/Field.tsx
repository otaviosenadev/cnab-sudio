import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import type { FieldRef, FieldSpec, Issue } from '../cnab/types';
import { encode, isEmptyRaw, toLogical, width } from '../cnab/codec';
import {
  cnabDateToIso,
  formatCents,
  formatDecimal,
  formatDoc,
  isoToCnabDate,
  maskDocInput,
  onlyDigits,
  parseDecimal,
} from '../cnab/format';
import { link, useFieldLink } from '../state/link';

export interface FieldProps {
  spec: FieldSpec;
  raw: string;
  domId: string;
  linkKey: string;
  getRefs: () => FieldRef[];
  issues?: Issue[];
  onChange: (logical: string) => void;
  label?: string;
  note?: ReactNode;
  disabled?: boolean;
}

function spanOf(f: FieldSpec): number {
  if (f.span) return f.span;
  const w = width(f);
  if (f.input === 'enum') return w > 1 || (f.options?.some((o) => o.label.length > 22) ?? false) ? 2 : 1;
  if (f.input === 'doc' || f.input === 'doc15') return 1;
  if (f.kind === 'alfa' && w >= 40) return 2;
  return 1;
}

function FieldImpl({ spec, raw, domId, linkKey, getRefs, issues, onChange, label, note, disabled }: FieldProps) {
  const hl = useFieldLink(linkKey);
  const real = issues?.filter((i) => i.code !== 'required');
  const worst = real?.find((i) => i.level === 'error') ?? real?.find((i) => i.level === 'warning');
  const missing = !worst && issues?.some((i) => i.code === 'required');
  const cls = [
    'field',
    `span-${spanOf(spec)}`,
    hl ? `hl-${hl}` : '',
    worst?.level === 'error' ? 'has-error' : worst?.level === 'warning' ? 'has-warning' : '',
    missing ? 'is-missing' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={cls}
      id={domId}
      onMouseEnter={() => link.setHover(getRefs(), 'form')}
      onMouseLeave={() => link.setHover([], 'form')}
      onFocus={() => link.setActive(getRefs(), 'form')}
    >
      <label className="field-label" htmlFor={`${domId}-in`}>
        <span className="lbl" title={label ?? spec.label}>
          {label ?? spec.label}
        </span>
        {spec.required && <span className="req">*</span>}
        <span className="pos">{spec.start === spec.end ? spec.start : `${spec.start}–${spec.end}`}</span>
      </label>
      <Control spec={spec} raw={raw} id={`${domId}-in`} onChange={onChange} disabled={disabled} />
      {worst ? (
        <div className={`field-msg ${worst.level}`}>{worst.message}</div>
      ) : note ? (
        <div className="field-msg">{note}</div>
      ) : spec.hint ? (
        <div className="field-msg hint">{spec.hint}</div>
      ) : null}
    </div>
  );
}

// Handlers leem o estado mais recente via getDoc(); por isso podem ser ignorados na comparação.
export const Field = memo(
  FieldImpl,
  (a, b) =>
    a.raw === b.raw &&
    a.spec === b.spec &&
    a.issues === b.issues &&
    a.domId === b.domId &&
    a.linkKey === b.linkKey &&
    a.label === b.label &&
    a.note === b.note &&
    a.disabled === b.disabled,
);

// ------------------------------------------------------------------ controles

interface ControlProps {
  spec: FieldSpec;
  raw: string;
  id: string;
  onChange: (logical: string) => void;
  disabled?: boolean;
}

/** Mantém o texto digitado enquanto o campo está em foco; sincroniza com o arquivo ao sair. */
function useDraft(display: string, raw: string) {
  const [draft, setDraft] = useState<string | null>(null);
  const committed = useRef(raw);
  useEffect(() => {
    if (raw !== committed.current) {
      committed.current = raw;
      setDraft(null);
    }
  }, [raw]);
  return {
    value: draft ?? display,
    onFocus: () => setDraft(display),
    onBlur: () => setDraft(null),
    set: (v: string, nextRaw: string) => {
      committed.current = nextRaw;
      setDraft(v);
    },
  };
}

function Control({ spec, raw, id, onChange, disabled }: ControlProps) {
  const w = width(spec);
  switch (spec.input) {
    case 'money':
      return <MoneyInput spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
    case 'date6':
    case 'date8': {
      const iso = cnabDateToIso(raw) ?? '';
      return (
        <input
          id={id}
          type="date"
          className="input"
          value={iso}
          disabled={disabled}
          min={spec.input === 'date6' ? '1970-01-01' : undefined}
          max={spec.input === 'date6' ? '2069-12-31' : '9999-12-31'}
          onChange={(e) => onChange(isoToCnabDate(e.target.value, w === 6 ? 6 : 8))}
        />
      );
    }
    case 'time6': {
      const v = isEmptyRaw(spec, raw) ? '' : `${raw.slice(0, 2)}:${raw.slice(2, 4)}:${raw.slice(4, 6)}`;
      return (
        <input
          id={id}
          type="time"
          step={1}
          className="input"
          value={v}
          disabled={disabled}
          onChange={(e) => onChange(onlyDigits(e.target.value).padEnd(6, '0'))}
        />
      );
    }
    case 'enum':
      return <EnumSelect spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
    case 'doc':
    case 'doc15':
      return <DocInput spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
    case 'cep':
      return <CepInput spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
    case 'decimal':
      return <DecimalInput spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
    default:
      return <TextInput spec={spec} raw={raw} id={id} onChange={onChange} disabled={disabled} />;
  }
}

function TextInput({ spec, raw, id, onChange, disabled }: ControlProps) {
  const isNum = spec.kind === 'num';
  // Códigos curtos (carteira, agência…) mantêm os zeros; números longos são exibidos sem eles.
  const display = isNum && spec.input === 'text' && width(spec) <= 8 && !isEmptyRaw(spec, raw) ? raw.trim() : toLogical(spec, raw);
  const d = useDraft(display, raw);
  const w = width(spec);
  return (
    <input
      id={id}
      className={`input${isNum ? ' mono tnum' : ''}`}
      style={!isNum && !spec.keepCase ? { textTransform: 'uppercase' } : undefined}
      value={d.value}
      maxLength={w}
      disabled={disabled}
      inputMode={isNum ? 'numeric' : undefined}
      spellCheck={false}
      autoComplete="off"
      placeholder={isNum ? '0'.repeat(Math.min(w, 6)) : undefined}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onChange={(e) => {
        const v = isNum ? onlyDigits(e.target.value) : e.target.value;
        d.set(v, encode(spec, v));
        onChange(v);
      }}
    />
  );
}

function MoneyInput({ spec, raw, id, onChange, disabled }: ControlProps) {
  const digits = onlyDigits(raw);
  const display = /^0*$/.test(digits) ? '' : formatCents(digits, spec.decimals ?? 2);
  const w = width(spec);
  return (
    <div className="input-affix">
      <span className="affix">R$</span>
      <input
        id={id}
        className="input right tnum"
        value={display}
        placeholder="0,00"
        inputMode="numeric"
        disabled={disabled}
        autoComplete="off"
        onChange={(e) => {
          const next = onlyDigits(e.target.value).replace(/^0+/, '');
          if (next.length > w) return;
          onChange(next);
        }}
      />
    </div>
  );
}

function DecimalInput({ spec, raw, id, onChange, disabled }: ControlProps) {
  const dec = spec.decimals ?? 2;
  const display = formatDecimal(raw, dec);
  const d = useDraft(display, raw);
  return (
    <input
      id={id}
      className="input right tnum"
      value={d.value}
      placeholder="0"
      inputMode="decimal"
      disabled={disabled}
      autoComplete="off"
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onChange={(e) => {
        const v = e.target.value.replace(/[^\d,]/g, '');
        const scaled = parseDecimal(v, dec);
        if (scaled.length > width(spec)) return;
        d.set(v, encode(spec, scaled));
        onChange(scaled);
      }}
    />
  );
}

function DocInput({ spec, raw, id, onChange, disabled }: ControlProps) {
  const display = formatDoc(toLogical(spec, raw));
  const d = useDraft(display, raw);
  return (
    <input
      id={id}
      className="input mono tnum"
      value={d.value}
      placeholder="CPF ou CNPJ"
      inputMode="numeric"
      disabled={disabled}
      autoComplete="off"
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onChange={(e) => {
        const masked = maskDocInput(e.target.value);
        const digits = onlyDigits(masked);
        d.set(masked, encode(spec, digits));
        onChange(digits);
      }}
    />
  );
}

function CepInput({ spec, raw, id, onChange, disabled }: ControlProps) {
  const digits = onlyDigits(raw);
  const display = /^0*$/.test(digits) ? '' : `${digits.slice(0, 5)}-${digits.slice(5)}`;
  const d = useDraft(display, raw);
  return (
    <input
      id={id}
      className="input mono tnum"
      value={d.value}
      placeholder="00000-000"
      inputMode="numeric"
      disabled={disabled}
      autoComplete="off"
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onChange={(e) => {
        const dg = onlyDigits(e.target.value).slice(0, 8);
        const masked = dg.length > 5 ? `${dg.slice(0, 5)}-${dg.slice(5)}` : dg;
        d.set(masked, encode(spec, dg));
        onChange(dg);
      }}
    />
  );
}

function EnumSelect({ spec, raw, id, onChange, disabled }: ControlProps) {
  const value = raw.trim();
  const options = spec.options ?? [];
  const known = options.some((o) => o.value === value);
  const empty = isEmptyRaw(spec, raw) && !known;
  return (
    <select id={id} className="input" value={empty ? '' : value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {empty && <option value="">Selecione…</option>}
      {!known && !empty && <option value={value}>{value} — não documentado</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value} — {o.label}
        </option>
      ))}
    </select>
  );
}
