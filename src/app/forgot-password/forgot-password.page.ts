import { CommonModule } from '@angular/common';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';

@Component({
  selector: 'app-forgot-password',
  templateUrl: './forgot-password.page.html',
  styleUrls: ['./forgot-password.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonHeader],
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiService);
  private readonly changeDetector = inject(ChangeDetectorRef);

  email = '';
  saving = false;
  error = '';
  notice = '';
  emailDeliveryConfigured: boolean | null = null;

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    const trimmed = this.email.trim();
    if (!trimmed) {
      this.error = 'Enter the email address associated with your account.';
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.forgotPassword(trimmed));
      this.emailDeliveryConfigured = response.email_delivery_configured;
      this.notice = response.message;
    } catch (error) {
      this.error = extractApiError(error, 'Could not process the password reset request.');
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }
}
