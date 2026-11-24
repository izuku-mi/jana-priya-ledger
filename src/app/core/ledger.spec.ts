import { seedCatalog } from './catalog-seed';
import { addDays, periodOf } from './dates';
import { group, inr, parseCount } from './format';
import {
  applyOpeningFix, buildMovements, cashDay, emptySheet, landedCosts, newSheet, openingDiffs, rowFromSku,
  soldOf, weightedAverage, withAutoClosing,
} from './ledger';
import { convertLegacy, guessExpenseType, LegacyBackup } from './legacy';
import { DailySheet } from './model';
import { DAY19_CASH, DAY19_EXPENSES, DAY19_ROWS, DAY19_UPI } from './testing/day19.fixture';

const catalog = seedCatalog();
const skuById = new Map(catalog.map((s) => [s.id, s]));

function day19(): DailySheet {
  const sheet = emptySheet('2026-11-19');
  for (const [id, o, r, i, c, rate] of DAY19_ROWS) {
    sheet.rows[id] = { ...rowFromSku(skuById.get(id)!, o), r, i, c, rate, cEdited: true };
  }
  sheet.expenses = DAY19_EXPENSES.map((e, k) => ({ id: String(k), ...e, type: guessExpenseType(e.label) }));
  sheet.upi = DAY19_UPI;
  sheet.cashCounted = DAY19_CASH;
  sheet.status = 'saved';
  return sheet;
}

describe('format', () => {
  it('uses Indian grouping and a true minus sign', () => {
    expect(group(339160)).toBe('3,39,160');
    expect(inr(2455000)).toBe('₹24,55,000');
    expect(inr(-3500)).toBe('−₹3,500');
    expect(parseCount('1,200')).toBe(1200);
    expect(parseCount('')).toBe(0);
  });
});

describe('19 Nov paper sheet (golden figures)', () => {
  const d = cashDay(day19());

  it('matches the paper totals', () => {
    expect(d.liquor).toBe(319770);
    expect(d.beer).toBe(19390);
    expect(d.gross).toBe(339160);
    expect(d.units).toBe(2046);
    expect(d.expensesAll).toBe(10834);
  });

  it('expected cash equals the cash counted on paper', () => {
    expect(d.expected).toBe(246078);
    expect(d.counted).toBe(246078);
  });

  it('flags that profit is unknown while buy prices are 0', () => {
    expect(d.costKnown).toBe(false);
  });
});

describe('daily form', () => {
  it('closing follows opening + receipts − issues until typed, so receipts are not sales', () => {
    const row = { ...rowFromSku(skuById.get('L48')!, 100), r: 48 };
    const auto = withAutoClosing(row);
    expect(auto.c).toBe(148);
    expect(soldOf(auto)).toBe(0);
    const typed = withAutoClosing({ ...row, c: 120, cEdited: true });
    expect(soldOf(typed)).toBe(28);
  });

  it('a new day opens and closes at the previous closing for every active brand', () => {
    const next = newSheet('2026-11-20', day19(), catalog);
    expect(next.rows['L48'].o).toBe(11579);
    expect(next.rows['L48'].c).toBe(11579);
    expect(next.rows['L1'].o).toBe(0);
    expect(Object.keys(next.rows).length).toBe(catalog.length);
    expect(next.status).toBe('draft');
    expect(cashDay(next).gross).toBe(0);
  });

  it('carries shop expense labels forward with 0 amounts', () => {
    const next = newSheet('2026-11-20', day19(), catalog);
    expect(next.expenses.map((e) => [e.label, e.amount])).toEqual([['Shop Exp', 0]]);
  });

  it('finds openings that no longer match the previous closing', () => {
    const prev = day19();
    const next = newSheet('2026-11-20', prev, catalog);
    prev.rows['L25'] = { ...prev.rows['L25'], c: 1616 };
    const diffs = openingDiffs(next, prev);
    expect(diffs).toEqual([expect.objectContaining({ skuId: 'L25', from: 1656, to: 1616, delta: -40 })]);
  });

  it('fixing an opening can keep sales or keep closing', () => {
    const prev = day19();
    let next = newSheet('2026-11-20', prev, catalog);
    next.rows['L25'] = { ...next.rows['L25'], c: 1415, cEdited: true }; // sold 241
    prev.rows['L25'] = { ...prev.rows['L25'], c: 1616 };

    const keepSales = applyOpeningFix(next, prev, ['L25'], 'keepSales').rows['L25'];
    expect([keepSales.o, keepSales.c, soldOf(keepSales)]).toEqual([1616, 1375, 241]);

    const keepClosing = applyOpeningFix(next, prev, ['L25'], 'keepClosing').rows['L25'];
    expect([keepClosing.o, keepClosing.c, soldOf(keepClosing)]).toEqual([1616, 1415, 201]);
  });

  it('builds receipt, issue and sale records from a saved form', () => {
    const sheet = day19();
    sheet.rows['L4'] = { ...sheet.rows['L4'], i: 2, c: 15, issueReason: 'breakage' };
    const m = buildMovements(sheet);
    const of = (id: string, type: string) => m.find((x) => x.skuId === id && x.type === type)?.qty;
    expect(of('L48', 'RECEIPT')).toBe(4800);
    expect(of('L48', 'SALE')).toBe(719);
    expect(of('L4', 'ISSUE')).toBe(2);
    expect(of('L4', 'SALE')).toBeUndefined();
    expect(m.filter((x) => x.type === 'SALE').reduce((a, x) => a + x.qty, 0)).toBe(2046);
  });
});

describe('buy cost', () => {
  it('shares charges across lines by value', () => {
    const c = landedCosts(
      [{ skuId: 'A', qty: 10, cost: 100 }, { skuId: 'B', qty: 10, cost: 300 }],
      [{ id: '1', label: 'Transport', amount: 400 }],
    );
    expect(c.get('A')).toBe(110);
    expect(c.get('B')).toBe(330);
  });

  it('shares by bottles when no buy prices are known', () => {
    const c = landedCosts([{ skuId: 'A', qty: 30, cost: 0 }, { skuId: 'B', qty: 10, cost: 0 }], [{ id: '1', label: 'Tax', amount: 400 }]);
    expect(c.get('A')).toBe(10);
    expect(c.get('B')).toBe(10);
  });

  it('averages cost by stock held, replacing an unknown old cost', () => {
    expect(weightedAverage(100, 100, 100, 120)).toBe(110);
    expect(weightedAverage(100, 0, 50, 120)).toBe(120);
  });
});

describe('periods', () => {
  it('week of Sun 22 Nov 2026 starting Monday is 16–22 Nov, previous 9–15 Nov', () => {
    const p = periodOf('week', '2026-11-22', 1, 0);
    expect([p.start, p.end, p.prevStart, p.prevEnd]).toEqual(['2026-11-16', '2026-11-22', '2026-11-09', '2026-11-15']);
    expect(p.buckets.length).toBe(7);
  });

  it('month compares whole November with whole October', () => {
    const p = periodOf('month', '2026-11-22', 1, 0);
    expect([p.start, p.end, p.prevStart, p.prevEnd]).toEqual(['2026-11-01', '2026-11-30', '2026-10-01', '2026-10-31']);
    expect(p.buckets.length).toBe(30);
  });

  it('year follows the start month from Settings', () => {
    const jan = periodOf('year', '2026-11-22', 1, 0);
    expect([jan.start, jan.end]).toEqual(['2026-01-01', '2026-12-31']);
    const apr = periodOf('year', '2026-02-10', 1, 3);
    expect([apr.start, apr.end, apr.prevStart]).toEqual(['2025-04-01', '2026-03-31', '2024-04-01']);
    expect(apr.buckets[0].label).toBe('Apr');
  });

  it('addDays crosses month ends', () => {
    expect(addDays('2026-11-30', 1)).toBe('2026-12-01');
  });
});

describe('import from the old app', () => {
  const src: LegacyBackup = {
    skus: [
      { id: 'B6', cat: 'BEER', sno: 6, name_en: 'Budweiser M', size: 'Tin', costPrice: 0, rate: 0 },
      { id: 'C1', cat: 'BEER', sno: 15, name_en: 'Budweiser M', size: 'Tin', costPrice: 0, rate: 200 },
      { id: 'L48', cat: 'LIQUOR', sno: 48, name_en: 'O.A.Brandy', size: 'N', costPrice: 0, rate: 150 },
    ],
    ledgers: {
      '2026-11-18': { entries: { L48: { id: 'L48', cat: 'LIQUOR', size: 'N', name_en: 'O.A.Brandy', o: 1, c: 1, rate: 150 } } },
      '2026-11-21': {
        entries: {
          C1: { id: 'C1', cat: 'BEER', size: 'Tin', name_en: 'Budweiser M', o: 0, r: 120, c: 120, rate: 200 },
          L48: { id: 'L48', cat: 'LIQUOR', size: 'N', name_en: 'O.A.Brandy', o: 10979, r: 1200, c: 11618, rate: 150 },
        },
        exp: [{ l: 'Shop Exp', a: 300 }, { l: 'Dipo karchu', a: 5283 }, { l: 'Gopinath', a: 50000 }],
        phonePe: 93758,
        cash: null,
      },
      '2026-11-22': { entries: {}, cash: 0 },
    },
  };
  const out = convertLegacy(src, '2026-11-19', '2026-11-22');

  it('merges duplicate brands into the first one and keeps a known rate', () => {
    expect(out.merged).toEqual([['C1', 'B6']]);
    expect(out.skus.find((s) => s.id === 'B6')?.rate).toBe(200);
    expect(out.sheets[0].rows['B6'].r).toBe(120);
    expect(out.sheets[0].rows['C1']).toBeUndefined();
  });

  it('keeps only dates in range that have entries', () => {
    expect(out.sheets.map((s) => s.date)).toEqual(['2026-11-21']);
  });

  it('keeps "not counted" separate from ₹0 and guesses expense types', () => {
    const s = out.sheets[0];
    expect(s.cashCounted).toBeNull();
    expect(s.expenses.map((e) => e.type)).toEqual(['shop', 'deposit', 'misc']);
    expect(cashDay(s).gross).toBe(561 * 150);
  });
});
