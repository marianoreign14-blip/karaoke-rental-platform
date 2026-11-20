import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject, ViewChild } from '@angular/core';
import type { ElementRef, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import type {
  AdminOrderDetail,
  AdminPaymentRecord,
  Business,
  BusinessAuditLog,
  BusinessCategory,
  BusinessStaff,
  CalendarEntry,
  Customer,
  InventoryAsset,
  NotificationItem,
  OrderRequestReview,
  PaymentEntry,
  Product,
  QualityTier,
  RentalOrder,
  RentalPackage,
  ReportSummary,
} from '../core/api.service';

type AdminSection =
  | 'orders'
  | 'transactions'
  | 'calendar'
  | 'products'
  | 'classifications'
  | 'packages'
  | 'inventory'
  | 'customers'
  | 'reports'
  | 'notifications'
  | 'settings'
  | 'staff'
  | 'profile';
type PricingBasis = 'unconfigured' | 'per_rental' | 'duration';
type PackageDraft = { product_id: number; quantity: number };

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink, IonContent, IonHeader],
})
export class AdminPage implements OnInit, OnDestroy {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('productNameInput') private productNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('productImageInput') private productImageInput?: ElementRef<HTMLInputElement>;
  @ViewChild('packageImageInput') private packageImageInput?: ElementRef<HTMLInputElement>;
  @ViewChild('businessLogoInput') private businessLogoInput?: ElementRef<HTMLInputElement>;
  @ViewChild('businessBannerInput') private businessBannerInput?: ElementRef<HTMLInputElement>;

  readonly currentUser = this.api.user;
  readonly isBusinessAdmin = this.api.isBusinessAdmin;
  readonly sections: { id: AdminSection; label: string }[] = [
    { id: 'orders', label: 'Orders & payments' },
    { id: 'transactions', label: 'Transactions' },
    { id: 'calendar', label: 'Booking calendar' },
    { id: 'products', label: 'Products' },
    { id: 'classifications', label: 'Classifications' },
    { id: 'packages', label: 'Packages' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'customers', label: 'Customers' },
    { id: 'reports', label: 'Reports' },
    { id: 'notifications', label: 'Notifications' },
    { id: 'settings', label: 'Business settings' },
    { id: 'staff', label: 'Staff' },
    { id: 'profile', label: 'My profile' },
  ];
  section: AdminSection = 'orders';
  orders: RentalOrder[] = [];
  orderSearch = '';
  orderStatusFilter: 'all' | RentalOrder['status'] = 'all';
  inspectedOrderId: number | null = null;
  inspectedOrderDetail: AdminOrderDetail | null = null;
  paymentsLedger: AdminPaymentRecord[] = [];
  paymentStatusFilter = '';
  paymentMethodFilter = '';
  paymentKindFilter = '';
  calendarEntries: CalendarEntry[] = [];
  calendarStart = '';
  calendarEnd = '';
  notifications: NotificationItem[] = [];
  unreadNotifications = 0;
  products: Product[] = [];
  packages: RentalPackage[] = [];
  tiers: QualityTier[] = [];
  categories: BusinessCategory[] = [];
  business: Business | null = null;
  staff: BusinessStaff[] = [];
  auditLogs: BusinessAuditLog[] = [];
  reportStart = '';
  reportEnd = '';
  businessProfileDraft = {
    name: '',
    description: '',
    contact_email: '',
    contact_phone: '',
    address: '',
    brand_primary: '#252729',
    brand_secondary: '#fffdf8',
    brand_accent: '#a63d40',
  };
  businessLogoFile: File | null = null;
  businessBannerFile: File | null = null;
  businessLogoPreviewUrl = '';
  businessBannerPreviewUrl = '';
  protectedBusinessLogoUrl = '';
  protectedBusinessBannerUrl = '';
  protectedProductImages: Record<number, string> = {};
  protectedPackageImages: Record<number, string> = {};
  staffName = '';
  staffEmail = '';
  staffPhone = '';
  staffPassword = '';
  categoryId: number | null = null;
  categoryName = '';
  categoryActive = true;
  productSearch = '';
  productStatusFilter: 'all' | 'active' | 'inactive' = 'all';
  assets: InventoryAsset[] = [];
  assetSearch = '';
  assetConditionFilter: 'all' | InventoryAsset['condition'] = 'all';
  customers: Customer[] = [];
  customerSearch = '';
  requests: OrderRequestReview[] = [];
  report: ReportSummary | null = null;
  myProfileName = '';
  myProfilePhone = '';
  myCurrentPassword = '';
  myNewPassword = '';
  myConfirmPassword = '';
  loading = false;
  saving = false;
  error = '';
  notice = '';

  productId: number | null = null;
  productName = '';
  productCategory: Product['category'] = 'karaoke';
  productQualityId = '';
  productDescription = '';
  productImageUrl = '';
  productImageFile: File | null = null;
  productImagePreviewUrl = '';
  productPrice = '';
  productInitialStock = '';
  productPriceDrafts: Record<number, string | number> = {};
  productStockDrafts: Record<number, string | number> = {};
  productPricingBasis: PricingBasis = 'per_rental';
  productInterval = '';
  productRounding: 'ceil' | 'pro_rata' = 'ceil';
  productActive = true;

  qualityId: number | null = null;
  qualityName = '';
  qualityActive = true;

  packageId: number | null = null;
  packageName = '';
  packageDescription = '';
  packageImageUrl = '';
  packageImageFile: File | null = null;
  packageImagePreviewUrl = '';
  packagePrice = '';
  packagePricingBasis: PricingBasis = 'unconfigured';
  packageInterval = '';
  packageRounding: 'ceil' | 'pro_rata' = 'ceil';
  packageActive = true;
  packageComponents: PackageDraft[] = [];
  selectedComponentId = '';

  assetProductId = '';
  assetTag = '';
  assetCondition: InventoryAsset['condition'] = 'available';
  manualPaymentOrderId: number | null = null;
  manualPaymentKind: 'payment' | 'refund' = 'payment';
  manualPaymentAmount = '';
  manualPaymentMethod: PaymentEntry['method'] = 'cash';
  manualPaymentDate = this.localDateTime(new Date());
  manualPaymentReference = '';
  manualPaymentNotes = '';
  paymentProofPreviews: Record<number, string> = {};

  get visibleSections(): { id: AdminSection; label: string }[] {
    return this.sections.filter((item) => (item.id !== 'settings' && item.id !== 'staff') || this.isBusinessAdmin());
  }

  get activeOrderCount(): number {
    return this.orders.filter((order) => order.status === 'pending_admin' || order.status === 'confirmed').length;
  }

  get pendingPaymentCount(): number {
    return this.paymentsLedger.filter((entry) => entry.status === 'submitted').length;
  }

  get activeProducts(): Product[] {
    return this.products.filter((product) => product.is_active);
  }

  get filteredOrders(): RentalOrder[] {
    const term = this.orderSearch.trim().toLowerCase();
    return this.orders.filter((order) => {
      const matchesStatus = this.orderStatusFilter === 'all' || order.status === this.orderStatusFilter;
      const matchesSearch =
        !term ||
        String(order.id).includes(term) ||
        order.customer_name.toLowerCase().includes(term) ||
        order.lines.some((line) => line.name.toLowerCase().includes(term));
      return matchesStatus && matchesSearch;
    });
  }

  get filteredProducts(): Product[] {
    const term = this.productSearch.trim().toLowerCase();
    return this.products.filter((product) => {
      const matchesSearch =
        !term ||
        [product.name, product.category, product.quality_name].some((value) => value.toLowerCase().includes(term));
      const matchesStatus =
        this.productStatusFilter === 'all' ||
        (this.productStatusFilter === 'active' ? product.is_active : !product.is_active);
      return matchesSearch && matchesStatus;
    });
  }

  get filteredAssets(): InventoryAsset[] {
    const term = this.assetSearch.trim().toLowerCase();
    return this.assets.filter((asset) => {
      const matchesCondition = this.assetConditionFilter === 'all' || asset.condition === this.assetConditionFilter;
      const matchesSearch =
        !term ||
        asset.asset_tag.toLowerCase().includes(term) ||
        asset.product_name.toLowerCase().includes(term) ||
        asset.category.toLowerCase().includes(term);
      return matchesCondition && matchesSearch;
    });
  }

  get filteredCustomers(): Customer[] {
    const term = this.customerSearch.trim().toLowerCase();
    return this.customers.filter(
      (customer) =>
        !term ||
        customer.display_name.toLowerCase().includes(term) ||
        customer.email.toLowerCase().includes(term) ||
        (customer.phone || '').toLowerCase().includes(term),
    );
  }

  ngOnInit(): void {
    const signedIn = this.api.user();
    if (signedIn?.role !== 'business_admin' && signedIn?.role !== 'business_staff') {
      this.error = 'Administrator access is required.';
      return;
    }
    this.myProfileName = signedIn.display_name;
    this.myProfilePhone = signedIn.phone || '';
    void this.refresh();
  }

  ionViewWillEnter(): void {
    const signedIn = this.api.user();
    if (signedIn?.role === 'business_admin' || signedIn?.role === 'business_staff') {
      this.myProfileName = signedIn.display_name;
      this.myProfilePhone = signedIn.phone || '';
      void this.refresh();
    }
  }

  private loadGeneration = 0;

  ngOnDestroy(): void {
    this.loadGeneration += 1;
    this.releaseProductImagePreview();
    this.releasePackageImagePreview();
    this.releaseBusinessImagePreviews();
    this.releaseProtectedImageUrls();
    for (const preview of Object.values(this.paymentProofPreviews)) {
      URL.revokeObjectURL(preview);
    }
  }

  signOut(): void {
    this.loadGeneration += 1;
    this.orders = [];
    this.requests = [];
    this.products = [];
    this.packages = [];
    this.assets = [];
    this.customers = [];
    this.paymentsLedger = [];
    this.calendarEntries = [];
    this.notifications = [];
    this.unreadNotifications = 0;
    this.staff = [];
    this.auditLogs = [];
    this.business = null;
    this.report = null;
    this.inspectedOrderId = null;
    this.inspectedOrderDetail = null;
    this.loading = false;
    this.api.logout('You have signed out.');
    void this.router.navigateByUrl('/account', { replaceUrl: true });
  }

  async refresh(): Promise<void> {
    const generation = ++this.loadGeneration;
    this.loading = true;
    this.error = '';
    try {
      const reportDates = this.reportDateRange();
      const calendarDates = this.calendarDateRange();
      const ownerAccess = this.isBusinessAdmin();
      const [
        orders,
        requests,
        products,
        tiers,
        packages,
        assets,
        customers,
        report,
        categories,
        business,
        staff,
        auditLogs,
        paymentsLedger,
        calendarEntries,
        notificationFeed,
      ] = await Promise.all([
        firstValueFrom(this.api.adminOrders()),
        firstValueFrom(this.api.adminRequests()),
        firstValueFrom(this.api.adminProducts()),
        firstValueFrom(this.api.adminTiers()),
        firstValueFrom(this.api.adminPackages()),
        firstValueFrom(this.api.inventory()),
        firstValueFrom(this.api.customers()),
        firstValueFrom(this.api.report(reportDates?.starts_at, reportDates?.ends_at)),
        firstValueFrom(this.api.adminCategories()),
        firstValueFrom(this.api.businessSettings()),
        ownerAccess ? firstValueFrom(this.api.businessStaff()) : Promise.resolve([]),
        ownerAccess ? firstValueFrom(this.api.adminAuditLogs(50)) : Promise.resolve([]),
        firstValueFrom(
          this.api.adminPayments({
            status: this.paymentStatusFilter || undefined,
            method: this.paymentMethodFilter || undefined,
            kind: this.paymentKindFilter || undefined,
          }),
        ),
        firstValueFrom(this.api.adminCalendar(calendarDates?.starts_at, calendarDates?.ends_at)),
        firstValueFrom(this.api.notifications(false, 50)),
      ]);
      if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
        return;
      }
      this.orders = orders;
      this.requests = requests;
      this.products = products;
      this.tiers = tiers;
      this.categories = categories;
      this.business = business;
      this.businessProfileDraft = {
        name: business.name,
        description: business.description,
        contact_email: business.contact_email || '',
        contact_phone: business.contact_phone || '',
        address: business.address || '',
        brand_primary: business.brand_primary,
        brand_secondary: business.brand_secondary,
        brand_accent: business.brand_accent,
      };
      this.staff = staff;
      this.auditLogs = auditLogs;
      this.paymentsLedger = paymentsLedger;
      this.calendarEntries = calendarEntries;
      this.notifications = notificationFeed.items;
      this.unreadNotifications = notificationFeed.unread_count;
      this.productPriceDrafts = {};
      this.productStockDrafts = {};
      for (const product of products) {
        this.productPriceDrafts[product.id] = (product.price_cents / 100).toFixed(2);
        this.productStockDrafts[product.id] = String(product.stock_count);
      }
      if (!this.productId) {
        if (!this.productQualityId) {
          this.productQualityId = this.standardQualityId();
        }
        const activeCategoryExists = categories.some(
          (cat) => cat.is_active && cat.name.toLowerCase() === this.productCategory.toLowerCase(),
        );
        if (!activeCategoryExists) {
          this.productCategory =
            categories.find((cat) => cat.is_active && cat.name.toLowerCase() === 'karaoke')?.name ||
            categories.find((cat) => cat.is_active)?.name ||
            '';
        }
      }
      this.packages = packages;
      this.assets = assets;
      this.customers = customers;
      this.report = report;
      if (this.inspectedOrderId !== null) {
        if (orders.some((order) => order.id === this.inspectedOrderId)) {
          const detail = await firstValueFrom(this.api.adminOrderDetail(this.inspectedOrderId));
          if (generation !== this.loadGeneration || !this.api.hasValidSession()) {
            return;
          }
          this.inspectedOrderDetail = detail;
        } else {
          this.inspectedOrderId = null;
          this.inspectedOrderDetail = null;
        }
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

  async toggleOrderDetail(orderId: number): Promise<void> {
    if (this.inspectedOrderId === orderId) {
      this.inspectedOrderId = null;
      this.inspectedOrderDetail = null;
      return;
    }
    this.error = '';
    try {
      this.inspectedOrderDetail = await this.firstValue(this.api.adminOrderDetail(orderId));
      this.inspectedOrderId = orderId;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async loadPayments(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      this.paymentsLedger = await this.firstValue(
        this.api.adminPayments({
          status: this.paymentStatusFilter || undefined,
          method: this.paymentMethodFilter || undefined,
          kind: this.paymentKindFilter || undefined,
        }),
      );
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  async decideLedgerPayment(entry: AdminPaymentRecord, approved: boolean): Promise<void> {
    const note = window.prompt(approved ? 'Verification note (optional)' : 'Reason for rejection');
    if (note === null) {
      return;
    }
    this.error = '';
    try {
      await this.firstValue(this.api.decidePayment(entry.order_id, entry.id, approved, note.trim() || null));
      this.notice = `Payment entry #${entry.id} ${approved ? 'verified' : 'rejected'}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async loadCalendar(): Promise<void> {
    if ((this.calendarStart && !this.calendarEnd) || (!this.calendarStart && this.calendarEnd)) {
      this.error = 'Select both a start date and end date to filter the booking calendar.';
      return;
    }
    const range = this.calendarDateRange();
    if (this.calendarStart && this.calendarEnd && !range) {
      this.error = 'Calendar end date must be after the start date.';
      return;
    }
    this.loading = true;
    this.error = '';
    try {
      this.calendarEntries = await this.firstValue(this.api.adminCalendar(range?.starts_at, range?.ends_at));
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
    }
  }

  clearCalendarFilter(): void {
    this.calendarStart = '';
    this.calendarEnd = '';
    void this.loadCalendar();
  }

  async markNotificationRead(item: NotificationItem): Promise<void> {
    if (item.is_read) {
      return;
    }
    try {
      await this.firstValue(this.api.markNotificationRead(item.id));
      item.is_read = true;
      this.unreadNotifications = Math.max(0, this.unreadNotifications - 1);
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = this.errorMessage(error);
    }
  }

  async markAllNotificationsRead(): Promise<void> {
    try {
      await this.firstValue(this.api.markAllNotificationsRead());
      this.notifications = this.notifications.map((item) => ({ ...item, is_read: true }));
      this.unreadNotifications = 0;
      this.notice = 'All notifications marked as read.';
      this.changeDetector.markForCheck();
    } catch (error) {
      this.error = this.errorMessage(error);
    }
  }

  async saveMyProfile(): Promise<void> {
    if (!this.myProfileName.trim()) {
      this.error = 'Display name is required.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const updated = await this.firstValue(
        this.api.updateProfile(this.myProfileName.trim(), this.myProfilePhone.trim() || null),
      );
      this.myProfileName = updated.display_name;
      this.myProfilePhone = updated.phone || '';
      this.notice = 'Your profile has been updated.';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async changeMyPassword(): Promise<void> {
    this.error = '';
    this.notice = '';
    if (!this.myCurrentPassword) {
      this.error = 'Enter your current password.';
      return;
    }
    if (this.myNewPassword.length < 12) {
      this.error = 'New password must be at least 12 characters.';
      return;
    }
    if (this.myNewPassword !== this.myConfirmPassword) {
      this.error = 'New password confirmation does not match.';
      return;
    }
    this.saving = true;
    try {
      const response = await this.firstValue(this.api.changePassword(this.myCurrentPassword, this.myNewPassword));
      this.myCurrentPassword = '';
      this.myNewPassword = '';
      this.myConfirmPassword = '';
      this.notice = response.message;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async loadReport(): Promise<void> {
    if ((this.reportStart && !this.reportEnd) || (!this.reportStart && this.reportEnd)) {
      this.error = 'Select both a start date and end date to filter reports.';
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
      this.report = await this.firstValue(this.api.report(range?.starts_at, range?.ends_at));
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

  async loadProtectedProductImage(productId: number): Promise<void> {
    if (this.protectedProductImages[productId]) {
      return;
    }
    try {
      const blob = await this.firstValue(this.api.adminProductImage(productId));
      this.protectedProductImages[productId] = URL.createObjectURL(blob);
      this.changeDetector.markForCheck();
    } catch {
      // No stored binary image available.
    }
  }

  async loadProtectedPackageImage(packageId: number): Promise<void> {
    if (this.protectedPackageImages[packageId]) {
      return;
    }
    try {
      const blob = await this.firstValue(this.api.adminPackageImage(packageId));
      this.protectedPackageImages[packageId] = URL.createObjectURL(blob);
      this.changeDetector.markForCheck();
    } catch {
      // No stored binary image available.
    }
  }

  async loadProtectedBusinessImage(kind: 'logo' | 'banner'): Promise<void> {
    if ((kind === 'logo' && this.protectedBusinessLogoUrl) || (kind === 'banner' && this.protectedBusinessBannerUrl)) {
      return;
    }
    try {
      const blob = await this.firstValue(this.api.adminBusinessImage(kind));
      const url = URL.createObjectURL(blob);
      if (kind === 'logo') {
        this.protectedBusinessLogoUrl = url;
      } else {
        this.protectedBusinessBannerUrl = url;
      }
      this.changeDetector.markForCheck();
    } catch {
      // No stored binary image available.
    }
  }

  newProduct(): void {
    this.clearProductImageSelection();
    this.productId = null;
    this.productName = '';
    this.productCategory =
      this.categories.find((category) => category.is_active && category.name.toLowerCase() === 'karaoke')?.name ||
      this.categories.find((category) => category.is_active)?.name ||
      '';
    this.productQualityId = this.standardQualityId();
    this.productDescription = '';
    this.productImageUrl = '';
    this.productPrice = '';
    this.productInitialStock = '';
    this.productPricingBasis = 'per_rental';
    this.productInterval = '';
    this.productRounding = 'ceil';
    this.productActive = true;
  }

  editProduct(product: Product): void {
    this.clearProductImageSelection();
    this.productId = product.id;
    this.productName = product.name;
    this.productCategory = product.category;
    this.productQualityId = String(product.quality_tier_id);
    this.productDescription = product.description;
    this.productImageUrl = product.image_url || '';
    this.productPrice = (product.price_cents / 100).toFixed(2);
    this.productInitialStock = String(product.stock_count);
    this.productPricingBasis = product.pricing_basis || 'unconfigured';
    this.productInterval = product.billing_interval_minutes ? String(product.billing_interval_minutes) : '';
    this.productRounding = product.rounding_rule || 'ceil';
    this.productActive = product.is_active;
    this.section = 'products';
  }

  duplicateProduct(product: Product): void {
    this.clearProductImageSelection();
    this.productId = null;
    this.productName = this.copyProductName(product);
    this.productCategory = product.category;
    this.productQualityId = String(product.quality_tier_id);
    this.productDescription = product.description;
    this.productImageUrl = product.image_url || '';
    this.productPrice = (product.price_cents / 100).toFixed(2);
    this.productInitialStock = '';
    this.productPricingBasis = product.pricing_basis || 'unconfigured';
    this.productInterval = product.billing_interval_minutes ? String(product.billing_interval_minutes) : '';
    this.productRounding = product.rounding_rule || 'ceil';
    this.productActive = true;
    this.section = 'products';
    this.error = '';
    this.notice = 'Product details copied. Enter an initial stock quantity for the copy.';
    this.productNameInput?.nativeElement.focus();
  }

  onProductImageSelected(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.clearProductImageSelection();
      this.error = 'Choose a JPEG, PNG, or WebP image.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.clearProductImageSelection();
      this.error = 'Product images must be 5 MB or smaller.';
      return;
    }

    this.releaseProductImagePreview();
    this.productImageFile = file;
    this.productImagePreviewUrl = URL.createObjectURL(file);
    this.error = '';
  }

  async saveProduct(): Promise<void> {
    const rawPrice = this.textValue(this.productPrice);
    const rawInitialStock = this.textValue(this.productInitialStock);
    const price = Number(rawPrice);
    const initialStock = Number(rawInitialStock);
    if (
      !this.productName.trim() ||
      !this.productCategory.trim() ||
      !this.productQualityId ||
      rawPrice === '' ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      this.error = 'Enter a product name, quality classification, and valid rental price.';
      return;
    }
    if (
      !this.productId &&
      (rawInitialStock === '' || !Number.isInteger(initialStock) || initialStock < 0 || initialStock > 1000)
    ) {
      this.error = 'Enter an initial stock quantity from 0 to 1,000.';
      return;
    }
    const duplicate = this.products.some(
      (product) =>
        product.id !== this.productId &&
        product.category.toLowerCase() === this.productCategory.trim().toLowerCase() &&
        product.quality_tier_id === Number(this.productQualityId) &&
        product.name.trim().toLowerCase() === this.productName.trim().toLowerCase(),
    );
    if (duplicate) {
      this.error = 'A product with this name, category, and quality classification already exists.';
      return;
    }
    const rawInterval = this.textValue(this.productInterval);
    if (this.productPricingBasis === 'duration' && (!rawInterval || Number(rawInterval) <= 0)) {
      this.error = 'Duration pricing requires an administrator-defined billing interval in minutes.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const savedProduct = await this.firstValue(
        this.api.saveProduct(
          {
            name: this.productName.trim(),
            description: this.productDescription.trim(),
            category: this.productCategory.trim(),
            quality_tier_id: Number(this.productQualityId),
            price_cents: Math.round(price * 100),
            pricing_basis: this.productPricingBasis === 'unconfigured' ? null : this.productPricingBasis,
            billing_interval_minutes: this.productPricingBasis === 'duration' ? Number(rawInterval) : null,
            rounding_rule: this.productPricingBasis === 'duration' ? this.productRounding : null,
            is_active: this.productActive,
            ...(!this.productId ? { initial_stock: initialStock } : {}),
          },
          this.productId || undefined,
        ),
      );
      this.productId = savedProduct.id;
      if (this.productImageFile) {
        try {
          const uploadedImage = await this.firstValue(
            this.api.uploadProductImage(savedProduct.id, this.productImageFile),
          );
          this.productImageUrl = uploadedImage.image_url;
          this.clearProductImageSelection();
          if (this.protectedProductImages[savedProduct.id]) {
            URL.revokeObjectURL(this.protectedProductImages[savedProduct.id]);
            delete this.protectedProductImages[savedProduct.id];
          }
        } catch (error) {
          this.error = `Product details were saved, but the image could not be uploaded: ${this.errorMessage(error)}`;
          await this.refresh();
          return;
        }
      }
      this.notice = 'Product saved.';
      await this.refresh();
      this.newProduct();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async deleteProduct(product: Product): Promise<void> {
    if (!window.confirm(`Delete "${product.name}"? Products referenced by orders or packages cannot be deleted.`)) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.deleteProduct(product.id));
      if (this.productId === product.id) {
        this.newProduct();
      }
      this.notice = `Product "${product.name}" deleted.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async saveInlinePrice(product: Product): Promise<void> {
    const rawPrice = this.textValue(this.productPriceDrafts[product.id]);
    const price = Number(rawPrice);
    if (rawPrice === '' || !Number.isFinite(price) || price < 0) {
      this.error = 'Enter a valid non-negative rental price.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.setProductPrice(product.id, Math.round(price * 100)));
      this.notice = `Rental price updated for ${product.name}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async saveInlineStock(product: Product): Promise<void> {
    const rawStock = this.textValue(this.productStockDrafts[product.id]);
    const quantity = Number(rawStock);
    if (rawStock === '' || !Number.isInteger(quantity) || quantity < 0 || quantity > 1000) {
      this.error = 'Stock must be a whole number from 0 to 1,000.';
      return;
    }

    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.setProductStock(product.id, quantity));
      this.notice = `Available stock updated for ${product.name}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  editTier(tier: QualityTier): void {
    this.qualityId = tier.id;
    this.qualityName = tier.name;
    this.qualityActive = tier.is_active !== false;
  }

  async saveTier(): Promise<void> {
    if (!this.qualityName.trim()) {
      this.error = 'Enter a quality label.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await this.firstValue(
        this.api.saveTier(
          { name: this.qualityName.trim(), is_active: this.qualityActive },
          this.qualityId || undefined,
        ),
      );
      this.notice = 'Quality label saved.';
      this.qualityId = null;
      this.qualityName = '';
      this.qualityActive = true;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  editCategory(category: BusinessCategory): void {
    this.categoryId = category.id;
    this.categoryName = category.name;
    this.categoryActive = category.is_active;
  }

  async saveCategory(): Promise<void> {
    if (!this.categoryName.trim()) {
      this.error = 'Enter a category name.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(
        this.api.saveCategory(
          { name: this.categoryName.trim(), is_active: this.categoryActive },
          this.categoryId || undefined,
        ),
      );
      this.notice = 'Equipment category saved.';
      this.categoryId = null;
      this.categoryName = '';
      this.categoryActive = true;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async saveBusinessSettings(): Promise<void> {
    const name = this.businessProfileDraft.name.trim();
    if (name.length < 2) {
      this.error = 'Business name must be at least 2 characters.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      this.business = await this.firstValue(
        this.api.updateBusinessSettings({
          ...this.businessProfileDraft,
          name,
          description: this.businessProfileDraft.description.trim(),
          contact_email: this.businessProfileDraft.contact_email.trim() || null,
          contact_phone: this.businessProfileDraft.contact_phone.trim() || null,
          address: this.businessProfileDraft.address.trim() || null,
        }),
      );
      this.notice = 'Business profile and storefront branding saved.';
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  selectBusinessImage(event: Event, kind: 'logo' | 'banner'): void {
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
    this.releaseBusinessImagePreviews(kind);
    if (kind === 'logo') {
      this.businessLogoFile = file;
      this.businessLogoPreviewUrl = URL.createObjectURL(file);
    } else {
      this.businessBannerFile = file;
      this.businessBannerPreviewUrl = URL.createObjectURL(file);
    }
    this.error = '';
  }

  async uploadBusinessImage(kind: 'logo' | 'banner'): Promise<void> {
    const image = kind === 'logo' ? this.businessLogoFile : this.businessBannerFile;
    if (!image) {
      this.error = `Choose a ${kind} image first.`;
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      this.business = await this.firstValue(this.api.uploadBusinessImage(kind, image));
      if (kind === 'logo') {
        this.businessLogoFile = null;
        if (this.businessLogoInput) {
          this.businessLogoInput.nativeElement.value = '';
        }
        if (this.protectedBusinessLogoUrl) {
          URL.revokeObjectURL(this.protectedBusinessLogoUrl);
          this.protectedBusinessLogoUrl = '';
        }
      } else {
        this.businessBannerFile = null;
        if (this.businessBannerInput) {
          this.businessBannerInput.nativeElement.value = '';
        }
        if (this.protectedBusinessBannerUrl) {
          URL.revokeObjectURL(this.protectedBusinessBannerUrl);
          this.protectedBusinessBannerUrl = '';
        }
      }
      this.releaseBusinessImagePreviews(kind);
      this.notice = `Storefront ${kind} uploaded.`;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async createStaff(): Promise<void> {
    if (!this.staffName.trim() || !this.staffEmail.trim() || this.staffPassword.length < 12) {
      this.error = 'Enter a staff name, valid email, and password of at least 12 characters.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(
        this.api.createBusinessStaff({
          email: this.staffEmail.trim(),
          display_name: this.staffName.trim(),
          phone: this.staffPhone.trim() || null,
          password: this.staffPassword,
        }),
      );
      this.staffName = '';
      this.staffEmail = '';
      this.staffPhone = '';
      this.staffPassword = '';
      this.notice = 'Staff account created.';
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async setStaffActive(member: BusinessStaff, isActive: boolean): Promise<void> {
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.setBusinessStaffActive(member.id, isActive));
      this.notice = `${member.display_name} ${isActive ? 'enabled' : 'disabled'}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  newPackage(): void {
    this.clearPackageImageSelection();
    this.packageId = null;
    this.packageName = '';
    this.packageDescription = '';
    this.packageImageUrl = '';
    this.packagePrice = '';
    this.packagePricingBasis = 'unconfigured';
    this.packageInterval = '';
    this.packageRounding = 'ceil';
    this.packageActive = true;
    this.packageComponents = [];
  }

  editPackage(rentalPackage: RentalPackage): void {
    this.clearPackageImageSelection();
    this.packageId = rentalPackage.id;
    this.packageName = rentalPackage.name;
    this.packageDescription = rentalPackage.description;
    this.packageImageUrl = rentalPackage.image_url || '';
    this.packagePrice = rentalPackage.price_cents === null ? '' : (rentalPackage.price_cents / 100).toFixed(2);
    this.packagePricingBasis = rentalPackage.pricing_basis || 'unconfigured';
    this.packageInterval = rentalPackage.billing_interval_minutes ? String(rentalPackage.billing_interval_minutes) : '';
    this.packageRounding = rentalPackage.rounding_rule || 'ceil';
    this.packageActive = rentalPackage.is_active;
    this.packageComponents = rentalPackage.components.map((component) => ({
      product_id: component.product_id,
      quantity: component.quantity,
    }));
    this.section = 'packages';
  }

  async deletePackage(rentalPackage: RentalPackage): Promise<void> {
    if (!window.confirm(`Delete package "${rentalPackage.name}"? Packages referenced by orders cannot be deleted.`)) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.deletePackage(rentalPackage.id));
      if (this.packageId === rentalPackage.id) {
        this.newPackage();
      }
      this.notice = `Package "${rentalPackage.name}" deleted.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  onPackageImageSelected(event: Event): void {
    const input = event.currentTarget;
    if (!(input instanceof HTMLInputElement)) {
      return;
    }

    const file = input.files?.[0];
    if (!file) {
      return;
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      this.clearPackageImageSelection();
      this.error = 'Choose a JPEG, PNG, or WebP image.';
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      this.clearPackageImageSelection();
      this.error = 'Package images must be 5 MB or smaller.';
      return;
    }

    this.releasePackageImagePreview();
    this.packageImageFile = file;
    this.packageImagePreviewUrl = URL.createObjectURL(file);
    this.error = '';
  }

  addPackageComponent(): void {
    const productId = Number(this.selectedComponentId);
    if (!productId) {
      return;
    }
    const existing = this.packageComponents.find((component) => component.product_id === productId);
    this.packageComponents = existing
      ? this.packageComponents.map((component) =>
          component.product_id === productId ? { ...component, quantity: component.quantity + 1 } : component,
        )
      : [...this.packageComponents, { product_id: productId, quantity: 1 }];
    this.selectedComponentId = '';
  }

  removePackageComponent(index: number): void {
    this.packageComponents = this.packageComponents.filter((_, itemIndex) => itemIndex !== index);
  }

  async savePackage(): Promise<void> {
    if (!this.packageName.trim() || this.packageComponents.length === 0) {
      this.error = 'Enter a package name and at least one equipment component.';
      return;
    }
    const rawPrice = this.textValue(this.packagePrice);
    const price = Number(rawPrice);
    if (rawPrice !== '' && (!Number.isFinite(price) || price < 0)) {
      this.error = 'Enter a valid non-negative package price.';
      return;
    }
    if (this.packagePricingBasis !== 'unconfigured' && (rawPrice === '' || !Number.isFinite(price) || price < 0)) {
      this.error = 'Enter a valid package price before configuring its pricing basis.';
      return;
    }
    const rawInterval = this.textValue(this.packageInterval);
    if (this.packagePricingBasis === 'duration' && (!rawInterval || Number(rawInterval) <= 0)) {
      this.error = 'Duration pricing requires an administrator-defined billing interval in minutes.';
      return;
    }
    if (
      this.packageComponents.some(
        (component) =>
          !Number.isInteger(Number(component.quantity)) ||
          Number(component.quantity) < 1 ||
          Number(component.quantity) > 1000,
      )
    ) {
      this.error = 'Each package component quantity must be a whole number from 1 to 1,000.';
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const savedPackage = await this.firstValue(
        this.api.savePackage(
          {
            name: this.packageName.trim(),
            description: this.packageDescription.trim(),
            price_cents: rawPrice !== '' ? Math.round(price * 100) : null,
            pricing_basis: this.packagePricingBasis === 'unconfigured' ? null : this.packagePricingBasis,
            billing_interval_minutes: this.packagePricingBasis === 'duration' ? Number(rawInterval) : null,
            rounding_rule: this.packagePricingBasis === 'duration' ? this.packageRounding : null,
            is_active: this.packageActive,
            components: this.packageComponents.map((component) => ({
              product_id: component.product_id,
              quantity: Number(component.quantity),
            })),
          },
          this.packageId || undefined,
        ),
      );
      this.packageId = savedPackage.id;
      if (this.packageImageFile) {
        try {
          const uploadedImage = await this.firstValue(
            this.api.uploadPackageImage(savedPackage.id, this.packageImageFile),
          );
          this.packageImageUrl = uploadedImage.image_url;
          this.clearPackageImageSelection();
          if (this.protectedPackageImages[savedPackage.id]) {
            URL.revokeObjectURL(this.protectedPackageImages[savedPackage.id]);
            delete this.protectedPackageImages[savedPackage.id];
          }
        } catch (error) {
          this.error = `Package details were saved, but the image could not be uploaded: ${this.errorMessage(error)}`;
          await this.refresh();
          return;
        }
      }
      this.notice = 'Package saved.';
      this.newPackage();
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async addAsset(): Promise<void> {
    if (!this.assetProductId || !this.assetTag.trim()) {
      this.error = 'Select a product and enter an asset tag.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await this.firstValue(
        this.api.addAsset({
          product_id: Number(this.assetProductId),
          asset_tag: this.assetTag.trim(),
          condition: this.assetCondition,
        }),
      );
      this.notice = 'Inventory item added.';
      this.assetTag = '';
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async updateCondition(asset: InventoryAsset, condition: InventoryAsset['condition']): Promise<void> {
    this.error = '';
    try {
      await this.firstValue(this.api.updateAsset(asset.id, condition));
      this.notice = `Condition updated for ${asset.asset_tag}.`;
      await this.refresh();
    } catch (error) {
      const message = this.errorMessage(error);
      await this.refresh();
      this.error = message;
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async deleteAsset(asset: InventoryAsset): Promise<void> {
    if (
      !window.confirm(
        `Delete inventory unit "${asset.asset_tag}"? Units with rental allocation history cannot be deleted.`,
      )
    ) {
      return;
    }
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      await this.firstValue(this.api.deleteAsset(asset.id));
      this.notice = `Inventory unit "${asset.asset_tag}" deleted.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async updateOrder(order: RentalOrder, status: RentalOrder['status']): Promise<void> {
    let note: string | null = null;
    if (status === 'rejected') {
      const entered = window.prompt('Reason for rejecting this rental request (optional)', '');
      if (entered === null) {
        return;
      }
      note = entered.trim() || null;
    }
    this.error = '';
    try {
      await this.firstValue(this.api.setOrderStatus(order.id, status, note));
      this.notice = `Order #${order.id} updated.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async decideRequest(request: OrderRequestReview, approved: boolean): Promise<void> {
    const note = window.prompt(approved ? 'Approval note (optional)' : 'Reason for rejection');
    if (note === null) {
      return;
    }
    this.error = '';
    try {
      await this.firstValue(this.api.decideRequest(request.order_id, request.id, approved, note.trim() || null));
      this.notice = `Request #${request.id} ${approved ? 'approved' : 'rejected'}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  pendingPayments(order: RentalOrder): PaymentEntry[] {
    return order.payments.filter((entry) => entry.status === 'submitted');
  }

  decidedPayments(order: RentalOrder): PaymentEntry[] {
    return order.payments.filter((entry) => entry.status !== 'submitted');
  }

  canRecordManualPayment(order: RentalOrder): boolean {
    if (order.status === 'pending_admin' || order.status === 'confirmed') {
      return true;
    }
    if (order.status === 'completed') {
      return order.balance_cents > 0 || order.paid_cents > 0;
    }
    return order.paid_cents > 0;
  }

  openManualPayment(order: RentalOrder): void {
    this.manualPaymentOrderId = order.id;
    this.manualPaymentKind = order.status === 'cancelled' || order.status === 'rejected' ? 'refund' : 'payment';
    this.manualPaymentAmount = '';
    this.manualPaymentMethod = 'cash';
    this.manualPaymentDate = this.localDateTime(new Date());
    this.manualPaymentReference = '';
    this.manualPaymentNotes = '';
    this.error = '';
  }

  paymentMethodLabel(method: string): string {
    return method.replaceAll('_', ' ');
  }

  async decidePayment(order: RentalOrder, entry: PaymentEntry, approved: boolean): Promise<void> {
    const note = window.prompt(approved ? 'Verification note (optional)' : 'Reason for rejection');
    if (note === null) {
      return;
    }
    this.error = '';
    try {
      await this.firstValue(this.api.decidePayment(order.id, entry.id, approved, note.trim() || null));
      this.notice = `Payment entry #${entry.id} ${approved ? 'verified' : 'rejected'}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async viewPaymentProof(orderId: number, paymentId: number): Promise<void> {
    this.error = '';
    try {
      const image = await this.firstValue(this.api.paymentProof(orderId, paymentId));
      const previous = this.paymentProofPreviews[paymentId];
      if (previous) {
        URL.revokeObjectURL(previous);
      }
      this.paymentProofPreviews[paymentId] = URL.createObjectURL(image);
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async recordManualPayment(): Promise<void> {
    const rawAmount = this.textValue(this.manualPaymentAmount);
    const amount = Number(rawAmount);
    const paidAt = new Date(this.manualPaymentDate);
    if (
      !this.manualPaymentOrderId ||
      rawAmount === '' ||
      !Number.isFinite(amount) ||
      amount <= 0 ||
      !this.manualPaymentDate ||
      Number.isNaN(paidAt.getTime())
    ) {
      this.error = 'Enter a valid order, amount, and payment date.';
      return;
    }
    this.saving = true;
    this.error = '';
    try {
      await this.firstValue(
        this.api.recordManualPayment(this.manualPaymentOrderId, {
          kind: this.manualPaymentKind,
          amount_cents: Math.round(amount * 100),
          method: this.manualPaymentMethod,
          paid_at: paidAt.toISOString(),
          reference_number: this.manualPaymentReference.trim() || null,
          notes: this.manualPaymentNotes.trim() || null,
        }),
      );
      this.notice = 'Manual payment entry recorded in the order history.';
      this.manualPaymentOrderId = null;
      this.manualPaymentAmount = '';
      this.manualPaymentReference = '';
      this.manualPaymentNotes = '';
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  async setCustomerActive(customer: Customer, isActive: boolean): Promise<void> {
    this.error = '';
    try {
      await this.firstValue(this.api.setCustomerActive(customer.id, isActive));
      this.notice = `Customer ${customer.email} ${isActive ? 'enabled' : 'disabled'}.`;
      await this.refresh();
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  productLabel(id: number): string {
    return this.products.find((product) => product.id === id)?.name || `Product #${id}`;
  }

  categoryLabel(category: string): string {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  private standardQualityId(): string {
    const standard = this.tiers.find(
      (tier) => tier.name.trim().toLowerCase() === 'standard' && tier.is_active !== false,
    );
    return standard ? String(standard.id) : '';
  }

  private copyProductName(product: Product): string {
    let copyNumber = 1;
    let candidate = '';
    do {
      const suffix = copyNumber === 1 ? ' (copy)' : ` (copy ${copyNumber})`;
      candidate = `${product.name.slice(0, 160 - suffix.length)}${suffix}`;
      copyNumber += 1;
    } while (
      this.products.some(
        (item) =>
          item.category === product.category &&
          item.quality_tier_id === product.quality_tier_id &&
          item.name.trim().toLowerCase() === candidate.toLowerCase(),
      )
    );
    return candidate;
  }

  private firstValue<T>(observable: Observable<T>): Promise<T> {
    return firstValueFrom(observable);
  }

  private localDateTime(date: Date): string {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  private clearProductImageSelection(): void {
    this.releaseProductImagePreview();
    this.productImageFile = null;
    if (this.productImageInput) {
      this.productImageInput.nativeElement.value = '';
    }
  }

  private releaseProductImagePreview(): void {
    if (this.productImagePreviewUrl) {
      URL.revokeObjectURL(this.productImagePreviewUrl);
      this.productImagePreviewUrl = '';
    }
  }

  private clearPackageImageSelection(): void {
    this.releasePackageImagePreview();
    this.packageImageFile = null;
    if (this.packageImageInput) {
      this.packageImageInput.nativeElement.value = '';
    }
  }

  private releasePackageImagePreview(): void {
    if (this.packageImagePreviewUrl) {
      URL.revokeObjectURL(this.packageImagePreviewUrl);
      this.packageImagePreviewUrl = '';
    }
  }

  private releaseBusinessImagePreviews(kind?: 'logo' | 'banner'): void {
    if ((!kind || kind === 'logo') && this.businessLogoPreviewUrl) {
      URL.revokeObjectURL(this.businessLogoPreviewUrl);
      this.businessLogoPreviewUrl = '';
    }
    if ((!kind || kind === 'banner') && this.businessBannerPreviewUrl) {
      URL.revokeObjectURL(this.businessBannerPreviewUrl);
      this.businessBannerPreviewUrl = '';
    }
  }

  private releaseProtectedImageUrls(): void {
    if (this.protectedBusinessLogoUrl) {
      URL.revokeObjectURL(this.protectedBusinessLogoUrl);
      this.protectedBusinessLogoUrl = '';
    }
    if (this.protectedBusinessBannerUrl) {
      URL.revokeObjectURL(this.protectedBusinessBannerUrl);
      this.protectedBusinessBannerUrl = '';
    }
    for (const url of Object.values(this.protectedProductImages)) {
      URL.revokeObjectURL(url);
    }
    this.protectedProductImages = {};
    for (const url of Object.values(this.protectedPackageImages)) {
      URL.revokeObjectURL(url);
    }
    this.protectedPackageImages = {};
  }

  private textValue(value: unknown): string {
    return String(value ?? '').trim();
  }

  private reportDateRange(): { starts_at: string; ends_at: string } | null {
    return this.parseRange(this.reportStart, this.reportEnd);
  }

  private calendarDateRange(): { starts_at: string; ends_at: string } | null {
    return this.parseRange(this.calendarStart, this.calendarEnd);
  }

  private parseRange(startRaw: string, endRaw: string): { starts_at: string; ends_at: string } | null {
    if (!startRaw || !endRaw) {
      return null;
    }
    const starts = new Date(startRaw);
    const ends = new Date(endRaw);
    if (Number.isNaN(starts.getTime()) || Number.isNaN(ends.getTime()) || ends <= starts) {
      return null;
    }
    return { starts_at: starts.toISOString(), ends_at: ends.toISOString() };
  }

  private errorMessage(error: unknown): string {
    return extractApiError(error, 'The requested change could not be completed. Please try again.');
  }
}
