import { inject, Injectable } from '@angular/core';
import { coverOf } from './analytics';
import { addDays, daysBetween, fmtShort, todayIso } from './dates';
import { inr, group } from './format';
import { I18n } from './i18n';
import { available, soldOf } from './ledger';
import { Alert, DailySheet } from './model';
import { LedgerStore } from './store';

/** Builds the "Alerts and notes" list shown at the top of every screen. */
@Injectable({ providedIn: 'root' })
export class Alerts {
  private store = inject(LedgerStore);
  private i = inject(I18n);

  private a(level: Alert['level'], titleEn: string, titleTe: string, bodyEn: string, bodyTe: string): Alert {
    return { level, title: this.i.pick(titleEn, titleTe), body: this.i.pick(bodyEn, bodyTe) };
  }

  /** Brands about to run out, using the last 7 saved days. */
  lowStock(end: string, limit = 3): Alert[] {
    const bal = this.store.balances()[end];
    if (!bal) return [];
    const start = addDays(end, -6);
    const entered = this.store.savedDates().filter((d) => d >= start && d <= end).length;
    const skus = this.store.skuMap();
    return coverOf(bal, this.store.movements(), start, end, entered)
      .filter((c) => c.closing > 0 && c.days < 1)
      .sort((x, y) => x.days - y.days)
      .slice(0, limit)
      .map((c) => {
        const s = skus.get(c.skuId);
        const name = s ? `${this.i.name(s)} ${s.size}` : c.skuId;
        return this.a('critical', `${name}: ${group(c.closing)} left.`, `${name}: ${group(c.closing)} మిగిలాయి.`,
          `Sells about ${Math.round(c.avgDaily)} a day, so it runs out within a day. Add it to the next order.`,
          `రోజుకు సుమారు ${Math.round(c.avgDaily)} అమ్ముడవుతాయి; ఒక రోజులో అయిపోతుంది. తదుపరి ఆర్డర్‌లో చేర్చండి.`);
      });
  }

  private common(): Alert[] {
    const out: Alert[] = [];
    for (const d of this.store.staleDates()) {
      out.push(this.a('critical', `${fmtShort(d)}: openings don't match ${fmtShort(addDays(d, -1))} closing.`, `${fmtShort(d)}: ప్రారంభ నిల్వ ${fmtShort(addDays(d, -1))} ముగింపుతో సరిపోలడం లేదు.`,
        'Open that day and tap Fetch previous closing.', 'ఆ రోజు తెరిచి "నిన్నటి ముగింపు తెచ్చుకో" నొక్కండి.'));
    }
    for (const [a, b] of this.store.duplicateSkus()) {
      out.push(this.a('warn', `${a.nameEn} ${a.size} is in the catalog twice.`, `${a.nameTe} ${a.size} కేటలాగ్‌లో రెండుసార్లు ఉంది.`,
        `Turn one off in Settings (ids ${a.id}, ${b.id}) so its stock isn't split.`, `స్టాక్ విడిపోకుండా సెట్టింగ్స్‌లో ఒకటి ఆపండి (${a.id}, ${b.id}).`));
    }
    const last = this.store.lastSaved();
    const bal = last ? this.store.balances()[last] ?? {} : {};
    const noRate = this.store.skus().filter((s) => (bal[s.id] ?? 0) > 0 && !(s.rate > 0));
    for (const s of noRate) {
      out.push(this.a('warn', `${s.nameEn} ${s.size}: ${bal[s.id]} in stock, no sell rate.`, `${s.nameTe} ${s.size}: ${bal[s.id]} స్టాక్ ఉంది, అమ్మకం ధర లేదు.`,
        'Its value shows as ₹0. Add the rate in Settings.', 'దాని విలువ ₹0 గా చూపుతుంది. సెట్టింగ్స్‌లో ధర చేర్చండి.'));
    }
    const lb = this.store.settings().lastBackupAt;
    if (this.store.savedDates().length && (!lb || daysBetween(lb.slice(0, 10), todayIso()) > 3)) {
      out.push(this.a('warn', lb ? 'No backup for more than 3 days.' : 'No backup taken yet.', lb ? '3 రోజులకు పైగా బ్యాకప్ లేదు.' : 'ఇంకా బ్యాకప్ తీసుకోలేదు.',
        'Everything is stored only in this browser. Download a backup from Settings.', 'డేటా ఈ బ్రౌజర్‌లో మాత్రమే ఉంది. సెట్టింగ్స్ నుంచి బ్యాకప్ తీసుకోండి.'));
    }
    return out;
  }

  /** Cash not counted, or entered as ₹0, on saved days in a range. */
  private cashIssues(start: string, end: string): Alert[] {
    const days = Object.values(this.store.cashDays()).filter((c) => c.date >= start && c.date <= end && c.gross > 0);
    const missing = days.filter((c) => c.counted == null).map((c) => fmtShort(c.date));
    const zero = days.filter((c) => c.counted === 0).map((c) => fmtShort(c.date));
    const off = days.filter((c) => c.counted != null && c.counted !== 0 && c.counted !== c.expected);
    const out: Alert[] = [];
    if (missing.length) out.push(this.a('warn', `Cash not counted on ${missing.join(', ')}.`, `${missing.join(', ')} న నగదు లెక్కించలేదు.`, 'Enter the count on those days.', 'ఆ రోజుల్లో లెక్క నమోదు చేయండి.'));
    if (zero.length) out.push(this.a('warn', `Cash counted is ₹0 on ${zero.join(', ')}.`, `${zero.join(', ')} న లెక్కించిన నగదు ₹0.`, 'Enter the real count or mark it Not counted.', 'అసలు లెక్క రాయండి లేదా "లెక్కించలేదు" ఎంచుకోండి.'));
    for (const c of off) {
      const d = (c.counted ?? 0) - c.expected;
      out.push(this.a('critical', `${fmtShort(c.date)}: cash ${d > 0 ? 'excess' : 'short'} by ${inr(Math.abs(d))}.`, `${fmtShort(c.date)}: నగదు ${inr(Math.abs(d))} ${d > 0 ? 'అదనం' : 'తక్కువ'}.`,
        `Counted ${inr(c.counted ?? 0)}, expected ${inr(c.expected)}.`, `లెక్కించినది ${inr(c.counted ?? 0)}, అంచనా ${inr(c.expected)}.`));
    }
    return out;
  }

  private costMissing(start: string, end: string): Alert[] {
    const days = Object.values(this.store.cashDays()).filter((c) => c.date >= start && c.date <= end && c.units > 0);
    if (!days.length || days.every((c) => c.costKnown)) return [];
    return [this.a('critical', 'Buy prices are missing.', 'కొనుగోలు ధరలు లేవు.', 'Profit can\'t be worked out yet. Enter them on the next inward stock entry.', 'లాభం లెక్కించలేము. తదుపరి సరుకు రాకలో ధరలు నమోదు చేయండి.')];
  }

  dashboard(start: string, end: string): Alert[] {
    const last = this.store.lastSaved();
    return [...(last ? this.lowStock(last) : []), ...this.cashIssues(start, end), ...this.costMissing(start, end), ...this.common()];
  }

  stock(end: string | null): Alert[] {
    return [...(end ? this.lowStock(end, 5) : []), ...this.common().filter((x) => x.level === 'critical' || !x.title.includes('backup'))];
  }

  pnl(start: string, end: string): Alert[] {
    const days = Object.values(this.store.cashDays()).filter((c) => c.date >= start && c.date <= end);
    const misc = days.reduce((a, c) => a + c.miscExp, 0);
    const extra = misc > 0 ? [this.a('warn', `${inr(misc)} is filed under Misc / others.`, `${inr(misc)} ఇతరాలుగా నమోదైంది.`, 'Change the type on the daily form if you know what it was.', 'తెలిస్తే రోజువారీ ఫారమ్‌లో రకం మార్చండి.')] : [];
    return [...this.costMissing(start, end), ...this.cashIssues(start, end), ...extra];
  }

  /** Problems on one day's form. */
  day(sheet: DailySheet): Alert[] {
    const out: Alert[] = [];
    for (const r of Object.values(sheet.rows)) {
      if (r.c > available(r)) {
        out.push(this.a('critical', `${r.nameEn} ${r.size}: closing ${r.c} is more than stock ${available(r)}.`, `${r.nameTe} ${r.size}: ముగింపు ${r.c} స్టాక్ ${available(r)} కంటే ఎక్కువ.`, 'Check the count.', 'లెక్క మళ్లీ చూడండి.'));
      } else if (soldOf(r) > 0 && !(r.rate > 0)) {
        out.push(this.a('warn', `${r.nameEn} ${r.size} sold ${soldOf(r)} with no rate.`, `${r.nameTe} ${r.size}: ధర లేకుండా ${soldOf(r)} అమ్మారు.`, 'Add the sell rate in Settings.', 'సెట్టింగ్స్‌లో అమ్మకం ధర చేర్చండి.'));
      }
    }
    if (sheet.cashCounted === 0) out.push(this.a('warn', 'Cash counted is ₹0.', 'లెక్కించిన నగదు ₹0.', 'Enter the count or tap Not counted.', 'లెక్క రాయండి లేదా "లెక్కించలేదు" నొక్కండి.'));
    for (const e of sheet.expenses.filter((x) => x.type === 'misc' && x.amount > 0)) {
      out.push(this.a('warn', `${e.label || '—'} ${inr(e.amount)} is filed under Misc / others.`, `${e.label || '—'} ${inr(e.amount)} ఇతరాలుగా ఉంది.`, 'Change the type if you know it.', 'తెలిస్తే రకం మార్చండి.'));
    }
    if (this.store.staleDates().includes(sheet.date)) {
      out.push(this.a('critical', 'Openings don\'t match the previous closing.', 'ప్రారంభ నిల్వ నిన్నటి ముగింపుతో సరిపోలడం లేదు.', 'Tap Fetch previous closing.', '"నిన్నటి ముగింపు తెచ్చుకో" నొక్కండి.'));
    }
    // Low stock as of this day once saved, otherwise as of the day before.
    const basis = sheet.status === 'saved' && this.store.balances()[sheet.date] ? sheet.date : addDays(sheet.date, -1);
    return [...out, ...(this.store.balances()[basis] ? this.lowStock(basis, 3) : [])];
  }

  inward(skuIdsMissingCost: number, invoiceEntered: boolean): Alert[] {
    const out: Alert[] = [];
    for (const [a, b] of this.store.duplicateSkus()) {
      out.push(this.a('critical', `${a.nameEn} ${a.size} is in the catalog twice.`, `${a.nameTe} ${a.size} కేటలాగ్‌లో రెండుసార్లు ఉంది.`, `Check which one you pick (${a.id} or ${b.id}).`, `ఏది ఎంచుకుంటున్నారో చూడండి (${a.id} / ${b.id}).`));
    }
    if (skuIdsMissingCost) out.push(this.a('warn', `Buy price missing on ${skuIdsMissingCost} lines.`, `${skuIdsMissingCost} లైన్లలో కొనుగోలు ధర లేదు.`, 'Profit needs them.', 'లాభం లెక్కకు ఇవి అవసరం.'));
    if (!invoiceEntered) out.push(this.a('warn', 'Invoice total not entered.', 'ఇన్వాయిస్ మొత్తం నమోదు కాలేదు.', 'The difference can\'t be checked.', 'తేడా చూడలేము.'));
    return out;
  }
}
