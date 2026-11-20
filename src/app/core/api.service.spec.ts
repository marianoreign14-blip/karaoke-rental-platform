import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';

import { ApiService, extractApiError } from './api.service';

describe('ApiService & extractApiError', () => {
  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [provideHttpClient()],
    });
  });

  afterEach(() => {
    sessionStorage.clear();
  });

  it('formats FastAPI string errors, 422 validation arrays, 429 rate limits, and network errors', () => {
    expect(extractApiError({ status: 409, error: { detail: 'Conflict error' } }, 'fallback')).toBe('Conflict error');
    expect(
      extractApiError(
        {
          status: 422,
          error: {
            detail: [
              { loc: ['body', 'business_name'], msg: 'String should have at least 2 characters' },
              { loc: ['body', 'password'], msg: 'Value error, Password is too short' },
            ],
          },
        },
        'fallback',
      ),
    ).toBe('business name: String should have at least 2 characters · password: Password is too short');
    expect(extractApiError({ status: 429 }, 'fallback')).toContain('Too many requests');
    expect(extractApiError({ status: 0 }, 'fallback')).toContain('Cannot reach the server');
    expect(extractApiError({}, 'fallback')).toBe('fallback');
  });

  it('rejects and clears expired session tokens', () => {
    const expiredPayload = btoa(JSON.stringify({ sub: '1', exp: Math.floor(Date.now() / 1000) - 60 }));
    sessionStorage.setItem('karaokewebapp.access-token', `header.${expiredPayload}.sig`);
    sessionStorage.setItem(
      'karaokewebapp.user',
      JSON.stringify({ id: 1, email: 'a@b.com', display_name: 'A', phone: null, role: 'customer', business_id: null }),
    );

    const api = TestBed.inject(ApiService);
    expect(api.user()).toBeNull();
    expect(api.hasValidSession()).toBe(false);
    expect(sessionStorage.getItem('karaokewebapp.access-token')).toBeNull();
  });
});
