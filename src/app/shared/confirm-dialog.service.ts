import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  inputLabel?: string;
  inputPlaceholder?: string;
  inputRequired?: boolean;
}

export interface ConfirmDialogResult {
  confirmed: boolean;
  note: string;
}

interface ActiveDialog {
  options: Required<Pick<ConfirmDialogOptions, 'title' | 'message' | 'confirmLabel' | 'cancelLabel' | 'tone'>> &
    Pick<ConfirmDialogOptions, 'inputLabel' | 'inputPlaceholder' | 'inputRequired'>;
  resolve: (result: ConfirmDialogResult) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  private readonly activeSignal = signal<ActiveDialog | null>(null);
  readonly active = this.activeSignal.asReadonly();

  open(options: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
    const previous = this.activeSignal();
    if (previous) {
      previous.resolve({ confirmed: false, note: '' });
    }
    return new Promise<ConfirmDialogResult>((resolve) => {
      this.activeSignal.set({
        options: {
          title: options.title,
          message: options.message,
          confirmLabel: options.confirmLabel || 'Confirm',
          cancelLabel: options.cancelLabel || 'Cancel',
          tone: options.tone || 'primary',
          inputLabel: options.inputLabel,
          inputPlaceholder: options.inputPlaceholder,
          inputRequired: options.inputRequired,
        },
        resolve,
      });
    });
  }

  finish(confirmed: boolean, note = ''): void {
    const current = this.activeSignal();
    if (!current) {
      return;
    }
    this.activeSignal.set(null);
    current.resolve({ confirmed, note: note.trim() });
  }
}
