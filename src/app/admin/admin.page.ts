import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject, ViewChild } from '@angular/core';
import type { ElementRef, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { Observable } from 'rxjs';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';
import type {
  Customer,
  Business,
  BusinessCategory,
  BusinessStaff,
  InventoryAsset,
  OrderRequestReview,
  PaymentEntry,
  Product,
  QualityTier,
  RentalOrder,
  RentalPackage,
  ReportSummary,
} from '../core/api.service';

type AdminSection =
  'orders' | 'products' | 'classifications' | 'packages' | 'inventory' | 'customers' | 'reports' | 'settings' | 'staff';
type PricingBasis = 'unconfigured' | 'per_rental' | 'duration';
type PackageDraft = { product_id: number; quantity: number };

@Component({
  selector: 'app-admin',
  templateUrl: './admin.page.html',
  styleUrls: ['./admin.page.scss'],
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, FormsModule, RouterLink],
})
export class AdminPage implements OnInit, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('productNameInput') private productNameInput?: ElementRef<HTMLInputElement>;
  @ViewChild('productImageInput') private productImageInput?: ElementRef<HTMLInputElement>;
  @ViewChild('packageImageInput') private packageImageInput?: ElementRef<HTMLInputElement>;

  readonly sections: { id: AdminSection; label: string }[] = [
    { id: 'orders', label: 'Orders & payments' },
    { id: 'products', label: 'Products' },
    { id: 'classifications', label: 'Classifications' },
    { id: 'packages', label: 'Packages' },
    { id: 'inventory', label: 'Inventory' },
    { id: 'customers', label: 'Customers' },
    { id: 'reports', label: 'Reports' },
    { id: 'settings', label: 'Business settings' },
    { id: 'staff', label: 'Staff' },
  ];
  section: AdminSection = 'orders';
  orders: RentalOrder[] = [];
  products: Product[] = [];
  packages: RentalPackage[] = [];
  tiers: QualityTier[] = [];
  categories: BusinessCategory[] = [];
  business: Business | null = null;
  staff: BusinessStaff[] = [];
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
  customers: Customer[] = [];
  requests: OrderRequestReview[] = [];
  report: ReportSummary | null = null;
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
  productPriceDrafts: Record<number, string> = {};
  productStockDrafts: Record<number, string> = {};
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

  private readonly api = inject(ApiService);

  get visibleSections(): { id: AdminSection; label: string }[] {
    return this.sections.filter(
      (item) => (item.id !== 'settings' && item.id !== 'staff') || this.api.user()?.role === 'business_admin',
    );
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

  ngOnInit(): void {
    if (this.api.user()?.role !== 'business_admin' && this.api.user()?.role !== 'business_staff') {
      this.error = 'Administrator access is required.';
      return;
    }
    this.refresh();
  }

  ngOnDestroy(): void {
    this.releaseProductImagePreview();
    this.releasePackageImagePreview();
    this.releaseBusinessImagePreviews();
    for (const preview of Object.values(this.paymentProofPreviews)) {
      URL.revokeObjectURL(preview);
    }
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [orders, requests, products, tiers, packages, assets, customers, report, categories, business, staff] =
        await Promise.all([
          firstValueFrom(this.api.adminOrders()),
          firstValueFrom(this.api.adminRequests()),
          firstValueFrom(this.api.adminProducts()),
          firstValueFrom(this.api.adminTiers()),
          firstValueFrom(this.api.adminPackages()),
          firstValueFrom(this.api.inventory()),
          firstValueFrom(this.api.customers()),
          firstValueFrom(this.api.report()),
          firstValueFrom(this.api.adminCategories()),
          firstValueFrom(this.api.businessSettings()),
          firstValueFrom(this.api.businessStaff()),
        ]);
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
      this.productPriceDrafts = {};
      this.productStockDrafts = {};
      for (const product of products) {
        this.productPriceDrafts[product.id] = (product.price_cents / 100).toFixed(2);
        this.productStockDrafts[product.id] = String(product.stock_count);
      }
      if (!this.productId && !this.productQualityId) {
        this.productQualityId = this.standardQualityId();
      }
      this.packages = packages;
      this.assets = assets;
      this.customers = customers;
      this.report = report;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
      this.changeDetector.markForCheck();
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
    const price = Number(this.productPrice);
    const initialStock = Number(this.productInitialStock);
    if (
      !this.productName.trim() ||
      !this.productCategory.trim() ||
      !this.productQualityId ||
      this.productPrice.trim() === '' ||
      !Number.isFinite(price) ||
      price < 0
    ) {
      this.error = 'Enter a product name, quality classification, and valid rental price.';
      return;
    }
    if (
      !this.productId &&
      (this.productInitialStock.trim() === '' ||
        !Number.isInteger(initialStock) ||
        initialStock < 0 ||
        initialStock > 1000)
    ) {
      this.error = 'Enter an initial stock quantity from 0 to 1,000.';
      return;
    }
    const duplicate = this.products.some(
      (product) =>
        product.id !== this.productId &&
        product.category === this.productCategory &&
        product.quality_tier_id === Number(this.productQualityId) &&
        product.name.trim().toLowerCase() === this.productName.trim().toLowerCase(),
    );
    if (duplicate) {
      this.error = 'A product with this name, category, and quality classification already exists.';
      return;
    }
    if (this.productPricingBasis === 'duration' && (!this.productInterval || Number(this.productInterval) <= 0)) {
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
            description: this.productDescription,
            category: this.productCategory,
            quality_tier_id: Number(this.productQualityId),
            price_cents: Math.round(price * 100),
            pricing_basis: this.productPricingBasis === 'unconfigured' ? null : this.productPricingBasis,
            billing_interval_minutes: this.productPricingBasis === 'duration' ? Number(this.productInterval) : null,
            rounding_rule: this.productPricingBasis === 'duration' ? this.productRounding : null,
            image_url: this.productImageUrl || null,
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
        } catch (error) {
          this.error = `Product details were saved, but the image could not be uploaded: ${this.errorMessage(error)}`;
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

  async saveInlinePrice(product: Product): Promise<void> {
    const price = Number(this.productPriceDrafts[product.id]);
    if (this.productPriceDrafts[product.id]?.trim() === '' || !Number.isFinite(price) || price < 0) {
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
    const quantity = Number(this.productStockDrafts[product.id]);
    if (
      this.productStockDrafts[product.id]?.trim() === '' ||
      !Number.isInteger(quantity) ||
      quantity < 0 ||
      quantity > 1000
    ) {
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
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      this.business = await this.firstValue(
        this.api.updateBusinessSettings({
          ...this.businessProfileDraft,
          contact_email: this.businessProfileDraft.contact_email || null,
          contact_phone: this.businessProfileDraft.contact_phone || null,
          address: this.businessProfileDraft.address || null,
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
      } else {
        this.businessBannerFile = null;
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
    if (this.packagePricingBasis !== 'unconfigured' && (!this.packagePrice || Number(this.packagePrice) < 0)) {
      this.error = 'Enter a valid package price before configuring its pricing basis.';
      return;
    }
    if (this.packagePricingBasis === 'duration' && (!this.packageInterval || Number(this.packageInterval) <= 0)) {
      this.error = 'Duration pricing requires an administrator-defined billing interval in minutes.';
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
            description: this.packageDescription,
            price_cents: this.packagePrice ? Math.round(Number(this.packagePrice) * 100) : null,
            pricing_basis: this.packagePricingBasis === 'unconfigured' ? null : this.packagePricingBasis,
            billing_interval_minutes: this.packagePricingBasis === 'duration' ? Number(this.packageInterval) : null,
            rounding_rule: this.packagePricingBasis === 'duration' ? this.packageRounding : null,
            is_active: this.packageActive,
            components: this.packageComponents,
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
        } catch (error) {
          this.error = `Package details were saved, but the image could not be uploaded: ${this.errorMessage(error)}`;
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
      this.error = this.errorMessage(error);
    } finally {
      this.changeDetector.markForCheck();
    }
  }

  async updateOrder(order: RentalOrder, status: RentalOrder['status']): Promise<void> {
    this.error = '';
    try {
      await this.firstValue(this.api.setOrderStatus(order.id, status, null));
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
    const amount = Number(this.manualPaymentAmount);
    if (!this.manualPaymentOrderId || !Number.isFinite(amount) || amount <= 0 || !this.manualPaymentDate) {
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
          paid_at: new Date(this.manualPaymentDate).toISOString(),
          reference_number: this.manualPaymentReference || null,
          notes: this.manualPaymentNotes || null,
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

  private errorMessage(error: unknown): string {
    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'The requested change could not be completed. Please try again.';
  }
}
