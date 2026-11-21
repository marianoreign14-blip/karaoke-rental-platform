import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { IconComponent } from './icon.component';

interface StepItem {
  label: string;
  done: boolean;
  current: boolean;
}

@Component({
  selector: 'app-order-progress',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: block;
      }

      .progress-box {
        margin-top: 14px;
        padding: 14px 16px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--bg-canvas);
      }

      .steps {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }

      .step {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        color: var(--text-muted);
        font-size: 12px;
        font-weight: 500;
      }

      .step-circle {
        display: grid;
        place-items: center;
        width: 24px;
        height: 24px;
        border: 1.5px solid var(--border-strong);
        border-radius: 9999px;
        background: var(--bg-surface);
        color: var(--text-secondary);
        font-size: 11px;
        font-weight: 700;
        flex-shrink: 0;
      }

      .step.done {
        color: var(--text-primary);

        .step-circle {
          border-color: var(--success);
          background: var(--success);
          color: #ffffff;
        }
      }

      .step.current {
        color: var(--accent);
        font-weight: 600;

        .step-circle {
          border-color: var(--accent);
          background: var(--accent-soft);
          color: var(--accent);
        }
      }

      .summary-note {
        margin: 10px 0 0;
        color: var(--text-secondary);
        font-size: 12.5px;
        line-height: 1.45;
      }

      .closed-banner {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        margin-top: 14px;
        padding: 12px 14px;
        border: 1px solid var(--danger-border);
        border-radius: var(--radius-md);
        background: var(--danger-soft);
        color: var(--danger-text);
        font-size: 13px;
        line-height: 1.45;
      }

      @media (max-width: 680px) {
        .steps {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    `,
  ],
  template: `
    @if (status === 'cancelled' || status === 'rejected') {
      <div class="closed-banner" role="status">
        <app-icon name="x" [size]="16"></app-icon>
        <span>
          @if (status === 'cancelled') {
            This booking was cancelled and any held equipment has been released.
          } @else {
            This rental request was declined by the business and no equipment is held.
          }
        </span>
      </div>
    } @else {
      <div class="progress-box" aria-label="Booking progress">
        <div class="steps">
          @for (step of steps; track step.label; let idx = $index) {
            <div class="step" [class.done]="step.done" [class.current]="step.current">
              <span class="step-circle" aria-hidden="true">
                @if (step.done) {
                  <app-icon name="check" [size]="13"></app-icon>
                } @else {
                  {{ idx + 1 }}
                }
              </span>
              <span>{{ step.label }}</span>
            </div>
          }
        </div>
        <p class="summary-note">{{ helperMessage }}</p>
      </div>
    }
  `,
})
export class OrderProgressComponent {
  @Input() status = 'pending_admin';
  @Input() paymentStatus = 'unpaid';

  get steps(): StepItem[] {
    const isConfirmed = this.status === 'confirmed' || this.status === 'ongoing' || this.status === 'completed';
    const isPaid = this.paymentStatus === 'paid';
    const isCompleted = this.status === 'completed';

    return [
      { label: 'Request sent', done: true, current: false },
      {
        label: 'Business confirmed',
        done: isConfirmed,
        current: this.status === 'pending_admin' || this.status === 'under_review',
      },
      { label: 'Payment verified', done: isPaid, current: isConfirmed && !isPaid },
      { label: 'Completed', done: isCompleted, current: isConfirmed && isPaid && !isCompleted },
    ];
  }

  get helperMessage(): string {
    if (this.status === 'pending_admin') {
      return 'Waiting for the rental business to review and confirm your booking. You can still submit payment details or request changes.';
    }
    if (this.status === 'under_review') {
      return 'The business requested more information before accepting this rental. Review the request details and contact the business if needed.';
    }
    if (this.status === 'ongoing') {
      return 'Your rental is in progress. Contact the business if you need help during the event.';
    }
    if (this.status === 'confirmed' && this.paymentStatus === 'awaiting_verification') {
      return 'Your booking is confirmed. The business is reviewing your submitted payment proof.';
    }
    if (this.status === 'confirmed' && this.paymentStatus !== 'paid') {
      return 'Your booking is confirmed and equipment is reserved. Submit your payment details below to settle the remaining balance.';
    }
    if (this.status === 'confirmed') {
      return 'Booking confirmed and paid in full. Coordinate delivery or pickup with the business for your rental dates.';
    }
    if (this.status === 'completed') {
      return 'This rental is complete and equipment has been returned. Keep this page as your receipt.';
    }
    return '';
  }
}
