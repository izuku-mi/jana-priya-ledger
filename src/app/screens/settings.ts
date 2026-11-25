import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { fmtDay, monthShort } from '../core/dates';
import { group, parseCount } from '../core/format';
import { I18n } from '../core/i18n';
import { isLegacyBackup, LegacyBackup } from '../core/legacy';
import { BackupFile, isBackupFile, LedgerStore } from '../core/store';
import { Icon } from '../ui/icon';
import { Toast } from '../ui/toast';

type Pending = { kind: 'backup'; file: BackupFile; ok: boolean } | { kind: 'legacy'; file: LegacyBackup; dates: string[] };

@Component({
  selector: 'app-settings',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="screen">
      <header class="screen-head"><h1>{{ i.t('settings') }}</h1></header>

      <section class="card">
        <label class="field"><span class="label">{{ i.t('shopName') }}</span><input class="input" [value]="st().shopName" (change)="store.updateSettings({ shopName: $any($event.target).value })" /></label>
        <div class="row-between" style="align-items: center"><span class="label">{{ i.t('language') }}</span>
          <div class="seg" style="width: 200px">
            <button type="button" [class.on]="st().lang === 'te'" (click)="store.updateSettings({ lang: 'te' })">తెలుగు</button>
            <button type="button" [class.on]="st().lang === 'en'" (click)="store.updateSettings({ lang: 'en' })">English</button>
          </div>
        </div>
        <label class="row-between" style="align-items: center"><span class="label">{{ i.t('theme') }}</span>
          <input type="checkbox" [checked]="st().dark" (change)="store.updateSettings({ dark: $any($event.target).checked })" style="width: 24px; height: 24px; accent-color: var(--wine)" />
        </label>
        <label class="row-between" style="align-items: center"><span class="label">{{ i.t('yearStarts') }}</span>
          <select class="input" style="width: 160px" (change)="store.updateSettings({ yearStartMonth: +$any($event.target).value })">
            @for (m of months; track m) { <option [value]="m" [selected]="m === st().yearStartMonth">{{ monthShort(m) }}</option> }
          </select>
        </label>
        <label class="row-between" style="align-items: center"><span class="label">{{ i.t('weekStarts') }}</span>
          <select class="input" style="width: 160px" (change)="store.updateSettings({ weekStart: +$any($event.target).value })">
            <option value="1" [selected]="st().weekStart === 1">Mon</option>
            <option value="0" [selected]="st().weekStart === 0">Sun</option>
          </select>
        </label>
      </section>

      <section class="card">
        <h2 class="title">{{ i.t('backup') }}</h2>
        <div [class]="store.persisted() ? 'al note' : 'al warn'"><app-icon [name]="store.persisted() ? 'check' : 'info'" />
          <span>{{ store.persisted() ? i.t('storageKept') : i.t('storageMayClear') }}</span></div>
        <div class="row-between small"><span>{{ i.t('lastBackup') }}</span><span>{{ st().lastBackupAt ? fmtDay(st().lastBackupAt!.slice(0, 10)) : i.t('never') }}</span></div>
        <div class="row" style="flex-wrap: wrap">
          <button class="btn" type="button" (click)="download()"><app-icon name="download" [size]="18" />{{ i.t('exportBackup') }}</button>
          @if (canShare) { <button class="btn" type="button" (click)="share()"><app-icon name="share" [size]="18" />{{ i.t('shareBackup') }}</button> }
        </div>
        <label class="btn" style="position: relative"><app-icon name="upload" [size]="18" />{{ i.t('restoreBackup') }} / {{ i.t('importOld') }}
          <input type="file" accept=".json,application/json" (change)="pick($event)" style="position: absolute; inset: 0; opacity: 0; cursor: pointer" />
        </label>

        @if (pending(); as p) {
          <div class="card" style="background: var(--surface-sunk); box-shadow: none">
            @if (p.kind === 'backup') {
              <b>{{ i.pick('Backup from', 'బ్యాకప్ తేదీ') }} {{ fmtDay(p.file.exportedAt.slice(0, 10)) }}</b>
              <span class="small">{{ p.file.data.sheets.length }} {{ i.pick('days', 'రోజులు') }} · {{ p.file.data.skus.length }} {{ i.pick('brands', 'బ్రాండ్లు') }} · {{ p.file.data.inwards.length }} {{ i.pick('deliveries', 'సరుకులు') }}</span>
              @if (!p.ok) { <span class="chip bad">{{ i.pick('Checksum does not match: the file was changed.', 'చెక్‌సమ్ సరిపోలలేదు: ఫైల్ మారింది.') }}</span> }
              <span class="small">{{ i.pick('This replaces everything on this phone. A safety copy of the current data is kept so you can undo.', 'ఇది ఈ ఫోన్‌లోని మొత్తం డేటాను మారుస్తుంది. రద్దు చేయడానికి ప్రస్తుత డేటా కాపీ ఉంచబడుతుంది.') }}</span>
            } @else {
              <b>{{ i.t('importOld') }}</b>
              <span class="small">{{ p.dates.length }} {{ i.pick('days with entries', 'నమోదైన రోజులు') }}: {{ fmtDay(p.dates[0]) }} – {{ fmtDay(p.dates.at(-1)!) }}</span>
              <div class="row">
                <label class="field"><span class="cap">{{ i.t('from') }}</span><input class="input" type="date" [value]="from()" (change)="from.set($any($event.target).value)" /></label>
                <label class="field"><span class="cap">{{ i.t('to') }}</span><input class="input" type="date" [value]="to()" (change)="to.set($any($event.target).value)" /></label>
              </div>
              <span class="small">{{ i.pick('Replaces everything on this phone with those days. Duplicate brands are merged. A safety copy is kept.', 'ఈ ఫోన్‌లోని డేటాను ఆ రోజులతో మారుస్తుంది. డూప్లికేట్ బ్రాండ్లు కలుపుతారు. కాపీ ఉంచబడుతుంది.') }}</span>
            }
            <div class="row">
              <button class="btn grow" type="button" (click)="pending.set(null)">{{ i.t('cancel') }}</button>
              <button class="btn primary grow" type="button" (click)="confirmImport()">{{ i.pick('Replace data', 'డేటా మార్చు') }}</button>
            </div>
          </div>
        }

        @if (hasSafety()) {
          <button class="btn quiet" type="button" (click)="undo()">{{ i.t('undoRestore') }}</button>
        }
        <button class="btn danger" type="button" (click)="erase()"><app-icon name="trash" [size]="18" />{{ i.t('eraseAll') }}</button>
      </section>

    </main>
  `,
})
export class SettingsScreen implements OnInit {
  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  private toast = inject(Toast);
  protected fmtDay = fmtDay;
  protected monthShort = monthShort;
  protected parseCount = parseCount;
  protected group = group;
  protected round = Math.round;
  protected months = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
  protected canShare = typeof navigator !== 'undefined' && !!navigator.share && !!navigator.canShare;

  protected st = this.store.settings;
  protected pending = signal<Pending | null>(null);
  protected from = signal('');
  protected to = signal('');
  protected hasSafety = signal(false);

  async ngOnInit() {
    this.hasSafety.set(await this.store.hasSafetyCopy());
  }

  private fileName() {
    const d = new Date().toISOString().slice(0, 10);
    return `JanaPriyaLedger_backup_${d}.json`;
  }

  protected async download() {
    const file = await this.store.buildBackup();
    const blob = new Blob([JSON.stringify(file)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = this.fileName();
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    await this.store.markBackedUp();
    this.toast.show(this.i.pick('Backup downloaded', 'బ్యాకప్ డౌన్‌లోడ్ అయింది'));
  }

  protected async share() {
    const file = await this.store.buildBackup();
    const f = new File([JSON.stringify(file)], this.fileName(), { type: 'application/json' });
    if (!navigator.canShare({ files: [f] })) return this.download();
    try {
      await navigator.share({ files: [f], title: f.name });
      await this.store.markBackedUp();
    } catch {
      /* cancelled */
    }
  }

  protected async pick(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const f = input.files?.[0];
    input.value = '';
    if (!f) return;
    try {
      const o = JSON.parse(await f.text());
      if (isBackupFile(o)) {
        this.pending.set({ kind: 'backup', file: o, ok: await this.store.verifyBackup(o) });
      } else if (isLegacyBackup(o)) {
        const dates = Object.keys(o.ledgers).filter((d) => Object.keys(o.ledgers[d].entries || {}).length).sort();
        if (!dates.length) throw new Error('empty');
        this.from.set(dates[0]);
        this.to.set(dates.at(-1)!);
        this.pending.set({ kind: 'legacy', file: o, dates });
      } else {
        throw new Error('unknown');
      }
    } catch {
      this.toast.show(this.i.pick('This file is not a backup', 'ఇది బ్యాకప్ ఫైల్ కాదు'));
    }
  }

  protected async confirmImport() {
    const p = this.pending();
    if (!p) return;
    if (p.kind === 'backup') {
      await this.store.restore(p.file);
      this.toast.show(this.i.pick('Backup restored', 'బ్యాకప్ రీస్టోర్ అయింది'));
    } else {
      const out = await this.store.importLegacy(p.file, this.from(), this.to());
      this.toast.show(this.i.pick(`Imported ${out.sheets.length} days, merged ${out.merged.length} duplicate brands`, `${out.sheets.length} రోజులు దిగుమతి, ${out.merged.length} డూప్లికేట్ బ్రాండ్లు కలిపారు`), 4000);
    }
    this.pending.set(null);
    this.hasSafety.set(true);
  }

  protected async undo() {
    if (!confirm(this.i.pick('Go back to the data from before the last restore or import?', 'చివరి రీస్టోర్ ముందు డేటాకు తిరిగి వెళ్లాలా?'))) return;
    await this.store.undoRestore();
    this.hasSafety.set(false);
    this.toast.show(this.i.pick('Previous data is back', 'మునుపటి డేటా తిరిగి వచ్చింది'));
  }

  protected async erase() {
    const word = this.i.pick('ERASE', 'ERASE');
    const typed = prompt(this.i.pick(`This deletes every day, delivery and price on this phone. A safety copy is kept until the next restore. Type ${word} to continue.`, `ఈ ఫోన్‌లోని మొత్తం డేటా తొలగిస్తుంది. కొనసాగించడానికి ${word} అని టైప్ చేయండి.`));
    if (typed?.trim().toUpperCase() !== word) return;
    await this.store.eraseAll();
    this.hasSafety.set(true);
    this.toast.show(this.i.pick('All data erased', 'మొత్తం డేటా తొలగించబడింది'));
  }
}
