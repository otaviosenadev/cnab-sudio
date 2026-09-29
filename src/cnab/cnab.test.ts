import { describe, expect, it } from 'vitest';
import { LAYOUTS } from './layouts';
import { detectLayout } from './detect';
import { finalizeDoc, parseText, serialize, validate, classify } from './document';
import { sampleDocument } from './samples';
import { groupTitulos } from './records';
import { formatCents, isValidCnpj, isValidCpf, nossoNumeroDv, withCheckDigits } from './format';
import { encode, toLogical } from './codec';

describe('layouts', () => {
  for (const layout of LAYOUTS) {
    for (const rec of layout.records) {
      it(`${layout.id} · ${rec.id} cobre 1..${layout.lineLength} sem lacunas`, () => {
        let pos = 1;
        for (const f of rec.fields) {
          expect(f.start, `${f.id} começa em ${f.start}, esperado ${pos}`).toBe(pos);
          expect(f.end).toBeGreaterThanOrEqual(f.start);
          pos = f.end + 1;
        }
        expect(pos - 1).toBe(layout.lineLength);
        const ids = rec.fields.map((f) => f.id);
        expect(new Set(ids).size).toBe(ids.length);
      });
    }
  }
});

describe('documentos de exemplo', () => {
  for (const layout of LAYOUTS) {
    it(`${layout.id}: gera, detecta e faz round-trip sem perdas`, () => {
      const doc = sampleDocument(layout);
      for (const r of doc.records) expect(r.raw.length).toBe(layout.lineLength);
      const text = serialize(doc);
      const det = detectLayout(text);
      expect(det.layoutId).toBe(layout.id);
      const parsed = parseText(text, layout);
      expect(serialize(parsed)).toBe(text);
      expect(serialize(finalizeDoc(parsed, layout))).toBe(text);
      const errors = validate(parsed, layout).filter((i) => i.level === 'error');
      expect(errors, JSON.stringify(errors, null, 1)).toEqual([]);
      const titulos = groupTitulos(layout, parsed.records);
      expect(titulos.length).toBe(4);
      expect(classify(layout, titulos).kind).not.toBe('vazio');
    });
  }
});

describe('formatação', () => {
  it('dígito do nosso número (exemplos da documentação)', () => {
    expect(nossoNumeroDv('01', '00000000002')).toBe('0');
    expect(nossoNumeroDv('01', '00000000001')).toBe('2');
  });
  it('CPF/CNPJ', () => {
    expect(isValidCpf(withCheckDigits('529982247'))).toBe(true);
    expect(isValidCnpj('11222333000181')).toBe(true);
    expect(isValidCnpj('11222333000182')).toBe(false);
  });
  it('valores', () => {
    expect(formatCents('000000000247056')).toBe('2.470,56');
  });
  it('CPF com brancos à esquerda', () => {
    const f = { id: 'x', label: 'x', start: 1, end: 14, kind: 'num' as const, input: 'doc' as const, cpfSpaces: true };
    const cpf = withCheckDigits('529982247');
    expect(encode(f, cpf)).toBe(`   ${cpf}`);
    expect(toLogical(f, `   ${cpf}`)).toBe(cpf);
  });
});
