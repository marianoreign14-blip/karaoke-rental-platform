import { Injectable, signal } from '@angular/core';

export type ToastTone = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: number;
  tone: ToastTone;
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  private nextId = 1;
  private readonly itemsSignal = signal<ToastMessage[]>([]);
  readonly items = this.itemsSignal.asReadonly();

  show(text: string, tone: ToastTone = 'info', durationMs = 4500): void {
    const trimmed = text.trim();
    if (!trimmed) {
      return;
    }
    const id = this.nextId++;
    this.itemsSignal.update((current) => [...current.slice(-2), { id, tone, text: trimmed }]);
    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }
  }

  success(text: string): void {
    this.show(text, 'success', 4000);
  }

  error(text: string): void {
    this.show(text, 'error', 6000);
  }

  warning(text: string): void {
    this.show(text, 'warning', 5000);
  }

  dismiss(id: number): void {
    this.itemsSignal.update((current) => current.filter((item) => item.id !== id));
  }
}
