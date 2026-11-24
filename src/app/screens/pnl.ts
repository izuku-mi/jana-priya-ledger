import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Alerts } from '../core/alerts';
import { summarize } from '../core/analytics';
import { addDays, addMonths, fmtDay, fmtShort, PeriodKind, periodOf, todayIso } from '../core/dates';
import { inr } from '../core/format';
import { I18n } from '../core/i18n';
import { LedgerStore } from '../core/store';
import { AlertsPanel } from '../ui/alerts-panel';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-pnl',
  imports: [AlertsPanel, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head">
        <div class="grow"><h1>{{ i.t('profitLoss') }}</h1><div class="sub">{{ fmtShort(period().start) }} – {{ fmtShort(period().end) }}</div></div>
        <button class="btn" type="button" (click)="print()">PDF</button>
      </header>

      <div class="seg" role="tablist" aria-label="Period">
        @for (k of kinds; track k) {
          <button type="button" role="tab" [class.on]="kind() === k" [attr.aria-selected]="kind() === k" (click)="kind.set(k)">{{ i.t(k) }}</button>
        }
      </div>
      <div class="row">
        <button class="btn icon" type="button" aria-label="Previous period" (click)="shift(-1)"><app-icon name="left" /></button>
        <div class="grow label" style="text-align: center">{{ s().days.length }} {{ i.pick('saved days', 'సేవ్ చేసిన రోజులు') }}</div>
        <button class="btn icon" type="button" aria-label="Next period" (click)="shift(1)"><app-icon name="right" /></button>
      </div>

      <section class="hero">
        <span class="label muted">{{ i.t('netProfit') }}</span>
        @if (s().costKnown && s().days.length) {
          <span class="big" [class.neg]="net() < 0">{{ inr(net()) }}</span>
          <span class="small">{{ i.t('grossMargin') }} {{ inr(s().gross - s().cogs) }} · {{ marginPct() }}%</span>
        } @else {
          <span class="lg">{{ s().days.length ? i.t('notKnownYet') : '—' }}</span>
          @if (s().days.length) { <span class="small">{{ i.pick('Buy prices are missing, so the cost of what was sold can\\'t be worked out. Enter them on the next inward stock entry.', 'కొనుగోలు ధరలు లేవు; అమ్మిన సరుకు ఖర్చు లెక్కించలేము. తదుపరి సరుకు రాకలో నమోదు చేయండి.') }}</span> }
        }
      </section>

      <app-alerts [alerts]="alerts()" [notes]="store.notes()" (add)="store.addNote($event)" (remove)="store.removeNote($event)" />

      <section class="card">
        <h2 class="title">{{ i.t('salesToProfit') }}</h2>
        <div role="img" [attr.aria-label]="i.t('salesToProfit')" style="display: flex; flex-direction: column; gap: 8px">
          @for (w of waterfall(); track w.label) {
            <div class="wf">
              <span>{{ w.label }}</span>
              @if (w.unknown) {
                <div class="box dashed">{{ i.t('buyPricesNeeded') }}</div>
              } @else {
                <div class="track">
                  <div class="bar" [style.margin-left.%]="w.left" [style.width.%]="w.width" [style.background]="w.color"></div>
                  <span class="num" [class.neg]="w.value < 0" style="font-size: 12px">{{ inr(w.value) }}</span>
                </div>
              }
            </div>
          }
        </div>
      </section>

      <section class="card tight">
        <h2 class="title">{{ i.t('statement') }}</h2>
        <div class="ln"><span class="label">{{ i.t('sales') }}</span><span class="num label">{{ inr(s().gross) }}</span></div>
        <div class="ln sub"><span>{{ i.t('liquor') }}</span><span class="num">{{ inr(s().liquor) }}</span></div>
        <div class="ln sub"><span>{{ i.t('beer') }}</span><span class="num">{{ inr(s().beer) }}</span></div>
        <div class="ln"><span>{{ i.t('cogs') }}</span>
          @if (s().costKnown) { <span class="neg">{{ inr(-s().cogs) }}</span> } @else { <span class="chip warn">{{ i.t('buyPricesNeeded') }}</span> }
        </div>
        <div class="ln"><span class="label">{{ i.t('grossMargin') }}</span><span class="num">{{ s().costKnown ? inr(s().gross - s().cogs) : '—' }}</span></div>
        <div class="ln"><span>{{ i.t('damages') }}</span><span [class.neg]="s().damages > 0" class="num">{{ inr(-s().damages) }}</span></div>
        <div class="ln"><span>{{ i.t('shopCosts') }}</span><span class="neg">{{ inr(-s().shopExp) }}</span></div>
        @for (e of lines().shop; track e.label) { <div class="ln sub"><span>{{ e.label }}</span><span class="num">{{ inr(-e.amount) }}</span></div> }
        <div class="ln"><span>{{ i.t('typeMisc') }}</span><span class="neg">{{ inr(-s().miscExp) }}</span></div>
        @for (e of lines().misc; track e.label) { <div class="ln sub"><span>{{ e.label }}</span><span class="num">{{ inr(-e.amount) }}</span></div> }
        <div class="ln tot"><span>{{ i.t('netProfit') }}</span><span class="num" [class.neg]="net() < 0">{{ s().costKnown && s().days.length ? inr(net()) : '—' }}</span></div>
      </section>

      <section class="card tight">
        <div class="row-between"><h2 class="title">{{ i.t('cashOut') }}</h2><span class="neg" style="font-weight: 700">{{ inr(-(s().paidPeople + s().deposits)) }}</span></div>
        <div class="cap">{{ i.t('cashOutHint') }}</div>
        <div class="ln"><span class="label">{{ i.t('paidPeople') }}</span><span class="neg">{{ inr(-s().paidPeople) }}</span></div>
        @for (e of lines().person; track $index) { <div class="ln sub"><span>{{ e.label }} · {{ fmtShort(e.date) }}</span><span class="num">{{ inr(-e.amount) }}</span></div> }
        <div class="ln"><span class="label">{{ i.t('deposits') }}</span><span class="neg">{{ inr(-s().deposits) }}</span></div>
        @for (e of lines().deposit; track $index) { <div class="ln sub"><span>{{ e.label }} · {{ fmtShort(e.date) }}</span><span class="num">{{ inr(-e.amount) }}</span></div> }
      </section>

      <section class="card tight">
        <h2 class="title">{{ i.t('cashCheck') }}</h2>
        @for (d of s().days; track d.date) {
          <div class="ln"><span>{{ fmtDay(d.date) }} · {{ i.t('expected') }} {{ inr(d.expected) }}</span>
            @if (d.counted === null) { <span class="chip warn">{{ i.t('notCounted') }}</span> }
            @else if (d.counted === 0 && d.expected !== 0) { <span class="chip bad">{{ i.t('zeroEntered') }}</span> }
            @else if (d.counted === d.expected) { <span class="chip ok">{{ i.t('balanced') }}</span> }
            @else { <span class="chip bad">{{ d.counted > d.expected ? i.t('excess') : i.t('short') }} {{ inr(Math.abs(d.counted - d.expected)) }}</span> }
          </div>
        } @empty {
          <div class="cap">—</div>
        }
      </section>
    </main>
  `,
  styles: `
    .wf { display: grid; grid-template-columns: 104px minmax(0, 1fr); gap: 8px; align-items: center; font-size: 12px; line-height: 16px; font-weight: 600; }
    .track { display: flex; align-items: center; gap: 6px; min-width: 0; }
    .bar { height: 28px; border-radius: 6px; min-width: 4px; flex: none; }
    .box { height: 28px; border-radius: 6px; display: flex; align-items: center; padding: 0 8px; color: var(--ink-muted); }
    .dashed { border: 2px dashed var(--border-strong); }
  `,
})
export class Pnl {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private alertsSvc = inject(Alerts);
  protected inr = inr;
  protected fmtShort = fmtShort;
  protected fmtDay = fmtDay;
  protected Math = Math;
  protected kinds: PeriodKind[] = ['week', 'month', 'year'];
  protected kind = signal<PeriodKind>('week');
  private anchor = signal(this.store.lastSaved() ?? todayIso());

  protected period = computed(() => periodOf(this.kind(), this.anchor(), this.store.settings().weekStart, this.store.settings().yearStartMonth));
  protected s = computed(() => summarize(this.store.cashDays(), this.period().start, this.period().end));
  protected net = computed(() => this.s().gross - this.s().cogs - this.s().damages - this.s().shopExp - this.s().miscExp);
  protected marginPct = computed(() => (this.s().gross ? Math.round(((this.s().gross - this.s().cogs) / this.s().gross) * 100) : 0));

  /** Expense lines by type, from the saved forms in the period. */
  protected lines = computed(() => {
    const p = this.period();
    const out = { shop: [] as { label: string; amount: number }[], misc: [] as { label: string; amount: number }[], person: [] as { label: string; amount: number; date: string }[], deposit: [] as { label: string; amount: number; date: string }[] };
    const sum = (list: { label: string; amount: number }[], label: string, amount: number) => {
      const x = list.find((e) => e.label === label);
      if (x) x.amount += amount;
      else list.push({ label, amount });
    };
    for (const d of this.store.savedDates()) {
      if (d < p.start || d > p.end) continue;
      for (const e of this.store.sheets()[d].expenses) {
        if (!e.amount) continue;
        const label = e.label || '—';
        if (e.type === 'shop') sum(out.shop, label, e.amount);
        else if (e.type === 'misc') sum(out.misc, label, e.amount);
        else out[e.type].push({ label, amount: e.amount, date: d });
      }
    }
    return out;
  });

  protected waterfall = computed(() => {
    const s = this.s();
    const scale = Math.max(1, s.gross);
    const w = (v: number) => Math.min(80, (Math.abs(v) / scale) * 80);
    let level = s.gross;
    const step = (label: string, v: number, color: string, unknown = false) => {
      const row = { label, value: -v, unknown, color, left: w(level - v), width: w(v) };
      level -= v;
      return row;
    };
    const rows = [{ label: this.i.t('sales'), value: s.gross, unknown: false, color: 'var(--wine)', left: 0, width: w(s.gross) }];
    rows.push(step(this.i.t('cogs'), s.costKnown ? s.cogs : 0, 'var(--critical)', !s.costKnown));
    rows.push(step(this.i.t('damages'), s.damages, 'var(--critical)'));
    rows.push(step(this.i.t('shopCosts'), s.shopExp, 'var(--critical)'));
    rows.push(step(this.i.t('typeMisc'), s.miscExp, 'var(--critical)'));
    rows.push({ label: this.i.t('netProfit'), value: this.net(), unknown: !s.costKnown, color: 'var(--gold)', left: 0, width: w(Math.max(0, this.net())) });
    return rows;
  });

  protected alerts = computed(() => this.alertsSvc.pnl(this.period().start, this.period().end));

  protected shift(n: number) {
    const a = this.anchor();
    const k = this.kind();
    this.anchor.set(k === 'week' ? addDays(a, 7 * n) : k === 'month' ? addMonths(a, n) : addMonths(a, 12 * n));
  }

  protected print() {
    window.print();
  }
}
