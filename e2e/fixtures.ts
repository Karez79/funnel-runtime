// Shared test fixture: every page fails its test on a console error or an uncaught
// exception (a CSP violation shows up as a console error). A test that provokes an
// expected HTTP error (the browser logs every 4xx/5xx response) lists it in
// `allowedConsoleErrors`; everything else still fails the test.
import { test as base, expect } from '@playwright/test';

export const test = base.extend<{ allowedConsoleErrors: RegExp[]; pageErrors: string[] }>({
  allowedConsoleErrors: [[], { option: true }],
  pageErrors: [
    async ({ page, allowedConsoleErrors }, use) => {
      const errors: string[] = [];
      page.on('console', (msg) => {
        const text = msg.text();
        if (msg.type() === 'error' && !allowedConsoleErrors.some((re) => re.test(text))) {
          errors.push(text);
        }
      });
      page.on('pageerror', (err) => errors.push(err.message));
      await use(errors);
      expect(errors).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
