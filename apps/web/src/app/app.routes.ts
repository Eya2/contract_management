import { Routes } from '@angular/router';
import { authGuard, guestGuard, permissionGuard } from './core/guards';

/**
 * Every feature is lazy-loaded, so the login page doesn't download the contract
 * editor or the signature pad.
 */
export const routes: Routes = [
  { path: 'login', title: 'Sign in · Contract Hub', canActivate: [guestGuard], loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage) },
  { path: 'forgot-password', title: 'Forgot password · Contract Hub', loadComponent: () => import('./features/auth/forgot-password.page').then((m) => m.ForgotPasswordPage) },
  { path: 'reset-password', title: 'Reset password · Contract Hub', loadComponent: () => import('./features/auth/reset-password.page').then((m) => m.ResetPasswordPage) },
  // Public: external signers arrive here from their email, without an account.
  { path: 'sign/:token', title: 'Sign · Contract Hub', loadComponent: () => import('./features/signing/public-sign.page').then((m) => m.PublicSignPage) },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell').then((m) => m.Shell),
    children: [
      { path: '', pathMatch: 'full', title: 'Dashboard · Contract Hub', loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage) },
      { path: 'contracts', title: 'Contracts · Contract Hub', loadComponent: () => import('./features/contracts/contracts-list.page').then((m) => m.ContractsListPage) },
      { path: 'contracts/new', title: 'New contract · Contract Hub', canActivate: [permissionGuard('contract.create')], loadComponent: () => import('./features/contracts/contract-form.page').then((m) => m.ContractFormPage) },
      { path: 'contracts/:id', title: 'Contract · Contract Hub', loadComponent: () => import('./features/contracts/contract-detail.page').then((m) => m.ContractDetailPage) },
      { path: 'contracts/:id/edit', title: 'Edit contract · Contract Hub', canActivate: [permissionGuard('contract.update')], loadComponent: () => import('./features/contracts/contract-form.page').then((m) => m.ContractFormPage) },
      { path: 'approvals', title: 'Approvals · Contract Hub', canActivate: [permissionGuard('approval.decide')], loadComponent: () => import('./features/approvals/approvals.page').then((m) => m.ApprovalsPage) },
      { path: 'notifications', title: 'Notifications · Contract Hub', loadComponent: () => import('./features/notifications/notifications.page').then((m) => m.NotificationsPage) },
      { path: 'settings', title: 'Account settings · Contract Hub', loadComponent: () => import('./features/account/settings.page').then((m) => m.SettingsPage) },
      {
        path: 'admin',
        children: [
          { path: 'people', title: 'People & teams · Contract Hub', canActivate: [permissionGuard('user.manage')], loadComponent: () => import('./features/admin/people.page').then((m) => m.PeoplePage) },
          { path: 'policies', title: 'Approval policies · Contract Hub', canActivate: [permissionGuard('workflow.manage')], loadComponent: () => import('./features/admin/policies.page').then((m) => m.PoliciesPage) },
          { path: 'policies/new', title: 'New policy · Contract Hub', canActivate: [permissionGuard('workflow.manage')], loadComponent: () => import('./features/admin/policy-editor.page').then((m) => m.PolicyEditorPage) },
          { path: 'policies/:id', title: 'Edit policy · Contract Hub', canActivate: [permissionGuard('workflow.manage')], loadComponent: () => import('./features/admin/policy-editor.page').then((m) => m.PolicyEditorPage) },
          { path: 'emails', title: 'Email delivery · Contract Hub', canActivate: [permissionGuard('workflow.manage')], loadComponent: () => import('./features/admin/emails.page').then((m) => m.EmailsPage) },
          { path: 'audit', title: 'Audit log · Contract Hub', canActivate: [permissionGuard('audit.read')], loadComponent: () => import('./features/admin/audit.page').then((m) => m.AuditPage) },
        ],
      },
      { path: '**', title: 'Not found · Contract Hub', loadComponent: () => import('./features/not-found.page').then((m) => m.NotFoundPage) },
    ],
  },
];
