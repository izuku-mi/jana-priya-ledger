import { TestBed } from '@angular/core/testing';
import { soldOf } from './ledger';
import { MemoryRepository } from './memory-repository';
import { LEDGER_REPOSITORY } from './repository';
import { LedgerStore } from './store';

describe('LedgerStore through a repository', () => {
  let repo: MemoryRepository;
  let store: LedgerStore;

  beforeEach(async () => {
    repo = new MemoryRepository();
    TestBed.configureTestingModule({ providers: [{ provide: LEDGER_REPOSITORY, useValue: repo }] });
    store = TestBed.inject(LedgerStore);
    await store.init();
  });

  async function saveDay(date: string, closing: Record<string, number>, receipts: Record<string, number> = {}) {
    const state = store.sheetState(date);
    if (state.kind !== 'ready') throw new Error('blocked');
    const sheet = structuredClone(state.sheet);
    for (const [id, r] of Object.entries(receipts)) sheet.rows[id] = { ...sheet.rows[id], r, c: sheet.rows[id].o + r };
    for (const [id, c] of Object.entries(closing)) sheet.rows[id] = { ...sheet.rows[id], c, cEdited: true };
    return store.saveSheet(sheet);
  }

  it('seeds the catalog into an empty repository', () => {
    expect(store.skus().length).toBe(80);
    expect(repo.skus.size).toBe(80);
  });

  it('saving a day stores the form and its records, and they reload', async () => {
    await saveDay('2026-11-19', { L48: 100 }, { L48: 120 });
    expect(repo.sheets.get('2026-11-19')?.status).toBe('saved');
    expect(repo.movements.filter((m) => m.date === '2026-11-19').map((m) => [m.type, m.qty]).sort()).toEqual([['RECEIPT', 120], ['SALE', 20]]);
    expect(repo.cashDays.get('2026-11-19')?.gross).toBe(20 * 150);

    const fresh = TestBed.runInInjectionContext(() => new LedgerStore());
    await fresh.init();
    expect(fresh.balances()['2026-11-19']['L48']).toBe(100);
    expect(fresh.lastSaved()).toBe('2026-11-19');
  });

  it('saving again replaces that day\'s records instead of adding to them', async () => {
    await saveDay('2026-11-19', { L48: 100 }, { L48: 120 });
    await saveDay('2026-11-19', { L48: 90 });
    expect(repo.movements.filter((m) => m.type === 'SALE').map((m) => m.qty)).toEqual([30]);
  });

  it('blocks a day when the day before is not saved', async () => {
    await saveDay('2026-11-19', {}, { L48: 50 });
    expect(store.sheetState('2026-11-21')).toEqual({ kind: 'blocked', missing: '2026-11-20', lastSaved: '2026-11-19' });
    await store.markClosed('2026-11-20');
    const s = store.sheetState('2026-11-21');
    expect(s.kind === 'ready' && s.sheet.rows['L48'].o).toBe(50);
  });

  it('a delivery sets receipts and the buy cost, including its share of charges', async () => {
    await saveDay('2026-11-19', {}, { L54: 100 });
    await store.saveInward({
      id: 'w1', date: '2026-11-20', supplier: '', invoiceNo: '', invoiceTotal: null, notes: [], savedAt: '',
      lines: [{ skuId: 'L54', qty: 100, cost: 90 }],
      charges: [{ id: 'c', label: 'Transport', amount: 500 }],
    });
    const row = store.sheets()['2026-11-20'].rows['L54'];
    expect([row.o, row.r, row.c, soldOf(row), row.rFromInward]).toEqual([100, 100, 200, 0, true]);
    expect(store.sheets()['2026-11-20'].rows['L54'].cost).toBe(95);
    expect([...repo.prices.values()].map((p) => [p.skuId, p.from, p.cost])).toEqual([['L54', '2026-11-20', 95]]);

    await store.deleteInward('w1');
    expect(store.sheets()['2026-11-20'].rows['L54'].r).toBe(0);
  });

  it('restore keeps a safety copy that can be undone', async () => {
    await saveDay('2026-11-19', {}, { L48: 10 });
    const backup = await store.buildBackup();
    expect(await store.verifyBackup(backup)).toBe(true);

    await store.eraseAll();
    expect(store.savedDates()).toEqual([]);
    expect(await store.undoRestore()).toBe(true);
    expect(store.savedDates()).toEqual(['2026-11-19']);
    expect(store.balances()['2026-11-19']['L48']).toBe(10);
  });
  it('moves a day entered under the wrong date, with its delivery, and its openings follow the day before', async () => {
    await saveDay('2026-11-03', { L54: 100 }, { L54: 100 });
    // Nov 6's sheet typed into Nov 4: a delivery of 50 and a counted closing of 120.
    await store.saveInward({
      id: 'w6', date: '2026-11-04', supplier: '', invoiceNo: '', invoiceTotal: null, notes: [], savedAt: '',
      lines: [{ skuId: 'L54', qty: 50, cost: 90 }], charges: [],
    });
    const typed = structuredClone(store.sheets()['2026-11-04']);
    typed.rows['L54'] = { ...typed.rows['L54'], c: 120, cEdited: true };
    await store.saveDraft(typed);

    await expect(store.moveDay('2026-11-04', '2026-11-03')).rejects.toThrow('already has a form');
    await store.moveDay('2026-11-04', '2026-11-06');

    expect(store.sheets()['2026-11-04']).toBeUndefined();
    const moved = store.sheets()['2026-11-06'];
    expect([moved.status, moved.movedFrom, moved.rows['L54'].r, moved.rows['L54'].c]).toEqual(['draft', '2026-11-04', 50, 120]);
    expect(store.inwards().map((w) => w.date)).toEqual(['2026-11-06']);
    expect(store.prices().filter((p) => p.inwardId === 'w6').map((p) => p.from)).toEqual(['2026-11-06']);
    expect(await store.hasSafetyCopy()).toBe(true);

    // Fill the real Nov 4 and 5; Nov 6 keeps its counted closing and its sales are worked out again.
    expect(store.sheetState('2026-11-04').kind).toBe('ready');
    await saveDay('2026-11-04', { L54: 90 });
    await saveDay('2026-11-05', { L54: 80 });
    const r = store.sheets()['2026-11-06'].rows['L54'];
    expect([r.o, r.r, r.c, soldOf(r)]).toEqual([80, 50, 120, 10]);

    const saved = await store.saveSheet(store.sheets()['2026-11-06']);
    expect(saved.movedFrom).toBeUndefined();
    expect(store.balances()['2026-11-06']['L54']).toBe(120);
  });
  it('clears a saved day with its delivery, so it can be entered again', async () => {
    await saveDay('2026-11-03', { L54: 100 }, { L54: 100 });
    await store.saveInward({
      id: 'w4', date: '2026-11-04', supplier: '', invoiceNo: '', invoiceTotal: null, notes: [], savedAt: '',
      lines: [{ skuId: 'L54', qty: 50, cost: 90 }], charges: [],
    });
    await store.saveSheet(store.sheets()['2026-11-04']);
    await saveDay('2026-11-05', { L54: 140 });
    expect(store.staleDates()).toEqual([]);

    await store.clearDay('2026-11-04');

    expect(store.sheets()['2026-11-04']).toBeUndefined();
    expect(store.inwards()).toEqual([]);
    expect(store.prices().some((p) => p.inwardId === 'w4')).toBe(false);
    expect(store.cashDays()['2026-11-04']).toBeUndefined();
    expect(repo.movements.some((m) => m.date === '2026-11-04')).toBe(false);
    expect(await store.hasSafetyCopy()).toBe(true);
    const fresh = store.sheetState('2026-11-04');
    expect(fresh.kind === 'ready' && [fresh.isNew, fresh.sheet.rows['L54'].o, fresh.sheet.rows['L54'].r]).toEqual([true, 100, 0]);

    // Re-entered with different counts: Nov 5 no longer matches until fixed.
    await saveDay('2026-11-04', { L54: 95 });
    expect(store.staleDates()).toEqual(['2026-11-05']);
  });
});
