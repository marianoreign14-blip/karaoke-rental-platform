import { inject } from '@angular/core';
import type { CanActivateFn, Routes } from '@angular/router';
import { Router } from '@angular/router';

import { ApiService } from './core/api.service';

const businessAdministratorOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  const role = api.user()?.role;
  return role === 'business_admin' || role === 'business_staff'
    ? true
    : router.createUrlTree([role === 'platform_admin' ? '/platform' : '/account']);
};

const platformAdministratorOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  return api.user()?.role === 'platform_admin' ? true : router.createUrlTree(['/account']);
};

export const routes: Routes = [
  {
    path: 'home',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'business/:slug',
    loadComponent: () => import('./home/home.page').then((m) => m.HomePage),
  },
  {
    path: 'business-register',
    loadComponent: () => import('./business-register/business-register.page').then((m) => m.BusinessRegisterPage),
  },
  {
    path: 'account',
    loadComponent: () => import('./account/account.page').then((m) => m.AccountPage),
  },
  {
    path: 'admin',
    canActivate: [businessAdministratorOnly],
    loadComponent: () => import('./admin/admin.page').then((m) => m.AdminPage),
  },
  {
    path: 'platform',
    canActivate: [platformAdministratorOnly],
    loadComponent: () => import('./platform/platform.page').then((m) => m.PlatformPage),
  },
  {
    path: '',
    redirectTo: 'home',
    pathMatch: 'full',
  },
  {
    path: '**',
    redirectTo: 'home',
  },
];
