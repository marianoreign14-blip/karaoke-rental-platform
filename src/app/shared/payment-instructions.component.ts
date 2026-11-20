import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

import { IconComponent } from './icon.component';

@Component({
  selector: 'app-payment-instructions',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .guide-box {
        display: grid;
        gap: 6px;
        padding: 13px 15px;
        border: 1px solid var(--accent-border);
        border-radius: var(--radius-md);
        background: var(--accent-soft);
        color: var(--text-primary);
        font-size: 13px;
        line-height: 1.5;
      }

      .guide-head {
        display: flex;
        align-items: center;
        gap: 7px;
        color: var(--accent);
        font-weight: 700;
      }

      p {
        margin: 0;
        color: var(--text-secondary);
      }

      strong {
        color: var(--text-primary);
      }
    `,
  ],
  template: `
    <div class="guide-box" role="note">
      <div class="guide-head">
        <app-icon name="credit-card" [size]="15"></app-icon>
        <span>How to pay with {{ methodLabel }}</span>
      </div>
      @switch (method) {
        @case ('cash') {
          <p>
            Pay <strong>{{ businessName || 'the rental business' }}</strong> in cash upon delivery, pickup, or meetup.
            Record the amount and date paid below so the business can mark your payment verified.
          </p>
        }
        @case ('gcash') {
          <p>
            Send your GCash payment directly to <strong>{{ businessName || 'the rental business' }}</strong>, enter the
            GCash reference number below, and upload a clear screenshot of your receipt for faster verification.
          </p>
        }
        @case ('bank_transfer') {
          <p>
            Complete your transfer to <strong>{{ businessName || 'the rental business' }}</strong>'s bank account, enter
            the transfer reference number below, and attach your transfer confirmation screenshot.
          </p>
        }
      }
      <p>Your balance updates automatically once the business verifies your submission.</p>
    </div>
  `,
})
export class PaymentInstructionsComponent {
  @Input() method: 'cash' | 'gcash' | 'bank_transfer' = 'cash';
  @Input() businessName = '';

  get methodLabel(): string {
    if (this.method === 'gcash') {
      return 'GCash';
    }
    if (this.method === 'bank_transfer') {
      return 'Bank Transfer';
    }
    return 'Cash';
  }
}
