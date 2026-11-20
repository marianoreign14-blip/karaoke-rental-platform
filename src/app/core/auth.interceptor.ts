import { HttpErrorResponse } from '@angular/common/http';
import type { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, throwError } from 'rxjs';

import { ApiService } from './api.service';

export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const api = inject(ApiService);
  const router = inject(Router);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !request.url.includes('/auth/login') &&
        !request.url.includes('/auth/register') &&
        !request.url.includes('/auth/business-register') &&
        api.user() !== null
      ) {
        api.logout('Your session expired. Sign in again to continue.');
        void router.navigateByUrl('/account');
      }
      return throwError(() => error);
    }),
  );
};
