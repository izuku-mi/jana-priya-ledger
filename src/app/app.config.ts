import { ApplicationConfig, inject, isDevMode, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { routes } from './app.routes';
import { IndexedDbRepository } from './core/indexeddb-repository';
import { LEDGER_REPOSITORY } from './core/repository';
import { LedgerStore } from './core/store';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Where data lives. Swap this one line for a server-backed repository later.
    { provide: LEDGER_REPOSITORY, useFactory: () => new IndexedDbRepository() },
    provideRouter(routes, withComponentInputBinding()),
    provideAppInitializer(() => inject(LedgerStore).init()),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
  ],
};
