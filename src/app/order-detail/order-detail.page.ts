import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import type { OnDestroy, OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type { PaymentEntry, RentalOrder } from '../core/api.service';

@Component({
  selector: 'app-order-detail',
  templateUrl: './order-detail.page.html',
  styleUrls: ['./order-detail.page.scss'],
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, IonContent, IonHeader, IonSpinner],
})
export class OrderDetailPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly destroyRef = inject(DestroyRef);
  private readonly changeDetector = inject(ChangeDetectorRef);

  order: RentalOrder | null = null;
  loading = false;
  saving = false;
  error = '';
  notice = '';
  showPaymentForm = false;
  paymentAmount = '';
  paymentMethod: PaymentEntry['method'] = 'cash';
  paymentDate = this.localDateTime(new Date());
  paymentReference = '';
  paymentNotes = '';
  paymentProofFile: File | null = null;
  paymentProofPreviewUrl = '';
  pendingProofPaymentId: number | null = null;
  paymentProofPreviews: Record<number, string> = {};
  private orderId = 0;

  ngOnInit(): void {
    this.route.paramMap.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((params) => {
      const id = Number(params.get('id'));
      if (!Number.isInteger(id) || id <= 0) {
        this.error = 'Order not found.';
        this.order = null;
        this.changeDetector.markForCheck();
        return;
      }
      this.orderId = id;
      void this.loadOrder();
    });
  }

  ngOnDestroy(): void {
    if (this.paymentProofPreviewUrl) {
      URL.revokeObjectURL(this.paymentProofPreviewUrl);
    }
    for (const url of Object.values(this.paymentProofPreviews)) {
      URL.revokeObjectURL(url);
    }
  }

  async loadOrder(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.order = await firstValueFrom(this.api.orderDetail(this.orderId));
    } catch (error) {
      this.order = null;
      this.error = extractApiError(error, 'Could not load order details.');
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  canRequest(order: RentalOrder): boolean {
    return order.status === 'pending_admin' || order.status === 'confirmed';
  }

  hasPendingRequest(order: RentalOrder): boolean {
    return order.requests.some((req) => req.status === 'pending');
  }

  async requestCancellation(): Promise<void> {
    if (!this.order) {
      return;
    }
    const reason = window.prompt('Why are you requesting cancellation?');
    if (reason === null) {
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await firstValueFrom(
        this.api.orderRequest(this.order.id, {
          kind: 'cancellation',
          reason: reason.trim() || 'Customer requested cancellation',
        }),
      );
      this.notice = 'Cancellation request sent. Inventory remains reserved until approved by the business.';
      await this.loadOrder();
    } catch (error) {
      this.error = extractApiError(error, 'Could not submit cancellation request.');
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
      this.error = 'Choose a JPEG, PNG, or WebP image up to 5 MB.';
      input.value = '';
      return;
    }
    if (this.paymentProofPreviewUrl) {
      URL.revokeObjectURL(this.paymentProofPreviewUrl);
    }
    this.paymentProofFile = file;
    this.paymentProofPreviewUrl = URL.createObjectURL(file);
    this.error = '';
  }

  async submitPayment(): Promise<void> {
    if (!this.order) {
      return;
    }
    const rawAmount = String(this.paymentAmount ?? '').trim();
    const amount = Number(rawAmount);
    const paidAt = new Date(this.paymentDate);
    if (!rawAmount || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(paidAt.getTime())) {
      this.error = 'Enter a valid payment amount and date.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const payment = await firstValueFrom(
        this.api.submitPayment(this.order.id, {
          amount_cents: Math.round(amount * 100),
          method: this.paymentMethod,
          paid_at: paidAt.toISOString(),
          reference_number: this.paymentReference.trim() || null,
          notes: this.paymentNotes.trim() || null,
        }),
      );
      this.pendingProofPaymentId = payment.id;
      if (this.paymentProofFile && !(await this.uploadPendingProof())) {
        return;
      }
      this.finishPaymentSubmission('Payment details submitted for business verification.');
      await this.loadOrder();
    } catch (error) {
      this.error = extractApiError(error, 'Could not submit payment details.');
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async retryPaymentProof(): Promise<void> {
    if (!this.order || !this.pendingProofPaymentId || !this.paymentProofFile) {
      return;
    }
    this.saving = true;
    this.error = '';
    if (await this.uploadPendingProof()) {
      this.finishPaymentSubmission('Payment proof uploaded and submitted for verification.');
      await this.loadOrder();
    }
    this.saving = false;
    this.changeDetector.markForCheck();
  }

  private async uploadPendingProof(): Promise<boolean> {
    if (!this.order || !this.pendingProofPaymentId || !this.paymentProofFile) {
      return true;
    }
    try {
      await firstValueFrom(
        this.api.uploadPaymentProof(this.order.id, this.pendingProofPaymentId, this.paymentProofFile),
      );
      this.pendingProofPaymentId = null;
      return true;
    } catch (error) {
      this.error = `Payment details were saved, but the proof upload failed: ${extractApiError(error, 'Upload failed.')}`;
      this.notice = 'Retry the proof upload below without resubmitting the payment details.';
      return false;
    }
  }

  private finishPaymentSubmission(message: string): void {
    this.notice = message;
    this.showPaymentForm = false;
    this.paymentAmount = '';
    this.paymentReference = '';
    this.paymentNotes = '';
    this.pendingProofPaymentId = null;
    this.paymentProofFile = null;
    if (this.paymentProofPreviewUrl) {
      URL.revokeObjectURL(this.paymentProofPreviewUrl);
      this.paymentProofPreviewUrl = '';
    }
  }

  async viewPaymentProof(paymentId: number): Promise<void> {
    if (!this.order) {
      return;
    }
    try {
      const blob = await firstValueFrom(this.api.paymentProof(this.order.id, paymentId));
      if (this.paymentProofPreviews[paymentId]) {
        URL.revokeObjectURL(this.paymentProofPreviews[paymentId]);
      }
      this.paymentProofPreviews[paymentId] = URL.createObjectURL(blob);
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = extractApiError(error, 'Could not load payment proof.');
    }
  }

  printReceipt(): void {
    window.print();
  }

  private localDateTime(date: Date): string {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }
}
