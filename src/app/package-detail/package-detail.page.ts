import { CommonModule } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { IonBadge, IonButton, IonContent, IonHeader, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type { PackageDetail } from '../core/api.service';
import { CartService } from '../core/cart.service';

@Component({
  selector: 'app-package-detail',
  templateUrl: './package-detail.page.html',
  styleUrls: ['./package-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonBadge, IonButton, IonContent, IonHeader, IonSpinner],
})
export class PackageDetailPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly cart = inject(CartService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly cartCount = this.cart.count;
  rentalPackage: PackageDetail | null = null;
  startsInput = this.cart.startsInput();
  endsInput = this.cart.endsInput();
  quantity = 1;
  loading = false;
  error = '';
  notice = '';
  private packageId = 0;

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
        this.error = 'Rental package not found.';
        this.rentalPackage = null;
        this.changeDetector.markForCheck();
        return;
      }
      this.packageId = id;
      this.quantity = 1;
      void this.loadPackage();
    });
  }

  ionViewWillEnter(): void {
    const savedStart = this.cart.startsInput();
    const savedEnd = this.cart.endsInput();
    const changed = savedStart !== this.startsInput || savedEnd !== this.endsInput;
    this.startsInput = savedStart;
    this.endsInput = savedEnd;
    if (changed && this.packageId > 0 && !this.rentalWindowError) {
      void this.loadPackage();
    }
  }

  onWindowChanged(): void {
    this.cart.setWindow(this.startsInput, this.endsInput);
    if (!this.rentalWindowError) {
      void this.loadPackage();
    }
  }

  async loadPackage(): Promise<void> {
    this.loading = true;
    this.error = '';
    const window = this.validWindow();
    try {
      this.rentalPackage = await firstValueFrom(
        this.api.packageDetail(this.packageId, window?.starts_at, window?.ends_at),
      );
    } catch (error) {
      this.rentalPackage = null;
      this.error = extractApiError(error, 'Could not load rental package details.');
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  addToRequest(): void {
    if (!this.rentalPackage) {
      return;
    }
    const qty = Math.min(1000, Math.max(1, Math.floor(Number(this.quantity) || 1)));
    const existingQty =
      this.cart.items().find((entry) => entry.key === `package-${this.rentalPackage?.id}`)?.quantity ?? 0;
    if (this.rentalPackage.available_count !== null && existingQty + qty > this.rentalPackage.available_count) {
      this.error = `Only ${this.rentalPackage.available_count} package(s) are available for the selected dates.`;
      this.notice = '';
      return;
    }
    const result = this.cart.addItem({
      key: `package-${this.rentalPackage.id}`,
      kind: 'package',
      business_id: this.rentalPackage.business_id,
      business_name: this.rentalPackage.business_name,
      item_id: this.rentalPackage.id,
      name: this.rentalPackage.name,
      quantity: qty,
      price_cents: this.rentalPackage.price_cents,
      pricing_configured: this.rentalPackage.pricing_configured,
    });
    if (!result.ok) {
      this.error = result.error;
      this.notice = '';
      return;
    }
    this.error = '';
    this.notice = `Added ${qty} × ${this.rentalPackage.name} to your rental request.`;
  }

  goToCheckout(): void {
    const slug = this.rentalPackage?.business_slug;
    void this.router.navigate(slug ? ['/business', slug] : ['/home'], { fragment: 'rental-request' });
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

  pricingSummary(pkg: PackageDetail): string {
    if (!pkg.pricing_configured || !pkg.pricing_basis) {
      return 'Not configured by business administrator (checkout unavailable).';
    }
    if (pkg.pricing_basis === 'per_rental') {
      return 'Flat package rate per rental period. Included items reserve stock without double charging.';
    }
    const rule = pkg.rounding_rule === 'ceil' ? 'rounded up to full interval' : 'pro-rata';
    return `Duration-based: billed per ${pkg.billing_interval_minutes} minutes (${rule}).`;
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
