import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Alerts } from '../core/alerts';
import { bars, brandSales, summarize } from '../core/analytics';
import { addDays, addMonths, daysBetween, fmtShort, parseIso, PeriodKind, periodOf, todayIso } from '../core/dates';
import { group, inr } from '../core/format';
import { I18n } from '../core/i18n';
import { LedgerStore } from '../core/store';
import { AlertsPanel } from '../ui/alerts-panel';
import { BarChart } from '../ui/bar-chart';
import { Bottle, Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

@Component({
  selector: 'app-dashboard',
  imports: [AlertsPanel, BarChart, Bottle, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head">
        <app-bottle [w]="28" />
        <div class="grow">
          <h1>{{ store.settings().shopName }}</h1>
          <div class="sub">{{ i.t('dashboard') }}</div>
        </div>
        <button class="btn icon" type="button" (click)="toggleLang()" [attr.aria-label]="i.isTe() ? 'Switch to English' : 'తెలుగుకు మార్చు'">{{ i.isTe() ? 'EN' : 'తె' }}</button>
        <button class="btn icon" type="button" (click)="toggleDark()" aria-label="Theme"><app-icon [name]="store.settings().dark ? 'sun' : 'moon'" /></button>
      </header>

      <div class="seg" role="tablist" aria-label="Period">
        @for (k of kinds; track k) {
          <button type="button" role="tab" [class.on]="kind() === k" [attr.aria-selected]="kind() === k" (click)="kind.set(k)">{{ i.t(k) }}</button>
        }
      </div>

      <div class="row">
        <button class="btn icon" type="button" aria-label="Previous period" (click)="shift(-1)"><app-icon name="left" /></button>
        <div class="grow label" style="text-align: center">{{ periodLabel() }}</div>
        <button class="btn icon" type="button" aria-label="Next period" (click)="shift(1)"><app-icon name="right" /></button>
      </div>

      <section class="hero">
        <div class="row-between">
          <span class="label muted">{{ i.t('sales') }}</span>
          <span class="cap">{{ coverage() }}</span>
        </div>
        <div class="big">{{ inr(sum().gross) }}</div>
        <div class="small muted">{{ prevLine() }}</div>
      </section>

      <div class="kpis">
        <div class="kpi"><div class="cap">{{ i.t('netCash') }}</div><b>{{ inr(sum().expected) }}</b><div class="cap">{{ i.t('afterUpi') }}</div></div>
        <div class="kpi"><div class="cap">{{ i.t('expenses') }}</div><b>{{ inr(sum().expensesAll) }}</b><div class="cap">{{ inr(sum().paidPeople) }} {{ i.t('paidPeopleShort') }}</div></div>
        <div class="kpi"><div class="cap">{{ i.t('bottlesSold') }}</div><b>{{ group(sum().units) }}</b><div class="cap">{{ i.t('liquorAndBeer') }}</div></div>
        <div class="kpi"><div class="cap">{{ i.t('stockValue') }}</div><b>{{ inr(stockNow().value) }}</b><div class="cap">{{ group(stockNow().bottles) }} · {{ i.t('atSellRate') }}</div></div>
      </div>

      <section class="card tight">
        <div class="row-between"><h2 class="title">{{ i.pick('Reports', 'నివేదికలు') }}</h2><span class="chip">{{ i.pick('Coming soon', 'త్వరలో') }}</span></div>
        <div class="row" style="flex-wrap: wrap">
          @for (k of kinds; track k) {
            <button class="btn grow" type="button" (click)="downloadReport(k)"><app-icon name="download" [size]="18" />{{ reportName(k) }}</button>
          }
        </div>
        <div class="cap">{{ i.pick('PDF of the ' + i.t(kind()).toLowerCase() + ' shown above: sales, stock, expenses and profit.', 'పైన చూపిన కాలానికి PDF: అమ్మకాలు, స్టాక్, ఖర్చులు, లాభం.') }}</div>
      </section>

      <section class="card">
        <div class="row-between"><h2 class="title">{{ kind() === 'year' ? i.t('salesByMonth') : i.t('salesByDay') }}</h2></div>
        <app-bar-chart [bars]="chart()" />
        <div class="cap">{{ i.t('notEnteredHint') }}</div>
      </section>

      @if (sum().gross > 0) {
        <section class="card">
          <h2 class="title">{{ i.t('howPaid') }}</h2>
          <div role="img" [attr.aria-label]="'Cash ' + cashPct() + '%, UPI ' + (100 - cashPct()) + '%'" style="display: flex; height: 24px; border-radius: 999px; overflow: hidden">
            <div [style.width.%]="cashPct()" style="background: var(--wine)"></div>
            <div [style.width.%]="100 - cashPct()" style="background: var(--gold)"></div>
          </div>
          <div class="row-between">
            <div><div class="cap">{{ i.t('cash') }} · {{ cashPct() }}%</div><div class="num label" style="font-size: 18px">{{ inr(sum().gross - sum().upi) }}</div></div>
            <div style="text-align: right"><div class="cap">{{ i.t('upi') }} · {{ 100 - cashPct() }}%</div><div class="num label" style="font-size: 18px">{{ inr(sum().upi) }}</div></div>
          </div>
        </section>
      }

      <app-alerts [alerts]="alerts()" [notes]="store.notes()" (add)="store.addNote($event)" (remove)="store.removeNote($event)" />

      @if (top().length) {
        <section class="card tight">
          <div class="row-between"><h2 class="title">{{ i.t('topBrands') }}</h2><span class="cap">{{ i.t('shareOfSales') }}</span></div>
          @for (b of top(); track b.skuId; let first = $first) {
            <div style="display: flex; flex-direction: column; gap: 4px">
              <div class="row-between small"><span class="label">{{ b.name }}</span><span class="num">{{ inr(b.amount) }} · {{ b.pct }}%</span></div>
              <div class="bar-track"><div class="bar-fill" [style.width.%]="b.width" [style.background]="first ? 'var(--gold)' : 'var(--wine)'"></div></div>
            </div>
          }
        </section>
      }
    </main>
  `,
})
export class Dashboard {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private alertsSvc = inject(Alerts);
  private toast = inject(Toast);
  protected inr = inr;
  protected group = group;
  protected kinds: PeriodKind[] = ['week', 'month', 'year'];

  protected kind = signal<PeriodKind>('week');
  /** Starts on the latest saved day so the first view has data; arrows move by whole periods. */
  protected anchor = signal(this.store.lastSaved() ?? todayIso());

  protected period = computed(() => periodOf(this.kind(), this.anchor(), this.store.settings().weekStart, this.store.settings().yearStartMonth));
  protected sum = computed(() => summarize(this.store.cashDays(), this.period().start, this.period().end));
  private prevSum = computed(() => summarize(this.store.cashDays(), this.period().prevStart, this.period().prevEnd));
  protected chart = computed(() => bars(this.store.cashDays(), this.period().buckets, todayIso()));

  protected periodLabel = computed(() => {
    const p = this.period();
    if (p.kind === 'year') return `${fmtShort(p.start)} ${parseIso(p.start).getUTCFullYear()} – ${fmtShort(p.end)} ${parseIso(p.end).getUTCFullYear()}`;
    return `${fmtShort(p.start)} – ${fmtShort(p.end)} ${parseIso(p.end).getUTCFullYear()}`;
  });

  protected coverage = computed(() => {
    const p = this.period();
    const total = daysBetween(p.start, p.end) + 1;
    const n = this.sum().days.length;
    return this.i.pick(`${n} of ${total} days entered`, `${total} లో ${n} రోజులు నమోదు`);
  });

  protected prevLine = computed(() => {
    const p = this.period();
    const prev = this.prevSum().gross;
    const now = this.sum().gross;
    const name = { week: this.i.pick('Last week', 'గత వారం'), month: this.i.pick('Last month', 'గత నెల'), year: this.i.pick('Last year', 'గత సంవత్సరం') }[p.kind];
    const range = `${fmtShort(p.prevStart)} – ${fmtShort(p.prevEnd)}`;
    if (!prev) return `${name} (${range}): ₹0 · ${this.i.pick('not entered', 'నమోదు లేదు')}`;
    const pct = Math.round(((now - prev) / prev) * 100);
    return `${name} (${range}): ${inr(prev)} · ${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
  });

  protected stockNow = computed(() => {
    const last = this.store.lastSaved();
    const bal = last ? this.store.balances()[last] ?? {} : {};
    const skus = this.store.skuMap();
    let value = 0, bottles = 0;
    for (const [id, c] of Object.entries(bal)) {
      bottles += c;
      const sku = skus.get(id);
      value += c * (sku && last ? this.store.priceToday(sku, last).rate : 0);
    }
    return { value, bottles };
  });

  protected cashPct = computed(() => {
    const g = this.sum().gross;
    return g > 0 ? Math.round(((g - this.sum().upi) / g) * 100) : 0;
  });

  protected top = computed(() => {
    const sales = brandSales(this.store.movements(), this.period().start, this.period().end);
    const total = sales.reduce((a, b) => a + b.amount, 0) || 1;
    const max = sales[0]?.amount || 1;
    const skus = this.store.skuMap();
    return sales.slice(0, 5).map((b) => {
      const s = skus.get(b.skuId);
      return { ...b, name: s ? `${this.i.name(s)} ${s.size}` : b.skuId, pct: Math.round((b.amount / total) * 100), width: (b.amount / max) * 100 };
    });
  });

  protected alerts = computed(() => this.alertsSvc.dashboard(this.period().start, this.period().end));

  protected shift(n: number) {
    const a = this.anchor();
    const k = this.kind();
    this.anchor.set(k === 'week' ? addDays(a, 7 * n) : k === 'month' ? addMonths(a, n) : addMonths(a, 12 * n));
  }

  protected reportName(k: PeriodKind) {
    return { week: this.i.pick('Weekly', 'వారపు'), month: this.i.pick('Monthly', 'నెలవారీ'), year: this.i.pick('Yearly', 'వార్షిక') }[k];
  }

  /** Placeholder until period reports are built: it names the period the report will cover. */
  protected downloadReport(k: PeriodKind) {
    const s = this.store.settings();
    const p = periodOf(k, this.anchor(), s.weekStart, s.yearStartMonth);
    this.toast.show(this.i.pick(
      `${this.reportName(k)} report (${fmtShort(p.start)} – ${fmtShort(p.end)}) is coming soon`,
      `${this.reportName(k)} నివేదిక (${fmtShort(p.start)} – ${fmtShort(p.end)}) త్వరలో వస్తుంది`,
    ));
  }

  protected toggleLang() {
    this.store.updateSettings({ lang: this.i.isTe() ? 'en' : 'te' });
  }

  protected toggleDark() {
    this.store.updateSettings({ dark: !this.store.settings().dark });
  }
}
