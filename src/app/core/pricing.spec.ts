import { TestBed } from '@angular/core/testing';
import { seedCatalog } from './catalog-seed';
import { emptySheet, rowFromSku, soldOf } from './ledger';
import { MemoryRepository } from './memory-repository';
import { PriceChange } from './model';
import { mergePriceChanges, priceIndex, priceOn, pricesFromSheets, repriceSheet } from './pricing';
import { LEDGER_REPOSITORY } from './repository';
import { LedgerStore } from './store';

const sku = seedCatalog().find((s) => s.id === 'L25')!; // M.H. Brandy N, catalog rate 220
const change = (from: string, rate?: number, cost?: number, at = '2026-01-01T00:00:00Z'): PriceChange =>
  ({ id: `${from}-${rate}-${cost}`, skuId: 'L25', from, rate, cost, source: 'manual', at });

describe('price on a date', () => {
  const idx = priceIndex([change('2026-11-01', 200, 160), change('2026-11-22', 220), change('2026-11-25', undefined, 175)]);

  it('uses the latest change on or before the date, for rate and cost separately', () => {
    expect(priceOn(sku, '2026-11-01', idx)).toEqual({ rate: 200, cost: 160 });
    expect(priceOn(sku, '2026-11-21', idx)).toEqual({ rate: 200, cost: 160 });
    expect(priceOn(sku, '2026-11-22', idx)).toEqual({ rate: 220, cost: 160 });
    expect(priceOn(sku, '2026-11-30', idx)).toEqual({ rate: 220, cost: 175 });
  });

  it('before a brand\'s first change, the catalog price is the default', () => {
    expect(priceOn(sku, '2026-10-15', idx)).toEqual({ rate: 220, cost: 0 });
    expect(priceOn(sku, '2026-10-15', priceIndex([]))).toEqual({ rate: 220, cost: 0 });
  });

  it('a second change on the same date for the same brand merges into one', () => {
    const merged = mergePriceChanges([change('2026-11-01', 200)], [change('2026-11-01', 210, 170)]);
    expect(merged.length).toBe(1);
    expect([merged[0].rate, merged[0].cost]).toEqual([210, 170]);
  });

  it('reprices a form to its date and rebuilds history from forms', () => {
    const s = emptySheet('2026-11-10');
    s.rows['L25'] = { ...rowFromSku(sku, 10), c: 5, cEdited: true };
    const next = repriceSheet(s, idx, new Map([[sku.id, sku]]))!;
    expect(next.rows['L25'].rate).toBe(200);
    expect(repriceSheet(next, idx, new Map([[sku.id, sku]]))).toBeNull();

    const later = { ...next, date: '2026-11-12', rows: { L25: { ...next.rows['L25'], rate: 230 } } };
    expect(pricesFromSheets([later, next]).map((p) => [p.from, p.rate])).toEqual([['2026-11-10', 200], ['2026-11-12', 230]]);
  });
});

describe('entering old days with the prices of that time', () => {
  let store: LedgerStore;
  let repo: MemoryRepository;

  beforeEach(async () => {
    repo = new MemoryRepository();
    TestBed.configureTestingModule({ providers: [{ provide: LEDGER_REPOSITORY, useValue: repo }] });
    store = TestBed.inject(LedgerStore);
    await store.init();
  });

  async function save(date: string, closing: number, opening?: number) {
    const st = store.sheetState(date);
    if (st.kind !== 'ready') throw new Error('blocked');
    const s = structuredClone(st.sheet);
    s.rows['L25'] = { ...s.rows['L25'], ...(opening != null ? { o: opening } : {}), c: closing, cEdited: true };
    return store.saveSheet(s);
  }

  it('a new form for 1 Nov takes the 1 Nov price, not today\'s catalog price', async () => {
    await store.setPrices([{ ...change('2026-11-01', 200, 160), source: 'manual' }]);
    const st = store.sheetState('2026-11-01');
    expect(st.kind === 'ready' && st.sheet.rows['L25'].rate).toBe(200);
  });

  it('a price change from a date reprices saved days from that date only, and their sales value', async () => {
    await store.setPrices([change('2026-11-01', 200)]);
    await save('2026-11-01', 90, 100);
    await save('2026-11-02', 80);
    expect(store.cashDays()['2026-11-02'].gross).toBe(10 * 200);

    await store.setPrices([change('2026-11-02', 210, undefined, '2026-11-02T10:00:00Z')]);
    expect(store.sheets()['2026-11-01'].rows['L25'].rate).toBe(200);
    expect(store.sheets()['2026-11-02'].rows['L25'].rate).toBe(210);
    expect(store.sheets()['2026-11-02'].status).toBe('saved');
    expect(store.cashDays()['2026-11-02'].gross).toBe(10 * 210);
    expect(repo.cashDays.get('2026-11-02')?.gross).toBe(2100);
    expect(soldOf(store.sheets()['2026-11-02'].rows['L25'])).toBe(10);
  });

  it('removing a change puts the earlier price back', async () => {
    await store.setPrices([change('2026-11-01', 200)]);
    await save('2026-11-01', 90, 100);
    await store.setPrices([change('2026-11-01', 205, undefined, '2026-11-01T09:00:00Z')]);
    expect(store.prices().length).toBe(1);
    const id = store.prices()[0].id;
    await store.removePrices([id]);
    expect(store.sheets()['2026-11-01'].rows['L25'].rate).toBe(220);
  });

  it('a delivery sets the buy cost from its date', async () => {
    await save('2026-11-01', 100, 100);
    await store.saveInward({
      id: 'w1', date: '2026-11-02', supplier: '', invoiceNo: '', invoiceTotal: null, notes: [], savedAt: '',
      lines: [{ skuId: 'L25', qty: 48, cost: 170 }], charges: [{ id: 'c', label: 'Transport', amount: 480 }],
    });
    expect(store.sheets()['2026-11-02'].rows['L25'].cost).toBe(180);
    expect(store.sheets()['2026-11-01'].rows['L25'].cost).toBe(0); // days before the delivery keep their price
    expect(store.prices().filter((p) => p.inwardId === 'w1').length).toBe(1);

    await store.deleteInward('w1');
    expect(store.prices().length).toBe(0);
    expect(store.sheets()['2026-11-02'].rows['L25'].cost).toBe(0);
  });
});
