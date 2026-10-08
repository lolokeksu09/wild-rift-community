import assert from 'node:assert/strict';
import {mkdirSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';
mkdirSync('ui-screenshots',{recursive:true});
const app=await createApp(),origin=await app.listen();let browser;
try{browser=await chromium.launch();for(const width of [320,360,390,680,768,1440]){
 const context=await browser.newContext({viewport:{width,height:844},reducedMotion:'reduce',hasTouch:true}),page=await context.newPage(),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 assert.equal((await page.goto(origin)).status(),200);await page.locator('.launch').waitFor();await page.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
 assert.equal(await page.locator('.sidebar').isVisible(),false);assert.equal(await page.locator('.topbar').isVisible(),false);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(requests.some(url=>url.includes('/api/clubs')),false);
 assert.equal(await page.locator('[data-launch-card]').count(),4);
 if(width<=700){
  assert.equal(await page.locator('.launch-card').first().evaluate(el=>getComputedStyle(el).display),'flex');
  assert((await page.locator('.launch-art').first().boundingBox()).height<=121);
  assert((await page.locator('.launch-card').first().boundingBox()).height<380);
  assert((await page.locator('.launch-entry').boundingBox()).y<600);
 }

 assert.match(await page.locator('[data-launch-card="0"]').textContent(),/сообщество игроков Wild Rift/i);
 assert.equal(await page.locator('.launch-track').evaluate(el=>getComputedStyle(el).scrollSnapType),'x mandatory');
 assert.equal(await page.locator('.launch-track').evaluate(el=>getComputedStyle(el).scrollBehavior),'auto');
 assert.equal(await page.locator('#launch-title').evaluate(el=>getComputedStyle(el).color),'rgb(244, 238, 231)');
 await page.locator('[data-launch-next]').click();
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="1"]').getAttribute('aria-current')==='step');
 await page.locator('[data-launch-track]').focus();await page.keyboard.press('End');
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="3"]').getAttribute('aria-current')==='step');
 assert.equal(await page.locator('[data-launch-next]').isVisible(),false);
 await page.keyboard.press('Home');
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="0"]').getAttribute('aria-current')==='step');
 await page.locator('[data-launch-track]').evaluate(el=>el.scrollTo({left:el.querySelector('[data-launch-card="2"]').offsetLeft-parseFloat(getComputedStyle(el).paddingLeft),behavior:'instant'}));
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="2"]').getAttribute('aria-current')==='step');
 await page.locator('[data-launch-step="0"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="0"]').getAttribute('aria-current')==='step');
 for(const selector of ['.launch-primary','.launch-secondary','[data-launch-next]'])assert((await page.locator(selector).boundingBox()).height>=44);
 await page.screenshot({path:`ui-screenshots/launch-${width}.png`,fullPage:true});
 await page.locator('[data-auth-mode=register]').click();await page.locator('#register input').first().waitFor();await page.waitForFunction(()=>document.activeElement?.closest('#register'));assert.equal(new URL(page.url()).pathname,'/account');
 await page.goBack();await page.locator('.launch').waitFor();await page.locator('.launch [data-nav=clubs]').click();await page.waitForURL('**/clubs');await page.waitForFunction(()=>!document.body.classList.contains('launch-mode'));
 await page.goto(origin+'/feed');await page.locator('.welcome-hero').waitFor();assert.deepEqual(errors,[]);await context.close();console.log(`PASS ${width}px: welcome layout, motion, auth, clubs and direct feed`);
}
 const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true}),page=await context.newPage();
 await page.goto(origin);await page.waitForFunction(()=>document.querySelector('#main').getAttribute('aria-busy')==='false');
 await page.locator('[data-launch-next]').focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');await page.keyboard.press('Enter');
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="3"]').getAttribute('aria-current')==='step');
 await page.waitForFunction(()=>{
  const track=document.querySelector('[data-launch-track]'),card=document.querySelector('[data-launch-card="3"]');
  return Math.abs(card.getBoundingClientRect().left-track.getBoundingClientRect().left-parseFloat(getComputedStyle(track).paddingLeft))<30;
 });
 assert.equal(await page.locator('[data-launch-track]').evaluate(el=>el===document.activeElement),true);
 await page.locator('[data-launch-step="0"]').click();await page.waitForFunction(()=>document.querySelector('[data-launch-track]').scrollLeft<1);
 const box=await page.locator('[data-launch-track]').boundingBox(),cdp=await context.newCDPSession(page),x=box.x+box.width*.8,y=box.y+100;
 await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
 for(let i=1;i<=8;i++)await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:x-box.width*.65*i/8,y}]});
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>document.querySelector('[data-launch-step="1"]').getAttribute('aria-current')==='step');
 await page.screenshot({path:'ui-screenshots/launch-swipe-390.png',fullPage:true});
 await context.close();console.log('PASS normal motion: repeated keyboard advance, settled position, focus and native touch swipe');
}finally{await browser?.close();await app.close();}
