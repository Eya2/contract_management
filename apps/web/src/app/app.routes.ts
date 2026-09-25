import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards';

/**
 * Every feature is lazy-loaded, so the login page doesn't download the contract
 * editor or the signature pad.
 */
export const routes: Routes = [
  { path: 'login', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  // Public: external signers arrive here from their email, without an account.
  { path: 'sign/:token', loadComponent: () => import('./features/signing/public-sign.page').then((m) => m.PublicSignPage) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', title: 'Dashboard · Contract Hub', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'contracts', title: 'Contracts · Contract Hub', loadComponent: () => import('./features/contracts/contracts-list.page').then((m) => m.ContractsListPage) },
      { path: 'contracts/new', title: 'New contract · Contract Hub', loadComponent: () => import('./features/contracts/contract-form.page').then((m) => m.ContractFormPage) },
      { path: 'contracts/:id', title: 'Contract · Contract Hub', loadComponent: () => import('./features/contracts/contract-detail.page').then((m) => m.ContractDetailPage) },
      { path: 'contracts/:id/edit', title: 'Edit contract · Contract Hub', loadComponent: () => import('./features/contracts/contract-form.page').then((m) => m.ContractFormPage) },
      { path: 'approvals', title: 'Approvals · Contract Hub', loadComponent: () => import('./features/approvals/approvals.page').then((m) => m.ApprovalsPage) },
    ],
  },
  { path: '**', redirectTo: '' },
];
