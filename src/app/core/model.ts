export type Cat = 'LIQUOR' | 'BEER';
export type Lang = 'te' | 'en';

/** A brand + size in the catalog. `cost` is the weighted-average buy cost per bottle. */
export interface Sku {
  id: string;
  cat: Cat;
  sno: number;
  nameEn: string;
  nameTe: string;
  size: string;
  rate: number;
  cost: number;
  active: boolean;
}

/** One brand's line on a day's form, exactly as entered. Name and prices are snapshots. */
export interface SheetRow {
  skuId: string;
  cat: Cat;
  sno: number;
  nameEn: string;
  nameTe: string;
  size: string;
  o: number;
  r: number;
  i: number;
  c: number;
  /** false: closing follows opening + receipts − issues until the user types in it. */
  cEdited: boolean;
  /** Receipts come from inward stock entries for this date. */
  rFromInward: boolean;
  issueReason: string;
  rate: number;
  cost: number;
}

export type ExpenseType = 'shop' | 'person' | 'deposit' | 'misc';

export interface Expense {
  id: string;
  label: string;
  amount: number;
  type: ExpenseType;
}

export interface Note {
  id: string;
  text: string;
  at: string;
}

export type SheetStatus = 'draft' | 'saved';

/** The day's form as entered. Source of truth; derived tables are rebuilt from it on Save. */
export interface DailySheet {
  date: string;
  status: SheetStatus;
  rows: Record<string, SheetRow>;
  expenses: Expense[];
  upi: number;
  other: number;
  /** null = not counted. Never confused with ₹0. */
  cashCounted: number | null;
  /** Shop was closed: saved with no sales, stock carried forward. */
  closed: boolean;
  notes: Note[];
  preparedBy: string;
  savedAt: string | null;
  updatedAt: string;
}

export type MovementType = 'RECEIPT' | 'SALE' | 'ISSUE';

export interface Movement {
  id?: number;
  date: string;
  skuId: string;
  type: MovementType;
  qty: number;
  unitPrice: number;
  unitCost: number;
  reason: string;
}

export interface Balance {
  key: string;
  date: string;
  skuId: string;
  closing: number;
}

export interface CashDay {
  date: string;
  liquor: number;
  beer: number;
  gross: number;
  units: number;
  upi: number;
  other: number;
  shopExp: number;
  miscExp: number;
  paidPeople: number;
  deposits: number;
  expensesAll: number;
  expected: number;
  counted: number | null;
  cogs: number;
  damages: number;
  costKnown: boolean;
}

export interface InwardLine {
  skuId: string;
  qty: number;
  cost: number;
}

export interface Charge {
  id: string;
  label: string;
  amount: number;
}

export interface Inward {
  id: string;
  date: string;
  supplier: string;
  invoiceNo: string;
  invoiceTotal: number | null;
  lines: InwardLine[];
  charges: Charge[];
  notes: Note[];
  savedAt: string;
}

export interface Settings {
  lang: Lang;
  dark: boolean;
  shopName: string;
  /** 0 = January … 3 = April (Indian financial year). */
  yearStartMonth: number;
  /** 0 = Sunday, 1 = Monday. */
  weekStart: number;
  lastBackupAt: string | null;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'te',
  dark: false,
  shopName: 'Jana Priya Wines',
  yearStartMonth: 0,
  weekStart: 1,
  lastBackupAt: null,
};

/** Everything people entered. Movements, balances and cash days are rebuilt from it. */
export interface LedgerData {
  settings: Settings;
  skus: Sku[];
  sheets: DailySheet[];
  inwards: Inward[];
  notes?: Note[];
}

export type AlertLevel = 'critical' | 'warn';

export interface Alert {
  level: AlertLevel;
  title: string;
  body: string;
}
