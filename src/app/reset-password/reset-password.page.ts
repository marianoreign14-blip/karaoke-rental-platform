import { CommonModule } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';
import { BrandMarkComponent } from '../shared/brand-mark.component';
import { ResponsiveMenuComponent } from '../shared/responsive-menu.component';
import { ToastService } from '../shared/toast.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonHeader, BrandMarkComponent, ResponsiveMenuComponent],
})
export class ResetPasswordPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);
  private readonly toast = inject(ToastService);

  token = '';
  newPassword = '';
  confirmPassword = '';
  showPassword = false;
  saving = false;
  completed = false;
  error = '';
  notice = '';
  fieldErrors: Record<string, string> = {};

  ngOnInit(): void {
    const queryToken = this.route.snapshot.queryParamMap.get('token');
    if (queryToken) {
      this.token = queryToken.trim();
    }
  }

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    this.fieldErrors = {};
    const token = this.token.trim();
    if (token.length < 16) {
      this.fieldErrors['token'] = 'Enter a valid password reset token.';
    }
    if (this.newPassword.length < 12) {
      this.fieldErrors['newPassword'] = 'New password must be at least 12 characters.';
    }
    if (this.newPassword !== this.confirmPassword) {
      this.fieldErrors['confirmPassword'] = 'Password confirmation does not match.';
    }
    if (Object.keys(this.fieldErrors).length > 0) {
      this.error = Object.values(this.fieldErrors)[0];
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.resetPassword(token, this.newPassword));
      this.notice = response.message;
      this.toast.success('Password reset complete. You can now sign in.');
      this.completed = true;
      this.token = '';
      this.newPassword = '';
      this.confirmPassword = '';
    } catch (error) {
      this.error = extractApiError(error, 'Could not reset your password. Verify your token and try again.');
    } finally {
      this.saving = false;
      this.changeDetector.markForCheck();
    }
  }
}
