import { addItem, deleteItems, guessKind, moveToBrand, setArchived, updateBrand, updateSku, usage, withBrands } from './catalog';
import { seedCatalog } from './catalog-seed';
import { newSheet } from './ledger';
import { DEFAULT_SETTINGS, LedgerData } from './model';

function data(): LedgerData {
  const skus = seedCatalog();
  const sheet = newSheet('2026-11-01', null, skus);
  sheet.rows['L54'] = { ...sheet.rows['L54'], o: 100, c: 80, cEdited: true };
  sheet.rows['B1'] = { ...sheet.rows['B1'], o: 24, c: 20, cEdited: true };
  return withBrands({
    settings: DEFAULT_SETTINGS, skus, sheets: [sheet], notes: [],
    inwards: [{ id: 'w1', date: '2026-11-01', supplier: '', invoiceNo: '', invoiceTotal: null, notes: [], savedAt: '', charges: [], lines: [{ skuId: 'L54', qty: 10, cost: 90 }, { skuId: 'L10', qty: 5, cost: 700 }] }],
    prices: [{ id: 'p1', skuId: 'L54', from: '2026-11-01', rate: 110, source: 'form', at: '' }],
  });
}

const sku = (d: LedgerData, id: string) => d.skus.find((s) => s.id === id)!;
const brandOf = (d: LedgerData, id: string) => d.brands!.find((b) => b.id === sku(d, id).brandId)!;

describe('catalogue', () => {
  it('groups items with the same name under one brand, without renaming', () => {
    const d = data();
    expect(new Set(['L10', 'L11', 'L12', 'L62'].map((id) => sku(d, id).brandId)).size).toBe(1);
    expect(brandOf(d, 'L10').nameEn).toBe('Royal Stag Whisky');
    expect(sku(d, 'L10').nameEn).toBe('Royal Stag Whisky');
    expect(sku(d, 'B1').brandId).not.toBe(sku(d, 'B3').brandId);
    expect(withBrands(d)).toBe(d);
  });

  it('guesses the kind from the name', () => {
    expect([guessKind('OT Wisky', 'LIQUOR'), guessKind('Magic M. VODAKA', 'LIQUOR'), guessKind('M C XXX Rum', 'LIQUOR'), guessKind('K.F. Strong', 'BEER'), guessKind('Bacardi Breezer', 'BEER'), guessKind('Cheep', 'LIQUOR')])
      .toEqual(['whisky', 'vodka', 'rum', 'beer', 'rtd', 'other']);
  });

  it('renaming a brand renames its items and every day’s form', () => {
    let d = data();
    d = updateBrand(d, sku(d, 'L54').brandId!, { nameEn: 'Cheap', nameTe: 'చీప్' });
    expect(sku(d, 'L54').nameEn).toBe('Cheap');
    expect(d.sheets[0].rows['L54'].nameEn).toBe('Cheap');
    expect(d.sheets[0].rows['L54'].c).toBe(80);
  });

  it('moving items under a brand keeps their old name as the type, which can then be shortened', () => {
    let d = data();
    d = moveToBrand(d, ['B1', 'B3'], { nameEn: 'Kingfisher', nameTe: 'కింగ్‌ఫిషర్', cat: 'BEER' });
    expect(sku(d, 'B1').brandId).toBe(sku(d, 'B3').brandId);
    expect(sku(d, 'B1').nameEn).toBe('Kingfisher K.F. Strong');
    d = updateSku(d, 'B1', { typeEn: 'Strong' });
    expect([sku(d, 'B1').nameEn, d.sheets[0].rows['B1'].nameEn]).toEqual(['Kingfisher Strong', 'Kingfisher Strong']);
    // The old one-item brands are gone.
    expect(d.brands!.some((b) => b.nameEn === 'K.F. Strong' || b.nameEn === 'K.F.Ultra')).toBe(false);

    // Moving an item out to a brand named as its type leaves the type blank.
    d = moveToBrand(d, ['B3'], { nameEn: 'K.F.Ultra', nameTe: '', cat: 'BEER' });
    expect(sku(d, 'B3').nameEn).toBe('K.F.Ultra');
  });

  it('adds an item to an existing brand at the end of its category', () => {
    const d0 = data();
    const { data: d, sku: s } = addItem(d0, { id: sku(d0, 'L54').brandId! }, { typeEn: '', typeTe: '', size: 'Q', kind: 'other', rate: 400, cost: 0 });
    expect([s.nameEn, s.size, s.cat, s.sno]).toEqual(['Cheep', 'Q', 'LIQUOR', 67]);
    expect(d.skus.length).toBe(d0.skus.length + 1);
  });

  it('archive hides an item and can be undone', () => {
    let d = setArchived(data(), ['L54'], true);
    expect(sku(d, 'L54').active).toBe(false);
    d = setArchived(d, ['L54'], false);
    expect(sku(d, 'L54').active).toBe(true);
  });

  it('delete removes an item from forms, deliveries and prices', () => {
    const d0 = data();
    expect(usage(d0, ['L54'])).toEqual({ days: 1, deliveries: 1 });
    const d = deleteItems(d0, ['L54']);
    expect(d.skus.some((s) => s.id === 'L54')).toBe(false);
    expect(d.sheets[0].rows['L54']).toBeUndefined();
    expect(d.inwards[0].lines.map((l) => l.skuId)).toEqual(['L10']);
    expect(d.prices).toEqual([]);
    expect(d.brands!.some((b) => b.nameEn === 'Cheep')).toBe(false);
  });
});
