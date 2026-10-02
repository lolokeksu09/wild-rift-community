import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createApp } from '../server/app.mjs';

// Isolated in-memory database; no working data or external service is used.
const app = await createApp();
let browser;
try {
  const origin = await app.listen();
  browser = await chromium.launch();
  for (const width of [360, 390, 768, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    async function layout(label) {
      await page.locator('#main h1').first().waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${width}: overflow in ${label}`);
      const boxes = await page.locator('.primary-nav button').evaluateAll(elements => elements.map(el => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
      }));
      for (const box of boxes) assert(box.width > 0 && box.height > 0 && box.x >= 0 && box.right <= width + 1, `${width}: nav outside viewport`);
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        assert(a.right <= b.x + 1 || b.right <= a.x + 1 || a.bottom <= b.y + 1 || b.bottom <= a.y + 1, `${width}: overlapping navigation`);
      }
      assert.deepEqual(errors, [], `${width}: browser errors`);
      console.log(`PASS ${width}px: ${label}, no horizontal overflow or overlapping navigation`);
    }
    await page.goto(origin);
    await layout('guest home');
    mkdirSync('ui-screenshots',{recursive:true});
    await page.screenshot({path:`ui-screenshots/home-${width}.png`,fullPage:true});
    await page.locator('#account').click();
    await page.locator('#register').waitFor();
    await layout('registration');
    await page.locator('#register [name=name]').fill('ОченьДлинноеИмяИгрокаБезПробелов1234567890');
    await page.locator('#register [name=handle]').fill(`browser${width}`);
    await page.locator('#register [name=password]').fill('Browser-test-only-123456');
    await page.locator('#register button').click();
    await page.locator('#createClub').waitFor();
    await layout('signed-in clubs');
    for (const [id, heading] of [['account', 'Аккаунт'], ['direct', 'Сообщения'], ['reports', 'Жалобы']]) {
      await page.locator(`#${id}`).click();
      await page.locator('#main h1').filter({ hasText: heading }).waitFor();
      assert.equal(await page.locator(`#${id}`).getAttribute('aria-current'), 'page');
      await layout(id);
      if(id==='account')await page.screenshot({path:`ui-screenshots/profile-${width}.png`,fullPage:true});
    }
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await app.close();
}
