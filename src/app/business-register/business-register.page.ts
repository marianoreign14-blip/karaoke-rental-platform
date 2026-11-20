import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ResponsiveMenuComponent } from '../shared/responsive-menu.component';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-business-register',
  templateUrl: './business-register.page.html',
  styleUrls: ['./business-register.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonHeader, BrandMarkComponent, ResponsiveMenuComponent],
})
export class BusinessRegisterPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);

  businessName = '';
  ownerName = '';
  email = '';
  contactNumber = '';
  address = '';
  password = '';
  showPassword = false;
  saving = false;
  error = '';
  notice = '';
  fieldErrors: Record<string, string> = {};

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.fieldErrors = {};
    const businessName = this.businessName.trim();
    const ownerName = this.ownerName.trim();
    const email = this.email.trim();
    const contactNumber = this.contactNumber.trim();
    const address = this.address.trim();

    if (businessName.length < 2) {
      this.fieldErrors['businessName'] = 'Business name must be at least 2 characters.';
    }
    if (!ownerName) {
      this.fieldErrors['ownerName'] = 'Owner full name is required.';
    }
    if (!email || !email.includes('@')) {
      this.fieldErrors['email'] = 'Enter a valid email address.';
    }
    if (contactNumber.length < 7) {
      this.fieldErrors['contactNumber'] = 'Contact number must be at least 7 digits/characters.';
    }
    if (address.length < 5) {
      this.fieldErrors['address'] = 'Enter a complete street or city address (at least 5 characters).';
    }
    if (this.password.length < 12) {
      this.fieldErrors['password'] = 'Password must be at least 12 characters.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = 'Please fix the highlighted fields before submitting.';
      return;
    }

    this.saving = true;
    try {
      const result = await firstValueFrom(
        this.api.registerBusiness({
          business_name: businessName,
          owner_name: ownerName,
          email,
          contact_number: contactNumber,
          address,
          password: this.password,
        }),
      );
      this.notice = result.message;
      this.toast.success('Business application submitted for review.');
      this.businessName = '';
      this.ownerName = '';
      this.email = '';
      this.contactNumber = '';
      this.address = '';
      this.password = '';
      this.showPassword = false;
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  private errorMessage(error: unknown): string {
    return extractApiError(error, 'We could not submit your registration. Please try again.');
  }
}
