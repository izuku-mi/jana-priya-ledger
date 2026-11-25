import Dexie, { Table } from 'dexie';
import { Balance, Brand, CashDay, DailySheet, Inward, Movement, PriceChange, Sku } from './model';
import { pricesFromSheets } from './pricing';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Everything lives in this browser's IndexedDB.
 * `sheets`, `inwards`, `skus`, `prices` and `meta` are entered data; `movements`, `balances` and
 * `cashDays` are rebuilt from the sheets on every Save and on restore.
 */
export class LedgerDb extends Dexie {
  skus!: Table<Sku, string>;
  brands!: Table<Brand, string>;
  sheets!: Table<DailySheet, string>;
  inwards!: Table<Inward, string>;
  movements!: Table<Movement, number>;
  balances!: Table<Balance, string>;
  cashDays!: Table<CashDay, string>;
  prices!: Table<PriceChange, string>;
  meta!: Table<MetaRow, string>;

  constructor(name = 'jana-priya-ledger') {
    super(name);
    this.version(1).stores({
      skus: 'id, cat',
      sheets: 'date, status',
      inwards: 'id, date',
      movements: '++id, date, skuId, type, [date+skuId]',
      balances: 'key, date, skuId',
      cashDays: 'date',
      meta: 'key',
    });
    // v2: prices by date. Existing days already carry their prices, so the history is rebuilt from them.
    this.version(2)
      .stores({ prices: 'id, skuId, from' })
      .upgrade(async (tx) => {
        const sheets = await tx.table<DailySheet, string>('sheets').toArray();
        await tx.table<PriceChange, string>('prices').bulkPut(pricesFromSheets(sheets));
      });
    // v3: brands. Items are grouped under brands when the app next starts (catalog.ts withBrands).
    this.version(3).stores({ brands: 'id, cat' });
  }
}
