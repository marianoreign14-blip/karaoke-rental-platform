import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type {
  Business,
  NotificationItem,
  PlatformAuditLog,
  PlatformPaymentRecord,
  PlatformReportSummary,
  PlatformSummary,
  PlatformUser,
  Product,
  RentalOrder,
} from '../core/api.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ConfirmDialogService } from '../shared/confirm-dialog.service';
import { IconComponent } from '../shared/icon.component';
import type { IconName } from '../shared/icon.component';
import { StatusBadgeComponent } from '../shared/status-badge.component';
import { ToastService } from '../shared/toast.service';

type PlatformSection =
  'businesses' | 'users' | 'products' | 'orders' | 'reports' | 'audit' | 'notifications' | 'settings';

@Component({
  selector: 'app-platform',
  templateUrl: './platform.page.html',
  styleUrls: ['./platform.page.scss'],
  standalone: true,
  imports: [
    CommonModule,
    CurrencyPipe,
    DatePipe,
    FormsModule,
    RouterLink,
    IonContent,
    BrandMarkComponent,
    IconComponent,
    StatusBadgeComponent,
  ],
})
export class PlatformPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly confirmDialog = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);
  fieldErrors: Record<string, string> = {};

  readonly currentUser = this.api.user;
  readonly sections: { id: PlatformSection; label: string; icon: IconName }[] = [
    { id: 'businesses', label: 'Businesses', icon: 'building' },
    { id: 'users', label: 'Users & Customers', icon: 'users' },
    { id: 'products', label: 'Products', icon: 'layers' },
    { id: 'orders', label: 'Orders & Payments', icon: 'credit-card' },
    { id: 'reports', label: 'Reports & Analytics', icon: 'bar-chart' },
    { id: 'audit', label: 'Audit Logs', icon: 'clock' },
    { id: 'notifications', label: 'Notifications', icon: 'bell' },
    { id: 'settings', label: 'Settings & Profile', icon: 'settings' },
  ];
  section: PlatformSection = 'businesses';
  sidebarCollapsed = false;
  mobileMenuOpen = false;
  readonly pageSize = 25;
  usersPage = 1;
  productsPage = 1;
  ordersPage = 1;
  paymentsPage = 1;
  auditPage = 1;

  get activeSectionLabel(): string {
    return this.sections.find((item) => item.id === this.section)?.label || 'Platform Administration';
  }

  selectSection(id: PlatformSection): void {
    this.section = id;
    this.mobileMenuOpen = false;
  }

  get pagedUsers(): PlatformUser[] {
    const start = (this.usersPage - 1) * this.pageSize;
    return this.users.slice(start, start + this.pageSize);
  }

  get usersTotalPages(): number {
    return Math.max(1, Math.ceil(this.users.length / this.pageSize));
  }

  get pagedProducts(): Product[] {
    const start = (this.productsPage - 1) * this.pageSize;
    return this.products.slice(start, start + this.pageSize);
  }

  get productsTotalPages(): number {
    return Math.max(1, Math.ceil(this.products.length / this.pageSize));
  }

  get pagedOrders(): RentalOrder[] {
    const start = (this.ordersPage - 1) * this.pageSize;
    return this.orders.slice(start, start + this.pageSize);
  }

  get ordersTotalPages(): number {
    return Math.max(1, Math.ceil(this.orders.length / this.pageSize));
  }

  get pagedPayments(): PlatformPaymentRecord[] {
    const start = (this.paymentsPage - 1) * this.pageSize;
    return this.payments.slice(start, start + this.pageSize);
  }

  get paymentsTotalPages(): number {
    return Math.max(1, Math.ceil(this.payments.length / this.pageSize));
  }

  get pagedActivity(): PlatformAuditLog[] {
    const start = (this.auditPage - 1) * this.pageSize;
    return this.filteredActivity.slice(start, start + this.pageSize);
  }

  get auditTotalPages(): number {
    return Math.max(1, Math.ceil(this.filteredActivity.length / this.pageSize));
  }

  businessStatusCount(status: 'all' | Business['status']): number {
    if (status === 'all') {
      return this.businesses.length;
    }
    return this.businesses.filter((business) => business.status === status).length;
  }

  reviewPendingBusinesses(): void {
    this.selectSection('businesses');
    this.statusFilter = 'pending';
  }

  summary: PlatformSummary | null = null;
  businesses: Business[] = [];
  users: PlatformUser[] = [];
  products: Product[] = [];
  orders: RentalOrder[] = [];
  payments: PlatformPaymentRecord[] = [];
  report: PlatformReportSummary | null = null;
  activity: PlatformAuditLog[] = [];
  notifications: NotificationItem[] = [];
  unreadNotifications = 0;
  settings: Record<string, string> = {};

  search = '';
  statusFilter: 'all' | Business['status'] = 'all';
  userRoleFilter = '';
  userSearch = '';
  userActiveFilter = '';
  productBusinessFilter = '';
  productSearch = '';
  productActiveFilter = '';
  orderBusinessFilter = '';
  orderStatusFilter = '';
  paymentBusinessFilter = '';
  paymentStatusFilter = '';
  paymentMethodFilter = '';
  reportStart = '';
  reportEnd = '';
  auditSearch = '';

  saving = false;
  loading = false;
  error = '';
  notice = '';
  subscriptionBusinessId: number | null = null;
  subscriptionPlan = '';
  subscriptionStatus: Business['subscription_status'] = 'trialing';
  subscriptionEndsAt = '';
  adminBusinessId = '';
  adminEmail = '';
  adminName = '';
  adminPhone = '';
  adminPassword = '';

  profileName = '';
  profilePhone = '';
  currentPassword = '';
  newPassword = '';
  confirmPassword = '';

  ngOnInit(): void {
    const signedIn = this.api.user();
    if (signedIn?.role !== 'platform_admin') {
      void this.router.navigateByUrl('/account');
      return;
    }
    this.profileName = signedIn.display_name;
    this.profilePhone = signedIn.phone || '';
    this.startAutoRefresh();
    void this.refresh();
  }

  ionViewWillEnter(): void {
    const signedIn = this.api.user();
    if (signedIn?.role === 'platform_admin') {
      this.profileName = signedIn.display_name;
      this.profilePhone = signedIn.phone || '';
      this.startAutoRefresh();
      void this.refresh();
    }
  }

  readonly autoRefreshIntervalMs = 60_000;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private readonly handleVisibilityChange = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      void this.refreshIfVisibleAndIdle();
    }
  };
  private loadGeneration = 0;

  startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.handleVisibilityChange);
    }
    this.autoRefreshTimer = setInterval(() => {
      void this.refreshIfVisibleAndIdle();
    }, this.autoRefreshIntervalMs);
  }

  stopAutoRefresh(): void {
    if (this.autoRefreshTimer !== null) {
      clearInterval(this.autoRefreshTimer);
      this.autoRefreshTimer = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
  }

  async refreshIfVisibleAndIdle(): Promise<void> {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
      return;
    }
    if (this.loading || this.saving || !this.api.hasValidSession()) {
      return;
    }
    await this.refresh();
  }

  ngOnDestroy(): void {
    this.stopAutoRefresh();
    this.loadGeneration += 1;
  }

  signOut(): void {
    this.stopAutoRefresh();
    this.loadGeneration += 1;
    this.summary = null;
    this.businesses = [];
    this.users = [];
    this.products = [];
    this.orders = [];
    this.payments = [];
    this.report = null;
    this.activity = [];
    this.notifications = [];
    this.unreadNotifications = 0;
    this.settings = {};
    this.loading = false;
    this.api.logout('You have signed out.');
    void this.router.navigateByUrl('/account', { replaceUrl: true });
  }

  hideBrokenImage(event: Event): void {
    if (event.currentTarget instanceof HTMLImageElement) {
      event.currentTarget.style.display = 'none';
    }
  }

  get filteredBusinesses(): Business[] {
    const term = this.search.trim().toLowerCase();
    return this.businesses.filter((business) => {
      const matchesStatus = this.statusFilter === 'all' || business.status === this.statusFilter;
      const matchesSearch =
        !term ||
        [business.name, business.slug, business.owner_name || '', business.owner_email || '']
          .join(' ')
          .toLowerCase()
          .includes(term);
      return matchesStatus && matchesSearch;
    });
  }

  get filteredActivity(): PlatformAuditLog[] {
    const term = this.auditSearch.trim().toLowerCase();
    return this.activity.filter(
      (entry) =>
        !term ||
        entry.action.toLowerCase().includes(term) ||
        entry.entity_type.toLowerCase().includes(term) ||
        (entry.business_name || 'platform').toLowerCase().includes(term),
    );
  }

  async refresh(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.error = '';
    try {
      const reportRange = this.reportDateRange();
      const [summary, businesses, settings, activity, users, products, orders, payments, report, notificationFeed] =
        await Promise.all([
          firstValueFrom(this.api.platformSummary()),
          firstValueFrom(this.api.platformBusinesses()),
          firstValueFrom(this.api.platformSettings()),
          firstValueFrom(this.api.platformAuditLogs(100)),
          firstValueFrom(
            this.api.platformUsers({
              role: this.userRoleFilter || undefined,
              search: this.userSearch || undefined,
              is_active: this.parseOptionalBool(this.userActiveFilter),
            }),
          ),
          firstValueFrom(
            this.api.platformProducts({
              business_id: this.productBusinessFilter ? Number(this.productBusinessFilter) : undefined,
              search: this.productSearch || undefined,
              is_active: this.parseOptionalBool(this.productActiveFilter),
            }),
          ),
          firstValueFrom(
            this.api.platformOrders({
              business_id: this.orderBusinessFilter ? Number(this.orderBusinessFilter) : undefined,
              status: this.orderStatusFilter || undefined,
              limit: 100,
            }),
          ),
          firstValueFrom(
            this.api.platformPayments({
              business_id: this.paymentBusinessFilter ? Number(this.paymentBusinessFilter) : undefined,
              status: this.paymentStatusFilter || undefined,
              method: this.paymentMethodFilter || undefined,
              limit: 100,
            }),
          ),
          firstValueFrom(this.api.platformReports(reportRange?.starts_at, reportRange?.ends_at)),
          firstValueFrom(this.api.notifications(false, 50)),
        ]);
      if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
        return;
      }
      this.summary = summary;
      this.businesses = businesses;
      this.settings = {
        marketplace_name: 'Karaoke Marketplace',
        support_email: '',
        maintenance_mode: 'false',
        default_subscription_plan: 'starter',
        ...settings,
      };
      this.activity = activity;
      this.users = users;
      this.products = products;
      this.orders = orders;
      this.payments = payments;
      this.report = report;
      this.notifications = notificationFeed.items;
      this.unreadNotifications = notificationFeed.unread_count;
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

  async loadUsers(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.users = await firstValueFrom(
        this.api.platformUsers({
          role: this.userRoleFilter || undefined,
          search: this.userSearch || undefined,
          is_active: this.parseOptionalBool(this.userActiveFilter),
        }),
      );
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleUserActive(user: PlatformUser): Promise<void> {
    const nextState = !user.is_active;
    const decision = await this.confirmDialog.open({
      title: nextState ? `Enable ${user.display_name}?` : `Disable ${user.display_name}?`,
      message: nextState
        ? `Restore sign-in access for ${user.email}.`
        : `${user.email} will immediately lose access to sign in across the platform.`,
      confirmLabel: nextState ? 'Enable account' : 'Disable account',
      tone: nextState ? 'primary' : 'danger',
    });
    if (!decision.confirmed) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.platformSetUserActive(user.id, nextState));
      this.notice = `Account ${user.email} ${nextState ? 'enabled' : 'disabled'}.`;
      this.toast.success(this.notice);
      await this.loadUsers();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async loadProducts(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.products = await firstValueFrom(
        this.api.platformProducts({
          business_id: this.productBusinessFilter ? Number(this.productBusinessFilter) : undefined,
          search: this.productSearch || undefined,
          is_active: this.parseOptionalBool(this.productActiveFilter),
        }),
      );
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleProductActive(product: Product): Promise<void> {
    const nextState = !product.is_active;
    const decision = await this.confirmDialog.open({
      title: nextState ? `Activate "${product.name}"?` : `Deactivate "${product.name}"?`,
      message: nextState
        ? `Make "${product.name}" from ${product.business_name} visible again in the public catalog.`
        : `Hide "${product.name}" from ${product.business_name} in the public marketplace catalog.`,
      confirmLabel: nextState ? 'Activate product' : 'Deactivate product',
      tone: nextState ? 'primary' : 'danger',
    });
    if (!decision.confirmed) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.platformSetProductActive(product.id, nextState));
      this.notice = `Product "${product.name}" ${nextState ? 'activated' : 'deactivated'}.`;
      this.toast.success(this.notice);
      await this.loadProducts();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async loadOrdersAndPayments(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [orders, payments] = await Promise.all([
        firstValueFrom(
          this.api.platformOrders({
            business_id: this.orderBusinessFilter ? Number(this.orderBusinessFilter) : undefined,
            status: this.orderStatusFilter || undefined,
            limit: 100,
          }),
        ),
        firstValueFrom(
          this.api.platformPayments({
            business_id: this.paymentBusinessFilter ? Number(this.paymentBusinessFilter) : undefined,
            status: this.paymentStatusFilter || undefined,
            method: this.paymentMethodFilter || undefined,
            limit: 100,
          }),
        ),
      ]);
      this.orders = orders;
      this.payments = payments;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async loadReport(): Promise<void> {
    if ((this.reportStart && !this.reportEnd) || (!this.reportStart && this.reportEnd)) {
      this.error = 'Select both a start date and end date to filter platform reports.';
      return;
    }
    const range = this.reportDateRange();
    if (this.reportStart && this.reportEnd && !range) {
      this.error = 'Report end date must be after the start date.';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      this.report = await firstValueFrom(this.api.platformReports(range?.starts_at, range?.ends_at));
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  clearReportFilter(): void {
    this.reportStart = '';
    this.reportEnd = '';
    void this.loadReport();
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

  async saveProfile(): Promise<void> {
    this.fieldErrors = {};
    if (!this.profileName.trim()) {
      this.fieldErrors['profileName'] = 'Enter your display name.';
      this.error = 'Display name is required.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const updated = await firstValueFrom(
        this.api.updateProfile(this.profileName.trim(), this.profilePhone.trim() || null),
      );
      this.profileName = updated.display_name;
      this.profilePhone = updated.phone || '';
      this.notice = 'Platform administrator profile updated.';
      this.toast.success(this.notice);
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async changePassword(): Promise<void> {
    this.fieldErrors = {};
    this.error = '';
    this.notice = '';
    if (!this.currentPassword) {
      this.fieldErrors['currentPassword'] = 'Enter your current password.';
    }
    if (this.newPassword.length < 12) {
      this.fieldErrors['newPassword'] = 'Use at least 12 characters.';
    }
    if (this.newPassword !== this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Password confirmation does not match.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = 'Please fix the highlighted password fields below.';
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.changePassword(this.currentPassword, this.newPassword));
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.notice = response.message;
      this.toast.success(this.notice);
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async changeStatus(business: Business, status: 'active' | 'suspended' | 'rejected'): Promise<void> {
    const actionLabel =
      status === 'active'
        ? business.status === 'suspended'
          ? 'Reactivate'
          : 'Approve'
        : status === 'suspended'
          ? 'Suspend'
          : 'Reject';
    const messageMap: Record<'active' | 'suspended' | 'rejected', string> = {
      active:
        business.status === 'suspended'
          ? `Restore ${business.name} to active status so the business owner and staff can resume operations.`
          : `Approve ${business.name} so the owner can sign in, publish equipment, and receive customer bookings.`,
      suspended: `Suspend ${business.name} and temporarily hide its storefront from customers.`,
      rejected: `Reject the application for ${business.name}. The applicant will remain blocked from the owner portal.`,
    };
    const decision = await this.confirmDialog.open({
      title: `${actionLabel} ${business.name}?`,
      message: messageMap[status],
      confirmLabel: `${actionLabel} business`,
      tone: status === 'active' ? 'primary' : 'danger',
      inputLabel: status === 'active' ? 'Approval note (optional)' : `Reason for ${status} (optional)`,
      inputPlaceholder:
        status === 'active' ? 'Optional welcome or review note' : 'Add context for this moderation decision',
    });
    if (!decision.confirmed) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.setBusinessStatus(business.id, status, decision.note || null));
      this.notice = `${business.name} is now ${status}.`;
      this.toast.success(this.notice);
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleListing(business: Business): Promise<void> {
    if (business.is_listed) {
      const decision = await this.confirmDialog.open({
        title: `Hide ${business.name} from marketplace?`,
        message: `Customers will no longer see ${business.name} in the public marketplace directory until you publish its listing again.`,
        confirmLabel: 'Hide listing',
        tone: 'danger',
      });
      if (!decision.confirmed) {
        return;
      }
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.setBusinessListing(business.id, !business.is_listed));
      this.notice = `${business.name} ${business.is_listed ? 'removed from' : 'listed on'} the marketplace.`;
      this.toast.success(this.notice);
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  openSubscription(business: Business): void {
    this.subscriptionBusinessId = business.id;
    this.subscriptionPlan = business.subscription_plan;
    this.subscriptionStatus = business.subscription_status;
    this.subscriptionEndsAt = business.subscription_ends_at
      ? this.localDateTime(new Date(business.subscription_ends_at))
      : '';
  }

  async saveSubscription(): Promise<void> {
    if (!this.subscriptionBusinessId || !this.subscriptionPlan.trim()) {
      this.error = 'Select a business and enter a subscription plan.';
      return;
    }
    let endsAt: string | null = null;
    if (this.subscriptionEndsAt) {
      const parsed = new Date(this.subscriptionEndsAt);
      if (Number.isNaN(parsed.getTime())) {
        this.error = 'Enter a valid subscription end date and time.';
        return;
      }
      endsAt = parsed.toISOString();
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(
        this.api.updateBusinessSubscription(this.subscriptionBusinessId, {
          subscription_plan: this.subscriptionPlan.trim(),
          subscription_status: this.subscriptionStatus,
          subscription_ends_at: endsAt,
        }),
      );
      this.notice = 'Subscription details updated.';
      this.toast.success(this.notice);
      this.subscriptionBusinessId = null;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async saveSetting(key: string): Promise<void> {
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.updatePlatformSetting(key, (this.settings[key] || '').trim()));
      this.notice = 'Platform setting saved.';
      this.toast.success(this.notice);
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async createBusinessAdmin(): Promise<void> {
    this.fieldErrors = {};
    const businessId = Number(this.adminBusinessId);
    if (!businessId) {
      this.fieldErrors['adminBusiness'] = 'Select an active business.';
    }
    if (!this.adminName.trim()) {
      this.fieldErrors['adminName'] = 'Enter the administrator’s full name.';
    }
    if (!this.adminEmail.trim() || !this.adminEmail.includes('@')) {
      this.fieldErrors['adminEmail'] = 'Enter a valid email address.';
    }
    if (this.adminPassword.length < 12) {
      this.fieldErrors['adminPassword'] = 'Use at least 12 characters.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = 'Please fix the highlighted fields below.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(
        this.api.createBusinessAdmin(businessId, {
          email: this.adminEmail.trim(),
          display_name: this.adminName.trim(),
          phone: this.adminPhone.trim() || null,
          password: this.adminPassword,
        }),
      );
      this.notice = 'Business administrator created.';
      this.toast.success(this.notice);
      this.adminBusinessId = '';
      this.adminEmail = '';
      this.adminName = '';
      this.adminPhone = '';
      this.adminPassword = '';
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  private parseOptionalBool(value: string): boolean | undefined {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
    return undefined;
  }

  private reportDateRange(): { starts_at: string; ends_at: string } | null {
    if (!this.reportStart || !this.reportEnd) {
      return null;
    }
    const starts = new Date(this.reportStart);
    const ends = new Date(this.reportEnd);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      return null;
    }
    return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
  }

  private localDateTime(date: Date): string {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  private errorMessage(error: unknown): string {
    return extractApiError(error, 'The requested platform change could not be completed.');
  }
}
