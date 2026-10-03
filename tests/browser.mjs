import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { createApp } from '../server/app.mjs';

// Isolated in-memory database; no working data or external service is used.
const app = await createApp();
const image=await sharp({create:{width:1000,height:600,channels:3,background:'#3b5e82'}}).png().toBuffer();
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
    await page.locator('#createClub [name=name]').fill('Ночная смена');
    await page.locator('#createClub [name=description]').fill('Играем вечером, обсуждаем матчи и помогаем друг другу. Спокойная компания для совместных игр.');
    await page.locator('#createClub button').click();
    await page.locator('[data-club-tab=posts]').waitFor();
    await page.locator('[data-club-tab=settings]').click();
    await page.locator('#clubCover input[type=file]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:image});
    await page.locator('#clubCover button[type=submit]').click();
    await page.locator('.club-banner-image').waitFor();
    await page.locator('[data-club-tab=posts]').click();
    await page.locator('.club-compose summary').click();
    await page.locator('#post').waitFor();
    await page.locator('#post [name=title]').fill('После матча');
    await page.locator('#post [name=body]').fill('Обсудим игру и соберём команду на следующий матч.');
    await page.locator('#post input[type=file]').setInputFiles({name:'match.png',mimeType:'image/png',buffer:image});
    await page.locator('#post button:not([type=button])').click();
    await page.locator('[data-image]').waitFor();
    await page.locator('[data-image]').click();
    await page.locator('#imageViewer[open]').waitFor();
    await page.locator('#imageViewer button').click();
    await layout('club overview');
    await page.screenshot({path:`ui-screenshots/club-${width}.png`,fullPage:true});
    await page.locator('#home').click();
    await page.locator('[data-club-card]').first().waitFor();
    await page.locator('#clubSearch').fill('нет такого клуба');
    assert.equal(await page.locator('[data-club-card]:visible').count(),0);
    await page.locator('#clubSearch').fill('Ночная');
    assert((await page.locator('[data-club-card]:visible').count())>0);
    await layout('club cards');
    await page.screenshot({path:`ui-screenshots/clubs-${width}.png`,fullPage:true});
    for (const [id, heading] of [['account', 'Аккаунт'], ['direct', 'Сообщения'], ['reports', 'Жалобы']]) {
      await page.locator(`#${id}`).click();
      await page.locator('#main h1').filter({ hasText: heading }).waitFor();
      assert.equal(await page.locator(`#${id}`).getAttribute('aria-current'), 'page');
      await layout(id);
      if(id==='account'){
        await page.locator('#profile [name=rank]').fill('Мастер');
        await page.locator('#profile [name=region]').fill('Европа');
        await page.locator('#profile [name=language]').fill('Русский');
        await page.locator('#profile [name=champions]').fill('Ренгар, Ахри');
        await page.locator('#profile [name=playTime]').fill('Вечером, 20:00–23:00 МСК');
        await page.locator('#profile [name=riotId]').fill('Player#ABC');
        await page.locator('#profile [name=profileVisible]').check();
        await page.locator('#profile [name=roles][value=jungle]').check();
        await page.locator('#profile [name=avatarFile]').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:image});
        await page.locator('#profile [name=coverFile]').setInputFiles({name:'cover.png',mimeType:'image/png',buffer:image});
        let recoveredAvatar=null;
        if(width===360){
          let dropped=false;
          await page.route('**/api/media',async route=>{
            if(!dropped){dropped=true;const response=await route.fetch();recoveredAvatar=(await response.json()).image.id;await route.abort();}
            else await route.continue();
          });
          await page.locator('#profile button[type=submit]').click();
          await page.waitForFunction(()=>document.querySelector('#profile .error')?.textContent.length>0);
        }
        await page.locator('#profile button[type=submit]').click();
        await page.locator('.identity-avatar img').waitFor();
        await page.locator('.game-card').getByText('Мастер',{exact:true}).waitFor();
        if(width===360){
          const saved=await page.evaluate(async()=> (await (await fetch('/api/me')).json()).user.avatarId);
          assert.equal(saved,recoveredAvatar,'Lost upload response must reuse the same stored image');
          await page.unroute('**/api/media');
        }
        await layout('saved player profile');
        const guest=await context.browser().newContext({viewport:{width,height:900}});
        const other=await guest.newPage();await other.goto(origin);await other.locator('.author-link').first().click();
        await other.getByRole('heading',{name:'Профиль игрока'}).waitFor();
        assert.equal(await other.locator('.game-card').getByText('Player#ABC',{exact:true}).count(),0);
        await other.screenshot({path:`ui-screenshots/public-profile-${width}.png`,fullPage:true});await guest.close();
        await page.screenshot({path:`ui-screenshots/profile-${width}.png`,fullPage:true});
      }
    }
    await context.close();
  }
} finally {
  if (browser) await browser.close();
  await app.close();
}
