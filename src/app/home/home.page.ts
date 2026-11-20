import { CommonModule, CurrencyPipe } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink, RouterLinkActive } from '@angular/router';
import {
  IonBadge,
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonSelect,
  IonSelectOption,
  IonSpinner,
  IonToolbar,
} from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';
import type { Business, OrderDraft, Product, RentalPackage } from '../core/api.service';

type CartEntry = {
  key: string;
  kind: 'product' | 'package';
  business_id: number;
  item_id: number;
  name: string;
  quantity: number;
  price_cents: number | null;
  pricing_configured: boolean;
};

@Component({
  selector: 'app-home',
  templateUrl: './home.page.html',
  styleUrls: ['./home.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    FormsModule,
    RouterLink,
    RouterLinkActive,
    IonBadge,
    IonButton,
    IonContent,
    IonHeader,
    IonInput,
    IonSelect,
    IonSelectOption,
    IonSpinner,
    IonToolbar,
  ],
})
export class HomePage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly user = this.api.user;
  products: Product[] = [];
  packages: RentalPackage[] = [];
  tiers: { id: number; name: string }[] = [];
  categories: { id: number; name: string }[] = [];
  businesses: Business[] = [];
  selectedBusiness: Business | null = null;
  businessSearch = '';
  cart: CartEntry[] = [];
  search = '';
  category = '';
  qualityTier = '';
  sort = 'name';
  startsInput = '';
  endsInput = '';
  quoteTotal: number | null = null;
  loading = false;
  submitting = false;
  error = '';
  notice = '';
  private lastDraft: OrderDraft | null = null;

  get cartCount(): number {
    return this.cart.reduce((count, item) => count + item.quantity, 0);
  }

  get rentalWindowError(): string {
    if (!this.startsInput || !this.endsInput) {
      return '';
    }

    const starts = new Date(this.startsInput);
    const ends = new Date(this.endsInput);
    return Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts
      ? 'End date and time must be after the start.'
      : '';
  }

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    firstValueFrom(this.api.marketplaceBusinesses())
      .then((businesses) => {
        this.businesses = businesses;
        if (slug) {
          return firstValueFrom(this.api.marketplaceBusiness(slug)).then((business) => {
            this.selectedBusiness = business;
            this.loadBusinessFilters();
            this.loadCatalog();
          });
        }
        this.loadCatalog();
        return undefined;
      })
      .catch((error: unknown) => {
        this.error = this.errorMessage(error);
        this.changeDetector.markForCheck();
      });
  }

  get filteredBusinesses(): Business[] {
    const term = this.businessSearch.trim().toLowerCase();
    return this.businesses.filter(
      (business) =>
        !term || business.name.toLowerCase().includes(term) || business.description.toLowerCase().includes(term),
    );
  }

  loadCatalog(): void {
    this.loading = true;
    this.error = '';
    const availability = this.rentalWindow();
    const filters = {
      search: this.search.trim(),
      category: this.category,
      quality_tier_id: this.qualityTier ? Number(this.qualityTier) : undefined,
      business_id: this.selectedBusiness?.id,
      sort: this.sort,
      starts_at: availability?.starts_at,
      ends_at: availability?.ends_at,
    };
    Promise.all([
      firstValueFrom(this.api.products(filters)),
      firstValueFrom(this.api.packages(availability?.starts_at, availability?.ends_at, this.selectedBusiness?.id)),
    ])
      .then(([products, packages]) => {
        this.products = products;
        this.packages = packages;
        if (!this.selectedBusiness) {
          this.categories = [...new Set(products.map((product) => product.category))].map((name, index) => ({
            id: index,
            name,
          }));
        }
      })
      .catch((error: unknown) => (this.error = this.errorMessage(error)))
      .finally(() => {
        this.loading = false;
        this.changeDetector.markForCheck();
      });
  }

  addProduct(product: Product): void {
    this.addCartItem({
      key: `product-${product.id}`,
      kind: 'product',
      business_id: product.business_id,
      item_id: product.id,
      name: product.name,
      quantity: 1,
      price_cents: product.price_cents,
      pricing_configured: product.pricing_configured,
    });
  }

  addPackage(rentalPackage: RentalPackage): void {
    this.addCartItem({
      key: `package-${rentalPackage.id}`,
      kind: 'package',
      business_id: rentalPackage.business_id,
      item_id: rentalPackage.id,
      name: rentalPackage.name,
      quantity: 1,
      price_cents: rentalPackage.price_cents,
      pricing_configured: rentalPackage.pricing_configured,
    });
  }

  changeQuantity(key: string, value: string | number | null | undefined): void {
    const quantity = Math.min(1000, Math.max(0, Number(value) || 0));
    if (quantity === 0) {
      this.cart = this.cart.filter((entry) => entry.key !== key);
    } else {
      this.cart = this.cart.map((entry) => (entry.key === key ? { ...entry, quantity } : entry));
    }
    this.clearQuote();
  }

  async calculateQuote(): Promise<void> {
    const draft = this.createDraft();
    if (!draft) {
      this.error = 'Choose a rental start and end time and add at least one item.';
      return;
    }
    this.loading = true;
    this.error = '';
    this.notice = '';
    this.quoteTotal = null;
    try {
      const quote = await firstValueFrom(this.api.quote(draft));
      this.quoteTotal = quote.total_cents;
      this.lastDraft = draft;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async submitOrder(): Promise<void> {
    const draft = this.createDraft();
    if (
      !draft ||
      this.quoteTotal === null ||
      !this.lastDraft ||
      JSON.stringify(draft) !== JSON.stringify(this.lastDraft)
    ) {
      this.error = 'Recalculate the estimate after changing rental dates or items.';
      return;
    }
    if (!this.user()) {
      this.notice = 'Sign in or create a customer account before submitting your rental request.';
      return;
    }
    this.submitting = true;
    this.error = '';
    try {
      const order = await firstValueFrom(this.api.createOrder(draft));
      this.cart = [];
      this.clearQuote();
      this.notice = `Rental request #${order.id} for ${order.business_name} was submitted. The business will review it.`;
      this.loadCatalog();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  onRentalWindowChanged(): void {
    this.clearQuote();
    if (this.rentalWindowError) {
      this.products = this.products.map((product) => ({ ...product, available_count: null }));
      this.packages = this.packages.map((rentalPackage) => ({ ...rentalPackage, available_count: null }));
      this.changeDetector.markForCheck();
      return;
    }
    this.loadCatalog();
  }

  priceLabel(priceCents: number | null, configured: boolean): string {
    if (priceCents === null) {
      return 'Final price not configured';
    }
    const amount = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(priceCents / 100);
    return configured ? amount : `${amount} · billing basis not configured`;
  }

  categoryLabel(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  brandTextColor(background: string): string {
    const color = background.replace('#', '');
    const channels = [0, 2, 4].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
    const brightness = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return brightness < 145 ? '#ffffff' : '#252729';
  }

  private addCartItem(item: CartEntry): void {
    if (this.cart.some((entry) => entry.business_id !== item.business_id)) {
      this.error =
        'Submit one business rental request at a time. Clear your selection before choosing another business.';
      return;
    }
    this.error = '';
    const existing = this.cart.find((entry) => entry.key === item.key);
    this.cart = existing
      ? this.cart.map((entry) => (entry.key === item.key ? { ...entry, quantity: entry.quantity + 1 } : entry))
      : [...this.cart, item];
    this.clearQuote();
  }

  private createDraft(): OrderDraft | null {
    const rentalWindow = this.rentalWindow();
    if (!rentalWindow || !this.cart.length) {
      return null;
    }
    return {
      business_id: this.selectedBusiness?.id ?? this.cart[0].business_id,
      ...rentalWindow,
      lines: this.cart.map(({ kind, item_id, quantity }) => ({ kind, item_id, quantity })),
    };
  }

  private loadBusinessFilters(): void {
    const businessId = this.selectedBusiness?.id;
    if (businessId === undefined) {
      this.tiers = [];
      this.categories = [];
      return;
    }
    Promise.all([firstValueFrom(this.api.qualityTiers(businessId)), firstValueFrom(this.api.categories(businessId))])
      .then(([tiers, categories]) => {
        this.tiers = tiers;
        this.categories = categories;
      })
      .catch((error: unknown) => (this.error = this.errorMessage(error)))
      .finally(() => this.changeDetector.markForCheck());
  }

  private rentalWindow(): { starts_at: string; ends_at: string } | null {
    if (!this.startsInput || !this.endsInput) {
      return null;
    }
    const starts = new Date(this.startsInput);
    const ends = new Date(this.endsInput);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      return null;
    }
    return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
  }

  private clearQuote(): void {
    this.quoteTotal = null;
    this.lastDraft = null;
  }

  private errorMessage(error: unknown): string {
    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'Could not load or update rental information. Please try again.';
  }
}
