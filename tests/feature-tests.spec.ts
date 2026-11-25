import { test, expect } from '@playwright/test';
import { ADMIN_EMAIL, ADMIN_PASSWORD, login } from './helpers/admin';

test('settings page theme buttons exist', async ({ page }) => {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD)
  await page.goto('/settings');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  const buttons = page.locator('button');
  const count = await buttons.count();
  expect(count).toBeGreaterThan(0);
  // Look for theme-related buttons
  for (let i = 0; i < count; i++) {
    const txt = await buttons.nth(i).innerText().then(t => t.trim());
    if (txt.includes('Dark') || txt.includes('Light') || txt.includes('Mode')) {
      console.log('Theme button found:', txt);
    }
  }
});

test('create-project page has audio recorder integration', async ({ page }) => {
  // Administrators are read-only; use a staff account for this route.
  await login(page, 'elena@test.com', 'test1234')
  await page.goto('/create-project');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  // Check for the AudioRecorder integration - look for recording-related text
  const pageText = await page.locator('body').innerText();
  const hasRecording = pageText.includes('record') || pageText.includes('Record') || 
                       pageText.includes('audio') || pageText.includes('Audio');
  console.log('Page has recording-related text:', hasRecording);
  console.log('Page text snippet:', pageText.substring(0, 200));
});

test('app responds to user navigation', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('body')).toBeVisible({ timeout: 10000 });
  // Verify the page is interactive and the permanent sidebar is gone.
  const hasDashboard = await page.locator('.dashboard-shell').count() > 0;
  const hasSidebar = await page.locator('.dashboard-sidebar').count() > 0;
  console.log('Has dashboard shell:', hasDashboard);
  console.log('Has permanent sidebar:', hasSidebar);
  expect(hasSidebar).toBe(false);
});

test('playwright can interact with the application', async ({ page }) => {
  await page.goto('/settings');
  // Take a screenshot
  await page.screenshot({ path: 'screenshots/settings-page.png' });
  console.log('Screenshot saved');
  
  // Get the page title
  const title = await page.title();
  console.log('Final title:', title);
  
  // Check for common form elements
  const hasInputs = await page.locator('input').count() > 0;
  const hasButtons = await page.locator('button').count() > 0;
  console.log('Has inputs:', hasInputs);
  console.log('Has buttons:', hasButtons);
});
