import { computed, inject, Injectable, signal } from '@angular/core';
import * as cat from './catalog';
import { seedCatalog } from './catalog-seed';
import { addDays, todayIso } from './dates';
import { uid } from './format';
import {
  applyOpeningFix, deriveDay, FixMode, clearDayData, landedCosts, moveDayData, newSheet, openingDiffs, PriceOf, rowFromSku, withAutoClosing,
} from './ledger';
import { convertLegacy, LegacyBackup } from './legacy';
import { Balance, Brand, CashDay, DailySheet, DEFAULT_SETTINGS, Inward, LedgerData, Movement, Note, PriceChange, ReportRecord, Settings, SheetRow, Sku } from './model';
import { mergePriceChanges, priceIndex, priceOn, pricesFromSheets, repriceSheet } from './pricing';
import { LEDGER_REPOSITORY } from './repository';

export type SheetState =
  | { kind: 'ready'; sheet: DailySheet; isNew: boolean; first: boolean }
  | { kind: 'blocked'; missing: string; lastSaved: string };

export interface BackupFile {
  app: 'jana-priya-ledger';
  schema: 1;
  exportedAt: string;
  checksum: string;
  data: LedgerData;
}

export const isBackupFile = (o: unknown): o is BackupFile =>
  !!o && typeof o === 'object' && (o as BackupFile).app === 'jana-priya-ledger' && (o as BackupFile).schema === 1 &&
  !!(o as BackupFile).data && Array.isArray((o as BackupFile).data.sheets) && Array.isArray((o as BackupFile).data.skus);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The app's state, in signals, and every action that changes it.
 * Storage goes through LEDGER_REPOSITORY, so this class never knows where data lives.
 */
@Injectable({ providedIn: 'root' })
export class LedgerStore {
  private repo = inject(LEDGER_REPOSITORY);

  readonly ready = signal(false);
  readonly persisted = signal<boolean | null>(null);
  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly skus = signal<Sku[]>([]);
  readonly brands = signal<Brand[]>([]);
  readonly sheets = signal<Record<string, DailySheet>>({});
  readonly inwards = signal<Inward[]>([]);
  /** Derived on Save: what the dashboards read. */
  readonly cashDays = signal<Record<string, CashDay>>({});
  readonly movements = signal<Movement[]>([]);
  readonly balances = signal<Record<string, Record<string, number>>>({});
  /** Notes not tied to a day or delivery (dashboard, stock, P&L screens). */
  readonly notes = signal<Note[]>([]);
  /** Price history: what each brand cost and sold for, from which date. */
  readonly prices = signal<PriceChange[]>([]);
  readonly priceIdx = computed(() => priceIndex(this.prices()));

  readonly skuMap = computed(() => new Map(this.skus().map((s) => [s.id, s])));
  readonly savedDates = computed(() => Object.values(this.sheets()).filter((s) => s.status === 'saved').map((s) => s.date).sort());
  readonly lastSaved = computed(() => this.savedDates().at(-1) ?? null);

  /** Saved days whose openings no longer match the previous saved day's closing. */
  readonly staleDates = computed(() => {
    const all = this.sheets();
    return this.savedDates().filter((d) => {
      const prev = all[addDays(d, -1)];
      return prev?.status === 'saved' && openingDiffs(all[d], prev).length > 0;
    });
  });

  /** Brands listed more than once (same category, name and size). */
  readonly duplicateSkus = computed(() => {
    const seen = new Map<string, Sku>();
    const dups: [Sku, Sku][] = [];
    for (const s of this.skus()) {
      const k = `${s.cat}|${s.nameEn.trim().toLowerCase()}|${s.size.toLowerCase()}`;
      const first = seen.get(k);
      if (first) dups.push([first, s]);
      else seen.set(k, s);
    }
    return dups;
  });

  async init() {
    const st = await this.repo.loadAll();
    let skus = st.skus;
    if (!skus.length) {
      skus = seedCatalog();
      await this.repo.putSkus(skus);
    }
    // Data from before brands: group items under brands (same name = same brand).
    const before = { settings: DEFAULT_SETTINGS, skus, brands: st.brands, sheets: [], inwards: [] };
    const grouped = cat.withBrands(before);
    if (grouped !== before) {
      skus = grouped.skus;
      await this.repo.putSkus(skus);
      await this.repo.putBrands(grouped.brands ?? []);
    }
    this.skus.set(skus);
    this.brands.set(grouped.brands ?? []);
    this.notes.set(st.notes);
    this.settings.set({ ...DEFAULT_SETTINGS, ...(st.settings ?? {}) });
    this.sheets.set(Object.fromEntries(st.sheets.map((s) => [s.date, s])));
    this.inwards.set(st.inwards);
    this.prices.set(st.prices);
    this.cashDays.set(Object.fromEntries(st.cashDays.map((c) => [c.date, c])));
    this.movements.set(st.movements);
    this.balances.set(this.groupBalances(st.balances));
    this.ready.set(true);
    this.persisted.set(await this.repo.requestPersistence());
  }

  private groupBalances(rows: Balance[]) {
    const out: Record<string, Record<string, number>> = {};
    for (const b of rows) (out[b.date] ??= {})[b.skuId] = b.closing;
    return out;
  }

  // ---------- settings, catalog, notes ----------

  async updateSettings(patch: Partial<Settings>) {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    await this.repo.putSettings(next);
  }

  async addNote(text: string) {
    const next = [{ id: uid(), text, at: new Date().toISOString() }, ...this.notes()];
    this.notes.set(next);
    await this.repo.putNotes(next);
  }

  async removeNote(id: string) {
    const next = this.notes().filter((n) => n.id !== id);
    this.notes.set(next);
    await this.repo.putNotes(next);
  }

  // ---------- daily form ----------

  /** The form for a date, a new one from the previous saved day, or blocked when that day isn't saved. */
  sheetState(date: string): SheetState {
    const all = this.sheets();
    const existing = all[date];
    if (existing) return { kind: 'ready', sheet: existing, isNew: false, first: !this.savedDates().some((d) => d < date) };
    const before = this.savedDates().filter((d) => d < date);
    const lastBefore = before.at(-1);
    if (!lastBefore) return { kind: 'ready', sheet: newSheet(date, null, this.skus(), this.priceOf(date)), isNew: true, first: true };
    const yesterday = addDays(date, -1);
    if (lastBefore !== yesterday) return { kind: 'blocked', missing: addDays(lastBefore, 1), lastSaved: lastBefore };
    return { kind: 'ready', sheet: newSheet(date, all[yesterday], this.skus(), this.priceOf(date)), isNew: true, first: false };
  }

  // ---------- prices by date ----------

  /** Each brand's price on a date, from the price history (catalog price when there is none). */
  priceOf(date: string): PriceOf {
    const idx = this.priceIdx();
    return (s) => priceOn(s, date, idx);
  }

  /**
   * Record price changes, then put the right prices on every form from the earliest change onwards.
   * Saved days are re-saved so their sales value, cost and cash follow the new prices.
   */
  async setPrices(changes: PriceChange[]) {
    if (!changes.length) return;
    const before = this.prices();
    const next = mergePriceChanges(before, changes);
    const touched = next.filter((p) => !before.includes(p));
    await this.repo.putPrices(touched);
    this.prices.set(next);
    await this.afterPriceChange(changes.map((c) => c.from), new Set(changes.map((c) => c.skuId)));
  }

  async removePrices(ids: string[]) {
    const gone = this.prices().filter((p) => ids.includes(p.id));
    if (!gone.length) return;
    await this.repo.deletePrices(ids);
    this.prices.update((list) => list.filter((p) => !ids.includes(p.id)));
    await this.afterPriceChange(gone.map((p) => p.from), new Set(gone.map((p) => p.skuId)));
  }

/**
   * Forms from the earliest changed date get repriced. The catalog price itself is left alone:
   * it is the default before a brand's first change.
   */
  private async afterPriceChange(dates: string[], _skuIds: Set<string>) {
    await this.repriceFrom(dates.sort()[0]);
  }

  /** A brand's price today (or on a date): what screens show as its current rate and cost. */
  priceToday(sku: Sku, date = todayIso()) {
    return priceOn(sku, date, this.priceIdx());
  }

  private async repriceFrom(from: string) {
    const idx = this.priceIdx();
    const skus = this.skuMap();
    for (const sheet of Object.values(this.sheets()).filter((s) => s.date >= from).sort((a, b) => a.date.localeCompare(b.date))) {
      const next = repriceSheet(sheet, idx, skus);
      if (!next) continue;
      if (next.status === 'saved') {
        const d = deriveDay(next);
        await this.repo.saveDay(next, d);
        this.movements.update((list) => [...list.filter((x) => x.date !== next.date), ...d.movements]);
        this.cashDays.update((c) => ({ ...c, [next.date]: d.cashDay }));
      } else {
        await this.repo.putSheet(next);
      }
      this.sheets.update((m) => ({ ...m, [next.date]: next }));
    }
  }

  previousSaved(date: string): DailySheet | null {
    const prev = this.sheets()[addDays(date, -1)];
    return prev?.status === 'saved' ? prev : null;
  }

  /** Autosave while typing. A saved day becomes "unsaved changes" until Save. */
  async saveDraft(sheet: DailySheet) {
    const next: DailySheet = { ...sheet, status: 'draft', updatedAt: new Date().toISOString() };
    this.sheets.update((m) => ({ ...m, [next.date]: next }));
    await this.repo.putSheet(next);
    return next;
  }

  /** Save: store the form and rebuild that day's movements, balances and cash. */
  async saveSheet(sheet: DailySheet) {
    const now = new Date().toISOString();
    const rows: Record<string, SheetRow> = {};
    for (const [id, r] of Object.entries(sheet.rows)) rows[id] = withAutoClosing(r);
    const saved: DailySheet = { ...sheet, rows, status: 'saved', savedAt: now, updatedAt: now, movedFrom: undefined };
    const d = deriveDay(saved);

    await this.repo.saveDay(saved, d);

    this.sheets.update((m) => ({ ...m, [saved.date]: saved }));
    this.movements.update((list) => [...list.filter((x) => x.date !== saved.date), ...d.movements]);
    this.balances.update((b) => ({ ...b, [saved.date]: Object.fromEntries(d.balances.map((x) => [x.skuId, x.closing])) }));
    this.cashDays.update((c) => ({ ...c, [saved.date]: d.cashDay }));

    // A draft for the next day follows the new closings automatically. A form moved from
    // another date keeps its counted closings; any other draft keeps its sales.
    const next = this.sheets()[addDays(saved.date, 1)];
    if (next && next.status === 'draft') {
      const ids = openingDiffs(next, saved).map((x) => x.skuId);
      if (ids.length) await this.saveDraft(applyOpeningFix(next, saved, ids, next.movedFrom ? 'keepClosing' : 'keepSales'));
    }
    return saved;
  }

  /**
   * A day entered under the wrong date: move its form and deliveries to the right date.
   * The current data is kept as a safety copy first (Settings → Undo).
   */
  async moveDay(from: string, to: string) {
    const next = moveDayData(this.currentData(), from, to);
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll(next);
  }

  /** Remember that a report was made, with its figures, without changing whether the day is saved. */
  async recordReport(date: string, record: ReportRecord) {
    const sheet = this.sheets()[date];
    if (!sheet) return;
    const next: DailySheet = { ...sheet, reports: [...(sheet.reports ?? []), record] };
    this.sheets.update((m) => ({ ...m, [date]: next }));
    await this.repo.putSheet(next);
  }

  fixOpenings(sheet: DailySheet, skuIds: string[], mode: FixMode) {
    const prev = this.previousSaved(sheet.date);
    return prev ? this.saveDraft(applyOpeningFix(sheet, prev, skuIds, mode)) : Promise.resolve(sheet);
  }

  /** Shop closed: saved with no sales, stock carried forward. */
  async markClosed(date: string) {
    const sheet = newSheet(date, this.previousSaved(date), this.skus(), this.priceOf(date));
    sheet.closed = true;
    sheet.expenses = [];
    return this.saveSheet(sheet);
  }

  /** Start a day again from scratch: its form and deliveries are removed (safety copy kept). */
  async clearDay(date: string) {
    const next = clearDayData(this.currentData(), date);
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll(next);
  }

  // ---------- inward stock ----------

  inwardsFor(date: string) {
    return this.inwards().filter((w) => w.date === date);
  }

  /** Receipts on a form = the sum of that day's deliveries, for brands that came by delivery. */
  private applyDeliveries(sheet: DailySheet, deliveries: Inward[]) {
    const qty = new Map<string, number>();
    for (const w of deliveries) for (const l of w.lines) qty.set(l.skuId, (qty.get(l.skuId) ?? 0) + l.qty);
    const skus = this.skuMap();
    const priceOf = this.priceOf(sheet.date);
    for (const [id, q] of qty) {
      const sku = skus.get(id);
      if (!sheet.rows[id] && sku) sheet.rows[id] = rowFromSku(sku, 0, priceOf(sku));
      if (sheet.rows[id]) sheet.rows[id] = withAutoClosing({ ...sheet.rows[id], r: q, rFromInward: true });
    }
    for (const row of Object.values(sheet.rows)) {
      if (row.rFromInward && !qty.has(row.skuId)) sheet.rows[row.skuId] = withAutoClosing({ ...row, r: 0, rFromInward: false });
    }
    return sheet;
  }

  /**
   * Save a delivery: that day's receipts become the sum of its deliveries, and each brand's buy cost
   * from the delivery date is its landed cost (buy price plus its share of the charges).
   */
  async saveInward(inward: Inward) {
    const state = this.sheetState(inward.date);
    if (state.kind !== 'ready') throw new Error(`Fill ${state.missing} first`);
    await this.repo.putInward(inward);
    const all = [...this.inwards().filter((w) => w.id !== inward.id), inward];
    this.inwards.set(all);
    await this.saveDraft(this.applyDeliveries(structuredClone(state.sheet), all.filter((w) => w.date === inward.date)));

    // Replace this delivery's earlier cost entries (if it is being edited) with its landed costs.
    const old = this.prices().filter((p) => p.inwardId === inward.id).map((p) => p.id);
    if (old.length) {
      await this.repo.deletePrices(old);
      this.prices.update((list) => list.filter((p) => !old.includes(p.id)));
    }
    const landed = landedCosts(inward.lines, inward.charges);
    const at = new Date().toISOString();
    const costs: PriceChange[] = inward.lines
      .filter((l) => l.cost > 0 && landed.has(l.skuId))
      .map((l) => ({ id: `in-${inward.id}-${l.skuId}`, skuId: l.skuId, from: inward.date, cost: Math.round(landed.get(l.skuId)! * 100) / 100, source: 'inward', inwardId: inward.id, at }));
    if (costs.length) await this.setPrices(costs);
    else if (old.length) await this.repriceFrom(inward.date);
  }

  async deleteInward(id: string) {
    const w = this.inwards().find((x) => x.id === id);
    if (!w) return;
    await this.repo.deleteInward(id);
    this.inwards.update((list) => list.filter((x) => x.id !== id));
    const state = this.sheetState(w.date);
    if (state.kind === 'ready') await this.saveDraft(this.applyDeliveries(structuredClone(state.sheet), this.inwardsFor(w.date)));
    await this.removePrices(this.prices().filter((p) => p.inwardId === id).map((p) => p.id));
  }

  // ---------- backup & restore ----------

  private currentData(): LedgerData {
    return { settings: this.settings(), skus: this.skus(), brands: this.brands(), sheets: Object.values(this.sheets()), inwards: this.inwards(), notes: this.notes(), prices: this.prices() };
  }

  async buildBackup(): Promise<BackupFile> {
    const data = this.currentData();
    return { app: 'jana-priya-ledger', schema: 1, exportedAt: new Date().toISOString(), checksum: await sha256(JSON.stringify(data)), data };
  }

  async verifyBackup(file: BackupFile) {
    return (await sha256(JSON.stringify(file.data))) === file.checksum;
  }

  async markBackedUp() {
    await this.updateSettings({ lastBackupAt: new Date().toISOString() });
  }

  /** Replace everything with a backup. The current data is kept as a safety copy first. */
  async restore(file: BackupFile) {
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll(file.data);
  }

  async hasSafetyCopy() {
    return !!(await this.repo.getSafetyCopy());
  }

  async undoRestore() {
    const f = (await this.repo.getSafetyCopy()) as BackupFile | undefined;
    if (!f) return false;
    await this.replaceAll(f.data);
    await this.repo.clearSafetyCopy();
    return true;
  }

  /** Import days from the first version of the app. Existing data is kept as a safety copy. */
  async importLegacy(src: LegacyBackup, from: string, to: string) {
    const out = convertLegacy(src, from, to);
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll({ settings: { ...this.settings() }, skus: out.skus, sheets: out.sheets, inwards: [], notes: this.notes(), prices: pricesFromSheets(out.sheets) });
    return out;
  }

  async eraseAll() {
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll({ settings: DEFAULT_SETTINGS, skus: seedCatalog(), sheets: [], inwards: [], notes: [], prices: [] });
  }

  /**
   * Write a whole data set and reload. `quiet` keeps the current screen in place (catalogue edits);
   * otherwise the app restarts its screens (restore, import, erase, moving or clearing a day).
   */
  private async replaceAll(data: LedgerData, quiet = false) {
    // Backups from before price history carry prices on each day's form; rebuild the history from them.
    // Backups from before brands get their items grouped under brands.
    const clean: LedgerData = cat.withBrands({
      ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings }, notes: data.notes ?? [],
      prices: data.prices ?? pricesFromSheets(data.sheets),
    });
    await this.repo.replaceAll(clean, clean.sheets.filter((s) => s.status === 'saved').map(deriveDay));
    if (!quiet) this.ready.set(false);
    await this.init();
  }

  // ---------- catalogue ----------

  private async commitCatalog(next: LedgerData, safetyCopy = false) {
    if (safetyCopy) await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll(next, true);
  }

  /** Rename a brand (or change its category): every item and every day's form follows. */
  updateBrand(id: string, patch: Partial<Omit<Brand, 'id'>>) {
    return this.commitCatalog(cat.updateBrand(this.currentData(), id, patch));
  }

  /** Change an item's type, size or kind: every day's form follows. */
  updateItem(id: string, patch: Partial<Pick<Sku, 'typeEn' | 'typeTe' | 'size' | 'kind'>>) {
    return this.commitCatalog(cat.updateSku(this.currentData(), id, patch));
  }

  setArchived(ids: string[], archived: boolean) {
    return this.commitCatalog(cat.setArchived(this.currentData(), ids, archived));
  }

  moveToBrand(ids: string[], target: Parameters<typeof cat.moveToBrand>[2]) {
    return this.commitCatalog(cat.moveToBrand(this.currentData(), ids, target));
  }

  async addItem(brand: Parameters<typeof cat.addItem>[1], item: Parameters<typeof cat.addItem>[2]) {
    const out = cat.addItem(this.currentData(), brand, item);
    await this.commitCatalog(out.data);
    return out.sku;
  }

  /** Delete items from everywhere. A safety copy is kept first (Settings → Undo). */
  deleteItems(ids: string[]) {
    return this.commitCatalog(cat.deleteItems(this.currentData(), ids), true);
  }

  usage(ids: string[]) {
    return cat.usage({ sheets: Object.values(this.sheets()), inwards: this.inwards() }, ids);
  }

  today() {
    return todayIso();
  }
}
