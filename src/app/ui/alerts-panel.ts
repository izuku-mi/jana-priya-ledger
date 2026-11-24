import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { I18n } from '../core/i18n';
import { Alert, Note } from '../core/model';
import { Icon } from './icon';

/** "Alerts and notes": every screen shows its conflicts and warnings here, plus free notes. */
@Component({
  selector: 'app-alerts',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="card tight" [attr.aria-label]="i.t('alertsNotes')">
      <div class="row-between" style="align-items: center">
        <h2 class="title">{{ i.t('alertsNotes') }}</h2>
        @if (alerts().length) {
          <span class="chip" [class.bad]="hasCritical()" [class.warn]="!hasCritical()">{{ alerts().length }}</span>
        } @else {
          <span class="chip ok"><app-icon name="check" [size]="14" />0</span>
        }
      </div>
      @for (a of alerts(); track $index) {
        <div [class]="'al ' + a.level">
          <app-icon [name]="a.level === 'critical' ? 'alert' : 'info'" />
          <span><b>{{ a.title }}</b> {{ a.body }}</span>
        </div>
      } @empty {
        <div class="cap">{{ i.t('noAlerts') }}</div>
      }
      @for (n of notes(); track n.id) {
        <div class="al note">
          <app-icon name="note" />
          <span class="grow">{{ n.text }}</span>
          <button class="btn quiet icon" type="button" style="min-height: 28px; height: 28px; width: 28px" [attr.aria-label]="i.t('delete')" (click)="remove.emit(n.id)">
            <app-icon name="close" [size]="16" />
          </button>
        </div>
      }
      <form class="row" (submit)="$event.preventDefault(); submit()">
        <input class="input grow" [attr.aria-label]="i.t('addNote')" [placeholder]="i.t('addNote')" [value]="draft()" (input)="draft.set($any($event.target).value)" />
        <button class="btn" type="submit" [disabled]="!draft().trim()">{{ i.t('add') }}</button>
      </form>
    </section>
  `,
})
export class AlertsPanel {
  protected i = inject(I18n);
  readonly alerts = input<Alert[]>([]);
  readonly notes = input<Note[]>([]);
  readonly add = output<string>();
  readonly remove = output<string>();
  protected draft = signal('');
  protected hasCritical = computed(() => this.alerts().some((a) => a.level === 'critical'));

  protected submit() {
    const text = this.draft().trim();
    if (!text) return;
    this.add.emit(text);
    this.draft.set('');
  }
}
