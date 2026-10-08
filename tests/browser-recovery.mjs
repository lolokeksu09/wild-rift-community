import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';

mkdirSync('ui-screenshots', { recursive: true });
const browser = await chromium.launch();
try {
  for (const width of [360, 390, 768, 1440]) {
    const app = await createApp(), origin = await app.listen();
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(origin+'/feed'); await page.locator('#account').click();
      await page.locator('[data-auth-switch=register]').click();await page.locator('#register [name=name]').fill('Игрок');
      await page.locator('#register [name=handle]').fill('browser_recovery');
      await page.locator('#register [name=password]').fill('Browser-recovery-only-1234');
      await page.locator('#register button').click();
      await page.locator('#createClub').waitFor({state:'attached'});
      await page.locator('#account').click();
      await page.locator('[data-account-section=security]').click();await page.locator('#recoveryCodes').waitFor();
      await page.locator('#recoveryCodes [name=password]').fill('Browser-recovery-only-1234');
      await page.locator('#recoveryCodes button').click();
      const codes = page.locator('[data-recovery-result] textarea');
      await codes.waitFor();
      const values = (await codes.inputValue()).split('\n');
      assert.equal(values.length, 8);
      assert.equal(await page.locator('#recoveryCodes [name=password]').inputValue(), '');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `ui-screenshots/recovery-codes-${width}.png`, fullPage: true });
      await page.locator('[data-logout="/api/logout"]').click();
      await page.getByText('Восстановить доступ', { exact: true }).click();
      await page.locator('#recover [name=handle]').fill('browser_recovery');
      await page.locator('#recover [name=code]').fill(values[0]);
      await page.locator('#recover [name=password]').fill('New-browser-password-5678');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: `ui-screenshots/recovery-form-${width}.png`, fullPage: true });
      await page.locator('#recover button').click();
      await page.getByText('Пароль изменён. Войди с новым паролем.', { exact: true }).waitFor();
      await page.locator('#login [name=handle]').fill('browser_recovery');
      await page.locator('#login [name=password]').fill('New-browser-password-5678');
      await page.locator('#login button').click();
      await page.locator('#createClub').waitFor({state:'attached'});
      await page.locator('#account').click();
      await page.locator('[data-account-section=security]').click();await page.getByText(/Осталось резервных кодов: 7/).waitFor();
      assert.equal(await page.locator('[data-recovery-result] textarea').count(), 0);
      const storage = await page.evaluate(() => JSON.stringify([localStorage, sessionStorage]));
      for (const code of values) assert(!storage.includes(code));
      assert.deepEqual(errors, []);
    } finally { await context.close(); await app.close(); }
  }
} finally { await browser.close(); }
console.log('PASS recovery browser: generation, clearing, logout, reset, new login, storage and four widths');

