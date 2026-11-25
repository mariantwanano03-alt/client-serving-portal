import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 90000,
  expect: {
    // The local webpack dev server compiles routes on demand, React
    // StrictMode double-fetches, and Supabase calls can be slow, so
    // API-backed assertions need generous headroom.
    timeout: 60000,
  },
  fullyParallel: true,
  workers: process.env.CI ? 1 : 4,
  reporter: [
    ['list'],
    ['html', { open: 'never' }],
  ],
  projectName: 'Client Serving Portal QA',

  // Define test projects (each project = a browser)
  projects: [
    {
      name: 'Chromium',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome', // Use system Chrome instead of bundled
        baseURL: 'http://localhost:3000',
      },
    },
    {
      name: 'Mobile Chrome',
      use: {
        ...devices['Pixel 5'],
        channel: 'chrome',
        baseURL: 'http://localhost:3000',
      },
    },
  ],

  // Run your tests in parallel
  // timeout: 60000,
});
