import { Balance, CashDay, DailySheet, Inward, LedgerData, Movement, Note, Settings, Sku } from './model';
import { DerivedDay, LedgerRepository, StoredState } from './repository';

/** Keeps the ledger in memory. Used by tests, and a template for a server-backed repository. */
export class MemoryRepository implements LedgerRepository {
  settings: Partial<Settings> | null = null;
  notes: Note[] = [];
  skus = new Map<string, Sku>();
  sheets = new Map<string, DailySheet>();
  inwards = new Map<string, Inward>();
  movements: Movement[] = [];
  balances = new Map<string, Balance>();
  cashDays = new Map<string, CashDay>();
  safety: unknown;

  private clone = <T>(x: T): T => structuredClone(x);

  async loadAll(): Promise<StoredState> {
    return this.clone({
      settings: this.settings, notes: this.notes, skus: [...this.skus.values()], sheets: [...this.sheets.values()],
      inwards: [...this.inwards.values()], movements: this.movements, balances: [...this.balances.values()], cashDays: [...this.cashDays.values()],
    });
  }

  async putSettings(s: Settings) { this.settings = this.clone(s); }
  async putNotes(n: Note[]) { this.notes = this.clone(n); }
  async putSkus(list: Sku[]) { for (const s of list) this.skus.set(s.id, this.clone(s)); }
  async putSheet(s: DailySheet) { this.sheets.set(s.date, this.clone(s)); }

  async saveDay(sheet: DailySheet, d: DerivedDay) {
    this.sheets.set(sheet.date, this.clone(sheet));
    this.movements = [...this.movements.filter((m) => m.date !== d.date), ...this.clone(d.movements)];
    for (const [k, b] of this.balances) if (b.date === d.date) this.balances.delete(k);
    for (const b of d.balances) this.balances.set(b.key, { ...b });
    this.cashDays.set(d.date, this.clone(d.cashDay));
  }

  async putInward(w: Inward) { this.inwards.set(w.id, this.clone(w)); }
  async deleteInward(id: string) { this.inwards.delete(id); }

  async replaceAll(data: LedgerData, derived: DerivedDay[]) {
    this.settings = this.clone(data.settings);
    this.notes = this.clone(data.notes ?? []);
    this.skus = new Map(data.skus.map((s) => [s.id, this.clone(s)]));
    this.sheets = new Map(data.sheets.map((s) => [s.date, this.clone(s)]));
    this.inwards = new Map(data.inwards.map((w) => [w.id, this.clone(w)]));
    this.movements = this.clone(derived.flatMap((d) => d.movements));
    this.balances = new Map(derived.flatMap((d) => d.balances).map((b) => [b.key, { ...b }]));
    this.cashDays = new Map(derived.map((d) => [d.date, this.clone(d.cashDay)]));
  }

  async getSafetyCopy() { return this.safety; }
  async putSafetyCopy(v: unknown) { this.safety = this.clone(v); }
  async clearSafetyCopy() { this.safety = undefined; }
  async requestPersistence() { return true; }
}
