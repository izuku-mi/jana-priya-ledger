import { computed, inject, Injectable, signal } from '@angular/core';
import { seedCatalog } from './catalog-seed';
import { addDays, todayIso } from './dates';
import { uid } from './format';
import {
  applyOpeningFix, deriveDay, FixMode, landedCosts, newSheet, openingDiffs, rowFromSku, weightedAverage, withAutoClosing,
} from './ledger';
import { convertLegacy, LegacyBackup } from './legacy';
import { Balance, CashDay, DailySheet, DEFAULT_SETTINGS, Inward, LedgerData, Movement, Note, Settings, SheetRow, Sku } from './model';
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
    const st = await this.repo.loadAll();
    let skus = st.skus;
    if (!skus.length) {
      skus = seedCatalog();
      await this.repo.putSkus(skus);
    }
    this.skus.set(skus);
    this.notes.set(st.notes);
    this.settings.set({ ...DEFAULT_SETTINGS, ...(st.settings ?? {}) });
    this.sheets.set(Object.fromEntries(st.sheets.map((s) => [s.date, s])));
    this.inwards.set(st.inwards);
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

  async putSku(sku: Sku) {
    await this.repo.putSkus([sku]);
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
    await this.repo.putSheet(next);
    return next;
  }

  /** Save: store the form and rebuild that day's movements, balances and cash. */
  async saveSheet(sheet: DailySheet) {
    const now = new Date().toISOString();
    const rows: Record<string, SheetRow> = {};
    for (const [id, r] of Object.entries(sheet.rows)) rows[id] = withAutoClosing(r);
    const saved: DailySheet = { ...sheet, rows, status: 'saved', savedAt: now, updatedAt: now };
    const d = deriveDay(saved);

    await this.repo.saveDay(saved, d);

    this.sheets.update((m) => ({ ...m, [saved.date]: saved }));
    this.movements.update((list) => [...list.filter((x) => x.date !== saved.date), ...d.movements]);
    this.balances.update((b) => ({ ...b, [saved.date]: Object.fromEntries(d.balances.map((x) => [x.skuId, x.closing])) }));
    this.cashDays.update((c) => ({ ...c, [saved.date]: d.cashDay }));

    // A draft for the next day follows the new closings automatically.
    const next = this.sheets()[addDays(saved.date, 1)];
    if (next && next.status === 'draft') {
      const ids = openingDiffs(next, saved).map((x) => x.skuId);
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
    const sheet = newSheet(date, this.previousSaved(date), this.skus());
    sheet.closed = true;
    sheet.expenses = [];
    return this.saveSheet(sheet);
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
    for (const [id, q] of qty) {
      const sku = skus.get(id);
      if (!sheet.rows[id] && sku) sheet.rows[id] = rowFromSku(sku, 0);
      if (sheet.rows[id]) sheet.rows[id] = withAutoClosing({ ...sheet.rows[id], r: q, rFromInward: true });
    }
    for (const row of Object.values(sheet.rows)) {
      if (row.rFromInward && !qty.has(row.skuId)) sheet.rows[row.skuId] = withAutoClosing({ ...row, r: 0, rFromInward: false });
    }
    return sheet;
  }

  /**
   * Save a delivery: that day's receipts become the sum of its deliveries, and each brand's
   * buy cost becomes the weighted average including its share of the charges.
   */
  async saveInward(inward: Inward) {
    const state = this.sheetState(inward.date);
    if (state.kind !== 'ready') throw new Error(`Fill ${state.missing} first`);
    await this.repo.putInward(inward);
    const all = [...this.inwards().filter((w) => w.id !== inward.id), inward];
    this.inwards.set(all);

    const sheet = this.applyDeliveries(structuredClone(state.sheet), all.filter((w) => w.date === inward.date));
    const landed = landedCosts(inward.lines, inward.charges);
    const changed: Sku[] = [];
    for (const l of inward.lines) {
      const sku = this.skuMap().get(l.skuId);
      const unit = landed.get(l.skuId);
      if (!sku || unit == null || !(l.cost > 0)) continue;
      const cost = Math.round(weightedAverage(sheet.rows[l.skuId]?.o ?? 0, sku.cost, l.qty, unit) * 100) / 100;
      changed.push({ ...sku, cost });
      if (sheet.rows[l.skuId]) sheet.rows[l.skuId] = { ...sheet.rows[l.skuId], cost };
    }
    if (changed.length) {
      await this.repo.putSkus(changed);
      const byId = new Map(changed.map((s) => [s.id, s]));
      this.skus.update((list) => list.map((s) => byId.get(s.id) ?? s));
    }
    await this.saveDraft(sheet);
  }

  async deleteInward(id: string) {
    const w = this.inwards().find((x) => x.id === id);
    if (!w) return;
    await this.repo.deleteInward(id);
    this.inwards.update((list) => list.filter((x) => x.id !== id));
    const state = this.sheetState(w.date);
    if (state.kind === 'ready') await this.saveDraft(this.applyDeliveries(structuredClone(state.sheet), this.inwardsFor(w.date)));
  }

  // ---------- backup & restore ----------

  private currentData(): LedgerData {
    return { settings: this.settings(), skus: this.skus(), sheets: Object.values(this.sheets()), inwards: this.inwards(), notes: this.notes() };
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
    await this.replaceAll({ settings: { ...this.settings() }, skus: out.skus, sheets: out.sheets, inwards: [], notes: this.notes() });
    return out;
  }

  async eraseAll() {
    await this.repo.putSafetyCopy(await this.buildBackup());
    await this.replaceAll({ settings: DEFAULT_SETTINGS, skus: seedCatalog(), sheets: [], inwards: [], notes: [] });
  }

  private async replaceAll(data: LedgerData) {
    const clean: LedgerData = { ...data, settings: { ...DEFAULT_SETTINGS, ...data.settings }, notes: data.notes ?? [] };
    await this.repo.replaceAll(clean, clean.sheets.filter((s) => s.status === 'saved').map(deriveDay));
    this.ready.set(false);
    await this.init();
  }

  today() {
    return todayIso();
  }
}
