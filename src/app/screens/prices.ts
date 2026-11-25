import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { fmtDay, todayIso } from '../core/dates';
import { group, parseCount, uid } from '../core/format';
import { I18n } from '../core/i18n';
import { PriceChange } from '../core/model';
import { LedgerStore } from '../core/store';
import { Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

/**
 * A price list from a date: shows every brand's price on that date and lets you type new ones.
 * Only the brands you change get a price change. Use it for a new rate card, or before entering old days.
 */
@Component({
  selector: 'app-prices',
  imports: [Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head">
        <a class="btn icon quiet" routerLink="/settings" [attr.aria-label]="i.t('settings')"><app-icon name="left" /></a>
        <div class="grow"><h1>{{ i.pick('Price list', 'ధరల జాబితా') }}</h1><div class="sub">{{ i.pick('New prices from a date', 'ఒక తేదీ నుంచి కొత్త ధరలు') }}</div></div>
      </header>

      <section class="card">
        <label class="field"><span class="label">{{ i.pick('Prices from', 'ధరలు ఈ తేదీ నుంచి') }}</span><input class="input" type="date" [value]="from()" (change)="setFrom($any($event.target).value)" /></label>
        <div class="cap">{{ i.pick('Each box shows the price on that date. Type only the ones that change. Days from this date, saved ones included, will use the new prices.', 'ప్రతి బాక్స్‌లో ఆ తేదీ ధర ఉంది. మారిన వాటినే రాయండి. ఈ తేదీ నుంచి రోజులన్నీ కొత్త ధరలు వాడతాయి.') }}</div>
        <input class="input" [placeholder]="i.t('searchBrand')" [value]="q()" (input)="q.set($any($event.target).value)" />
      </section>

      <section class="card" style="padding: 4px 16px 8px; gap: 0">
        <div class="cap" style="display: grid; grid-template-columns: minmax(0, 1fr) 84px 84px; gap: 8px; padding: 8px 0"><span>{{ fmtDay(from(), true) }}</span><span style="text-align: right">{{ i.t('sellRate') }}</span><span style="text-align: right">{{ i.t('buyCost') }}</span></div>
        @for (r of rows(); track r.id) {
          <div style="display: grid; grid-template-columns: minmax(0, 1fr) 84px 84px; gap: 8px; align-items: center; padding: 6px 0; border-top: 1px solid var(--rule)" [style.background]="r.changed ? 'var(--gold-tint)' : null">
            <span class="small"><b>{{ r.name }}</b> <span class="chip">{{ r.size }}</span></span>
            <input class="input n" style="padding: 0 10px" inputmode="numeric" [value]="r.rate" (input)="edit(r.id, 'rate', $any($event.target).value)" [attr.aria-label]="i.t('sellRate') + ' ' + r.name + ' ' + r.size" />
            <input class="input n" style="padding: 0 10px" inputmode="numeric" [value]="r.cost" (input)="edit(r.id, 'cost', $any($event.target).value)" [attr.aria-label]="i.t('buyCost') + ' ' + r.name + ' ' + r.size" />
          </div>
        }
      </section>

      <div class="fab-bar">
        <button class="btn primary" type="button" [disabled]="!changes().length" (click)="save()">
          {{ changes().length ? i.pick('Save ' + changes().length + ' price changes from ' + fmtDay(from()), fmtDay(from()) + ' నుంచి ' + changes().length + ' ధర మార్పులు సేవ్') : i.pick('No changes yet', 'మార్పులు లేవు') }}
        </button>
      </div>
    </main>
  `,
})
export class Prices {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private toast = inject(Toast);
  protected fmtDay = fmtDay;

  protected from = signal(todayIso());
  protected q = signal('');
  /** What was typed, per brand: rate and cost as entered. */
  private typed = signal<Record<string, { rate?: string; cost?: string }>>({});

  private base = computed(() => {
    const priceOf = this.store.priceOf(this.from());
    return [...this.store.skus()]
      .filter((s) => s.active)
      .sort((a, b) => (a.cat === b.cat ? a.sno - b.sno : a.cat === 'LIQUOR' ? -1 : 1))
      .map((s) => ({ sku: s, price: priceOf(s) }));
  });

  protected rows = computed(() => {
    const q = this.q().trim().toLowerCase();
    const t = this.typed();
    return this.base()
      .filter(({ sku }) => !q || `${sku.nameEn} ${sku.nameTe} ${sku.size}`.toLowerCase().includes(q))
      .map(({ sku, price }) => {
        const e = t[sku.id] ?? {};
        const rate = e.rate ?? (price.rate ? String(price.rate) : '');
        const cost = e.cost ?? (price.cost ? String(Math.round(price.cost)) : '');
        const changed = (e.rate != null && parseCount(e.rate) !== price.rate) || (e.cost != null && parseCount(e.cost) !== Math.round(price.cost));
        return { id: sku.id, name: this.i.name(sku), size: sku.size, rate, cost, changed };
      });
  });

  protected changes = computed<PriceChange[]>(() => {
    const t = this.typed();
    const at = new Date().toISOString();
    const out: PriceChange[] = [];
    for (const { sku, price } of this.base()) {
      const e = t[sku.id];
      if (!e) continue;
      const rate = e.rate != null && e.rate.trim() !== '' && parseCount(e.rate) !== price.rate ? parseCount(e.rate) : undefined;
      const cost = e.cost != null && e.cost.trim() !== '' && parseCount(e.cost) !== Math.round(price.cost) ? parseCount(e.cost) : undefined;
      if (rate != null || cost != null) out.push({ id: uid(), skuId: sku.id, from: this.from(), rate, cost, source: 'manual', at });
    }
    return out;
  });

  protected setFrom(d: string) {
    if (!d) return;
    this.from.set(d);
    this.typed.set({});
  }

  protected edit(id: string, k: 'rate' | 'cost', v: string) {
    this.typed.update((t) => ({ ...t, [id]: { ...t[id], [k]: v } }));
  }

  protected async save() {
    const list = this.changes();
    if (!list.length) return;
    await this.store.setPrices(list);
    this.typed.set({});
    this.toast.show(this.i.pick(`${list.length} prices saved from ${fmtDay(this.from())}`, `${fmtDay(this.from())} నుంచి ${list.length} ధరలు సేవ్ అయ్యాయి`));
  }

  protected group = group;
}
