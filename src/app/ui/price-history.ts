import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { fmtDay, todayIso } from '../core/dates';
import { group, parseCount, uid } from '../core/format';
import { I18n } from '../core/i18n';
import { Sku } from '../core/model';
import { LedgerStore } from '../core/store';
import { Icon } from './icon';

/** One brand's prices over time, with a form to add a change from any date (past dates too). */
@Component({
  selector: 'app-price-history',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div style="display: flex; flex-direction: column; gap: 8px; padding: 8px 0 4px">
      @for (p of history(); track p.id) {
        <div class="ln small">
          <span>{{ i.pick('From', 'నుంచి') }} <b>{{ fmtDay(p.from, true) }}</b> <span class="cap">· {{ sourceName(p.source) }}</span></span>
          <span class="row" style="gap: 6px">
            <span class="num">{{ p.rate != null ? '₹' + group(p.rate) : '–' }} / {{ p.cost != null ? '₹' + group(p.cost) : '–' }}</span>
            @if (p.source !== 'inward') {
              <button type="button" class="btn quiet icon danger" style="min-height: 32px; height: 32px; width: 32px" (click)="remove(p.id)" [attr.aria-label]="i.t('delete')"><app-icon name="close" [size]="16" /></button>
            }
          </span>
        </div>
      } @empty {
        <div class="cap">{{ i.pick('No price changes yet. The catalog price is used for every day.', 'ధర మార్పులు లేవు. ప్రతి రోజుకు కేటలాగ్ ధర వాడుతారు.') }}</div>
      }
      <div class="cap">{{ i.pick('Catalog (before any change)', 'కేటలాగ్ (మార్పుకు ముందు)') }}: ₹{{ group(sku().rate) }} / ₹{{ group(sku().cost) }}</div>
      <form class="row" style="flex-wrap: wrap; align-items: flex-end" (submit)="$event.preventDefault(); add()">
        <label class="field" style="flex: 1 1 140px"><span class="cap">{{ i.pick('From date', 'తేదీ నుంచి') }}</span><input class="input" type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
        <label class="field" style="flex: 1 1 80px"><span class="cap">{{ i.t('sellRate') }}</span><input class="input n" inputmode="numeric" [value]="rate()" (input)="rate.set($any($event.target).value)" placeholder="–" /></label>
        <label class="field" style="flex: 1 1 80px"><span class="cap">{{ i.t('buyCost') }}</span><input class="input n" inputmode="numeric" [value]="cost()" (input)="cost.set($any($event.target).value)" placeholder="–" /></label>
        <button class="btn" type="submit" [disabled]="!rate().trim() && !cost().trim()">{{ i.pick('Add change', 'మార్పు జోడించు') }}</button>
      </form>
      <div class="cap">{{ i.pick('Days from that date use the new price, saved days included. Leave sell or buy empty to keep it.', 'ఆ తేదీ నుంచి కొత్త ధర వర్తిస్తుంది, సేవ్ చేసిన రోజులకు కూడా. ఖాళీగా వదిలితే పాత ధర ఉంటుంది.') }}</div>
    </div>
  `,
})
export class PriceHistory {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  protected fmtDay = fmtDay;
  protected group = group;

  readonly sku = input.required<Sku>();
  protected history = computed(() => [...(this.store.priceIdx().get(this.sku().id) ?? [])].reverse());
  protected from = signal(todayIso());
  protected rate = signal('');
  protected cost = signal('');

  protected sourceName(s: string) {
    return ({
      manual: this.i.pick('typed', 'నమోదు'),
      form: this.i.pick('from a day\'s form', 'రోజువారీ ఫారమ్'),
      inward: this.i.pick('delivery cost', 'సరుకు రాక ధర'),
      import: this.i.pick('imported', 'దిగుమతి'),
    } as Record<string, string>)[s] ?? s;
  }

  protected async add() {
    const rate = this.rate().trim() ? parseCount(this.rate()) : undefined;
    const cost = this.cost().trim() ? parseCount(this.cost()) : undefined;
    if (rate == null && cost == null) return;
    await this.store.setPrices([{ id: uid(), skuId: this.sku().id, from: this.from(), rate, cost, source: 'manual', at: new Date().toISOString() }]);
    this.rate.set('');
    this.cost.set('');
  }

  protected remove(id: string) {
    this.store.removePrices([id]);
  }
}
