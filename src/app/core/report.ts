import { inr } from './format';
import { available, cashDay, soldOf, sortRows } from './ledger';
import { DailySheet, ReportRecord, SheetRow } from './model';

/** (English, Telugu) → the text in the report's language. */
export type Pick = (en: string, te: string) => string;
type Name = (r: { nameEn: string; nameTe: string }) => string;

/** Brands that appear on the printed report: anything with stock or movement that day. */
export const reportRows = (sheet: DailySheet) =>
  sortRows(Object.values(sheet.rows).filter((r) => r.o || r.r || r.i || r.c));

export type ReportItem = { kind: 'section'; cat: 'LIQUOR' | 'BEER' } | { kind: 'row'; n: number; row: SheetRow };

/** Rows with a section heading before liquor and before beer, numbered 1…n. */
export function reportItems(sheet: DailySheet): ReportItem[] {
  const out: ReportItem[] = [];
  let cat = '';
  let n = 0;
  for (const row of reportRows(sheet)) {
    if (row.cat !== cat) {
      out.push({ kind: 'section', cat: row.cat });
      cat = row.cat;
    }
    out.push({ kind: 'row', n: ++n, row });
  }
  return out;
}

/** The figures a report is made from, flattened so two reports can be compared. */
export function snapshot(sheet: DailySheet): Record<string, number | null> {
  const m: Record<string, number | null> = {};
  for (const r of reportRows(sheet)) {
    m[`${r.skuId}:o`] = r.o;
    m[`${r.skuId}:r`] = r.r;
    m[`${r.skuId}:i`] = r.i;
    m[`${r.skuId}:c`] = r.c;
    m[`${r.skuId}:rate`] = r.rate;
  }
  m['expenses'] = sheet.expenses.reduce((a, e) => a + e.amount, 0);
  m['upi'] = sheet.upi;
  m['other'] = sheet.other;
  m['cash'] = sheet.cashCounted;
  return m;
}

/** What changed between two snapshots, in words. */
export function snapshotChanges(before: Record<string, number | null>, after: Record<string, number | null>, sheet: DailySheet, pick: Pick, name: Name): string[] {
  const field: Record<string, [string, string]> = {
    o: ['opening', 'ప్రారంభ'], r: ['receipts', 'రసీదు'], i: ['issue', 'ఇష్యూ'], c: ['closing', 'ముగింపు'], rate: ['rate', 'రేటు'],
  };
  const totals: Record<string, [string, string]> = {
    expenses: ['Expenses', 'ఖర్చులు'], upi: ['PhonePe / UPI', 'ఫోన్ పే / UPI'], other: ['Deposit / others', 'జమ / ఇతరాలు'], cash: ['Cash counted', 'లెక్కించిన నగదు'],
  };
  const show = (v: number | null | undefined) => (v == null ? '–' : String(v));
  const out: string[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] === after[k]) continue;
    const [id, f] = k.split(':');
    if (f) {
      const row = sheet.rows[id];
      const label = row ? `${name(row)} ${row.size}` : id;
      out.push(`${label} ${pick(...field[f])}: ${show(before[k])} → ${show(after[k])}`);
    } else {
      out.push(`${pick(...totals[k])}: ${show(before[k])} → ${show(after[k])}`);
    }
  }
  return out;
}

/**
 * "Important notes" at the top of the report: anything a manager should check.
 * Same checks as the paper process: carry-over, impossible counts, cash, missing entries.
 */
export function reportNotes(sheet: DailySheet, prev: DailySheet | null, last: ReportRecord | undefined, pick: Pick, name: Name): string[] {
  const n: string[] = [];
  const label = (r: SheetRow) => `${name(r)} [${r.size}]`;

  if (last) {
    const changes = snapshotChanges(last.snap, snapshot(sheet), sheet, pick, name);
    if (changes.length) {
      const more = changes.length > 5 ? pick(`; +${changes.length - 5} more`, `; మరో ${changes.length - 5}`) : '';
      n.push(pick(`Revised after R${last.no} (${last.at}). Changes: `, `R${last.no} (${last.at}) తర్వాత మార్పులు: `) + changes.slice(0, 5).join('; ') + more);
    }
  }
  if (sheet.closed) n.push(pick('Shop was closed this day.', 'ఈ రోజు దుకాణం మూసి ఉంది.'));

  for (const r of reportRows(sheet)) {
    const total = available(r);
    if (r.c > total) n.push(pick(`${label(r)}: closing ${r.c} is more than total ${total}`, `${label(r)}: ముగింపు ${r.c} మొత్తం ${total} కంటే ఎక్కువ`));
    else if (total < 0) n.push(pick(`${label(r)}: total stock is negative (${total})`, `${label(r)}: మొత్తం స్టాక్ రుణాత్మకం (${total})`));
    else if (soldOf(r) > 0 && !(r.rate > 0)) n.push(pick(`${label(r)}: sold ${soldOf(r)} with no rate`, `${label(r)}: ధర లేకుండా ${soldOf(r)} అమ్మారు`));
  }

  if (prev) {
    const d = prev.date.split('-').reverse().join('/');
    for (const r of Object.values(sheet.rows)) {
      const pc = prev.rows[r.skuId]?.c ?? 0;
      if (r.o !== pc) n.push(pick(`${label(r)}: opening ${r.o} differs from previous closing ${pc} (${d})`, `${label(r)}: ప్రారంభ ${r.o} మునుపటి ముగింపు ${pc} (${d}) కు భిన్నం`));
    }
  }

  const t = cashDay(sheet);
  if (!sheet.closed) {
    if (sheet.cashCounted == null) n.push(pick('Cash in hand was not counted', 'చేతిలో నగదు లెక్కించలేదు'));
    else if (sheet.cashCounted !== t.expected) {
      const diff = sheet.cashCounted - t.expected;
      n.push(pick(`Cash counted ${inr(sheet.cashCounted)} vs expected ${inr(t.expected)}: ${diff > 0 ? 'excess' : 'short'} ${inr(Math.abs(diff))}`,
        `లెక్కించిన నగదు ${inr(sheet.cashCounted)} / అంచనా ${inr(t.expected)}: ${diff > 0 ? 'అదనం' : 'తక్కువ'} ${inr(Math.abs(diff))}`));
    }
    if (t.gross > 0 && t.shopExp + t.miscExp === 0) n.push(pick('No shop expenses entered', 'దుకాణం ఖర్చులు నమోదు కాలేదు'));
    if (t.gross > 0 && !sheet.upi) n.push(pick('No PhonePe / UPI amount entered', 'ఫోన్ పే / UPI మొత్తం నమోదు కాలేదు'));
  }
  return n;
}

/**
 * Split n table rows into A4 pages. The first page holds `first` rows, later pages `rest`.
 * The last page also needs room for `tail` rows' worth of totals and signatures;
 * if it doesn't fit, they go on a page of their own.
 */
export function paginate(n: number, first: number, rest: number, tail: number): [number, number][] {
  const pages: [number, number][] = [];
  let i = 0;
  let cap = first;
  do {
    const take = Math.min(cap, n - i);
    pages.push([i, i + take]);
    i += take;
    cap = rest;
  } while (i < n);
  const last = pages[pages.length - 1];
  if (last[1] - last[0] + tail > (pages.length === 1 ? first : rest)) pages.push([n, n]);
  return pages;
}
