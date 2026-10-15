import { test, expect } from '@playwright/test';

test('production assets use the page origin for API requests', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  // A running local development server must never hide a misrouted production bundle.
  await page.route(/\/api\//, (route) =>
    new URL(route.request().url()).origin === origin ? route.continue() : route.abort(),
  );
  const listing = page.waitForRequest(
    (request) => new URL(request.url()).pathname === '/api/rooms',
  );
  await page.goto('/');
  const request = await listing;
  expect(new URL(request.url()).origin).toBe(origin);
  expect((await request.response())?.ok()).toBe(true);
});
