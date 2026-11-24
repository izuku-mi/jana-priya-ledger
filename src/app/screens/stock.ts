import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Alerts } from '../core/alerts';
import { brandSales, coverOf, soldGrid, stockFlow } from '../core/analytics';
import { addDays, dayShort, fmtShort, PeriodKind, periodOf, todayIso } from '../core/dates';
import { group, inr } from '../core/format';
import { I18n } from '../core/i18n';
import { LedgerStore } from '../core/store';
import { AlertsPanel } from '../ui/alerts-panel';

@Component({
  selector: 'app-stock',
  imports: [AlertsPanel],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head">
        <div class="grow"><h1>{{ i.t('stockMovement') }}</h1><div class="sub">{{ rangeLabel() }}</div></div>
      </header>

      <div class="seg" role="tablist" aria-label="Period">
        @for (k of kinds; track k) {
          <button type="button" role="tab" [class.on]="kind() === k" [attr.aria-selected]="kind() === k" (click)="kind.set(k)">{{ i.t(k) }}</button>
        }
      </div>

      <app-alerts [alerts]="alerts()" [notes]="store.notes()" (add)="store.addNote($event)" (remove)="store.removeNote($event)" />

      @if (!dates().length) {
        <div class="cap">{{ i.pick('No saved days in this period.', 'ఈ కాలంలో సేవ్ చేసిన రోజులు లేవు.') }}</div>
      } @else {
        <section class="card">
          <h2 class="title">{{ i.t('whereWent') }}</h2>
          <div role="img" [attr.aria-label]="flowAria()" style="display: flex; flex-direction: column; gap: 8px">
            <div class="cap">{{ i.pick('In', 'లోపలికి') }} · {{ group(flow().opening + flow().received) }}</div>
            <div class="flow">
              <div [style.width.%]="pct(flow().opening)" style="background: var(--surface-sunk)">{{ i.t('opening') }} {{ group(flow().opening) }}</div>
              <div [style.width.%]="pct(flow().received)" style="background: var(--wine-soft); color: var(--ink)">+ {{ i.t('received') }} {{ group(flow().received) }}</div>
            </div>
            <div class="cap">{{ i.pick('Out', 'బయటకు') }} · {{ group(flow().sold + flow().issued + flow().closing) }}</div>
            <div class="flow">
              <div [style.width.%]="pct(flow().sold)" style="background: var(--wine); color: var(--on-wine)">{{ i.t('sold') }} {{ group(flow().sold) }}</div>
              @if (flow().issued) { <div [style.width.%]="pct(flow().issued)" style="background: var(--critical); color: var(--on-wine)">{{ group(flow().issued) }}</div> }
              <div [style.width.%]="pct(flow().closing)" style="background: var(--wine-tint)">{{ i.t('closing') }} {{ group(flow().closing) }}</div>
            </div>
          </div>
          <div class="row-between small" style="border-top: 1px solid var(--rule); padding-top: 8px"><span>{{ i.t('damaged') }}</span><span class="num label">{{ group(flow().issued) }}</span></div>
        </section>

        <section class="card">
          <div class="row-between"><h2 class="title">{{ i.t('closingByDay') }}</h2><span class="cap">{{ i.t('bottles') }}</span></div>
          <div role="img" [attr.aria-label]="i.t('closingByDay')" class="cols">
            @for (c of closings(); track c.date) {
              <div class="col"><span class="cap num" style="text-align: center; color: var(--ink)">{{ short(c.total) }}</span><div [style.height.px]="c.h" style="background: var(--wine); border-radius: 6px 6px 0 0"></div></div>
            }
          </div>
          <div class="cols-l">
            @for (c of closings(); track c.date) {
              <div class="cap" style="flex: 1; text-align: center; line-height: 16px">{{ c.label }}@if (c.received) {<br /><b style="color: var(--success)">+{{ short(c.received) }}</b>}</div>
            }
          </div>
        </section>

        <section class="card tight">
          <div class="row-between"><h2 class="title">{{ i.t('runsOut') }}</h2><span class="cap">{{ i.t('daysLeft') }}</span></div>
          @for (c of cover(); track c.skuId) {
            <div style="display: grid; grid-template-columns: 132px minmax(0, 1fr) 56px; gap: 8px; align-items: center" class="small">
              <span><b class="label">{{ c.name }}</b><br /><span class="cap">{{ group(c.closing) }} {{ i.t('left') }}</span></span>
              <div class="bar-track" style="height: 12px"><div class="bar-fill" [style.width.%]="c.width" [style.background]="c.days < 1 ? 'var(--critical)' : c.days < 3 ? 'var(--gold)' : 'var(--wine)'"></div></div>
              <span class="num" style="text-align: right; font-weight: 600" [style.color]="c.days < 1 ? 'var(--critical)' : null">{{ c.days.toFixed(1) }} d</span>
            </div>
          } @empty {
            <div class="cap">—</div>
          }
          <div class="cap">{{ i.pick('Days left = closing ÷ average sold per day over the last 7 days. Bar scale: 7 days.', 'మిగిలిన రోజులు = ముగింపు ÷ గత 7 రోజుల సగటు అమ్మకం.') }}</div>
        </section>

        <section class="card tight">
          <div class="row-between"><h2 class="title">{{ i.t('soldByDay') }}</h2><span class="cap">{{ i.pick('top 8 brands', 'టాప్ 8 బ్రాండ్లు') }}</span></div>
          <div class="hm cap" [style.grid-template-columns]="gridCols()"><span></span>@for (d of gridDates(); track d) {<span style="text-align: center">{{ dayShort(d) }} {{ d.slice(8) }}</span>}</div>
          @for (r of grid(); track r.skuId) {
            <div class="hm" [style.grid-template-columns]="gridCols()">
              <span class="label" style="font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap">{{ r.name }}</span>
              @for (c of r.cells; track $index) { <span [class]="'cell l' + c.level">{{ c.qty }}</span> }
            </div>
          }
          <div class="cap">{{ i.pick('Darker = a bigger day for that brand.', 'ముదురు రంగు = ఆ బ్రాండ్‌కు ఎక్కువ అమ్మిన రోజు.') }}</div>
        </section>

        <section class="card tight">
          <div class="row-between"><h2 class="title">{{ i.t('notSold') }}</h2><span class="num label">{{ inr(idleValue()) }}</span></div>
          @for (x of idle().slice(0, 8); track x.skuId) {
            <div class="ln"><span>{{ x.name }} · {{ group(x.closing) }}</span>
              @if (x.rate > 0) { <span class="num label">{{ inr(x.closing * x.rate) }}</span> } @else { <span class="chip warn">{{ i.t('noSellRate') }}</span> }
            </div>
          } @empty {
            <div class="cap">—</div>
          }
          @if (idle().length > 8) { <div class="cap" style="text-align: center">+ {{ idle().length - 8 }}</div> }
        </section>
      }
    </main>
  `,
  styles: `
    .flow { display: flex; height: 44px; border-radius: 999px; overflow: hidden; }
    .flow > div { display: flex; align-items: center; padding: 0 8px; font-size: 12px; line-height: 16px; font-weight: 600; white-space: nowrap; overflow: hidden; min-width: 0; }
    .cols { display: flex; align-items: flex-end; gap: 8px; height: 150px; border-bottom: 1px solid var(--rule); padding: 0 4px; }
    .col { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; gap: 4px; }
    .cols-l { display: flex; gap: 8px; padding: 0 4px; }
    .hm { display: grid; gap: 4px; align-items: center; }
    .cell { height: 36px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }
    .l0 { background: var(--surface-sunk); color: var(--ink-muted); }
    .l1 { background: var(--heat-1); color: var(--ink); }
    .l2 { background: var(--heat-2); color: var(--ink); }
    .l3 { background: var(--heat-3); color: var(--on-wine); }
  `,
})
export class Stock {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private alertsSvc = inject(Alerts);
  protected inr = inr;
  protected group = group;
  protected dayShort = dayShort;
  protected kinds: PeriodKind[] = ['week', 'month', 'year'];
  protected kind = signal<PeriodKind>('week');

  private anchor = computed(() => this.store.lastSaved() ?? todayIso());
  private period = computed(() => periodOf(this.kind(), this.anchor(), this.store.settings().weekStart, this.store.settings().yearStartMonth));
  protected dates = computed(() => this.store.savedDates().filter((d) => d >= this.period().start && d <= this.period().end));
  private end = computed(() => this.dates().at(-1) ?? null);

  protected rangeLabel = computed(() => {
    const d = this.dates();
    return d.length ? `${fmtShort(d[0])} – ${fmtShort(d.at(-1)!)} · ${d.length} ${this.i.pick('saved days', 'సేవ్ చేసిన రోజులు')}` : `${fmtShort(this.period().start)} – ${fmtShort(this.period().end)}`;
  });

  protected flow = computed(() => stockFlow(this.dates().map((d) => this.store.sheets()[d])));
  protected pct = (n: number) => {
    const f = this.flow();
    const total = Math.max(1, f.opening + f.received);
    return Math.max(n > 0 ? 8 : 0, (n / total) * 100);
  };
  protected flowAria = computed(() => {
    const f = this.flow();
    return `Opening ${f.opening}, received ${f.received}, sold ${f.sold}, issued ${f.issued}, closing ${f.closing}`;
  });

  protected short = (n: number) => (n >= 1000 ? (n / 1000).toFixed(1) + 'k' : String(n));

  protected closings = computed(() => {
    const ds = this.dates().slice(-14);
    const rows = ds.map((d) => {
      const s = this.store.sheets()[d];
      let total = 0, received = 0;
      for (const r of Object.values(s.rows)) {
        total += r.c;
        received += r.r;
      }
      return { date: d, total, received, label: `${dayShort(d)} ${d.slice(8)}` };
    });
    const max = Math.max(1, ...rows.map((r) => r.total));
    return rows.map((r) => ({ ...r, h: Math.round((r.total / max) * 120) }));
  });

  protected cover = computed(() => {
    const end = this.end();
    if (!end) return [];
    const start = addDays(end, -6);
    const entered = this.store.savedDates().filter((d) => d >= start && d <= end).length;
    const skus = this.store.skuMap();
    return coverOf(this.store.balances()[end] ?? {}, this.store.movements(), start, end, entered)
      .filter((c) => c.closing > 0 && c.avgDaily > 0)
      .sort((a, b) => a.days - b.days)
      .slice(0, 8)
      .map((c) => {
        const s = skus.get(c.skuId);
        return { ...c, name: s ? `${this.i.name(s)} ${s.size}` : c.skuId, width: Math.max(3, Math.min(100, (c.days / 7) * 100)) };
      });
  });

  protected gridDates = computed(() => this.dates().slice(-7));
  protected gridCols = computed(() => `minmax(0, 1fr) repeat(${this.gridDates().length}, 48px)`);
  protected grid = computed(() => {
    const ds = this.gridDates();
    if (!ds.length) return [];
    const top = brandSales(this.store.movements(), ds[0], ds.at(-1)!).sort((a, b) => b.qty - a.qty).slice(0, 8).map((b) => b.skuId);
    const skus = this.store.skuMap();
    return soldGrid(this.store.movements(), ds, top).map((r) => {
      const s = skus.get(r.skuId);
      return { ...r, name: s ? `${this.i.name(s)} ${s.size}` : r.skuId };
    });
  });

  protected idle = computed(() => {
    const end = this.end();
    if (!end) return [];
    const p = this.period();
    const sold = new Set(brandSales(this.store.movements(), p.start, end).filter((b) => b.qty > 0).map((b) => b.skuId));
    const skus = this.store.skuMap();
    return Object.entries(this.store.balances()[end] ?? {})
      .filter(([id, c]) => c > 0 && !sold.has(id))
      .map(([id, closing]) => {
        const s = skus.get(id);
        return { skuId: id, closing, rate: s?.rate ?? 0, name: s ? `${this.i.name(s)} ${s.size}` : id };
      })
      .sort((a, b) => b.closing * b.rate - a.closing * a.rate);
  });
  protected idleValue = computed(() => this.idle().reduce((a, x) => a + x.closing * x.rate, 0));

  protected alerts = computed(() => this.alertsSvc.stock(this.end()));
}
