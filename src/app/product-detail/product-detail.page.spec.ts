import type { ComponentFixture } from '@angular/core/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { ApiService } from '../core/api.service';
import type { ProductDetail } from '../core/api.service';
import { CartService } from '../core/cart.service';

import { ProductDetailPage } from './product-detail.page';

describe('ProductDetailPage', () => {
  let fixture: ComponentFixture<ProductDetailPage>;
  let component: ProductDetailPage;
  let cart: CartService;

  const sampleDetail: ProductDetail = {
    id: 42,
    business_id: 7,
    business_name: 'Melody Rentals',
    business_slug: 'melody-rentals',
    name: 'Premium Karaoke Rig',
    description: 'Includes dual wireless mics',
    category: 'karaoke',
    quality_tier_id: 3,
    quality_name: 'Premium',
    price_cents: 180000,
    pricing_basis: 'per_rental',
    pricing_configured: true,
    billing_interval_minutes: null,
    rounding_rule: null,
    image_url: null,
    is_active: true,
    stock_count: 4,
    available_count: 3,
    business: {
      id: 7,
      name: 'Melody Rentals',
      slug: 'melody-rentals',
      description: 'Party audio specialists',
      contact_email: 'hello@melody.example.com',
      contact_phone: '09171112222',
      address: 'Cebu City',
      logo_url: null,
      banner_url: null,
      brand_primary: '#252729',
      brand_secondary: '#fffdf8',
      brand_accent: '#a63d40',
      is_listed: true,
      status: 'active',
      subscription_plan: 'starter',
      subscription_status: 'active',
      subscription_ends_at: null,
      created_at: '2026-11-20T00:00:00Z',
    },
  };

  beforeEach(async () => {
    sessionStorage.clear();
    await TestBed.configureTestingModule({
      imports: [ProductDetailPage],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: '42' })) } },
        {
          provide: ApiService,
          useValue: {
            productDetail: () => of(sampleDetail),
          },
        },
      ],
    }).compileComponents();

    cart = TestBed.inject(CartService);
    fixture = TestBed.createComponent(ProductDetailPage);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads product detail and adds selected quantity into shared CartService', () => {
    expect(component.product?.name).toBe('Premium Karaoke Rig');
    component.quantity = 2;
    component.addToRequest();

    expect(component.error).toBe('');
    expect(cart.count()).toBe(2);
    expect(cart.items()[0].business_id).toBe(7);
  });
});
