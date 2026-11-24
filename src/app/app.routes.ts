import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
  { path: 'dashboard', loadComponent: () => import('./screens/dashboard').then((m) => m.Dashboard) },
  { path: 'entry', loadComponent: () => import('./screens/entry').then((m) => m.Entry) },
  { path: 'entry/:date', loadComponent: () => import('./screens/entry').then((m) => m.Entry) },
  { path: 'inward/:date', loadComponent: () => import('./screens/inward').then((m) => m.InwardScreen) },
  { path: 'report', loadComponent: () => import('./screens/report').then((m) => m.Report) },
  { path: 'report/:date', loadComponent: () => import('./screens/report').then((m) => m.Report) },
  { path: 'stock', loadComponent: () => import('./screens/stock').then((m) => m.Stock) },
  { path: 'pnl', loadComponent: () => import('./screens/pnl').then((m) => m.Pnl) },
  { path: 'settings', loadComponent: () => import('./screens/settings').then((m) => m.SettingsScreen) },
  { path: '**', redirectTo: 'dashboard' },
];
