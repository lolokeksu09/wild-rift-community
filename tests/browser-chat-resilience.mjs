import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';

// Local users and SQLite only. Route faults simulate transport/server failures.
mkdirSync('ui-screenshots',{recursive:true});
const app=await createApp({authLimit:200}),origin=await app.listen(),browser=await chromium.launch(),contexts=[],checks=[];
try{
 async function actor(handle){
  const context=await browser.newContext({viewport:{width:320,height:844}});contexts.push(context);let csrf;
  async function api(path,method='GET',data){const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{data})});assert(r.ok(),await r.text());const value=await r.json();if(value.csrf)csrf=value.csrf;return value;}
  const me=await api('/api/register','POST',{handle,name:handle,password:'Local-chat-resilience-12345'});return {context,api,id:me.user.id};
 }
 const owner=await actor('resilience_owner'),peer=await actor('resilience_peer');
 const club=await owner.api('/api/clubs','POST',{name:'Проверка переписки',description:'Локальная проверка',access:'open'});
 await owner.api('/api/direct','POST',{handle:'resilience_peer',body:'Приветствие',clientId:'resilience-request-0001'});
 const conversation=(await peer.api('/api/direct')).conversations[0].id;await peer.api(`/api/direct/${conversation}/decision`,'POST',{decision:'accept'});
 const endpoint=`/api/direct/${conversation}/messages`,clubEndpoint=`/api/clubs/${club.id}/messages`;
 const page=await owner.context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const input=()=>page.locator('[data-chat-form] textarea');
 async function open(kind='direct'){
  await page.goto(origin+(kind==='direct'?'/messages':`/clubs/${club.id}`));
  await page.locator(kind==='direct'?`[data-conversation="${conversation}"]`:'[data-club-tab=chat]').click();
  await page.waitForFunction(()=>document.querySelector('[data-chat-form] textarea')?.disabled===false);
 }
 const draft='Не отправлено: <img src=x onerror=alert(1)>\nСыграем вечером?';
 await open();await input().fill(draft);await page.locator('[data-direct-back]').click();await page.locator(`[data-conversation="${conversation}"]`).click();await page.waitForFunction(()=>document.querySelector('[data-chat-form] textarea')?.disabled===false);
 assert.equal(await input().inputValue(),draft,'Returning to a conversation must preserve unsent text');checks.push('direct draft survives back');
 await open();assert.equal(await input().inputValue(),draft,'Reload preserves the draft');assert.equal((await owner.api(endpoint)).messages.length,1,'Opening/reloading does not send drafts');assert.equal(await page.locator('[data-chat-log] img').count(),0);checks.push('reload without automatic send or HTML execution');
 await page.screenshot({path:'ui-screenshots/chat-draft-restored.png',fullPage:true});
 await open('club');assert.equal(await input().inputValue(),'','Drafts are separated between chats');await input().fill('Черновик клуба');await page.locator('[data-club-tab=posts]').click();await page.locator('[data-club-tab=chat]').click();await page.waitForFunction(()=>document.querySelector('[data-chat-form] textarea')?.disabled===false);assert.equal(await input().inputValue(),'Черновик клуба');assert.equal((await owner.api(clubEndpoint)).messages.length,0);checks.push('club draft survives tab change');
 await input().fill('');await open('club');assert.equal(await input().inputValue(),'','Clearing the input removes its draft');checks.push('explicit draft clearing');
 await open();assert.equal(await input().inputValue(),draft);await page.locator('[data-chat-form] button').click();await page.getByText(draft,{exact:true}).waitFor();await open();assert.equal(await input().inputValue(),'','Sent text must not reappear as a draft');checks.push('successful send clears draft');
 for(const status of [429,403]){
  await page.setViewportSize({width:status===429?320:390,height:844});await open();
  const body=`Отказ ${status}: сообщение остаётся в очереди`,explanation=status===429?'Слишком много сообщений. Попробуй позже.':'Создание контента ограничено до завтра.';
  await page.route('**'+endpoint,async route=>{if(route.request().method()==='POST')await route.fulfill({status,contentType:'application/json',body:JSON.stringify({error:explanation})});else await route.continue();});
  await input().fill(body);await page.locator('[data-chat-form] button').click();await page.locator('[data-chat-pending]').getByText(explanation,{exact:true}).waitFor();
  await input().focus();await page.setViewportSize({width:status===429?320:390,height:300});await page.locator('.editorial-chat').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  const metrics=await page.locator('[data-chat-form] button').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,uncovered:e.contains(hit),scrollWidth:document.documentElement.scrollWidth,width:innerWidth};});
  assert(metrics.top>=0&&metrics.bottom<=300&&metrics.uncovered);assert(metrics.scrollWidth<=metrics.width);assert(await page.locator('[data-chat-log]').getByText(draft,{exact:true}).count());
  const failureNotice=await page.locator('[data-chat-pending] small').evaluate(e=>{const r=e.getBoundingClientRect(),box=e.closest('.chat-outbox').getBoundingClientRect();return {top:r.top,bottom:r.bottom,boxTop:box.top,boxBottom:box.bottom};});
  assert(failureNotice.top>=failureNotice.boxTop&&failureNotice.bottom<=failureNotice.boxBottom,'Failure explanation must be visible without scrolling the queue');
  await page.screenshot({path:`ui-screenshots/chat-failure-${status}.png`});await page.unroute('**'+endpoint);await page.setViewportSize({width:390,height:844});
  await open();assert.equal(await input().inputValue(),'','A pending attempt is not duplicated in the editor');await page.locator('[data-chat-retry]').click();await page.locator('[data-chat-pending] .chat-pending').waitFor({state:'detached'});
  assert.equal((await owner.api(endpoint)).messages.filter(m=>m.body===body).length,1);checks.push(`write ${status}: readable history, visible composer, reload/retry without duplicate`);
 }
 // The server commits, but the browser loses the response; retries retain clientId.
 const lost='Ответ потерян после сохранения';let dropped=false;
 await page.route('**'+endpoint,async route=>{if(route.request().method()==='POST'&&!dropped){dropped=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await input().fill(lost);await page.locator('[data-chat-form] button').click();await page.locator('[data-chat-retry]').waitFor();await page.unroute('**'+endpoint);await page.locator('[data-chat-retry]').click();await page.locator('[data-chat-pending] .chat-pending').waitFor({state:'detached'});assert.equal((await owner.api(endpoint)).messages.filter(m=>m.body===lost).length,1);checks.push('committed message with lost response has no duplicate');
 await input().fill('Личный черновик перед выходом');await open('club');await input().fill('Клубный черновик перед выходом');await page.goto(origin+'/account');await page.locator('[data-account-section=security]').click();await page.locator('[data-logout="/api/logout"]').click();await page.locator('#login').waitFor();
 const remaining=await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('wr-chat-draft:')||k.startsWith('wr-chat-pending:')));assert.deepEqual(remaining,[],'Logout clears private local chat text');checks.push('logout clears all chat drafts and pending attempts');
 assert.deepEqual(errors,[]);writeFileSync('ui-screenshots/chat-resilience-results.json',JSON.stringify({browser:browser.version(),scope:'Local SQLite, simulated 403/429/lost transport response and reduced viewport. No real phone IME or production writes.',checks,errors},null,2));console.log(`PASS: ${checks.length} chat resilience scenarios; no JavaScript errors.`);
}finally{for(const context of contexts)await context.close();await browser.close();await app.close();}
