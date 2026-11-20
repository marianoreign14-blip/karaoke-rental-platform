import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
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

type PlatformSection =
  'businesses' | 'users' | 'products' | 'orders' | 'reports' | 'audit' | 'notifications' | 'settings';

@Component({
  selector: 'app-platform',
  templateUrl: './platform.page.html',
  styleUrls: ['./platform.page.scss'],
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, IonContent, IonHeader],
})
export class PlatformPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);

  readonly currentUser = this.api.user;
  readonly sections: { id: PlatformSection; label: string }[] = [
    { id: 'businesses', label: 'Businesses' },
    { id: 'users', label: 'Users & Customers' },
    { id: 'products', label: 'Products' },
    { id: 'orders', label: 'Orders & Payments' },
    { id: 'reports', label: 'Reports & Analytics' },
    { id: 'audit', label: 'Audit Logs' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'settings', label: 'Settings & Profile' },
  ];
  section: PlatformSection = 'businesses';

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
    void this.refresh();
  }

  ionViewWillEnter(): void {
    const signedIn = this.api.user();
    if (signedIn?.role === 'platform_admin') {
      this.profileName = signedIn.display_name;
      this.profilePhone = signedIn.phone || '';
      void this.refresh();
    }
  }

  private loadGeneration = 0;

  signOut(): void {
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
    if (!window.confirm(`${nextState ? 'Enable' : 'Disable'} account ${user.email}?`)) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.platformSetUserActive(user.id, nextState));
      this.notice = `Account ${user.email} ${nextState ? 'enabled' : 'disabled'}.`;
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
    if (!window.confirm(`${nextState ? 'Activate' : 'Deactivate'} "${product.name}" (${product.business_name})?`)) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.platformSetProductActive(product.id, nextState));
      this.notice = `Product "${product.name}" ${nextState ? 'activated' : 'deactivated'}.`;
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
    if (!this.profileName.trim()) {
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
    if (!this.currentPassword) {
      this.error = 'Enter your current password.';
      return;
    }
    if (this.newPassword.length < 12) {
      this.error = 'New password must be at least 12 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error = 'New password confirmation does not match.';
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.changePassword(this.currentPassword, this.newPassword));
      this.currentPassword = '';
      this.newPassword = '';
      this.confirmPassword = '';
      this.notice = response.message;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async changeStatus(business: Business, status: 'active' | 'suspended' | 'rejected'): Promise<void> {
    const note = window.prompt(status === 'active' ? 'Approval note (optional)' : `Note for ${status} (optional)`, '');
    if (note === null) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.setBusinessStatus(business.id, status, note.trim() || null));
      this.notice = `${business.name} is now ${status}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async toggleListing(business: Business): Promise<void> {
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await firstValueFrom(this.api.setBusinessListing(business.id, !business.is_listed));
      this.notice = `${business.name} ${business.is_listed ? 'removed from' : 'listed on'} the marketplace.`;
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
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async createBusinessAdmin(): Promise<void> {
    const businessId = Number(this.adminBusinessId);
    if (!businessId || !this.adminEmail.trim() || !this.adminName.trim() || this.adminPassword.length < 12) {
      this.error = 'Select an active business and enter a name, email, and password of at least 12 characters.';
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
