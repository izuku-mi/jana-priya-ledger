import { ChangeDetectionStrategy, Component, computed, effect, inject, input, linkedSignal, OnDestroy, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { Alerts } from '../core/alerts';
import { addDays, fmtDay, fmtShort, todayIso } from '../core/dates';
import { group, inr, parseCount, uid } from '../core/format';
import { I18n, Key } from '../core/i18n';
import { available, cashDay, FixMode, openingDiffs, soldOf, sortRows, withAutoClosing } from '../core/ledger';
import { DailySheet, ExpenseType, SheetRow } from '../core/model';
import { LedgerStore } from '../core/store';
import { AlertsPanel } from '../ui/alerts-panel';
import { Bottle, Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

const TYPES: { v: ExpenseType; k: Key }[] = [
  { v: 'shop', k: 'typeShop' },
  { v: 'person', k: 'typePerson' },
  { v: 'deposit', k: 'typeDeposit' },
  { v: 'misc', k: 'typeMisc' },
];

@Component({
  selector: 'app-entry',
  imports: [AlertsPanel, Bottle, Icon, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header style="display: flex; flex-direction: column; gap: 12px">
        <div class="screen-head">
          <h1 class="grow">{{ i.t('stockCount') }}</h1>
          @if (state().kind === 'ready') {
            @if (sheet()?.status === 'saved') { <span class="chip ok"><app-icon name="check" [size]="14" />{{ i.t('saved') }}</span> }
            @else if (isNewUntouched()) { <span class="chip">{{ i.t('newDay') }}</span> }
            @else { <span class="chip warn">{{ i.t('unsaved') }}</span> }
          }
        </div>
        <div class="row">
          <a class="btn icon" [routerLink]="['/entry', prevDate()]" [attr.aria-label]="i.pick('Previous day', 'ముందు రోజు')"><app-icon name="left" /></a>
          <label class="grow" style="position: relative">
            <span class="ro" style="background: var(--surface); border: 1px solid var(--border-strong)">{{ fmtDay(date(), true) }}</span>
            <input type="date" [value]="date()" (change)="go($any($event.target).value)" [attr.aria-label]="i.t('date')" style="position: absolute; inset: 0; opacity: 0; cursor: pointer" />
          </label>
          <a class="btn icon" [routerLink]="['/entry', nextDate()]" [attr.aria-label]="i.pick('Next day', 'తర్వాతి రోజు')"><app-icon name="right" /></a>
        </div>
        @if (state().kind === 'ready') {
          <div class="row">
            <button class="btn grow" type="button" (click)="openFetch()" [disabled]="!prevSaved()"><app-icon name="sync" [size]="18" />{{ i.t('fetchPrev') }}</button>
            <a class="btn" [routerLink]="['/inward', date()]"><app-icon name="truck" [size]="18" />{{ i.t('inward') }}</a>
          </div>
        }
      </header>

      @if (blocked(); as b) {
        <section class="empty">
          <app-bottle [w]="72" [outline]="true" />
          <h2 class="title">{{ fmtShort(b.missing) }} {{ i.t('notSavedYet') }}</h2>
          <p class="muted" style="margin: 0">{{ i.t('fillFirst') }} {{ i.t('lastSaved') }}: {{ fmtDay(b.lastSaved) }}.</p>
          <div style="display: flex; flex-direction: column; gap: 8px; width: 100%">
            <a class="btn primary" [routerLink]="['/entry', b.missing]">{{ i.t('goTo') }} {{ fmtDay(b.missing) }}</a>
            <button class="btn" type="button" (click)="closeDay(b.missing)">{{ i.t('shopClosed') }} ({{ fmtShort(b.missing) }})</button>
          </div>
          <p class="cap" style="margin: 0">{{ i.t('shopClosedHint') }}</p>
        </section>
        <app-alerts [alerts]="blockedAlerts()" [notes]="[]" (add)="store.addNote($event)" />
      }

      @if (sheet(); as s) {
        <section class="hero" style="flex-direction: row; justify-content: space-between; align-items: flex-end">
          <div><div class="cap">{{ i.t('salesToday') }}</div><div class="lg">{{ inr(totals().gross) }}</div></div>
          <div style="text-align: right"><div class="cap">{{ i.t('bottlesSold') }}</div><div class="num label" style="font-size: 18px">{{ group(totals().units) }}</div></div>
        </section>

        @if (s.closed) {
          <div class="al warn"><app-icon name="info" /><span><b>{{ i.t('closedDay') }}.</b> {{ i.t('shopClosedHint') }}</span></div>
        }

        <app-alerts [alerts]="dayAlerts()" [notes]="s.notes" (add)="addNote($event)" (remove)="removeNote($event)" />

        <div class="cap" style="margin-top: -8px">{{ first() ? i.t('firstDayHint') : i.t('openingHint') }}</div>

        <label class="row input" style="gap: 8px">
          <app-icon name="search" />
          <input class="grow" style="border: 0; outline: 0; background: transparent; height: 44px" [placeholder]="i.t('searchBrand')" [value]="query()" (input)="query.set($any($event.target).value)" />
        </label>

        <section style="display: flex; flex-direction: column; gap: 12px">
          <h2 class="title">{{ i.t('brandsWithStock') }} <span class="cap">({{ stocked().length }})</span></h2>
          @for (r of stocked(); track r.skuId) {
            <article class="card" [style.background]="rowBg(r)" style="gap: 10px">
              <div class="row">
                <span class="label grow" style="font-size: 16px">{{ i.name(r) }}</span>
                <span class="chip">{{ r.size }}</span>
                @if (r.c > 0 && r.c < 24 && sold(r) > 0) { <span class="chip bad">{{ i.pick('Low', 'తక్కువ') }}</span> }
              </div>
              <div class="row" style="align-items: flex-end">
                <div class="field"><span class="cap">{{ i.t('opening') }}</span>
                  @if (first()) { <input class="input c num" inputmode="numeric" [value]="r.o" (input)="setNum(r.skuId, 'o', $event)" [attr.aria-label]="i.t('opening') + ' ' + r.nameEn + ' ' + r.size" /> }
                  @else { <div class="ro">{{ group(r.o) }}</div> }
                </div>
                <div class="field"><span class="cap">{{ i.t('receipts') }}</span>
                  @if (r.rFromInward) { <div class="ro" [title]="i.t('inward')">{{ group(r.r) }}</div> }
                  @else { <input class="input c num" inputmode="numeric" [value]="r.r || ''" placeholder="0" (input)="setNum(r.skuId, 'r', $event)" [attr.aria-label]="i.t('receipts') + ' ' + r.nameEn + ' ' + r.size" /> }
                </div>
                <div class="field"><span class="cap">{{ i.t('issue') }}</span>
                  <input class="input c num" inputmode="numeric" [value]="r.i || ''" placeholder="0" (input)="setNum(r.skuId, 'i', $event)" [attr.aria-label]="i.t('issue') + ' ' + r.nameEn + ' ' + r.size" />
                </div>
              </div>
              @if (r.i > 0) {
                <select class="input" [value]="r.issueReason || 'breakage'" (change)="setReason(r.skuId, $any($event.target).value)" [attr.aria-label]="i.pick('Issue reason', 'ఇష్యూ కారణం')">
                  <option value="breakage">{{ i.pick('Breakage', 'పగిలినవి') }}</option>
                  <option value="leakage">{{ i.pick('Leakage', 'లీకేజ్') }}</option>
                  <option value="sample">{{ i.pick('Sample', 'శాంపిల్') }}</option>
                  <option value="return">{{ i.pick('Return to depot', 'డిపోకు వాపసు') }}</option>
                  <option value="other">{{ i.pick('Other', 'ఇతర') }}</option>
                </select>
              }
              <label class="row">
                <span class="label" style="width: 72px; flex: none; font-size: 16px">{{ i.t('closing') }}</span>
                <input class="input big grow" inputmode="numeric" [value]="r.c" (focus)="$any($event.target).select()" (input)="setClosing(r.skuId, $event)" [attr.aria-label]="i.t('closing') + ' ' + r.nameEn + ' ' + r.size" />
              </label>
              <div class="row-between small" style="border-top: 1px solid var(--rule); padding-top: 8px">
                <span class="muted">{{ rowNote(r) }}</span>
                <span class="num label">{{ i.t('sold') }} {{ group(sold(r)) }} · {{ inr(sold(r) * r.rate) }}</span>
              </div>
            </article>
          } @empty {
            <div class="cap">—</div>
          }
        </section>

        @if (empties().length) {
          <section class="card" style="padding: 0; gap: 0; overflow: hidden">
            <div class="row-between" style="padding: 12px 16px"><h2 class="title">{{ i.t('noStock') }}</h2><span class="cap">{{ empties().length }} · {{ i.t('tapToEnter') }}</span></div>
            @for (r of empties(); track r.skuId) {
              <button type="button" class="row" (click)="expand(r.skuId)" style="width: 100%; min-height: 48px; padding: 0 16px; border: 0; border-top: 1px solid var(--rule); background: transparent; cursor: pointer; text-align: left; justify-content: space-between">
                <span>{{ i.name(r) }} {{ r.size }} <span class="muted">{{ i.t('noStockTag') }}</span></span>
                <app-icon name="down" />
              </button>
            }
          </section>
        }

        <section class="card tight">
          <h2 class="title">{{ i.t('cashExpenses') }}</h2>
          @for (e of s.expenses; track e.id) {
            <div style="display: grid; grid-template-columns: minmax(0, 1fr) 104px 48px; gap: 8px; align-items: center; padding-bottom: 8px; border-bottom: 1px solid var(--rule)">
              <input class="input" [value]="e.label" [placeholder]="i.pick('Expense name', 'ఖర్చు పేరు')" (input)="setExpense(e.id, 'label', $any($event.target).value)" [attr.aria-label]="i.pick('Expense name', 'ఖర్చు పేరు')" />
              <input class="input n" inputmode="numeric" [value]="e.amount || ''" placeholder="₹0" (input)="setExpense(e.id, 'amount', parseCount($any($event.target).value))" [attr.aria-label]="i.t('amount')" />
              <button class="btn icon danger" type="button" (click)="removeExpense(e.id)" [attr.aria-label]="i.t('delete')"><app-icon name="close" /></button>
              <select class="input" style="grid-column: 1 / -1" [value]="e.type" (change)="setExpense(e.id, 'type', $any($event.target).value)" [attr.aria-label]="i.pick('Expense type', 'ఖర్చు రకం')">
                @for (ty of types; track ty.v) { <option [value]="ty.v" [selected]="ty.v === e.type">{{ i.t(ty.k) }}</option> }
              </select>
            </div>
          }
          <button class="btn dashed" type="button" (click)="addExpense()"><app-icon name="plus" [size]="18" />{{ i.t('addExpense') }}</button>
          <div class="row"><span class="grow small">{{ i.t('upi') }}</span><input class="input n" style="width: 150px" inputmode="numeric" [value]="s.upi || ''" placeholder="₹0" (input)="patch({ upi: parseCount($any($event.target).value) })" [attr.aria-label]="i.t('upi')" /></div>
          <div class="row"><span class="grow small">{{ i.t('other') }}</span><input class="input n" style="width: 150px" inputmode="numeric" [value]="s.other || ''" placeholder="₹0" (input)="patch({ other: parseCount($any($event.target).value) })" [attr.aria-label]="i.t('other')" /></div>
          <div class="ln"><span class="small">{{ i.t('sales') }}</span><span class="num">{{ inr(totals().gross) }}</span></div>
          <div class="ln"><span class="small">{{ i.t('expenses') }}</span><span class="neg">{{ inr(-totals().expensesAll) }}</span></div>
          <div class="ln"><span class="small">{{ i.t('upi') }}</span><span class="neg">{{ inr(-s.upi) }}</span></div>
          @if (s.other) { <div class="ln"><span class="small">{{ i.t('other') }}</span><span class="neg">{{ inr(-s.other) }}</span></div> }
          <div class="ln tot"><span>{{ i.t('expectedCash') }}</span><span class="num">{{ inr(totals().expected) }}</span></div>
          <div class="row" style="align-items: flex-end">
            <label class="field"><span class="cap">{{ i.t('cashCounted') }}</span>
              <input class="input n" inputmode="numeric" [value]="s.cashCounted ?? ''" [placeholder]="i.t('notCounted')" (input)="setCash($any($event.target).value)" />
            </label>
            <button class="btn" type="button" (click)="patch({ cashCounted: null })" [disabled]="s.cashCounted === null">{{ i.t('notCounted') }}</button>
          </div>
          @if (s.cashCounted !== null) {
            @let d = s.cashCounted - totals().expected;
            <div class="row-between small"><span>{{ i.t('difference') }}</span>
              @if (d === 0) { <span class="chip ok">{{ i.t('balanced') }}</span> }
              @else { <span class="chip bad">{{ d > 0 ? i.t('excess') : i.t('short') }} {{ inr(Math.abs(d)) }}</span> }
            </div>
          }
          <div class="cap">{{ i.t('notCountedHint') }}</div>
          <label class="field"><span class="cap">{{ i.t('preparedBy') }}</span><input class="input" [value]="s.preparedBy" (input)="patch({ preparedBy: $any($event.target).value })" /></label>
        </section>

        <div class="fab-bar">
          <button class="btn primary" type="button" (click)="save()">{{ s.status === 'saved' ? i.t('savedTapAgain') : i.t('saveDay') + ' · ' + fmtShort(date()) }}</button>
        </div>
      }
    </main>

    @if (fetchOpen() && sheet(); as s) {
      <div class="sheet-backdrop" (click)="fetchOpen.set(false)">
        <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="fetchTitle" (click)="$event.stopPropagation()">
          <div class="handle"></div>
          <div>
            <h2 id="fetchTitle" class="title" style="font-size: 22px; line-height: 34px">{{ i.t('fetchPrev') }} · {{ fmtShort(prevDate()) }}</h2>
            <div class="small muted">{{ diffs().length ? i.pick(diffs().length + (diffs().length === 1 ? ' opening no longer matches.' : ' openings no longer match.') + ' Pick which to update.', diffs().length + ' ప్రారంభ నిల్వలు సరిపోలడం లేదు. ఏవి మార్చాలో ఎంచుకోండి.') : i.t('noMismatch') }}</div>
          </div>
          @if (diffs().length) {
            <div style="border-top: 1px solid var(--rule)">
              @for (d of diffs(); track d.skuId) {
                <label class="row" style="align-items: flex-start; padding: 12px 0; border-bottom: 1px solid var(--rule); cursor: pointer">
                  <input type="checkbox" [checked]="picked().has(d.skuId)" (change)="togglePick(d.skuId)" style="width: 22px; height: 22px; margin-top: 3px; accent-color: var(--wine)" />
                  <span class="grow" style="display: flex; flex-direction: column">
                    <span class="label" style="font-size: 16px">{{ i.name(d) }} {{ d.size }}</span>
                    <span class="small num">{{ i.t('opening') }} {{ group(d.from) }} → <b>{{ group(d.to) }}</b></span>
                    <span class="small num muted">{{ fixEffect(d.skuId, d.delta) }}</span>
                  </span>
                </label>
              }
            </div>
            <div role="radiogroup" style="display: flex; flex-direction: column; gap: 8px">
              <button type="button" role="radio" class="opt" [class.on]="mode() === 'keepSales'" [attr.aria-checked]="mode() === 'keepSales'" (click)="mode.set('keepSales')">
                <span><span class="label" style="display: block; font-size: 16px">{{ i.t('keepSales') }}</span><span class="small muted">{{ i.t('keepSalesHint') }}</span></span>
              </button>
              <button type="button" role="radio" class="opt" [class.on]="mode() === 'keepClosing'" [attr.aria-checked]="mode() === 'keepClosing'" (click)="mode.set('keepClosing')">
                <span><span class="label" style="display: block; font-size: 16px">{{ i.t('keepClosing') }}</span><span class="small muted">{{ i.t('keepClosingHint') }}</span></span>
              </button>
            </div>
          }
          <div class="row">
            <button class="btn grow" type="button" (click)="fetchOpen.set(false)" style="min-height: 56px">{{ i.t('cancel') }}</button>
            @if (diffs().length) {
              <button class="btn primary" type="button" style="flex: 2" [disabled]="!picked().size" (click)="applyFetch()">{{ i.t('apply') }} ({{ picked().size }})</button>
            }
          </div>
        </section>
      </div>
    }
  `,
})
export class Entry implements OnDestroy {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private alertsSvc = inject(Alerts);
  private router = inject(Router);
  private toast = inject(Toast);
  protected inr = inr;
  protected group = group;
  protected fmtDay = fmtDay;
  protected fmtShort = fmtShort;
  protected parseCount = parseCount;
  protected Math = Math;
  protected types = TYPES;

  /** Route parameter; defaults to today. */
  readonly dateParam = input<string | undefined>(undefined, { alias: 'date' });
  protected date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.dateParam() ?? '') ? this.dateParam()! : todayIso()));
  protected prevDate = computed(() => addDays(this.date(), -1));
  protected nextDate = computed(() => addDays(this.date(), 1));

  protected state = computed(() => this.store.sheetState(this.date()));
  protected blocked = computed(() => {
    const s = this.state();
    return s.kind === 'blocked' ? s : null;
  });
  protected first = computed(() => {
    const s = this.state();
    return s.kind === 'ready' && s.first;
  });

  /** Working copy of the form. Resets when the date (or the stored form) changes. */
  protected sheet = linkedSignal<DailySheet | null>(() => {
    const s = this.state();
    return s.kind === 'ready' ? s.sheet : null;
  });
  private touched = linkedSignal(() => (this.date(), false));
  protected isNewUntouched = computed(() => {
    const s = this.state();
    return s.kind === 'ready' && s.isNew && !this.touched();
  });

  protected prevSaved = computed(() => this.store.previousSaved(this.date()));
  protected query = signal('');
  private expanded = linkedSignal(() => (this.date(), new Set<string>()));

  private rows = computed(() => sortRows(Object.values(this.sheet()?.rows ?? {})));
  private matches = (r: SheetRow) => {
    const q = this.query().trim().toLowerCase();
    return !q || `${r.nameEn} ${r.nameTe} ${r.size}`.toLowerCase().includes(q);
  };
  private hasStock = (r: SheetRow) => r.o + r.r > 0 || r.c > 0 || r.i > 0 || this.expanded().has(r.skuId) || this.first();
  protected stocked = computed(() => this.rows().filter((r) => this.hasStock(r) && this.matches(r)));
  protected empties = computed(() => this.rows().filter((r) => !this.hasStock(r) && this.matches(r)));

  protected totals = computed(() => cashDay(this.sheet() ?? ({ rows: {}, expenses: [], upi: 0, other: 0, cashCounted: null, date: '' } as unknown as DailySheet)));
  protected dayAlerts = computed(() => {
    const s = this.sheet();
    return s ? this.alertsSvc.day(s) : [];
  });
  protected blockedAlerts = computed(() => {
    const b = this.blocked();
    return b ? this.alertsSvc.dashboard(addDays(b.lastSaved, -6), b.lastSaved) : [];
  });

  // fetch previous closing
  protected fetchOpen = signal(false);
  protected mode = signal<FixMode>('keepSales');
  protected diffs = computed(() => {
    const s = this.sheet();
    const p = this.prevSaved();
    return s && p ? openingDiffs(s, p) : [];
  });
  protected picked = signal(new Set<string>());

  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    // Leaving a day flushes any pending autosave.
    effect(() => {
      this.date();
      this.flush();
    });
  }

  ngOnDestroy() {
    this.flush();
  }

  protected sold = soldOf;
  protected rowBg(r: SheetRow) {
    if (r.c > available(r)) return 'var(--critical-tint)';
    const saved = this.store.sheets()[this.date()];
    const before = saved?.status === 'saved' ? saved.rows[r.skuId] : null;
    return before && (before.c !== r.c || before.r !== r.r || before.i !== r.i) ? 'var(--gold-tint)' : 'var(--surface)';
  }
  protected rowNote(r: SheetRow) {
    if (r.c > available(r)) return this.i.pick('Closing is more than stock', 'ముగింపు స్టాక్ కంటే ఎక్కువ');
    if (r.rFromInward) return this.i.pick('Receipts from inward', 'రసీదు సరుకు రాక నుంచి');
    if (!r.cEdited) return this.i.pick('Not changed', 'మార్చలేదు');
    return `${this.i.pick('Rate', 'రేటు')} ₹${group(r.rate)}`;
  }

  protected go(d: string) {
    if (d) this.router.navigate(['/entry', d]);
  }

  // ---------- editing ----------

  private edit(fn: (s: DailySheet) => DailySheet) {
    const s = this.sheet();
    if (!s) return;
    const next = fn(structuredClone(s));
    next.status = 'draft';
    this.sheet.set(next);
    this.touched.set(true);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  private flush() {
    clearTimeout(this.timer);
    this.timer = undefined;
    const s = this.sheet();
    if (s && this.touched() && s.status === 'draft' && s.date === this.date()) {
      const stored = this.store.sheets()[s.date];
      if (!stored || stored.updatedAt !== s.updatedAt || JSON.stringify(stored) !== JSON.stringify(s)) this.store.saveDraft(s);
    }
  }

  protected setNum(id: string, k: 'o' | 'r' | 'i', ev: Event) {
    const v = parseCount((ev.target as HTMLInputElement).value);
    this.edit((s) => {
      s.rows[id] = withAutoClosing({ ...s.rows[id], [k]: v });
      return s;
    });
  }

  protected setClosing(id: string, ev: Event) {
    const v = parseCount((ev.target as HTMLInputElement).value);
    this.edit((s) => {
      s.rows[id] = { ...s.rows[id], c: v, cEdited: true };
      return s;
    });
  }

  protected setReason(id: string, reason: string) {
    this.edit((s) => {
      s.rows[id] = { ...s.rows[id], issueReason: reason };
      return s;
    });
  }

  protected expand(id: string) {
    this.expanded.update((set) => new Set(set).add(id));
  }

  protected patch(p: Partial<DailySheet>) {
    this.edit((s) => ({ ...s, ...p }));
  }

  protected setCash(v: string) {
    this.patch({ cashCounted: v.trim() === '' ? null : parseCount(v) });
  }

  protected addExpense() {
    this.edit((s) => ({ ...s, expenses: [...s.expenses, { id: uid(), label: '', amount: 0, type: 'shop' as ExpenseType }] }));
  }

  protected setExpense(id: string, k: 'label' | 'amount' | 'type', v: string | number) {
    this.edit((s) => ({ ...s, expenses: s.expenses.map((e) => (e.id === id ? { ...e, [k]: v } : e)) }));
  }

  protected removeExpense(id: string) {
    this.edit((s) => ({ ...s, expenses: s.expenses.filter((e) => e.id !== id) }));
  }

  protected addNote(text: string) {
    this.edit((s) => ({ ...s, notes: [...s.notes, { id: uid(), text, at: new Date().toISOString() }] }));
  }

  protected removeNote(id: string) {
    this.edit((s) => ({ ...s, notes: s.notes.filter((n) => n.id !== id) }));
  }

  protected async save() {
    const s = this.sheet();
    if (!s) return;
    clearTimeout(this.timer);
    const saved = await this.store.saveSheet({ ...s, updatedAt: new Date().toISOString() });
    this.sheet.set(saved);
    this.touched.set(false);
    this.toast.show(this.i.pick(`Saved ${fmtShort(saved.date)}`, `${fmtShort(saved.date)} సేవ్ అయింది`));
  }

  protected async closeDay(date: string) {
    await this.store.markClosed(date);
    this.toast.show(this.i.pick(`${fmtShort(date)} saved as shop closed`, `${fmtShort(date)} మూసిన రోజుగా సేవ్ అయింది`));
  }

  // ---------- fetch previous closing ----------

  protected openFetch() {
    this.flush();
    this.picked.set(new Set(this.diffs().map((d) => d.skuId)));
    this.mode.set('keepSales');
    this.fetchOpen.set(true);
  }

  protected togglePick(id: string) {
    this.picked.update((p) => {
      const n = new Set(p);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  protected fixEffect(id: string, delta: number) {
    const r = this.sheet()?.rows[id];
    if (!r) return '';
    if (!r.cEdited) return this.i.pick(`Closing follows: ${group(r.c + delta)}`, `ముగింపు: ${group(r.c + delta)}`);
    return this.mode() === 'keepSales'
      ? this.i.pick(`Closing ${group(r.c)} → ${group(r.c + delta)} · sold stays ${group(soldOf(r))}`, `ముగింపు ${group(r.c)} → ${group(r.c + delta)} · అమ్మకాలు ${group(soldOf(r))}`)
      : this.i.pick(`Closing stays ${group(r.c)} · sold ${group(soldOf(r))} → ${group(soldOf(r) + delta)}`, `ముగింపు ${group(r.c)} · అమ్మకాలు ${group(soldOf(r))} → ${group(soldOf(r) + delta)}`);
  }

  protected async applyFetch() {
    const s = this.sheet();
    if (!s) return;
    clearTimeout(this.timer);
    const next = await this.store.fixOpenings(s, [...this.picked()], this.mode());
    this.sheet.set(next);
    this.touched.set(true);
    this.fetchOpen.set(false);
    this.toast.show(this.i.pick('Openings updated. Save the day again.', 'ప్రారంభ నిల్వలు మారాయి. మళ్లీ సేవ్ చేయండి.'));
  }
}
