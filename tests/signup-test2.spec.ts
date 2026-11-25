import { test, expect } from '@playwright/test';

test('signup with senior@test.com test1234', async ({ page }) => {
  await page.goto('/signup');
  await page.waitForSelector('input[type="email"]', { timeout: 5000 });
  await page.fill('input[type="email"]', 'senior@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.fill('input[placeholder="••••••••••••"]', 'test1234');
  await page.click('button:has-text("Create account")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('Signup2 - URL:', url);
  console.log('Signup2 - Title:', await page.title());
  
  // Check dashboard access
  await page.goto('/dashboard');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('Dashboard2 body visible:', dashboardBody);
  
  // Check settings access
  await page.goto('/settings');
  const settingsBody = await page.locator('body').count() > 0;
  console.log('Settings2 body visible:', settingsBody);
});

test('login with senior@test.com test1234', async ({ page }) => {
  // First ensure logged out by going to login page
  await page.goto('/login');
  await page.fill('input[type="email"]', 'senior@test.com');
  await page.fill('input[type="password"]', 'test1234');
  await page.click('button:has-text("Sign in")');
  await page.waitForLoadState('networkidle');
  const url = page.url();
  console.log('Login2 - URL:', url);
  console.log('Login2 - Title:', await page.title());
  
  // Check dashboard access
  await page.goto('/');
  const dashboardBody = await page.locator('body').count() > 0;
  console.log('Dashboard2 body visible after login:', dashboardBody);
  
  // Check settings access
  await page.goto('/settings');
  const settingsBody = await page.locator('body').count() > 0;
  console.log('Settings2 body visible after login:', settingsBody);
});
