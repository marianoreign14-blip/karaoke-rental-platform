import { HttpClient, HttpHeaders, HttpParams } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import type { Observable } from 'rxjs';
import { map, tap } from 'rxjs';

import { environment } from '../../environments/environment';

export interface User {
  id: number;
  email: string;
  display_name: string;
  phone: string | null;
  role: 'customer' | 'platform_admin' | 'business_admin' | 'business_staff' | 'business_pending';
  business_id: number | null;
}

export interface Business {
  id: number;
  name: string;
  slug: string;
  description: string;
  contact_email: string | null;
  contact_phone: string | null;
  address: string | null;
  logo_url: string | null;
  banner_url: string | null;
  brand_primary: string;
  brand_secondary: string;
  brand_accent: string;
  is_listed: boolean;
  status: 'pending' | 'active' | 'suspended' | 'rejected';
  subscription_plan: string;
  subscription_status: 'active' | 'trialing' | 'past_due' | 'cancelled';
  subscription_ends_at: string | null;
  created_at: string;
  owner_name?: string | null;
  owner_email?: string | null;
  owner_active?: boolean | null;
}

export interface BusinessCategory {
  id: number;
  name: string;
  is_active: boolean;
}

export interface BusinessStaff extends User {
  is_active: boolean;
  created_at: string;
}

export interface PlatformSummary {
  businesses: number;
  active_businesses: number;
  pending_businesses: number;
  customers: number;
  orders: number;
}

export interface PlatformAuditLog {
  id: number;
  business_id: number | null;
  business_name: string | null;
  actor_id: number;
  action: string;
  entity_type: string;
  entity_id: number | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface Product {
  id: number;
  business_id: number;
  business_name: string;
  business_slug: string;
  name: string;
  description: string;
  category: string;
  quality_tier_id: number;
  quality_name: string;
  price_cents: number;
  pricing_basis: 'per_rental' | 'duration' | null;
  pricing_configured: boolean;
  billing_interval_minutes: number | null;
  rounding_rule: 'ceil' | 'pro_rata' | null;
  image_url: string | null;
  is_active: boolean;
  stock_count: number;
  available_count: number | null;
}

export type ProductInput = Omit<
  Product,
  | 'id'
  | 'business_id'
  | 'business_name'
  | 'business_slug'
  | 'quality_name'
  | 'stock_count'
  | 'available_count'
  | 'pricing_configured'
> & {
  initial_stock?: number;
};

export interface PackageComponent {
  product_id: number;
  name: string;
  category: Product['category'];
  quality_name: string;
  quantity: number;
}

export interface PackageComponentInput {
  product_id: number;
  quantity: number;
}

export interface PackageInput {
  name: string;
  description: string;
  price_cents: number | null;
  pricing_basis: Product['pricing_basis'];
  billing_interval_minutes: number | null;
  rounding_rule: Product['rounding_rule'];
  is_active: boolean;
  components: PackageComponentInput[];
}

export interface RentalPackage {
  id: number;
  business_id: number;
  business_name: string;
  business_slug: string;
  name: string;
  description: string;
  price_cents: number | null;
  pricing_basis: Product['pricing_basis'];
  billing_interval_minutes: number | null;
  rounding_rule: Product['rounding_rule'];
  image_url: string | null;
  is_active: boolean;
  pricing_configured: boolean;
  available_count: number | null;
  components: PackageComponent[];
}

export interface QualityTier {
  id: number;
  name: string;
  is_active?: boolean;
  business_id?: number;
}

export interface OrderLineInput {
  kind: 'product' | 'package';
  item_id: number;
  quantity: number;
}

export interface OrderLine {
  id: number;
  kind: 'product' | 'package';
  item_id: number;
  quantity: number;
  name: string;
  unit_price_cents: number;
  line_total_cents: number;
  components: PackageComponent[];
}

export interface OrderRequest {
  id: number;
  kind: 'modification' | 'cancellation';
  status: 'pending' | 'approved' | 'rejected';
  reason: string;
  decision_note: string | null;
  created_at: string;
  decided_at: string | null;
  decided_by_id: number | null;
}

export interface PaymentEntry {
  id: number;
  kind: 'payment' | 'refund';
  status: 'submitted' | 'verified' | 'rejected';
  amount_cents: number;
  method: 'cash' | 'gcash' | 'bank_transfer';
  reference_number: string | null;
  proof_available?: boolean;
  paid_at: string;
  notes: string | null;
  submitted_by_id: number;
  verified_by_id: number | null;
  submitted_at: string;
  decided_at: string | null;
}

export interface RentalOrder {
  id: number;
  business_id: number;
  business_name: string;
  business_slug: string;
  customer_id: number;
  customer_name: string;
  starts_at: string;
  ends_at: string;
  status: 'pending_admin' | 'confirmed' | 'rejected' | 'cancelled' | 'completed';
  total_cents: number;
  paid_cents: number;
  balance_cents: number;
  payment_status: 'unpaid' | 'partially_paid' | 'paid' | 'refunded';
  lines: OrderLine[];
  requests: OrderRequest[];
  payments: PaymentEntry[];
  history: { action: string; details: Record<string, unknown>; created_at: string; actor_id: number }[];
}

export interface OrderDraft {
  business_id: number;
  starts_at: string;
  ends_at: string;
  lines: OrderLineInput[];
}

export interface InventoryAsset {
  id: number;
  asset_tag: string;
  product_id: number;
  product_name: string;
  category: string;
  condition: 'available' | 'under_maintenance' | 'damaged' | 'unavailable';
  rental_status: string;
}

export interface Customer {
  id: number;
  email: string;
  display_name: string;
  phone: string | null;
  is_active: boolean;
  created_at: string;
}

export interface OrderRequestReview {
  id: number;
  order_id: number;
  customer_id: number;
  kind: OrderRequest['kind'];
  reason: string;
  proposed_data: OrderDraft | null;
  before_data: unknown;
  created_at: string;
}

export interface ReportSummary {
  orders: number;
  assets_in_available_condition: number;
  verified_collections_cents: number;
  collections_note: string;
}

export interface PricingFields {
  price_cents: number;
  pricing_basis: 'per_rental' | 'duration' | null;
  billing_interval_minutes: number | null;
  rounding_rule: 'ceil' | 'pro_rata' | null;
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly baseUrl = environment.apiUrl;
  private readonly tokenKey = 'karaokewebapp.access-token';
  private readonly userState = signal<User | null>(this.readSavedUser());
  readonly user = this.userState.asReadonly();
  readonly isPlatformAdmin = computed(() => this.userState()?.role === 'platform_admin');
  readonly isAdmin = computed(() => ['business_admin', 'business_staff'].includes(this.userState()?.role || ''));

  private readonly http = inject(HttpClient);

  private readSavedUser(): User | null {
    try {
      const saved = sessionStorage.getItem('karaokewebapp.user');
      return saved ? (JSON.parse(saved) as User) : null;
    } catch {
      sessionStorage.removeItem('karaokewebapp.user');
      sessionStorage.removeItem(this.tokenKey);
      return null;
    }
  }

  private headers(): HttpHeaders {
    const token = sessionStorage.getItem(this.tokenKey);
    return token ? new HttpHeaders({ Authorization: `Bearer ${token}` }) : new HttpHeaders();
  }

  private saveSession(response: { access_token: string; user: User }): void {
    sessionStorage.setItem(this.tokenKey, response.access_token);
    sessionStorage.setItem('karaokewebapp.user', JSON.stringify(response.user));
    this.userState.set(response.user);
  }

  login(email: string, password: string): Observable<User> {
    return this.http.post<{ access_token: string; user: User }>(`${this.baseUrl}/auth/login`, { email, password }).pipe(
      tap((response) => this.saveSession(response)),
      map((response) => response.user),
    );
  }

  register(input: { email: string; password: string; display_name: string; phone: string | null }): Observable<User> {
    return this.http.post<{ access_token: string; user: User }>(`${this.baseUrl}/auth/register`, input).pipe(
      tap((response) => this.saveSession(response)),
      map((response) => response.user),
    );
  }

  registerBusiness(input: {
    business_name: string;
    owner_name: string;
    email: string;
    contact_number: string;
    address: string;
    password: string;
  }): Observable<{ business_id: number; status: string; message: string }> {
    return this.http.post<{ business_id: number; status: string; message: string }>(
      `${this.baseUrl}/auth/business-register`,
      input,
    );
  }

  logout(): void {
    sessionStorage.removeItem(this.tokenKey);
    sessionStorage.removeItem('karaokewebapp.user');
    this.userState.set(null);
  }

  profile(): Observable<User> {
    return this.http.get<User>(`${this.baseUrl}/users/me`, { headers: this.headers() }).pipe(
      tap((user) => {
        sessionStorage.setItem('karaokewebapp.user', JSON.stringify(user));
        this.userState.set(user);
      }),
    );
  }

  updateProfile(display_name: string, phone: string | null): Observable<User> {
    return this.http.put<User>(`${this.baseUrl}/users/me`, { display_name, phone }, { headers: this.headers() }).pipe(
      tap((user) => {
        sessionStorage.setItem('karaokewebapp.user', JSON.stringify(user));
        this.userState.set(user);
      }),
    );
  }

  products(filters: Record<string, string | number | undefined> = {}): Observable<Product[]> {
    let params = new HttpParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== '') {
        params = params.set(key, String(value));
      }
    }
    return this.http.get<Product[]>(`${this.baseUrl}/catalog/products`, { params });
  }

  marketplaceBusinesses(search = ''): Observable<Business[]> {
    let params = new HttpParams();
    if (search.trim()) {
      params = params.set('search', search.trim());
    }
    return this.http.get<Business[]>(`${this.baseUrl}/marketplace/businesses`, { params });
  }

  marketplaceBusiness(slug: string): Observable<Business> {
    return this.http.get<Business>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}`);
  }

  packages(starts_at?: string, ends_at?: string, business_id?: number | null): Observable<RentalPackage[]> {
    let params = new HttpParams();
    if (business_id !== undefined && business_id !== null) {
      params = params.set('business_id', business_id);
    }
    if (starts_at && ends_at) {
      params = params.set('starts_at', starts_at).set('ends_at', ends_at);
    }
    return this.http.get<RentalPackage[]>(`${this.baseUrl}/catalog/packages`, { params });
  }

  qualityTiers(business_id?: number | null): Observable<QualityTier[]> {
    let params = new HttpParams();
    if (business_id !== undefined && business_id !== null) {
      params = params.set('business_id', business_id);
    }
    return this.http.get<QualityTier[]>(`${this.baseUrl}/catalog/quality-tiers`, { params });
  }

  categories(business_id: number): Observable<{ id: number; name: string }[]> {
    return this.http.get<{ id: number; name: string }[]>(`${this.baseUrl}/catalog/categories`, {
      params: new HttpParams().set('business_id', business_id),
    });
  }

  quote(draft: OrderDraft): Observable<{ total_cents: number; is_estimate: boolean }> {
    return this.http.post<{ total_cents: number; is_estimate: boolean }>(`${this.baseUrl}/orders/quote`, draft, {
      headers: this.headers(),
    });
  }

  createOrder(draft: OrderDraft): Observable<RentalOrder> {
    return this.http.post<RentalOrder>(`${this.baseUrl}/orders`, draft, { headers: this.headers() });
  }

  orders(): Observable<RentalOrder[]> {
    return this.http.get<RentalOrder[]>(`${this.baseUrl}/orders`, { headers: this.headers() });
  }

  orderRequest(
    orderId: number,
    request: {
      kind: 'modification' | 'cancellation';
      reason: string;
      starts_at?: string;
      ends_at?: string;
      lines?: OrderLineInput[];
    },
  ): Observable<{ id: number; status: string }> {
    return this.http.post<{ id: number; status: string }>(`${this.baseUrl}/orders/${orderId}/requests`, request, {
      headers: this.headers(),
    });
  }

  submitPayment(
    orderId: number,
    payment: {
      amount_cents: number;
      method: PaymentEntry['method'];
      paid_at: string;
      reference_number: string | null;
      notes: string | null;
    },
  ): Observable<{ id: number; status: PaymentEntry['status']; message: string }> {
    return this.http.post<{ id: number; status: PaymentEntry['status']; message: string }>(
      `${this.baseUrl}/orders/${orderId}/payments`,
      payment,
      { headers: this.headers() },
    );
  }

  uploadPaymentProof(
    orderId: number,
    paymentId: number,
    image: File,
  ): Observable<{ id: number; proof_available: boolean }> {
    return this.http.put<{ id: number; proof_available: boolean }>(
      `${this.baseUrl}/orders/${orderId}/payments/${paymentId}/proof`,
      image,
      { headers: this.headers() },
    );
  }

  paymentProof(orderId: number, paymentId: number): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/orders/${orderId}/payments/${paymentId}/proof`, {
      headers: this.headers(),
      responseType: 'blob',
    });
  }

  adminProducts(): Observable<Product[]> {
    return this.http.get<Product[]>(`${this.baseUrl}/admin/products`, { headers: this.headers() });
  }

  saveProduct(product: ProductInput, id?: number): Observable<Product> {
    const url = id ? `${this.baseUrl}/admin/products/${id}` : `${this.baseUrl}/admin/products`;
    const request = id
      ? this.http.put<Product>(url, product, { headers: this.headers() })
      : this.http.post<Product>(url, product, { headers: this.headers() });
    return request;
  }

  setProductPrice(id: number, price_cents: number): Observable<Product> {
    return this.http.patch<Product>(
      `${this.baseUrl}/admin/products/${id}/price`,
      { price_cents },
      { headers: this.headers() },
    );
  }

  setProductStock(id: number, quantity: number): Observable<Product> {
    return this.http.patch<Product>(
      `${this.baseUrl}/admin/products/${id}/stock`,
      { quantity },
      { headers: this.headers() },
    );
  }

  uploadProductImage(id: number, image: File): Observable<{ id: number; image_url: string }> {
    return this.http.put<{ id: number; image_url: string }>(`${this.baseUrl}/admin/products/${id}/image`, image, {
      headers: this.headers(),
    });
  }

  adminTiers(): Observable<QualityTier[]> {
    return this.http.get<QualityTier[]>(`${this.baseUrl}/admin/quality-tiers`, { headers: this.headers() });
  }

  saveTier(tier: { name: string; is_active: boolean }, id?: number): Observable<QualityTier> {
    const url = id ? `${this.baseUrl}/admin/quality-tiers/${id}` : `${this.baseUrl}/admin/quality-tiers`;
    return id
      ? this.http.put<QualityTier>(url, tier, { headers: this.headers() })
      : this.http.post<QualityTier>(url, tier, { headers: this.headers() });
  }

  inventory(): Observable<InventoryAsset[]> {
    return this.http.get<InventoryAsset[]>(`${this.baseUrl}/admin/inventory`, { headers: this.headers() });
  }

  addAsset(asset: {
    product_id: number;
    asset_tag: string;
    condition: InventoryAsset['condition'];
  }): Observable<unknown> {
    return this.http.post(`${this.baseUrl}/admin/inventory`, asset, { headers: this.headers() });
  }

  updateAsset(id: number, condition: InventoryAsset['condition']): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/admin/inventory/${id}`, { condition }, { headers: this.headers() });
  }

  adminPackages(): Observable<RentalPackage[]> {
    return this.http.get<RentalPackage[]>(`${this.baseUrl}/admin/packages`, { headers: this.headers() });
  }

  savePackage(rentalPackage: PackageInput, id?: number): Observable<RentalPackage> {
    const url = id ? `${this.baseUrl}/admin/packages/${id}` : `${this.baseUrl}/admin/packages`;
    return id
      ? this.http.put<RentalPackage>(url, rentalPackage, { headers: this.headers() })
      : this.http.post<RentalPackage>(url, rentalPackage, { headers: this.headers() });
  }

  uploadPackageImage(id: number, image: File): Observable<{ id: number; image_url: string }> {
    return this.http.put<{ id: number; image_url: string }>(`${this.baseUrl}/admin/packages/${id}/image`, image, {
      headers: this.headers(),
    });
  }

  adminOrders(): Observable<RentalOrder[]> {
    return this.http.get<RentalOrder[]>(`${this.baseUrl}/admin/orders`, { headers: this.headers() });
  }

  setOrderStatus(orderId: number, status: RentalOrder['status'], note: string | null): Observable<RentalOrder> {
    return this.http.patch<RentalOrder>(
      `${this.baseUrl}/admin/orders/${orderId}/status`,
      { status, note },
      { headers: this.headers() },
    );
  }

  adminRequests(): Observable<OrderRequestReview[]> {
    return this.http.get<OrderRequestReview[]>(`${this.baseUrl}/admin/requests`, { headers: this.headers() });
  }

  decideRequest(orderId: number, requestId: number, approved: boolean, note: string | null): Observable<RentalOrder> {
    return this.http.post<RentalOrder>(
      `${this.baseUrl}/admin/orders/${orderId}/requests/${requestId}/decision`,
      { approved, note },
      { headers: this.headers() },
    );
  }

  recordManualPayment(
    orderId: number,
    payment: {
      kind: 'payment' | 'refund';
      amount_cents: number;
      method: PaymentEntry['method'];
      paid_at: string;
      reference_number: string | null;
      notes: string | null;
    },
  ): Observable<PaymentEntry> {
    return this.http.post<PaymentEntry>(`${this.baseUrl}/admin/orders/${orderId}/payments`, payment, {
      headers: this.headers(),
    });
  }

  decidePayment(orderId: number, paymentId: number, approved: boolean, note: string | null): Observable<PaymentEntry> {
    return this.http.post<PaymentEntry>(
      `${this.baseUrl}/admin/orders/${orderId}/payments/${paymentId}/decision`,
      { approved, note },
      { headers: this.headers() },
    );
  }

  customers(): Observable<Customer[]> {
    return this.http.get<Customer[]>(`${this.baseUrl}/admin/customers`, { headers: this.headers() });
  }

  setCustomerActive(id: number, is_active: boolean): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/admin/customers/${id}/active`, { is_active }, { headers: this.headers() });
  }

  report(): Observable<ReportSummary> {
    return this.http.get<ReportSummary>(`${this.baseUrl}/admin/reports/summary`, { headers: this.headers() });
  }

  businessSettings(): Observable<Business> {
    return this.http.get<Business>(`${this.baseUrl}/admin/business`, { headers: this.headers() });
  }

  updateBusinessSettings(
    input: Omit<
      Business,
      | 'id'
      | 'slug'
      | 'logo_url'
      | 'banner_url'
      | 'is_listed'
      | 'status'
      | 'subscription_plan'
      | 'subscription_status'
      | 'subscription_ends_at'
      | 'created_at'
    >,
  ): Observable<Business> {
    return this.http.put<Business>(`${this.baseUrl}/admin/business`, input, { headers: this.headers() });
  }

  uploadBusinessImage(kind: 'logo' | 'banner', image: File): Observable<Business> {
    return this.http.put<Business>(`${this.baseUrl}/admin/business/${kind}`, image, { headers: this.headers() });
  }

  adminCategories(): Observable<BusinessCategory[]> {
    return this.http.get<BusinessCategory[]>(`${this.baseUrl}/admin/categories`, { headers: this.headers() });
  }

  saveCategory(category: { name: string; is_active: boolean }, id?: number): Observable<BusinessCategory> {
    const url = id ? `${this.baseUrl}/admin/categories/${id}` : `${this.baseUrl}/admin/categories`;
    return id
      ? this.http.put<BusinessCategory>(url, category, { headers: this.headers() })
      : this.http.post<BusinessCategory>(url, category, { headers: this.headers() });
  }

  businessStaff(): Observable<BusinessStaff[]> {
    return this.http.get<BusinessStaff[]>(`${this.baseUrl}/admin/staff`, { headers: this.headers() });
  }

  createBusinessStaff(input: {
    email: string;
    display_name: string;
    phone: string | null;
    password: string;
  }): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/admin/staff`, input, { headers: this.headers() });
  }

  setBusinessStaffActive(id: number, is_active: boolean): Observable<{ id: number; is_active: boolean }> {
    return this.http.patch<{ id: number; is_active: boolean }>(
      `${this.baseUrl}/admin/staff/${id}/active`,
      { is_active },
      { headers: this.headers() },
    );
  }

  platformSummary(): Observable<PlatformSummary> {
    return this.http.get<PlatformSummary>(`${this.baseUrl}/platform/summary`, { headers: this.headers() });
  }

  platformBusinesses(status?: string): Observable<Business[]> {
    let params = new HttpParams();
    if (status) {
      params = params.set('status', status);
    }
    return this.http.get<Business[]>(`${this.baseUrl}/platform/businesses`, {
      params,
      headers: this.headers(),
    });
  }

  platformAuditLogs(limit = 100): Observable<PlatformAuditLog[]> {
    return this.http.get<PlatformAuditLog[]>(`${this.baseUrl}/platform/audit-logs`, {
      params: new HttpParams().set('limit', limit),
      headers: this.headers(),
    });
  }

  setBusinessStatus(
    id: number,
    status: 'active' | 'suspended' | 'rejected',
    note: string | null,
  ): Observable<Business> {
    return this.http.patch<Business>(
      `${this.baseUrl}/platform/businesses/${id}/status`,
      { status, note },
      { headers: this.headers() },
    );
  }

  setBusinessListing(id: number, is_listed: boolean): Observable<{ id: number; is_listed: boolean }> {
    return this.http.patch<{ id: number; is_listed: boolean }>(
      `${this.baseUrl}/platform/businesses/${id}/listing`,
      { is_active: is_listed },
      { headers: this.headers() },
    );
  }

  updateBusinessSubscription(
    id: number,
    input: {
      subscription_plan: string;
      subscription_status: Business['subscription_status'];
      subscription_ends_at: string | null;
    },
  ): Observable<unknown> {
    return this.http.patch(`${this.baseUrl}/platform/businesses/${id}/subscription`, input, {
      headers: this.headers(),
    });
  }

  createBusinessAdmin(
    id: number,
    input: { email: string; display_name: string; phone: string | null; password: string },
  ): Observable<User> {
    return this.http.post<User>(`${this.baseUrl}/platform/businesses/${id}/admin`, input, {
      headers: this.headers(),
    });
  }

  platformSettings(): Observable<Record<string, string>> {
    return this.http.get<Record<string, string>>(`${this.baseUrl}/platform/settings`, { headers: this.headers() });
  }

  updatePlatformSetting(key: string, value: string): Observable<{ key: string; value: string }> {
    return this.http.put<{ key: string; value: string }>(
      `${this.baseUrl}/platform/settings/${encodeURIComponent(key)}`,
      { value },
      { headers: this.headers() },
    );
  }
}
