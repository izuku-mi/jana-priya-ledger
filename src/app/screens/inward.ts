import { ChangeDetectionStrategy, Component, computed, inject, input, linkedSignal, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Alerts } from '../core/alerts';
import { fmtDay, fmtShort, todayIso } from '../core/dates';
import { group, inr, parseCount, uid } from '../core/format';
import { I18n } from '../core/i18n';
import { Inward } from '../core/model';
import { LedgerStore } from '../core/store';
import { AlertsPanel } from '../ui/alerts-panel';
import { Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

const blank = (date: string): Inward => ({
  id: uid(), date, supplier: '', invoiceNo: '', invoiceTotal: null, lines: [], notes: [], savedAt: '',
  charges: [
    { id: uid(), label: 'Taxes / excise', amount: 0 },
    { id: uid(), label: 'Transport / loading', amount: 0 },
    { id: uid(), label: 'Misc / other', amount: 0 },
  ],
});

@Component({
  selector: 'app-inward',
  imports: [AlertsPanel, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head">
        <a class="btn icon quiet" [routerLink]="['/entry', date()]" [attr.aria-label]="i.t('stockCount')"><app-icon name="left" /></a>
        <div class="grow"><h1>{{ i.t('inwardStock') }}</h1><div class="sub">{{ fmtDay(date(), true) }}</div></div>
      </header>

      @if (blockedMissing(); as m) {
        <div class="al warn"><app-icon name="info" /><span><b>{{ fmtShort(m) }} {{ i.t('notSavedYet') }}.</b> {{ i.t('fillFirst') }}</span></div>
        <a class="btn primary" [routerLink]="['/entry', m]">{{ i.t('goTo') }} {{ fmtDay(m) }}</a>
      } @else {
        <app-alerts [alerts]="alerts()" [notes]="draft().notes" (add)="addNote($event)" (remove)="removeNote($event)" />

        @if (existing().length) {
          <section class="card tight">
            <h2 class="title">{{ i.t('deliveriesToday') }}</h2>
            @for (w of existing(); track w.id) {
              <div class="ln">
                <button type="button" class="btn quiet" style="padding: 0; min-height: 40px" (click)="edit(w)">{{ w.supplier || i.t('inward') }} {{ w.invoiceNo ? '#' + w.invoiceNo : '' }} · {{ group(bottlesOf(w)) }} {{ i.t('bottles') }}</button>
                <button type="button" class="btn icon danger" (click)="remove(w.id)" [attr.aria-label]="i.t('delete')"><app-icon name="trash" /></button>
              </div>
            }
          </section>
        }

        <section class="card">
          <div style="display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px">
            <label class="field"><span class="label">{{ i.t('date') }}</span><input class="input" type="date" [value]="draft().date" (change)="set({ date: $any($event.target).value })" /></label>
            <label class="field"><span class="label">{{ i.t('invoiceNo') }}</span><input class="input" [value]="draft().invoiceNo" (input)="set({ invoiceNo: $any($event.target).value })" /></label>
          </div>
          <label class="field"><span class="label">{{ i.t('supplier') }}</span><input class="input" [value]="draft().supplier" (input)="set({ supplier: $any($event.target).value })" /></label>
          <label class="field"><span class="label">{{ i.t('invoiceTotal') }}</span><input class="input n" inputmode="numeric" [value]="draft().invoiceTotal ?? ''" (input)="setInvoice($any($event.target).value)" /></label>
        </section>

        <section style="display: flex; flex-direction: column; gap: 8px">
          <div class="row-between"><h2 class="title">{{ i.t('items') }}</h2><span class="cap">{{ draft().lines.length }}</span></div>
          <label class="row input" style="gap: 8px">
            <app-icon name="search" />
            <input class="grow" style="border: 0; outline: 0; background: transparent; height: 44px" [placeholder]="i.t('searchBrand')" [value]="q()" (input)="q.set($any($event.target).value)" />
          </label>
          @if (results().length) {
            <div class="card" style="padding: 4px 16px; gap: 0">
              @for (s of results(); track s.id) {
                <button type="button" class="ln" style="width: 100%; background: transparent; border-left: 0; border-right: 0; border-top: 0; cursor: pointer; text-align: left" (click)="addLine(s.id)">
                  <span>{{ i.name(s) }} {{ s.size }}</span><span class="cap">₹{{ group(s.rate) }}</span>
                </button>
              }
            </div>
          }
          <div class="card" style="padding: 4px 16px 8px; gap: 0">
            <div class="cap" style="display: grid; grid-template-columns: minmax(0, 1fr) 80px 92px 36px; gap: 8px; padding: 8px 0"><span>{{ i.t('items') }}</span><span style="text-align: right">{{ i.t('bottles') }}</span><span style="text-align: right">{{ i.t('buyEach') }}</span><span></span></div>
            @for (l of lines(); track l.skuId) {
              <div style="display: grid; grid-template-columns: minmax(0, 1fr) 80px 92px 36px; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--rule)">
                <span><b class="label" style="font-size: 15px">{{ l.name }}</b><br /><span class="cap">{{ i.t('sellRate') }} {{ group(l.rate) }}</span></span>
                <input class="input n" style="padding: 0 10px" inputmode="numeric" [value]="l.qty || ''" placeholder="0" (input)="setLine(l.skuId, 'qty', $any($event.target).value)" [attr.aria-label]="i.t('bottles') + ' ' + l.name" />
                <input class="input n" style="padding: 0 10px" inputmode="numeric" [value]="l.cost || ''" placeholder="₹" (input)="setLine(l.skuId, 'cost', $any($event.target).value)" [attr.aria-label]="i.t('buyEach') + ' ' + l.name" />
                <button type="button" class="btn quiet icon danger" style="width: 36px" (click)="removeLine(l.skuId)" [attr.aria-label]="i.t('delete') + ' ' + l.name"><app-icon name="close" [size]="18" /></button>
              </div>
            } @empty {
              <div class="cap" style="padding: 12px 0">{{ i.pick('Search above to add brands.', 'పైన వెతికి బ్రాండ్లు జోడించండి.') }}</div>
            }
          </div>
        </section>

        <section class="card">
          <div class="row-between"><h2 class="title">{{ i.t('charges') }}</h2><span class="cap">{{ draft().charges.length }}</span></div>
          @for (c of draft().charges; track c.id) {
            <div style="display: grid; grid-template-columns: minmax(0, 1fr) 112px 48px; gap: 8px; align-items: center">
              <input class="input" [value]="c.label" [placeholder]="i.t('chargeName')" (input)="setCharge(c.id, 'label', $any($event.target).value)" [attr.aria-label]="i.t('chargeName')" />
              <input class="input n" inputmode="text" [value]="c.amount || ''" placeholder="₹0" (input)="setCharge(c.id, 'amount', $any($event.target).value)" [attr.aria-label]="i.t('amount') + ' ' + c.label" />
              <button type="button" class="btn icon danger" (click)="removeCharge(c.id)" [attr.aria-label]="i.t('delete') + ' ' + c.label"><app-icon name="close" /></button>
            </div>
          } @empty {
            <div class="cap" style="text-align: center">{{ i.t('noCharges') }}</div>
          }
          <button type="button" class="btn dashed" (click)="addCharge('')"><app-icon name="plus" [size]="18" />{{ i.t('addCharge') }}</button>
          <div class="cap">{{ i.t('chargesHint') }}</div>
        </section>

        <section class="hero" style="gap: 8px">
          <div class="row-between small"><span>{{ i.t('bottlesReceived') }}</span><b class="num">{{ group(sum().bottles) }}</b></div>
          <div class="row-between small"><span>{{ i.pick('Value at sell rate', 'అమ్మకం ధరకు విలువ') }}</span><b class="num">{{ inr(sum().sellValue) }}</b></div>
          <div style="border-top: 1px solid var(--rule)"></div>
          <div class="row-between small"><span>{{ i.t('itemsAtBuy') }}</span>
            @if (sum().missingCost) { <span class="chip warn">{{ i.t('buyPricesNeeded') }} ({{ sum().missingCost }})</span> } @else { <span class="num">{{ inr(sum().buyValue) }}</span> }
          </div>
          @for (c of draft().charges; track c.id) {
            <div class="row-between small"><span>+ {{ c.label || '—' }}</span><span class="num">{{ inr(c.amount) }}</span></div>
          }
          <div class="row-between small" style="font-weight: 600"><span>{{ i.t('chargesTotal') }}</span><span class="num">{{ inr(sum().charges) }}</span></div>
          <div class="row-between" style="font-weight: 700"><span>{{ i.t('entryTotal') }}</span><span class="num">{{ inr(sum().total) }}</span></div>
          <div class="row-between small"><span>{{ i.t('invoiceTotal') }}</span><span class="num">{{ draft().invoiceTotal === null ? '—' : inr(draft().invoiceTotal!) }}</span></div>
          <div class="row-between small"><span>{{ i.t('difference') }}</span>
            @if (sum().diff === null) { <span class="chip warn">{{ i.pick('Enter invoice total', 'ఇన్వాయిస్ మొత్తం రాయండి') }}</span> }
            @else if (sum().diff === 0) { <span class="chip ok">{{ i.t('balanced') }}</span> }
            @else { <span class="chip bad">{{ inr(sum().diff!) }}</span> }
          </div>
          @if (sum().diff) {
            <button type="button" class="btn" (click)="addCharge('Invoice difference', sum().diff!)">{{ i.t('addDiff') }}</button>
          }
        </section>

        <div class="fab-bar"><button class="btn primary" type="button" [disabled]="!sum().bottles" (click)="save()">{{ i.t('saveDelivery') }}</button></div>
      }
    </main>
  `,
})
export class InwardScreen {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private alertsSvc = inject(Alerts);
  private router = inject(Router);
  private toast = inject(Toast);
  protected inr = inr;
  protected group = group;
  protected fmtDay = fmtDay;
  protected fmtShort = fmtShort;

  readonly dateParam = input<string | undefined>(undefined, { alias: 'date' });
  protected date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.dateParam() ?? '') ? this.dateParam()! : todayIso()));
  protected draft = linkedSignal<Inward>(() => blank(this.date()));
  protected q = signal('');

  protected blockedMissing = computed(() => {
    const s = this.store.sheetState(this.draft().date);
    return s.kind === 'blocked' ? s.missing : null;
  });
  protected existing = computed(() => this.store.inwardsFor(this.draft().date));

  protected results = computed(() => {
    const q = this.q().trim().toLowerCase();
    if (!q) return [];
    const have = new Set(this.draft().lines.map((l) => l.skuId));
    return this.store.skus().filter((s) => s.active && !have.has(s.id) && `${s.nameEn} ${s.nameTe} ${s.size}`.toLowerCase().includes(q)).slice(0, 8);
  });

  protected lines = computed(() => {
    const skus = this.store.skuMap();
    return this.draft().lines.map((l) => {
      const s = skus.get(l.skuId);
      return { ...l, name: s ? `${this.i.name(s)} ${s.size}` : l.skuId, rate: s?.rate ?? 0 };
    });
  });

  protected sum = computed(() => {
    const d = this.draft();
    const skus = this.store.skuMap();
    const bottles = d.lines.reduce((a, l) => a + l.qty, 0);
    const buyValue = d.lines.reduce((a, l) => a + l.qty * l.cost, 0);
    const sellValue = d.lines.reduce((a, l) => a + l.qty * (skus.get(l.skuId)?.rate ?? 0), 0);
    const missingCost = d.lines.filter((l) => l.qty > 0 && !(l.cost > 0)).length;
    const charges = d.charges.reduce((a, c) => a + c.amount, 0);
    const total = buyValue + charges;
    const diff = d.invoiceTotal === null || missingCost ? null : d.invoiceTotal - total;
    return { bottles, buyValue, sellValue, missingCost, charges, total, diff };
  });

  protected alerts = computed(() => this.alertsSvc.inward(this.sum().missingCost, this.draft().invoiceTotal !== null));

  protected bottlesOf = (w: Inward) => w.lines.reduce((a, l) => a + l.qty, 0);

  protected set(p: Partial<Inward>) {
    this.draft.update((d) => ({ ...d, ...p }));
  }

  protected setInvoice(v: string) {
    this.set({ invoiceTotal: v.trim() === '' ? null : parseCount(v) });
  }

  protected addLine(skuId: string) {
    const s = this.store.skuMap().get(skuId);
    this.draft.update((d) => ({ ...d, lines: [...d.lines, { skuId, qty: 0, cost: s?.cost ? Math.round(s.cost) : 0 }] }));
    this.q.set('');
  }

  protected setLine(skuId: string, k: 'qty' | 'cost', v: string) {
    this.draft.update((d) => ({ ...d, lines: d.lines.map((l) => (l.skuId === skuId ? { ...l, [k]: parseCount(v) } : l)) }));
  }

  protected removeLine(skuId: string) {
    this.draft.update((d) => ({ ...d, lines: d.lines.filter((l) => l.skuId !== skuId) }));
  }

  protected addCharge(label: string, amount = 0) {
    this.draft.update((d) => ({ ...d, charges: [...d.charges, { id: uid(), label, amount }] }));
  }

  protected setCharge(id: string, k: 'label' | 'amount', v: string) {
    // A charge can be negative (a credit or discount), so keep a leading minus sign.
    const amount = (s: string) => (/^\s*[-−]/.test(s) ? -parseCount(s) : parseCount(s));
    this.draft.update((d) => ({ ...d, charges: d.charges.map((c) => (c.id === id ? { ...c, [k]: k === 'amount' ? amount(v) : v } : c)) }));
  }

  protected removeCharge(id: string) {
    this.draft.update((d) => ({ ...d, charges: d.charges.filter((c) => c.id !== id) }));
  }

  protected addNote(text: string) {
    this.draft.update((d) => ({ ...d, notes: [...d.notes, { id: uid(), text, at: new Date().toISOString() }] }));
  }

  protected removeNote(id: string) {
    this.draft.update((d) => ({ ...d, notes: d.notes.filter((n) => n.id !== id) }));
  }

  protected edit(w: Inward) {
    this.draft.set(structuredClone(w));
  }

  protected async remove(id: string) {
    if (!confirm(this.i.pick('Delete this delivery? Its bottles come off the Receipts for that day.', 'ఈ సరుకు తొలగించాలా? ఆ రోజు రసీదుల నుంచి తీసివేస్తారు.'))) return;
    await this.store.deleteInward(id);
    if (this.draft().id === id) this.draft.set(blank(this.date()));
  }

  protected async save() {
    const d = { ...this.draft(), lines: this.draft().lines.filter((l) => l.qty > 0), savedAt: new Date().toISOString() };
    await this.store.saveInward(d);
    this.toast.show(this.i.pick(`Delivery saved. ${group(this.sum().bottles)} added to ${fmtShort(d.date)} receipts.`, `సరుకు సేవ్ అయింది. ${fmtShort(d.date)} రసీదుల్లో ${group(this.sum().bottles)} చేరాయి.`));
    this.router.navigate(['/entry', d.date]);
  }
}
