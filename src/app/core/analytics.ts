import { daysOfCover } from './ledger';
import { Bucket, eachDay } from './dates';
import { CashDay, DailySheet, Movement } from './model';

export interface Summary {
  liquor: number;
  beer: number;
  gross: number;
  units: number;
  upi: number;
  other: number;
  shopExp: number;
  miscExp: number;
  paidPeople: number;
  deposits: number;
  expensesAll: number;
  expected: number;
  cogs: number;
  damages: number;
  costKnown: boolean;
  days: CashDay[];
}

export function summarize(cashDays: Record<string, CashDay>, start: string, end: string): Summary {
  const days = Object.values(cashDays).filter((c) => c.date >= start && c.date <= end).sort((a, b) => a.date.localeCompare(b.date));
  const s = (k: keyof CashDay) => days.reduce((a, d) => a + (d[k] as number), 0);
  return {
    liquor: s('liquor'), beer: s('beer'), gross: s('gross'), units: s('units'), upi: s('upi'), other: s('other'),
    shopExp: s('shopExp'), miscExp: s('miscExp'), paidPeople: s('paidPeople'), deposits: s('deposits'),
    expensesAll: s('expensesAll'), expected: s('expected'), cogs: s('cogs'), damages: s('damages'),
    costKnown: days.every((d) => d.costKnown), days,
  };
}

export interface Bar {
  label: string;
  liquor: number;
  beer: number;
  total: number;
  entered: boolean;
  future: boolean;
}

export function bars(cashDays: Record<string, CashDay>, buckets: Bucket[], today: string): Bar[] {
  return buckets.map((b) => {
    const s = summarize(cashDays, b.start, b.end);
    return { label: b.label, liquor: s.liquor, beer: s.beer, total: s.gross, entered: s.days.length > 0, future: b.start > today };
  });
}

export interface BrandSale {
  skuId: string;
  qty: number;
  amount: number;
}

export function brandSales(movements: Movement[], start: string, end: string): BrandSale[] {
  const m = new Map<string, BrandSale>();
  for (const x of movements) {
    if (x.type !== 'SALE' || x.date < start || x.date > end) continue;
    const b = m.get(x.skuId) ?? { skuId: x.skuId, qty: 0, amount: 0 };
    b.qty += x.qty;
    b.amount += x.qty * x.unitPrice;
    m.set(x.skuId, b);
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount);
}

export interface Flow {
  opening: number;
  received: number;
  sold: number;
  issued: number;
  closing: number;
  firstDate: string | null;
  lastDate: string | null;
}

/** Opening of the first saved day, everything that moved, and closing of the last saved day. */
export function stockFlow(sheets: DailySheet[]): Flow {
  const saved = sheets.filter((s) => s.status === 'saved').sort((a, b) => a.date.localeCompare(b.date));
  const f: Flow = { opening: 0, received: 0, sold: 0, issued: 0, closing: 0, firstDate: saved[0]?.date ?? null, lastDate: saved.at(-1)?.date ?? null };
  if (!saved.length) return f;
  for (const r of Object.values(saved[0].rows)) f.opening += r.o;
  for (const s of saved) {
    for (const r of Object.values(s.rows)) {
      f.received += r.r;
      f.issued += r.i;
      f.sold += r.o + r.r - r.i - r.c;
    }
  }
  for (const r of Object.values(saved.at(-1)!.rows)) f.closing += r.c;
  return f;
}

export interface Cover {
  skuId: string;
  closing: number;
  avgDaily: number;
  days: number;
}

/** Days of stock left per brand, from average sales over the saved days in the window. */
export function coverOf(balancesOnEnd: Record<string, number>, movements: Movement[], windowStart: string, end: string, enteredDays: number): Cover[] {
  const sold = new Map<string, number>();
  for (const x of movements) if (x.type === 'SALE' && x.date >= windowStart && x.date <= end) sold.set(x.skuId, (sold.get(x.skuId) ?? 0) + x.qty);
  return Object.entries(balancesOnEnd).map(([skuId, closing]) => {
    const avgDaily = enteredDays > 0 ? (sold.get(skuId) ?? 0) / enteredDays : 0;
    return { skuId, closing, avgDaily, days: daysOfCover(closing, avgDaily) };
  });
}

/** Bottles sold per brand per day, for the heat-map grid. */
export function soldGrid(movements: Movement[], dates: string[], skuIds: string[]) {
  const idx = new Map<string, number>();
  for (const x of movements) if (x.type === 'SALE') idx.set(`${x.date}|${x.skuId}`, x.qty);
  return skuIds.map((id) => {
    const cells = dates.map((d) => idx.get(`${d}|${id}`) ?? 0);
    const max = Math.max(1, ...cells);
    return { skuId: id, cells: cells.map((qty) => ({ qty, level: qty === 0 ? 0 : qty / max < 0.34 ? 1 : qty / max < 0.75 ? 2 : 3 })) };
  });
}

export const datesIn = (start: string, end: string, have: string[]) => eachDay(start, end).filter((d) => have.includes(d));
