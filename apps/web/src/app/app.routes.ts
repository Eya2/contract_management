import { Routes } from '@angular/router';

/**
 * Every feature is lazy-loaded, so the login page doesn't download the contract
 * editor or the signature pad.
 */
export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
  },
  { path: '**', redirectTo: '' },
];
