import { CommonModule, CurrencyPipe } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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

import { ApiService, extractApiError } from '../core/api.service';
import type { Business, OrderDraft, Product, RentalPackage } from '../core/api.service';
import { CartService } from '../core/cart.service';
import type { CartEntry } from '../core/cart.service';

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
  private readonly cartService = inject(CartService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly user = this.api.user;
  products: Product[] = [];
  packages: RentalPackage[] = [];
  tiers: { id: number; name: string }[] = [];
  categories: { id: number; name: string }[] = [];
  businesses: Business[] = [];
  selectedBusiness: Business | null = null;
  businessSearch = '';
  search = '';
  category = '';
  qualityTier = '';
  sort = 'name';
  startsInput = this.cartService.startsInput();
  endsInput = this.cartService.endsInput();
  quoteTotal: number | null = null;
  unreadNotifications = 0;
  loading = false;
  quoting = false;
  submitting = false;
  error = '';
  notice = '';
  private lastDraft: OrderDraft | null = null;
  private knownCategories = new Set<string>();
  private pendingScrollToRequest = false;

  get cart(): CartEntry[] {
    return this.cartService.items();
  }

  get cartCount(): number {
    return this.cartService.count();
  }

  get cartBusinessName(): string {
    const first = this.cart[0];
    if (!first) {
      return '';
    }
    return (
      first.business_name ||
      this.businesses.find((business) => business.id === first.business_id)?.name ||
      `Business #${first.business_id}`
    );
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
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const slug = params.get('slug');
      this.category = '';
      this.qualityTier = '';
      this.search = '';
      this.error = '';
      this.notice = '';
      this.startsInput = this.cartService.startsInput();
      this.endsInput = this.cartService.endsInput();
      this.knownCategories.clear();
      void this.loadRouteContext(slug);
    });
    this.route.fragment.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((fragment) => {
      if (fragment === 'rental-request') {
        this.pendingScrollToRequest = true;
        if (!this.loading) {
          this.performPendingScroll();
        }
      }
    });
    void this.loadUnreadCount();
  }

  ionViewWillEnter(): void {
    const savedStart = this.cartService.startsInput();
    const savedEnd = this.cartService.endsInput();
    const windowChanged = savedStart !== this.startsInput || savedEnd !== this.endsInput;
    this.startsInput = savedStart;
    this.endsInput = savedEnd;
    if (windowChanged) {
      this.clearQuote();
      if (!this.rentalWindowError) {
        this.loadCatalog();
      }
    }
    void this.loadUnreadCount();
    this.changeDetector.markForCheck();
  }

  get filteredBusinesses(): Business[] {
    const term = this.businessSearch.trim().toLowerCase();
    return this.businesses.filter(
      (business) =>
        !term || business.name.toLowerCase().includes(term) || business.description.toLowerCase().includes(term),
    );
  }

  scrollToRequest(event: Event): void {
    event.preventDefault();
    document.getElementById('rental-request')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
          for (const product of products) {
            this.knownCategories.add(product.category);
          }
          this.categories = [...this.knownCategories]
            .sort((left, right) => left.localeCompare(right))
            .map((name, index) => ({ id: index, name }));
        }
      })
      .catch((error: unknown) => (this.error = this.errorMessage(error)))
      .finally(() => {
        this.loading = false;
        this.changeDetector.markForCheck();
        if (this.pendingScrollToRequest) {
          this.performPendingScroll();
        }
      });
  }

  private performPendingScroll(): void {
    this.pendingScrollToRequest = false;
    setTimeout(() => {
      document.getElementById('rental-request')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 60);
  }

  addProduct(product: Product): void {
    this.addCartItem({
      key: `product-${product.id}`,
      kind: 'product',
      business_id: product.business_id,
      business_name: product.business_name,
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
      business_name: rentalPackage.business_name,
      item_id: rentalPackage.id,
      name: rentalPackage.name,
      quantity: 1,
      price_cents: rentalPackage.price_cents,
      pricing_configured: rentalPackage.pricing_configured,
    });
  }

  changeQuantity(key: string, value: string | number | null | undefined): void {
    this.cartService.setQuantity(key, value);
    this.clearQuote();
  }

  clearSelection(): void {
    this.cartService.clear();
    this.clearQuote();
    this.error = '';
    this.notice = 'Rental selection cleared.';
  }

  async calculateQuote(): Promise<void> {
    const draft = this.createDraft();
    if (!draft) {
      this.error = this.rentalWindowError || 'Choose a rental start and end time and add at least one item.';
      return;
    }
    this.quoting = true;
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
      this.quoting = false;
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
    const signedInUser = this.user();
    if (!signedInUser) {
      this.notice = 'Sign in or create a customer account before submitting your rental request.';
      return;
    }
    if (signedInUser.role !== 'customer') {
      this.error = 'Sign in with a customer account to submit a rental request.';
      return;
    }
    this.submitting = true;
    this.error = '';
    try {
      const order = await firstValueFrom(this.api.createOrder(draft));
      this.cartService.clear();
      this.clearQuote();
      this.notice = `Rental request #${order.id} for ${order.business_name} was submitted. View it in My account & orders.`;
      this.loadCatalog();
      void this.loadUnreadCount();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.submitting = false;
      this.changeDetector.markForCheck();
    }
  }

  onRentalWindowChanged(): void {
    this.cartService.setWindow(this.startsInput, this.endsInput);
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
    if (!/^[0-9a-fA-F]{6}$/.test(color)) {
      return '#252729';
    }
    const channels = [0, 2, 4].map((index) => Number.parseInt(color.slice(index, index + 2), 16));
    const brightness = (channels[0] * 299 + channels[1] * 587 + channels[2] * 114) / 1000;
    return brightness < 145 ? '#ffffff' : '#252729';
  }

  private async loadUnreadCount(): Promise<void> {
    if (!this.user() || typeof this.api.notifications !== 'function') {
      this.unreadNotifications = 0;
      return;
    }
    try {
      const feed = await firstValueFrom(this.api.notifications(true, 1));
      this.unreadNotifications = feed.unread_count;
      this.changeDetector.markForCheck();
    } catch {
      this.unreadNotifications = 0;
    }
  }

  private async loadRouteContext(slug: string | null): Promise<void> {
    this.loading = true;
    try {
      this.businesses = await firstValueFrom(this.api.marketplaceBusinesses());
      if (slug) {
        this.selectedBusiness = await firstValueFrom(this.api.marketplaceBusiness(slug));
        this.loadBusinessFilters();
      } else {
        this.selectedBusiness = null;
        this.tiers = [];
        this.categories = [];
      }
      this.loadCatalog();
    } catch (error) {
      this.selectedBusiness = null;
      this.products = [];
      this.packages = [];
      this.loading = false;
      this.error = this.errorMessage(error);
      this.changeDetector.markForCheck();
    }
  }

  private addCartItem(item: CartEntry): void {
    const result = this.cartService.addItem(item);
    if (!result.ok) {
      this.error = result.error;
      return;
    }
    this.error = '';
    this.clearQuote();
  }

  private createDraft(): OrderDraft | null {
    const rentalWindow = this.rentalWindow();
    if (!rentalWindow || !this.cart.length) {
      return null;
    }
    return {
      business_id: this.cart[0].business_id,
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
    return extractApiError(error, 'Could not load or update rental information. Please try again.');
  }
}
