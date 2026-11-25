import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Stroke icons on a 24px grid, 2px stroke, round caps, coloured by currentColor. */
const PATHS: Record<string, string> = {
  home: 'M4 11l8-7 8 7v9H4z',
  list: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  wallet: 'M3 7h18v12H3zM3 11h18M16 15h2',
  settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
  left: 'M15 5l-7 7 7 7',
  right: 'M9 5l7 7-7 7',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18',
  sync: 'M4 12a8 8 0 0114-5.3L20 9M20 4v5h-5M20 12a8 8 0 01-14 5.3L4 15M4 20v-5h5',
  alert: 'M12 3l10 18H2zM12 10v5M12 18v.01',
  info: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 8v5M12 16v.01',
  check: 'M5 12l5 5 9-10',
  down: 'M6 9l6 6 6-6',
  up: 'M6 15l6-6 6 6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4',
  download: 'M12 3v12M7 10l5 5 5-5M5 20h14',
  upload: 'M12 15V3M7 8l5-5 5 5M5 20h14',
  share: 'M12 15V3M7 8l5-5 5 5M5 13v7h14v-7',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  moon: 'M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z',
  sun: 'M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  note: 'M5 4h10l4 4v12H5zM15 4v4h4M9 13h6M9 17h4',
  tag: 'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
  more: 'M12 4a1 1 0 100 2 1 1 0 100-2zM12 11a1 1 0 100 2 1 1 0 100-2zM12 18a1 1 0 100 2 1 1 0 100-2z',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<svg viewBox="0 0 24 24" aria-hidden="true" [attr.width]="size()" [attr.height]="size()"><path [attr.d]="d()" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>`,
  styles: `:host { display: inline-flex; line-height: 0; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(20);
  protected readonly d = computed(() => PATHS[this.name()] ?? '');
}

/** The bottle mark: wine bottle with a gold label. `outline` draws the empty-state version. */
@Component({
  selector: 'app-bottle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 72 96" [attr.width]="w()" [attr.height]="w() * 96 / 72" aria-hidden="true">
      @if (outline()) {
        <path d="M30 6h12v14c0 6 12 10 12 22v44a6 6 0 01-6 6H24a6 6 0 01-6-6V42c0-12 12-16 12-22z" fill="none" stroke="var(--ink-muted)" stroke-width="2.5" stroke-linejoin="round" />
        <rect x="22" y="52" width="28" height="22" rx="4" fill="var(--wine)" />
      } @else {
        <path d="M30 6h12v14c0 6 12 10 12 22v44a6 6 0 01-6 6H24a6 6 0 01-6-6V42c0-12 12-16 12-22z" fill="var(--wine)" />
        <rect x="22" y="52" width="28" height="22" rx="4" fill="var(--gold)" />
      }
    </svg>`,
  styles: `:host { display: inline-flex; line-height: 0; flex: none; }`,
})
export class Bottle {
  readonly w = input(28);
  readonly outline = input(false);
}
