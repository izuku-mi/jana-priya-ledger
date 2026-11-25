import { DailySheet, PriceChange, Sku } from './model';

export interface Price {
  rate: number;
  cost: number;
}

/** Changes per brand, oldest first (same date: the later entry wins). */
export function priceIndex(changes: PriceChange[]): Map<string, PriceChange[]> {
  const m = new Map<string, PriceChange[]>();
  for (const c of changes) (m.get(c.skuId) ?? m.set(c.skuId, []).get(c.skuId)!).push(c);
  for (const list of m.values()) list.sort((a, b) => a.from.localeCompare(b.from) || a.at.localeCompare(b.at));
  return m;
}

/**
 * A brand's sell rate and buy cost on a date: the latest change on or before that date.
 * Before its first recorded change, the catalog price is the default.
 */
export function priceOn(sku: Pick<Sku, 'id' | 'rate' | 'cost'>, date: string, index: Map<string, PriceChange[]>): Price {
  const list = index.get(sku.id) ?? [];
  const pick = (k: 'rate' | 'cost') => {
    let value: number | undefined;
    for (const c of list) {
      const v = c[k];
      if (v != null && c.from <= date) value = v;
    }
    return value ?? sku[k];
  };
  return { rate: pick('rate'), cost: pick('cost') };
}

/** Put the prices of the form's date on every row. Returns null when nothing changed. */
export function repriceSheet(sheet: DailySheet, index: Map<string, PriceChange[]>, skus: Map<string, Sku>): DailySheet | null {
  let changed = false;
  const rows = { ...sheet.rows };
  for (const [id, r] of Object.entries(rows)) {
    const p = priceOn(skus.get(id) ?? { id, rate: r.rate, cost: r.cost }, sheet.date, index);
    if (p.rate !== r.rate || p.cost !== r.cost) {
      rows[id] = { ...r, rate: p.rate, cost: p.cost };
      changed = true;
    }
  }
  return changed ? { ...sheet, rows } : null;
}

/**
 * Rebuild a price history from forms that already carry prices (old app data, old backups):
 * a change on the first day each brand appears and on every day its price differs from before.
 */
export function pricesFromSheets(sheets: DailySheet[], at = new Date().toISOString()): PriceChange[] {
  const out: PriceChange[] = [];
  const last = new Map<string, { rate: number; cost: number }>();
  for (const s of [...sheets].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const r of Object.values(s.rows)) {
      if (!(r.o || r.r || r.i || r.c)) continue;
      const prev = last.get(r.skuId);
      const rate = !prev || prev.rate !== r.rate ? r.rate : undefined;
      const cost = (!prev || prev.cost !== r.cost) && r.cost > 0 ? r.cost : undefined;
      if (rate != null || cost != null) {
        out.push({ id: `imp-${r.skuId}-${s.date}`, skuId: r.skuId, from: s.date, rate, cost, source: 'import', at });
      }
      last.set(r.skuId, { rate: r.rate, cost: r.cost });
    }
  }
  return out;
}

/**
 * Add changes to a history. A change for the same brand and date is merged into the existing one,
 * so typing a new rate twice on the same day keeps one entry.
 */
export function mergePriceChanges(history: PriceChange[], add: PriceChange[]): PriceChange[] {
  const out = [...history];
  for (const c of add) {
    const k = out.findIndex((x) => x.skuId === c.skuId && x.from === c.from && x.source !== 'inward' && c.source !== 'inward');
    if (k >= 0) out[k] = { ...out[k], ...Object.fromEntries(Object.entries(c).filter(([, v]) => v !== undefined)), id: out[k].id };
    else out.push(c);
  }
  return out;
}
