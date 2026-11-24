import { seedCatalog } from './catalog-seed';
import { emptySheet, newSheet, rowFromSku } from './ledger';
import { guessExpenseType } from './legacy';
import { DailySheet } from './model';
import { paginate, reportItems, reportNotes, snapshot } from './report';
import { DAY19_CASH, DAY19_EXPENSES, DAY19_ROWS, DAY19_UPI } from './testing/day19.fixture';

const en = (e: string) => e;
const nameEn = (r: { nameEn: string }) => r.nameEn;
const catalog = seedCatalog();
const byId = new Map(catalog.map((s) => [s.id, s]));

function day19(): DailySheet {
  const s = emptySheet('2026-11-19');
  for (const sku of catalog) s.rows[sku.id] = rowFromSku(sku, 0);
  for (const [id, o, r, i, c, rate] of DAY19_ROWS) s.rows[id] = { ...rowFromSku(byId.get(id)!, o), r, i, c, rate, cEdited: true };
  s.expenses = DAY19_EXPENSES.map((e, k) => ({ id: String(k), ...e, type: guessExpenseType(e.label) }));
  s.upi = DAY19_UPI;
  s.cashCounted = DAY19_CASH;
  s.status = 'saved';
  return s;
}

describe('daily report', () => {
  it('lists only brands with stock or movement, liquor then beer, numbered', () => {
    const items = reportItems(day19());
    const rows = items.filter((x) => x.kind === 'row');
    expect(rows.length).toBe(56);
    expect(items[0]).toEqual({ kind: 'section', cat: 'LIQUOR' });
    expect(items.findIndex((x) => x.kind === 'section' && x.cat === 'BEER')).toBe(52);
    expect(rows.at(-1)).toEqual(expect.objectContaining({ n: 56 }));
  });

  it('a clean 19 Nov sheet has no notes: cash balances and openings were not checked against a missing day', () => {
    expect(reportNotes(day19(), null, undefined, en, nameEn)).toEqual([]);
  });

  it('flags cash differences, missing cash, carry-over gaps and impossible closings', () => {
    const prev = day19();
    const s = newSheet('2026-11-20', prev, catalog);
    s.rows['L48'] = { ...s.rows['L48'], o: 11500, c: 11600, cEdited: true };
    const notes = reportNotes(s, prev, undefined, en, nameEn);
    expect(notes).toContain('O.A.Brandy [N]: closing 11600 is more than total 11500');
    expect(notes).toContain('O.A.Brandy [N]: opening 11500 differs from previous closing 11579 (19/11/2026)');
    expect(notes).toContain('Cash in hand was not counted');

    s.cashCounted = 5;
    expect(reportNotes(s, prev, undefined, en, nameEn).some((x) => x.startsWith('Cash counted ₹5 vs expected'))).toBe(true);
  });

  it('a later report lists what changed since the previous one', () => {
    const s = day19();
    const last = { no: 1, at: '19 Nov, 9:00 pm', by: '', snap: snapshot(s) };
    s.rows['L48'] = { ...s.rows['L48'], c: 11500 };
    s.cashCounted = s.cashCounted! - 11850;
    const notes = reportNotes(s, null, last, en, nameEn);
    expect(notes[0]).toBe('Revised after R1 (19 Nov, 9:00 pm). Changes: O.A.Brandy N closing: 11579 → 11500; Cash counted: 246078 → 234228');
  });

  it('pages rows and moves the totals to their own page when they do not fit', () => {
    expect(paginate(10, 20, 30, 5)).toEqual([[0, 10]]);
    expect(paginate(18, 20, 30, 5)).toEqual([[0, 18], [18, 18]]);
    expect(paginate(60, 20, 30, 5)).toEqual([[0, 20], [20, 50], [50, 60]]);
  });
});
