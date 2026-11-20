import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';
import type { OrderLineInput, Product, RentalOrder, RentalPackage, User } from '../core/api.service';

type SelectableItem = { key: string; kind: 'product' | 'package'; item_id: number; label: string };

@Component({
  selector: 'app-account',
  templateUrl: './account.page.html',
  styleUrls: ['./account.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    DatePipe,
    FormsModule,
    RouterLink,
    IonContent,
    IonHeader,
    IonSelect,
    IonSelectOption,
    IonSpinner,
  ],
})
export class AccountPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  user: User | null = this.api.user();
  orders: RentalOrder[] = [];
  products: Product[] = [];
  packages: RentalPackage[] = [];
  items: SelectableItem[] = [];
  mode: 'login' | 'register' = 'login';
  showPassword = false;
  email = '';
  password = '';
  displayName = '';
  phone = '';
  profileName = '';
  profilePhone = '';
  loading = false;
  saving = false;
  error = '';
  notice = '';
  editingOrderId: number | null = null;
  draftStart = '';
  draftEnd = '';
  draftLines: OrderLineInput[] = [];
  selectedItemKey = '';
  requestReason = '';
  paymentOrderId: number | null = null;
  paymentAmount = '';
  paymentMethod: 'cash' | 'gcash' | 'bank_transfer' = 'cash';
  paymentDate = this.localDateTime(new Date());
  paymentReference = '';
  paymentNotes = '';
  paymentProofFile: File | null = null;
  paymentProofPreviewUrl = '';
  pendingProofOrderId: number | null = null;
  pendingProofPaymentId: number | null = null;
  paymentProofPreviews: Record<number, string> = {};

  ngOnDestroy(): void {
    this.clearPaymentProofPreview();
    for (const preview of Object.values(this.paymentProofPreviews)) {
      URL.revokeObjectURL(preview);
    }
  }

  ngOnInit(): void {
    if (this.user?.role === 'platform_admin') {
      void this.router.navigateByUrl('/platform');
    } else if (this.user?.role === 'business_admin' || this.user?.role === 'business_staff') {
      void this.router.navigateByUrl('/admin');
    } else if (this.user?.role === 'customer') {
      this.loadAccount();
    }
  }

  async authenticate(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.saving = true;
    try {
      this.user =
        this.mode === 'register'
          ? await firstValueFrom(
              this.api.register({
                email: this.email,
                password: this.password,
                display_name: this.displayName,
                phone: this.phone || null,
              }),
            )
          : await firstValueFrom(this.api.login(this.email, this.password));
      this.password = '';
      this.profileName = this.user.display_name;
      this.profilePhone = this.user.phone || '';
      if (this.user.role === 'platform_admin') {
        await this.router.navigateByUrl('/platform');
      } else if (this.user.role === 'business_admin' || this.user.role === 'business_staff') {
        await this.router.navigateByUrl('/admin');
      } else if (this.user.role === 'business_pending') {
        this.notice = 'Your business registration is awaiting platform administrator approval.';
      } else {
        this.loadAccount();
        this.notice = 'You are signed in.';
      }
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  signOut(): void {
    this.api.logout();
    this.user = null;
    this.orders = [];
    this.notice = 'You have signed out.';
  }

  toggleAuthMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.password = '';
    this.showPassword = false;
    this.error = '';
    this.notice = '';
  }

  async loadAccount(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [profile, orders, products, packages] = await Promise.all([
        firstValueFrom(this.api.profile()),
        firstValueFrom(this.api.orders()),
        firstValueFrom(this.api.products()),
        firstValueFrom(this.api.packages()),
      ]);
      this.user = profile;
      this.profileName = profile.display_name;
      this.profilePhone = profile.phone || '';
      this.orders = orders;
      this.products = products;
      this.packages = packages;
      this.items = this.selectableItems(products, packages);
    } catch (error) {
      this.error = this.errorMessage(error);
      if (this.error.includes('Authentication')) {
        this.signOut();
      }
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async saveProfile(): Promise<void> {
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      this.user = await firstValueFrom(this.api.updateProfile(this.profileName, this.profilePhone || null));
      this.notice = 'Profile updated.';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  beginModification(order: RentalOrder): void {
    this.items = this.selectableItems(
      this.products.filter((product) => product.business_id === order.business_id),
      this.packages.filter((rentalPackage) => rentalPackage.business_id === order.business_id),
    );
    this.editingOrderId = order.id;
    this.draftStart = this.localDateTime(new Date(order.starts_at));
    this.draftEnd = this.localDateTime(new Date(order.ends_at));
    this.draftLines = order.lines.map((line) => ({
      kind: line.kind,
      item_id: line.item_id,
      quantity: line.quantity,
    }));
    this.requestReason = '';
    this.selectedItemKey = '';
    this.error = '';
  }

  addDraftLine(): void {
    const item = this.items.find((candidate) => candidate.key === this.selectedItemKey);
    if (!item) {
      return;
    }
    const existing = this.draftLines.find((line) => line.kind === item.kind && line.item_id === item.item_id);
    if (existing) {
      this.draftLines = this.draftLines.map((line) =>
        line === existing ? { ...line, quantity: line.quantity + 1 } : line,
      );
    } else {
      this.draftLines = [...this.draftLines, { kind: item.kind, item_id: item.item_id, quantity: 1 }];
    }
    this.selectedItemKey = '';
  }

  removeDraftLine(index: number): void {
    this.draftLines = this.draftLines.filter((_, lineIndex) => lineIndex !== index);
  }

  updateDraftItem(index: number, key: string): void {
    const item = this.items.find((candidate) => candidate.key === key);
    if (!item) {
      return;
    }
    this.draftLines = this.draftLines.map((line, lineIndex) =>
      lineIndex === index ? { ...line, kind: item.kind, item_id: item.item_id } : line,
    );
  }

  printSummary(): void {
    window.print();
  }

  async submitModification(): Promise<void> {
    if (this.editingOrderId === null || !this.draftStart || !this.draftEnd || !this.draftLines.length) {
      this.error = 'Enter a rental window and at least one requested item.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await firstValueFrom(
        this.api.orderRequest(this.editingOrderId, {
          kind: 'modification',
          reason: this.requestReason.trim() || 'Requested order changes',
          starts_at: new Date(this.draftStart).toISOString(),
          ends_at: new Date(this.draftEnd).toISOString(),
          lines: this.draftLines,
        }),
      );
      this.notice =
        'Change request sent. Your current order and inventory reservation remain unchanged until administrator review.';
      this.editingOrderId = null;
      await this.loadAccount();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async requestCancellation(order: RentalOrder): Promise<void> {
    const reason = window.prompt('Why are you requesting cancellation?');
    if (reason === null) {
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await firstValueFrom(
        this.api.orderRequest(order.id, {
          kind: 'cancellation',
          reason: reason.trim() || 'Customer requested cancellation',
        }),
      );
      this.notice = 'Cancellation request sent. Inventory remains reserved until an administrator approves it.';
      await this.loadAccount();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async submitPayment(): Promise<void> {
    if (!this.paymentOrderId || !this.paymentAmount || !this.paymentDate) {
      this.error = 'Enter a payment amount and payment date.';
      return;
    }
    const amount = Number(this.paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      this.error = 'Enter a valid payment amount.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const payment = await firstValueFrom(
        this.api.submitPayment(this.paymentOrderId, {
          amount_cents: Math.round(amount * 100),
          method: this.paymentMethod,
          paid_at: new Date(this.paymentDate).toISOString(),
          reference_number: this.paymentReference || null,
          notes: this.paymentNotes || null,
        }),
      );
      this.pendingProofOrderId = this.paymentOrderId;
      this.pendingProofPaymentId = payment.id;
      if (this.paymentProofFile && !(await this.sendPaymentProof())) {
        return;
      }
      this.notice = 'Payment information submitted. It will appear as paid only after an administrator verifies it.';
      this.paymentOrderId = null;
      this.resetPaymentForm();
      await this.loadAccount();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  selectPaymentProof(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      this.error = 'Choose a JPEG, PNG, or WebP payment image up to 5 MB.';
      input.value = '';
      return;
    }
    this.clearPaymentProofPreview();
    this.paymentProofFile = file;
    this.paymentProofPreviewUrl = URL.createObjectURL(file);
    this.error = '';
  }

  async retryPaymentProof(): Promise<void> {
    if (!this.pendingProofOrderId || !this.pendingProofPaymentId) {
      return;
    }
    this.saving = true;
    this.error = '';
    if (await this.sendPaymentProof()) {
      this.notice = 'Payment proof uploaded and submitted for verification.';
      this.paymentOrderId = null;
      this.resetPaymentForm();
      await this.loadAccount();
    }
    this.saving = false;
    this.changeDetector.markForCheck();
  }

  async viewPaymentProof(orderId: number, paymentId: number): Promise<void> {
    this.error = '';
    try {
      const image = await firstValueFrom(this.api.paymentProof(orderId, paymentId));
      const currentPreview = this.paymentProofPreviews[paymentId];
      if (currentPreview) {
        URL.revokeObjectURL(currentPreview);
      }
      this.paymentProofPreviews[paymentId] = URL.createObjectURL(image);
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  paymentStatus(status: RentalOrder['payment_status']): string {
    return status.replace('_', ' ');
  }

  canRequest(order: RentalOrder): boolean {
    return order.status === 'pending_admin' || order.status === 'confirmed';
  }

  private localDateTime(date: Date): string {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  private async sendPaymentProof(): Promise<boolean> {
    if (!this.pendingProofOrderId || !this.pendingProofPaymentId || !this.paymentProofFile) {
      return true;
    }
    try {
      await firstValueFrom(
        this.api.uploadPaymentProof(this.pendingProofOrderId, this.pendingProofPaymentId, this.paymentProofFile),
      );
      this.pendingProofOrderId = null;
      this.pendingProofPaymentId = null;
      return true;
    } catch (error) {
      this.error = `Payment details were submitted, but the proof upload failed: ${this.errorMessage(error)}`;
      this.notice = 'Retry the proof upload below. Do not submit the payment details again.';
      return false;
    }
  }

  private resetPaymentForm(): void {
    this.paymentAmount = '';
    this.paymentReference = '';
    this.paymentNotes = '';
    this.pendingProofOrderId = null;
    this.pendingProofPaymentId = null;
    this.paymentProofFile = null;
    this.clearPaymentProofPreview();
  }

  private clearPaymentProofPreview(): void {
    if (this.paymentProofPreviewUrl) {
      URL.revokeObjectURL(this.paymentProofPreviewUrl);
      this.paymentProofPreviewUrl = '';
    }
  }

  private selectableItems(products: Product[], packages: RentalPackage[]): SelectableItem[] {
    return [
      ...products.map((product) => ({
        key: `product:${product.id}`,
        kind: 'product' as const,
        item_id: product.id,
        label: `${product.name} · ${product.quality_name}`,
      })),
      ...packages.map((rentalPackage) => ({
        key: `package:${rentalPackage.id}`,
        kind: 'package' as const,
        item_id: rentalPackage.id,
        label: `${rentalPackage.name} · package`,
      })),
    ];
  }

  private errorMessage(error: unknown): string {
    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'The request could not be completed. Please try again.';
  }
}
