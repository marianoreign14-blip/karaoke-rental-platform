import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import type { OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';
import type { Business, PlatformAuditLog, PlatformSummary } from '../core/api.service';

@Component({
  selector: 'app-platform',
  templateUrl: './platform.page.html',
  styleUrls: ['./platform.page.scss'],
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, RouterLink],
})
export class PlatformPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  summary: PlatformSummary | null = null;
  businesses: Business[] = [];
  activity: PlatformAuditLog[] = [];
  settings: Record<string, string> = {};
  search = '';
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

  ngOnInit(): void {
    this.refresh();
  }

  get filteredBusinesses(): Business[] {
    const term = this.search.trim().toLowerCase();
    return this.businesses.filter((business) =>
      [business.name, business.slug, business.owner_name || '', business.owner_email || '']
        .join(' ')
        .toLowerCase()
        .includes(term),
    );
  }

  async refresh(): Promise<void> {
    this.loading = true;
    this.error = '';
    try {
      const [summary, businesses, settings, activity] = await Promise.all([
        firstValueFrom(this.api.platformSummary()),
        firstValueFrom(this.api.platformBusinesses()),
        firstValueFrom(this.api.platformSettings()),
        firstValueFrom(this.api.platformAuditLogs(50)),
      ]);
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
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.loading = false;
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
    this.saving = true;
    this.error = '';
    this.notice = '';
    try {
      const endsAt = this.subscriptionEndsAt ? new Date(this.subscriptionEndsAt).toISOString() : null;
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
      await firstValueFrom(this.api.updatePlatformSetting(key, this.settings[key] || ''));
      this.notice = 'Platform setting saved.';
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

  private localDateTime(date: Date): string {
    const adjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return adjusted.toISOString().slice(0, 16);
  }

  private errorMessage(error: unknown): string {
    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'The requested platform change could not be completed.';
  }
}
