import { inject } from '@angular/core';
import type { CanActivateFn, Routes } from '@angular/router';
import { Router } from '@angular/router';

import { ApiService } from './core/api.service';

const customerOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  if (!api.hasValidSession()) {
    return router.createUrlTree(['/account']);
  }
  return api.user()?.role === 'customer' ? true : router.createUrlTree(['/account']);
};

const businessAdministratorOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  if (!api.hasValidSession()) {
    return router.createUrlTree(['/account']);
  }
  const role = api.user()?.role;
  return role === 'business_admin' || role === 'business_staff'
    ? true
    : router.createUrlTree([role === 'platform_admin' ? '/platform' : '/account']);
};

const platformAdministratorOnly: CanActivateFn = () => {
  const api = inject(ApiService);
  const router = inject(Router);
  if (!api.hasValidSession()) {
    return router.createUrlTree(['/account']);
  }
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
    path: 'products/:id',
    loadComponent: () => import('./product-detail/product-detail.page').then((m) => m.ProductDetailPage),
  },
  {
    path: 'packages/:id',
    loadComponent: () => import('./package-detail/package-detail.page').then((m) => m.PackageDetailPage),
  },
  {
    path: 'orders/:id',
    canActivate: [customerOnly],
    loadComponent: () => import('./order-detail/order-detail.page').then((m) => m.OrderDetailPage),
  },
  {
    path: 'business-register',
    loadComponent: () => import('./business-register/business-register.page').then((m) => m.BusinessRegisterPage),
  },
  {
    path: 'forgot-password',
    loadComponent: () => import('./forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
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
