import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { IconComponent } from './icon.component';
import { ToastService } from './toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .toast-stack {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 1000;
        display: grid;
        gap: 10px;
        width: min(380px, calc(100vw - 32px));
        pointer-events: none;
      }

      .toast-card {
        pointer-events: auto;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        padding: 13px 15px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--bg-surface);
        color: var(--text-primary);
        box-shadow: var(--shadow-lg);
        font-size: 13.5px;
        font-weight: 500;
        line-height: 1.45;
        animation: saas-fade-in var(--transition-fast);
      }

      .toast-body {
        display: flex;
        align-items: flex-start;
        gap: 10px;
      }

      .toast-dot {
        width: 8px;
        height: 8px;
        margin-top: 6px;
        border-radius: 9999px;
        flex-shrink: 0;
        background: var(--accent);
      }

      .toast-success {
        border-color: var(--success-border);
        background: var(--success-soft);
        color: var(--success-text);

        .toast-dot {
          background: var(--success);
        }
      }

      .toast-error {
        border-color: var(--danger-border);
        background: var(--danger-soft);
        color: var(--danger-text);

        .toast-dot {
          background: var(--danger);
        }
      }

      .toast-warning {
        border-color: var(--warning-border);
        background: var(--warning-soft);
        color: var(--warning-text);

        .toast-dot {
          background: var(--warning);
        }
      }

      .toast-close {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        border-radius: var(--radius-sm);
        background: transparent;
        color: currentColor;
        opacity: 0.7;
        cursor: pointer;
        flex-shrink: 0;

        &:hover {
          opacity: 1;
          background: rgba(15, 23, 42, 0.06);
        }
      }

      @media (max-width: 600px) {
        .toast-stack {
          right: 12px;
          left: 12px;
          bottom: 14px;
          width: auto;
        }
      }
    `,
  ],
  template: `
    <div class="toast-stack" aria-live="polite" aria-atomic="false">
      @for (toast of toasts(); track toast.id) {
        <div class="toast-card" [class]="'toast-card toast-' + toast.tone" role="status">
          <div class="toast-body">
            <span class="toast-dot" aria-hidden="true"></span>
            <span>{{ toast.text }}</span>
          </div>
          <button
            type="button"
            class="toast-close"
            aria-label="Dismiss notification"
            (click)="toastService.dismiss(toast.id)"
          >
            <app-icon name="x" [size]="15"></app-icon>
          </button>
        </div>
      }
    </div>
  `,
})
export class ToastHostComponent {
  readonly toastService = inject(ToastService);
  readonly toasts = this.toastService.items;
}
