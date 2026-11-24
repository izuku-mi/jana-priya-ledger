import { CashDay, Charge, DailySheet, InwardLine, Movement, SheetRow, Sku } from './model';

/** Bottles available on the day. */
export const available = (r: Pick<SheetRow, 'o' | 'r' | 'i'>) => r.o + r.r - r.i;

/** Sales = opening + receipts − issues − closing. */
export const soldOf = (r: Pick<SheetRow, 'o' | 'r' | 'i' | 'c'>) => r.o + r.r - r.i - r.c;

/** Until the user types a closing, closing follows opening + receipts − issues (so sales stay 0). */
export const withAutoClosing = (r: SheetRow): SheetRow => (r.cEdited ? r : { ...r, c: available(r) });

export const sortRows = (rows: SheetRow[]) =>
  [...rows].sort((a, b) => (a.cat === b.cat ? a.sno - b.sno : a.cat === 'LIQUOR' ? -1 : 1));

export function rowFromSku(s: Sku, opening: number): SheetRow {
  return {
    skuId: s.id, cat: s.cat, sno: s.sno, nameEn: s.nameEn, nameTe: s.nameTe, size: s.size,
    o: opening, r: 0, i: 0, c: opening, cEdited: false, rFromInward: false, issueReason: '',
    rate: s.rate, cost: s.cost,
  };
}

export function emptySheet(date: string): DailySheet {
  const now = new Date().toISOString();
  return {
    date, status: 'draft', rows: {}, expenses: [], upi: 0, other: 0, cashCounted: null,
    closed: false, notes: [], preparedBy: '', savedAt: null, updatedAt: now,
  };
}

/**
 * A new day's form: every active catalog brand, opening = previous saved day's closing,
 * closing = opening. Brands that are no longer in the catalog but still hold stock are kept.
 */
export function newSheet(date: string, prev: DailySheet | null, catalog: Sku[]): DailySheet {
  const sheet = emptySheet(date);
  for (const s of catalog) {
    if (!s.active) continue;
    sheet.rows[s.id] = rowFromSku(s, prev?.rows[s.id]?.c ?? 0);
  }
  if (prev) {
    for (const p of Object.values(prev.rows)) {
      if (!sheet.rows[p.skuId] && p.c > 0) {
        sheet.rows[p.skuId] = { ...p, o: p.c, r: 0, i: 0, c: p.c, cEdited: false, rFromInward: false, issueReason: '' };
      }
    }
    sheet.expenses = prev.expenses
      .filter((e) => e.type === 'shop' && e.label)
      .map((e) => ({ ...e, id: e.id + '-' + date, amount: 0 }));
  }
  return sheet;
}

export interface OpeningDiff {
  skuId: string;
  nameEn: string;
  nameTe: string;
  size: string;
  from: number;
  to: number;
  delta: number;
}

/** Brands whose opening differs from the previous saved day's closing. */
export function openingDiffs(sheet: DailySheet, prev: DailySheet | null): OpeningDiff[] {
  if (!prev) return [];
  const out: OpeningDiff[] = [];
  for (const row of Object.values(sheet.rows)) {
    const to = prev.rows[row.skuId]?.c ?? 0;
    if (row.o !== to) out.push({ skuId: row.skuId, nameEn: row.nameEn, nameTe: row.nameTe, size: row.size, from: row.o, to, delta: to - row.o });
  }
  const order = new Map(sortRows(Object.values(sheet.rows)).map((r, k) => [r.skuId, k]));
  return out.sort((a, b) => order.get(a.skuId)! - order.get(b.skuId)!);
}

export type FixMode = 'keepSales' | 'keepClosing';

/**
 * Set openings to the previous closing for the chosen brands.
 * keepSales: a typed closing moves by the same amount, so sales don't change.
 * keepClosing: the typed closing stays, so sales are worked out again.
 * A closing the user never typed always follows opening + receipts − issues.
 */
export function applyOpeningFix(sheet: DailySheet, prev: DailySheet, skuIds: string[], mode: FixMode): DailySheet {
  const rows = { ...sheet.rows };
  for (const id of skuIds) {
    const row = rows[id];
    if (!row) continue;
    const to = prev.rows[id]?.c ?? 0;
    const delta = to - row.o;
    let next: SheetRow = { ...row, o: to };
    if (next.cEdited && mode === 'keepSales') next = { ...next, c: next.c + delta };
    rows[id] = withAutoClosing(next);
  }
  return { ...sheet, rows, status: 'draft', updatedAt: new Date().toISOString() };
}

/** Records built from a saved form. Saving again replaces the day's records. */
export function buildMovements(sheet: DailySheet): Movement[] {
  const out: Movement[] = [];
  for (const r of Object.values(sheet.rows)) {
    const base = { date: sheet.date, skuId: r.skuId, unitPrice: r.rate, unitCost: r.cost };
    if (r.r) out.push({ ...base, type: 'RECEIPT', qty: r.r, reason: r.rFromInward ? 'inward' : '' });
    if (r.i) out.push({ ...base, type: 'ISSUE', qty: r.i, reason: r.issueReason || 'damage' });
    const s = soldOf(r);
    if (s) out.push({ ...base, type: 'SALE', qty: s, reason: '' });
  }
  return out;
}

/** Totals for one day. Expected cash = sales − UPI − other − every expense line. */
export function cashDay(sheet: DailySheet): CashDay {
  let liquor = 0, beer = 0, units = 0, cogs = 0, damages = 0, costKnown = true;
  for (const r of Object.values(sheet.rows)) {
    const s = soldOf(r);
    const amt = s * r.rate;
    if (r.cat === 'BEER') beer += amt;
    else liquor += amt;
    units += s;
    cogs += s * r.cost;
    damages += r.i * r.cost;
    if ((s > 0 || r.i > 0) && !(r.cost > 0)) costKnown = false;
  }
  const sum = (t: string) => sheet.expenses.filter((e) => e.type === t).reduce((a, e) => a + e.amount, 0);
  const shopExp = sum('shop'), miscExp = sum('misc'), paidPeople = sum('person'), deposits = sum('deposit');
  const expensesAll = shopExp + miscExp + paidPeople + deposits;
  const gross = liquor + beer;
  return {
    date: sheet.date, liquor, beer, gross, units, upi: sheet.upi, other: sheet.other,
    shopExp, miscExp, paidPeople, deposits, expensesAll,
    expected: gross - sheet.upi - sheet.other - expensesAll,
    counted: sheet.cashCounted, cogs, damages, costKnown,
  };
}

/**
 * Landed cost per bottle for a delivery: buy price plus a share of the charges,
 * shared by line value (or by bottles when no buy prices are known).
 */
export function landedCosts(lines: InwardLine[], charges: Charge[]): Map<string, number> {
  const chargeTotal = charges.reduce((a, c) => a + c.amount, 0);
  const value = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  const bottles = lines.reduce((a, l) => a + l.qty, 0);
  const out = new Map<string, number>();
  for (const l of lines) {
    if (!l.qty) continue;
    const share = value > 0 ? (l.qty * l.cost) / value : bottles > 0 ? l.qty / bottles : 0;
    out.set(l.skuId, l.cost + (chargeTotal * share) / l.qty);
  }
  return out;
}

/** Weighted-average cost after a delivery. An unknown old cost (0) is replaced, not averaged in. */
export function weightedAverage(stockBefore: number, oldCost: number, qty: number, newCost: number): number {
  if (!(oldCost > 0) || stockBefore <= 0) return newCost;
  const total = stockBefore + qty;
  return total > 0 ? (stockBefore * oldCost + qty * newCost) / total : newCost;
}

/** Days of stock left at the average daily sales. Infinity when nothing sells. */
export const daysOfCover = (closing: number, avgDaily: number) => (avgDaily > 0 ? closing / avgDaily : Infinity);
