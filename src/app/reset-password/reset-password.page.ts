import { CommonModule } from '@angular/common';
import type { OnInit } from '@angular/core';
import { ChangeDetectorRef, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IonContent, IonHeader } from '@ionic/angular';
import { firstValueFrom } from 'rxjs';

import { ApiService, extractApiError } from '../core/api.service';

@Component({
  selector: 'app-reset-password',
  templateUrl: './reset-password.page.html',
  styleUrls: ['./reset-password.page.scss'],
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, IonContent, IonHeader],
})
export class ResetPasswordPage implements OnInit {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly changeDetector = inject(ChangeDetectorRef);

  token = '';
  newPassword = '';
  confirmPassword = '';
  showPassword = false;
  saving = false;
  completed = false;
  error = '';
  notice = '';

  ngOnInit(): void {
    const queryToken = this.route.snapshot.queryParamMap.get('token');
    if (queryToken) {
      this.token = queryToken.trim();
    }
  }

  async submit(): Promise<void> {
    this.error = '';
    this.notice = '';
    const token = this.token.trim();
    if (token.length < 16) {
      this.error = 'Enter a valid password reset token.';
      return;
    }
    if (this.newPassword.length < 12) {
      this.error = 'New password must be at least 12 characters.';
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error = 'Password confirmation does not match.';
      return;
    }
    this.saving = true;
    try {
      const response = await firstValueFrom(this.api.resetPassword(token, this.newPassword));
      this.notice = response.message;
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
