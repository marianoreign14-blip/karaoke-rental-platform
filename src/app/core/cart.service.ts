import { Injectable, computed, signal } from '@angular/core';

export type CartEntry = {
  key: string;
  kind: 'product' | 'package';
  business_id: number;
  business_name?: string;
  item_id: number;
  name: string;
  quantity: number;
  price_cents: number | null;
  pricing_configured: boolean;
};

type StoredCartState = {
  items: CartEntry[];
  startsInput: string;
  endsInput: string;
};

@Injectable({ providedIn: 'root' })
export class CartService {
  private readonly storageKey = 'karaokewebapp.rental-cart';
  private readonly itemsState = signal<CartEntry[]>([]);
  private readonly startsState = signal<string>('');
  private readonly endsState = signal<string>('');

  readonly items = this.itemsState.asReadonly();
  readonly startsInput = this.startsState.asReadonly();
  readonly endsInput = this.endsState.asReadonly();
  readonly count = computed(() => this.itemsState().reduce((total, item) => total + item.quantity, 0));

  constructor() {
    this.restore();
  }

  addItem(item: CartEntry): { ok: true } | { ok: false; error: string } {
    const current = this.itemsState();
    if (current.some((entry) => entry.business_id !== item.business_id)) {
      return {
        ok: false,
        error: 'Submit one business rental request at a time. Clear your selection before choosing another business.',
      };
    }
    const qty = Math.min(1000, Math.max(1, Math.floor(item.quantity || 1)));
    const existing = current.find((entry) => entry.key === item.key);
    const updated = existing
      ? current.map((entry) =>
          entry.key === item.key ? { ...entry, quantity: Math.min(1000, entry.quantity + qty) } : entry,
        )
      : [...current, { ...item, quantity: qty }];
    this.itemsState.set(updated);
    this.persist();
    return { ok: true };
  }

  setQuantity(key: string, value: string | number | null | undefined): void {
    const quantity = Math.min(1000, Math.max(0, Math.floor(Number(value) || 0)));
    const current = this.itemsState();
    const updated =
      quantity === 0
        ? current.filter((entry) => entry.key !== key)
        : current.map((entry) => (entry.key === key ? { ...entry, quantity } : entry));
    this.itemsState.set(updated);
    this.persist();
  }

  setWindow(startsInput: string, endsInput: string): void {
    this.startsState.set(startsInput);
    this.endsState.set(endsInput);
    this.persist();
  }

  clear(): void {
    this.itemsState.set([]);
    this.persist();
  }

  private persist(): void {
    try {
      const payload: StoredCartState = {
        items: this.itemsState(),
        startsInput: this.startsState(),
        endsInput: this.endsState(),
      };
      sessionStorage.setItem(this.storageKey, JSON.stringify(payload));
    } catch {
      // Ignore storage quota or private-mode failures.
    }
  }

  private restore(): void {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Partial<StoredCartState>;
      if (Array.isArray(parsed.items)) {
        const validItems = parsed.items.filter(
          (entry): entry is CartEntry =>
            Boolean(entry) &&
            typeof entry.key === 'string' &&
            (entry.kind === 'product' || entry.kind === 'package') &&
            Number.isInteger(entry.business_id) &&
            entry.business_id > 0 &&
            Number.isInteger(entry.item_id) &&
            entry.item_id > 0 &&
            typeof entry.name === 'string' &&
            Number.isInteger(entry.quantity) &&
            entry.quantity > 0 &&
            entry.quantity <= 1000 &&
            (entry.price_cents === null || typeof entry.price_cents === 'number') &&
            typeof entry.pricing_configured === 'boolean',
        );
        this.itemsState.set(validItems);
      }
      if (typeof parsed.startsInput === 'string') {
        this.startsState.set(parsed.startsInput);
      }
      if (typeof parsed.endsInput === 'string') {
        this.endsState.set(parsed.endsInput);
      }
    } catch {
      sessionStorage.removeItem(this.storageKey);
    }
  }
}
