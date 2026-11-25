import { test, expect } from '@playwright/test';

test('signup with alex@test.com test1234', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', 'alex@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.fill('input[placeholder="••••••••••••"]', 'test1234');
  await page.click('button:has-text("Create account")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('Signup - URL:', url);
  console.log('Signup - Title:', await page.title());
  
  // Check if redirected to dashboard (logged in)
  await page.goto('/dashboard');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('Dashboard body visible after signup:', dashboardBody);
  
  // Check settings page
  await page.goto('/settings');
  const settingsBody = await page.locator('body').count() > 0;
  console.log('Settings body visible after signup:', settingsBody);
});

test('login with alex@test.com test1234 after signup', async ({ page }) => {
  // First signup
  await page.goto('/signup');
  await page.fill('input[type="email"]', 'alex@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.fill('input[placeholder="••••••••••••"]', 'test1234');
  await page.click('button:has-text("Create account")');
  await page.waitForLoadState('networkidle');
  
  // Now try login
  await page.goto('/login');
  await page.fill('input[type="email"]', 'alex@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('Login after signup - URL:', url);
  console.log('Login after signup - Title:', await page.title());
  
  // Check dashboard
  await page.goto('/');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('Dashboard body visible after login:', dashboardBody);
  
  // Check settings
  await page.goto('/settings');
  const settingsBody = await page.locator('body').count() > 0;
  console.log('Settings body visible after login:', settingsBody);
});
