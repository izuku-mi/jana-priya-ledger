import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { dayOfWeek, fmtDay, todayIso } from '../core/dates';
import { group, inr } from '../core/format';
import { I18n } from '../core/i18n';
import { available, cashDay, soldOf } from '../core/ledger';
import { Expense } from '../core/model';
import { paginate, ReportItem, reportItems, reportNotes, snapshot } from '../core/report';
import { LedgerStore } from '../core/store';
import { Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

const DAYS_TE = ['ఆదివారం', 'సోమవారం', 'మంగళవారం', 'బుధవారం', 'గురువారం', 'శుక్రవారం', 'శనివారం'];
const DAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** Layout of an A4 page at 96 dpi, in px. Row heights are fixed so pages can be split ahead of time. */
const PAGE = { usable: 1035, row: 24, head: 28, firstHeader: 176, nextHeader: 36 };

@Component({
  selector: 'app-report',
  imports: [Icon, RouterLink, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen rp-screen">
      <header class="screen-head rp-toolbar">
        <a class="btn icon quiet" [routerLink]="['/entry', date()]" [attr.aria-label]="i.t('stockCount')"><app-icon name="left" /></a>
        <div class="grow"><h1>{{ i.pick('Daily report', 'రోజువారీ నివేదిక') }}</h1><div class="sub">{{ fmtDay(date(), true) }} · R{{ meta().no }}</div></div>
      </header>

      @if (sheet(); as s) {
        @if (s.status !== 'saved') {
          <div class="al warn rp-toolbar"><app-icon name="info" /><span><b>{{ i.pick('This day has unsaved changes.', 'ఈ రోజు సేవ్ కాని మార్పులు ఉన్నాయి.') }}</b> {{ i.pick('The report shows them and is marked DRAFT. Save the day first for a final report.', 'నివేదికలో అవి ఉంటాయి, "డ్రాఫ్ట్" అని ఉంటుంది. తుది నివేదికకు ముందు సేవ్ చేయండి.') }}</span></div>
        }
        <div class="row rp-toolbar" style="flex-wrap: wrap">
          <button class="btn" type="button" (click)="print()"><app-icon name="note" [size]="18" />{{ i.pick('Print', 'ప్రింట్') }}</button>
          @if (canShare) { <button class="btn" type="button" [disabled]="busy()" (click)="makePdf(true)"><app-icon name="share" [size]="18" />{{ i.pick('Share PDF', 'PDF షేర్') }}</button> }
          <button class="btn primary grow" type="button" [disabled]="busy()" (click)="makePdf(false)"><app-icon name="download" [size]="18" />{{ busy() ? i.pick('Making PDF…', 'PDF తయారవుతోంది…') : i.pick('Download PDF', 'PDF డౌన్‌లోడ్') }}</button>
        </div>
        <div class="cap rp-toolbar">{{ i.pick('Each PDF gets the next report number. A later one lists what changed since the last.', 'ప్రతి PDF కి తదుపరి నంబర్ వస్తుంది. తర్వాతి నివేదికలో మార్పులు చూపిస్తారు.') }}</div>

        <div class="rp-preview">
          @for (p of pages(); track $index) {
            <div class="rp-frame" [style.width.px]="794 * scale()" [style.height.px]="1123 * scale()">
              <div class="rp-scale" [style.transform]="'scale(' + scale() + ')'">
                <ng-container [ngTemplateOutlet]="pageTpl" [ngTemplateOutletContext]="{ $implicit: p, index: $index }" />
              </div>
            </div>
          }
        </div>

        @if (busy()) {
          <div class="rp-offscreen" #offscreen aria-hidden="true">
            @for (p of pages(); track $index) {
              <ng-container [ngTemplateOutlet]="pageTpl" [ngTemplateOutletContext]="{ $implicit: p, index: $index }" />
            }
          </div>
        }

        <ng-template #pageTpl let-p let-index="index">
          <section class="rp" [attr.lang]="i.lang()">
            @if (index === 0) {
              <div class="rp-head">
                <div>
                  <div class="rp-shop">{{ store.settings().shopName }}</div>
                  <div class="rp-title">{{ i.pick('DAILY STOCK & SALES REPORT', 'రోజువారీ స్టాక్ & అమ్మకాల నివేదిక') }}</div>
                </div>
                <div class="rp-date">
                  <div class="rp-k">{{ i.pick('DATE', 'తేదీ') }}</div>
                  <div class="rp-dv">{{ dmy() }}</div>
                  <div class="rp-k">{{ weekday() }}</div>
                  @if (s.preparedBy) { <div class="rp-k">{{ s.preparedBy }}</div> }
                </div>
              </div>
              <div class="rp-kpis">
                <div>{{ i.t('sales') }}<b>{{ inr(t().gross) }}</b></div>
                <div>{{ i.t('expenses') }}<b>{{ inr(t().expensesAll) }}</b></div>
                <div>PhonePe / UPI<b>{{ inr(t().upi) }}</b></div>
                <div class="hero">{{ i.pick('Net cash', 'నికర నగదు') }}<b>{{ inr(t().expected) }}</b></div>
              </div>
              @if (notes().length) {
                <div class="rp-notes">
                  <b>{{ i.pick('Important notes', 'ముఖ్య గమనికలు') }} ({{ notes().length }})</b>
                  <ul>@for (n of notes().slice(0, 8); track $index) { <li>{{ n }}</li> }</ul>
                  @if (notes().length > 8) { <div>+ {{ notes().length - 8 }} {{ i.pick('more', 'మరిన్ని') }}</div> }
                </div>
              } @else {
                <div class="rp-clean">✓ {{ i.pick('No discrepancies found', 'ఎలాంటి తేడాలు లేవు') }}</div>
              }
            } @else {
              <div class="rp-mini"><b>{{ store.settings().shopName }}</b><span>{{ dmy() }}</span></div>
            }

            @if (p.items.length || index === 0) {
              <table>
                <colgroup><col style="width: 30px" /><col /><col style="width: 44px" />@for (w of numCols; track $index) {<col [style.width.px]="w" />}</colgroup>
                <thead><tr>
                  <th class="c">#</th><th class="l">{{ i.pick('Brand', 'బ్రాండ్') }}</th><th class="c">{{ i.t('size') }}</th>
                  <th>{{ i.pick('Open', 'ప్రారంభ') }}</th><th>{{ i.pick('Rcpt', 'రసీదు') }}</th><th>{{ i.pick('Issue', 'ఇష్యూ') }}</th><th>{{ i.pick('Total', 'మొత్తం') }}</th>
                  <th>{{ i.pick('Close', 'ముగింపు') }}</th><th class="hl">{{ i.pick('Sales', 'అమ్మకం') }}</th><th>{{ i.pick('Rate', 'రేటు') }}</th><th class="hl">{{ i.pick('Amount', 'విలువ') }}</th>
                </tr></thead>
                <tbody>
                  @for (it of p.items; track $index) {
                    @if (it.kind === 'section') {
                      <tr class="sec"><td colspan="11">{{ it.cat === 'BEER' ? i.pick('BEER', 'బీర్') : i.pick('LIQUOR', 'లిక్కర్') }}</td></tr>
                    } @else {
                      <tr [class.bad]="it.row.c > available(it.row)">
                        <td class="c muted">{{ it.n }}</td><td class="l b">{{ i.name(it.row) }}</td><td class="c">{{ it.row.size }}</td>
                        <td class="muted">{{ z(it.row.o) }}</td><td [class.in]="it.row.r">{{ z(it.row.r) }}</td><td class="muted">{{ z(it.row.i) }}</td>
                        <td class="b">{{ group(available(it.row)) }}</td><td class="b">{{ group(it.row.c) }}</td>
                        <td class="hl">{{ group(sold(it.row)) }}</td><td class="muted">{{ z(it.row.rate) }}</td><td class="hl">{{ group(sold(it.row) * it.row.rate) }}</td>
                      </tr>
                    }
                  }
                </tbody>
                @if (index === lastRowsPage()) {
                  <tfoot><tr>
                    <td colspan="3" class="l">{{ i.pick('TOTAL', 'మొత్తం') }}</td>
                    <td>{{ group(sum().o) }}</td><td>{{ group(sum().r) }}</td><td>{{ group(sum().i) }}</td><td>{{ group(sum().tot) }}</td><td>{{ group(sum().c) }}</td>
                    <td>{{ group(t().units) }}</td><td>–</td><td>{{ group(t().gross) }}</td>
                  </tr></tfoot>
                }
              </table>
            }

            @if (index === pages().length - 1) {
              <div class="rp-boxes">
                <div class="rp-box">
                  <h4>{{ i.pick('Expenses', 'ఖర్చుల వివరాలు') }}</h4>
                  @for (e of s.expenses; track e.id) {
                    @if (e.amount) { <div class="ln2"><span>{{ e.label || '–' }} <i>{{ typeName(e) }}</i></span><span class="neg">{{ inr(-e.amount) }}</span></div> }
                  } @empty { <div class="ln2"><span>–</span><span></span></div> }
                  <div class="ln2 tot"><span>{{ i.pick('Total expenses', 'మొత్తం ఖర్చులు') }}</span><span class="neg">{{ inr(-t().expensesAll) }}</span></div>
                </div>
                <div class="rp-box">
                  <h4>{{ i.pick('Cash reconciliation', 'నగదు సమన్వయం') }}</h4>
                  <div class="ln2"><span>{{ i.pick('Liquor sales', 'లిక్కర్ అమ్మకాలు') }}</span><span>{{ inr(t().liquor) }}</span></div>
                  <div class="ln2"><span>{{ i.pick('Beer sales', 'బీర్ అమ్మకాలు') }}</span><span>{{ inr(t().beer) }}</span></div>
                  <div class="ln2 tot"><span>{{ i.t('sales') }}</span><span>{{ inr(t().gross) }}</span></div>
                  <div class="ln2"><span>{{ i.t('expenses') }}</span><span class="neg">{{ inr(-t().expensesAll) }}</span></div>
                  <div class="ln2"><span>PhonePe / UPI</span><span class="neg">{{ inr(-t().upi) }}</span></div>
                  @if (t().other) { <div class="ln2"><span>{{ i.t('other') }}</span><span class="neg">{{ inr(-t().other) }}</span></div> }
                  <div class="ln2 tot"><span>{{ i.pick('Net cash (expected)', 'నికర నగదు (అంచనా)') }}</span><span>{{ inr(t().expected) }}</span></div>
                  <div class="ln2"><span>{{ i.t('cashCounted') }}</span><span>{{ s.cashCounted === null ? i.t('notCounted') : inr(s.cashCounted) }}</span></div>
                  @if (s.cashCounted !== null) {
                    <div class="ln2 tot"><span>{{ i.t('difference') }}</span><span [class.neg]="s.cashCounted - t().expected < 0" [class.pos]="s.cashCounted - t().expected > 0">{{ s.cashCounted === t().expected ? i.t('balanced') : inr(s.cashCounted - t().expected) }}</span></div>
                  }
                </div>
              </div>
              @if (s.notes.length) {
                <div class="rp-remarks"><b>{{ i.pick('Remarks', 'వ్యాఖ్యలు') }}:&nbsp;</b> @for (n of s.notes; track n.id) { <span>{{ n.text }}{{ $last ? '' : ' · ' }}</span> }</div>
              }
              <div class="rp-sign"><div>{{ i.pick('Manager signature', 'మేనేజర్ సంతకం') }}</div><div>{{ i.pick('Checked by', 'తనిఖీ చేసినవారు') }}</div></div>
            }

            <div class="rp-foot">
              <span>{{ store.settings().shopName }} · {{ i.pick('Report', 'నివేదిక') }} {{ meta().id }}@if (meta().revised) { ({{ i.pick('REVISED', 'సవరించినది') }}) }@if (s.status !== 'saved') { · {{ i.pick('DRAFT', 'డ్రాఫ్ట్') }} } · {{ meta().at }}</span>
              <span>{{ index + 1 }} / {{ pages().length }}</span>
            </div>
          </section>
        </ng-template>
      } @else {
        <div class="empty">
          <h2 class="title">{{ i.pick('No entries for this day', 'ఈ రోజుకు నమోదు లేదు') }}</h2>
          <a class="btn primary" [routerLink]="['/entry', date()]">{{ i.t('stockCount') }}</a>
        </div>
      }
    </main>
  `,
})
export class Report {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private toast = inject(Toast);
  protected inr = inr;
  protected group = group;
  protected fmtDay = fmtDay;
  protected available = available;
  protected sold = soldOf;
  protected numCols = [54, 50, 46, 58, 58, 54, 50, 76];
  protected canShare = typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare;
  protected z = (n: number) => (n ? group(n) : '–');

  readonly dateParam = input<string | undefined>(undefined, { alias: 'date' });
  protected date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(this.dateParam() ?? '') ? this.dateParam()! : this.store.lastSaved() ?? todayIso()));
  protected sheet = computed(() => this.store.sheets()[this.date()] ?? null);
  protected t = computed(() => cashDay(this.sheet()!));
  protected busy = signal(false);
  private now = signal(new Date());
  private offscreen = viewChild<ElementRef<HTMLElement>>('offscreen');
  protected scale = signal(Math.min(1, (typeof window === 'undefined' ? 794 : Math.min(window.innerWidth, 560) - 32) / 794));

  protected dmy = computed(() => this.date().split('-').reverse().join('/'));
  protected weekday = computed(() => (this.i.isTe() ? DAYS_TE : DAYS_EN)[dayOfWeek(this.date())]);

  private items = computed(() => (this.sheet() ? reportItems(this.sheet()!) : []));
  protected sum = computed(() => {
    const s = { o: 0, r: 0, i: 0, tot: 0, c: 0 };
    for (const x of this.items()) {
      if (x.kind !== 'row') continue;
      s.o += x.row.o;
      s.r += x.row.r;
      s.i += x.row.i;
      s.tot += available(x.row);
      s.c += x.row.c;
    }
    return s;
  });

  protected notes = computed(() => {
    const s = this.sheet();
    if (!s) return [];
    const pick = (en: string, te: string) => this.i.pick(en, te);
    return reportNotes(s, this.store.previousSaved(s.date), s.reports?.at(-1), pick, (r) => this.i.name(r));
  });

  protected meta = computed(() => {
    const s = this.sheet();
    const no = (s?.reports?.length ?? 0) + 1;
    const at = this.now().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    return { no, at, id: `${this.date().replace(/-/g, '')}-R${no}`, revised: no > 1 };
  });

  protected pages = computed(() => {
    const items = this.items();
    const n = this.notes().length;
    const notesH = n ? 40 + 19 * Math.min(n, 8) + (n > 8 ? 19 : 0) : 26;
    const firstExact = (PAGE.usable - PAGE.firstHeader - notesH - PAGE.head) / PAGE.row;
    const restExact = (PAGE.usable - PAGE.nextHeader - PAGE.head) / PAGE.row;
    const first = Math.max(4, Math.floor(firstExact));
    const rest = Math.floor(restExact);
    // Room the totals row, boxes, remarks and signatures need (calibrated against the rendered page),
    // in rows, less the part-row left over at the bottom of a full page.
    const s = this.sheet();
    const expLines = (s?.expenses.filter((e) => e.amount).length ?? 0) + 1;
    const reconLines = 8 + (s?.other ? 1 : 0) + (s?.cashCounted != null ? 1 : 0);
    const tailPx = 22 * Math.max(expLines, reconLines) + 66 + (s?.notes.length ? 50 : 0);
    const tail = (tailPx + PAGE.row) / PAGE.row - (restExact - rest);
    return paginate(items.length, first, rest, tail).map(([a, b]) => ({ items: items.slice(a, b) as ReportItem[] }));
  });
  protected lastRowsPage = computed(() => {
    let j = 0;
    this.pages().forEach((p, k) => {
      if (p.items.length) j = k;
    });
    return j;
  });

  protected typeName(e: Expense) {
    return { shop: this.i.t('typeShop'), person: this.i.t('typePerson'), deposit: this.i.t('typeDeposit'), misc: this.i.t('typeMisc') }[e.type];
  }

  protected print() {
    this.now.set(new Date());
    setTimeout(() => window.print(), 50);
  }

  /** Render each A4 page to an image and put them in a PDF, then download or share it. */
  protected async makePdf(share: boolean) {
    const s = this.sheet();
    if (!s || this.busy()) return;
    this.now.set(new Date());
    this.busy.set(true);
    try {
      await new Promise((r) => setTimeout(r, 60));
      await document.fonts?.ready;
      const [{ jsPDF }, h2c] = await Promise.all([import('jspdf'), import('html2canvas-pro')]);
      const html2canvas = h2c.default;
      const els = this.offscreen()?.nativeElement.querySelectorAll<HTMLElement>('.rp') ?? [];
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
      for (let k = 0; k < els.length; k++) {
        if (k) pdf.addPage();
        const canvas = await html2canvas(els[k], { scale: 2, backgroundColor: '#ffffff', logging: false });
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, 297);
      }
      const m = this.meta();
      const shop = this.store.settings().shopName.replace(/[^A-Za-z0-9]/g, '') || 'Report';
      const name = `${shop}_${this.date()}_R${m.no}.pdf`;
      const blob = pdf.output('blob');
      await this.store.recordReport(this.date(), { no: m.no, at: m.at, by: s.preparedBy, snap: snapshot(s) });

      const file = new File([blob], name, { type: 'application/pdf' });
      if (share && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: name }).catch(() => undefined);
      } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      }
      this.toast.show(this.i.pick(`Report R${m.no} ready: ${name}`, `నివేదిక R${m.no} సిద్ధం: ${name}`), 3500);
    } catch (e) {
      console.error('PDF failed', e);
      this.toast.show(this.i.pick('Could not make the PDF here. Opening Print instead; choose Save as PDF.', 'ఇక్కడ PDF రాలేదు. ప్రింట్ తెరుస్తున్నాం; Save as PDF ఎంచుకోండి.'), 4000);
      window.print();
    } finally {
      this.busy.set(false);
    }
  }
}
