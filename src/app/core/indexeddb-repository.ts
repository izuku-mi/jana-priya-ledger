import { LedgerDb } from './db';
import { DailySheet, Inward, LedgerData, Note, PriceChange, Settings, Sku } from './model';
import { DerivedDay, LedgerRepository, StoredState } from './repository';

/** Stores the ledger in this browser's IndexedDB. Works fully offline. */
export class IndexedDbRepository implements LedgerRepository {
  constructor(private db = new LedgerDb()) {}

  async loadAll(): Promise<StoredState> {
    const [skus, sheets, inwards, cashDays, movements, balances, prices, settings, notes] = await Promise.all([
      this.db.skus.toArray(), this.db.sheets.toArray(), this.db.inwards.toArray(), this.db.cashDays.toArray(),
      this.db.movements.toArray(), this.db.balances.toArray(), this.db.prices.toArray(), this.db.meta.get('settings'), this.db.meta.get('notes'),
    ]);
    return {
      skus, sheets, inwards, cashDays, movements, balances, prices,
      settings: (settings?.value as Partial<Settings>) ?? null,
      notes: (notes?.value as Note[]) ?? [],
    };
  }

  async putSettings(settings: Settings) {
    await this.db.meta.put({ key: 'settings', value: settings });
  }

  async putNotes(notes: Note[]) {
    await this.db.meta.put({ key: 'notes', value: notes });
  }

  async putSkus(skus: Sku[]) {
    await this.db.skus.bulkPut(skus);
  }

  async putSheet(sheet: DailySheet) {
    await this.db.sheets.put(sheet);
  }

  async saveDay(sheet: DailySheet, d: DerivedDay) {
    await this.db.transaction('rw', [this.db.sheets, this.db.movements, this.db.balances, this.db.cashDays], async () => {
      await this.db.sheets.put(sheet);
      await this.db.movements.where('date').equals(d.date).delete();
      await this.db.movements.bulkAdd(d.movements.map(({ id: _id, ...m }) => m));
      await this.db.balances.where('date').equals(d.date).delete();
      await this.db.balances.bulkPut(d.balances);
      await this.db.cashDays.put(d.cashDay);
    });
  }

  async putInward(inward: Inward) {
    await this.db.inwards.put(inward);
  }

  async deleteInward(id: string) {
    await this.db.inwards.delete(id);
  }

  async putPrices(changes: PriceChange[]) {
    await this.db.prices.bulkPut(changes);
  }

  async deletePrices(ids: string[]) {
    await this.db.prices.bulkDelete(ids);
  }

  async replaceAll(data: LedgerData, derived: DerivedDay[]) {
    const db = this.db;
    await db.transaction('rw', [db.skus, db.sheets, db.inwards, db.prices, db.movements, db.balances, db.cashDays, db.meta], async () => {
      await Promise.all([db.skus.clear(), db.sheets.clear(), db.inwards.clear(), db.prices.clear(), db.movements.clear(), db.balances.clear(), db.cashDays.clear()]);
      await db.skus.bulkPut(data.skus);
      await db.sheets.bulkPut(data.sheets);
      await db.inwards.bulkPut(data.inwards);
      await db.prices.bulkPut(data.prices ?? []);
      await db.meta.put({ key: 'settings', value: data.settings });
      await db.meta.put({ key: 'notes', value: data.notes ?? [] });
      await db.movements.bulkAdd(derived.flatMap((d) => d.movements.map(({ id: _id, ...m }) => m)));
      await db.balances.bulkPut(derived.flatMap((d) => d.balances));
      await db.cashDays.bulkPut(derived.map((d) => d.cashDay));
    });
  }

  async getSafetyCopy() {
    return (await this.db.meta.get('preRestore'))?.value;
  }

  async putSafetyCopy(value: unknown) {
    await this.db.meta.put({ key: 'preRestore', value });
  }

  async clearSafetyCopy() {
    await this.db.meta.delete('preRestore');
  }

  async requestPersistence() {
    try {
      return (await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false;
    } catch {
      return false;
    }
  }
}
