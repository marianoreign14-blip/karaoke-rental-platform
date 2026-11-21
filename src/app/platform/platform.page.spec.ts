import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api.service';
import type { User } from '../core/api.service';

import { PlatformPage } from './platform.page';

describe('PlatformPage', () => {
  let fixture: ComponentFixture<PlatformPage>;
  let component: PlatformPage;

  beforeEach(async () => {
    const adminUser = signal<User | null>({
      id: 1,
      email: 'platform@example.com',
      display_name: 'Platform Admin',
      phone: null,
      role: 'platform_admin',
      business_id: null,
    });

    await TestBed.configureTestingModule({
      imports: [PlatformPage],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: {
            user: adminUser.asReadonly(),
            hasValidSession: () => adminUser() !== null,
            logout: vi.fn(() => adminUser.set(null)),
            platformSummary: () =>
              of({ businesses: 2, active_businesses: 1, pending_businesses: 1, customers: 5, orders: 3 }),
            platformBusinesses: () => of([]),
            platformSettings: () => of({ marketplace_name: 'Karaoke Marketplace' }),
            platformAuditLogs: () => of([]),
            platformUsers: () =>
              of([
                {
                  id: 1,
                  email: 'platform@example.com',
                  display_name: 'Platform Admin',
                  phone: null,
                  role: 'platform_admin',
                  business_id: null,
                  business_name: null,
                  is_active: true,
                  order_count: 0,
                  created_at: '2026-11-20T00:00:00Z',
                },
              ]),
            platformProducts: () => of([]),
            platformOrders: () => of([]),
            platformOrderSummary: () => of({ total: 0, orders_by_status: {}, total_value_cents: 0 }),
            platformOrderDetail: () => of(null),
            platformPayments: () => of([]),
            platformReports: () =>
              of({
                orders: 3,
                orders_by_status: { completed: 3 },
                total_order_value_cents: 500000,
                verified_collections_cents: 450000,
                businesses: [],
              }),
            notifications: () => of({ unread_count: 1, items: [] }),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PlatformPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads platform monitoring summary, reports, users, and unread notifications', () => {
    expect(component.summary?.businesses).toBe(2);
    expect(component.users).toHaveLength(1);
    expect(component.report?.verified_collections_cents).toBe(450000);
    expect(component.unreadNotifications).toBe(1);
  });

  it('pauses 60-second auto-refresh when document is hidden and refreshes when visible', async () => {
    const refreshSpy = vi.spyOn(component, 'refresh').mockResolvedValue();
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get');

    visibilitySpy.mockReturnValue('hidden');
    await component.refreshIfVisibleAndIdle();
    expect(refreshSpy).not.toHaveBeenCalled();

    visibilitySpy.mockReturnValue('visible');
    await component.refreshIfVisibleAndIdle();
    expect(refreshSpy).toHaveBeenCalledTimes(1);

    visibilitySpy.mockRestore();
    component.stopAutoRefresh();
  });
});
