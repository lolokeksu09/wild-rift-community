import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
mkdirSync('ui-screenshots',{recursive:true});
const app=await createApp(),origin=await app.listen();let browser;
try{browser=await chromium.launch();for(const width of [320,360,390,768,1440]){
 const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce'}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 assert.equal((await page.goto(origin)).status(),200);await page.locator('.launch').waitFor();await page.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('.sidebar').isVisible(),false);assert.equal(await page.locator('.topbar').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(requests.some(url=>url.includes('/api/clubs')),false);
 assert.equal(await page.locator('.launch-orbit').evaluate(el=>getComputedStyle(el).animationName),'none');
 await page.screenshot({path:`ui-screenshots/launch-${width}.png`,fullPage:true});
 await page.locator('[data-auth-mode=register]').click();await page.locator('#register input').first().waitFor();await page.waitForFunction(()=>document.activeElement?.closest('#register'));assert.equal(new URL(page.url()).pathname,'/account');
 await page.goBack();await page.locator('.launch').waitFor();await page.locator('[data-nav=clubs]').click();await page.waitForURL('**/clubs');await page.waitForFunction(()=>!document.body.classList.contains('launch-mode'));
 await page.goto(origin+'/feed');await page.locator('.welcome-hero').waitFor();assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: welcome layout, motion, auth, clubs and direct feed`);
}}finally{await browser?.close();await app.close();}
