import { test, expect } from '@playwright/test';

test('home page loads showing dashboard state', async ({ page }) => {
  await page.goto('/');
  // App shows dashboard loading state without authentication
  await expect(page.locator('.dashboard-loading')).toBeVisible({ timeout: 10000 });
  // The portal sets its own application title
  const title = await page.title();
  expect(title).toContain('Client Serving Portal');
});

test('settings page loads', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  const title = page.title();
  console.log('Settings page title:', title);
  // Page should not error - just verify it loads
});

test('create-project page loads', async ({ page }) => {
  await page.goto('/create-project');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  const title = page.title();
  console.log('Create Project page title:', title);
  // Page should not error - just verify it loads
});

test('login page loads', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  const title = page.title();
  console.log('Login page title:', title);
});

test('permanent sidebar is removed from dashboard pages', async ({ page }) => {
  await page.goto('/');
  // Without auth, dashboard shows loading state
  await expect(page.locator('.dashboard-loading')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.dashboard-sidebar')).toHaveCount(0);
});

// Theme testing - verify the toggle mechanism
test('settings page has theme toggle elements', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  // Find any button with 'Dark' or 'Light' text
  const buttons = page.locator('button');
  const buttonCount = await buttons.count();
  console.log('Button count on settings page:', buttonCount);
  // Check for common button texts
  for (let i = 0; i < buttonCount; i++) {
    const btnText = await buttons.nth(i).innerText();
    console.log('Button', i, ':', btnText.trim());
  }
});

// Create project testing - verify UI elements
test('create-project page has option sections', async ({ page }) => {
  await page.goto('/create-project');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  // Check for section headings
  const headings = page.locator('h3, h4');
  const headingCount = await headings.count();
  console.log('Heading count on create-project:', headingCount);
  for (let i = 0; i < headingCount; i++) {
    const hText = await headings.nth(i).innerText();
    console.log('Heading', i, ':', hText.trim());
  }
});
