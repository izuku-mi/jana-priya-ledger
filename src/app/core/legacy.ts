import { DailySheet, ExpenseType, SheetRow, Sku } from './model';
import { emptySheet, rowFromSku } from './ledger';
import { uid } from './format';

/** Backup file written by the first (vanilla JS) version of the app. */
export interface LegacyBackup {
  skus: { id: string; cat: 'LIQUOR' | 'BEER'; sno: number; name_en: string; name_te?: string; size: string; costPrice?: number; rate?: number }[];
  ledgers: Record<string, {
    entries?: Record<string, { id: string; cat: 'LIQUOR' | 'BEER'; sno?: number; size: string; name_en: string; name_te?: string; o?: number; r?: number; i?: number; c?: number; rate?: number; cost?: number }>;
    exp?: { l?: string; a?: number }[];
    phonePe?: number;
    other?: number;
    cash?: number | null;
    by?: string;
    remarks?: string;
  }>;
}

export const isLegacyBackup = (o: unknown): o is LegacyBackup =>
  !!o && typeof o === 'object' && Array.isArray((o as LegacyBackup).skus) && !!(o as LegacyBackup).ledgers && typeof (o as LegacyBackup).ledgers === 'object';

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** First guess at an expense type from its label. People can change it on the form. */
export function guessExpenseType(label: string): ExpenseType {
  const l = label.toLowerCase();
  if (/dip|depo|bank/.test(l)) return 'deposit';
  if (/shop|rent|bill|tea|ice|salary|transport|clean|current|water|auto|load/.test(l)) return 'shop';
  return 'misc';
}

export interface LegacyImport {
  skus: Sku[];
  sheets: DailySheet[];
  /** Duplicate catalog entries merged: [dropped id, kept id]. */
  merged: [string, string][];
}

/**
 * Convert an old backup into the new catalog and saved daily forms, keeping only dates in [from, to].
 * Duplicate brands (same category, name and size) are merged into the first one.
 */
export function convertLegacy(src: LegacyBackup, from: string, to: string): LegacyImport {
  const keyOf = (cat: string, name: string, size: string) => `${cat}|${name.trim().toLowerCase()}|${size.trim().toLowerCase()}`;
  const kept = new Map<string, Sku>();
  const remap = new Map<string, string>();
  const merged: [string, string][] = [];

  for (const s of src.skus) {
    const k = keyOf(s.cat, s.name_en, s.size);
    const first = kept.get(k);
    if (first) {
      remap.set(s.id, first.id);
      merged.push([s.id, first.id]);
      if (!first.rate && num(s.rate)) first.rate = num(s.rate);
      continue;
    }
    const sku: Sku = { id: s.id, cat: s.cat, sno: num(s.sno), nameEn: s.name_en, nameTe: s.name_te || s.name_en, size: s.size, rate: num(s.rate), cost: num(s.costPrice), active: true };
    kept.set(k, sku);
    remap.set(s.id, s.id);
  }
  const skus = [...kept.values()];
  const byId = new Map(skus.map((s) => [s.id, s]));

  const sheets: DailySheet[] = [];
  for (const date of Object.keys(src.ledgers).sort()) {
    if (date < from || date > to) continue;
    const L = src.ledgers[date];
    const entries = Object.values(L.entries || {});
    if (!entries.length) continue;
    const sheet = emptySheet(date);
    for (const e of entries) {
      const id = remap.get(e.id) ?? e.id;
      const sku = byId.get(id);
      const prev = sheet.rows[id];
      const row: SheetRow = {
        skuId: id, cat: e.cat, sno: num(e.sno ?? sku?.sno), nameEn: sku?.nameEn ?? e.name_en, nameTe: sku?.nameTe ?? e.name_te ?? e.name_en,
        size: e.size, o: num(e.o), r: num(e.r), i: num(e.i), c: num(e.c), cEdited: true, rFromInward: false, issueReason: '',
        rate: num(e.rate) || sku?.rate || 0, cost: num(e.cost) || sku?.cost || 0,
      };
      sheet.rows[id] = prev ? { ...prev, o: prev.o + row.o, r: prev.r + row.r, i: prev.i + row.i, c: prev.c + row.c } : row;
    }
    for (const s of skus) if (!sheet.rows[s.id]) sheet.rows[s.id] = rowFromSku(s, 0);
    sheet.expenses = (L.exp || [])
      .filter((x) => (x.l && x.l.trim()) || num(x.a))
      .map((x) => ({ id: uid(), label: (x.l || '').trim(), amount: num(x.a), type: guessExpenseType(x.l || '') }));
    sheet.upi = num(L.phonePe);
    sheet.other = num(L.other);
    sheet.cashCounted = L.cash == null || (L.cash as unknown) === '' ? null : num(L.cash);
    sheet.preparedBy = L.by || '';
    if (L.remarks) sheet.notes = [{ id: uid(), text: L.remarks, at: date }];
    sheet.status = 'saved';
    sheet.savedAt = new Date().toISOString();
    sheets.push(sheet);
  }
  return { skus, sheets, merged };
}
