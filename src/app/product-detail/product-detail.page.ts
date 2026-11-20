import { CommonModule } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonBadge, IonButton, IonContent, IonHeader, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type { ProductDetail } from '../core/api.service';
import { CartService } from '../core/cart.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { formatRentalDuration } from '../shared/format-duration';
import { IconComponent } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-product-detail',
  templateUrl: './product-detail.page.html',
  styleUrls: ['./product-detail.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    RouterLink,
    IonBadge,
    IonButton,
    IonContent,
    IonHeader,
    IonSpinner,
    BrandMarkComponent,
    IconComponent,
    StatusBadgeComponent,
  ],
})
export class ProductDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly cart = inject(CartService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);

  readonly cartCount = this.cart.count;
  product: ProductDetail | null = null;
  startsInput = this.cart.startsInput();
  endsInput = this.cart.endsInput();
  quantity = 1;
  loading = false;
  error = '';
  notice = '';
  private productId = 0;

  get rentalDurationLabel(): string {
    return formatRentalDuration(this.startsInput, this.endsInput);
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
      const id = Number(params.get('id'));
      if (!Number.isInteger(id) || id <= 0) {
        this.error = 'Product not found.';
        this.product = null;
        this.changeDetector.markForCheck();
        return;
      }
      this.productId = id;
      this.quantity = 1;
      void this.loadProduct();
    });
  }

  ionViewWillEnter(): void {
    const savedStart = this.cart.startsInput();
    const savedEnd = this.cart.endsInput();
    const changed = savedStart !== this.startsInput || savedEnd !== this.endsInput;
    this.startsInput = savedStart;
    this.endsInput = savedEnd;
    if (changed && this.productId > 0 && !this.rentalWindowError) {
      void this.loadProduct();
    }
  }

  onWindowChanged(): void {
    this.cart.setWindow(this.startsInput, this.endsInput);
    if (!this.rentalWindowError) {
      void this.loadProduct();
    }
  }

  async loadProduct(): Promise<void> {
    this.loading = true;
    this.error = '';
    const window = this.validWindow();
    try {
      this.product = await firstValueFrom(this.api.productDetail(this.productId, window?.starts_at, window?.ends_at));
    } catch (error) {
      this.product = null;
      this.error = extractApiError(error, 'Could not load product details.');
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  addToRequest(): void {
    if (!this.product) {
      return;
    }
    const qty = Math.min(1000, Math.max(1, Math.floor(Number(this.quantity) || 1)));
    const existingQty = this.cart.items().find((entry) => entry.key === `product-${this.product?.id}`)?.quantity ?? 0;
    if (this.product.available_count !== null && existingQty + qty > this.product.available_count) {
      this.error = `Only ${this.product.available_count} unit(s) are available for the selected dates.`;
      this.notice = '';
      return;
    }
    const result = this.cart.addItem({
      key: `product-${this.product.id}`,
      kind: 'product',
      business_id: this.product.business_id,
      business_name: this.product.business_name,
      item_id: this.product.id,
      name: this.product.name,
      quantity: qty,
      price_cents: this.product.price_cents,
      pricing_configured: this.product.pricing_configured,
    });
    if (!result.ok) {
      this.error = result.error;
      this.notice = '';
      return;
    }
    this.error = '';
    this.notice = `Added ${qty} × ${this.product.name} to your rental request.`;
    this.toast.success(this.notice);
  }

  goToCheckout(): void {
    const slug = this.product?.business_slug;
    void this.router.navigate(slug ? ['/business', slug] : ['/home'], { fragment: 'rental-request' });
  }

  priceLabel(priceCents: number, configured: boolean): string {
    const amount = new Intl.NumberFormat('en-PH', {
      style: 'currency',
      currency: 'PHP',
      maximumFractionDigits: 2,
    }).format(priceCents / 100);
    return configured ? amount : `${amount} · billing basis not configured`;
  }

  pricingSummary(product: ProductDetail): string {
    if (!product.pricing_configured || !product.pricing_basis) {
      return 'Not configured by business administrator (checkout unavailable).';
    }
    if (product.pricing_basis === 'per_rental') {
      return 'Flat rate per rental period.';
    }
    const rule = product.rounding_rule === 'ceil' ? 'rounded up to full interval' : 'pro-rata';
    return `Duration-based: billed per ${product.billing_interval_minutes} minutes (${rule}).`;
  }

  private validWindow(): { starts_at: string; ends_at: string } | null {
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
}
