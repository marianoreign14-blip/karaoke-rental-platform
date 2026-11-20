import { ChangeDetectionStrategy, Component, Input } from '@angular/core';

export type BadgeTone = 'success' | 'warning' | 'danger' | 'accent' | 'neutral';

@Component({
  selector: 'app-status-badge',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-pill);
        background: var(--bg-subtle);
        color: var(--text-secondary);
        font-size: 11.5px;
        font-weight: 600;
        line-height: 1.25;
        text-transform: capitalize;
        white-space: nowrap;
      }

      .dot {
        width: 6px;
        height: 6px;
        border-radius: 9999px;
        background: currentColor;
        flex-shrink: 0;
      }

      .tone-success {
        border-color: var(--success-border);
        background: var(--success-soft);
        color: var(--success-text);
      }

      .tone-warning {
        border-color: var(--warning-border);
        background: var(--warning-soft);
        color: var(--warning-text);
      }

      .tone-danger {
        border-color: var(--danger-border);
        background: var(--danger-soft);
        color: var(--danger-text);
      }

      .tone-accent {
        border-color: var(--accent-border);
        background: var(--accent-soft);
        color: var(--accent);
      }

      .tone-neutral {
        border-color: var(--border);
        background: var(--bg-subtle);
        color: var(--text-secondary);
      }
    `,
  ],
  template: `
    <span class="pill" [class]="'pill tone-' + resolvedTone">
      @if (showDot) {
        <span class="dot" aria-hidden="true"></span>
      }
      {{ resolvedLabel }}
    </span>
  `,
})
export class StatusBadgeComponent {
  @Input() value = '';
  @Input() label = '';
  @Input() tone?: BadgeTone;
  @Input() showDot = true;

  get resolvedLabel(): string {
    return this.label || this.value.replaceAll('_', ' ');
  }

  get resolvedTone(): BadgeTone {
    if (this.tone) {
      return this.tone;
    }
    const normalized = this.value.trim().toLowerCase();
    if (
      ['active', 'approved', 'available', 'completed', 'confirmed', 'listed', 'paid', 'verified'].includes(normalized)
    ) {
      return 'success';
    }
    if (
      [
        'awaiting_verification',
        'partially_paid',
        'pending',
        'pending_admin',
        'submitted',
        'trialing',
        'under_maintenance',
      ].includes(normalized)
    ) {
      return 'warning';
    }
    if (
      [
        'cancelled',
        'damaged',
        'disabled',
        'inactive',
        'past_due',
        'rejected',
        'suspended',
        'unavailable',
        'unpaid',
      ].includes(normalized)
    ) {
      return 'danger';
    }
    if (['business_admin', 'modification', 'package', 'platform_admin'].includes(normalized)) {
      return 'accent';
    }
    return 'neutral';
  }
}
