import { InjectionToken } from '@angular/core';
import { Balance, Brand, CashDay, DailySheet, Inward, LedgerData, Movement, Note, PriceChange, Settings, Sku } from './model';

/** What the app keeps. Entered data plus the records rebuilt from it on Save. */
export interface StoredState {
  settings: Partial<Settings> | null;
  notes: Note[];
  skus: Sku[];
  brands: Brand[];
  sheets: DailySheet[];
  inwards: Inward[];
  prices: PriceChange[];
  movements: Movement[];
  balances: Balance[];
  cashDays: CashDay[];
}

/** The records one saved day produces. */
export interface DerivedDay {
  date: string;
  movements: Movement[];
  balances: Balance[];
  cashDay: CashDay;
}

/**
 * Where the ledger is stored. The app only talks to this interface, so the browser
 * (IndexedDB) can later be swapped for, or synced with, a server without touching
 * the screens or the ledger maths.
 *
 * Rules every implementation must keep:
 * - `saveDay` and `replaceAll` are all-or-nothing.
 * - `saveDay` replaces every movement and balance of that date.
 */
export interface LedgerRepository {
  loadAll(): Promise<StoredState>;

  putSettings(settings: Settings): Promise<void>;
  putNotes(notes: Note[]): Promise<void>;
  putSkus(skus: Sku[]): Promise<void>;
  putBrands(brands: Brand[]): Promise<void>;

  /** A draft (or any form) without touching the derived records. */
  putSheet(sheet: DailySheet): Promise<void>;
  /** A saved form together with the records rebuilt from it. */
  saveDay(sheet: DailySheet, derived: DerivedDay): Promise<void>;

  putInward(inward: Inward): Promise<void>;
  deleteInward(id: string): Promise<void>;

  /** Price history: add or replace changes, remove some by id. */
  putPrices(changes: PriceChange[]): Promise<void>;
  deletePrices(ids: string[]): Promise<void>;

  /** Wipe and load a whole data set (restore, import, erase). */
  replaceAll(data: LedgerData, derived: DerivedDay[]): Promise<void>;

  /** Safety copy kept before a restore, import or erase. */
  getSafetyCopy(): Promise<unknown | undefined>;
  putSafetyCopy(value: unknown): Promise<void>;
  clearSafetyCopy(): Promise<void>;

  /** Ask that the stored data is not cleared automatically. Returns whether it is kept. */
  requestPersistence(): Promise<boolean>;
}

export const LEDGER_REPOSITORY = new InjectionToken<LedgerRepository>('LedgerRepository');
