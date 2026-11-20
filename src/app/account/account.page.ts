import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader, IonSelect, IonSelectOption, IonSpinner } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type {
  BusinessApplication,
  NotificationItem,
  OrderLineInput,
  Product,
  RentalOrder,
  RentalPackage,
  User,
} from '../core/api.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ConfirmDialogService } from '../shared/confirm-dialog.service';
import { IconComponent } from '../shared/icon.component';
import { OrderProgressComponent } from '../shared/order-progress.component';
import { PaymentInstructionsComponent } from '../shared/payment-instructions.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { ToastService } from '../shared/toast.service';

type SelectableItem = { key: string; kind: 'product' | 'package'; item_id: number; label: string };
type OrderFilter = 'all' | 'active' | 'completed' | 'closed';

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
    BrandMarkComponent,
    IconComponent,
    OrderProgressComponent,
    PaymentInstructionsComponent,
    StatusBadgeComponent,
  ],
})
export class AccountPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  fieldErrors: Record<string, string> = {};

  user: User | null = this.api.user();
  businessApplication: BusinessApplication | null = null;
  orders: RentalOrder[] = [];
  notifications: NotificationItem[] = [];
  unreadNotifications = 0;
  orderFilter: OrderFilter = 'all';
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
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';
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

  get filteredOrders(): RentalOrder[] {
    if (this.orderFilter === 'active') {
      return this.orders.filter((order) => order.status === 'pending_admin' || order.status === 'confirmed');
    }
    if (this.orderFilter === 'completed') {
      return this.orders.filter((order) => order.status === 'completed');
    }
    if (this.orderFilter === 'closed') {
      return this.orders.filter((order) => order.status === 'cancelled' || order.status === 'rejected');
    }
    return this.orders;
  }

  get activeOrderCount(): number {
    return this.orders.filter((order) => order.status === 'pending_admin' || order.status === 'confirmed').length;
  }

  get totalUnpaidBalanceCents(): number {
    return this.orders
      .filter((order) => order.status !== 'cancelled' && order.status !== 'rejected')
      .reduce((total, order) => total + Math.max(0, order.balance_cents), 0);
  }

  private loadGeneration = 0;

  ngOnDestroy(): void {
    this.loadGeneration += 1;
    this.clearPaymentProofPreview();
    for (const preview of Object.values(this.paymentProofPreviews)) {
      URL.revokeObjectURL(preview);
    }
  }

  ngOnInit(): void {
    this.syncSessionView();
  }

  ionViewWillEnter(): void {
    this.syncSessionView();
  }

  private syncSessionView(): void {
    const sessionNotice = this.api.consumeSessionNotice();
    if (sessionNotice) {
      this.notice = sessionNotice;
    }
    this.user = this.api.user();
    if (this.user && !this.api.hasValidSession()) {
      this.user = null;
      this.changeDetector.markForCheck();
      return;
    }
    if (this.user?.role === 'platform_admin') {
      void this.router.navigateByUrl('/platform');
    } else if (this.user?.role === 'business_admin' || this.user?.role === 'business_staff') {
      void this.router.navigateByUrl('/admin');
    } else if (this.user?.role === 'business_pending') {
      void this.checkApprovalStatus(false);
    } else if (this.user?.role === 'customer') {
      void this.loadAccount();
    }
    this.changeDetector.markForCheck();
  }

  async checkApprovalStatus(showPendingNotice = true): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.error = '';
    try {
      const profile = await firstValueFrom(this.api.profile());
      if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
        return;
      }
      this.user = profile;
      if (profile.role === 'business_admin' || profile.role === 'business_staff') {
        await this.router.navigateByUrl('/admin');
        return;
      }
      if (profile.role === 'platform_admin') {
        await this.router.navigateByUrl('/platform');
        return;
      }
      try {
        const application = await firstValueFrom(this.api.myBusinessApplication());
        if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
          return;
        }
        this.businessApplication = application;
      } catch {
        if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
          return;
        }
        this.businessApplication = null;
      }
      if (showPendingNotice) {
        const status = this.businessApplication?.status;
        this.notice =
          status === 'rejected'
            ? 'Your business application was rejected by the platform administrator.'
            : status === 'suspended'
              ? 'Your business account is currently suspended.'
              : 'Your business application is still awaiting platform administrator approval.';
      }
    } catch (error) {
      if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
        return;
      }
      this.error = this.errorMessage(error);
    } finally {
      if (generation === this.loadGeneration) {
        this.loading = false;
      }
      this.changeDetector.markForCheck();
    }
  }

  async authenticate(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.fieldErrors = {};
    const email = this.email.trim();
    if (this.mode === 'register' && !this.displayName.trim()) {
      this.fieldErrors['displayName'] = 'Please enter your full name.';
    }
    if (!email || !email.includes('@')) {
      this.fieldErrors['email'] = 'Enter a valid email address (for example, name@example.com).';
    }
    if (!this.password) {
      this.fieldErrors['password'] = 'Enter your password.';
    } else if (this.mode === 'register' && this.password.length < 12) {
      this.fieldErrors['password'] = 'Password must be at least 12 characters.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = 'Please review the highlighted fields below.';
      return;
    }
    this.saving = true;
    try {
      this.user =
        this.mode === 'register'
          ? await firstValueFrom(
              this.api.register({
                email,
                password: this.password,
                display_name: this.displayName.trim(),
                phone: this.phone.trim() || null,
              }),
            )
          : await firstValueFrom(this.api.login(email, this.password));
      this.password = '';
      this.profileName = this.user.display_name;
      this.profilePhone = this.user.phone || '';
      if (this.user.role === 'platform_admin') {
        await this.router.navigateByUrl('/platform');
      } else if (this.user.role === 'business_admin' || this.user.role === 'business_staff') {
        await this.router.navigateByUrl('/admin');
      } else if (this.user.role === 'business_pending') {
        void this.checkApprovalStatus(false);
        this.notice = 'Your business registration is awaiting platform administrator approval.';
      } else {
        void this.loadAccount();
        this.notice = 'You are signed in.';
        this.toast.success(this.mode === 'register' ? 'Account created. Welcome!' : 'Signed in successfully.');
      }
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  signOut(): void {
    this.loadGeneration += 1;
    this.api.logout();
    this.user = null;
    this.businessApplication = null;
    this.orders = [];
    this.notifications = [];
    this.unreadNotifications = 0;
    this.loading = false;
    this.editingOrderId = null;
    this.closePaymentForm();
    this.notice = 'You have signed out.';
    this.changeDetector.markForCheck();
  }

  toggleAuthMode(): void {
    this.mode = this.mode === 'login' ? 'register' : 'login';
    this.password = '';
    this.showPassword = false;
    this.error = '';
    this.notice = '';
  }

  async loadAccount(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.error = '';
    try {
      const [profile, orders, products, packages, notificationFeed] = await Promise.all([
        firstValueFrom(this.api.profile()),
        firstValueFrom(this.api.orders()),
        firstValueFrom(this.api.products()),
        firstValueFrom(this.api.packages()),
        firstValueFrom(this.api.notifications(false, 30)),
      ]);
      if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
        return;
      }
      this.user = profile;
      this.profileName = profile.display_name;
      this.profilePhone = profile.phone || '';
      this.orders = orders;
      this.products = products;
      this.packages = packages;
      this.items = this.selectableItems(products, packages);
      this.notifications = notificationFeed.items;
      this.unreadNotifications = notificationFeed.unread_count;
    } catch (error) {
      if (generation !== this.loadGeneration) {
        return;
      }
      const status = (error as { status?: number })?.status;
      if (status === 401) {
        this.user = null;
        this.orders = [];
        this.notifications = [];
        this.unreadNotifications = 0;
        this.notice = this.api.consumeSessionNotice() || 'Your session expired. Sign in again to continue.';
      } else {
        this.error = this.errorMessage(error);
      }
    } finally {
      if (generation === this.loadGeneration) {
        this.loading = false;
      }
      this.changeDetector.markForCheck();
    }
  }

  async saveProfile(): Promise<void> {
    this.fieldErrors = {};
    if (!this.profileName.trim()) {
      this.fieldErrors['profileName'] = 'Display name is required.';
      this.error = 'Display name is required.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      this.user = await firstValueFrom(
        this.api.updateProfile(this.profileName.trim(), this.profilePhone.trim() || null),
      );
      this.notice = 'Profile updated.';
      this.toast.success('Your contact profile has been saved.');
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async changePassword(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.fieldErrors = {};
    if (!this.currentPassword) {
      this.fieldErrors['currentPassword'] = 'Enter your current password.';
    }
    if (this.newPassword.length < 12) {
      this.fieldErrors['newPassword'] = 'New password must be at least 12 characters.';
    }
    if (this.newPassword !== this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Password confirmation does not match.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = Object.values(this.fieldErrors)[0];
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.changePassword(this.currentPassword, this.newPassword));
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.notice = response.message;
      this.toast.success('Password updated. Your session remains active.');
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async markNotificationRead(item: NotificationItem): Promise<void> {
    if (item.is_read) {
      return;
    }
    try {
      await firstValueFrom(this.api.markNotificationRead(item.id));
      item.is_read = true;
      this.unreadNotifications = Math.max(0, this.unreadNotifications - 1);
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = this.errorMessage(error);
    }
  }

  async markAllNotificationsRead(): Promise<void> {
    try {
      await firstValueFrom(this.api.markAllNotificationsRead());
      this.notifications = this.notifications.map((item) => ({ ...item, is_read: true }));
      this.unreadNotifications = 0;
      this.notice = 'All notifications marked as read.';
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = this.errorMessage(error);
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
    const starts = new Date(this.draftStart);
    const ends = new Date(this.draftEnd);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      this.error = 'End date and time must be after the start.';
      return;
    }
    if (
      this.draftLines.some(
        (line) => !Number.isInteger(Number(line.quantity)) || Number(line.quantity) < 1 || Number(line.quantity) > 1000,
      )
    ) {
      this.error = 'Each item quantity must be a whole number from 1 to 1,000.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await firstValueFrom(
        this.api.orderRequest(this.editingOrderId, {
          kind: 'modification',
          reason: this.requestReason.trim() || 'Requested order changes',
          starts_at: starts.toISOString(),
          ends_at: ends.toISOString(),
          lines: this.draftLines.map((line) => ({
            kind: line.kind,
            item_id: line.item_id,
            quantity: Number(line.quantity),
          })),
        }),
      );
      this.notice =
        'Change request sent. Your current order and inventory reservation remain unchanged until administrator review.';
      this.toast.success('Booking change request sent for business review.');
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
    const decision = await this.confirmDialog.open({
      title: `Cancel Order #${order.id}?`,
      message: `Your cancellation request will be sent to ${order.business_name}. Reserved equipment stays held until the business approves the cancellation.`,
      confirmLabel: 'Send cancellation request',
      cancelLabel: 'Keep booking',
      tone: 'danger',
      inputLabel: 'Reason for cancelling (optional)',
      inputPlaceholder: 'e.g. Event date changed or no longer needed',
    });
    if (!decision.confirmed) {
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await firstValueFrom(
        this.api.orderRequest(order.id, {
          kind: 'cancellation',
          reason: decision.note || 'Customer requested cancellation',
        }),
      );
      this.notice = 'Cancellation request sent. Inventory remains reserved until an administrator approves it.';
      this.toast.success('Cancellation request sent to the business.');
      await this.loadAccount();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  openPaymentForm(order: RentalOrder): void {
    if (this.paymentOrderId !== order.id) {
      this.resetPaymentForm();
      this.paymentMethod = 'cash';
      this.paymentDate = this.localDateTime(new Date());
      this.paymentOrderId = order.id;
    }
    this.error = '';
  }

  closePaymentForm(): void {
    this.paymentOrderId = null;
    this.resetPaymentForm();
  }

  async submitPayment(): Promise<void> {
    this.fieldErrors = {};
    const rawAmount = String(this.paymentAmount ?? '').trim();
    const amount = Number(rawAmount);
    const paidAt = new Date(this.paymentDate);
    if (!rawAmount || !Number.isFinite(amount) || amount <= 0) {
      this.fieldErrors['paymentAmount'] = 'Enter a valid payment amount greater than ₱0.00.';
    }
    if (!this.paymentDate || Number.isNaN(paidAt.getTime())) {
      this.fieldErrors['paymentDate'] = 'Select the date and time you paid.';
    }
    if (!this.paymentOrderId || Object.keys(this.fieldErrors).length > 0) {
      this.error = Object.values(this.fieldErrors)[0] || 'Enter a payment amount and payment date.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      const payment = await firstValueFrom(
        this.api.submitPayment(this.paymentOrderId, {
          amount_cents: Math.round(amount * 100),
          method: this.paymentMethod,
          paid_at: paidAt.toISOString(),
          reference_number: this.paymentReference.trim() || null,
          notes: this.paymentNotes.trim() || null,
        }),
      );
      this.pendingProofOrderId = this.paymentOrderId;
      this.pendingProofPaymentId = payment.id;
      if (this.paymentProofFile && !(await this.sendPaymentProof())) {
        return;
      }
      this.notice = 'Payment information submitted. It will appear as paid only after an administrator verifies it.';
      this.toast.success('Payment details sent for business verification.');
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
    return status.replaceAll('_', ' ');
  }

  paymentMethodLabel(method: string): string {
    return method.replaceAll('_', ' ');
  }

  hasPendingRequest(order: RentalOrder): boolean {
    return order.requests.some((request) => request.status === 'pending');
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
    return extractApiError(error, 'The request could not be completed. Please try again.');
  }
}
