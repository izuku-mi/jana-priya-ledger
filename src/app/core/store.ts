import { computed, Injectable, signal } from '@angular/core';
import { seedCatalog } from './catalog-seed';
import { addDays, todayIso } from './dates';
import { LedgerDb } from './db';
import { uid } from './format';
import {
  applyOpeningFix, buildMovements, cashDay, FixMode, landedCosts, newSheet, openingDiffs, rowFromSku,
  weightedAverage, withAutoClosing,
} from './ledger';
import { convertLegacy, LegacyBackup } from './legacy';
import { Balance, CashDay, DailySheet, DEFAULT_SETTINGS, Inward, Movement, Note, Settings, SheetRow, Sku } from './model';

export type SheetState =
  | { kind: 'ready'; sheet: DailySheet; isNew: boolean; first: boolean }
  | { kind: 'blocked'; missing: string; lastSaved: string };

export interface BackupFile {
  app: 'jana-priya-ledger';
  schema: 1;
  exportedAt: string;
  checksum: string;
  data: { settings: Settings; skus: Sku[]; sheets: DailySheet[]; inwards: Inward[]; notes?: Note[] };
}

export const isBackupFile = (o: unknown): o is BackupFile =>
  !!o && typeof o === 'object' && (o as BackupFile).app === 'jana-priya-ledger' && (o as BackupFile).schema === 1 &&
  !!(o as BackupFile).data && Array.isArray((o as BackupFile).data.sheets) && Array.isArray((o as BackupFile).data.skus);

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

@Injectable({ providedIn: 'root' })
export class LedgerStore {
  private db = new LedgerDb();

  readonly ready = signal(false);
  readonly persisted = signal<boolean | null>(null);
  readonly settings = signal<Settings>(DEFAULT_SETTINGS);
  readonly skus = signal<Sku[]>([]);
  readonly sheets = signal<Record<string, DailySheet>>({});
  readonly inwards = signal<Inward[]>([]);
  /** Derived on Save: what the dashboards read. */
  readonly cashDays = signal<Record<string, CashDay>>({});
  readonly movements = signal<Movement[]>([]);
  readonly balances = signal<Record<string, Record<string, number>>>({});
  /** Notes not tied to a day or delivery (dashboard, stock, P&L screens). */
  readonly notes = signal<Note[]>([]);

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
    const [skus, sheets, inwards, cashDays, movements, balances, settingsRow, notesRow] = await Promise.all([
      this.db.skus.toArray(), this.db.sheets.toArray(), this.db.inwards.toArray(), this.db.cashDays.toArray(),
      this.db.movements.toArray(), this.db.balances.toArray(), this.db.meta.get('settings'), this.db.meta.get('notes'),
    ]);
    this.notes.set((notesRow?.value as Note[]) ?? []);
    if (!skus.length) {
      const seed = seedCatalog();
      await this.db.skus.bulkPut(seed);
      this.skus.set(seed);
    } else {
      this.skus.set(skus);
    }
    this.settings.set({ ...DEFAULT_SETTINGS, ...((settingsRow?.value as Partial<Settings>) ?? {}) });
    this.sheets.set(Object.fromEntries(sheets.map((s) => [s.date, s])));
    this.inwards.set(inwards);
    this.cashDays.set(Object.fromEntries(cashDays.map((c) => [c.date, c])));
    this.movements.set(movements);
    this.balances.set(this.groupBalances(balances));
    this.ready.set(true);
    try {
      this.persisted.set((await navigator.storage?.persisted?.()) || (await navigator.storage?.persist?.()) || false);
    } catch {
      this.persisted.set(false);
    }
  }

  private groupBalances(rows: Balance[]) {
    const out: Record<string, Record<string, number>> = {};
    for (const b of rows) (out[b.date] ??= {})[b.skuId] = b.closing;
    return out;
  }

  // ---------- settings & catalog ----------

  async updateSettings(patch: Partial<Settings>) {
    const next = { ...this.settings(), ...patch };
    this.settings.set(next);
    await this.db.meta.put({ key: 'settings', value: next });
  }

  async putSku(sku: Sku) {
    await this.db.skus.put(sku);
    this.skus.update((list) => (list.some((s) => s.id === sku.id) ? list.map((s) => (s.id === sku.id ? sku : s)) : [...list, sku]));
  }

  async addSku(p: Pick<Sku, 'cat' | 'nameEn' | 'nameTe' | 'size' | 'rate' | 'cost'>) {
    const sno = Math.max(0, ...this.skus().filter((s) => s.cat === p.cat).map((s) => s.sno)) + 1;
    const sku: Sku = { ...p, id: 'S' + uid(), sno, active: true };
    await this.putSku(sku);
    return sku;
  }

  async addNote(text: string) {
    const next = [{ id: uid(), text, at: new Date().toISOString() }, ...this.notes()];
    this.notes.set(next);
    await this.db.meta.put({ key: 'notes', value: next });
  }

  async removeNote(id: string) {
    const next = this.notes().filter((n) => n.id !== id);
    this.notes.set(next);
    await this.db.meta.put({ key: 'notes', value: next });
  }

  // ---------- daily form ----------

  /** The form for a date, a new one from the previous saved day, or blocked when that day isn't saved. */
  sheetState(date: string): SheetState {
    const all = this.sheets();
    const existing = all[date];
    if (existing) return { kind: 'ready', sheet: existing, isNew: false, first: !this.savedDates().some((d) => d < date) };
    const before = this.savedDates().filter((d) => d < date);
    const lastBefore = before.at(-1);
    if (!lastBefore) return { kind: 'ready', sheet: newSheet(date, null, this.skus()), isNew: true, first: true };
    const yesterday = addDays(date, -1);
    if (lastBefore !== yesterday) return { kind: 'blocked', missing: addDays(lastBefore, 1), lastSaved: lastBefore };
    return { kind: 'ready', sheet: newSheet(date, all[yesterday], this.skus()), isNew: true, first: false };
  }

  previousSaved(date: string): DailySheet | null {
    const prev = this.sheets()[addDays(date, -1)];
    return prev?.status === 'saved' ? prev : null;
  }

  /** Autosave while typing. A saved day becomes "unsaved changes" until Save. */
  async saveDraft(sheet: DailySheet) {
    const next: DailySheet = { ...sheet, status: 'draft', updatedAt: new Date().toISOString() };
    this.sheets.update((m) => ({ ...m, [next.date]: next }));
    await this.db.sheets.put(next);
    return next;
  }

  /** Save: store the form and rebuild that day's movements, balances and cash. */
  async saveSheet(sheet: DailySheet) {
    const now = new Date().toISOString();
    const rows: Record<string, SheetRow> = {};
    for (const [id, r] of Object.entries(sheet.rows)) rows[id] = withAutoClosing(r);
    const saved: DailySheet = { ...sheet, rows, status: 'saved', savedAt: now, updatedAt: now };
    const moves = buildMovements(saved);
    const cd = cashDay(saved);
    const bal: Balance[] = Object.values(rows).map((r) => ({ key: `${saved.date}|${r.skuId}`, date: saved.date, skuId: r.skuId, closing: r.c }));

    await this.db.transaction('rw', [this.db.sheets, this.db.movements, this.db.balances, this.db.cashDays], async () => {
      await this.db.sheets.put(saved);
      await this.db.movements.where('date').equals(saved.date).delete();
      await this.db.movements.bulkAdd(moves);
      await this.db.balances.where('date').equals(saved.date).delete();
      await this.db.balances.bulkPut(bal);
      await this.db.cashDays.put(cd);
    });
    const storedMoves = await this.db.movements.where('date').equals(saved.date).toArray();

    this.sheets.update((m) => ({ ...m, [saved.date]: saved }));
    this.movements.update((list) => [...list.filter((x) => x.date !== saved.date), ...storedMoves]);
    this.balances.update((b) => ({ ...b, [saved.date]: Object.fromEntries(bal.map((x) => [x.skuId, x.closing])) }));
    this.cashDays.update((c) => ({ ...c, [saved.date]: cd }));

    // A draft for the next day follows the new closings automatically.
    const next = this.sheets()[addDays(saved.date, 1)];
    if (next && next.status === 'draft') {
      const ids = openingDiffs(next, saved).map((d) => d.skuId);
      if (ids.length) await this.saveDraft(applyOpeningFix(next, saved, ids, 'keepSales'));
    }
    return saved;
  }

  fixOpenings(sheet: DailySheet, skuIds: string[], mode: FixMode) {
    const prev = this.previousSaved(sheet.date);
    return prev ? this.saveDraft(applyOpeningFix(sheet, prev, skuIds, mode)) : Promise.resolve(sheet);
  }

  /** Shop closed: saved with no sales, stock carried forward. */
  async markClosed(date: string) {
    const prev = this.previousSaved(date);
    const sheet = newSheet(date, prev, this.skus());
    sheet.closed = true;
    sheet.expenses = [];
    return this.saveSheet(sheet);
  }

  // ---------- inward stock ----------

  inwardsFor(date: string) {
    return this.inwards().filter((w) => w.date === date);
  }

  /**
   * Save a delivery: receipts on that day's form become the sum of its deliveries,
   * and each brand's buy cost becomes the weighted average including its share of charges.
   */
  async saveInward(inward: Inward) {
    const state = this.sheetState(inward.date);
    if (state.kind !== 'ready') throw new Error(`Fill ${state.missing} first`);
    const others = this.inwards().filter((w) => w.id !== inward.id);
    const all = [...others, inward];
    await this.db.inwards.put(inward);
    this.inwards.set(all);

    const landed = landedCosts(inward.lines, inward.charges);
    const skus = this.skuMap();
    const sheet = structuredClone(state.sheet);
    const sameDay = all.filter((w) => w.date === inward.date);
    const qtyBySku = new Map<string, number>();
    for (const w of sameDay) for (const l of w.lines) qtyBySku.set(l.skuId, (qtyBySku.get(l.skuId) ?? 0) + l.qty);

    for (const [id, qty] of qtyBySku) {
      const sku = skus.get(id);
      if (!sheet.rows[id] && sku) sheet.rows[id] = rowFromSku(sku, 0);
      if (!sheet.rows[id]) continue;
      sheet.rows[id] = withAutoClosing({ ...sheet.rows[id], r: qty, rFromInward: true });
    }
    for (const row of Object.values(sheet.rows)) {
      if (row.rFromInward && !qtyBySku.has(row.skuId)) sheet.rows[row.skuId] = withAutoClosing({ ...row, r: 0, rFromInward: false });
    }

    for (const l of inward.lines) {
      const sku = skus.get(l.skuId);
      const unit = landed.get(l.skuId);
      if (!sku || unit == null || !(l.cost > 0)) continue;
      const cost = Math.round(weightedAverage(sheet.rows[l.skuId]?.o ?? 0, sku.cost, l.qty, unit) * 100) / 100;
      await this.putSku({ ...sku, cost });
      if (sheet.rows[l.skuId]) sheet.rows[l.skuId] = { ...sheet.rows[l.skuId], cost };
    }
    await this.saveDraft(sheet);
  }

  async deleteInward(id: string) {
    const w = this.inwards().find((x) => x.id === id);
    if (!w) return;
    await this.db.inwards.delete(id);
    this.inwards.update((list) => list.filter((x) => x.id !== id));
    const state = this.sheetState(w.date);
    if (state.kind === 'ready') {
      const sheet = structuredClone(state.sheet);
      const qty = new Map<string, number>();
      for (const x of this.inwardsFor(w.date)) for (const l of x.lines) qty.set(l.skuId, (qty.get(l.skuId) ?? 0) + l.qty);
      for (const row of Object.values(sheet.rows)) {
        if (row.rFromInward) sheet.rows[row.skuId] = withAutoClosing({ ...row, r: qty.get(row.skuId) ?? 0, rFromInward: qty.has(row.skuId) });
      }
      await this.saveDraft(sheet);
    }
  }

  // ---------- backup & restore ----------

  async buildBackup(): Promise<BackupFile> {
    const data = { settings: this.settings(), skus: this.skus(), sheets: Object.values(this.sheets()), inwards: this.inwards(), notes: this.notes() };
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
    await this.db.meta.put({ key: 'preRestore', value: await this.buildBackup() });
    await this.replaceAll(file.data.settings, file.data.skus, file.data.sheets, file.data.inwards, file.data.notes ?? []);
  }

  async hasSafetyCopy() {
    return !!(await this.db.meta.get('preRestore'));
  }

  async undoRestore() {
    const row = await this.db.meta.get('preRestore');
    if (!row) return false;
    const f = row.value as BackupFile;
    await this.replaceAll(f.data.settings, f.data.skus, f.data.sheets, f.data.inwards, f.data.notes ?? []);
    await this.db.meta.delete('preRestore');
    return true;
  }

  /** Import days from the first version of the app. Existing data is kept as a safety copy. */
  async importLegacy(src: LegacyBackup, from: string, to: string) {
    const out = convertLegacy(src, from, to);
    await this.db.meta.put({ key: 'preRestore', value: await this.buildBackup() });
    await this.replaceAll({ ...this.settings() }, out.skus, out.sheets, [], this.notes());
    return out;
  }

  private async replaceAll(settings: Settings, skus: Sku[], sheets: DailySheet[], inwards: Inward[], notes: Note[]) {
    const t = [this.db.skus, this.db.sheets, this.db.inwards, this.db.movements, this.db.balances, this.db.cashDays, this.db.meta];
    await this.db.transaction('rw', t, async () => {
      await Promise.all([this.db.skus.clear(), this.db.sheets.clear(), this.db.inwards.clear(), this.db.movements.clear(), this.db.balances.clear(), this.db.cashDays.clear()]);
      await this.db.skus.bulkPut(skus);
      await this.db.sheets.bulkPut(sheets);
      await this.db.inwards.bulkPut(inwards);
      await this.db.meta.put({ key: 'settings', value: { ...DEFAULT_SETTINGS, ...settings } });
      await this.db.meta.put({ key: 'notes', value: notes });
      const saved = sheets.filter((s) => s.status === 'saved');
      await this.db.movements.bulkAdd(saved.flatMap(buildMovements));
      await this.db.balances.bulkPut(saved.flatMap((s) => Object.values(s.rows).map((r) => ({ key: `${s.date}|${r.skuId}`, date: s.date, skuId: r.skuId, closing: r.c }))));
      await this.db.cashDays.bulkPut(saved.map(cashDay));
    });
    this.ready.set(false);
    await this.init();
  }

  async eraseAll() {
    await this.db.meta.put({ key: 'preRestore', value: await this.buildBackup() });
    await this.replaceAll(DEFAULT_SETTINGS, seedCatalog(), [], [], []);
  }

  today() {
    return todayIso();
  }
}
