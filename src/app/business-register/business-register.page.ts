import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';

@Component({
  selector: 'app-business-register',
  templateUrl: './business-register.page.html',
  styleUrls: ['./business-register.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonHeader],
})
export class BusinessRegisterPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

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

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    const businessName = this.businessName.trim();
    const ownerName = this.ownerName.trim();
    const email = this.email.trim();
    const contactNumber = this.contactNumber.trim();
    const address = this.address.trim();

    if (businessName.length < 2) {
      this.error = 'Business name must be at least 2 characters.';
      return;
    }
    if (!ownerName) {
      this.error = 'Owner name is required.';
      return;
    }
    if (!email) {
      this.error = 'A valid email address is required.';
      return;
    }
    if (contactNumber.length < 7) {
      this.error = 'Contact number must be at least 7 characters.';
      return;
    }
    if (address.length < 5) {
      this.error = 'Business address must be at least 5 characters.';
      return;
    }
    if (this.password.length < 12) {
      this.error = 'Password must be at least 12 characters.';
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
