import { expect, test } from '@playwright/test';

test('visits the app root url', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Make room for a good gathering.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Equipment for your event' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Standard Table' })).toBeVisible();
  await page.getByRole('button', { name: 'Add', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Calculate estimate' })).toBeDisabled();
});

test('opens account page and rejects unauthenticated admin access', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'Sign in to your account' })).toBeVisible();
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

  await expect(page.getByRole('alert')).toHaveText('End date and time must be after the start.');
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

  await expect(page.getByText('You are signed in.')).toBeVisible();
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.page-context')).toBeHidden();
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: 'Rental administration' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Customer requests' })).toBeVisible();

  const sections = [
    { button: 'Products & quality', heading: 'Add product' },
    { button: 'Packages', heading: 'Create package' },
    { button: 'Inventory', heading: 'Add inventory unit' },
    { button: 'Customers', heading: 'Registered customers' },
    { button: 'Reports', heading: 'Rental and collection snapshot' },
  ];
  for (const section of sections) {
    await page.getByRole('button', { name: section.button }).click();
    await expect(page.getByRole('heading', { name: section.heading })).toBeVisible();
  }
});
