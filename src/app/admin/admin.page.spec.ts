import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { ApiService } from '../core/api.service';
import type { Business, Product, User } from '../core/api.service';

import { AdminPage } from './admin.page';

describe('AdminPage', () => {
  const sampleBusiness: Business = {
    id: 1,
    name: 'Test Karaoke',
    slug: 'test-karaoke',
    description: '',
    contact_email: null,
    contact_phone: null,
    address: null,
    logo_url: null,
    banner_url: null,
    brand_primary: '#252729',
    brand_secondary: '#fffdf8',
    brand_accent: '#a63d40',
    is_listed: true,
    status: 'active',
    subscription_plan: 'demo',
    subscription_status: 'active',
    subscription_ends_at: null,
    created_at: '2026-11-20T00:00:00Z',
  };

  const sampleProduct: Product = {
    id: 10,
    business_id: 1,
    business_name: 'Test Karaoke',
    business_slug: 'test-karaoke',
    name: 'Standard Karaoke',
    description: '',
    category: 'karaoke',
    quality_tier_id: 2,
    quality_name: 'Standard',
    price_cents: 100000,
    pricing_basis: 'per_rental',
    pricing_configured: true,
    billing_interval_minutes: null,
    rounding_rule: null,
    image_url: null,
    is_active: true,
    stock_count: 3,
    available_count: null,
  };

  function setup(role: User['role']) {
    const saveProduct = vi.fn().mockReturnValue(of(sampleProduct));
    const setProductPrice = vi.fn().mockReturnValue(of(sampleProduct));
    const setProductStock = vi.fn().mockReturnValue(of(sampleProduct));
    const businessStaff = vi.fn().mockReturnValue(of([]));
    const adminAuditLogs = vi.fn().mockReturnValue(of([]));

    const userSignal = signal<User | null>({
      id: 1,
      email: 'owner@example.com',
      display_name: 'Owner',
      phone: null,
      role,
      business_id: 1,
    });

    TestBed.configureTestingModule({
      imports: [AdminPage],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: {
            user: userSignal.asReadonly(),
            isBusinessAdmin: signal(role === 'business_admin').asReadonly(),
            hasValidSession: () => userSignal() !== null,
            logout: vi.fn(() => userSignal.set(null)),
            adminOrders: () => of([]),
            adminRequests: () => of([]),
            adminProducts: () => of([sampleProduct]),
            adminTiers: () => of([{ id: 2, name: 'Standard', is_active: true }]),
            adminPackages: () => of([]),
            inventory: () => of([]),
            customers: () => of([]),
            report: () =>
              of({
                orders: 0,
                assets_in_available_condition: 3,
                verified_collections_cents: 0,
                collections_note: '',
              }),
            adminCategories: () => of([{ id: 1, name: 'karaoke', is_active: true }]),
            businessSettings: () => of(sampleBusiness),
            businessStaff,
            adminAuditLogs,
            adminPayments: () => of([]),
            adminCalendar: () => of([]),
            notifications: () => of({ unread_count: 0, items: [] }),
            saveProduct,
            setProductPrice,
            setProductStock,
          },
        },
      ],
    });

    const fixture: ComponentFixture<AdminPage> = TestBed.createComponent(AdminPage);
    const component = fixture.componentInstance;
    fixture.detectChanges();
    return { fixture, component, saveProduct, setProductPrice, setProductStock, businessStaff, adminAuditLogs };
  }

  it('handles numeric ngModel values without throwing trim errors when saving products and inline drafts', async () => {
    const { component, saveProduct, setProductPrice, setProductStock } = setup('business_admin');
    await component.refresh();

    component.productName = 'Portable Set';
    component.productCategory = 'karaoke';
    component.productQualityId = '2';
    // Angular NumberValueAccessor assigns numbers at runtime for <input type="number">
    (component as unknown as { productPrice: number }).productPrice = 1500;
    (component as unknown as { productInitialStock: number }).productInitialStock = 4;

    await component.saveProduct();
    expect(component.error).toBe('');
    expect(saveProduct).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Portable Set',
        price_cents: 150000,
        initial_stock: 4,
      }),
      undefined,
    );

    component.productPriceDrafts[10] = 1250;
    await component.saveInlinePrice(sampleProduct);
    expect(setProductPrice).toHaveBeenCalledWith(10, 125000);

    component.productStockDrafts[10] = 5;
    await component.saveInlineStock(sampleProduct);
    expect(setProductStock).toHaveBeenCalledWith(10, 5);
  });

  it('does not fetch owner-only staff or audit log endpoints for business_staff accounts', async () => {
    const { component, businessStaff, adminAuditLogs } = setup('business_staff');
    await component.refresh();

    expect(businessStaff).not.toHaveBeenCalled();
    expect(adminAuditLogs).not.toHaveBeenCalled();
    expect(component.visibleSections.map((section) => section.id)).not.toContain('staff');
    expect(component.visibleSections.map((section) => section.id)).not.toContain('settings');
  });
});
