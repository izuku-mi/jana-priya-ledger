import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { I18n } from './core/i18n';
import { LedgerStore } from './core/store';
import { Icon } from './ui/icon';
import { Toast } from './ui/toast';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.ready()) {
      <router-outlet />
      <nav class="nav" aria-label="Main">
        <a routerLink="/dashboard" routerLinkActive="on" ariaCurrentWhenActive="page"><app-icon name="home" [size]="22" />{{ i.t('home') }}</a>
        <a routerLink="/entry" routerLinkActive="on" ariaCurrentWhenActive="page"><app-icon name="list" [size]="22" />{{ i.t('entry') }}</a>
        <a routerLink="/stock" routerLinkActive="on" ariaCurrentWhenActive="page"><app-icon name="chart" [size]="22" />{{ i.t('stock') }}</a>
        <a routerLink="/pnl" routerLinkActive="on" ariaCurrentWhenActive="page"><app-icon name="wallet" [size]="22" />{{ i.t('pnl') }}</a>
        <a routerLink="/settings" routerLinkActive="on" ariaCurrentWhenActive="page"><app-icon name="settings" [size]="22" />{{ i.t('settings') }}</a>
      </nav>
    }
    @if (toast.message(); as m) {
      <div class="toast" role="status">{{ m }}</div>
    }
  `,
})
export class App {
  /** Shortest time the splash stays up, from page start. */
  static readonly SPLASH_MIN_MS = 1200;

  protected store = inject(LedgerStore);
  protected i = inject(I18n);
  protected toast = inject(Toast);

  constructor() {
    // Take the splash from index.html away once data is loaded, after it has been seen for at least a moment.
    effect(() => {
      if (!this.store.ready()) return;
      const wait = Math.max(0, App.SPLASH_MIN_MS - performance.now());
      setTimeout(() => document.getElementById('splash')?.remove(), wait);
    });
    effect(() => {
      const s = this.store.settings();
      document.documentElement.setAttribute('data-theme', s.dark ? 'dark' : 'light');
      document.documentElement.lang = s.lang;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', s.dark ? '#1a1618' : '#fbf8f4');
    });
  }
}
