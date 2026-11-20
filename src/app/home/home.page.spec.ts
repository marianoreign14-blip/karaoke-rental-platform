import { signal } from '@angular/core';
import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../core/api.service';
import type { Product } from '../core/api.service';

import { HomePage } from './home.page';

describe('HomePage', () => {
  let component: HomePage;
  let fixture: ComponentFixture<HomePage>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HomePage],
      providers: [
        provideRouter([]),
        {
          provide: ApiService,
          useValue: {
            user: signal(null),
            marketplaceBusinesses: () => of([]),
            marketplaceBusiness: () => of(null),
            qualityTiers: () => of([]),
            categories: () => of([]),
            products: () => of([]),
            packages: () => of([]),
            notifications: () => of({ unread_count: 0, items: [] }),
          },
        },
      ],
    }).compileComponents();
    sessionStorage.clear();
    fixture = TestBed.createComponent(HomePage);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('keeps a rental request limited to one business', () => {
    const makeProduct = (id: number, businessId: number): Product => ({
      id,
      business_id: businessId,
      business_name: `Business ${businessId}`,
      business_slug: `business-${businessId}`,
      name: `Product ${id}`,
      description: '',
      specifications: {},
      category: 'karaoke',
      quality_tier_id: 1,
      quality_name: 'Standard',
      price_cents: 15000,
      pricing_basis: 'per_rental',
      pricing_configured: true,
      billing_interval_minutes: null,
      rounding_rule: null,
      image_url: null,
      is_active: true,
      stock_count: 1,
      available_count: 1,
    });

    component.addProduct(makeProduct(1, 10));
    component.addProduct(makeProduct(2, 20));

    expect(component.cart).toHaveLength(1);
    expect(component.cart[0].business_id).toBe(10);
    expect(component.error).toContain('one business rental request at a time');
  });

  it('renders PHP currency totals with registered en-PH locale without throwing NG0701', () => {
    component.addProduct({
      id: 1,
      business_id: 10,
      business_name: 'EchoVibe',
      business_slug: 'echovibe',
      name: 'Standard Karaoke',
      description: '',
      specifications: {},
      category: 'karaoke',
      quality_tier_id: 1,
      quality_name: 'Standard',
      price_cents: 100000,
      pricing_basis: 'per_rental',
      pricing_configured: true,
      billing_interval_minutes: null,
      rounding_rule: null,
      image_url: null,
      is_active: true,
      stock_count: 2,
      available_count: 2,
    });
    component.quoteTotal = 100000;
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('1,000.00');
  });

  it('paginates the marketplace equipment list and clamps the current page', () => {
    const sample: Product = {
      id: 1,
      business_id: 1,
      business_name: 'EchoVibe',
      business_slug: 'echovibe',
      name: 'Karaoke equipment',
      description: '',
      specifications: {},
      category: 'Karaoke Machines',
      quality_tier_id: 1,
      quality_name: 'Standard',
      price_cents: 100000,
      pricing_basis: 'per_rental',
      pricing_configured: true,
      billing_interval_minutes: null,
      rounding_rule: null,
      image_url: null,
      is_active: true,
      stock_count: 1,
      available_count: null,
    };
    component.products = Array.from({ length: 13 }, (_, index) => ({ ...sample, id: index + 1 }));

    expect(component.productPageCount).toBe(2);
    expect(component.pagedProducts).toHaveLength(12);
    component.setProductPage(2);
    expect(component.pagedProducts).toHaveLength(1);
    component.setProductPage(5);
    expect(component.productPage).toBe(2);
  });
});
