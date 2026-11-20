import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api.service';

import { ResetPasswordPage } from './reset-password.page';

describe('ResetPasswordPage', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let component: ResetPasswordPage;
  const resetPassword = vi.fn().mockReturnValue(of({ reset: true, message: 'Password reset.' }));

  beforeEach(async () => {
    resetPassword.mockClear();
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [
        provideRouter([]),
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap({ token: 'abcdef1234567890token' }) } },
        },
        {
          provide: ApiService,
          useValue: { resetPassword },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ResetPasswordPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('prefills token from query string and validates matching password before calling API', async () => {
    expect(component.token).toBe('abcdef1234567890token');

    component.newPassword = 'new-strong-password-12';
    component.confirmPassword = 'mismatch-password-12';
    await component.submit();
    expect(component.error).toContain('does not match');
    expect(resetPassword).not.toHaveBeenCalled();

    component.confirmPassword = 'new-strong-password-12';
    await component.submit();
    expect(resetPassword).toHaveBeenCalledWith('abcdef1234567890token', 'new-strong-password-12');
    expect(component.completed).toBe(true);
  });
});
