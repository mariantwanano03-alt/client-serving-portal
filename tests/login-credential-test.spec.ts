import { test, expect } from '@playwright/test';

test('try login with alex@test.com test1234', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'alex@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('alex@test.com - After login - URL:', url);
  console.log('alex@test.com - Title:', await page.title());
  // Check if logged in
  await page.goto('/settings');
  const settingsTitle = await page.title();
  console.log('alex@test.com - Settings page title:', settingsTitle);
  const hasBody = await page.locator('body').count() > 0;
  console.log('alex@test.com - Settings body visible:', hasBody);
  
  // Also try dashboard
  await page.goto('/');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('alex@test.com - Dashboard body visible:', dashboardBody);
});

test('try login with senior@test.com test1234', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'senior@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('senior@test.com - After login - URL:', url);
  console.log('senior@test.com - Title:', await page.title());
  await page.goto('/');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('senior@test.com - Dashboard body visible:', dashboardBody);
});

test('try login with junior@test.com test1234', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'junior@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('junior@test.com - After login - URL:', url);
  console.log('junior@test.com - Title:', await page.title());
  await page.goto('/');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('junior@test.com - Dashboard body visible:', dashboardBody);
});
