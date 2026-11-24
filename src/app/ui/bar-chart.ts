import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Bar } from '../core/analytics';
import { inr, short } from '../core/format';
import { I18n } from '../core/i18n';

/** Stacked liquor/beer bars in plain HTML (no chart library). Best bar in gold; days not entered are dashed. */
@Component({
  selector: 'app-bar-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="row" style="gap: 16px">
      <span class="cap row" style="gap: 4px"><span class="key" style="background: var(--wine)"></span>{{ i.t('liquor') }}</span>
      <span class="cap row" style="gap: 4px"><span class="key" style="background: var(--wine-soft)"></span>{{ i.t('beer') }}</span>
      <span class="cap row" style="gap: 4px"><span class="key" style="background: var(--gold)"></span>{{ i.t('bestDay') }}</span>
    </div>
    <div class="plot" role="img" [attr.aria-label]="aria()" [style.gap]="gap()">
      @for (b of view(); track $index) {
        <div class="col">
          @if (!dense()) { <div class="top num">{{ b.top }}</div> }
          <div [style.height.px]="b.beerH" [style.background]="b.best ? 'var(--gold)' : 'var(--wine-soft)'" class="seg-top"></div>
          <div [style.height.px]="b.liqH" [style.background]="b.best ? 'var(--gold)' : 'var(--wine)'" [class.seg-top]="!b.beerH"></div>
          @if (!b.entered) { <div class="ghost" [style.height.px]="b.future ? 6 : 18"></div> }
        </div>
      }
    </div>
    <div class="labels" [style.gap]="gap()">
      @for (b of view(); track $index) { <div class="cap lab">{{ b.label }}</div> }
    </div>
  `,
  styles: `
    :host { display: flex; flex-direction: column; gap: 8px; }
    .key { width: 12px; height: 12px; border-radius: 3px; display: inline-block; }
    .plot { height: 168px; display: flex; align-items: flex-end; border-bottom: 1px solid var(--rule); padding: 0 2px; }
    .col { flex: 1; min-width: 0; height: 100%; display: flex; flex-direction: column; justify-content: flex-end; }
    .top { text-align: center; font-size: 12px; line-height: 16px; }
    .seg-top { border-radius: 6px 6px 0 0; }
    .ghost { border: 1px dashed var(--border-strong); border-bottom: 0; border-radius: 6px 6px 0 0; }
    .labels { display: flex; padding: 0 2px; }
    .lab { flex: 1; min-width: 0; text-align: center; white-space: pre-line; line-height: 16px; }
  `,
})
export class BarChart {
  protected i = inject(I18n);
  readonly bars = input<Bar[]>([]);
  protected dense = computed(() => this.bars().length > 12);
  protected gap = computed(() => (this.dense() ? '2px' : '8px'));
  protected view = computed(() => {
    const max = Math.max(1, ...this.bars().map((b) => b.total));
    const best = Math.max(...this.bars().map((b) => b.total));
    return this.bars().map((b) => ({
      ...b,
      top: short(b.total),
      liqH: Math.round((Math.max(0, b.liquor) / max) * 140),
      beerH: Math.round((Math.max(0, b.beer) / max) * 140),
      best: b.total > 0 && b.total === best,
    }));
  });
  protected aria = computed(() => this.bars().map((b) => `${b.label.replace('\n', ' ')}: ${inr(b.total)}`).join('; '));
}
