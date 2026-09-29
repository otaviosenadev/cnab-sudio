import type { LayoutSpec, RecordInstance } from '../types';
import { writeAuto } from '../dsl';
import { fieldOf } from '../records';

/** Layouts de 444 posições: sequencial do registro (439–444) de 1 em 1. */
export function finalizeSequential444(records: RecordInstance[], layout: LayoutSpec) {
  records.forEach((rec, i) => writeAuto(rec, fieldOf(layout, rec, 'seq'), i + 1));
}
