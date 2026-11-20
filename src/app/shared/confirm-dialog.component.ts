import { ChangeDetectionStrategy, Component, effect, HostListener, inject, ViewChild } from '@angular/core';
import type { ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { ConfirmDialogService } from './confirm-dialog.service';
import { IconComponent } from './icon.component';

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [FormsModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .dialog-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1100;
        display: grid;
        place-items: center;
        padding: 16px;
        animation: saas-fade-in var(--transition-fast);
      }

      .dialog-scrim {
        position: absolute;
        inset: 0;
        border: 0;
        padding: 0;
        background: rgba(15, 23, 42, 0.48);
        backdrop-filter: blur(2px);
        cursor: pointer;
      }

      .dialog-card {
        position: relative;
        z-index: 1;
        width: min(460px, 100%);
        max-height: calc(100vh - 32px);
        overflow-y: auto;
        padding: 22px 24px;
        border: 1px solid var(--border);
        border-radius: var(--radius-xl);
        background: var(--bg-surface);
        box-shadow: var(--shadow-lg);
      }

      .dialog-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;

        h2 {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          color: var(--text-primary);
        }
      }

      .dialog-message {
        margin: 10px 0 0;
        color: var(--text-secondary);
        font-size: 14px;
        line-height: 1.55;
      }

      .dialog-input-wrap {
        display: grid;
        gap: 6px;
        margin-top: 16px;
        color: var(--text-primary);
        font-size: 13px;
        font-weight: 600;

        textarea {
          width: 100%;
          min-height: 76px;
          padding: 9px 12px;
          border: 1px solid var(--border);
          border-radius: var(--radius-md);
          background: var(--bg-surface);
          color: var(--text-primary);
          font: inherit;
          font-size: 13.5px;
          resize: vertical;

          &:focus {
            outline: none;
            border-color: var(--accent);
            box-shadow: var(--focus-ring);
          }
        }
      }

      .dialog-error {
        margin: 8px 0 0;
        color: var(--danger-text);
        font-size: 12.5px;
        font-weight: 600;
      }

      .dialog-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 22px;
      }

      .primary-confirm-btn {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: var(--control-h-sm);
        padding: 0 16px;
        border: 1px solid var(--accent);
        border-radius: var(--radius-md);
        background: var(--accent);
        color: #ffffff;
        font: inherit;
        font-size: 13.5px;
        font-weight: 600;
        cursor: pointer;

        &:hover {
          background: var(--accent-hover);
          border-color: var(--accent-hover);
        }
      }
    `,
  ],
  template: `
    @if (active(); as dialog) {
      <div class="dialog-backdrop">
        <button type="button" class="dialog-scrim" tabindex="-1" aria-label="Close dialog" (click)="cancel()"></button>
        <div
          #dialogCard
          class="dialog-card"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-dialog-title"
          tabindex="-1"
        >
          <div class="dialog-header">
            <h2 id="confirm-dialog-title">{{ dialog.options.title }}</h2>
            <button type="button" class="icon-btn" aria-label="Close dialog" (click)="cancel()">
              <app-icon name="x" [size]="16"></app-icon>
            </button>
          </div>

          <p class="dialog-message">{{ dialog.options.message }}</p>

          @if (dialog.options.inputLabel) {
            <label class="dialog-input-wrap">
              <span>{{ dialog.options.inputLabel }}</span>
              <textarea
                [(ngModel)]="note"
                name="confirmDialogNote"
                [placeholder]="dialog.options.inputPlaceholder || ''"
                maxlength="500"
              ></textarea>
            </label>
          }

          @if (validationError) {
            <p class="dialog-error" role="alert">{{ validationError }}</p>
          }

          <div class="dialog-actions">
            <button type="button" class="secondary-button" (click)="cancel()">
              {{ dialog.options.cancelLabel }}
            </button>
            <button
              type="button"
              [class]="dialog.options.tone === 'danger' ? 'danger-button' : 'primary-confirm-btn'"
              (click)="confirm()"
            >
              {{ dialog.options.confirmLabel }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialogComponent {
  private readonly service = inject(ConfirmDialogService);
  @ViewChild('dialogCard') private dialogCard?: ElementRef<HTMLElement>;
  private previousActiveElement: HTMLElement | null = null;
  readonly active = this.service.active;
  note = '';
  validationError = '';

  constructor() {
    effect(() => {
      if (this.active()) {
        this.note = '';
        this.validationError = '';
        if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
          this.previousActiveElement = document.activeElement;
        }
        setTimeout(() => this.focusInitialControl(), 0);
      } else if (this.previousActiveElement) {
        const target = this.previousActiveElement;
        this.previousActiveElement = null;
        setTimeout(() => {
          if (typeof document !== 'undefined' && document.contains(target)) {
            target.focus();
          }
        }, 0);
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.active()) {
      this.cancel();
    }
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.active()) {
      return;
    }
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null;
    const insideDialog = current ? focusables.includes(current) : false;

    if (event.shiftKey) {
      if (!insideDialog || current === first) {
        event.preventDefault();
        last.focus();
      }
    } else if (!insideDialog || current === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private getFocusableElements(): HTMLElement[] {
    const container = this.dialogCard?.nativeElement;
    if (!container) {
      return [];
    }
    return Array.from(
      container.querySelectorAll<HTMLElement>(
        'textarea:not([disabled]), input:not([disabled]), select:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  private focusInitialControl(): void {
    const container = this.dialogCard?.nativeElement;
    if (!container) {
      return;
    }
    const textarea = container.querySelector<HTMLElement>('textarea:not([disabled])');
    if (textarea) {
      textarea.focus();
      return;
    }
    const confirmBtn = container.querySelector<HTMLElement>('.dialog-actions button:last-child');
    if (confirmBtn) {
      confirmBtn.focus();
      return;
    }
    container.focus();
  }

  cancel(): void {
    this.service.finish(false);
  }

  confirm(): void {
    const current = this.active();
    if (!current) {
      return;
    }
    if (current.options.inputRequired && !this.note.trim()) {
      this.validationError = 'Please enter a brief note before continuing.';
      return;
    }
    this.service.finish(true, this.note);
  }
}
