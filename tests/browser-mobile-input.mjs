import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {chromium} from 'playwright';
import {createApp} from '../server/app.mjs';

// Reduced viewport height simulates keyboard space; it is not a real Android IME.
mkdirSync('ui-screenshots',{recursive:true});
const app=await createApp({authLimit:200}),origin=await app.listen(),browser=await chromium.launch(),contexts=[],results=[],formResults=[],textResults=[];
try{
 async function actor(handle,name){
  const context=await browser.newContext({viewport:{width:390,height:844},reducedMotion:'reduce'});contexts.push(context);let csrf;
  async function api(path,method='GET',data){const r=await context.request.fetch(origin+path,{method,headers:{Origin:origin,'X-Community-Request':'1',...(csrf?{'X-CSRF-Token':csrf}:{})},...(data===undefined?{}:{data})});assert(r.ok(),await r.text());const value=await r.json();if(value.csrf)csrf=value.csrf;return value;}
  const me=await api('/api/register','POST',{handle,name,password:'Mobile-input-local-only-12345'});return {context,api,id:me.user.id};
 }
 const owner=await actor('input_owner','Проверка ввода'),peer=await actor('input_peer','ОченьДлинноеИмяСобеседникаБезПробелов');
 const club=await owner.api('/api/clubs','POST',{name:'Проверка чата',description:'Только локальная проверка интерфейса',access:'open'});
 await owner.api('/api/direct','POST',{handle:'input_peer',body:'Тестовое приветствие',clientId:'mobile-input-request-001'});
 const inbox=await peer.api('/api/direct');await peer.api('/api/direct/'+inbox.conversations[0].id+'/decision','POST',{decision:'accept'});
 const conversation=(await owner.api('/api/direct')).conversations[0].id;
 const page=await owner.context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 async function chat(kind){
  await page.goto(origin+(kind==='direct'?'/messages':'/clubs/'+club.id));
  if(kind==='direct'){await page.locator('[data-conversation="'+conversation+'"]').click();}
  else{await page.locator('[data-club-tab=chat]').click();}
  await page.waitForFunction(()=>!document.querySelector('[data-chat-form] textarea')?.disabled);
 }
 for(const width of [320,360,390,430])for(const kind of ['direct','club'])for(const height of [844,380,300]){
  await page.setViewportSize({width,height:844});await chat(kind);
  const input=page.locator('[data-chat-form] textarea');
  await page.setViewportSize({width,height});assert.equal(await page.locator('.primary-nav').isVisible(),true,'Short viewport without form focus keeps navigation');await input.focus();
  await page.locator('.editorial-chat').evaluate(e=>e.scrollIntoView({block:'start',behavior:'instant'}));
  const metrics=await page.evaluate(()=>{
   const input=document.querySelector('[data-chat-form] textarea'),button=document.querySelector('[data-chat-form] button'),chat=input.closest('.editorial-chat'),nav=document.querySelector('.primary-nav');
   const rect=e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
   const b=button.getBoundingClientRect(),hit=document.elementFromPoint(b.x+b.width/2,b.y+b.height/2);
   return {viewport:innerHeight,scrollWidth:document.documentElement.scrollWidth,chat:rect(chat),input:rect(input),send:rect(button),sendUncovered:!!hit&&button.contains(hit),navVisible:getComputedStyle(nav).display!=='none'};
  });
  results.push({kind,width,height,...metrics});await page.screenshot({path:`ui-screenshots/mobile-input-${kind}-${width}-${height}.png`});
  assert.equal(metrics.scrollWidth<=width,true,`${kind} ${width}×${height}: horizontal overflow`);
  if(height<=380){
   assert(metrics.chat.height<=height-20,`${kind} ${width}×${height}: chat does not fit reduced viewport (${metrics.chat.height})`);
   assert(metrics.input.top>=-1&&metrics.send.bottom<=height+1,`${kind} ${width}×${height}: composer outside visible area`);
   assert(metrics.sendUncovered,`${kind} ${width}×${height}: send covered by another element`);
   assert.equal(metrics.navVisible,false,`${kind} ${width}×${height}: navigation consumes keyboard space`);
  }
  const body=`Проверка ${kind} ${width} ${height}`;await input.fill(body);
  if(height<=380){const editing=await page.locator('[data-chat-form] button').evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,uncovered:e.contains(hit)};});assert(editing.top>=0&&editing.bottom<=height+1&&editing.uncovered,`${kind} ${width}×${height}: draft status obscures send`);}
  await page.locator('[data-chat-form] button').click();await page.getByText(body,{exact:true}).waitFor();assert.equal(await input.inputValue(),'');
  await page.setViewportSize({width,height:844});assert.equal(await page.locator('.primary-nav').isVisible(),true);await page.locator('#main').focus();
  console.log(`PASS ${kind} ${width}×${height}: reduced viewport, send and return to navigation`);
 }
 const guest=await browser.newContext({viewport:{width:320,height:844}});contexts.push(guest);const auth=await guest.newPage();auth.on('pageerror',e=>errors.push(e.message));
 for(const width of [320,390])for(const mode of ['login','register']){
  await auth.setViewportSize({width,height:844});await auth.goto(origin+'/account');if(mode==='register')await auth.locator('[data-auth-switch=register]').click();
  await auth.locator('#'+mode+' [name=password]').focus();await auth.setViewportSize({width,height:300});const submit=auth.locator('#'+mode+' .btn.primary');await submit.scrollIntoViewIfNeeded();await submit.focus();
  const metrics=await submit.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,uncovered:e.contains(hit),scrollWidth:document.documentElement.scrollWidth};});
  assert(metrics.top>=0&&metrics.bottom<=300&&metrics.uncovered);assert(metrics.scrollWidth<=width);assert.equal(await auth.locator('.primary-nav').isVisible(),false);formResults.push({mode,width,height:300,...metrics});
 }
 // The account form must also keep its submit button accessible.
 for(const width of [320,390]){
  await page.setViewportSize({width,height:844});await page.goto(origin+'/account');await page.getByRole('button', { name: 'Редактировать профиль', exact: true }).click();await page.locator('#profile [name=bio]').focus();await page.setViewportSize({width,height:300});
  const save=page.locator('#profile button[type=submit]');await save.scrollIntoViewIfNeeded();await save.focus();
  const metrics=await save.evaluate(e=>{const r=e.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {top:r.top,bottom:r.bottom,uncovered:e.contains(hit),scrollWidth:document.documentElement.scrollWidth};});
  assert(metrics.top>=0&&metrics.bottom<=300&&metrics.uncovered);assert(metrics.scrollWidth<=width);formResults.push({width,height:300,...metrics});
  await page.setViewportSize({width,height:844});await page.locator('#main').focus();assert.equal(await page.locator('.primary-nav').isVisible(),true);
 }
 // CSS font stress is explicitly separate from native Android text scaling.
 for(const width of [320,390])for(const path of ['/feed','/account','/messages']){
  await page.setViewportSize({width,height:844});await page.goto(origin+path);await page.waitForFunction(()=>document.querySelector('#main')?.getAttribute('aria-busy')==='false');
  if(path==='/messages')await page.locator('[data-direct-row]').waitFor();
  await page.evaluate(()=>{
   const elements=[...document.querySelectorAll('#main *, .primary-nav button')].filter(e=>e.getClientRects().length&&!e.closest('.sr-only'));
   const sizes=elements.map(e=>parseFloat(getComputedStyle(e).fontSize));elements.forEach((e,i)=>e.style.setProperty('font-size',sizes[i]*2+'px','important'));
  });
  const metrics=await page.evaluate(()=>({scrollWidth:document.documentElement.scrollWidth,navClipped:[...document.querySelectorAll('.primary-nav button')].filter(e=>e.getClientRects().length&&(e.scrollWidth>e.clientWidth+1||e.scrollHeight>e.clientHeight+1)).map(e=>e.textContent)}));
  await page.screenshot({path:`ui-screenshots/text-stress-${path.slice(1)}-${width}.png`,fullPage:true});textResults.push({path,width,scale:2,...metrics});
  assert(metrics.scrollWidth<=width,`${path} ${width}: doubled fonts overflow`);assert.deepEqual(metrics.navClipped,[],`${path} ${width}: doubled navigation labels clipped`);
 }
 assert.deepEqual(errors,[]);writeFileSync('ui-screenshots/mobile-input-results.json',JSON.stringify({browser:browser.version(),scope:'Local fixtures. Reduced-height emulation and doubled CSS fonts; no actual phone keyboard or native Android font scaling.',results,formResults,textResults,errors},null,2));console.log(`PASS: ${results.length} chat states, ${formResults.length} forms, ${textResults.length} doubled-font pages, no JavaScript errors.`);
}finally{for(const context of contexts)await context.close();await browser.close();await app.close();}
