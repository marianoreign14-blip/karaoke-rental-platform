import { CartService } from './cart.service';

describe('CartService', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('adds items, merges quantities, and enforces single-business checkout', () => {
    const cart = new CartService();
    const first = cart.addItem({
      key: 'product-1',
      kind: 'product',
      business_id: 1,
      business_name: 'Alpha Karaoke',
      item_id: 1,
      name: 'Standard Karaoke',
      quantity: 2,
      price_cents: 100000,
      pricing_configured: true,
    });
    expect(first).toEqual({ ok: true });
    expect(cart.count()).toBe(2);

    const merged = cart.addItem({
      key: 'product-1',
      kind: 'product',
      business_id: 1,
      item_id: 1,
      name: 'Standard Karaoke',
      quantity: 1,
      price_cents: 100000,
      pricing_configured: true,
    });
    expect(merged).toEqual({ ok: true });
    expect(cart.count()).toBe(3);

    const conflict = cart.addItem({
      key: 'product-2',
      kind: 'product',
      business_id: 2,
      item_id: 2,
      name: 'Other Business Unit',
      quantity: 1,
      price_cents: 90000,
      pricing_configured: true,
    });
    expect(conflict.ok).toBe(false);
    expect(cart.items()).toHaveLength(1);
  });

  it('persists items and rental window across service instances', () => {
    const cart1 = new CartService();
    cart1.setWindow('2026-12-01T10:00', '2026-12-02T10:00');
    cart1.addItem({
      key: 'package-5',
      kind: 'package',
      business_id: 3,
      item_id: 5,
      name: 'Party Bundle',
      quantity: 1,
      price_cents: 250000,
      pricing_configured: true,
    });

    const cart2 = new CartService();
    expect(cart2.startsInput()).toBe('2026-12-01T10:00');
    expect(cart2.endsInput()).toBe('2026-12-02T10:00');
    expect(cart2.count()).toBe(1);

    cart2.setQuantity('package-5', 0);
    expect(cart2.items()).toHaveLength(0);
  });

  it('ignores malformed entries stored in sessionStorage', () => {
    sessionStorage.setItem(
      'karaokewebapp.rental-cart',
      JSON.stringify({
        items: [
          { key: 'bad', kind: 'invalid', business_id: -1, item_id: 0, quantity: 0 },
          {
            key: 'product-9',
            kind: 'product',
            business_id: 2,
            item_id: 9,
            name: 'Valid Mic',
            quantity: 2,
            price_cents: 5000,
            pricing_configured: true,
          },
        ],
      }),
    );
    const cart = new CartService();
    expect(cart.items()).toHaveLength(1);
    expect(cart.items()[0].key).toBe('product-9');
  });
});
