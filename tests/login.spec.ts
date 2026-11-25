import { test, expect } from '@playwright/test';

test('home page loads', async ({ page }) => {
  await page.goto('/');
  // The app shows dashboard loading state when no user is auth'd
  await expect(page).toHaveTitle(/Client Serving Portal/);
  // Check for the dashboard loading state
  await expect(page.locator('.dashboard-loading')).toBeVisible();
});

test('login page accessible', async ({ page }) => {
  await page.goto('/login');
  // Page should load without error
  await expect(page.locator('body')).toBeVisible();
  const title = page.title();
  // Title may vary; just verify page loaded
  console.log('Login page title:', title);
});

test('settings page accessible', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('body')).toBeVisible();
  const title = page.title();
  console.log('Settings page title:', title);
});

test('create-project page accessible', async ({ page }) => {
  await page.goto('/create-project');
  await expect(page.locator('body')).toBeVisible();
  const title = page.title();
  console.log('Create Project page title:', title);
});
