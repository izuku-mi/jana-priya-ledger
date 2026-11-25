import { uid } from './format';
import { Brand, Cat, Kind, LedgerData, Sku } from './model';

/**
 * The catalogue as brands. Each item (a size of a brand, possibly of one type, e.g. Kingfisher Strong Q)
 * keeps its id; its name is worked out from brand + type and copied onto every day's form,
 * so renaming in the catalogue renames everywhere.
 */

export const KINDS: { v: Kind; en: string; te: string }[] = [
  { v: 'whisky', en: 'Whisky', te: 'విస్కీ' },
  { v: 'scotch', en: 'Scotch', te: 'స్కాచ్' },
  { v: 'brandy', en: 'Brandy', te: 'బ్రాందీ' },
  { v: 'rum', en: 'Rum', te: 'రమ్' },
  { v: 'vodka', en: 'Vodka', te: 'వోడ్కా' },
  { v: 'gin', en: 'Gin', te: 'జిన్' },
  { v: 'wine', en: 'Wine', te: 'వైన్' },
  { v: 'beer', en: 'Beer', te: 'బీర్' },
  { v: 'rtd', en: 'Breezer / ready to drink', te: 'బ్రీజర్' },
  { v: 'other', en: 'Other', te: 'ఇతర' },
];

export const SIZES = ['Q', 'P', 'N', 'D', 'Tin'];

/** A first guess at the liquor kind from the name; the user corrects it on the Catalogue screen. */
export function guessKind(name: string, cat: Cat): Kind {
  const n = name.toLowerCase();
  if (/breezer/.test(n)) return 'rtd';
  if (cat === 'BEER' || /beer/.test(n)) return 'beer';
  if (/wh?isk|wisky/.test(n)) return 'whisky';
  if (/brandy|vsop/.test(n)) return 'brandy';
  if (/\brum\b/.test(n)) return 'rum';
  if (/vod/.test(n)) return 'vodka';
  if (/\bgin\b/.test(n)) return 'gin';
  if (/wine/.test(n)) return 'wine';
  return 'other';
}

export const joinName = (brand: string, type: string | undefined) => [brand.trim(), (type ?? '').trim()].filter(Boolean).join(' ');

/** The item's display name, from its brand and type. */
export function nameOf(sku: Sku, brand: Brand | undefined) {
  if (!brand) return { nameEn: sku.nameEn, nameTe: sku.nameTe };
  return { nameEn: joinName(brand.nameEn, sku.typeEn), nameTe: joinName(brand.nameTe, sku.typeTe) };
}

/**
 * Data from before brands: every item gets a brand. Items with the same name (and category) share one,
 * so "Royal Stag Whisky" Q, P, N and D become one brand with four sizes. Nothing is renamed.
 */
export function withBrands(data: LedgerData): LedgerData {
  const brands = [...(data.brands ?? [])];
  const byId = new Map(brands.map((b) => [b.id, b]));
  const byName = new Map(brands.map((b) => [`${b.cat}|${b.nameEn.trim().toLowerCase()}`, b]));
  let changed = !data.brands;
  const skus = data.skus.map((s) => {
    if (s.brandId && byId.has(s.brandId) && s.kind) return s;
    changed = true;
    let brandId = s.brandId && byId.has(s.brandId) ? s.brandId : undefined;
    if (!brandId) {
      const key = `${s.cat}|${s.nameEn.trim().toLowerCase()}`;
      let b = byName.get(key);
      if (!b) {
        b = { id: 'G' + uid(), cat: s.cat, nameEn: s.nameEn.trim(), nameTe: s.nameTe.trim() };
        brands.push(b);
        byName.set(key, b);
        byId.set(b.id, b);
      }
      brandId = b.id;
    }
    return { ...s, brandId, typeEn: s.typeEn ?? '', typeTe: s.typeTe ?? '', kind: s.kind ?? guessKind(s.nameEn, s.cat) };
  });
  return changed ? { ...data, brands, skus } : data;
}

/**
 * Work out every item's name, size and category from its brand, and copy them onto every day's form.
 * Call after any catalogue change.
 */
export function syncNames(data: LedgerData): LedgerData {
  const brands = new Map((data.brands ?? []).map((b) => [b.id, b]));
  const skus = data.skus.map((s) => {
    const b = s.brandId ? brands.get(s.brandId) : undefined;
    return { ...s, ...nameOf(s, b), cat: b?.cat ?? s.cat };
  });
  const byId = new Map(skus.map((s) => [s.id, s]));
  const sheets = data.sheets.map((sh) => {
    let touched = false;
    const rows = { ...sh.rows };
    for (const [id, r] of Object.entries(rows)) {
      const s = byId.get(id);
      if (s && (r.nameEn !== s.nameEn || r.nameTe !== s.nameTe || r.size !== s.size || r.cat !== s.cat)) {
        rows[id] = { ...r, nameEn: s.nameEn, nameTe: s.nameTe, size: s.size, cat: s.cat };
        touched = true;
      }
    }
    return touched ? { ...sh, rows } : sh;
  });
  return { ...data, skus, sheets };
}

export function updateBrand(data: LedgerData, id: string, patch: Partial<Omit<Brand, 'id'>>): LedgerData {
  return syncNames({ ...data, brands: (data.brands ?? []).map((b) => (b.id === id ? { ...b, ...patch } : b)) });
}

export function updateSku(data: LedgerData, id: string, patch: Partial<Pick<Sku, 'typeEn' | 'typeTe' | 'size' | 'kind'>>): LedgerData {
  return syncNames({ ...data, skus: data.skus.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
}

export function setArchived(data: LedgerData, ids: string[], archived: boolean): LedgerData {
  const set = new Set(ids);
  return { ...data, skus: data.skus.map((s) => (set.has(s.id) ? { ...s, active: !archived } : s)) };
}

const dropEmptyBrands = (data: LedgerData): LedgerData => {
  const used = new Set(data.skus.map((s) => s.brandId));
  return { ...data, brands: (data.brands ?? []).filter((b) => used.has(b.id)) };
};

/**
 * Move items under another brand (an existing one, or a new one by name). An item coming from a
 * different brand keeps its old full name as its type, so nothing is lost; the user then shortens it,
 * e.g. "K.F. Strong" under Kingfisher becomes type "Strong".
 */
export function moveToBrand(data: LedgerData, ids: string[], target: { id: string } | { nameEn: string; nameTe: string; cat: Cat }): LedgerData {
  let brands = [...(data.brands ?? [])];
  let brand: Brand | undefined;
  if ('id' in target) brand = brands.find((b) => b.id === target.id);
  else {
    brand = { id: 'G' + uid(), cat: target.cat, nameEn: target.nameEn.trim(), nameTe: (target.nameTe || target.nameEn).trim() };
    brands = [...brands, brand];
  }
  if (!brand) throw new Error('No such brand');
  const set = new Set(ids);
  const skus = data.skus.map((s) => {
    if (!set.has(s.id) || s.brandId === brand!.id) return s;
    const target = brand!.nameEn.trim().toLowerCase();
    const same = [s.nameEn, s.typeEn ?? ''].some((n) => n.trim().toLowerCase() === target);
    return { ...s, brandId: brand!.id, typeEn: same ? '' : s.nameEn, typeTe: same ? '' : s.nameTe };
  });
  return syncNames(dropEmptyBrands({ ...data, brands, skus }));
}

/** A new item: under an existing brand, or a new brand. It goes to the end of its category on the forms. */
export function addItem(
  data: LedgerData,
  brand: { id: string } | { nameEn: string; nameTe: string; cat: Cat },
  item: { typeEn: string; typeTe: string; size: string; kind: Kind; rate: number; cost: number },
): { data: LedgerData; sku: Sku } {
  let brands = [...(data.brands ?? [])];
  let b: Brand | undefined;
  if ('id' in brand) b = brands.find((x) => x.id === brand.id);
  else {
    b = { id: 'G' + uid(), cat: brand.cat, nameEn: brand.nameEn.trim(), nameTe: (brand.nameTe || brand.nameEn).trim() };
    brands = [...brands, b];
  }
  if (!b) throw new Error('No such brand');
  const sno = Math.max(0, ...data.skus.filter((s) => s.cat === b!.cat).map((s) => s.sno)) + 1;
  const base: Sku = {
    id: 'S' + uid(), cat: b.cat, sno, brandId: b.id, typeEn: item.typeEn.trim(), typeTe: (item.typeTe || item.typeEn).trim(),
    kind: item.kind, size: item.size, rate: item.rate, cost: item.cost, active: true, nameEn: '', nameTe: '',
  };
  const sku = { ...base, ...nameOf(base, b) };
  return { data: { ...data, brands, skus: [...data.skus, sku] }, sku };
}

/**
 * Delete items everywhere: the catalogue, every day's form, deliveries and price history.
 * Saved days are worked out again, so past sales and cash change.
 */
export function deleteItems(data: LedgerData, ids: string[]): LedgerData {
  const set = new Set(ids);
  const inwards = data.inwards
    .map((w) => ({ ...w, lines: w.lines.filter((l) => !set.has(l.skuId)) }))
    .filter((w) => w.lines.length);
  const keptInwards = new Set(inwards.map((w) => w.id));
  return dropEmptyBrands({
    ...data,
    skus: data.skus.filter((s) => !set.has(s.id)),
    sheets: data.sheets.map((sh) => {
      if (!ids.some((id) => sh.rows[id])) return sh;
      const rows = { ...sh.rows };
      for (const id of ids) delete rows[id];
      return { ...sh, rows };
    }),
    inwards,
    prices: data.prices?.filter((p) => !set.has(p.skuId) && (!p.inwardId || keptInwards.has(p.inwardId))),
  });
}

/** Where an item is used: how many days' forms carry it with any stock or movement. */
export function usage(data: Pick<LedgerData, 'sheets' | 'inwards'>, ids: string[]) {
  const set = new Set(ids);
  let days = 0;
  for (const sh of data.sheets) if (Object.values(sh.rows).some((r) => set.has(r.skuId) && (r.o || r.r || r.i || r.c))) days++;
  const deliveries = data.inwards.filter((w) => w.lines.some((l) => set.has(l.skuId))).length;
  return { days, deliveries };
}
