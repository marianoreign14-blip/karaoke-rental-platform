import { expect, test } from '@playwright/test';

test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Find a karaoke rental business' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make room for a good gathering.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Browse rental equipment' })).toBeVisible();
  const pageBackground = await page.locator('body').evaluate((element) => {
    const styles = getComputedStyle(element);
    return { color: styles.backgroundColor, image: styles.backgroundImage };
  });
  expect(pageBackground).toEqual({ color: 'rgb(255, 255, 255)', image: 'none' });

  const menu = page.locator('.responsive-menu-toggle');
  const marketplaceLink = page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', {
    name: 'Marketplace',
  });
  const expectContentGutters = async () => {
    const gutters = await page.evaluate(() => {
      const main = document.querySelector('main')!.getBoundingClientRect();
      const hero = document.querySelector('.hero-surface')!.getBoundingClientRect();
      const availability = document.querySelector('.rental-window')!.getBoundingClientRect();
      return [
        hero.left - main.left,
        main.right - hero.right,
        availability.left - main.left,
        main.right - availability.right,
      ];
    });
    for (const gutter of gutters) {
      expect(gutter).toBeGreaterThanOrEqual(10);
    }
  };
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeHidden();
    await expect(marketplaceLink).toBeVisible();
    await expectContentGutters();
  }
  for (const width of [768, 412, 375]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(menu).toBeVisible();
    await expect(marketplaceLink).toBeHidden();
    await expectContentGutters();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await expect(menu).toBeVisible();
  await expect(marketplaceLink).toBeHidden();
  await menu.click();
  await expect(marketplaceLink).toBeVisible();
});

test('opens account page and rejects unauthenticated admin access', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  for (const width of [1024, 412, 375]) {
    await page.setViewportSize({ width, height: 768 });
    const alignment = await page.evaluate(() => {
      const main = document.querySelector('main.auth-layout');
      const panel = document.querySelector('.auth-panel');
      if (!main || !panel) {
        return null;
      }
      const mainRect = main.getBoundingClientRect();
      const panelRect = panel.getBoundingClientRect();
      return Math.abs(mainRect.top + mainRect.height / 2 - (panelRect.top + panelRect.height / 2));
    });
    expect(alignment).not.toBeNull();
    expect(alignment).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  }
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.getByRole('link', { name: 'KARAOKE home' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Browse rentals' })).toBeVisible();
  await expect(page.locator('.account-topbar')).toHaveCSS('display', 'flex');
  await expect(page.locator('.page-context')).toHaveText('Customer account');

  const password = page.locator('#account-password');
  await password.fill('temporary-password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');

  await page.getByRole('button', { name: 'Create an account' }).click();
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  await expect(page.getByLabel('Full name')).toBeVisible();
  await page.getByRole('button', { name: 'Sign in' }).last().click();
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
  await expect(password).toHaveValue('');

  await page.goto('/admin');
  await expect(page).toHaveURL(/\/account$/);
});

test('explains invalid rental date ranges', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Rental starts').fill('2026-12-10T14:00');
  await page.getByLabel('Rental ends').fill('2026-12-10T13:00');

  await expect(page.locator('#rental-window-error')).toHaveText('End date and time must be after the start.');
  await expect(page.getByLabel('Rental ends')).toHaveAttribute('aria-invalid', 'true');
});

test('signs in the administrator and opens the administration workspace', async ({ page }) => {
  const email = process.env.KARAOKE_E2E_ADMIN_EMAIL;
  const password = process.env.KARAOKE_E2E_ADMIN_PASSWORD;
  test.skip(!email || !password, 'Set local admin credentials to run the admin workflow test.');

  await page.goto('/account');
  await page.getByLabel('Email').fill(email!);
  await page.locator('#account-password').fill(password!);
  await page.getByRole('button', { name: 'Sign in' }).click();

  await expect(page).toHaveURL(/\/(admin|platform)$/);
  if (page.url().endsWith('/admin')) {
    await expect(page.getByRole('heading', { name: 'Customer requests' })).toBeVisible();

    const sections = [
      { button: 'Products', heading: 'Catalog products' },
      { button: 'Classifications', heading: 'Quality classifications' },
      { button: 'Packages', heading: 'Saved packages' },
      { button: 'Inventory', heading: 'Add inventory unit' },
      { button: 'Customers', heading: 'Registered customers' },
      { button: 'Reports', heading: 'Rental and collection snapshot' },
    ];
    for (const section of sections) {
      await page.getByRole('button', { name: section.button }).click();
      await expect(page.getByRole('heading', { name: section.heading })).toBeVisible();
    }
  }
});
