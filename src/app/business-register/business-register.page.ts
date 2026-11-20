import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';

import { ApiService } from '../core/api.service';

@Component({
  selector: 'app-business-register',
  templateUrl: './business-register.page.html',
  styleUrls: ['./business-register.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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
  saving = false;
  error = '';
  notice = '';

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.saving = true;
    try {
      const result = await firstValueFrom(
        this.api.registerBusiness({
          business_name: this.businessName.trim(),
          owner_name: this.ownerName.trim(),
          email: this.email.trim(),
          contact_number: this.contactNumber.trim(),
          address: this.address.trim(),
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
    } catch (error) {
      this.error = this.errorMessage(error);
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }

  private errorMessage(error: unknown): string {
    const detail = (error as { error?: { detail?: unknown } })?.error?.detail;
    return typeof detail === 'string' ? detail : 'We could not submit your registration. Please try again.';
  }
}
