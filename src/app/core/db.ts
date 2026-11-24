import Dexie, { Table } from 'dexie';
import { Balance, CashDay, DailySheet, Inward, Movement, Sku } from './model';

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * Everything lives in this browser's IndexedDB.
 * `sheets`, `inwards`, `skus` and `meta` are entered data; `movements`, `balances` and `cashDays`
 * are rebuilt from the sheets on every Save and on restore.
 */
export class LedgerDb extends Dexie {
  skus!: Table<Sku, string>;
  sheets!: Table<DailySheet, string>;
  inwards!: Table<Inward, string>;
  movements!: Table<Movement, number>;
  balances!: Table<Balance, string>;
  cashDays!: Table<CashDay, string>;
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
  }
}
